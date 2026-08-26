const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES, grantRole } = require("../helpers/roles");

describe("T3TokenInterbankLiabilityFacet Unit Tests", function () {
    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        const interbank = await ethers.getContractAt(
            "T3TokenInterbankLiabilityFacet",
            deployment.diamondAddress
        );

        // Ensure admin has ADMIN_ROLE for liability management
        await grantRole(
            deployment.facets.accessControl,
            ROLES.ADMIN_ROLE,
            deployment.signers.admin.address,
            deployment.signers.owner
        );

        return { ...deployment, interbank };
    }

    it("records and clears interbank liabilities", async function () {
        const { interbank, signers } = await loadFixture(setupFixture);
        const amount = ethers.parseEther("100");

        await expect(
            interbank
                .connect(signers.admin)
                .recordInterbankLiability(signers.user1.address, signers.user2.address, amount)
        )
            .to.emit(interbank, "InterbankLiabilityRecorded")
            .withArgs(signers.user1.address, signers.user2.address, amount);

        expect(
            await interbank.getInterbankLiability(signers.user1.address, signers.user2.address)
        ).to.equal(amount);
        expect(
            await interbank.getNetInterbankLiability(signers.user1.address, signers.user2.address)
        ).to.equal(amount);

        const clearAmount = ethers.parseEther("40");
        await expect(
            interbank
                .connect(signers.admin)
                .clearInterbankLiability(signers.user1.address, signers.user2.address, clearAmount)
        )
            .to.emit(interbank, "InterbankLiabilityCleared")
            .withArgs(signers.user1.address, signers.user2.address, clearAmount);

        expect(
            await interbank.getInterbankLiability(signers.user1.address, signers.user2.address)
        ).to.equal(amount - clearAmount);
        expect(
            await interbank.getNetInterbankLiability(signers.user1.address, signers.user2.address)
        ).to.equal(amount - clearAmount);
    });

    it("rejects non-admin callers and invalid inputs", async function () {
        const { interbank, signers } = await loadFixture(setupFixture);
        const amount = ethers.parseEther("10");

        await expect(
            interbank
                .connect(signers.user1)
                .recordInterbankLiability(signers.user1.address, signers.user2.address, amount)
        ).to.be.revertedWithCustomError(interbank, "UnauthorizedRole");

        await expect(
            interbank
                .connect(signers.admin)
                .recordInterbankLiability(ethers.ZeroAddress, signers.user2.address, amount)
        ).to.be.revertedWithCustomError(interbank, "DebtorCannotBeZeroAddress");

        await expect(
            interbank
                .connect(signers.admin)
                .recordInterbankLiability(signers.user1.address, ethers.ZeroAddress, amount)
        ).to.be.revertedWithCustomError(interbank, "CreditorCannotBeZeroAddress");

        await expect(
            interbank
                .connect(signers.admin)
                .recordInterbankLiability(signers.user1.address, signers.user1.address, amount)
        ).to.be.revertedWithCustomError(interbank, "DebtorCannotBeCreditor");

        await expect(
            interbank
                .connect(signers.admin)
                .recordInterbankLiability(signers.user1.address, signers.user2.address, 0)
        ).to.be.revertedWithCustomError(interbank, "AmountMustBePositive");

        await interbank
            .connect(signers.admin)
            .recordInterbankLiability(signers.user1.address, signers.user2.address, amount);

        await expect(
            interbank
                .connect(signers.admin)
                .clearInterbankLiability(signers.user1.address, signers.user2.address, amount + 1n)
        ).to.be.revertedWithCustomError(interbank, "AmountToClearExceedsOutstandingLiability");
    });

    describe("Quarantine: cannot record liability for wallet in recovery", function () {
        it("should block recordInterbankLiability when debtor is in recovery", async function () {
            const { interbank, signers, facets } = await loadFixture(setupFixture);
            const walletRecovery = facets.walletRecovery;
            if (!walletRecovery) {
                this.skip(); // walletRecovery not wired in this fixture
                return;
            }

            const amount = ethers.parseEther("100");

            // Put custodian1 in recovery (has CUSTODIAN_ROLE, required for recovery)
            await walletRecovery.connect(signers.admin).initiateRecovery(signers.custodian1.address, 0);

            await expect(
                interbank
                    .connect(signers.admin)
                    .recordInterbankLiability(signers.custodian1.address, signers.user2.address, amount)
            ).to.be.revertedWithCustomError(interbank, "WalletInRecovery");
        });

        it("should allow clearInterbankLiability for wallet in recovery", async function () {
            const { interbank, signers, facets } = await loadFixture(setupFixture);
            const walletRecovery = facets.walletRecovery;
            if (!walletRecovery) {
                this.skip();
                return;
            }

            const amount = ethers.parseEther("100");

            // Record liability first
            await interbank
                .connect(signers.admin)
                .recordInterbankLiability(signers.custodian1.address, signers.user2.address, amount);

            // Put custodian1 in recovery
            await walletRecovery.connect(signers.admin).initiateRecovery(signers.custodian1.address, 0);

            // clearInterbankLiability should still succeed (no quarantine guard)
            await expect(
                interbank
                    .connect(signers.admin)
                    .clearInterbankLiability(signers.custodian1.address, signers.user2.address, amount)
            ).to.not.be.reverted;
        });
    });
});
