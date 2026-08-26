const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");

describe("IssuanceControlFacet", function () {
    async function lockedFixture() {
        // Deploy without the default post-deploy unlock so the contract-level
        // fail-safe default (locked) is observable.
        const deployment = await deployT3DiamondFixture(true);
        await setupTestRoles(deployment.facets, deployment.signers);
        return deployment;
    }

    async function unlockedFixture() {
        const deployment = await deployT3DiamondFixture(false);
        await setupTestRoles(deployment.facets, deployment.signers);
        return deployment;
    }

    describe("default fail-safe state", function () {
        it("starts locked when the fixture does not unlock it", async function () {
            const { facets } = await loadFixture(lockedFixture);
            expect(await facets.issuanceControl.isLegacyMintUnlocked()).to.equal(false);
        });

        it("reverts generic mint() with LegacyMintLocked while locked", async function () {
            const { facets, signers } = await loadFixture(lockedFixture);
            await expect(
                facets.mintBurn.connect(signers.minter).mint(signers.user1.address, 100n)
            ).to.be.revertedWithCustomError(facets.mintBurn, "LegacyMintLocked");
        });

        it("reverts adjustDepositBalance with LegacyMintLocked while locked", async function () {
            const { facets, signers } = await loadFixture(lockedFixture);
            await expect(
                facets.bankDepositToken
                    .connect(signers.minter)
                    .adjustDepositBalance(signers.user1.address, 100n)
            ).to.be.revertedWithCustomError(facets.bankDepositToken, "LegacyMintLocked");
        });

        it("reverts adjustDepositBalance with negative delta with LegacyMintLocked while locked", async function () {
            const { facets, signers } = await loadFixture(lockedFixture);
            await expect(
                facets.bankDepositToken
                    .connect(signers.minter)
                    .adjustDepositBalance(signers.user1.address, -100n)
            ).to.be.revertedWithCustomError(facets.bankDepositToken, "LegacyMintLocked");
        });

        it("reverts recordMintBurn with LegacyMintLocked while locked", async function () {
            const { facets, signers } = await loadFixture(lockedFixture);
            await expect(
                facets.bankDepositToken
                    .connect(signers.minter)
                    .recordMintBurn(signers.user1.address, 10n, 0n)
            ).to.be.revertedWithCustomError(facets.bankDepositToken, "LegacyMintLocked");
        });

        it("reverts recordMintBurn with burned > 0 with LegacyMintLocked while locked", async function () {
            const { facets, signers } = await loadFixture(lockedFixture);
            await expect(
                facets.bankDepositToken
                    .connect(signers.minter)
                    .recordMintBurn(signers.user1.address, 0n, 10n)
            ).to.be.revertedWithCustomError(facets.bankDepositToken, "LegacyMintLocked");
        });
    });

    describe("admin gate", function () {
        it("emits LegacyMintUnlockedSet when the admin unlocks", async function () {
            const { facets, signers } = await loadFixture(lockedFixture);
            await expect(
                facets.issuanceControl.connect(signers.owner).setLegacyMintUnlocked(true)
            )
                .to.emit(facets.issuanceControl, "LegacyMintUnlockedSet")
                .withArgs(signers.owner.address, true);
            expect(await facets.issuanceControl.isLegacyMintUnlocked()).to.equal(true);
        });

        it("prevents non-admin from toggling the switch", async function () {
            const { facets, signers } = await loadFixture(lockedFixture);
            await expect(
                facets.issuanceControl.connect(signers.user1).setLegacyMintUnlocked(true)
            ).to.be.reverted;
        });
    });

    describe("unlocked behavior", function () {
        it("allows generic mint() after unlock", async function () {
            const { facets, signers } = await loadFixture(unlockedFixture);
            await expect(
                facets.mintBurn.connect(signers.minter).mint(signers.user1.address, 100n)
            ).to.not.be.reverted;
            expect(await facets.erc20.balanceOf(signers.user1.address)).to.equal(100n);
        });

        it("allows adjustDepositBalance and recordMintBurn after unlock", async function () {
            const { facets, signers } = await loadFixture(unlockedFixture);
            const bank = signers.user1.address;

            await expect(
                facets.bankDepositToken.connect(signers.minter).adjustDepositBalance(bank, 200n)
            )
                .to.emit(facets.bankDepositToken, "DepositLedgerAdjusted")
                .withArgs(bank, 200n, 200n);

            await expect(
                facets.bankDepositToken.connect(signers.minter).recordMintBurn(bank, 50n, 0n)
            )
                .to.emit(facets.bankDepositToken, "DepositTokenStatsUpdated")
                .withArgs(bank, 50n, 0n);

            const account = await facets.bankDepositToken.getDepositAccount(bank);
            expect(account.totalDeposits).to.equal(200n);
            expect(account.totalMinted).to.equal(50n);
        });
    });

    describe("canonical safe path is unaffected", function () {
        it("mintForConsortiumBank succeeds while legacy mint is locked", async function () {
            const { facets, signers } = await loadFixture(lockedFixture);
            const bank = signers.user2.address;

            // Temporarily unlock to seed the bank's deposit ledger.
            await facets.issuanceControl.connect(signers.owner).setLegacyMintUnlocked(true);

            await facets.consortiumMembership.connect(signers.owner).registerBank(
                bank,
                "Test Bank",
                signers.owner.address,
                ethers.parseEther("1000000")
            );
            await facets.bankDepositToken
                .connect(signers.minter)
                .adjustDepositBalance(bank, ethers.parseEther("10000"));

            // Re-lock to prove mintForConsortiumBank ignores the legacy kill-switch.
            await facets.issuanceControl.connect(signers.owner).setLegacyMintUnlocked(false);
            expect(await facets.issuanceControl.isLegacyMintUnlocked()).to.equal(false);

            const amount = ethers.parseEther("1000");
            await expect(
                facets.mintBurn
                    .connect(signers.minter)
                    .mintForConsortiumBank(bank, amount)
            )
                .to.emit(facets.mintBurn, "ConsortiumTokensMinted")
                .withArgs(bank, bank, amount);

            const account = await facets.bankDepositToken.getDepositAccount(bank);
            expect(account.totalMinted).to.equal(amount);
            expect(await facets.erc20.balanceOf(bank)).to.equal(amount);
        });

        it("re-locking restores LegacyMintLocked for all three gated paths", async function () {
            const { facets, signers } = await loadFixture(lockedFixture);

            // Unlock then re-lock to prove legacy paths are gated again.
            await facets.issuanceControl.connect(signers.owner).setLegacyMintUnlocked(true);
            await facets.issuanceControl.connect(signers.owner).setLegacyMintUnlocked(false);
            expect(await facets.issuanceControl.isLegacyMintUnlocked()).to.equal(false);

            await expect(
                facets.mintBurn.connect(signers.minter).mint(signers.user1.address, 100n)
            ).to.be.revertedWithCustomError(facets.mintBurn, "LegacyMintLocked");

            await expect(
                facets.bankDepositToken
                    .connect(signers.minter)
                    .adjustDepositBalance(signers.user1.address, 100n)
            ).to.be.revertedWithCustomError(facets.bankDepositToken, "LegacyMintLocked");

            await expect(
                facets.bankDepositToken
                    .connect(signers.minter)
                    .recordMintBurn(signers.user1.address, 10n, 0n)
            ).to.be.revertedWithCustomError(facets.bankDepositToken, "LegacyMintLocked");
        });
    });
});
