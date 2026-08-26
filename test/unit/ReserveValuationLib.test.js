const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ReserveValuationLib", function () {
    let harness;

    beforeEach(async function () {
        const Harness = await ethers.getContractFactory("ReserveValuationHarness");
        harness = await Harness.deploy();
        await harness.waitForDeployment();
    });

    // =========================================================================
    // eligibleValue — canonical formula from plan
    // =========================================================================
    describe("eligibleValue", function () {

        it("applies price, collateral factor, and haircut (canonical plan test)", async function () {
            // 100 USDC (6 decimals) at $1.00, 90% collateral factor, 5% haircut
            // eligible = 100 * $1 * 0.90 * (1 - 0.05) = $85.50
            expect(await harness.eligibleValue(
                ethers.parseUnits("100", 6),
                6,
                ethers.parseUnits("1", 18),
                9000,
                500
            )).to.equal(ethers.parseUnits("85.5", 18));
        });

        it("zero haircut: full collateral factor applied", async function () {
            // 100 USDC at $1, 100% factor, 0% haircut = $100
            expect(await harness.eligibleValue(
                ethers.parseUnits("100", 6),
                6,
                ethers.parseUnits("1", 18),
                10000,
                0
            )).to.equal(ethers.parseUnits("100", 18));
        });

        it("full haircut: eligible value is zero", async function () {
            expect(await harness.eligibleValue(
                ethers.parseUnits("100", 6),
                6,
                ethers.parseUnits("1", 18),
                10000,
                10000
            )).to.equal(0n);
        });

        it("handles 18-decimal reserve asset without normalization error", async function () {
            // 1 ETH at $3000, 80% factor, 10% haircut = $3000 * 0.80 * 0.90 = $2160
            expect(await harness.eligibleValue(
                ethers.parseUnits("1", 18),
                18,
                ethers.parseUnits("3000", 18),
                8000,
                1000
            )).to.equal(ethers.parseUnits("2160", 18));
        });

        it("price below $1 scales correctly", async function () {
            // 1000 units (6 dec) at $0.50, 100% factor, 0% haircut = $500
            expect(await harness.eligibleValue(
                ethers.parseUnits("1000", 6),
                6,
                ethers.parseUnits("0.5", 18),
                10000,
                0
            )).to.equal(ethers.parseUnits("500", 18));
        });

        it("zero quantity returns zero", async function () {
            expect(await harness.eligibleValue(
                0n, 6, ethers.parseUnits("1", 18), 9000, 500
            )).to.equal(0n);
        });

        it("zero price returns zero", async function () {
            expect(await harness.eligibleValue(
                ethers.parseUnits("100", 6), 6, 0n, 9000, 500
            )).to.equal(0n);
        });
    });

    // =========================================================================
    // effectiveValue — encumbrance reduces available quantity
    // =========================================================================
    describe("effectiveValue", function () {

        it("encumbered quantity reduces eligible value", async function () {
            // 100 settled, 20 encumbered → 80 effective USDC at $1, 90% factor, 5% haircut
            // effective = 80 * 1 * 0.90 * 0.95 = 68.4
            expect(await harness.effectiveValue(
                ethers.parseUnits("100", 6),
                ethers.parseUnits("20",  6),
                6,
                ethers.parseUnits("1", 18),
                9000,
                500
            )).to.equal(ethers.parseUnits("68.4", 18));
        });

        it("fully encumbered returns zero", async function () {
            const q = ethers.parseUnits("50", 6);
            expect(await harness.effectiveValue(
                q, q, 6, ethers.parseUnits("1", 18), 9000, 500
            )).to.equal(0n);
        });

        it("over-encumbered saturates to zero without underflow", async function () {
            expect(await harness.effectiveValue(
                ethers.parseUnits("50", 6),
                ethers.parseUnits("60", 6),
                6,
                ethers.parseUnits("1", 18),
                9000, 500
            )).to.equal(0n);
        });

        it("zero encumbered is equivalent to eligibleValue", async function () {
            const q = ethers.parseUnits("100", 6);
            const p = ethers.parseUnits("1", 18);
            expect(await harness.effectiveValue(q, 0n, 6, p, 9000, 500))
                .to.equal(await harness.eligibleValue(q, 6, p, 9000, 500));
        });
    });

    // =========================================================================
    // Staleness guards
    // =========================================================================
    describe("staleness guards", function () {

        it("assertNotStalePrice passes when threshold is 0 (never stale)", async function () {
            await harness.setAssetPrice(1, ethers.parseUnits("1", 18), 0);
            await expect(harness.checkNotStalePrice(1)).not.to.be.reverted;
        });

        it("assertNotStalePrice passes for a fresh oracle update", async function () {
            await harness.setAssetPrice(1, ethers.parseUnits("1", 18), 3600); // 1-hour threshold
            await expect(harness.checkNotStalePrice(1)).not.to.be.reverted;
        });

        it("assertNotStalePrice reverts when price is stale", async function () {
            await harness.setAssetPrice(1, ethers.parseUnits("1", 18), 3600);
            await time.increase(3601);
            await expect(harness.checkNotStalePrice(1))
                .to.be.revertedWithCustomError(harness, "StalePrice");
        });

        it("assertNotStalePrice passes when updatedAt is 0 (unset oracle)", async function () {
            // assetPrice slot is zeroed by default → updatedAt == 0 → treated as never stale
            await expect(harness.checkNotStalePrice(99)).not.to.be.reverted;
        });

        it("assertNotStaleSettlement passes when threshold is 0", async function () {
            await expect(harness.checkNotStaleSettlement(1000, 0)).not.to.be.reverted;
        });

        it("assertNotStaleSettlement passes when settledAt is 0", async function () {
            await expect(harness.checkNotStaleSettlement(0, 3600)).not.to.be.reverted;
        });

        it("assertNotStaleSettlement reverts when settlement is stale", async function () {
            const latest = await time.latest();
            await time.increase(7201);
            await expect(harness.checkNotStaleSettlement(latest, 3600))
                .to.be.revertedWithCustomError(harness, "StaleSettlement");
        });
    });
});
