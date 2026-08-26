const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

describe("BankDepositTokenFacet", function () {
    async function setupFixture() {
        // Reuse the full diamond fixture so role checks and shared storage are realistic.
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        return deployment;
    }

    it("allows deposit controller to increase and decrease ledger balances", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        const bank = signers.user1.address;

        await expect(
            facets.bankDepositToken.connect(signers.minter).adjustDepositBalance(bank, 100n)
        )
            .to.emit(facets.bankDepositToken, "DepositLedgerAdjusted")
            .withArgs(bank, 100n, 100n);

        // Negative delta paths exercise the collateral-protection branch.
        await expect(
            facets.bankDepositToken.connect(signers.minter).adjustDepositBalance(bank, -40n)
        )
            .to.emit(facets.bankDepositToken, "DepositLedgerAdjusted")
            .withArgs(bank, -40n, 60n);

        const account = await facets.bankDepositToken.getDepositAccount(bank);
        expect(account.totalDeposits).to.equal(60n);
    });

    it("rejects adjust calls from non-deposit-controller addresses", async function () {
        const { facets, signers } = await loadFixture(setupFixture);

        await expect(
            facets.bankDepositToken.connect(signers.user1).adjustDepositBalance(signers.user1.address, 1n)
        )
            .to.be.revertedWithCustomError(facets.bankDepositToken, "UnauthorizedRole")
            .withArgs(signers.user1.address, ROLES.DEPOSIT_TOKEN_ISSUER_ROLE);
    });

    it("prevents ledger underflow on negative balance adjustments", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        const bank = signers.user1.address;

        await facets.bankDepositToken.connect(signers.minter).adjustDepositBalance(bank, 10n);

        await expect(
            facets.bankDepositToken.connect(signers.minter).adjustDepositBalance(bank, -11n)
        ).to.be.revertedWith("ledger underflow");
    });

    it("enforces collateral floor when reducing deposits below outstanding minted amount", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        const bank = signers.user1.address;

        await facets.bankDepositToken.connect(signers.minter).adjustDepositBalance(bank, 100n);
        // Outstanding minted = 90. Reducing deposits to 80 must fail collateral constraint.
        await facets.bankDepositToken.connect(signers.minter).recordMintBurn(bank, 90n, 0);

        await expect(
            facets.bankDepositToken.connect(signers.minter).adjustDepositBalance(bank, -20n)
        ).to.be.revertedWith("insufficient collateral");
    });

    it("tracks minted and burned totals per bank", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        const bank = signers.user2.address;

        await expect(
            facets.bankDepositToken.connect(signers.minter).recordMintBurn(bank, 250n, 40n)
        )
            .to.emit(facets.bankDepositToken, "DepositTokenStatsUpdated")
            .withArgs(bank, 250n, 40n);

        await facets.bankDepositToken.connect(signers.minter).recordMintBurn(bank, 10n, 5n);
        const account = await facets.bankDepositToken.getDepositAccount(bank);

        expect(account.totalMinted).to.equal(260n);
        expect(account.totalBurned).to.equal(45n);
    });

    it("rejects adjustDepositBalance for a bank wallet in recovery (H-02 quarantine)", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        // custodian1 has CUSTODIAN_ROLE and admin has ADMIN_ROLE — prerequisites for non-KeyRotation recovery
        await facets.walletRecovery.connect(signers.admin).initiateRecovery(signers.custodian1.address, 0);

        await expect(
            facets.bankDepositToken.connect(signers.minter).adjustDepositBalance(signers.custodian1.address, 100n)
        ).to.be.revertedWithCustomError(facets.bankDepositToken, "WalletInRecovery")
         .withArgs(signers.custodian1.address);
    });

    it("rejects recordMintBurn for a bank wallet in recovery (H-02 quarantine)", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        await facets.walletRecovery.connect(signers.admin).initiateRecovery(signers.custodian1.address, 0);

        await expect(
            facets.bankDepositToken.connect(signers.minter).recordMintBurn(signers.custodian1.address, 100n, 0n)
        ).to.be.revertedWithCustomError(facets.bankDepositToken, "WalletInRecovery")
         .withArgs(signers.custodian1.address);
    });
});
