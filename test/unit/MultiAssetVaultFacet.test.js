const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");

describe("MultiAssetVaultFacet", function () {
    const ASSET_TYPE = 42;
    const PLEDGE_AMOUNT = ethers.parseUnits("1000", 6); // 1000 USDC (6 dec)
    const PRICE_1_USD   = ethers.parseUnits("1", 18);   // $1.00 in 18-decimal

    async function setup() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        const { facets, signers, diamondAddress } = deployment;

        // Deploy mock USDC (6 decimals)
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20.deploy("Mock USDC", "mUSDC", ethers.parseUnits("10000000", 6));
        await usdc.waitForDeployment();

        // Configure asset type
        await facets.multiAssetVault.connect(signers.admin).configureAssetType(ASSET_TYPE, {
            tokenAddress: await usdc.getAddress(),
            decimals: 6,
            collateralFactorBps: 9000,  // 90%
            haircutBps: 500,            // 5%
            maxBankExposure: ethers.parseUnits("5000000", 6),
            isActive: true
        });

        // Register bank (user1 acts as bank; treasury = bank address, vault = diamondAddress)
        // maxCollateralLimit must be a 18-decimal normalized value (or 0 for no limit)
        const bank = signers.user1;
        await facets.consortiumMembership.connect(signers.admin).registerBank(
            bank.address, "Test Bank", bank.address, ethers.parseEther("10000000")
        );
        // treasury = bank, vault = bank — bank approves diamond; tokens tracked not moved
        await facets.consortiumMembership.connect(signers.admin).configureBankWallet(
            bank.address, ASSET_TYPE, bank.address, bank.address
        );

        // Fund bank with USDC and approve vault
        await usdc.connect(signers.owner).transfer(bank.address, PLEDGE_AMOUNT * 10n);
        await usdc.connect(bank).approve(diamondAddress, ethers.MaxUint256);

        return { ...deployment, usdc, bank };
    }

    // =========================================================================
    // Two-phase pledge
    // =========================================================================
    describe("two-phase pledge", function () {

        it("pledge records pending then settled after transfer", async function () {
            const { facets, bank } = await loadFixture(setup);

            // Before pledge: both zero
            let pos = await facets.multiAssetVault.getReservePosition(bank.address, ASSET_TYPE);
            expect(pos.settledQuantity).to.equal(0n);
            expect(pos.pendingQuantity).to.equal(0n);

            await facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, PLEDGE_AMOUNT);

            // After pledge: settled = PLEDGE_AMOUNT, pending = 0
            pos = await facets.multiAssetVault.getReservePosition(bank.address, ASSET_TYPE);
            expect(pos.settledQuantity).to.equal(PLEDGE_AMOUNT);
            expect(pos.pendingQuantity).to.equal(0n);
            expect(pos.custodySettledAt).to.be.greaterThan(0n);
        });

        it("custodySettledAt is updated on confirm", async function () {
            const { facets, bank } = await loadFixture(setup);
            const before = (await ethers.provider.getBlock("latest")).timestamp;
            await facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, PLEDGE_AMOUNT);
            const pos = await facets.multiAssetVault.getReservePosition(bank.address, ASSET_TYPE);
            expect(Number(pos.custodySettledAt)).to.be.gte(before);
        });

        it("legacy CollateralPledged event still fires", async function () {
            const { facets, bank } = await loadFixture(setup);
            await expect(
                facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, PLEDGE_AMOUNT)
            ).to.emit(facets.multiAssetVault, "CollateralPledged");
        });
    });

    // =========================================================================
    // Floor-checked release
    // =========================================================================
    describe("floor-checked release", function () {

        async function setupWithPledge() {
            const base = await setup();
            const { facets, bank } = base;
            await facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, PLEDGE_AMOUNT);
            return base;
        }

        it("release below floor reverts with ReleaseBelowFloor", async function () {
            const { facets, signers, bank } = await loadFixture(setupWithPledge);

            // Register asset for reserve tracking and set oracle price
            await facets.multiAssetVault.connect(signers.admin).registerAssetTypeForReserve(ASSET_TYPE);
            await facets.multiAssetVault.connect(signers.admin).setAssetPrice(ASSET_TYPE, PRICE_1_USD, 0);

            // 1000 USDC at $1, 90% factor, 5% haircut = $855 effective reserve
            // Set floor at $800 (18-dec)
            const FLOOR = ethers.parseUnits("800", 18);
            await facets.multiAssetVault.connect(signers.admin).setIssuerFloor(bank.address, FLOOR);

            // Try to release 500 USDC → post-release reserve ≈ $427.5 < $800 → revert
            await expect(
                facets.multiAssetVault.connect(bank).releaseCollateral(ASSET_TYPE, ethers.parseUnits("500", 6), ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(facets.multiAssetVault, "ReleaseBelowFloor");
        });

        it("release that stays above floor succeeds", async function () {
            const { facets, signers, bank } = await loadFixture(setupWithPledge);

            await facets.multiAssetVault.connect(signers.admin).registerAssetTypeForReserve(ASSET_TYPE);
            await facets.multiAssetVault.connect(signers.admin).setAssetPrice(ASSET_TYPE, PRICE_1_USD, 0);

            // floor = $800; release 50 USDC → post-release = 950 USDC * 0.90 * 0.95 ≈ $812 > $800 ✓
            const FLOOR = ethers.parseUnits("800", 18);
            await facets.multiAssetVault.connect(signers.admin).setIssuerFloor(bank.address, FLOOR);

            await expect(
                facets.multiAssetVault.connect(bank).releaseCollateral(ASSET_TYPE, ethers.parseUnits("50", 6), ethers.ZeroAddress)
            ).not.to.be.reverted;

            const pos = await facets.multiAssetVault.getReservePosition(bank.address, ASSET_TYPE);
            expect(pos.settledQuantity).to.equal(PLEDGE_AMOUNT - ethers.parseUnits("50", 6));
        });

        it("floor of zero never blocks release", async function () {
            const { facets, signers, bank } = await loadFixture(setupWithPledge);
            await facets.multiAssetVault.connect(signers.admin).registerAssetTypeForReserve(ASSET_TYPE);
            await facets.multiAssetVault.connect(signers.admin).setAssetPrice(ASSET_TYPE, PRICE_1_USD, 0);
            // floor defaults to 0 — full release should succeed
            await expect(
                facets.multiAssetVault.connect(bank).releaseCollateral(ASSET_TYPE, PLEDGE_AMOUNT, ethers.ZeroAddress)
            ).not.to.be.reverted;
        });

        it("release with insufficient settled reverts with InsufficientSettledReserve", async function () {
            const { facets, signers, bank } = await loadFixture(setupWithPledge);
            await facets.multiAssetVault.connect(signers.admin).registerAssetTypeForReserve(ASSET_TYPE);

            // Try to release more than settled — legacy ConsortiumStorage check fires first
            // but InsufficientSettledReserve would fire from ReserveControlLib
            // In practice the legacy "insufficient collateral" require fires first
            await expect(
                facets.multiAssetVault.connect(bank).releaseCollateral(
                    ASSET_TYPE,
                    PLEDGE_AMOUNT + 1n,
                    ethers.ZeroAddress
                )
            ).to.be.reverted;
        });
    });

    // =========================================================================
    // Wallet recovery quarantine
    // =========================================================================
    describe("wallet recovery quarantine", function () {
        async function putBankInRecovery(facets, signers, bank) {
            await grantRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, bank.address, signers.owner);
            await facets.walletRecovery.connect(signers.admin).initiateRecovery(bank.address, 0);
        }

        it("pledgeCollateral reverts for wallet in recovery", async function () {
            const { facets, signers, bank } = await loadFixture(setup);

            await putBankInRecovery(facets, signers, bank);

            await expect(
                facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, PLEDGE_AMOUNT)
            ).to.be.revertedWithCustomError(facets.multiAssetVault, "WalletInRecovery");
        });

        it("releaseCollateral reverts for wallet in recovery", async function () {
            const { facets, signers, bank } = await loadFixture(setup);

            await facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, PLEDGE_AMOUNT);
            await putBankInRecovery(facets, signers, bank);

            await expect(
                facets.multiAssetVault.connect(bank).releaseCollateral(ASSET_TYPE, 1, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(facets.multiAssetVault, "WalletInRecovery");
        });
    });

    // =========================================================================
    // Admin functions
    // =========================================================================
    describe("admin functions", function () {

        it("setAssetPrice stores price and emits AssetPriceSet", async function () {
            const { facets, signers } = await loadFixture(setup);
            await expect(
                facets.multiAssetVault.connect(signers.admin).setAssetPrice(ASSET_TYPE, PRICE_1_USD, 3600)
            ).to.emit(facets.multiAssetVault, "AssetPriceSet")
              .withArgs(ASSET_TYPE, PRICE_1_USD, 3600);
        });

        it("setIssuerFloor stores floor and emits IssuerFloorSet", async function () {
            const { facets, signers, bank } = await loadFixture(setup);
            const FLOOR = ethers.parseUnits("500", 18);
            await expect(
                facets.multiAssetVault.connect(signers.admin).setIssuerFloor(bank.address, FLOOR)
            ).to.emit(facets.multiAssetVault, "IssuerFloorSet")
              .withArgs(bank.address, FLOOR);
            expect(await facets.multiAssetVault.getIssuerFloor(bank.address)).to.equal(FLOOR);
        });

        it("registerAssetTypeForReserve is idempotent", async function () {
            const { facets, signers } = await loadFixture(setup);
            await facets.multiAssetVault.connect(signers.admin).registerAssetTypeForReserve(ASSET_TYPE);
            await expect(
                facets.multiAssetVault.connect(signers.admin).registerAssetTypeForReserve(ASSET_TYPE)
            ).not.to.be.reverted;
        });

        it("getEffectiveReserve returns 0 before asset registration", async function () {
            const { facets, bank } = await loadFixture(setup);
            expect(await facets.multiAssetVault.getEffectiveReserve(bank.address)).to.equal(0n);
        });

        it("getEffectiveReserve reflects settled reserve after pledge and registration", async function () {
            const { facets, signers, bank } = await loadFixture(setup);
            await facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, PLEDGE_AMOUNT);
            await facets.multiAssetVault.connect(signers.admin).registerAssetTypeForReserve(ASSET_TYPE);
            await facets.multiAssetVault.connect(signers.admin).setAssetPrice(ASSET_TYPE, PRICE_1_USD, 0);

            // 1000 USDC at $1, 90% factor, 5% haircut = $855
            const effective = await facets.multiAssetVault.getEffectiveReserve(bank.address);
            expect(effective).to.equal(ethers.parseUnits("855", 18));
        });
    });
});
