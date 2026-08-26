const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");

/**
 * TransferEnvelopeFacet FR-1003: FIAT_INSTITUTIONAL Settlement Tests
 *
 * Tests the provisional settlement model:
 *   - createEnvelope with settlementType=1 (FIAT_INSTITUTIONAL)
 *   - finalizeEnvelope → ES_PENDING_FIAT + FiatSettlementTriggered event
 *   - confirmFiatDelivery → ES_FINALIZED + tokens burned from escrow
 *   - clawbackSettlement → ES_REVERSED + tokens returned to sender
 *   - processExpiration auto-confirm after clawbackDeadline passes
 *   - clawbackSettlement reverts after clawbackDeadline
 *   - Only admin can call confirmFiatDelivery / clawbackSettlement
 *   - CRYPTO_DIRECT is unaffected by fiat settlement path
 */
describe("TransferEnvelopeFacet — FR-1003: FIAT_INSTITUTIONAL Settlement", function () {
    let deployment;

    const ST_CRYPTO_DIRECT      = 0;
    const ST_FIAT_INSTITUTIONAL = 1;
    const EB_IMMEDIATE_FINALIZE = 0;
    const EB_AUTO_REVERSE       = 4;

    const ES_CREATED      = 1;
    const ES_FINALIZED    = 2;
    const ES_REVERSED     = 3;
    const ES_PENDING_FIAT = 6;

    async function setupFixture() {
        deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        return deployment;
    }

    beforeEach(async function () {
        deployment = await loadFixture(setupFixture);
    });

    // =========================================================================
    // Helpers
    // =========================================================================

    async function createFiatEnvelope(overrides = {}) {
        const { envelope, mintBurn, signers } = deployment.facets;
        const owner = signers || deployment.signers;
        const sender    = deployment.signers.user1;
        const recipient = deployment.signers.user2;
        const amount    = overrides.amount    ?? ethers.parseEther("100");
        const behavior  = overrides.behavior  ?? EB_IMMEDIATE_FINALIZE;

        await mintBurn.connect(deployment.signers.owner).mint(sender.address, amount);

        const windowEnd = (await time.latest()) + 3600;
        const tx = await envelope.connect(sender).createEnvelope(
            recipient.address,
            amount,
            windowEnd,
            ST_FIAT_INSTITUTIONAL,
            behavior,
            "0x"
        );
        const receipt = await tx.wait();

        const iface = new ethers.Interface([
            "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
        ]);
        const log = receipt.logs.find(l => iface.parseLog(l) !== null);
        const envelopeId = iface.parseLog(log).args.envelopeId;

        return { envelopeId, sender, recipient, amount, windowEnd };
    }

    // =========================================================================
    // Creating FIAT_INSTITUTIONAL envelopes
    // =========================================================================

    describe("Creating FIAT_INSTITUTIONAL envelopes", function () {
        it("createEnvelope with settlementType=1 succeeds and escrows tokens", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId, sender, amount } = await createFiatEnvelope();

            const [,,storedAmount,,settlementType,,state] = await envelope.getEnvelope(envelopeId);
            expect(storedAmount).to.equal(amount);
            expect(settlementType).to.equal(ST_FIAT_INSTITUTIONAL);
            expect(state).to.equal(ES_CREATED);

            // Tokens are escrowed in the diamond
            const diamondBalance = await deployment.facets.erc20.balanceOf(deployment.diamond);
            expect(diamondBalance).to.be.gte(amount);

            // Sender's balance is reduced
            const senderBalance = await deployment.facets.erc20.balanceOf(sender.address);
            expect(senderBalance).to.equal(0);
        });
    });

    // =========================================================================
    // finalizeEnvelope → PENDING_FIAT
    // =========================================================================

    describe("finalizeEnvelope → ES_PENDING_FIAT transition", function () {
        it("transitions to PendingFiatConfirmation instead of Finalized", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId, sender } = await createFiatEnvelope();

            await envelope.connect(sender).finalizeEnvelope(envelopeId);

            const [,,,,,, state] = await envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_PENDING_FIAT);
        });

        it("tokens remain escrowed in diamond during PendingFiatConfirmation", async function () {
            const { envelope, erc20 } = deployment.facets;
            const { envelopeId, sender, amount } = await createFiatEnvelope();

            const escrowBefore = await erc20.balanceOf(deployment.diamond);
            await envelope.connect(sender).finalizeEnvelope(envelopeId);
            const escrowAfter = await erc20.balanceOf(deployment.diamond);

            expect(escrowAfter).to.equal(escrowBefore, "tokens must stay in escrow during provisional period");
        });

        it("emits FiatSettlementTriggered with plaintext amount and clawbackDeadline", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId, sender, amount } = await createFiatEnvelope();

            const iface = new ethers.Interface([
                "event FiatSettlementTriggered(bytes32 indexed envelopeId, uint256 amount, uint40 clawbackDeadline)"
            ]);

            const tx = await envelope.connect(sender).finalizeEnvelope(envelopeId);
            const receipt = await tx.wait();

            const log = receipt.logs.find(l => iface.parseLog(l) !== null);
            expect(log, "FiatSettlementTriggered must be emitted").to.not.be.undefined;

            const parsed = iface.parseLog(log);
            expect(parsed.args.envelopeId).to.equal(envelopeId);
            expect(parsed.args.amount).to.equal(amount);
            expect(parsed.args.clawbackDeadline).to.be.gt(0);
        });

        it("total supply is unchanged after finalizeEnvelope (provisional path)", async function () {
            const { envelope, erc20 } = deployment.facets;
            const { envelopeId, sender } = await createFiatEnvelope();

            const supplyBefore = await erc20.totalSupply();
            await envelope.connect(sender).finalizeEnvelope(envelopeId);
            const supplyAfter = await erc20.totalSupply();

            expect(supplyAfter).to.equal(supplyBefore, "supply must not change during provisional period");
        });
    });

    // =========================================================================
    // confirmFiatDelivery
    // =========================================================================

    describe("confirmFiatDelivery", function () {
        it("transitions envelope to Finalized and burns tokens from escrow", async function () {
            const { envelope, erc20 } = deployment.facets;
            const { envelopeId, sender, amount } = await createFiatEnvelope();

            await envelope.connect(sender).finalizeEnvelope(envelopeId);

            const supplyBefore = await erc20.totalSupply();
            await envelope.connect(deployment.signers.owner).confirmFiatDelivery(envelopeId);

            const [,,,,,, state] = await envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_FINALIZED);

            const supplyAfter = await erc20.totalSupply();
            expect(supplyAfter).to.equal(supplyBefore - amount, "supply must decrease by amount on confirm");
        });

        it("emits FiatDeliveryConfirmed", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId, sender } = await createFiatEnvelope();

            await envelope.connect(sender).finalizeEnvelope(envelopeId);

            await expect(
                envelope.connect(deployment.signers.owner).confirmFiatDelivery(envelopeId)
            ).to.emit(envelope, "FiatDeliveryConfirmed").withArgs(envelopeId, (val) => val > 0);
        });

        it("non-admin cannot call confirmFiatDelivery", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId, sender } = await createFiatEnvelope();

            await envelope.connect(sender).finalizeEnvelope(envelopeId);

            await expect(
                envelope.connect(deployment.signers.user1).confirmFiatDelivery(envelopeId)
            ).to.be.revertedWithCustomError(envelope, "UnauthorizedCaller");
        });

        it("reverts on envelope not in PendingFiatConfirmation state", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId } = await createFiatEnvelope();
            // Not yet finalized — state is ES_CREATED

            await expect(
                envelope.connect(deployment.signers.owner).confirmFiatDelivery(envelopeId)
            ).to.be.revertedWithCustomError(envelope, "EnvelopeNotInState");
        });
    });

    // =========================================================================
    // clawbackSettlement
    // =========================================================================

    describe("clawbackSettlement", function () {
        it("returns tokens to sender and transitions to Reversed", async function () {
            const { envelope, erc20 } = deployment.facets;
            const { envelopeId, sender, amount } = await createFiatEnvelope();

            await envelope.connect(sender).finalizeEnvelope(envelopeId);
            const supplyBefore = await erc20.totalSupply();

            await envelope.connect(deployment.signers.owner).clawbackSettlement(envelopeId);

            const [,,,,,, state] = await envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_REVERSED);

            const senderBalance = await erc20.balanceOf(sender.address);
            expect(senderBalance).to.equal(amount, "sender must receive tokens back on clawback");

            const supplyAfter = await erc20.totalSupply();
            expect(supplyAfter).to.equal(supplyBefore, "supply must not change on clawback");
        });

        it("emits FiatSettlementClawedBack with correct amount", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId, sender, amount } = await createFiatEnvelope();

            await envelope.connect(sender).finalizeEnvelope(envelopeId);

            await expect(
                envelope.connect(deployment.signers.owner).clawbackSettlement(envelopeId)
            ).to.emit(envelope, "FiatSettlementClawedBack").withArgs(envelopeId, amount, (val) => val > 0);
        });

        it("non-admin cannot call clawbackSettlement", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId, sender } = await createFiatEnvelope();

            await envelope.connect(sender).finalizeEnvelope(envelopeId);

            await expect(
                envelope.connect(deployment.signers.user2).clawbackSettlement(envelopeId)
            ).to.be.revertedWithCustomError(envelope, "UnauthorizedCaller");
        });

        it("reverts after clawbackDeadline has passed", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId, sender } = await createFiatEnvelope();

            await envelope.connect(sender).finalizeEnvelope(envelopeId);

            // Advance past the 2-day default clawback window
            await time.increase(2 * 24 * 3600 + 1);

            await expect(
                envelope.connect(deployment.signers.owner).clawbackSettlement(envelopeId)
            ).to.be.revertedWithCustomError(envelope, "ClawbackWindowExpired");
        });
    });

    // =========================================================================
    // processExpiration auto-confirm after clawbackDeadline
    // =========================================================================

    describe("processExpiration: auto-confirm after clawbackDeadline", function () {
        it("auto-confirms and burns tokens when clawbackDeadline passes", async function () {
            const { envelope, erc20 } = deployment.facets;
            const { envelopeId, sender, amount } = await createFiatEnvelope();

            await envelope.connect(sender).finalizeEnvelope(envelopeId);

            // Anyone can trigger after clawback window expires
            await time.increase(2 * 24 * 3600 + 1);
            const supplyBefore = await erc20.totalSupply();

            await envelope.connect(deployment.signers.user2).processExpiration(envelopeId);

            const [,,,,,, state] = await envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_FINALIZED);

            const supplyAfter = await erc20.totalSupply();
            expect(supplyAfter).to.equal(supplyBefore - amount, "supply decreases on auto-confirm burn");
        });

        it("emits FiatDeliveryConfirmed on auto-confirm", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId, sender } = await createFiatEnvelope();

            await envelope.connect(sender).finalizeEnvelope(envelopeId);
            await time.increase(2 * 24 * 3600 + 1);

            await expect(
                envelope.connect(deployment.signers.user2).processExpiration(envelopeId)
            ).to.emit(envelope, "FiatDeliveryConfirmed");
        });

        it("processExpiration reverts if clawback window has not yet passed", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId, sender } = await createFiatEnvelope();

            await envelope.connect(sender).finalizeEnvelope(envelopeId);
            // Still within clawback window

            await expect(
                envelope.connect(deployment.signers.user2).processExpiration(envelopeId)
            ).to.be.revertedWithCustomError(envelope, "ClawbackWindowActive");
        });
    });

    // =========================================================================
    // setDefaultClawbackWindow
    // =========================================================================

    describe("setDefaultClawbackWindow", function () {
        it("admin can change the default clawback window", async function () {
            const { envelope } = deployment.facets;
            const oneHour = 3600;

            await envelope.connect(deployment.signers.owner).setDefaultClawbackWindow(oneHour);

            // New envelope uses the updated window
            const { envelopeId, sender } = await createFiatEnvelope();
            const iface = new ethers.Interface([
                "event FiatSettlementTriggered(bytes32 indexed envelopeId, uint256 amount, uint40 clawbackDeadline)"
            ]);
            const tx = await envelope.connect(sender).finalizeEnvelope(envelopeId);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => iface.parseLog(l) !== null);
            const parsed = iface.parseLog(log);

            const now = BigInt(await time.latest());
            // Deadline should be approximately now + 1 hour (within a few seconds)
            expect(parsed.args.clawbackDeadline).to.be.closeTo(now + BigInt(oneHour), 5n);
        });

        it("non-admin cannot change clawback window", async function () {
            const { envelope } = deployment.facets;

            await expect(
                envelope.connect(deployment.signers.user1).setDefaultClawbackWindow(3600)
            ).to.be.revertedWithCustomError(envelope, "UnauthorizedCaller");
        });
    });

    // =========================================================================
    // CRYPTO_DIRECT is not affected by fiat settlement path
    // =========================================================================

    describe("CRYPTO_DIRECT settlement is unaffected", function () {
        it("CRYPTO_DIRECT finalizeEnvelope still transfers tokens directly to recipient", async function () {
            const { envelope, erc20, mintBurn } = deployment.facets;
            const sender    = deployment.signers.user1;
            const recipient = deployment.signers.user2;
            const amount    = ethers.parseEther("50");

            await mintBurn.connect(deployment.signers.owner).mint(sender.address, amount);

            const windowEnd = (await time.latest()) + 3600;
            const tx = await envelope.connect(sender).createEnvelope(
                recipient.address,
                amount,
                windowEnd,
                ST_CRYPTO_DIRECT,
                EB_IMMEDIATE_FINALIZE,
                "0x"
            );
            const receipt = await tx.wait();
            const iface = new ethers.Interface([
                "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
            ]);
            const log = receipt.logs.find(l => iface.parseLog(l) !== null);
            const envelopeId = iface.parseLog(log).args.envelopeId;

            await envelope.connect(sender).finalizeEnvelope(envelopeId);

            const [,,,,,, state] = await envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_FINALIZED);

            const recipientBalance = await erc20.balanceOf(recipient.address);
            expect(recipientBalance).to.equal(amount);
        });
    });

    // =========================================================================
    // FIAT_INSTITUTIONAL + IMMEDIATE_FINALIZE via processExpiration
    // =========================================================================

    describe("processExpiration with FIAT_INSTITUTIONAL → provisional path", function () {
        it("processExpiration triggers provisional path for FIAT_INSTITUTIONAL", async function () {
            const { envelope } = deployment.facets;
            const { envelopeId, sender, windowEnd } = await createFiatEnvelope({
                behavior: EB_IMMEDIATE_FINALIZE
            });

            // Advance past the commit window
            await time.increaseTo(windowEnd + 1);
            await envelope.connect(deployment.signers.user2).processExpiration(envelopeId);

            const [,,,,,, state] = await envelope.getEnvelope(envelopeId);
            expect(state).to.equal(ES_PENDING_FIAT,
                "FIAT_INSTITUTIONAL IMMEDIATE_FINALIZE should enter provisional state, not Finalized");
        });
    });
});
