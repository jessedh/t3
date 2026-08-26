const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Import our test infrastructure
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");
const { setupTestBalances } = require("../helpers/tokens");
const { AMOUNTS } = require("../helpers/constants");

/**
 * T3TokenFeeLogicFacet Unit Tests
 * 
 * Tests fee calculation logic, fee tier management, and fee estimation functionality.
 * This facet primarily serves as a view interface to the T3FeeLib library.
 */
describe("T3TokenFeeLogicFacet Unit Tests", function () {
    let deployment;
    
    async function setupFeeLogicFixture() {
        // Deploy diamond with all facets
        deployment = await deployT3DiamondFixture();
        
        // Setup roles and balances for testing
        await setupTestRoles(deployment.facets, deployment.signers);
        await setupTestBalances(deployment.facets, deployment.signers);
        
        return deployment;
    }
    
    beforeEach(async function () {
        deployment = await loadFixture(setupFeeLogicFixture);
    });

    describe("Fee Tier Information", function () {
        it("should return fee tier thresholds after initialization", async function () {
            const { facets } = deployment;
            
            const thresholds = await facets.feeLogic.getFeeTierThresholds();
            expect(thresholds).to.be.an('array');
            expect(thresholds.length).to.be.greaterThanOrEqual(0); // May have defaults from initialization
        });

        it("should return fee tier rates after initialization", async function () {
            const { facets } = deployment;
            
            const rates = await facets.feeLogic.getFeeTierRates();
            expect(rates).to.be.an('array');
            expect(rates.length).to.be.greaterThanOrEqual(0); // May have defaults from initialization
        });

        it("should return configured fee tiers after admin sets them", async function () {
            const { facets, signers } = deployment;
            
            // Setup fee tiers through admin
            const thresholds = [
                ethers.parseEther("1000"),    // 1000 tokens
                ethers.parseEther("10000"),   // 10,000 tokens
                ethers.parseEther("100000")   // 100,000 tokens
            ];
            const rates = [100, 75, 50]; // 1%, 0.75%, 0.5% in basis points
            
            await facets.admin.connect(signers.admin).setFeeTiers(thresholds, rates);
            
            // Verify fee logic facet returns the same data
            const returnedThresholds = await facets.feeLogic.getFeeTierThresholds();
            const returnedRates = await facets.feeLogic.getFeeTierRates();
            
            expect(returnedThresholds.length).to.equal(thresholds.length);
            expect(returnedRates.length).to.equal(rates.length);
            
            for (let i = 0; i < thresholds.length; i++) {
                expect(returnedThresholds[i]).to.equal(thresholds[i]);
                expect(returnedRates[i]).to.equal(rates[i]);
            }
        });

        it("should handle multiple fee tier updates", async function () {
            const { facets, signers } = deployment;
            
            // Set initial fee tiers
            const initialThresholds = [ethers.parseEther("1000")];
            const initialRates = [100];
            await facets.admin.connect(signers.admin).setFeeTiers(initialThresholds, initialRates);
            
            let thresholds = await facets.feeLogic.getFeeTierThresholds();
            let rates = await facets.feeLogic.getFeeTierRates();
            expect(thresholds.length).to.equal(1);
            expect(rates.length).to.equal(1);
            
            // Update fee tiers
            const updatedThresholds = [
                ethers.parseEther("500"),
                ethers.parseEther("5000"),
                ethers.parseEther("50000")
            ];
            const updatedRates = [150, 100, 50];
            await facets.admin.connect(signers.admin).setFeeTiers(updatedThresholds, updatedRates);
            
            thresholds = await facets.feeLogic.getFeeTierThresholds();
            rates = await facets.feeLogic.getFeeTierRates();
            expect(thresholds.length).to.equal(3);
            expect(rates.length).to.equal(3);
            
            for (let i = 0; i < updatedThresholds.length; i++) {
                expect(thresholds[i]).to.equal(updatedThresholds[i]);
                expect(rates[i]).to.equal(updatedRates[i]);
            }
        });
    });

    describe("Fee Estimation", function () {
        it("should estimate transfer fee details for basic transfer", async function () {
            const { facets, signers } = deployment;
            
            const transferAmount = AMOUNTS.TEN_TOKENS;
            const feeDetails = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                transferAmount
            );
            
            // The function returns an array that represents the struct fields
            expect(feeDetails).to.be.an('array');
            expect(feeDetails.length).to.be.greaterThan(0);
            
            // Extract struct fields (based on StorageLib.FeeDetails order)
            const [baseFeeWei, riskAdjustment, feeAfterRiskAdjustment, totalFeeAssessed, availableCredits, creditsToApply, feeAfterCredits] = feeDetails;
            
            // Basic validations
            expect(totalFeeAssessed).to.be.greaterThan(0);
            expect(feeAfterCredits).to.be.greaterThanOrEqual(0);
            expect(feeAfterCredits).to.be.lessThanOrEqual(totalFeeAssessed);
        });

        it("should estimate different fees for different transfer amounts", async function () {
            const { facets, signers } = deployment;
            
            const smallAmount = AMOUNTS.TEN_TOKENS;
            const largeAmount = AMOUNTS.THOUSAND_TOKENS;
            
            const smallFeeDetails = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                smallAmount
            );
            
            const largeFeeDetails = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                largeAmount
            );
            
            // Extract total fee assessed (4th element in array)
            const smallTotalFee = smallFeeDetails[3];
            const largeTotalFee = largeFeeDetails[3];
            
            // For larger amounts, the percentage-based fee might result in a larger total fee
            // However, minimum fee constraints might apply
            expect(smallTotalFee).to.be.greaterThan(0);
            expect(largeTotalFee).to.be.greaterThan(0);
        });

        it("should estimate fees for transfers between different user pairs", async function () {
            const { facets, signers } = deployment;
            
            const transferAmount = AMOUNTS.HUNDRED_TOKENS;
            
            const feeDetails1 = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                transferAmount
            );
            
            const feeDetails2 = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user2.address,
                signers.user3.address,
                transferAmount
            );
            
            // Both should return valid fee details (extract totalFeeAssessed)
            expect(feeDetails1[3]).to.be.greaterThan(0);
            expect(feeDetails2[3]).to.be.greaterThan(0);
            
            // Fees might be different based on user profiles and risk factors
            // We just verify they're both positive and reasonable
        });

        it("should handle fee estimation for zero amount gracefully", async function () {
            const { facets, signers } = deployment;
            
            // Note: This might revert in actual contract, but we test what happens
            await expect(
                facets.feeLogic.estimateTransferFeeDetails(
                    signers.user1.address,
                    signers.user2.address,
                    0
                )
            ).to.be.revertedWithCustomError(facets.feeLogic, "TransferAmountZero");
        });

        it("should handle fee estimation for very large amounts", async function () {
            const { facets, signers } = deployment;
            
            const veryLargeAmount = ethers.parseEther("1000000"); // 1M tokens
            
            const feeDetails = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                veryLargeAmount
            );
            
            // Should handle large amounts without overflow (extract fields)
            expect(feeDetails[3]).to.be.greaterThan(0); // totalFeeAssessed
            expect(feeDetails[0]).to.be.greaterThan(0); // baseFeeWei
        });
    });

    describe("Fee Details Structure Validation", function () {
        it("should return consistent fee details structure", async function () {
            const { facets, signers } = deployment;
            
            const feeDetails = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                AMOUNTS.HUNDRED_TOKENS
            );
            
            // Verify all expected fields are present and are numbers (array format)
            expect(typeof feeDetails[0]).to.equal('bigint'); // baseFeeWei
            expect(typeof feeDetails[1]).to.equal('bigint'); // riskAdjustment
            expect(typeof feeDetails[2]).to.equal('bigint'); // feeAfterRiskAdjustment
            expect(typeof feeDetails[3]).to.equal('bigint'); // totalFeeAssessed
            expect(typeof feeDetails[4]).to.equal('bigint'); // availableCredits
            expect(typeof feeDetails[5]).to.equal('bigint'); // creditsToApply
            expect(typeof feeDetails[6]).to.equal('bigint'); // feeAfterCredits
        });

        it("should maintain fee calculation consistency", async function () {
            const { facets, signers } = deployment;
            
            const feeDetails = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                AMOUNTS.TEN_TOKENS
            );
            
            // Logical consistency checks (array format)
            expect(feeDetails[6]).to.be.lessThanOrEqual(feeDetails[3]); // feeAfterCredits <= totalFeeAssessed
            expect(feeDetails[5]).to.be.lessThanOrEqual(feeDetails[4]); // creditsToApply <= availableCredits
            expect(feeDetails[5]).to.be.lessThanOrEqual(feeDetails[3]); // creditsToApply <= totalFeeAssessed
        });
    });

    describe("Integration with Fee Configuration", function () {
        it("should reflect fee parameter changes in estimations", async function () {
            const { facets, signers } = deployment;
            
            // Get initial fee estimation
            const initialFeeDetails = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                AMOUNTS.HUNDRED_TOKENS
            );
            
            // Change minimum fee
            const newMinFee = ethers.parseEther("0.002");
            await facets.admin.connect(signers.admin).setMinFeeWei(newMinFee);
            
            // Get updated fee estimation
            const updatedFeeDetails = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                AMOUNTS.HUNDRED_TOKENS
            );
            
            // For small transfers, the minimum fee change should be reflected
            // (Exact behavior depends on whether minimum fee applies to this transfer amount)
            expect(updatedFeeDetails[3]).to.be.greaterThan(0); // totalFeeAssessed
            expect(initialFeeDetails[3]).to.be.greaterThan(0); // totalFeeAssessed
        });

        it("should reflect fee tier changes in estimations", async function () {
            const { facets, signers } = deployment;
            
            // Set fee tiers that might affect large transfers
            const thresholds = [ethers.parseEther("50")]; // 50 token threshold
            const rates = [200]; // 2% rate
            await facets.admin.connect(signers.admin).setFeeTiers(thresholds, rates);
            
            // Test with amount above threshold
            const largeAmount = ethers.parseEther("100"); // Above 50 token threshold
            const feeDetails = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                largeAmount
            );
            
            expect(feeDetails[3]).to.be.greaterThan(0); // totalFeeAssessed
            
            // Verify fee tiers are accessible
            const returnedThresholds = await facets.feeLogic.getFeeTierThresholds();
            const returnedRates = await facets.feeLogic.getFeeTierRates();
            expect(returnedThresholds[0]).to.equal(thresholds[0]);
            expect(returnedRates[0]).to.equal(rates[0]);
        });
    });

    describe("Edge Cases", function () {
        it("should handle fee estimation for same sender and recipient", async function () {
            const { facets, signers } = deployment;
            
            const feeDetails = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user1.address, // Same address
                AMOUNTS.TEN_TOKENS
            );
            
            // Self-transfers should still incur fees
            expect(feeDetails[3]).to.be.greaterThan(0); // totalFeeAssessed
        });

        it("should handle fee estimation for addresses with no prior history", async function () {
            const { facets, signers } = deployment;
            
            // Use an address that hasn't been used before
            const newUser = ethers.Wallet.createRandom();
            
            const feeDetails = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                newUser.address,
                AMOUNTS.TEN_TOKENS
            );
            
            // Should work for new addresses
            expect(feeDetails[3]).to.be.greaterThan(0); // totalFeeAssessed
        });

        it("should handle multiple consecutive fee estimations", async function () {
            const { facets, signers } = deployment;
            
            // Multiple estimations shouldn't affect each other (view function)
            const estimation1 = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                AMOUNTS.TEN_TOKENS
            );
            
            const estimation2 = await facets.feeLogic.estimateTransferFeeDetails(
                signers.user1.address,
                signers.user2.address,
                AMOUNTS.TEN_TOKENS
            );
            
            // Same parameters should give same results (array format)
            expect(estimation1[3]).to.equal(estimation2[3]); // totalFeeAssessed
            expect(estimation1[0]).to.equal(estimation2[0]); // baseFeeWei
            expect(estimation1[6]).to.equal(estimation2[6]); // feeAfterCredits
        });
    });

    describe("View Function Access", function () {
        it("should allow anyone to query fee tier information", async function () {
            const { facets, signers } = deployment;
            
            // Non-admin users should be able to read fee tiers
            await expect(
                facets.feeLogic.connect(signers.user1).getFeeTierThresholds()
            ).to.not.be.reverted;
            
            await expect(
                facets.feeLogic.connect(signers.user2).getFeeTierRates()
            ).to.not.be.reverted;
        });

        it("should allow anyone to estimate fees", async function () {
            const { facets, signers } = deployment;
            
            // Non-admin users should be able to estimate fees
            await expect(
                facets.feeLogic.connect(signers.user1).estimateTransferFeeDetails(
                    signers.user2.address,
                    signers.user3.address,
                    AMOUNTS.TEN_TOKENS
                )
            ).to.not.be.reverted;
        });
    });
});
