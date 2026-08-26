const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");

describe("RulesConfigFacet", function () {
    function buildRuleSet(overrides = {}) {
        // Keep a single canonical base shape so each test only overrides what it cares about.
        return {
            enabledBits: 1n,
            warnThreshold: 300,
            blockThreshold: 800,
            velocityWindowSecs: 3600,
            maxAmount: ethers.parseEther("100"),
            maxOutflowAmount: ethers.parseEther("1000"),
            maxPerRecipientDaily: ethers.parseEther("250"),
            maxEvalCount: 25n,
            restrictContracts: false,
            extendCommitOnWarn: false,
            warnExtendSeconds: 300,
            requireKyc: true,
            kycAmountThreshold: ethers.parseEther("10"),
            kycSoonSeconds: 86400,
            createdAt: 0n,
            effectiveFrom: 0n,
            ...overrides
        };
    }

    async function setupFixture() {
        // Role-aware fixture is required because onlyRulesAdmin enforces admin/compliance roles.
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        return deployment;
    }

    it("computes deterministic scope keys for network, institution, and wallet", async function () {
        const { facets, signers } = await loadFixture(setupFixture);

        const network = await facets.rulesConfig.scopeKeyForNetwork();
        const institution = await facets.rulesConfig.scopeKeyForInstitution(signers.user1.address);
        const wallet = await facets.rulesConfig.scopeKeyForWallet(signers.user2.address);

        const expectedNetwork = ethers.solidityPackedKeccak256(["string", "bytes32"], ["NETWORK", ethers.ZeroHash]);
        const expectedInstitution = ethers.solidityPackedKeccak256(["string", "address"], ["INSTITUTION", signers.user1.address]);
        const expectedWallet = ethers.solidityPackedKeccak256(["string", "address"], ["WALLET", signers.user2.address]);

        expect(network).to.equal(expectedNetwork);
        expect(institution).to.equal(expectedInstitution);
        expect(wallet).to.equal(expectedWallet);
    });

    it("stores and returns rule sets for authorized admin", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        const scopeKey = await facets.rulesConfig.scopeKeyForNetwork();
        const rules = buildRuleSet({ warnThreshold: 420, blockThreshold: 900 });

        // Owner has DEFAULT_ADMIN_ROLE from DiamondInit, so this should be authorized.
        await expect(facets.rulesConfig.connect(signers.owner).setRuleSet(scopeKey, rules))
            .to.emit(facets.rulesConfig, "RuleSetUpdated")
            .withArgs(scopeKey, 1n, 0n);

        const stored = await facets.rulesConfig.getRuleSet(scopeKey);
        expect(stored.warnThreshold).to.equal(420);
        expect(stored.blockThreshold).to.equal(900);
        expect(stored.requireKyc).to.equal(true);
        expect(stored.maxPerRecipientDaily).to.equal(ethers.parseEther("250"));
    });

    it("rejects callers without DEFAULT_ADMIN_ROLE or COMPLIANCE_OFFICER_ROLE", async function () {
        const { facets, signers } = await loadFixture(setupFixture);

        await expect(
            facets.rulesConfig.connect(signers.admin).setObservationMode(true, 100, 200)
        )
            .to.be.revertedWithCustomError(facets.rulesConfig, "UnauthorizedRole")
            .withArgs(signers.admin.address, ROLES.COMPLIANCE_OFFICER_ROLE);
    });

    it("allows COMPLIANCE_OFFICER_ROLE to manage observation mode and rule weights", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        await grantRole(facets.accessControl, ROLES.COMPLIANCE_OFFICER_ROLE, signers.user3.address, signers.owner);

        const scopeKey = await facets.rulesConfig.scopeKeyForWallet(signers.user1.address);

        await expect(
            facets.rulesConfig.connect(signers.user3).setObservationMode(true, 450, 850)
        )
            .to.emit(facets.rulesConfig, "ObservationModeUpdated")
            .withArgs(true, 450, 850);

        const [observationMode, warnAt, denyAt] = await facets.rulesConfig.getObservationConfig();
        expect(observationMode).to.equal(true);
        expect(warnAt).to.equal(450);
        expect(denyAt).to.equal(850);

        await expect(
            facets.rulesConfig.connect(signers.user3).setRuleWeight(scopeKey, 7, 333)
        )
            .to.emit(facets.rulesConfig, "RuleWeightUpdated")
            .withArgs(scopeKey, 7, 333);

        expect(await facets.rulesConfig.getRuleWeight(scopeKey, 7)).to.equal(333);
    });

    it("validates batch rule weight array lengths", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        const scopeKey = await facets.rulesConfig.scopeKeyForNetwork();

        await expect(
            facets.rulesConfig.connect(signers.owner).setRuleWeights(scopeKey, [1, 2], [10])
        ).to.be.revertedWith("Length mismatch");
    });

    it("supports wallet institution links and merkle root updates", async function () {
        const { facets, signers } = await loadFixture(setupFixture);

        await expect(
            facets.rulesConfig.connect(signers.owner).setWalletInstitution(signers.user1.address, signers.user2.address)
        )
            .to.emit(facets.rulesConfig, "WalletInstitutionSet")
            .withArgs(signers.user1.address, signers.user2.address);

        expect(await facets.rulesConfig.getWalletInstitution(signers.user1.address)).to.equal(signers.user2.address);

        const allowRoot = ethers.keccak256(ethers.toUtf8Bytes("allow-root"));
        const denyRoot = ethers.keccak256(ethers.toUtf8Bytes("deny-root"));
        await facets.rulesConfig.connect(signers.owner).setMerkleRoots(allowRoot, denyRoot);

        const [storedAllow, storedDeny] = await facets.rulesConfig.getMerkleRoots();
        expect(storedAllow).to.equal(allowRoot);
        expect(storedDeny).to.equal(denyRoot);
    });

    it("returns institution registry id mapping via getWalletInstitutionId", async function () {
        const { facets, signers } = await loadFixture(setupFixture);

        await facets.institutionRegistry.connect(signers.admin).registerInstitution(
            "RulesConfig Institution",
            ethers.keccak256(ethers.toUtf8Bytes("rules-config-meta")),
            "ipfs://rules-config-institution",
            signers.user1.address
        );

        const institutionId = ethers.solidityPackedKeccak256(["uint256"], [0]);

        await facets.institutionRegistry
            .connect(signers.admin)
            .linkWalletToInstitution(signers.user2.address, institutionId);

        expect(await facets.rulesConfig.getWalletInstitutionId(signers.user2.address)).to.equal(institutionId);
    });
});
