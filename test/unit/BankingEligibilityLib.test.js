const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * BankingEligibilityLib Unit Tests
 *
 * Tests the three eligibility-check functions exposed through
 * BankingEligibilityHarness:
 *   - requireEligibleWallet(address wallet)
 *   - requireRiskIncreasingInstitution(address institution)
 *   - requireRiskReducingInstitution(address institution)
 *
 * The harness exposes setter helpers so tests can directly configure
 * ConsortiumStorage.activeBanks, WalletRecoveryStorage.activeRecoveryCount,
 * and InstitutionLifecycleStorage.institutionMode without needing the full
 * diamond fixture.
 */
describe("BankingEligibilityLib", function () {
    let harness;
    let bank, wallet, other;

    // InstitutionMode enum values (must match InstitutionLifecycleStorage)
    const Mode = {
        ACTIVE:          0,
        ISSUANCE_PAUSED: 1,
        ORDERLY_EXIT:    2,
        DEFAULT:         3,
        RESOLVED:        4,
    };

    beforeEach(async function () {
        const Harness = await ethers.getContractFactory("BankingEligibilityHarness");
        harness = await Harness.deploy();
        await harness.waitForDeployment();

        const signers = await ethers.getSigners();
        bank   = signers[1].address;
        wallet = signers[2].address;
        other  = signers[3].address;
    });

    // =========================================================================
    // requireEligibleWallet
    // =========================================================================
    describe("requireEligibleWallet", function () {

        it("passes for active bank wallet with valid KYC, no recovery", async function () {
            // Register the wallet as an active bank and set no recovery
            await harness.setActiveBanks(wallet, true);
            // activeRecoveryCount defaults to 0 — no setup needed
            // callRequireEligibleWallet is a view function returning address; just call it
            const institutionId = await harness.callRequireEligibleWallet(wallet);
            expect(institutionId).to.equal(wallet);
        });

        it("non-bank wallet passes through with address(0) — affiliation check deferred to Wave 3B.2", async function () {
            // activeBanks[wallet] is false (default) → not a bank wallet → lib returns address(0)
            // No InstitutionInactive revert because affiliation lookup is not yet wired.
            // TODO Wave 3B.2: wire custodian affiliation so this correctly reverts InstitutionInactive.
            const institutionId = await harness.callRequireEligibleWallet(wallet);
            expect(institutionId).to.equal(ethers.ZeroAddress);
        });

        it("reverts for wallet in active recovery", async function () {
            // Set wallet as an active bank so we reach the recovery check
            // (recovery is checked FIRST in the lib, before bank lookup)
            await harness.setActiveRecoveryCount(wallet, 1);
            await expect(
                harness.callRequireEligibleWallet(wallet)
            ).to.be.revertedWithCustomError(harness, "WalletInRecovery")
              .withArgs(wallet);
        });

        it("ISSUANCE_PAUSED institution: requireEligibleWallet passes for wallet (receive side)", async function () {
            // DESIGN NOTE: requireEligibleWallet is checked on the beneficiary (receiving) side.
            // A wallet at a PAUSED institution can still RECEIVE T3 — the institution-mode
            // restriction only applies to the ISSUER side via requireRiskIncreasingInstitution.
            // Therefore, wallet mode does NOT affect requireEligibleWallet.
            await harness.setActiveBanks(wallet, true);
            await harness.setInstitutionMode(wallet, Mode.ISSUANCE_PAUSED);
            // No recovery → should return wallet address regardless of institution mode
            const institutionId = await harness.callRequireEligibleWallet(wallet);
            expect(institutionId).to.equal(wallet);
        });

        it("TODO Wave 3B.2 — expired KYC affiliation check deferred", async function () {
            // TODO: KYC expiry check to be wired in Wave 3B.2 when CustodianRegistryFacet
            // affiliation lookup is integrated into BankingEligibilityLib.
            // ConsortiumStorage does not yet have a per-wallet KYC expiry field.
            // When wired: requireEligibleWallet should revert with KYCExpired(wallet)
            // if the wallet's custodian affiliation has an expired KYC timestamp.
            this.skip();
        });
    });

    // =========================================================================
    // requireRiskIncreasingInstitution
    // =========================================================================
    describe("requireRiskIncreasingInstitution", function () {

        it("passes for ACTIVE institution", async function () {
            await harness.setActiveBanks(bank, true);
            // Mode defaults to ACTIVE (0) — no explicit set needed
            await expect(harness.callRequireRiskIncreasingInstitution(bank)).not.to.be.reverted;
        });

        it("reverts for ISSUANCE_PAUSED institution", async function () {
            await harness.setActiveBanks(bank, true);
            await harness.setInstitutionMode(bank, Mode.ISSUANCE_PAUSED);
            await expect(
                harness.callRequireRiskIncreasingInstitution(bank)
            ).to.be.revertedWithCustomError(harness, "InstitutionModeBlocksRiskIncrease")
              .withArgs(bank, Mode.ISSUANCE_PAUSED);
        });

        it("reverts for ORDERLY_EXIT institution", async function () {
            await harness.setActiveBanks(bank, true);
            await harness.setInstitutionMode(bank, Mode.ORDERLY_EXIT);
            await expect(
                harness.callRequireRiskIncreasingInstitution(bank)
            ).to.be.revertedWithCustomError(harness, "InstitutionModeBlocksRiskIncrease")
              .withArgs(bank, Mode.ORDERLY_EXIT);
        });

        it("reverts for DEFAULT institution", async function () {
            await harness.setActiveBanks(bank, true);
            await harness.setInstitutionMode(bank, Mode.DEFAULT);
            await expect(
                harness.callRequireRiskIncreasingInstitution(bank)
            ).to.be.revertedWithCustomError(harness, "InstitutionModeBlocksRiskIncrease")
              .withArgs(bank, Mode.DEFAULT);
        });

        it("reverts for RESOLVED institution", async function () {
            await harness.setActiveBanks(bank, true);
            await harness.setInstitutionMode(bank, Mode.RESOLVED);
            await expect(
                harness.callRequireRiskIncreasingInstitution(bank)
            ).to.be.revertedWithCustomError(harness, "InstitutionModeBlocksRiskIncrease")
              .withArgs(bank, Mode.RESOLVED);
        });

        it("reverts for inactive bank (activeBanks = false)", async function () {
            // activeBanks defaults to false — no setup needed
            await expect(
                harness.callRequireRiskIncreasingInstitution(bank)
            ).to.be.revertedWithCustomError(harness, "InstitutionInactive")
              .withArgs(bank);
        });

        it("reverts for institution in active wallet recovery", async function () {
            await harness.setActiveBanks(bank, true);
            await harness.setActiveRecoveryCount(bank, 1);
            await expect(
                harness.callRequireRiskIncreasingInstitution(bank)
            ).to.be.revertedWithCustomError(harness, "InstitutionInRecovery")
              .withArgs(bank);
        });

        it("DEFAULT institution: requireRiskIncreasingInstitution reverts", async function () {
            await harness.setActiveBanks(bank, true);
            await harness.setInstitutionMode(bank, Mode.DEFAULT);
            await expect(
                harness.callRequireRiskIncreasingInstitution(bank)
            ).to.be.revertedWithCustomError(harness, "InstitutionModeBlocksRiskIncrease");
        });
    });

    // =========================================================================
    // requireRiskReducingInstitution
    // =========================================================================
    describe("requireRiskReducingInstitution", function () {

        it("passes for ACTIVE institution", async function () {
            await harness.setActiveBanks(bank, true);
            await expect(harness.callRequireRiskReducingInstitution(bank)).not.to.be.reverted;
        });

        it("passes for ISSUANCE_PAUSED institution", async function () {
            await harness.setActiveBanks(bank, true);
            await harness.setInstitutionMode(bank, Mode.ISSUANCE_PAUSED);
            await expect(harness.callRequireRiskReducingInstitution(bank)).not.to.be.reverted;
        });

        it("passes for ORDERLY_EXIT institution", async function () {
            await harness.setActiveBanks(bank, true);
            await harness.setInstitutionMode(bank, Mode.ORDERLY_EXIT);
            await expect(harness.callRequireRiskReducingInstitution(bank)).not.to.be.reverted;
        });

        it("allows attributed burn for DEFAULT institution", async function () {
            // DEFAULT → risk-reducing ops (redemption, burns) must remain available
            await harness.setActiveBanks(bank, true);
            await harness.setInstitutionMode(bank, Mode.DEFAULT);
            await expect(harness.callRequireRiskReducingInstitution(bank)).not.to.be.reverted;
        });

        it("DEFAULT institution: requireRiskReducingInstitution passes (burn/redemption allowed)", async function () {
            // Canonical plan Step 4: verify DEFAULT explicitly allows redemption path
            await harness.setActiveBanks(bank, true);
            await harness.setInstitutionMode(bank, Mode.DEFAULT);
            await expect(harness.callRequireRiskReducingInstitution(bank)).not.to.be.reverted;
        });

        it("reverts for RESOLVED institution", async function () {
            await harness.setActiveBanks(bank, true);
            await harness.setInstitutionMode(bank, Mode.RESOLVED);
            await expect(
                harness.callRequireRiskReducingInstitution(bank)
            ).to.be.revertedWithCustomError(harness, "InstitutionModeBlocksAllOps")
              .withArgs(bank, Mode.RESOLVED);
        });

        it("reverts for inactive bank (activeBanks = false) even for risk-reducing ops", async function () {
            // Data integrity: inactive bank is a hard stop for all ops
            await expect(
                harness.callRequireRiskReducingInstitution(bank)
            ).to.be.revertedWithCustomError(harness, "InstitutionInactive")
              .withArgs(bank);
        });
    });
});
