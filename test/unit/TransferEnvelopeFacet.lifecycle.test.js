const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");

/**
 * TransferEnvelopeFacet Core Lifecycle Tests (FR-1001)
 *
 * Covers the full envelope state machine for all 6 expiration behaviors:
 *   EB=0  IMMEDIATE_FINALIZE   — auto-finalize at commitWindowEnd
 *   EB=1  HALFLIFE_DECAY       — reversibility decays over time
 *   EB=2  HOLD_UNTIL_MANUAL    — admin/arbiter only release
 *   EB=3  ORACLE_CONDITIONAL   — external oracle determines outcome
 *   EB=4  AUTO_REVERSE         — auto-reverse at commitWindowEnd
 *   EB=5  DISPUTE_HOLD         — admin-controlled, not auto-processable
 *
 * All tests use CRYPTO_DIRECT settlement (type 0) so they remain valid
 * after FR-1003 changes the FIAT_INSTITUTIONAL path.
 *
 * Escrow model: sender tokens → diamond (escrowed) → recipient or sender (released).
 * Total supply is always preserved — create/finalize/reverse never mint or burn.
 */
describe("TransferEnvelopeFacet — Core Lifecycle (FR-1001)", function () {
    // Expiration behavior constants
    const EB_IMMEDIATE_FINALIZE = 0;
    const EB_HALFLIFE_DECAY     = 1;
    const EB_HOLD_UNTIL_MANUAL  = 2;
    const EB_ORACLE_CONDITIONAL = 3;
    const EB_AUTO_REVERSE       = 4;
    const EB_DISPUTE_HOLD       = 5;

    // Settlement type constants
    const ST_CRYPTO_DIRECT = 0;

    // Envelope state constants
    const ES_CREATED   = 1;
    const ES_FINALIZED = 2;
    const ES_REVERSED  = 3;
    const ES_DISPUTED  = 4;

    // Dispute outcome constants
    const DO_FINALIZE_TO_RECIPIENT = 0;
    const DO_REVERSE_TO_SENDER     = 1;
    const DO_PARTIAL_SPLIT         = 2;

    const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));

    let deployment;

    // Helper: mint tokens to an address
    async function mint(to, amount) {
        await deployment.facets.mintBurn.connect(deployment.signers.owner).mint(to, amount);
    }

    // Helper: create a basic envelope; returns { envelopeId, receipt }
    async function createEnvelope({
        sender,
        recipient,
        amount,
        windowSeconds = 3600,
        expirationBehavior = EB_IMMEDIATE_FINALIZE,
        conditionData = "0x"
    }) {
        const commitWindowEnd = (await time.latest()) + windowSeconds;
        const tx = await deployment.facets.envelope
            .connect(sender)
            .createEnvelope(
                recipient.address,
                amount,
                commitWindowEnd,
                ST_CRYPTO_DIRECT,
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

    // Helper: total ERC-20 supply
    async function totalSupply() {
        return deployment.facets.erc20.totalSupply();
    }

    // Helper: ERC-20 balance
    async function balanceOf(addr) {
        return deployment.facets.erc20.balanceOf(addr);
    }

    async function setupFixture() {
        deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        // Grant ORACLE_ROLE to user3 for oracle tests
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
    // createEnvelope — creation and escrow
    // =========================================================================

    describe("createEnvelope", function () {
        it("escrows tokens from sender into diamond on creation", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const supplyBefore = await totalSupply();
            const senderBefore = await balanceOf(user1.address);
            const diamondBefore = await balanceOf(deployment.diamondAddress);

            await createEnvelope({ sender: user1, recipient: user2, amount });

            expect(await totalSupply()).to.equal(supplyBefore,       "total supply must not change on create");
            expect(await balanceOf(user1.address)).to.equal(senderBefore - amount, "sender balance reduced");
            expect(await balanceOf(deployment.diamondAddress)).to.equal(diamondBefore + amount, "diamond holds escrow");
        });

        it("returns a unique envelopeId and stores correct envelope data", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mint(user1.address, amount * 2n);

            const { envelopeId: id1 } = await createEnvelope({ sender: user1, recipient: user2, amount });
            const { envelopeId: id2 } = await createEnvelope({ sender: user1, recipient: user2, amount });

            expect(id1).to.not.equal(id2, "each envelope gets a unique ID");

            const [sender, recipient, storedAmount,,,, state] = await deployment.facets.envelope.getEnvelope(id1);
            expect(sender).to.equal(user1.address);
            expect(recipient).to.equal(user2.address);
            expect(storedAmount).to.equal(amount);
            expect(state).to.equal(ES_CREATED);
        });

        it("reverts if sender has insufficient balance", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("1");
            // No mint — user1 has zero balance

            await expect(
                createEnvelope({ sender: user1, recipient: user2, amount })
            ).to.be.reverted;
        });

        it("ORACLE_CONDITIONAL reverts if conditionData is empty", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mint(user1.address, amount);

            const commitWindowEnd = (await time.latest()) + 3600;
            await expect(
                deployment.facets.envelope.connect(user1).createEnvelope(
                    user2.address, amount, commitWindowEnd, ST_CRYPTO_DIRECT, EB_ORACLE_CONDITIONAL, "0x"
                )
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "ConditionDataRequired");
        });
    });

    // =========================================================================
    // EB=0: IMMEDIATE_FINALIZE
    // =========================================================================

    describe("IMMEDIATE_FINALIZE (EB=0)", function () {
        it("happy path: tokens move from diamond escrow to recipient on finalize", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("200");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            const supplyBefore = await totalSupply();
            const recipientBefore = await balanceOf(user2.address);
            const diamondBefore = await balanceOf(deployment.diamondAddress);

            await deployment.facets.envelope.connect(user2).finalizeEnvelope(envelopeId);

            expect(await totalSupply()).to.equal(supplyBefore,                    "supply unchanged");
            expect(await balanceOf(user2.address)).to.equal(recipientBefore + amount, "recipient received tokens");
            expect(await balanceOf(deployment.diamondAddress)).to.equal(diamondBefore - amount, "escrow released");

            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_FINALIZED);
        });

        it("auto-finalizes via processExpiration after window expires", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3600,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            await time.increase(3601);

            await deployment.facets.envelope.connect(user1).processExpiration(envelopeId);

            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_FINALIZED);
            expect(await balanceOf(user2.address)).to.equal(amount);
        });

        it("cannot finalize twice", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            await deployment.facets.envelope.connect(user2).finalizeEnvelope(envelopeId);

            await expect(
                deployment.facets.envelope.connect(user2).finalizeEnvelope(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });

        it("cannot reverse after finalized", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            await deployment.facets.envelope.connect(user2).finalizeEnvelope(envelopeId);

            await expect(
                deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, amount)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });

        it("sender can reverse before window expires", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const senderBefore = await balanceOf(user1.address);
            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            await deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, amount);

            expect(await balanceOf(user1.address)).to.equal(senderBefore, "full refund to sender");
            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED);
        });
    });

    // =========================================================================
    // EB=4: AUTO_REVERSE
    // =========================================================================

    describe("AUTO_REVERSE (EB=4)", function () {
        it("returns tokens to sender via processExpiration after window", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const senderBefore = await balanceOf(user1.address);
            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3600, expirationBehavior: EB_AUTO_REVERSE
            });

            await time.increase(3601);
            await deployment.facets.envelope.connect(user1).processExpiration(envelopeId);

            expect(await balanceOf(user1.address)).to.equal(senderBefore, "sender gets full refund");
            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED);
        });

        it("calling finalizeEnvelope after window triggers auto-reverse instead", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3600, expirationBehavior: EB_AUTO_REVERSE
            });

            await time.increase(3601);

            // finalizeEnvelope internally calls _processExpirationOnFinalize which auto-reverses
            await deployment.facets.envelope.connect(user2).finalizeEnvelope(envelopeId);

            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED);
            expect(await balanceOf(user1.address)).to.equal(amount);
            expect(await balanceOf(user2.address)).to.equal(0n);
        });

        it("processExpiration reverts before window has expired", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_AUTO_REVERSE
            });

            await expect(
                deployment.facets.envelope.connect(user1).processExpiration(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotExpired");
        });
    });

    // =========================================================================
    // EB=1: HALFLIFE_DECAY
    // =========================================================================

    describe("HALFLIFE_DECAY (EB=1)", function () {
        it("reversal of ~100% of amount succeeds immediately after creation", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 7 * 24 * 3600,  // 7-day window makes per-block decay negligible
                expirationBehavior: EB_HALFLIFE_DECAY
            });

            // At creation, ~100% reversible. Use 99.9% to accommodate 1-2 block elapsed time.
            const reverseAmount = amount * 999n / 1000n;
            await deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, reverseAmount);

            expect(await balanceOf(user1.address)).to.be.gte(reverseAmount,
                "sender recovers near-full amount immediately after creation");
        });

        it("reversible amount decays to ~50% at window midpoint", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("1000");
            const windowSeconds = 3600;
            await mint(user1.address, amount);

            const { envelopeId, commitWindowEnd } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds, expirationBehavior: EB_HALFLIFE_DECAY
            });

            // Advance to 50% of the window
            const createdAt = await time.latest();
            const halfwayPoint = createdAt + Math.floor(windowSeconds / 2);
            await time.increaseTo(halfwayPoint);

            // Attempt to reverse the full amount — should fail (only ~50% reversible)
            await expect(
                deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, amount)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "ReversalExceedsRemaining");

            // Reversing 45% should succeed (safely below the ~50% reversible at midpoint)
            const halfAmount = amount * 45n / 100n;
            await deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, halfAmount);

            const senderBalance = await balanceOf(user1.address);
            expect(senderBalance).to.be.closeTo(halfAmount, ethers.parseEther("1"),
                "sender should have recovered ~50% at window midpoint");
        });

        it("reversible amount is 0 at or after window end", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3600, expirationBehavior: EB_HALFLIFE_DECAY
            });

            await time.increase(3601);

            await expect(
                deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, 1n)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "ReversalExceedsRemaining");
        });

        it("partial reversal keeps envelope in Created state; remaining can be finalized", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_HALFLIFE_DECAY
            });

            const partial = ethers.parseEther("30");
            await deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, partial);

            // State should still be Created after partial reversal
            const [,,,,,,state,,reversedAmount] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_CREATED, "still Created after partial reversal");
            expect(reversedAmount).to.equal(partial);

            // Finalize the remaining 70
            const supplyBefore = await totalSupply();
            await deployment.facets.envelope.connect(user2).finalizeEnvelope(envelopeId);

            expect(await totalSupply()).to.equal(supplyBefore, "supply unchanged on finalize");
            expect(await balanceOf(user2.address)).to.equal(amount - partial, "recipient gets remainder");
        });
    });

    // =========================================================================
    // EB=2: HOLD_UNTIL_MANUAL
    // =========================================================================

    describe("HOLD_UNTIL_MANUAL (EB=2)", function () {
        it("non-admin cannot finalize a HOLD_UNTIL_MANUAL envelope", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_HOLD_UNTIL_MANUAL
            });

            await expect(
                deployment.facets.envelope.connect(user2).finalizeEnvelope(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "CallerNotArbiter");
        });

        it("admin can finalize a HOLD_UNTIL_MANUAL envelope", async function () {
            const { user1, user2, owner } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_HOLD_UNTIL_MANUAL
            });

            await deployment.facets.envelope.connect(owner).finalizeEnvelope(envelopeId);

            expect(await balanceOf(user2.address)).to.equal(amount);
            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_FINALIZED);
        });

        it("admin can reverse a HOLD_UNTIL_MANUAL envelope", async function () {
            const { user1, user2, owner } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const senderBefore = await balanceOf(user1.address);
            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_HOLD_UNTIL_MANUAL
            });

            await deployment.facets.envelope.connect(owner).reverseEnvelope(envelopeId, amount);

            expect(await balanceOf(user1.address)).to.equal(senderBefore);
        });

        it("processExpiration reverts for HOLD_UNTIL_MANUAL even after window expires", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3600, expirationBehavior: EB_HOLD_UNTIL_MANUAL
            });

            await time.increase(3601); // window expires — but HOLD_UNTIL_MANUAL still can't be auto-processed

            await expect(
                deployment.facets.envelope.connect(user1).processExpiration(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotExpired");
        });
    });

    // =========================================================================
    // EB=3: ORACLE_CONDITIONAL
    // =========================================================================

    describe("ORACLE_CONDITIONAL (EB=3)", function () {
        // user3 has ORACLE_ROLE and will act as the oracle EOA
        async function setupOracleEnvelope(amount) {
            const { user1, user2, user3, owner } = deployment.signers;
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_ORACLE_CONDITIONAL,
                conditionData: ethers.toUtf8Bytes("condition-hint")
            });

            // Register user3 as the oracle (owner has admin role)
            await deployment.facets.envelope.connect(owner).registerOracle(
                envelopeId,
                user3.address,
                "0x12345678"
            );

            return { envelopeId, user1, user2, user3, owner };
        }

        it("oracle result=true finalizes the envelope to recipient", async function () {
            const amount = ethers.parseEther("100");
            const { envelopeId, user2, user3 } = await setupOracleEnvelope(amount);

            await deployment.facets.envelope.connect(user3).receiveOracleCallback(envelopeId, true);

            expect(await balanceOf(user2.address)).to.equal(amount);
            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_FINALIZED);
        });

        it("oracle result=false reverses the envelope to sender", async function () {
            const amount = ethers.parseEther("100");
            const { envelopeId, user1, user3 } = await setupOracleEnvelope(amount);

            const senderBefore = await balanceOf(user1.address);
            await deployment.facets.envelope.connect(user3).receiveOracleCallback(envelopeId, false);

            expect(await balanceOf(user1.address)).to.equal(senderBefore + amount);
            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED);
        });

        it("replay protection: oracle cannot submit callback twice", async function () {
            const amount = ethers.parseEther("50");
            const { envelopeId, user3 } = await setupOracleEnvelope(amount);

            await deployment.facets.envelope.connect(user3).receiveOracleCallback(envelopeId, true);

            await expect(
                deployment.facets.envelope.connect(user3).receiveOracleCallback(envelopeId, true)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });

        it("unauthorized caller cannot submit oracle callback", async function () {
            const amount = ethers.parseEther("50");
            const { envelopeId, user2 } = await setupOracleEnvelope(amount);

            await expect(
                deployment.facets.envelope.connect(user2).receiveOracleCallback(envelopeId, true)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "OracleCallbackUnauthorized");
        });

        it("safe fallback: no oracle callback before window — processExpiration reverses to sender", async function () {
            const { user1, user2, user3, owner } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3600, expirationBehavior: EB_ORACLE_CONDITIONAL,
                conditionData: ethers.toUtf8Bytes("condition-hint")
            });

            await deployment.facets.envelope.connect(owner).registerOracle(
                envelopeId, user3.address, "0x12345678"
            );

            // Oracle never responds — window expires
            await time.increase(3601);

            const senderBefore = await balanceOf(user1.address);
            await deployment.facets.envelope.connect(user1).processExpiration(envelopeId);

            expect(await balanceOf(user1.address)).to.equal(senderBefore + amount, "safe fallback returns to sender");
            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED);
        });
    });

    // =========================================================================
    // EB=5: DISPUTE_HOLD
    // =========================================================================

    describe("DISPUTE_HOLD (EB=5)", function () {
        it("admin can finalize a DISPUTE_HOLD envelope", async function () {
            const { user1, user2, owner } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_DISPUTE_HOLD
            });

            await deployment.facets.envelope.connect(owner).finalizeEnvelope(envelopeId);
            expect(await balanceOf(user2.address)).to.equal(amount);
        });

        it("processExpiration reverts for DISPUTE_HOLD even after window expires", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                windowSeconds: 3600, expirationBehavior: EB_DISPUTE_HOLD
            });

            await time.increase(3601); // window expires — but DISPUTE_HOLD still can't be auto-processed

            await expect(
                deployment.facets.envelope.connect(user1).processExpiration(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotExpired");
        });
    });

    // =========================================================================
    // Dispute flow (applies to any expiration behavior)
    // =========================================================================

    describe("Dispute flow", function () {
        async function setupDisputeEnvelope() {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("300");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            return { envelopeId, user1, user2, amount };
        }

        it("raiseDispute transitions envelope to Disputed state", async function () {
            const { envelopeId, user1 } = await setupDisputeEnvelope();

            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("incorrect amount")
            );

            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_DISPUTED);
        });

        it("cannot finalize or reverse while disputed", async function () {
            const { envelopeId, user1, user2 } = await setupDisputeEnvelope();

            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("dispute reason")
            );

            await expect(
                deployment.facets.envelope.connect(user2).finalizeEnvelope(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");

            await expect(
                deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });

        it("resolveDispute FINALIZE_TO_RECIPIENT sends full amount to recipient", async function () {
            const { envelopeId, user1, user2, amount } = await setupDisputeEnvelope();
            const { owner } = deployment.signers;

            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("dispute")
            );

            await deployment.facets.envelope.connect(owner).resolveDispute(
                envelopeId, DO_FINALIZE_TO_RECIPIENT, 0
            );

            expect(await balanceOf(user2.address)).to.equal(amount);
            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_FINALIZED);
        });

        it("resolveDispute REVERSE_TO_SENDER returns full amount to sender", async function () {
            const { envelopeId, user1, amount } = await setupDisputeEnvelope();
            const { owner } = deployment.signers;

            // user1 had all tokens escrowed after createEnvelope; balance is 0 here
            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("dispute")
            );
            await deployment.facets.envelope.connect(owner).resolveDispute(
                envelopeId, DO_REVERSE_TO_SENDER, 0
            );

            expect(await balanceOf(user1.address)).to.equal(amount, "sender gets minted amount back");
            const [,,,,,,state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED);
        });

        it("resolveDispute PARTIAL_SPLIT splits amount between sender and recipient", async function () {
            const { envelopeId, user1, user2, amount } = await setupDisputeEnvelope();
            const { owner } = deployment.signers;

            const senderBefore = await balanceOf(user1.address);
            const recipientBefore = await balanceOf(user2.address);
            const recipientShare = amount / 3n;
            const senderShare = amount - recipientShare;

            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("dispute")
            );
            await deployment.facets.envelope.connect(owner).resolveDispute(
                envelopeId, DO_PARTIAL_SPLIT, recipientShare
            );

            expect(await balanceOf(user2.address)).to.equal(recipientBefore + recipientShare);
            expect(await balanceOf(user1.address)).to.equal(senderBefore + senderShare);
        });

        it("timeout-based default resolution: anyone can trigger after timeout", async function () {
            const { envelopeId, user1, user2, amount } = await setupDisputeEnvelope();

            const senderBefore = await balanceOf(user1.address);

            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("dispute")
            );

            // Default outcome is REVERSE_TO_SENDER (safe default, set in raiseDispute)
            // Advance past the 7-day default dispute timeout
            await time.increase(7 * 24 * 3600 + 1);

            // Anyone can trigger timeout resolution
            await deployment.facets.envelope.connect(user2).resolveDispute(
                envelopeId, DO_FINALIZE_TO_RECIPIENT, 0  // outcome param ignored on timeout
            );

            // Default outcome (REVERSE_TO_SENDER) should be applied, not the caller's param
            // user1 minted `amount` then escrowed it; after reverse they get it back
            expect(await balanceOf(user1.address)).to.equal(amount,
                "default outcome is reverse-to-sender");
        });
    });

    // =========================================================================
    // Escrow accounting invariants
    // =========================================================================

    describe("Escrow accounting invariants", function () {
        it("total supply is preserved through full create → finalize lifecycle", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("500");
            await mint(user1.address, amount);

            const supplySnapshot = await totalSupply();

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            expect(await totalSupply()).to.equal(supplySnapshot, "supply unchanged after create");

            await deployment.facets.envelope.connect(user2).finalizeEnvelope(envelopeId);

            expect(await totalSupply()).to.equal(supplySnapshot, "supply unchanged after finalize");
        });

        it("total supply is preserved through create → reverse lifecycle", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("500");
            await mint(user1.address, amount);

            const supplySnapshot = await totalSupply();

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            await deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, amount);

            expect(await totalSupply()).to.equal(supplySnapshot, "supply unchanged after reverse");
        });

        it("diamond escrow balance equals sum of all active envelope amounts", async function () {
            const { user1, user2, user3 } = deployment.signers;
            const amount1 = ethers.parseEther("100");
            const amount2 = ethers.parseEther("250");
            await mint(user1.address, amount1 + amount2);

            const diamondBefore = await balanceOf(deployment.diamondAddress);

            const { envelopeId: id1 } = await createEnvelope({
                sender: user1, recipient: user2, amount: amount1,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });
            const { envelopeId: id2 } = await createEnvelope({
                sender: user1, recipient: user3, amount: amount2,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            expect(await balanceOf(deployment.diamondAddress))
                .to.equal(diamondBefore + amount1 + amount2, "escrow = sum of active envelopes");

            await deployment.facets.envelope.connect(user2).finalizeEnvelope(id1);

            expect(await balanceOf(deployment.diamondAddress))
                .to.equal(diamondBefore + amount2, "escrow reduced after first finalize");

            await deployment.facets.envelope.connect(user3).finalizeEnvelope(id2);

            expect(await balanceOf(deployment.diamondAddress))
                .to.equal(diamondBefore, "escrow empty after all finalized");
        });
    });

    // =========================================================================
    // Edge cases
    // =========================================================================

    describe("Edge cases", function () {
        it("finalizeEnvelope on non-existent envelope reverts", async function () {
            const fakeId = ethers.keccak256(ethers.toUtf8Bytes("fake"));
            await expect(
                deployment.facets.envelope.connect(deployment.signers.user1).finalizeEnvelope(fakeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotFound");
        });

        it("reverseEnvelope for more than escrowed amount reverts", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            await expect(
                deployment.facets.envelope.connect(user1).reverseEnvelope(envelopeId, amount + 1n)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "ReversalExceedsRemaining");
        });

        it("cannot raise two disputes on the same envelope", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mint(user1.address, amount);

            const { envelopeId } = await createEnvelope({
                sender: user1, recipient: user2, amount,
                expirationBehavior: EB_IMMEDIATE_FINALIZE
            });

            await deployment.facets.envelope.connect(user1).raiseDispute(
                envelopeId, ethers.toUtf8Bytes("first dispute")
            );

            await expect(
                deployment.facets.envelope.connect(user2).raiseDispute(
                    envelopeId, ethers.toUtf8Bytes("second dispute")
                )
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotInState");
        });

        it("getEnvelopesBySender and getEnvelopesByRecipient return correct IDs", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mint(user1.address, amount * 3n);

            const { envelopeId: id1 } = await createEnvelope({ sender: user1, recipient: user2, amount });
            const { envelopeId: id2 } = await createEnvelope({ sender: user1, recipient: user2, amount });
            const { envelopeId: id3 } = await createEnvelope({ sender: user1, recipient: user2, amount });

            const bySender = await deployment.facets.envelope.getEnvelopesBySender(user1.address);
            expect(bySender).to.include(id1).and.include(id2).and.include(id3);

            const byRecipient = await deployment.facets.envelope.getEnvelopesByRecipient(user2.address);
            expect(byRecipient).to.include(id1).and.include(id2).and.include(id3);
        });
    });
});
