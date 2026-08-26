const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");
const { setupTestBalances } = require("../helpers/tokens");

describe("T3TokenPrefundedFeesFacet", function () {
    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        await setupTestBalances(deployment.facets, deployment.signers);

        // Helper deployment object does not expose this facet directly.
        const prefunded = await ethers.getContractAt("T3TokenPrefundedFeesFacet", deployment.diamondAddress);
        return { ...deployment, prefunded };
    }

    it("moves tokens to treasury on prefund and returns them on withdraw", async function () {
        const { facets, signers, prefunded } = await loadFixture(setupFixture);

        const prefundAmount = ethers.parseEther("10");
        const withdrawAmount = ethers.parseEther("4");

        const userBefore = await facets.erc20.balanceOf(signers.user1.address);
        const treasuryBefore = await facets.erc20.balanceOf(signers.treasury.address);

        // Prefunding should transfer tokens from user -> treasury and credit prefunded balance.
        await expect(prefunded.connect(signers.user1).prefundFees(prefundAmount))
            .to.emit(prefunded, "FeePrefunded")
            .withArgs(signers.user1.address, prefundAmount);

        expect(await prefunded.getPrefundedFeeBalance(signers.user1.address)).to.equal(prefundAmount);
        expect(await facets.erc20.balanceOf(signers.user1.address)).to.equal(userBefore - prefundAmount);
        expect(await facets.erc20.balanceOf(signers.treasury.address)).to.equal(treasuryBefore + prefundAmount);

        // Withdrawal should consume the prefunded credit and transfer treasury -> user.
        await expect(prefunded.connect(signers.user1).withdrawPrefundedFees(withdrawAmount))
            .to.emit(prefunded, "PrefundedFeeWithdrawn")
            .withArgs(signers.user1.address, withdrawAmount);

        expect(await prefunded.getPrefundedFeeBalance(signers.user1.address)).to.equal(prefundAmount - withdrawAmount);
        expect(await facets.erc20.balanceOf(signers.user1.address)).to.equal(userBefore - prefundAmount + withdrawAmount);
    });

    it("rejects zero prefund amounts", async function () {
        const { signers, prefunded } = await loadFixture(setupFixture);

        await expect(prefunded.connect(signers.user1).prefundFees(0))
            .to.be.revertedWithCustomError(prefunded, "PrefundAmountPositive");
    });

    it("rejects zero or excessive withdrawals", async function () {
        const { signers, prefunded } = await loadFixture(setupFixture);

        await expect(prefunded.connect(signers.user1).withdrawPrefundedFees(0))
            .to.be.revertedWithCustomError(prefunded, "WithdrawAmountPositive");

        await expect(prefunded.connect(signers.user1).withdrawPrefundedFees(1))
            .to.be.revertedWithCustomError(prefunded, "InsufficientPrefundedBalance");
    });

    it("rejects zero-address balance queries", async function () {
        const { prefunded } = await loadFixture(setupFixture);

        await expect(prefunded.getPrefundedFeeBalance(ethers.ZeroAddress))
            .to.be.revertedWithCustomError(prefunded, "UserAddressZero");
    });
});
