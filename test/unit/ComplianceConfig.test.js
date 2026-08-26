const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture, FacetCutAction } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

describe("ComplianceConfigFacet", function () {
    const KYC = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));
    const TRAVEL_RULE = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_enforce_active"));
    const CIP = ethers.keccak256(ethers.toUtf8Bytes("cip_enforce_active"));

    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        return deployment;
    }

    async function deployHarnessAndCut(diamondAddress, owner) {
        const Harness = await ethers.getContractFactory("ComplianceLibHarnessFacet");
        const harness = await Harness.deploy();
        await harness.waitForDeployment();

        const selectors = [];
        Harness.interface.forEachFunction((fn) => {
            selectors.push(fn.selector);
        });

        const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);
        await diamondCut.connect(owner).diamondCut(
            [{ facetAddress: await harness.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors }],
            ethers.ZeroAddress,
            "0x"
        );

        const attached = await ethers.getContractAt("ComplianceLibHarnessFacet", diamondAddress);
        return { harness, attached };
    }

    function kycData(future = true) {
        const validated = 1;
        const expires = future ? Math.floor(Date.now() / 1000) + 86400 : 0;
        return { validated, expires };
    }

    it("all compliance gates default to off", async function () {
        const { facets } = await loadFixture(setupFixture);

        expect(await facets.complianceConfig.isKycEnforceActive()).to.equal(false);
        expect(await facets.complianceConfig.isScreeningEnforceActive()).to.equal(false);
        expect(await facets.complianceConfig.isTravelRuleEnforceActive()).to.equal(false);
        expect(await facets.complianceConfig.isCipEnforceActive()).to.equal(false);
    });

    it("legacy bool setters are retired and revert Deprecated", async function () {
        const { facets, signers } = await loadFixture(setupFixture);

        const nonAdmin = signers.user1;
        const gateSetters = [
            () => facets.complianceConfig.connect(nonAdmin).setKycEnforceActive(true),
            () => facets.complianceConfig.connect(nonAdmin).setScreeningEnforceActive(true),
            () => facets.complianceConfig.connect(nonAdmin).setTravelRuleEnforceActive(true),
            () => facets.complianceConfig.connect(nonAdmin).setCipEnforceActive(true),
        ];

        for (const setter of gateSetters) {
            await expect(setter())
                .to.be.revertedWithCustomError(facets.complianceConfig, "UnauthorizedRole")
                .withArgs(nonAdmin.address, ROLES.DEFAULT_ADMIN_ROLE);
        }

        await expect(facets.complianceConfig.connect(signers.owner).setKycEnforceActive(true))
            .to.be.revertedWithCustomError(facets.complianceConfig, "Deprecated");
    });

    it("legacy getters read scoped network policy keys", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        const pol = facets.institutionPolicy;

        await pol.connect(signers.owner).setNetworkPolicy(KYC, 1);
        expect(await facets.complianceConfig.isKycEnforceActive()).to.equal(true);
        await pol.connect(signers.owner).setNetworkPolicy(KYC, 0);
        expect(await facets.complianceConfig.isKycEnforceActive()).to.equal(false);

        await pol.connect(signers.owner).setNetworkPolicy(TRAVEL_RULE, 1);
        expect(await facets.complianceConfig.isTravelRuleEnforceActive()).to.equal(true);
        await pol.connect(signers.owner).setNetworkPolicy(TRAVEL_RULE, 0);
        expect(await facets.complianceConfig.isTravelRuleEnforceActive()).to.equal(false);

        await pol.connect(signers.owner).setNetworkPolicy(CIP, 1);
        expect(await facets.complianceConfig.isCipEnforceActive()).to.equal(true);
        await pol.connect(signers.owner).setNetworkPolicy(CIP, 0);
        expect(await facets.complianceConfig.isCipEnforceActive()).to.equal(false);
    });

    it("ComplianceLib precheck is a no-op when all gates are off", async function () {
        const { facets, signers, diamondAddress } = await loadFixture(setupFixture);
        const { attached } = await deployHarnessAndCut(diamondAddress, signers.owner);

        await expect(
            attached.harnessPrecheck(signers.user1.address, signers.user2.address, 100, 0)
        ).not.to.be.reverted;
    });

    it("ComplianceLib WALLET_TRANSFER enforces KYC when kyc_enforce_active network policy is armed", async function () {
        const { facets, signers, diamondAddress } = await loadFixture(setupFixture);
        const { attached } = await deployHarnessAndCut(diamondAddress, signers.owner);

        const kyc = kycData();
        await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(signers.user1.address, kyc.validated, kyc.expires);
        await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(signers.user2.address, kyc.validated, kyc.expires);

        // With gate off, even wallets without KYC would pass — but here both are KYC'd.
        await expect(
            attached.harnessPrecheck(signers.user1.address, signers.user2.address, 100, 0)
        ).not.to.be.reverted;

        await facets.institutionPolicy.connect(signers.owner).setNetworkPolicy(KYC, 1);

        // Both KYC'd: still passes.
        await expect(
            attached.harnessPrecheck(signers.user1.address, signers.user2.address, 100, 0)
        ).not.to.be.reverted;

        // user3 has no KYC: should revert on the from party.
        await expect(
            attached.harnessPrecheck(signers.user3.address, signers.user2.address, 100, 0)
        )
            .to.be.revertedWithCustomError(attached, "ComplianceKycRequired")
            .withArgs(signers.user3.address, 0);

        await expect(
            attached.harnessPrecheck(signers.user1.address, signers.user3.address, 100, 0)
        )
            .to.be.revertedWithCustomError(attached, "ComplianceKycRequired")
            .withArgs(signers.user3.address, 0);
    });
});
