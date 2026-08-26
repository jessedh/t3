// test/integration/InstitutionDefaultFreeze.test.js
//
// Integration test for Wave 3B.2 — exercises InstitutionLifecycleFacet,
// InstitutionRegistryFacet, and CustodianRegistryFacet together.
//
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

const MODE = {
    ACTIVE: 0,
    ISSUANCE_PAUSED: 1,
    ORDERLY_EXIT: 2,
    DEFAULT: 3,
    RESOLVED: 4,
};

describe("InstitutionDefaultFreeze Integration Tests", function () {
    let deployment;
    // Shared across each test scenario
    let institutionId;

    async function setupFixture() {
        const dep = await deployT3DiamondFixture();
        await setupTestRoles(dep.facets, dep.signers);
        return dep;
    }

    beforeEach(async function () {
        deployment = await loadFixture(setupFixture);
    });

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function lc() { return deployment.facets.institutionLifecycle; }
    function ir() { return deployment.facets.institutionRegistry; }
    function cr() { return deployment.facets.custodian; }
    function cm() { return deployment.facets.consortiumMembership; }
    function ac() { return deployment.facets.accessControl; }

    /**
     * Register a bank in ConsortiumMembership, register an institution in
     * InstitutionRegistry, and create the bidirectional link via
     * InstitutionLifecycleFacet.
     *
     * Returns the institutionId.
     */
    async function setupBankAndInstitution(bankSigner, institutionAdminSigner) {
        const { signers } = deployment;

        // 1. Register bank in consortium
        await cm()
            .connect(signers.admin)
            .registerBank(
                bankSigner.address,
                "Integration Test Bank",
                bankSigner.address,
                ethers.parseEther("1")
            );

        // 2. Register institution in InstitutionRegistry (admin-only)
        const tx = await ir()
            .connect(signers.admin)
            .registerInstitution(
                "Integration Test Institution",
                ethers.keccak256(ethers.toUtf8Bytes("meta-integration")),
                "ipfs://integration/1",
                institutionAdminSigner.address
            );
        const receipt = await tx.wait();
        const event = receipt.logs
            .map((log) => {
                try { return ir().interface.parseLog(log); } catch { return null; }
            })
            .find((e) => e && e.name === "InstitutionRegistered");

        const instId = event.args.id;

        // 3. Link bank ↔ institution via lifecycle facet
        await lc()
            .connect(signers.admin)
            .linkBankToInstitution(bankSigner.address, instId);

        return instId;
    }

    // -----------------------------------------------------------------------
    // Scenario A: ACTIVE → DEFAULT freezes wallet linking and custodian registration
    // -----------------------------------------------------------------------

    describe("Scenario A: DEFAULT mode freezes operations", function () {
        it("linkBankToInstitution sets up bidirectional reference correctly", async function () {
            const { signers } = deployment;
            const instId = await setupBankAndInstitution(signers.user1, signers.user2);

            expect(await lc().resolveInstitutionBank(instId)).to.equal(signers.user1.address);
            expect(await lc().resolveBankInstitution(signers.user1.address)).to.equal(instId);
        });

        it("ACTIVE → DEFAULT: linkWalletToInstitution reverts InstitutionModeBlocksWalletLinking", async function () {
            const { signers } = deployment;
            const instId = await setupBankAndInstitution(signers.user1, signers.user2);

            // Advance mode to DEFAULT
            await lc().connect(signers.admin).setInstitutionMode(signers.user1.address, MODE.DEFAULT);

            // linkWalletToInstitution must be called by institution admin (user2) or global admin
            await expect(
                ir()
                    .connect(signers.admin)
                    .linkWalletToInstitution(signers.treasury.address, instId)
            ).to.be.revertedWithCustomError(ir(), "InstitutionModeBlocksWalletLinking")
                .withArgs(instId, MODE.DEFAULT);
        });

        it("ACTIVE → DEFAULT: registerCustodiedWallet by bank-as-custodian reverts InstitutionModeBlocksCustodianRegistration", async function () {
            const { signers } = deployment;

            // user3 is the bank; grant it CUSTODIAN_ROLE so it can call registerCustodiedWallet
            await ac()
                .connect(signers.owner)
                .grantRole(ROLES.CUSTODIAN_ROLE, signers.user3.address);

            // Advance mode to DEFAULT before linking institution (to test the custodian check independently)
            await lc().connect(signers.admin).setInstitutionMode(signers.user3.address, MODE.DEFAULT);

            await expect(
                cr()
                    .connect(signers.user3)
                    .registerCustodiedWallet(
                        signers.treasury.address,
                        Math.floor(Date.now() / 1000),
                        0
                    )
            ).to.be.revertedWithCustomError(cr(), "InstitutionModeBlocksCustodianRegistration")
                .withArgs(signers.user3.address, MODE.DEFAULT);
        });

        it("ACTIVE → DEFAULT → setBankActivation(false) succeeds", async function () {
            const { signers } = deployment;
            const instId = await setupBankAndInstitution(signers.user1, signers.user2);

            await lc().connect(signers.admin).setInstitutionMode(signers.user1.address, MODE.DEFAULT);

            await expect(
                cm()
                    .connect(signers.admin)
                    .setBankActivation(signers.user1.address, false)
            ).to.not.be.reverted;
        });
    });

    // -----------------------------------------------------------------------
    // Scenario B: ORDERLY_EXIT allows wallet linking (wind-down)
    // -----------------------------------------------------------------------

    describe("Scenario B: ORDERLY_EXIT allows wallet linking", function () {
        it("ACTIVE → ORDERLY_EXIT: linkWalletToInstitution succeeds", async function () {
            const { signers } = deployment;
            // institution admin = signers.user2 (can call linkWalletToInstitution)
            const instId = await setupBankAndInstitution(signers.user1, signers.user2);

            // Grant institution admin role so user2 can call linkWalletToInstitution
            await ac()
                .connect(signers.owner)
                .grantRole(ROLES.INSTITUTION_ADMIN_ROLE, signers.user2.address);

            await lc().connect(signers.admin).setInstitutionMode(signers.user1.address, MODE.ORDERLY_EXIT);

            // Should succeed — ORDERLY_EXIT allows wallet linking
            await expect(
                ir()
                    .connect(signers.user2)
                    .linkWalletToInstitution(signers.treasury.address, instId)
            ).to.not.be.reverted;
        });

        it("ORDERLY_EXIT → RESOLVED → setBankActivation(false) succeeds", async function () {
            const { signers } = deployment;
            const instId = await setupBankAndInstitution(signers.user1, signers.user2);

            await lc().connect(signers.admin).setInstitutionMode(signers.user1.address, MODE.ORDERLY_EXIT);
            await lc().connect(signers.admin).setInstitutionMode(signers.user1.address, MODE.RESOLVED);

            await expect(
                cm()
                    .connect(signers.admin)
                    .setBankActivation(signers.user1.address, false)
            ).to.not.be.reverted;
        });
    });

    // -----------------------------------------------------------------------
    // Scenario C: RESOLVED mode also freezes operations
    // -----------------------------------------------------------------------

    describe("Scenario C: RESOLVED mode freezes operations", function () {
        it("RESOLVED: registerCustodiedWallet reverts InstitutionModeBlocksCustodianRegistration", async function () {
            const { signers } = deployment;

            // Grant CUSTODIAN_ROLE to user3 (the bank)
            await ac()
                .connect(signers.owner)
                .grantRole(ROLES.CUSTODIAN_ROLE, signers.user3.address);

            // Advance to RESOLVED via ORDERLY_EXIT
            await lc().connect(signers.admin).setInstitutionMode(signers.user3.address, MODE.ORDERLY_EXIT);
            await lc().connect(signers.admin).setInstitutionMode(signers.user3.address, MODE.RESOLVED);

            await expect(
                cr()
                    .connect(signers.user3)
                    .registerCustodiedWallet(
                        signers.treasury.address,
                        Math.floor(Date.now() / 1000),
                        0
                    )
            ).to.be.revertedWithCustomError(cr(), "InstitutionModeBlocksCustodianRegistration")
                .withArgs(signers.user3.address, MODE.RESOLVED);
        });

        it("RESOLVED: linkWalletToInstitution reverts InstitutionModeBlocksWalletLinking", async function () {
            const { signers } = deployment;
            const instId = await setupBankAndInstitution(signers.user1, signers.user2);

            await lc().connect(signers.admin).setInstitutionMode(signers.user1.address, MODE.ORDERLY_EXIT);
            await lc().connect(signers.admin).setInstitutionMode(signers.user1.address, MODE.RESOLVED);

            await expect(
                ir()
                    .connect(signers.admin)
                    .linkWalletToInstitution(signers.treasury.address, instId)
            ).to.be.revertedWithCustomError(ir(), "InstitutionModeBlocksWalletLinking")
                .withArgs(instId, MODE.RESOLVED);
        });
    });

    // -----------------------------------------------------------------------
    // Scenario D: non-bank custodians are unaffected (backward compat)
    // -----------------------------------------------------------------------

    describe("Scenario D: non-bank custodians unaffected", function () {
        it("regular custodian (no lifecycle mode set) can registerCustodiedWallet", async function () {
            const { signers } = deployment;
            // custodian1 already has CUSTODIAN_ROLE from setupTestRoles
            // and has no lifecycle mode set → defaults to ACTIVE (0)
            await expect(
                cr()
                    .connect(signers.custodian1)
                    .registerCustodiedWallet(
                        signers.treasury.address,
                        Math.floor(Date.now() / 1000),
                        0
                    )
            ).to.not.be.reverted;
        });
    });
});
