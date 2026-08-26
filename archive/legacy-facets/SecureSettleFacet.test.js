const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

// Import our test infrastructure
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");
const { setupTestBalances } = require("../helpers/tokens");
const { AMOUNTS, TEST_AMOUNTS, TIME, ERROR_MESSAGES } = require("../helpers/constants");
const { expectEvent, expectRevert } = require("../helpers/assertions");

/**
 * SecureSettleFacet Unit Tests
 * 
 * Tests multi-asset settlement system with oracle price validation,
 * time-locked execution, and custodian approval workflows.
 */
describe("SecureSettleFacet Unit Tests", function () {
    let deployment, secureSettle, oracleManager;
    let admin, custodian1, custodian2, user1, user2;
    
    const STATUS_PENDING = 0;
    const STATUS_APPROVED = 1;
    const STATUS_EXECUTED = 2;
    const STATUS_CANCELLED = 3;
    
    const DEFAULT_THRESHOLD = ethers.parseEther("10000"); // $10K threshold
    const DEFAULT_DELAY = 1 * TIME.ONE_HOUR; // 1 hour delay
    
    async function setupSecureSettleFixture() {
        // Deploy diamond with all facets
        deployment = await deployT3DiamondFixture();
        
        // Setup roles and balances for testing
        await setupTestRoles(deployment.facets, deployment.signers);
        await setupTestBalances(deployment.facets, deployment.signers);
        
        const signers = deployment.signers;
        admin = signers.admin;
        custodian1 = signers.custodian1;
        custodian2 = signers.custodian2;
        user1 = signers.user1;
        user2 = signers.user2;
        
        // Get the actual SecureSettleFacet and OracleManagerFacet from diamond
        secureSettle = deployment.facets.secureSettle;
        oracleManager = deployment.facets.oracleManager;
        
        if (!secureSettle) {
            throw new Error("SecureSettleFacet not available in diamond deployment");
        }
        if (!oracleManager) {
            throw new Error("OracleManagerFacet not available in diamond deployment");
        }
        
        // Configure the SecureSettle system
        await secureSettle.connect(admin).setOracleManager(deployment.diamondAddress);
        await oracleManager.connect(admin).setOracleActive(true);
        await secureSettle.connect(admin).setDefaultSettlementDelay(DEFAULT_DELAY);
        await secureSettle.connect(admin).setDefaultSecureSettleThreshold(DEFAULT_THRESHOLD);
        await secureSettle.connect(admin).setSecureSettleThreshold(deployment.diamond.target, DEFAULT_THRESHOLD);
        await secureSettle.connect(admin).setSecureSettleActive(true);
        await secureSettle.connect(admin).setMaxSettlementDelay(TIME.ONE_WEEK);
        
        return { secureSettle, oracleManager, admin, custodian1, custodian2, user1, user2 };
    }
    
    beforeEach(async function () {
        const fixture = await loadFixture(setupSecureSettleFixture);
        secureSettle = fixture.secureSettle;
        oracleManager = fixture.oracleManager;
        admin = fixture.admin;
        custodian1 = fixture.custodian1;
        custodian2 = fixture.custodian2;
        user1 = fixture.user1;
        user2 = fixture.user2;
    });

    describe("Settlement Proposal", function () {
        it("should propose a multi-asset settlement", async function () {
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE]; // $100K equivalent
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0; // Use system default

            await expectEvent(
                secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                    assets,
                    amounts,
                    recipients,
                    description,
                    requestedDelay
                ),
                secureSettle,
                "SettlementProposed"
            );
        });

        it("should only allow custodians to propose settlements", async function () {
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0;

            await expectRevert(
                secureSettle.connect(user1).proposeMultiAssetSettlement(
                    assets,
                    amounts,
                    recipients,
                    description,
                    requestedDelay
                ),
                secureSettle,
                ["UnauthorizedRole"]
            );
        });

        it("should reject settlements below threshold", async function () {
            const assets = [deployment.diamond.target];
            const amounts = [AMOUNTS.TEN_TOKENS]; // Below $10K threshold
            const recipients = [user2.address];
            const description = "Small settlement";
            const requestedDelay = 0;

            await expect(
                secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                    assets,
                    amounts,
                    recipients,
                    description,
                    requestedDelay
                )
            ).to.be.revertedWithCustomError(secureSettle, "BelowSecureSettleThreshold");
        });

        it("should validate array lengths", async function () {
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE, AMOUNTS.TEN_TOKENS]; // Mismatched length
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0;

            await expect(
                secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                    assets,
                    amounts,
                    recipients,
                    description,
                    requestedDelay
                )
            ).to.be.revertedWithCustomError(secureSettle, "InvalidArrayLength");
        });

        it("should reject zero amounts", async function () {
            const assets = [deployment.diamond.target];
            const amounts = [0];
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0;

            await expect(
                secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                    assets,
                    amounts,
                    recipients,
                    description,
                    requestedDelay
                )
            ).to.be.revertedWithCustomError(secureSettle, "ZeroAmount");
        });

        it("should reject zero addresses", async function () {
            const assets = [ethers.ZeroAddress];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0;

            await expect(
                secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                    assets,
                    amounts,
                    recipients,
                    description,
                    requestedDelay
                )
            ).to.be.revertedWithCustomError(secureSettle, "ZeroAddress");
        });

        it("should reject self-transfers for T3Token", async function () {
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [custodian1.address]; // Same as sender
            const description = "Self settlement";
            const requestedDelay = 0;

            await expect(
                secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                    assets,
                    amounts,
                    recipients,
                    description,
                    requestedDelay
                )
            ).to.be.revertedWithCustomError(secureSettle, "SelfTransfer");
        });

        it("should validate sufficient balance for T3Token", async function () {
            const balance = await deployment.facets.erc20.balanceOf(custodian1.address);
            const assets = [deployment.diamond.target];
            const amounts = [balance + 1n]; // Amount slightly larger than balance
            const recipients = [user2.address];
            const description = "Large settlement";
            const requestedDelay = 0;

            await expect(
                secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                    assets,
                    amounts,
                    recipients,
                    description,
                    requestedDelay
                )
            ).to.be.revertedWith("Insufficient T3Token balance");
        });
    });

    describe("Settlement Approval", function () {
        let settlementId;

        beforeEach(async function () {
            // Create a test settlement
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0; // Use system default

            const tx = await secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            settlementId = event.args[0];
        });

        it("should approve pending settlement", async function () {
            await expectEvent(
                secureSettle.connect(custodian2).approveSettlement(settlementId),
                secureSettle,
                "SettlementApproved"
            ).withArgs(settlementId, custodian2.address);
            
            const settlement = await secureSettle.getSettlement(settlementId);
            expect(settlement.status).to.equal(STATUS_APPROVED);
        });

        it("should only allow custodians to approve", async function () {
            await expect(
                secureSettle.connect(user1).approveSettlement(settlementId)
            ).to.be.revertedWithCustomError(secureSettle, "UnauthorizedRole");
        });

        it("should reject approval of non-existent settlement", async function () {
            const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
            
            await expect(
                secureSettle.connect(custodian2).approveSettlement(fakeId)
            ).to.be.revertedWithCustomError(secureSettle, "SettlementNotFound");
        });

        it("should reject approval after 24-hour window", async function () {
            // Fast forward past approval window
            await time.increase(24 * TIME.ONE_HOUR + 1);
            
            await expect(
                secureSettle.connect(custodian2).approveSettlement(settlementId)
            ).to.be.reverted;
        });
    });

    describe("Settlement Execution", function () {
        let settlementId;

        beforeEach(async function () {
            // Create and approve a test settlement
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0; // Use system default

            const tx = await secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            settlementId = event.args[0];

            // Approve the settlement
            await secureSettle.connect(custodian2).approveSettlement(settlementId);
        });

        it("should execute approved settlement after delay", async function () {
            // Fast forward past settlement delay
            await time.increase(DEFAULT_DELAY * 2);
            
            const initialBalance = await deployment.facets.erc20.balanceOf(user2.address);
            
            const tx = await secureSettle.connect(custodian1).executeSettlement(settlementId);
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementExecuted");
            
            expect(event).to.not.be.undefined;
            expect(event.args[0]).to.equal(settlementId);
            expect(event.args[1]).to.equal(custodian1.address);

            const finalBalance = await deployment.facets.erc20.balanceOf(user2.address);
            expect(finalBalance - initialBalance).to.equal(TEST_AMOUNTS.LARGE);
            
            const settlement = await secureSettle.getSettlement(settlementId);
            expect(settlement.status).to.equal(STATUS_EXECUTED);
        });

        it("should not execute before delay period", async function () {
            await expect(
                secureSettle.connect(custodian1).executeSettlement(settlementId)
            ).to.be.revertedWithCustomError(secureSettle, "SettlementNotReady");
        });

        it("should not execute expired settlement", async function () {
            // Fast forward past execution window (48 hours after ready time)
            await time.increase(DEFAULT_DELAY + 48 * TIME.ONE_HOUR * 2);
            
            const settlementBefore = await secureSettle.getSettlement(settlementId);
            console.log("Settlement executesAt:", settlementBefore.executesAt.toString());
            console.log("Current block timestamp:", (await ethers.provider.getBlock("latest")).timestamp.toString());

            await expect(
                secureSettle.connect(custodian1).executeSettlement(settlementId)
            ).to.be.revertedWithCustomError(secureSettle, "SettlementExpired");
        });

        it("should not execute non-approved settlement", async function () {
            // Create another settlement but don't approve it
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user1.address];
            const description = "Unapproved settlement";
            const requestedDelay = 0;

            const tx = await secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            const unapprovedId = event.args[0];

            await time.increase(DEFAULT_DELAY + 1);

            await expect(
                secureSettle.connect(custodian1).executeSettlement(unapprovedId)
            ).to.be.revertedWithCustomError(secureSettle, "SettlementNotPending");
        });
    });

    describe("Settlement Cancellation", function () {
        let settlementId;

        beforeEach(async function () {
            // Create a test settlement
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0; // Use system default

            const tx = await secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            settlementId = event.args[0];
        });

        it("should allow proposer to cancel settlement", async function () {
            const reason = "Changed mind";
            
            await expectEvent(
                secureSettle.connect(custodian1).cancelSettlement(settlementId, reason),
                secureSettle,
                "SettlementCancelled"
            ).withArgs(settlementId, custodian1.address, reason);
            
            const settlement = await secureSettle.getSettlement(settlementId);
            expect(settlement.status).to.equal(STATUS_CANCELLED);
        });

        it("should allow admin to cancel settlement", async function () {
            const reason = "Administrative cancellation";
            
            await expectEvent(
                secureSettle.connect(admin).cancelSettlement(settlementId, reason),
                secureSettle,
                "SettlementCancelled"
            ).withArgs(settlementId, admin.address, reason);
        });

        it("should not allow unauthorized users to cancel", async function () {
            const reason = "Unauthorized cancellation";
            
            await expect(
                secureSettle.connect(user1).cancelSettlement(settlementId, reason)
            ).to.be.revertedWithCustomError(secureSettle, "UnauthorizedCancellation");
        });
    });

    describe("Administrative Functions", function () {
        it("should set secure settlement threshold", async function () {
            const newThreshold = ethers.parseEther("50000");
            const asset = deployment.diamond.target;
            
            await expectEvent(
                secureSettle.connect(admin).setSecureSettleThreshold(asset, newThreshold),
                secureSettle,
                "SecureSettleThresholdUpdated"
            ).withArgs(asset, DEFAULT_THRESHOLD, newThreshold); // Old value is from fixture setup
            
            expect(await secureSettle.getSecureSettleThreshold(asset)).to.equal(newThreshold);
        });

        it("should set default settlement delay", async function () {
            const newDelay = 2 * TIME.ONE_HOUR;
            
            await expectEvent(
                secureSettle.connect(admin).setDefaultSettlementDelay(newDelay),
                secureSettle,
                "DefaultSettlementDelayUpdated"
            ).withArgs(DEFAULT_DELAY, newDelay); // Old value is from fixture setup
        });

        it("should reject invalid delay ranges", async function () {
            const tooShort = 30 * 60; // 30 minutes
            const tooLong = 8 * TIME.ONE_DAY; // 8 days
            
            await expect(
                secureSettle.connect(admin).setDefaultSettlementDelay(tooShort)
            ).to.be.reverted;
            
            await expect(
                secureSettle.connect(admin).setDefaultSettlementDelay(tooLong)
            ).to.be.reverted;
        });

        it("should set oracle manager", async function () {
            const newOracle = user1.address;
            
            await expectEvent(
                secureSettle.connect(admin).setOracleManager(newOracle),
                secureSettle,
                "OracleManagerUpdated"
            ).withArgs(deployment.diamondAddress, newOracle); // Old value is diamond address from setup
        });

        it("should reject zero address for oracle manager", async function () {
            await expectRevert(
                secureSettle.connect(admin).setOracleManager(ethers.ZeroAddress),
                secureSettle,
                ["ZeroAddress"]
            );
        });

        it("should only allow admin for configuration", async function () {
            await expectRevert(
                secureSettle.connect(user1).setSecureSettleThreshold(deployment.diamond.target, AMOUNTS.TEN_TOKENS),
                secureSettle,
                ["UnauthorizedRole"]
            );
        });
    });

    describe("View Functions", function () {
        it("should check if transfer requires secure settlement", async function () {
            // Large amount should require secure settlement
            const largeAmount = ethers.parseEther("100000");
            expect(await secureSettle.requiresSecureSettlement(deployment.diamond.target, largeAmount)).to.be.true;
            
            // Small amount should not require secure settlement
            const smallAmount = AMOUNTS.TEN_TOKENS;
            expect(await secureSettle.requiresSecureSettlement(deployment.diamond.target, smallAmount)).to.be.false;
        });

        it("should return correct threshold for assets", async function () {
            const threshold = await secureSettle.getSecureSettleThreshold(deployment.diamond.target);
            expect(threshold).to.equal(DEFAULT_THRESHOLD);
            
            // Unconfigured asset should return default threshold
            const randomAsset = ethers.Wallet.createRandom().address;
            const defaultThreshold = await secureSettle.getSecureSettleThreshold(randomAsset);
            expect(defaultThreshold).to.equal(DEFAULT_THRESHOLD);
        });
    });

    describe("Edge Cases", function () {
        it("should handle settlement delay scaling based on USD value", async function () {
            // Test with very large amount that should increase delay
            const assets = [deployment.diamond.target];
            const amounts = [ethers.parseEther("2000000")]; // $2M equivalent
            const recipients = [user2.address];
            const description = "Large settlement";
            const requestedDelay = 0;

            const tx = await secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");

            const settlement = await secureSettle.getSettlement(event.args[0]);
            // Should have increased delay for large amount
            expect(settlement.executesAt - settlement.proposedAt).to.be.greaterThan(DEFAULT_DELAY);
        });
    });

    describe("Quarantine: wallet in recovery is blocked", function () {
        it("should block proposeMultiAssetSettlement when custodian is in recovery", async function () {
            const walletRecovery = deployment.facets.walletRecovery;
            if (!walletRecovery) {
                this.skip(); // walletRecovery not wired in this fixture
                return;
            }

            // Put custodian1 in recovery
            await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);

            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0;

            await expect(
                secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                    assets,
                    amounts,
                    recipients,
                    description,
                    requestedDelay
                )
            ).to.be.revertedWithCustomError(secureSettle, "WalletInRecovery");
        });

        it("should block approveSettlement when approver is in recovery", async function () {
            const walletRecovery = deployment.facets.walletRecovery;
            if (!walletRecovery) {
                this.skip();
                return;
            }

            // Create a settlement with custodian2
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0;

            const tx = await secureSettle.connect(custodian2).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            const settlementId = event.args[0];

            // Put custodian1 in recovery
            await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);

            await expect(
                secureSettle.connect(custodian1).approveSettlement(settlementId)
            ).to.be.revertedWithCustomError(secureSettle, "WalletInRecovery");
        });

        it("should block executeSettlement when executor is in recovery", async function () {
            const walletRecovery = deployment.facets.walletRecovery;
            if (!walletRecovery) {
                this.skip();
                return;
            }

            // Create and approve a settlement with custodian2
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0;

            const tx = await secureSettle.connect(custodian2).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            const settlementId = event.args[0];
            await secureSettle.connect(custodian1).approveSettlement(settlementId);

            // Put custodian1 in recovery
            await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);

            await time.increase(DEFAULT_DELAY + 1);

            await expect(
                secureSettle.connect(custodian1).executeSettlement(settlementId)
            ).to.be.revertedWithCustomError(secureSettle, "WalletInRecovery");
        });

        it("should block cancelSettlement when canceller is in recovery", async function () {
            const walletRecovery = deployment.facets.walletRecovery;
            if (!walletRecovery) {
                this.skip();
                return;
            }

            // Create a settlement with custodian2
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Test settlement";
            const requestedDelay = 0;

            const tx = await secureSettle.connect(custodian2).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            const settlementId = event.args[0];

            // Put custodian1 in recovery
            await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);

            await expect(
                secureSettle.connect(custodian1).cancelSettlement(settlementId, "Reason")
            ).to.be.revertedWithCustomError(secureSettle, "WalletInRecovery");
        });
    });

    describe("User-Requested Delay Override", function () {
        it("should allow user to request longer delay than system minimum", async function () {
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Settlement with extended delay";
            const requestedDelay = 4 * TIME.ONE_HOUR; // User wants 4 hours instead of 1 hour

            const tx = await secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            const settlementId = event.args[0];

            const settlement = await secureSettle.getSettlement(settlementId);
            const actualDelay = settlement.executesAt - settlement.proposedAt;

            // Should use user-requested delay
            expect(actualDelay).to.be.at.least(requestedDelay);
        });

        it("should use system minimum when user requests shorter delay", async function () {
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Settlement with short requested delay";
            const requestedDelay = 30 * 60; // User wants 30 minutes (less than system minimum)

            const tx = await secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            const settlementId = event.args[0];

            const settlement = await secureSettle.getSettlement(settlementId);
            const actualDelay = settlement.executesAt - settlement.proposedAt;

            // Should use system minimum (DEFAULT_DELAY or higher based on value)
            expect(actualDelay).to.be.at.least(DEFAULT_DELAY);
        });

        it("should use zero requestedDelay as system default", async function () {
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Settlement with default delay";
            const requestedDelay = 0;

            const tx = await secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            const settlementId = event.args[0];

            const settlement = await secureSettle.getSettlement(settlementId);
            const actualDelay = settlement.executesAt - settlement.proposedAt;

            // Should use system-calculated delay
            expect(actualDelay).to.be.at.least(DEFAULT_DELAY);
        });

        it("should respect user-requested delay for very large settlements", async function () {
            // Mint additional tokens for this test
            const largeAmount = ethers.parseEther("5000000"); // $5M equivalent
            await deployment.facets.mintBurn.connect(deployment.signers.minter).mint(custodian1.address, largeAmount);

            const assets = [deployment.diamond.target];
            const amounts = [largeAmount];
            const recipients = [user2.address];
            const description = "Very large settlement with extended user delay";
            const requestedDelay = 7 * TIME.ONE_DAY; // User wants 7 days

            const tx = await secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            const settlementId = event.args[0];

            const settlement = await secureSettle.getSettlement(settlementId);
            const actualDelay = settlement.executesAt - settlement.proposedAt;

            // Should use user-requested delay even if system would calculate less
            expect(actualDelay).to.be.at.least(requestedDelay);
        });

        it("should execute settlement only after user-requested delay", async function () {
            const assets = [deployment.diamond.target];
            const amounts = [TEST_AMOUNTS.LARGE];
            const recipients = [user2.address];
            const description = "Settlement with 3 hour delay";
            const requestedDelay = 3 * TIME.ONE_HOUR;

            const tx = await secureSettle.connect(custodian1).proposeMultiAssetSettlement(
                assets,
                amounts,
                recipients,
                description,
                requestedDelay
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(log => log.fragment?.name === "SettlementProposed");
            const settlementId = event.args[0];

            // Approve the settlement
            await secureSettle.connect(custodian2).approveSettlement(settlementId);

            // Try to execute before requested delay - should fail
            await time.increase(2 * TIME.ONE_HOUR);
            await expect(
                secureSettle.connect(custodian1).executeSettlement(settlementId)
            ).to.be.revertedWithCustomError(secureSettle, "SettlementNotReady");

            // After requested delay - should succeed
            await time.increase(2 * TIME.ONE_HOUR);
            await expect(
                secureSettle.connect(custodian1).executeSettlement(settlementId)
            ).to.not.be.reverted;
        });
    });
});

// Helper function for any value matching in events
function anyValue() {
    return {
        asymmetricMatch: () => true,
        toString: () => "<anyValue>"
    };
}