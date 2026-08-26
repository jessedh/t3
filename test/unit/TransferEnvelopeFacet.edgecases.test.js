const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");

/**
 * TransferEnvelopeFacet Edge Case Tests (FR-1002 + FR-1004)
 *
 * FR-1002 gaps covered:
 *   - HALFLIFE_DECAY: integer division truncation with small amounts
 *   - HALFLIFE_DECAY: exact midpoint precision
 *   - HALFLIFE_DECAY: very short windows (1 second)
 *   - ORACLE_CONDITIONAL: oracle responds AFTER timeout/expiration (rejected)
 *   - ORACLE_CONDITIONAL: processExpiration at exact commitWindowEnd boundary
 *   - Cross-behavior: AUTO_REVERSE with FIAT_INSTITUTIONAL settlement
 *   - Cross-behavior: IMMEDIATE_FINALIZE with FIAT_INSTITUTIONAL settlement
 *
 * FR-1004 gaps covered:
 *   - Dispute timeout boundary: resolve at exactly the timeout timestamp
 *   - Non-arbiter resolveDispute before timeout (rejected)
 *   - Partial split: 100/0 split (splitAmount == escrowed)
 *   - Partial split: 0/100 split (splitAmount == 0)
 *   - Partial split: odd wei amounts
 *   - Partial split: splitAmount > escrowed (capped)
 *   - Dispute on PENDING_FIAT_CONFIRMATION state (rejected)
 *   - Oracle callback after dispute raised (rejected — state is Disputed)
 *   - Re-dispute after resolution (rejected — terminal state)
 *   - resolveDispute on already-resolved dispute (rejected)
 */
