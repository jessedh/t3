const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

/**
 * Wave 8A — ComplianceStatusLib canonical KYC resolver tests.
 *
 * These tests cover the unified KYC read path used by CustodianRegistryFacet,
 * RulesEngineFacet, T3CommonLib half-life calculations, and WalletRecoveryFacet
 * successor eligibility. No new enforcement behavior is tested here.
 */
describe("ComplianceStatusLib (Wave 8A KYC resolver)", function () {
    const oneDay = 24 * 60 * 60;
    const oneYear = 365 * oneDay;

    // InstitutionLifecycleStorage.InstitutionMode enum values
    const MODE_ACTIVE = 0;
    const MODE_DEFAULTED = 3;
    const MODE_RESOLVED = 4;

    // InstitutionStorage.WalletAffiliationStatus enum values
    const AFFILIATION_NONE = 0;
    const AFFILIATION_ACTIVE = 1;
    const AFFILIATION_SUSPENDED = 2;
    const AFFILIATION_REVOKED = 3;

    async function fixture() {
        const dep = await deployT3DiamondFixture();
        const { facets, signers, diamondAddress } = dep;
        await setupTestRoles(facets, signers);
        return { ...dep, diamondAddress };
    }

    async function kycTimestamps() {
        const now = await time.latest();
        return { validated: now, expires: now + oneYear };
    }

    beforeEach(async function () {
        // silence
    });

    describe("direct KYC status (kycStatusOf)", function () {
        it("valid KYC reports true via isKYCValid", async function () {
            const { facets, signers } = await loadFixture(fixture);
            const { validated, expires } = await kycTimestamps();

            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address, validated, expires
            );

            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.true;
        });

        it("revokeKYC flips isKYCValid to false immediately", async function () {
            const { facets, signers } = await loadFixture(fixture);
            const { validated, expires } = await kycTimestamps();

            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address, validated, expires
            );
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.true;

            const reasonCode = 42;
            await expect(
                facets.custodian.connect(signers.custodian1).revokeKYC(signers.user1.address, reasonCode)
            )
                .to.emit(facets.custodian, "KYCRevoked")
                .withArgs(signers.user1.address, signers.custodian1.address, reasonCode);

            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.false;
        });

        it("expired KYC timestamp returns false without a write", async function () {
            const { facets, signers } = await loadFixture(fixture);
            const now = await time.latest();
            const expires = now + oneDay;

            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address, now, expires
            );
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.true;

            await time.increase(oneDay + 1);

            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.false;
        });

        it("DEFAULTED institution mode invalidates member wallets", async function () {
            const { facets, signers } = await loadFixture(fixture);
            const { validated, expires } = await kycTimestamps();

            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address, validated, expires
            );
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.true;

            await facets.institutionLifecycle.connect(signers.owner).setInstitutionMode(
                signers.custodian1.address, MODE_DEFAULTED
            );
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.false;
        });

        it("RESOLVED institution mode invalidates member wallets", async function () {
            const { facets, signers } = await loadFixture(fixture);
            const { validated, expires } = await kycTimestamps();

            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address, validated, expires
            );
            await facets.institutionLifecycle.connect(signers.owner).setInstitutionMode(
                signers.custodian1.address, MODE_DEFAULTED
            );
            await facets.institutionLifecycle.connect(signers.owner).setInstitutionMode(
                signers.custodian1.address, MODE_RESOLVED
            );
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.false;
        });

        it("Suspended wallet affiliation invalidates KYC", async function () {
            const { facets, signers } = await loadFixture(fixture);
            const { validated, expires } = await kycTimestamps();

            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address, validated, expires
            );

            // Register an institution and link the wallet
            const name = "Test Bank";
            const tx = await facets.institutionRegistry.connect(signers.owner).registerInstitution(
                name, ethers.ZeroHash, "", signers.owner.address
            );
            const rc = await tx.wait();
            const institutionId = rc.logs
                .map((l) => { try { return facets.institutionRegistry.interface.parseLog(l); } catch (_) { return null; } })
                .find((p) => p && p.name === "InstitutionRegistered")?.args.id;
            expect(institutionId).to.not.equal(ethers.ZeroHash);

            await facets.institutionRegistry.connect(signers.owner).linkWalletToInstitution(
                signers.user1.address, institutionId
            );
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.true;

            await facets.institutionRegistry.connect(signers.owner).setWalletAffiliationStatus(
                signers.user1.address, AFFILIATION_SUSPENDED
            );
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.false;

            await facets.institutionRegistry.connect(signers.owner).setWalletAffiliationStatus(
                signers.user1.address, AFFILIATION_ACTIVE
            );
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.true;
        });

        it("Revoked wallet affiliation invalidates KYC", async function () {
            const { facets, signers } = await loadFixture(fixture);
            const { validated, expires } = await kycTimestamps();

            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address, validated, expires
            );

            const tx = await facets.institutionRegistry.connect(signers.owner).registerInstitution(
                "Test Bank", ethers.ZeroHash, "", signers.owner.address
            );
            const rc = await tx.wait();
            const institutionId = rc.logs
                .map((l) => { try { return facets.institutionRegistry.interface.parseLog(l); } catch (_) { return null; } })
                .find((p) => p && p.name === "InstitutionRegistered")?.args.id;

            await facets.institutionRegistry.connect(signers.owner).linkWalletToInstitution(
                signers.user1.address, institutionId
            );
            await facets.institutionRegistry.connect(signers.owner).setWalletAffiliationStatus(
                signers.user1.address, AFFILIATION_REVOKED
            );
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.false;
        });
    });

    describe("revokeKYC authorization and errors", function () {
        it("only CUSTODIAN_ROLE can revoke KYC", async function () {
            const { facets, signers } = await loadFixture(fixture);
            const { validated, expires } = await kycTimestamps();

            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address, validated, expires
            );

            await expect(
                facets.custodian.connect(signers.user2).revokeKYC(signers.user1.address, 1)
            ).to.be.revertedWithCustomError(facets.custodian, "UnauthorizedRole");
        });

        it("revokeKYC reverts when caller is not the wallet's custodian-of-record", async function () {
            const { facets, signers } = await loadFixture(fixture);
            // user2 has no custody record, so custodian1 is not its custodian-of-record.
            await expect(
                facets.custodian.connect(signers.custodian1).revokeKYC(signers.user2.address, 1)
            ).to.be.revertedWithCustomError(facets.custodian, "CallerNotRegisteredCustodian");
        });
    });

    describe("recovery-aware effective KYC (effectiveKycStatus)", function () {
        it("RulesEngine evaluates the recovery successor's KYC, not the old wallet's", async function () {
            const { facets, signers } = await loadFixture(fixture);
            const { validated, expires } = await kycTimestamps();

            // oldWallet is an existing custodian but has no KYC record
            const oldWallet = signers.custodian1;

            // Set up a valid successor wallet: registry + role + KYC
            const successor = signers.user3;
            await facets.custodian.connect(signers.owner).grantCustodianRole(successor.address);
            await facets.custodian.connect(successor).registerCustodiedWallet(
                successor.address, validated, expires
            );

            // A separate recipient with valid KYC so we only measure sender resolution
            const recipient = signers.user2;
            await facets.custodian.connect(signers.custodian2).registerCustodiedWallet(
                recipient.address, validated, expires
            );

            // Configure rules to flag missing sender KYC
            const scopeNetwork = await facets.rulesConfig.scopeKeyForNetwork();
            await facets.rulesConfig.connect(signers.owner).setObservationMode(true, 400, 800);
            const RuleSet = {
                enabledBits: 0,
                warnThreshold: 400,
                blockThreshold: 800,
                velocityWindowSecs: 0,
                maxAmount: 0,
                maxOutflowAmount: 0,
                maxPerRecipientDaily: 0,
                maxEvalCount: 10,
                restrictContracts: false,
                extendCommitOnWarn: false,
                warnExtendSeconds: 0,
                requireKyc: true,
                kycAmountThreshold: 0,
                kycSoonSeconds: 0,
                createdAt: 0,
                effectiveFrom: 0
            };
            await facets.rulesConfig.connect(signers.owner).setRuleSet(scopeNetwork, RuleSet);
            await facets.rulesConfig.connect(signers.owner).setRuleWeight(scopeNetwork, 10, 900); // RULE_KYC_SENDER_MISSING

            // Before recovery mapping: old wallet has no KYC -> sender missing hit
            const previewBefore = await facets.rulesEngine.evaluateRulesPreview(
                oldWallet.address, recipient.address, 0, "0x", [], []
            );
            expect(previewBefore.hits.map(Number)).to.include(10);

            // Initiate recovery and designate the KYC-valid successor
            const recoveryId = await facets.walletRecovery.connect(signers.owner).initiateRecovery.staticCall(
                oldWallet.address, 0 // LostKey
            );
            await facets.walletRecovery.connect(signers.owner).initiateRecovery(oldWallet.address, 0);
            await facets.walletRecovery.connect(signers.owner).designateSuccessor(recoveryId, successor.address);

            // After recovery mapping: sender KYC resolves via successor -> no sender missing hit
            const previewAfter = await facets.rulesEngine.evaluateRulesPreview(
                oldWallet.address, recipient.address, 0, "0x", [], []
            );
            expect(previewAfter.hits.map(Number)).to.not.include(10);
        });
    });
});
