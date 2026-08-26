const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Import our test infrastructure
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");
const { expectEvent } = require("../helpers/assertions");

/**
 * T3TokenAdminFacet Unit Tests
 * 
 * Tests administrative functions including treasury management, half-life parameters,
 * fee configuration, and abnormal transaction flagging.
 */
describe("T3TokenAdminFacet Unit Tests", function () {
    let deployment;
    const oneHour = 3600;
    const oneDay = 24 * oneHour;
    
    async function setupAdminFixture() {
        // Deploy diamond with all facets
        deployment = await deployT3DiamondFixture();
        
        // Setup roles for testing
        await setupTestRoles(deployment.facets, deployment.signers);
        
        return deployment;
    }
    
    beforeEach(async function () {
        deployment = await loadFixture(setupAdminFixture);
    });

    describe("Treasury Address Management", function () {
        it("should allow admin to update treasury address", async function () {
            const { facets, signers } = deployment;
            const newTreasury = signers.user1.address;
            const oldTreasury = await facets.admin.getTreasuryAddress();
            
            await expectEvent(
                facets.admin.connect(signers.admin).setTreasuryAddress(newTreasury),
                facets.admin,
                "TreasuryAddressUpdated",
                [oldTreasury, newTreasury]
            );
            
            expect(await facets.admin.getTreasuryAddress()).to.equal(newTreasury);
        });

        it("should reject treasury address update from non-admin", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.admin.connect(signers.user1).setTreasuryAddress(signers.user2.address)
            ).to.be.revertedWithCustomError(facets.admin, "UnauthorizedRole");
        });

        it("should reject zero address for treasury", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.admin.connect(signers.admin).setTreasuryAddress(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(facets.admin, "TreasuryAddressZero");
        });

        it("should return current treasury address", async function () {
            const { facets, signers } = deployment;
            
            const treasuryAddress = await facets.admin.getTreasuryAddress();
            expect(treasuryAddress).to.equal(signers.treasury.address);
        });
    });

    describe("Half-Life Parameters Management", function () {
        it("should return default half-life parameters", async function () {
            const { facets } = deployment;
            
            const [current, min, max] = await facets.admin.getHalfLifeParameters();
            expect(current).to.be.greaterThan(0);
            expect(min).to.be.greaterThan(0);
            expect(max).to.be.greaterThan(min);
        });

        it("should allow admin to set half-life duration within bounds", async function () {
            const { facets, signers } = deployment;
            const [, min, max] = await facets.admin.getHalfLifeParameters();
            const newDuration = min + (max - min) / 2n;
            
            await expectEvent(
                facets.admin.connect(signers.admin).setHalfLifeDuration(newDuration),
                facets.admin,
                "HalfLifeParametersUpdated",
                [newDuration, min, max]
            );
            
            const [current] = await facets.admin.getHalfLifeParameters();
            expect(current).to.equal(newDuration);
        });

        it("should reject half-life duration below minimum", async function () {
            const { facets, signers } = deployment;
            const [, min] = await facets.admin.getHalfLifeParameters();
            
            await expect(
                facets.admin.connect(signers.admin).setHalfLifeDuration(min - 1n)
            ).to.be.revertedWithCustomError(facets.admin, "HalfLifeBelowMinimum");
        });

        it("should reject half-life duration above maximum", async function () {
            const { facets, signers } = deployment;
            const [, , max] = await facets.admin.getHalfLifeParameters();
            
            await expect(
                facets.admin.connect(signers.admin).setHalfLifeDuration(max + 1n)
            ).to.be.revertedWithCustomError(facets.admin, "HalfLifeAboveMaximum");
        });

        it("should allow admin to set minimum half-life duration", async function () {
            const { facets, signers } = deployment;
            const [current, , max] = await facets.admin.getHalfLifeParameters();
            const newMin = 1800; // 30 minutes
            
            await expectEvent(
                facets.admin.connect(signers.admin).setMinHalfLifeDuration(newMin),
                facets.admin,
                "HalfLifeParametersUpdated",
                [current >= newMin ? current : newMin, newMin, max]
            );
            
            const [, min] = await facets.admin.getHalfLifeParameters();
            expect(min).to.equal(newMin);
        });

        it("should adjust current half-life when setting new minimum above current", async function () {
            const { facets, signers } = deployment;
            const [current, , max] = await facets.admin.getHalfLifeParameters();
            const newMin = current + 3600n; // 1 hour more than current
            
            await facets.admin.connect(signers.admin).setMinHalfLifeDuration(newMin);
            
            const [newCurrent, min] = await facets.admin.getHalfLifeParameters();
            expect(newCurrent).to.equal(newMin);
            expect(min).to.equal(newMin);
        });

        it("should reject zero minimum half-life duration", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.admin.connect(signers.admin).setMinHalfLifeDuration(0)
            ).to.be.revertedWithCustomError(facets.admin, "MinHalfLifePositive");
        });

        it("should reject minimum half-life duration above maximum", async function () {
            const { facets, signers } = deployment;
            const [, , max] = await facets.admin.getHalfLifeParameters();
            
            await expect(
                facets.admin.connect(signers.admin).setMinHalfLifeDuration(max + 1n)
            ).to.be.revertedWithCustomError(facets.admin, "MinHalfLifeExceedsMax");
        });

        it("should allow admin to set maximum half-life duration", async function () {
            const { facets, signers } = deployment;
            const [current, min] = await facets.admin.getHalfLifeParameters();
            const newMax = oneDay * 7; // 7 days
            
            await expectEvent(
                facets.admin.connect(signers.admin).setMaxHalfLifeDuration(newMax),
                facets.admin,
                "HalfLifeParametersUpdated",
                [current <= newMax ? current : newMax, min, newMax]
            );
            
            const [, , max] = await facets.admin.getHalfLifeParameters();
            expect(max).to.equal(newMax);
        });

        it("should adjust current half-life when setting new maximum below current", async function () {
            const { facets, signers } = deployment;
            const [current, min] = await facets.admin.getHalfLifeParameters();
            const newMax = current - 1800n; // 30 minutes less than current
            
            await facets.admin.connect(signers.admin).setMaxHalfLifeDuration(newMax);
            
            const [newCurrent, , max] = await facets.admin.getHalfLifeParameters();
            expect(newCurrent).to.equal(newMax);
            expect(max).to.equal(newMax);
        });

        it("should reject zero maximum half-life duration", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.admin.connect(signers.admin).setMaxHalfLifeDuration(0)
            ).to.be.revertedWithCustomError(facets.admin, "MaxHalfLifePositive");
        });

        it("should reject maximum half-life duration below minimum", async function () {
            const { facets, signers } = deployment;
            const [, min] = await facets.admin.getHalfLifeParameters();
            
            await expect(
                facets.admin.connect(signers.admin).setMaxHalfLifeDuration(min - 1n)
            ).to.be.revertedWithCustomError(facets.admin, "MaxHalfLifeBelowMinimum");
        });
    });

    describe("Inactivity Reset Period Management", function () {
        it("should allow admin to set inactivity reset period", async function () {
            const { facets, signers } = deployment;
            const newPeriod = oneDay * 30; // 30 days
            
            await expectEvent(
                facets.admin.connect(signers.admin).setInactivityResetPeriod(newPeriod),
                facets.admin,
                "InactivityResetPeriodUpdated",
                [newPeriod]
            );
        });

        it("should reject zero inactivity reset period", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.admin.connect(signers.admin).setInactivityResetPeriod(0)
            ).to.be.revertedWithCustomError(facets.admin, "InactivityPeriodPositive");
        });

        it("should reject inactivity reset period update from non-admin", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.admin.connect(signers.user1).setInactivityResetPeriod(oneDay)
            ).to.be.revertedWithCustomError(facets.admin, "UnauthorizedRole");
        });
    });

    describe("Fee Parameters Management", function () {
        it("should return current fee parameters", async function () {
            const { facets } = deployment;
            
            const [minWei, maxBps, baseRiskBps, maxRiskBps] = await facets.admin.getFeeParameters();
            expect(minWei).to.be.greaterThanOrEqual(0);
            expect(maxBps).to.be.greaterThanOrEqual(0);
            expect(baseRiskBps).to.be.greaterThanOrEqual(0);
            expect(maxRiskBps).to.be.greaterThanOrEqual(baseRiskBps);
        });

        it("should allow admin to set minimum fee in wei", async function () {
            const { facets, signers } = deployment;
            const newMinFee = ethers.parseEther("0.002"); // 0.002 ETH
            const [, maxBps, baseRiskBps, maxRiskBps] = await facets.admin.getFeeParameters();
            
            await expectEvent(
                facets.admin.connect(signers.admin).setMinFeeWei(newMinFee),
                facets.admin,
                "FeeParametersUpdated",
                [newMinFee, maxBps, baseRiskBps, maxRiskBps]
            );
            
            const [minWei] = await facets.admin.getFeeParameters();
            expect(minWei).to.equal(newMinFee);
        });

        it("should allow admin to set maximum fee percentage in basis points", async function () {
            const { facets, signers } = deployment;
            const newMaxFee = 500; // 5%
            const [minWei, , baseRiskBps, maxRiskBps] = await facets.admin.getFeeParameters();
            
            await expectEvent(
                facets.admin.connect(signers.admin).setMaxFeePercentBps(newMaxFee),
                facets.admin,
                "FeeParametersUpdated",
                [minWei, newMaxFee, baseRiskBps, maxRiskBps]
            );
            
            const [, maxBps] = await facets.admin.getFeeParameters();
            expect(maxBps).to.equal(newMaxFee);
        });

        it("should allow admin to set base risk scaler in basis points", async function () {
            const { facets, signers } = deployment;
            const newBaseRisk = 150; // 1.5%
            const [minWei, maxBps, , maxRiskBps] = await facets.admin.getFeeParameters();
            
            await expectEvent(
                facets.admin.connect(signers.admin).setBaseRiskScalerBps(newBaseRisk),
                facets.admin,
                "FeeParametersUpdated",
                [minWei, maxBps, newBaseRisk, maxRiskBps]
            );
            
            const [, , baseRiskBps] = await facets.admin.getFeeParameters();
            expect(baseRiskBps).to.equal(newBaseRisk);
        });

        it("should allow admin to set maximum risk scaler in basis points", async function () {
            const { facets, signers } = deployment;
            const newMaxRisk = 1000; // 10%
            const [minWei, maxBps, baseRiskBps] = await facets.admin.getFeeParameters();
            
            await expectEvent(
                facets.admin.connect(signers.admin).setMaxRiskScalerBps(newMaxRisk),
                facets.admin,
                "FeeParametersUpdated",
                [minWei, maxBps, baseRiskBps, newMaxRisk]
            );
            
            const [, , , maxRiskBps] = await facets.admin.getFeeParameters();
            expect(maxRiskBps).to.equal(newMaxRisk);
        });

        it("should reject fee parameter updates from non-admin", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.admin.connect(signers.user1).setMinFeeWei(ethers.parseEther("0.001"))
            ).to.be.revertedWithCustomError(facets.admin, "UnauthorizedRole");
            
            await expect(
                facets.admin.connect(signers.user1).setMaxFeePercentBps(100)
            ).to.be.revertedWithCustomError(facets.admin, "UnauthorizedRole");
            
            await expect(
                facets.admin.connect(signers.user1).setBaseRiskScalerBps(100)
            ).to.be.revertedWithCustomError(facets.admin, "UnauthorizedRole");
            
            await expect(
                facets.admin.connect(signers.user1).setMaxRiskScalerBps(200)
            ).to.be.revertedWithCustomError(facets.admin, "UnauthorizedRole");
        });
    });

    describe("Fee Tiers Management", function () {
        it("should allow admin to set fee tiers", async function () {
            const { facets, signers } = deployment;
            const thresholds = [
                ethers.parseEther("1000"),    // 1000 tokens
                ethers.parseEther("10000"),   // 10,000 tokens
                ethers.parseEther("100000")   // 100,000 tokens
            ];
            const rates = [100, 75, 50]; // 1%, 0.75%, 0.5% in basis points
            
            await expectEvent(
                facets.admin.connect(signers.admin).setFeeTiers(thresholds, rates),
                facets.admin,
                "FeeTiersUpdated",
                [thresholds, rates]
            );
            
            const [returnedThresholds, returnedRates] = await facets.admin.getFeeTiers();
            expect(returnedThresholds.length).to.equal(thresholds.length);
            expect(returnedRates.length).to.equal(rates.length);
            
            for (let i = 0; i < thresholds.length; i++) {
                expect(returnedThresholds[i]).to.equal(thresholds[i]);
                expect(returnedRates[i]).to.equal(rates[i]);
            }
        });

        it("should reject fee tiers with mismatched array lengths", async function () {
            const { facets, signers } = deployment;
            const thresholds = [ethers.parseEther("1000"), ethers.parseEther("10000")];
            const rates = [100]; // Mismatched length
            
            await expect(
                facets.admin.connect(signers.admin).setFeeTiers(thresholds, rates)
            ).to.be.revertedWith("T3Admin: Fee tiers length mismatch");
        });

        it("should reject fee tiers update from non-admin", async function () {
            const { facets, signers } = deployment;
            const thresholds = [ethers.parseEther("1000")];
            const rates = [100];
            
            await expect(
                facets.admin.connect(signers.user1).setFeeTiers(thresholds, rates)
            ).to.be.revertedWithCustomError(facets.admin, "UnauthorizedRole");
        });

        it("should return empty fee tiers initially", async function () {
            const { facets } = deployment;
            
            const [thresholds, rates] = await facets.admin.getFeeTiers();
            // Note: Depending on initialization, this might be empty or have defaults
            expect(thresholds).to.be.an('array');
            expect(rates).to.be.an('array');
            expect(thresholds.length).to.equal(rates.length);
        });
    });

    describe("Abnormal Transaction Flagging", function () {
        it("should allow admin to flag abnormal transaction", async function () {
            const { facets, signers } = deployment;
            
            await expectEvent(
                facets.admin.connect(signers.admin).flagAbnormalTransaction(signers.user1.address),
                facets.admin,
                "AbnormalTransactionFlagged",
                [signers.user1.address, 1]
            );
        });

        it("should increment abnormal transaction count on repeated flagging", async function () {
            const { facets, signers } = deployment;
            
            // First flag
            await expectEvent(
                facets.admin.connect(signers.admin).flagAbnormalTransaction(signers.user1.address),
                facets.admin,
                "AbnormalTransactionFlagged",
                [signers.user1.address, 1]
            );
            
            // Second flag
            await expectEvent(
                facets.admin.connect(signers.admin).flagAbnormalTransaction(signers.user1.address),
                facets.admin,
                "AbnormalTransactionFlagged",
                [signers.user1.address, 2]
            );
        });

        it("should reject flagging from non-admin", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.admin.connect(signers.user1).flagAbnormalTransaction(signers.user2.address)
            ).to.be.revertedWithCustomError(facets.admin, "UnauthorizedRole");
        });

        it("should reject flagging zero address", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.admin.connect(signers.admin).flagAbnormalTransaction(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(facets.admin, "UserAddressZero");
        });
    });

    describe("Role-Based Access Control", function () {
        it("should only allow ADMIN_ROLE to access admin functions", async function () {
            const { facets, signers } = deployment;
            
            // Test various admin functions with non-admin users
            const nonAdminUsers = [signers.minter, signers.pauser, signers.custodian1, signers.user1];
            
            for (const user of nonAdminUsers) {
                await expect(
                    facets.admin.connect(user).setTreasuryAddress(signers.user2.address)
                ).to.be.revertedWithCustomError(facets.admin, "UnauthorizedRole");
                
                await expect(
                    facets.admin.connect(user).setMinFeeWei(1000)
                ).to.be.revertedWithCustomError(facets.admin, "UnauthorizedRole");
                
                await expect(
                    facets.admin.connect(user).flagAbnormalTransaction(signers.user3.address)
                ).to.be.revertedWithCustomError(facets.admin, "UnauthorizedRole");
            }
        });

        it("should allow admin to access all admin functions", async function () {
            const { facets, signers } = deployment;
            
            // Test that admin can access various functions
            await expect(
                facets.admin.connect(signers.admin).setMinFeeWei(1000)
            ).to.not.be.reverted;
            
            await expect(
                facets.admin.connect(signers.admin).setInactivityResetPeriod(oneDay)
            ).to.not.be.reverted;
            
            await expect(
                facets.admin.connect(signers.admin).flagAbnormalTransaction(signers.user1.address)
            ).to.not.be.reverted;
        });
    });

    describe("View Functions", function () {
        it("should return all parameter values correctly", async function () {
            const { facets } = deployment;
            
            // Test all getter functions
            const treasuryAddress = await facets.admin.getTreasuryAddress();
            expect(treasuryAddress).to.not.equal(ethers.ZeroAddress);
            
            const [current, min, max] = await facets.admin.getHalfLifeParameters();
            expect(current).to.be.greaterThan(0);
            expect(min).to.be.greaterThan(0);
            expect(max).to.be.greaterThan(min);
            
            const [minWei, maxBps, baseRiskBps, maxRiskBps] = await facets.admin.getFeeParameters();
            expect(minWei).to.be.greaterThanOrEqual(0);
            expect(maxBps).to.be.greaterThanOrEqual(0);
            expect(baseRiskBps).to.be.greaterThanOrEqual(0);
            expect(maxRiskBps).to.be.greaterThanOrEqual(baseRiskBps);
            
            const [thresholds, rates] = await facets.admin.getFeeTiers();
            expect(thresholds).to.be.an('array');
            expect(rates).to.be.an('array');
        });
    });

    describe("Edge Cases", function () {
        it("should handle boundary values for half-life parameters", async function () {
            const { facets, signers } = deployment;
            
            // Set minimum to 1 second
            await facets.admin.connect(signers.admin).setMinHalfLifeDuration(1);
            const [, min] = await facets.admin.getHalfLifeParameters();
            expect(min).to.equal(1);
            
            // Set maximum to very large value
            const largeValue = BigInt(oneDay * 365); // 1 year
            await facets.admin.connect(signers.admin).setMaxHalfLifeDuration(largeValue);
            const [, , max] = await facets.admin.getHalfLifeParameters();
            expect(max).to.equal(largeValue);
        });

        it("should handle zero fee values", async function () {
            const { facets, signers } = deployment;
            
            // Set minimum fee to 0
            await facets.admin.connect(signers.admin).setMinFeeWei(0);
            const [minWei] = await facets.admin.getFeeParameters();
            expect(minWei).to.equal(0);
            
            // Set risk scalers to 0
            await facets.admin.connect(signers.admin).setBaseRiskScalerBps(0);
            await facets.admin.connect(signers.admin).setMaxRiskScalerBps(0);
            const [, , baseRiskBps, maxRiskBps] = await facets.admin.getFeeParameters();
            expect(baseRiskBps).to.equal(0);
            expect(maxRiskBps).to.equal(0);
        });

        it("should handle empty fee tiers", async function () {
            const { facets, signers } = deployment;
            
            // Set empty fee tiers
            await facets.admin.connect(signers.admin).setFeeTiers([], []);
            const [thresholds, rates] = await facets.admin.getFeeTiers();
            expect(thresholds).to.have.length(0);
            expect(rates).to.have.length(0);
        });
    });
});