describe("TransferEnvelopeFacet — Edge Cases (FR-1002 + FR-1004)", function () {
    // Constants
    const EB_IMMEDIATE_FINALIZE = 0;
    const EB_HALFLIFE_DECAY     = 1;
    const EB_HOLD_UNTIL_MANUAL  = 2;
    const EB_ORACLE_CONDITIONAL = 3;
    const EB_AUTO_REVERSE       = 4;
    const EB_DISPUTE_HOLD       = 5;

    const ST_CRYPTO_DIRECT      = 0;
    const ST_FIAT_INSTITUTIONAL = 1;

    const ES_CREATED      = 1;
    const ES_FINALIZED    = 2;
    const ES_REVERSED     = 3;
    const ES_DISPUTED     = 4;
    const ES_PENDING_FIAT = 6;

    const DO_FINALIZE_TO_RECIPIENT = 0;
    const DO_REVERSE_TO_SENDER     = 1;
    const DO_PARTIAL_SPLIT         = 2;

    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));

    let deployment;

    async function mint(to, amount) {
        await deployment.facets.mintBurn.connect(deployment.signers.owner).mint(to, amount);
    }

    async function createEnvelope({
        sender,
        recipient,
        amount,
        windowSeconds = 3600,
        expirationBehavior = EB_IMMEDIATE_FINALIZE,
        settlementType = ST_CRYPTO_DIRECT,
        conditionData = "0x"
    }) {
        const commitWindowEnd = (await time.latest()) + windowSeconds;
        const tx = await deployment.facets.envelope
            .connect(sender)
            .createEnvelope(
                recipient.address,
                amount,
                commitWindowEnd,
                settlementType,
                expirationBehavior,
                conditionData
            );
        const receipt = await tx.wait();

        const iface = new ethers.Interface([
            "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
        ]);
        const log = receipt.logs.find(l => iface.parseLog(l) !== null);
        const envelopeId = iface.parseLog(log).args.envelopeId;
        return { envelopeId, receipt, commitWindowEnd };
    }

    async function totalSupply() {
        return deployment.facets.erc20.totalSupply();
    }

    async function balanceOf(addr) {
        return deployment.facets.erc20.balanceOf(addr);
    }

    async function setupFixture() {
        deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        await grantRole(
            deployment.facets.accessControl,
            ORACLE_ROLE,
            deployment.signers.user3.address,
            deployment.signers.owner
        );

        return deployment;
    }

    beforeEach(async function () {
        deployment = await loadFixture(setupFixture);
    });

    // =========================================================================
    // FR-1002: HALFLIFE_DECAY edge cases
    // =========================================================================

    describe("FR-1002: HALFLIFE_DECAY edge cases", function () {
        it("integer division truncation: 1 wei amount becomes 0 reversible before midpoint", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = 1n; // 1 wei
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 100,
                expirationBehavior: EB_HALFLIFE_DECAY
            });

            // At midpoint: reversible = 1 * (100 - 50) / 100 = 0 (integer division)
            await time.increase(50);

            await expect(
                deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, 1n)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "ReversalExceedsRemaining");
        });

        it("integer division truncation: 3 wei with linear decay", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = 3n;
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3000,
                expirationBehavior: EB_HALFLIFE_DECAY
            });

            // Read actual envelope to compute exact values
            const [,,, commitWindowEnd,,,,createdAt] = await deployment.facets.envelope.getEnvelope(envelopeId);
            const window = Number(commitWindowEnd) - Number(createdAt);

            // Advance to 10% of window — reversible = 3 * 90% = 2 (integer truncation of 2.7)
            const targetElapsed = Math.floor(window * 0.1);
            await time.setNextBlockTimestamp(Number(createdAt) + targetElapsed);

            // 2 wei should succeed
            await deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, 2n);
            expect(await balanceOf(user1.address)).to.equal(2n);
        });

        it("very short window (10 seconds): reversible is 0 after window expires", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("1000");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 10,
                expirationBehavior: EB_HALFLIFE_DECAY
            });

            // Advance past the window
            await time.increase(11);

            await expect(
                deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, 1n)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "ReversalExceedsRemaining");
        });

        it("exact midpoint precision: reversible is exactly total * 50% (no off-by-one)", async function () {
            const { user1, user2 } = deployment.signers;
            // Use an amount that divides evenly by 2
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 1000,
                expirationBehavior: EB_HALFLIFE_DECAY
            });

            // Read actual envelope data for exact computation
            const [,,, commitWindowEnd,,,,createdAt] = await deployment.facets.envelope.getEnvelope(envelopeId);
            const window = Number(commitWindowEnd) - Number(createdAt);
            const midpoint = Number(createdAt) + Math.floor(window / 2);

            // Set next block to exact midpoint (no mining — TX will execute at this timestamp)
            await time.setNextBlockTimestamp(midpoint);

            // At midpoint: reversible = amount * (window - window/2) / window = amount / 2
            const halfAmount = amount / 2n;

            // Exactly half should succeed
            await deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, halfAmount);
            expect(await balanceOf(user1.address)).to.equal(halfAmount);
        });

        it("reversible amount after partial reversal uses remaining (amount - reversedAmount)", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 10000,
                expirationBehavior: EB_HALFLIFE_DECAY
            });

            // Reverse 40% immediately (within first seconds, ~100% reversible)
            const firstReverse = ethers.parseEther("40");
            await deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, firstReverse);

            // Advance to midpoint: remaining = 60, reversible = 60 * 50% = 30
            const createdAt = await time.latest();
            await time.increaseTo(createdAt + 5000);

            // Trying to reverse 35 of the remaining 60 should fail (~30 reversible)
            await expect(
                deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, ethers.parseEther("35"))
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "ReversalExceedsRemaining");

            // Reversing 25 (safely under ~30) should succeed
            await deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, ethers.parseEther("25"));
        });
    });

    // =========================================================================
    // FR-1002: ORACLE_CONDITIONAL edge cases
    // =========================================================================

    describe("FR-1002: ORACLE_CONDITIONAL edge cases", function () {
        async function setupOracleEnvelope(amount, windowSeconds = 3600) {
            const { user1, user2, user3, owner } = deployment.signers;
            await mint(user1.address, amount);

            const { envelopeId, commitWindowEnd } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds,
                expirationBehavior: EB_ORACLE_CONDITIONAL,
                conditionData: ethers.toUtf8Bytes("condition-hint")
            });

            await deployment.facets.envelope.connect(owner).registerOracle(
                envelopeId, user3.address, "0x12345678"
            );

            return { envelopeId, commitWindowEnd, user1, user2, user3, owner };
        }

        it("oracle callback AFTER processExpiration reversal is rejected (state is Reversed)", async function () {
            const amount = ethers.parseEther("100");
            const { envelopeId, user1, user3 } = await setupOracleEnvelope(amount, 3600);

            // Window expires, processExpiration reverses to sender
            await time.increase(3601);
            await deployment.facets.envelope.connect(user1).processExpiration(envelopeId);

            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED);

            // Late oracle callback should be rejected
            await expect(
                deployment.facets.envelope.connect(user3).receiveOracleCallback(envelopeId, true)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });

        it("processExpiration at exact commitWindowEnd boundary succeeds", async function () {
            const { user1, user2, user3, owner } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mint(user1.address, amount);

            const commitWindowEnd = (await time.latest()) + 3600;
            const tx = await deployment.facets.envelope.connect(user1).createEnvelope(
                user2.address, amount, commitWindowEnd, ST_CRYPTO_DIRECT, EB_ORACLE_CONDITIONAL,
                ethers.toUtf8Bytes("hint")
            );
            const receipt = await tx.wait();
            const iface = new ethers.Interface([
                "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
            ]);
            const log = receipt.logs.find(l => iface.parseLog(l) !== null);
            const envelopeId = iface.parseLog(log).args.envelopeId;

            await deployment.facets.envelope.connect(owner).registerOracle(
                envelopeId, user3.address, "0x12345678"
            );

            // Advance to exactly commitWindowEnd (not past it)
            await time.increaseTo(commitWindowEnd);

            // processExpiration checks `block.timestamp < env.commitWindowEnd` — at exact boundary it should pass
            await deployment.facets.envelope.connect(user1).processExpiration(envelopeId);

            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED, "oracle fallback reverses at exact window end");
        });

        it("processExpiration is no-op when oracle callback was already received", async function () {
            const amount = ethers.parseEther("100");
            const { envelopeId, user1, user2, user3 } = await setupOracleEnvelope(amount, 3600);

            // Oracle delivers callback (result=true → finalize)
            await deployment.facets.envelope.connect(user3).receiveOracleCallback(envelopeId, true);
            expect(await balanceOf(user2.address)).to.equal(amount);

            // Window expires, try processExpiration on already-finalized envelope
            await time.increase(3601);
            await expect(
                deployment.facets.envelope.connect(user1).processExpiration(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });

        it("keeper-triggered processExpiration with custom timeout (non-default window): rejects before, reverses after", async function () {
            // Use a non-standard 90-second window to confirm boundary enforcement is driven
            // by the per-envelope commitWindowEnd, not any hardcoded default.
            const CUSTOM_WINDOW = 90;
            const amount = ethers.parseEther("75");
            const { user1, user2, user3, owner } = deployment.signers;
            await mint(user1.address, amount);
            const senderAfterMint = await balanceOf(user1.address);

            const { envelopeId } = await setupOracleEnvelope(amount, CUSTOM_WINDOW);

            // Immediately after creation: window has not elapsed — must revert
            await expect(
                deployment.facets.envelope.connect(user1).processExpiration(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotExpired");

            // Advance past the custom window: keeper triggers processExpiration
            await time.increase(CUSTOM_WINDOW + 1);
            await deployment.facets.envelope.connect(user1).processExpiration(envelopeId);

            // No oracle callback received → reversal to sender
            const [,,,,,,state] = await deployment.facets.envelope.connect(user1).getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED, "custom-timeout keeper reversal succeeds");
            // senderAfterMint was pre-createEnvelope; after reversal both mints should be returned
            expect(await balanceOf(user1.address)).to.be.gt(0n);
        });
    });

    // =========================================================================
    // FR-1002: Cross-behavior with FIAT_INSTITUTIONAL settlement
    // =========================================================================

    describe("FR-1002: Cross-behavior with FIAT_INSTITUTIONAL", function () {
        it("AUTO_REVERSE + FIAT_INSTITUTIONAL: auto-reverses (no fiat path triggered)", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const senderBefore = await balanceOf(user1.address);
            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3600,
                expirationBehavior: EB_AUTO_REVERSE,
                settlementType: ST_FIAT_INSTITUTIONAL
            });

            await time.increase(3601);
            await deployment.facets.envelope.connect(user1).processExpiration(envelopeId);

            // AUTO_REVERSE always reverses — settlement type doesn't matter for reversals
            expect(await balanceOf(user1.address)).to.equal(senderBefore);
            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED);
        });

        it("IMMEDIATE_FINALIZE + FIAT_INSTITUTIONAL: processExpiration initiates provisional fiat", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3600,
                expirationBehavior: EB_IMMEDIATE_FINALIZE,
                settlementType: ST_FIAT_INSTITUTIONAL
            });

            await time.increase(3601);
            await deployment.facets.envelope.connect(user1).processExpiration(envelopeId);

            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_PENDING_FIAT, "should enter provisional fiat state");

            // Tokens should still be in escrow (not released to recipient)
            expect(await balanceOf(deployment.diamondAddress)).to.be.gte(amount);
        });

        it("HALFLIFE_DECAY + FIAT_INSTITUTIONAL: finalize triggers provisional fiat path", async function () {
            const { user1, user2, owner } = deployment.signers;
            const amount = ethers.parseEther("200");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3600,
                expirationBehavior: EB_HALFLIFE_DECAY,
                settlementType: ST_FIAT_INSTITUTIONAL
            });

            // Admin finalizes (sender/recipient can also finalize HALFLIFE)
            await deployment.facets.envelope.connect(user1).finalizeEnvelope(envelopeId);

            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_PENDING_FIAT, "FIAT_INSTITUTIONAL enters provisional state");
        });
    });

    // =========================================================================
    // FR-1004: Dispute timeout boundary
    // =========================================================================

    describe("FR-1004: Dispute timeout edge cases", function () {
        async function setupDisputedEnvelope() {
            const { user1, user2, owner } = deployment.signers;
            const amount = ethers.parseEther("300");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("test dispute")
            );

            // Get the timeout timestamp from dispute data
            const [, , timeoutAt] = await deployment.facets.envelope.getDispute(envelopeId);

            return { envelopeId, user1, user2, owner, amount, timeoutAt };
        }

        it("non-admin resolveDispute reverts 1 second before timeout", async function () {
            const { envelopeId, user2, timeoutAt } = await setupDisputedEnvelope();

            // setNextBlockTimestamp doesn't mine — the TX will execute at exactly this timestamp
            await time.setNextBlockTimestamp(Number(timeoutAt) - 1);

            await expect(
                deployment.facets.envelope.connect(user2).resolveDispute(
                    envelopeId, DO_FINALIZE_TO_RECIPIENT, 0
                )
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "CallerNotArbiter");
        });

        it("non-admin can trigger timeout resolution at exactly the timeout timestamp", async function () {
            const { envelopeId, user1, user2, amount, timeoutAt } = await setupDisputedEnvelope();

            // Set next block to exactly timeoutAt (TX executes at this timestamp)
            await time.setNextBlockTimestamp(Number(timeoutAt));

            // Non-admin triggers with FINALIZE_TO_RECIPIENT, but default (REVERSE_TO_SENDER) is enforced
            await deployment.facets.envelope.connect(user2).resolveDispute(
                envelopeId, DO_FINALIZE_TO_RECIPIENT, 0
            );

            // Default outcome is REVERSE_TO_SENDER
            expect(await balanceOf(user1.address)).to.equal(amount, "default outcome reverses to sender");
            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED);
        });

        it("admin can resolve with any outcome before timeout", async function () {
            const { envelopeId, user2, owner, amount } = await setupDisputedEnvelope();

            // Admin resolves immediately — no need to wait for timeout
            await deployment.facets.envelope.connect(owner).resolveDispute(
                envelopeId, DO_FINALIZE_TO_RECIPIENT, 0
            );

            expect(await balanceOf(user2.address)).to.equal(amount);
            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_FINALIZED);
        });

        it("resolveDispute on already-resolved dispute reverts", async function () {
            const { envelopeId, owner } = await setupDisputedEnvelope();

            await deployment.facets.envelope.connect(owner).resolveDispute(
                envelopeId, DO_REVERSE_TO_SENDER, 0
            );

            // Second resolution attempt — envelope is now in terminal state (Reversed)
            await expect(
                deployment.facets.envelope.connect(owner).resolveDispute(
                    envelopeId, DO_FINALIZE_TO_RECIPIENT, 0
                )
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });
    });

    // =========================================================================
    // FR-1004: Custom dispute timeout configuration
    // =========================================================================

    describe("FR-1004: Custom dispute timeout configuration", function () {
        it("dispute raised after setDefaultDisputeTimeout uses custom value, not 7-day default", async function () {
            const CUSTOM_TIMEOUT = 600; // 10 minutes, far shorter than 7-day default
            const { user1, user2, owner } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            // Configure custom dispute timeout
            await deployment.facets.envelope.connect(owner).setDefaultDisputeTimeout(CUSTOM_TIMEOUT);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            const disputeStart = await time.latest();
            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("custom timeout dispute")
            );

            const [, , timeoutAt] = await deployment.facets.envelope.connect(user1).getDispute(envelopeId);

            // Timeout should reflect the custom value, not 7 days
            const expectedTimeout = disputeStart + CUSTOM_TIMEOUT;
            expect(Number(timeoutAt)).to.be.closeTo(expectedTimeout, 5,
                "timeoutAt should reflect custom 10-minute timeout, not 7-day default");

            // Non-arbiter CANNOT resolve 1 second before custom timeout
            await time.setNextBlockTimestamp(Number(timeoutAt) - 1);
            await expect(
                deployment.facets.envelope.connect(user2).resolveDispute(
                    envelopeId, DO_REVERSE_TO_SENDER, 0
                )
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "CallerNotArbiter");

            // Non-arbiter CAN trigger default resolution at exactly the custom timeout
            await time.setNextBlockTimestamp(Number(timeoutAt));
            await deployment.facets.envelope.connect(user2).resolveDispute(
                envelopeId, DO_FINALIZE_TO_RECIPIENT, 0
            );

            // Default outcome is REVERSE_TO_SENDER regardless of requested outcome
            expect(await balanceOf(user1.address)).to.equal(amount, "default timeout outcome reverses to sender");
        });

        it("setDefaultDisputeTimeout(0) resets to 7-day default", async function () {
            const { user1, user2, owner } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mint(user1.address, amount);

            // Set custom then reset
            await deployment.facets.envelope.connect(owner).setDefaultDisputeTimeout(600);
            await deployment.facets.envelope.connect(owner).setDefaultDisputeTimeout(0);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            const disputeStart = await time.latest();
            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("reset to default")
            );

            const [, , timeoutAt] = await deployment.facets.envelope.connect(user1).getDispute(envelopeId);
            const SEVEN_DAYS = 7 * 24 * 3600;
            expect(Number(timeoutAt)).to.be.closeTo(disputeStart + SEVEN_DAYS, 5,
                "after reset, timeout should be 7-day default");
        });
    });

    // =========================================================================
    // FR-1004: Partial split edge cases
    // =========================================================================

    describe("FR-1004: Partial split edge cases", function () {
        async function setupDisputedEnvelope(amount) {
            const { user1, user2, owner } = deployment.signers;
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("split dispute")
            );

            return { envelopeId, user1, user2, owner, amount };
        }

        it("100/0 split: splitAmount == escrowed gives all to recipient", async function () {
            const amount = ethers.parseEther("100");
            const { envelopeId, user1, user2, owner } = await setupDisputedEnvelope(amount);

            const senderBefore = await balanceOf(user1.address);
            await deployment.facets.envelope.connect(owner).resolveDispute(
                envelopeId, DO_PARTIAL_SPLIT, amount
            );

            expect(await balanceOf(user2.address)).to.equal(amount, "recipient gets 100%");
            expect(await balanceOf(user1.address)).to.equal(senderBefore, "sender gets 0");
        });

        it("0/100 split: splitAmount == 0 gives all to sender", async function () {
            const amount = ethers.parseEther("100");
            const { envelopeId, user1, user2, owner } = await setupDisputedEnvelope(amount);

            await deployment.facets.envelope.connect(owner).resolveDispute(
                envelopeId, DO_PARTIAL_SPLIT, 0n
            );

            expect(await balanceOf(user1.address)).to.equal(amount, "sender gets 100%");
            expect(await balanceOf(user2.address)).to.equal(0n, "recipient gets 0");
        });

        it("odd wei amounts: 7 wei split 3/4 with no rounding loss", async function () {
            const amount = 7n;
            const { envelopeId, user1, user2, owner } = await setupDisputedEnvelope(amount);

            const recipientShare = 3n;
            const senderShare = 4n; // 7 - 3

            await deployment.facets.envelope.connect(owner).resolveDispute(
                envelopeId, DO_PARTIAL_SPLIT, recipientShare
            );

            expect(await balanceOf(user2.address)).to.equal(recipientShare);
            expect(await balanceOf(user1.address)).to.equal(senderShare);

            // Total supply preserved
            const supply = await totalSupply();
            expect(supply).to.equal(amount, "no tokens lost in split");
        });

        it("splitAmount exceeding escrowed is capped to escrowed", async function () {
            const amount = ethers.parseEther("50");
            const { envelopeId, user2, owner } = await setupDisputedEnvelope(amount);

            // Split with amount > escrowed — contract caps it
            await deployment.facets.envelope.connect(owner).resolveDispute(
                envelopeId, DO_PARTIAL_SPLIT, ethers.parseEther("999")
            );

            // Recipient gets capped amount (= escrowed), sender gets 0
            expect(await balanceOf(user2.address)).to.equal(amount, "capped to escrowed amount");
        });

        it("partial split after prior HALFLIFE partial reversal", async function () {
            const { user1, user2, owner } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 10000,
                expirationBehavior: EB_HALFLIFE_DECAY
            });

            // Partial reversal of 30 tokens
            const reversed = ethers.parseEther("30");
            await deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, reversed);

            // Raise dispute on remaining 70
            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("dispute after partial")
            );

            // Split: recipient gets 40, sender gets 30 of the remaining 70
            const recipientShare = ethers.parseEther("40");
            await deployment.facets.envelope.connect(owner).resolveDispute(
                envelopeId, DO_PARTIAL_SPLIT, recipientShare
            );

            const senderExpected = reversed + (amount - reversed - recipientShare);
            expect(await balanceOf(user1.address)).to.equal(senderExpected);
            expect(await balanceOf(user2.address)).to.equal(recipientShare);
            expect(await totalSupply()).to.equal(amount, "supply preserved");
        });
    });

    // =========================================================================
    // FR-1004: Dispute interaction with other states
    // =========================================================================

    describe("FR-1004: Dispute state interactions", function () {
        it("raiseDispute on PENDING_FIAT_CONFIRMATION state reverts", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE,
                settlementType: ST_FIAT_INSTITUTIONAL
            });

            // Finalize → transitions to PENDING_FIAT
            await deployment.facets.envelope.connect(user1).finalizeEnvelope(envelopeId);

            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_PENDING_FIAT);

            // Cannot raise dispute on PENDING_FIAT (requires CREATED)
            await expect(
                deployment.facets.envelope.connect(user1).raiseDispute(
                    envelopeId, ethers.toUtf8Bytes("too late")
                )
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });

        it("oracle callback rejected when envelope is in Disputed state", async function () {
            const { user1, user2, user3, owner } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_ORACLE_CONDITIONAL,
                conditionData: ethers.toUtf8Bytes("hint")
            });

            await deployment.facets.envelope.connect(owner).registerOracle(
                envelopeId, user3.address, "0x12345678"
            );

            // Raise dispute before oracle responds
            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("dispute before oracle")
            );

            // Oracle tries to deliver callback — rejected because state is Disputed, not Created
            await expect(
                deployment.facets.envelope.connect(user3).receiveOracleCallback(envelopeId, true)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });

        it("re-dispute after resolution reverts (terminal state)", async function () {
            const { user1, user2, owner } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            // First dispute + resolution
            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("first")
            );
            await deployment.facets.envelope.connect(owner).resolveDispute(
                envelopeId, DO_FINALIZE_TO_RECIPIENT, 0
            );

            // Attempt to re-dispute after finalization (terminal state)
            await expect(
                deployment.facets.envelope.connect(user1).raiseDispute(
                    envelopeId, ethers.toUtf8Bytes("second attempt")
                )
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });

        it("processExpiration reverts on disputed envelope", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3600,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("dispute")
            );

            await time.increase(3601);

            // processExpiration requires CREATED state — Disputed is not valid
            await expect(
                deployment.facets.envelope.connect(user1).processExpiration(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });
    });
});
