const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");

/**
 * ReserveFloorInvariant
 *
 * Security invariant: after any release, effectiveReserve(issuer) >= issuerFloor.
 *
 * All tests here use a registered asset type and a set oracle price so that
 * effectiveReserve() returns a meaningful value. Tests verify that floor-breaching
 * releases revert and compliant releases succeed.
 */
describe("ReserveFloorInvariant", function () {
    const ASSET_TYPE  = 77;
    const PRICE_1_USD = ethers.parseUnits("1", 18);

    // 1000 USDC (6 dec) pledged → effective = 1000 * $1 * 90% * 95% = $855
    const PLEDGE  = ethers.parseUnits("1000", 6);
    // Floor = $800: releasing more than 50 USDC would breach it
    const FLOOR   = ethers.parseUnits("800", 18);

    async function setup() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        const { facets, signers, diamondAddress } = deployment;

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const token = await MockERC20.deploy("Mock", "MCK", ethers.parseUnits("10000000", 6));
        await token.waitForDeployment();

        await facets.multiAssetVault.connect(signers.admin).configureAssetType(ASSET_TYPE, {
            tokenAddress: await token.getAddress(),
            decimals: 6,
            collateralFactorBps: 9000,
            haircutBps: 500,
            maxBankExposure: ethers.parseUnits("50000000", 6),
            isActive: true
        });

        const bank = signers.user1;
        await facets.consortiumMembership.connect(signers.admin).registerBank(
            bank.address, "Invariant Bank", bank.address, ethers.parseEther("10000000")
        );
        // treasury = bank, vault = bank — bank approves diamond; tokens tracked not moved
        await facets.consortiumMembership.connect(signers.admin).configureBankWallet(
            bank.address, ASSET_TYPE, bank.address, bank.address
        );

        await token.connect(signers.owner).transfer(bank.address, PLEDGE * 10n);
        await token.connect(bank).approve(diamondAddress, ethers.MaxUint256);

        // Pledge collateral
        await facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, PLEDGE);

        // Register asset and set oracle price so effectiveReserve() is non-zero
        await facets.multiAssetVault.connect(signers.admin).registerAssetTypeForReserve(ASSET_TYPE);
        await facets.multiAssetVault.connect(signers.admin).setAssetPrice(ASSET_TYPE, PRICE_1_USD, 0);

        // Set floor
        await facets.multiAssetVault.connect(signers.admin).setIssuerFloor(bank.address, FLOOR);

        return { ...deployment, token, bank };
    }

    it("release that breaches floor reverts with ReleaseBelowFloor", async function () {
        const { facets, bank } = await loadFixture(setup);
        // Releasing 500 USDC → post-release effective = 500 * $1 * 90% * 95% = $427.5 < $800
        await expect(
            facets.multiAssetVault.connect(bank).releaseCollateral(
                ASSET_TYPE, ethers.parseUnits("500", 6), ethers.ZeroAddress
            )
        ).to.be.revertedWithCustomError(facets.multiAssetVault, "ReleaseBelowFloor");
    });

    it("release that stays above floor succeeds", async function () {
        const { facets, bank } = await loadFixture(setup);
        // Releasing 50 USDC → post-release = 950 * $1 * 90% * 95% ≈ $812 > $800 ✓
        await expect(
            facets.multiAssetVault.connect(bank).releaseCollateral(
                ASSET_TYPE, ethers.parseUnits("50", 6), ethers.ZeroAddress
            )
        ).not.to.be.reverted;

        // Verify invariant holds
        const effective = await facets.multiAssetVault.getEffectiveReserve(bank.address);
        const floor = await facets.multiAssetVault.getIssuerFloor(bank.address);
        expect(effective).to.be.gte(floor);
    });

    it("floor at zero never blocks release", async function () {
        const { facets, signers, bank } = await loadFixture(setup);
        // Override floor to 0
        await facets.multiAssetVault.connect(signers.admin).setIssuerFloor(bank.address, 0n);
        // Full release should succeed
        await expect(
            facets.multiAssetVault.connect(bank).releaseCollateral(
                ASSET_TYPE, PLEDGE, ethers.ZeroAddress
            )
        ).not.to.be.reverted;
    });

    it("invariant holds after multiple sequential releases within floor", async function () {
        const { facets, bank } = await loadFixture(setup);
        // Release 20 USDC three times: each release stays above $800
        for (let i = 0; i < 3; i++) {
            await facets.multiAssetVault.connect(bank).releaseCollateral(
                ASSET_TYPE, ethers.parseUnits("20", 6), ethers.ZeroAddress
            );
            const effective = await facets.multiAssetVault.getEffectiveReserve(bank.address);
            const floor = await facets.multiAssetVault.getIssuerFloor(bank.address);
            expect(effective).to.be.gte(floor);
        }
    });

    it("fourth release in sequence that would breach floor reverts", async function () {
        const { facets, bank } = await loadFixture(setup);
        // Three releases of 20 USDC = 60 total (remaining 940 USDC → $808 > $800 ✓)
        for (let i = 0; i < 3; i++) {
            await facets.multiAssetVault.connect(bank).releaseCollateral(
                ASSET_TYPE, ethers.parseUnits("20", 6), ethers.ZeroAddress
            );
        }
        // Now try to release enough to breach: 940 * 90% * 95% = $803 after 3 × 20.
        // Releasing another 20 → 920 * 0.9 * 0.95 = $787.8 < $800 → should revert
        await expect(
            facets.multiAssetVault.connect(bank).releaseCollateral(
                ASSET_TYPE, ethers.parseUnits("20", 6), ethers.ZeroAddress
            )
        ).to.be.revertedWithCustomError(facets.multiAssetVault, "ReleaseBelowFloor");
    });
});
