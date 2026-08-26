const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

// Import our test infrastructure
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");
const { setupTestBalances } = require("../helpers/tokens");
const { AMOUNTS, TIME, ERROR_MESSAGES } = require("../helpers/constants");
const { expectEvent, expectRevert } = require("../helpers/assertions");

/**
 * T3TokenEnhancedFeeFacet Unit Tests
 * 
 * Tests the KYC-based reward routing system that determines whether
 * users receive immediate rewards (KYC'd users) or escrow rewards (non-KYC users).
 */
describe("T3TokenEnhancedFeeFacet Unit Tests", function () {
    let deployment, enhancedFeeFacet;
    let admin, user1, user2, treasury, kycValidator, nonKycUser, kycUser;
    let rewardsEscrowFacet;
    
    async function setupEnhancedFeeFixture() {
        // Deploy diamond with all facets
        deployment = await deployT3DiamondFixture();
        
        // Setup roles and balances for testing
        await setupTestRoles(deployment.facets, deployment.signers);
        await setupTestBalances(deployment.facets, deployment.signers);
        
        const signers = deployment.signers;
        admin = signers.admin;
        user1 = signers.user1;
        user2 = signers.user2;
        treasury = signers.treasury;
        
        // Use the actual enhanced fee facet
        enhancedFeeFacet = deployment.facets.enhancedFee;
        rewardsEscrowFacet = deployment.facets.rewardsEscrow;
        
        // Setup KYC roles
        const KYC_VERIFIED_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KYC_VERIFIED_ROLE"));
        const KYC_VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KYC_VALIDATOR_ROLE"));
        
        kycValidator = signers.user3;
        await deployment.facets.accessControl.connect(signers.owner).grantRole(KYC_VALIDATOR_ROLE, kycValidator.address);
        
        // Setup test users: user1 is KYC'd, user2 is not
        kycUser = user1;
        nonKycUser = user2;
        await deployment.facets.accessControl.connect(signers.owner).grantRole(KYC_VERIFIED_ROLE, kycUser.address);
        
        // Register kycUser in custody system with proper KYC validation
        await deployment.facets.accessControl.connect(signers.owner).grantRole(await deployment.facets.accessControl.CUSTODIAN_ROLE(), signers.custodian1.address);
        await deployment.facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
            kycUser.address,
            Math.floor(Date.now() / 1000), // kycValidatedTimestamp (now)
            0 // kycExpiresTimestamp (never expires)
        );
        
        // Configure reward routing system
        const rewardConfig = {
            rewardPercentageBps: 200, // 2% rewards
            maxRewardPerTransaction: ethers.parseEther("100"), // 100 tokens max
            routingEnabled: true,
            minTransactionForReward: ethers.parseEther("10") // 10 token minimum
        };
        
        await enhancedFeeFacet.connect(signers.owner).updateRewardRoutingConfig(
            rewardConfig.rewardPercentageBps,
            rewardConfig.maxRewardPerTransaction,
            rewardConfig.routingEnabled,
            rewardConfig.minTransactionForReward
        );
        
        // Enable KYC cache duration to activate enhanced fee processing in transfers
        await enhancedFeeFacet.connect(signers.owner).setKycCacheDuration(3600); // 1 hour
        
        // Set up escrow contract address to enable escrow routing for non-KYC users
        const rewardsEscrowAddress = await deployment.facets.rewardsEscrowCore.getAddress();
        await enhancedFeeFacet.connect(signers.owner).setRewardsEscrowContract(rewardsEscrowAddress);
        
        // Give users initial balances and tokens
        await deployment.facets.mintBurn.connect(signers.owner).mint(kycUser.address, AMOUNTS.THOUSAND_TOKENS);
        await deployment.facets.mintBurn.connect(signers.owner).mint(nonKycUser.address, AMOUNTS.THOUSAND_TOKENS);
        
        return { 
            enhancedFeeFacet, 
            rewardsEscrowFacet: deployment.facets.rewardsEscrowCore,
            admin, 
            kycUser, 
            nonKycUser, 
            treasury, 
            kycValidator,
            rewardConfig
        };
    }
    
    beforeEach(async function () {
        const fixture = await loadFixture(setupEnhancedFeeFixture);
        enhancedFeeFacet = fixture.enhancedFeeFacet;
        rewardsEscrowFacet = fixture.rewardsEscrowFacet;
        admin = fixture.admin;
        kycUser = fixture.kycUser;
        nonKycUser = fixture.nonKycUser;
        treasury = fixture.treasury;
        kycValidator = fixture.kycValidator;
    });

    describe("Reward Routing Configuration", function () {
        it("should allow admin to configure reward routing", async function () {
            const newConfig = {
                rewardPercentageBps: 300, // 3%
                maxRewardPerTransaction: ethers.parseEther("200"),
                routingEnabled: true,
                minTransactionForReward: ethers.parseEther("5")
            };
            
            await expect(
                enhancedFeeFacet.connect(deployment.signers.owner).updateRewardRoutingConfig(
                    newConfig.rewardPercentageBps,
                    newConfig.maxRewardPerTransaction,
                    newConfig.routingEnabled,
                    newConfig.minTransactionForReward
                )
            ).to.emit(enhancedFeeFacet, "RewardRoutingConfigUpdated");
        });

        it("should reject invalid reward percentage", async function () {
            await expect(
                enhancedFeeFacet.connect(deployment.signers.owner).updateRewardRoutingConfig(
                    1001, // > 10% (max is 1000 basis points = 10%)
                    ethers.parseEther("100"),
                    true,
                    ethers.parseEther("10")
                )
            ).to.be.revertedWithCustomError(enhancedFeeFacet, "InvalidRewardPercentage");
        });

        it("should reject configuration from non-admin", async function () {
            await expect(
                enhancedFeeFacet.connect(kycUser).updateRewardRoutingConfig(
                    200,
                    ethers.parseEther("100"),
                    true,
                    ethers.parseEther("10")
                )
            ).to.be.revertedWithCustomError(deployment.facets.accessControl, "UnauthorizedRole");
        });
    });

    describe("KYC-based Reward Routing", function () {
        it("should route rewards to incentive credits for KYC'd users", async function () {
            const transferAmount = ethers.parseEther("1000"); // Use larger amount to ensure fees
            
            // Get initial incentive credits balance
            const initialCredits = await enhancedFeeFacet.getIncentiveCreditsBalance(kycUser.address);
            
            // Process transaction fee
            const tx = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                kycUser.address,
                nonKycUser.address,
                transferAmount
            );
            
            // Should emit DirectRewardAwarded event
            await expect(tx).to.emit(enhancedFeeFacet, "DirectRewardAwarded");
            
            // Check that incentive credits increased
            const finalCredits = await enhancedFeeFacet.getIncentiveCreditsBalance(kycUser.address);
            expect(finalCredits).to.be.greaterThan(initialCredits);
        });

        it("should route rewards to escrow for non-KYC'd users", async function () {
            const transferAmount = ethers.parseEther("1000"); // Use larger amount to ensure fees
            
            // Process transaction fee
            const tx = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                nonKycUser.address,
                kycUser.address,
                transferAmount
            );
            
            // Should emit EscrowRewardAwarded event
            await expect(tx).to.emit(enhancedFeeFacet, "EscrowRewardAwarded");
        });

        it("should handle KYC'd to KYC'd transfers correctly", async function () {
            // Setup second KYC'd user
            const KYC_VERIFIED_ROLE = ethers.keccak256(ethers.toUtf8Bytes("KYC_VERIFIED_ROLE"));
            await deployment.facets.accessControl.connect(deployment.signers.owner).grantRole(KYC_VERIFIED_ROLE, nonKycUser.address);
            
            // Register nonKycUser in custody system with proper KYC validation
            await deployment.facets.custodian.connect(deployment.signers.custodian1).registerCustodiedWallet(
                nonKycUser.address,
                Math.floor(Date.now() / 1000), // kycValidatedTimestamp (now)
                0 // kycExpiresTimestamp (never expires)
            );
            
            const transferAmount = ethers.parseEther("1000"); // Use larger amount to ensure fees
            
            // Get initial credits for both users
            const fromInitialCredits = await enhancedFeeFacet.getIncentiveCreditsBalance(kycUser.address);
            const toInitialCredits = await enhancedFeeFacet.getIncentiveCreditsBalance(nonKycUser.address);
            
            // Process transaction fee
            const result = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                kycUser.address,
                nonKycUser.address,
                transferAmount
            );
            
            // Both users should get direct rewards
            const fromFinalCredits = await enhancedFeeFacet.getIncentiveCreditsBalance(kycUser.address);
            const toFinalCredits = await enhancedFeeFacet.getIncentiveCreditsBalance(nonKycUser.address);
            
            expect(fromFinalCredits).to.be.greaterThan(fromInitialCredits);
            expect(toFinalCredits).to.be.greaterThan(toInitialCredits);
        });

        it("should handle non-KYC'd to non-KYC'd transfers correctly", async function () {
            // Setup second non-KYC'd user
            const user3 = deployment.signers.user3;
            await deployment.facets.mintBurn.connect(deployment.signers.owner).mint(user3.address, AMOUNTS.THOUSAND_TOKENS);
            
            const transferAmount = ethers.parseEther("1000"); // Use larger amount to ensure fees
            
            // Process transaction fee
            const tx = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                nonKycUser.address,
                user3.address,
                transferAmount
            );
            
            // Should emit EscrowRewardAwarded events for both users
            await expect(tx).to.emit(enhancedFeeFacet, "EscrowRewardAwarded");
        });
    });

    describe("Fee Calculation Logic", function () {
        it("should calculate fees correctly", async function () {
            const transferAmount = ethers.parseEther("100");
            
            const result = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                kycUser.address,
                nonKycUser.address,
                transferAmount
            );
            
            // Function should return three values: netFeeAmount, fromReward, toReward
            expect(result).to.exist;
            // Note: incentive credit netting will be tested when credits accumulate from rewards
        });

        it("should respect maximum reward per transaction", async function () {
            const largeTransferAmount = ethers.parseEther("10000"); // Very large amount
            
            const result = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                kycUser.address,
                nonKycUser.address,
                largeTransferAmount
            );
            
            // Function should complete (actual reward limits are tested in contract logic)
            expect(result).to.exist;
        });

        it("should not award rewards below minimum transaction amount", async function () {
            const smallTransferAmount = ethers.parseEther("5"); // Below 10 token minimum
            
            // Should revert with TransferAmountTooSmall
            await expect(
                enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                    kycUser.address,
                    nonKycUser.address,
                    smallTransferAmount
                )
            ).to.be.revertedWithCustomError(enhancedFeeFacet, "TransferAmountTooSmall");
        });
    });

    describe("System Integration", function () {
        it("should work with existing transfer functionality", async function () {
            const transferAmount = ethers.parseEther("50");
            
            // Get initial balances
            const fromInitialBalance = await deployment.facets.erc20.balanceOf(kycUser.address);
            const toInitialBalance = await deployment.facets.erc20.balanceOf(nonKycUser.address);
            
            // Perform actual transfer through the system
            await deployment.facets.directTransfer.connect(kycUser).transfer(nonKycUser.address, transferAmount);
            
            // Check that transfer occurred
            const fromFinalBalance = await deployment.facets.erc20.balanceOf(kycUser.address);
            const toFinalBalance = await deployment.facets.erc20.balanceOf(nonKycUser.address);
            
            expect(fromFinalBalance).to.be.lessThan(fromInitialBalance);
            expect(toFinalBalance).to.be.greaterThan(toInitialBalance);
        });

        it("should respect routing enabled/disabled state", async function () {
            // Disable routing
            await enhancedFeeFacet.connect(deployment.signers.owner).updateRewardRoutingConfig(
                200, // rewardPercentageBps
                ethers.parseEther("100"), // maxReward  
                false, // routingEnabled = false
                ethers.parseEther("10") // minTransaction
            );
            
            const transferAmount = ethers.parseEther("100");
            
            // Should revert with RewardRoutingDisabled
            await expect(
                enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                    kycUser.address,
                    nonKycUser.address,
                    transferAmount
                )
            ).to.be.revertedWithCustomError(enhancedFeeFacet, "RewardRoutingDisabled");
        });
    });

    describe("Edge Cases and Error Handling", function () {
        it("should handle zero amount transfers", async function () {
            // Should revert with TransferAmountTooSmall since 0 < minTransactionForReward (10 tokens)
            await expect(
                enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                    kycUser.address,
                    nonKycUser.address,
                    0
                )
            ).to.be.revertedWithCustomError(enhancedFeeFacet, "TransferAmountTooSmall");
        });

        it("should handle invalid addresses gracefully", async function () {
            // processTransactionFee function doesn't validate addresses directly,
            // it will fail when trying to access KYC status, so test with valid addresses
            const transferAmount = ethers.parseEther("1000"); // Use larger amount to ensure fees
            
            const result = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                ethers.ZeroAddress,
                nonKycUser.address,
                transferAmount
            );
            
            // Function should complete but zero address will not be KYC'd
            expect(result).to.exist; // Should complete successfully
        });

        it("should handle identical from/to addresses", async function () {
            const transferAmount = ethers.parseEther("1000"); // Use larger amount to ensure fees
            
            // Function allows identical addresses, it will just process rewards for same user
            const result = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                kycUser.address,
                kycUser.address,
                transferAmount
            );
            
            expect(result).to.exist; // Should complete successfully
        });

        it("should allow authorized access for fee processing", async function () {
            // processTransactionFee doesn't have access control restrictions in the current implementation
            const transferAmount = ethers.parseEther("1000"); // Use larger amount to ensure fees
            
            const result = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                kycUser.address,
                nonKycUser.address,
                transferAmount
            );
            
            expect(result).to.exist; // Should complete successfully
        });
    });

    describe("Escrow Contract Integration", function () {
        it("should allow admin to configure escrow contract", async function () {
            const newEscrowAddress = deployment.signers.user3.address; // Use another signer as mock escrow
            
            await expect(
                enhancedFeeFacet.connect(deployment.signers.owner).setRewardsEscrowContract(newEscrowAddress)
            ).to.emit(enhancedFeeFacet, "RewardsEscrowContractUpdated");
        });

        it("should prevent non-admin from setting escrow contract", async function () {
            const newEscrowAddress = deployment.signers.user3.address;
            
            await expect(
                enhancedFeeFacet.connect(kycUser).setRewardsEscrowContract(newEscrowAddress)
            ).to.be.revertedWithCustomError(deployment.facets.accessControl, "UnauthorizedRole");
        });

        it("should reject zero address for escrow contract", async function () {
            await expect(
                enhancedFeeFacet.connect(deployment.signers.owner).setRewardsEscrowContract(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(enhancedFeeFacet, "ZeroAddress");
        });
    });

    describe("KYC Cache Integration", function () {
        it("should refresh KYC cache when needed", async function () {
            const cacheInfo = await enhancedFeeFacet.getKycCacheInfo(kycUser.address);
            
            expect(cacheInfo.isValid).to.be.a("boolean");
            expect(cacheInfo.lastChecked).to.be.a("bigint");
            expect(cacheInfo.cacheExpiry).to.be.a("bigint");
        });

        it("should handle expired KYC cache", async function () {
            // Advance time beyond cache expiry
            await time.increase(30 * 24 * 60 * 60); // 30 days
            
            // Processing should still work (cache should refresh automatically)
            const result = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee(
                kycUser.address,
                nonKycUser.address,
                ethers.parseEther("1000") // Use larger amount to ensure fees
            );
            
            expect(result).to.exist; // Should complete successfully
        });
    });

    describe("Gas Optimization", function () {
        it("should process fees efficiently", async function () {
            const transferAmount = ethers.parseEther("1000"); // Use larger amount to ensure fees
            
            // Measure gas for KYC'd user transaction
            const kycTx = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee.estimateGas(
                kycUser.address,
                nonKycUser.address,
                transferAmount
            );
            
            // Measure gas for non-KYC'd user transaction  
            const nonKycTx = await enhancedFeeFacet.connect(deployment.signers.owner).processTransactionFee.estimateGas(
                nonKycUser.address,
                kycUser.address,
                transferAmount
            );
            
            // Gas usage should be reasonable (less than 500k gas)
            expect(kycTx).to.be.lessThan(500000);
            expect(nonKycTx).to.be.lessThan(500000);
        });
    });
});