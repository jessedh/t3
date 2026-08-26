const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

/**
 * SmartLockEnvelopeFacet Tests (FR-1403)
 *
 * Covers:
 *   - Create succeeds and escrows tokens
 *   - Release with valid fragment works
 *   - Invalid fragment reverts
 *   - releaseAuthorizedAddress requires CUSTODIAN_ROLE
 *   - Third party with valid fragment can release (no role required)
 *   - Cancel by sender works
 *   - Cancel by admin works
 *   - Cancel by unauthorized caller reverts
 *   - No release after cancel
 *   - No cancel after release
 *   - State transitions correct (CREATED → FINALIZED / REVERSED)
 *   - Escrow accounting preserved (total supply invariant)
 *   - getSmartLockCondition returns stored values
 */
describe("SmartLockEnvelopeFacet — FR-1403", function () {
    let deployment;

    // =========================================================================
    // Fixture
    // =========================================================================

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

    function makeCommitment(fragment, nonce) {
        return ethers.keccak256(ethers.concat([fragment, nonce]));
    }

    function randomBytes32() {
        return ethers.hexlify(ethers.randomBytes(32));
    }

    async function futureWindow(offsetSeconds = 3600) {
        return (await time.latest()) + offsetSeconds;
    }

    async function mintTokens(recipient, amount) {
        await deployment.facets.mintBurn
            .connect(deployment.signers.owner)
            .mint(recipient.address, amount);
    }

    async function createEnvelope({
        sender,
        recipient,
        amount,
        fragment,
        nonce,
        commitWindowEnd,
        releaseAuthorizedAddress = ethers.ZeroAddress
    }) {
        const hashCommitment = makeCommitment(fragment, nonce);
        const cwe = commitWindowEnd ?? await futureWindow();
        const tx = await deployment.facets.smartLockEnvelope
            .connect(sender)
            .createSmartLockEnvelope(
                recipient.address,
                amount,
                hashCommitment,
                nonce,
                cwe,
                releaseAuthorizedAddress
            );
        const receipt = await tx.wait();

        // Parse envelopeId from SmartLockEnvelopeCreated event
        const iface = new ethers.Interface([
            "event SmartLockEnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, address releaseAuthorizedAddress)"
        ]);
        const log = receipt.logs.find(l => {
            try { return iface.parseLog(l) !== null; } catch { return false; }
        });
        expect(log, "SmartLockEnvelopeCreated event not found").to.not.be.undefined;
        const parsed = iface.parseLog(log);
        return parsed.args.envelopeId;
    }

    // =========================================================================
    // INV: Diamond deployment
    // =========================================================================

    describe("Deployment", function () {
        it("SmartLockEnvelopeFacet is accessible on the diamond", function () {
            expect(deployment.facets.smartLockEnvelope).to.not.be.undefined;
        });

        it("SmartLock storage slot does not collide with other known slots", function () {
            const slotStrings = [
                "com.t3programmablefiat.diamond.AppStorage.v1.995ced7e2b6e426f836004bd3a63670d",
                "t3.storage.envelope.v1",
                "t3.storage.smartlock.envelope.v1",
                "t3.storage.transfermgmt.v1",
                "t3.storage.institution.v1",
                "t3.storage.depositoridentity.v1",
                "t3.storage.cambioissuer.v1",
                "t3.storage.consortium.v1"
            ];
            const slots = slotStrings.map(s => ethers.keccak256(ethers.toUtf8Bytes(s)));
            const unique = new Set(slots);
            expect(unique.size).to.equal(slots.length, "Duplicate storage slot detected");
        });
    });

    // =========================================================================
    // createSmartLockEnvelope
    // =========================================================================

    describe("createSmartLockEnvelope", function () {
        it("escrows tokens from sender to diamond on create", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mintTokens(user1, amount);

            const diamondAddress = deployment.diamondAddress;
            const balBefore = await deployment.facets.erc20.balanceOf(user1.address);
            const escrowBefore = await deployment.facets.erc20.balanceOf(diamondAddress);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            const balAfter = await deployment.facets.erc20.balanceOf(user1.address);
            const escrowAfter = await deployment.facets.erc20.balanceOf(diamondAddress);

            expect(balAfter).to.equal(balBefore - amount);
            expect(escrowAfter).to.equal(escrowBefore + amount);
        });

        it("stores SmartLockCondition with correct hashCommitment, nonce, and releaseAuthorizedAddress", async function () {
            const { user1, user2, custodian1 } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const hashCommitment = makeCommitment(fragment, nonce);

            const envelopeId = await createEnvelope({
                sender: user1,
                recipient: user2,
                amount,
                fragment,
                nonce,
                releaseAuthorizedAddress: custodian1.address
            });

            const [storedHash, storedNonce, storedAuth] =
                await deployment.facets.smartLockEnvelope.getSmartLockCondition(envelopeId);

            expect(storedHash).to.equal(hashCommitment);
            expect(storedNonce).to.equal(nonce);
            expect(storedAuth).to.equal(custodian1.address);
        });

        it("creates envelope with state ES_CREATED (1)", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(1); // ES_CREATED
        });

        it("uses HOLD_UNTIL_MANUAL (2) + CRYPTO_DIRECT (0) behaviors", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            const [,,,, settlementType, expirationBehavior] =
                await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(settlementType).to.equal(0);     // CRYPTO_DIRECT
            expect(expirationBehavior).to.equal(2); // HOLD_UNTIL_MANUAL
        });

        it("emits EnvelopeCreated with correct plaintext amount", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("77");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const cwe = await futureWindow();

            const tx = await deployment.facets.smartLockEnvelope
                .connect(user1)
                .createSmartLockEnvelope(
                    user2.address, amount,
                    makeCommitment(fragment, nonce),
                    nonce, cwe, ethers.ZeroAddress
                );
            const receipt = await tx.wait();

            const iface = new ethers.Interface([
                "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
            ]);
            const log = receipt.logs.find(l => { try { return iface.parseLog(l) !== null; } catch { return false; } });
            expect(log, "EnvelopeCreated not found").to.not.be.undefined;
            const parsed = iface.parseLog(log);
            expect(parsed.args.amount).to.equal(amount);
            expect(parsed.args.sender).to.equal(user1.address);
            expect(parsed.args.recipient).to.equal(user2.address);
        });

        it("reverts if amount is zero", async function () {
            const { user1, user2 } = deployment.signers;
            const fragment = randomBytes32();
            const nonce = randomBytes32();
            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user1)
                    .createSmartLockEnvelope(
                        user2.address, 0,
                        makeCommitment(fragment, nonce),
                        nonce, await futureWindow(), ethers.ZeroAddress
                    )
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "InvalidAmount");
        });

        it("reverts if recipient is zero address", async function () {
            const { user1 } = deployment.signers;
            const amount = ethers.parseEther("1");
            await mintTokens(user1, amount);
            const fragment = randomBytes32();
            const nonce = randomBytes32();
            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user1)
                    .createSmartLockEnvelope(
                        ethers.ZeroAddress, amount,
                        makeCommitment(fragment, nonce),
                        nonce, await futureWindow(), ethers.ZeroAddress
                    )
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "InvalidRecipient");
        });

        it("reverts if commitWindowEnd is in the past", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("1");
            await mintTokens(user1, amount);
            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const pastWindow = (await time.latest()) - 1;
            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user1)
                    .createSmartLockEnvelope(
                        user2.address, amount,
                        makeCommitment(fragment, nonce),
                        nonce, pastWindow, ethers.ZeroAddress
                    )
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "InvalidCommitWindowEnd");
        });

        it("reverts if hashCommitment is zero bytes", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("1");
            await mintTokens(user1, amount);
            const nonce = randomBytes32();
            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user1)
                    .createSmartLockEnvelope(
                        user2.address, amount,
                        ethers.ZeroHash,
                        nonce, await futureWindow(), ethers.ZeroAddress
                    )
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "InvalidHashCommitment");
        });

        it("reverts if sender has insufficient balance", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("1000");
            // No mint — user1 has 0 balance
            const fragment = randomBytes32();
            const nonce = randomBytes32();
            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user1)
                    .createSmartLockEnvelope(
                        user2.address, amount,
                        makeCommitment(fragment, nonce),
                        nonce, await futureWindow(), ethers.ZeroAddress
                    )
            ).to.be.reverted;
        });
    });

    // =========================================================================
    // releaseSmartLockEnvelope
    // =========================================================================

    describe("releaseSmartLockEnvelope", function () {
        it("releases escrow to recipient when fragment is valid", async function () {
            const { user1, user2, user3 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            const recipientBefore = await deployment.facets.erc20.balanceOf(user2.address);
            const diamondBefore = await deployment.facets.erc20.balanceOf(deployment.diamondAddress);

            await deployment.facets.smartLockEnvelope
                .connect(user3) // third party with knowledge of fragment
                .releaseSmartLockEnvelope(envelopeId, fragment);

            const recipientAfter = await deployment.facets.erc20.balanceOf(user2.address);
            const diamondAfter = await deployment.facets.erc20.balanceOf(deployment.diamondAddress);

            expect(recipientAfter).to.equal(recipientBefore + amount);
            expect(diamondAfter).to.equal(diamondBefore - amount);
        });

        it("sets state to ES_FINALIZED (2) on successful release", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .releaseSmartLockEnvelope(envelopeId, fragment);

            const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(2); // ES_FINALIZED
        });

        it("emits EnvelopeFinalized and SmartLockEnvelopeReleased events", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            const tx = await deployment.facets.smartLockEnvelope
                .connect(user1)
                .releaseSmartLockEnvelope(envelopeId, fragment);
            const receipt = await tx.wait();

            // Verify SmartLockEnvelopeReleased
            const releasedIface = new ethers.Interface([
                "event SmartLockEnvelopeReleased(bytes32 indexed envelopeId, address indexed releasedBy)"
            ]);
            const releasedLog = receipt.logs.find(l => {
                try { return releasedIface.parseLog(l) !== null; } catch { return false; }
            });
            expect(releasedLog, "SmartLockEnvelopeReleased not found").to.not.be.undefined;
            const relParsed = releasedIface.parseLog(releasedLog);
            expect(relParsed.args.releasedBy).to.equal(user1.address);

            // Verify EnvelopeFinalized
            const finalizedIface = new ethers.Interface([
                "event EnvelopeFinalized(bytes32 indexed envelopeId, uint40 finalizedAt)"
            ]);
            const finalizedLog = receipt.logs.find(l => {
                try { return finalizedIface.parseLog(l) !== null; } catch { return false; }
            });
            expect(finalizedLog, "EnvelopeFinalized not found").to.not.be.undefined;
        });

        it("reverts with InvalidFragment when fragment does not match commitment", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            const wrongFragment = randomBytes32();
            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user1)
                    .releaseSmartLockEnvelope(envelopeId, wrongFragment)
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "InvalidFragment")
             .withArgs(envelopeId);
        });

        it("allows releaseAuthorizedAddress to release when they hold CUSTODIAN_ROLE", async function () {
            const { user1, user2, custodian1 } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({
                sender: user1,
                recipient: user2,
                amount,
                fragment,
                nonce,
                releaseAuthorizedAddress: custodian1.address // custodian1 has CUSTODIAN_ROLE
            });

            // custodian1 has CUSTODIAN_ROLE (set by setupTestRoles) — should succeed
            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(custodian1)
                    .releaseSmartLockEnvelope(envelopeId, fragment)
            ).to.not.be.reverted;

            const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(2); // ES_FINALIZED
        });

        it("reverts with CustodianRoleRequired when releaseAuthorizedAddress lacks CUSTODIAN_ROLE", async function () {
            const { user1, user2, user3 } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            // user3 is the releaseAuthorizedAddress but does NOT have CUSTODIAN_ROLE
            const envelopeId = await createEnvelope({
                sender: user1,
                recipient: user2,
                amount,
                fragment,
                nonce,
                releaseAuthorizedAddress: user3.address
            });

            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user3) // is releaseAuthorizedAddress but lacks CUSTODIAN_ROLE
                    .releaseSmartLockEnvelope(envelopeId, fragment)
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "CustodianRoleRequired")
             .withArgs(envelopeId, user3.address);
        });

        it("allows a third party (not releaseAuthorizedAddress) to release with valid fragment", async function () {
            const { user1, user2, user3, custodian1 } = deployment.signers;
            const amount = ethers.parseEther("50");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({
                sender: user1,
                recipient: user2,
                amount,
                fragment,
                nonce,
                releaseAuthorizedAddress: custodian1.address
            });

            // user3 is NOT the releaseAuthorizedAddress but has the fragment — should succeed without role check
            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user3)
                    .releaseSmartLockEnvelope(envelopeId, fragment)
            ).to.not.be.reverted;
        });

        it("allows sender to release their own envelope with valid fragment", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("20");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user1)
                    .releaseSmartLockEnvelope(envelopeId, fragment)
            ).to.not.be.reverted;
        });

        it("reverts on a non-existent envelope", async function () {
            const { user1 } = deployment.signers;
            const bogusId = ethers.keccak256(ethers.toUtf8Bytes("does-not-exist"));
            const fragment = randomBytes32();
            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user1)
                    .releaseSmartLockEnvelope(bogusId, fragment)
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "EnvelopeNotFound")
             .withArgs(bogusId);
        });
    });

    // =========================================================================
    // cancelSmartLockEnvelope
    // =========================================================================

    describe("cancelSmartLockEnvelope", function () {
        it("returns escrowed tokens to sender on cancel by sender", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            const senderBefore = await deployment.facets.erc20.balanceOf(user1.address);

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .cancelSmartLockEnvelope(envelopeId);

            const senderAfter = await deployment.facets.erc20.balanceOf(user1.address);
            expect(senderAfter).to.equal(senderBefore + amount);
        });

        it("sets state to ES_REVERSED (3) on cancel", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .cancelSmartLockEnvelope(envelopeId);

            const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(3); // ES_REVERSED
        });

        it("allows admin to cancel the envelope", async function () {
            const { user1, user2, admin } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(admin)
                    .cancelSmartLockEnvelope(envelopeId)
            ).to.not.be.reverted;

            const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(3); // ES_REVERSED
        });

        it("reverts if called by a non-sender non-admin third party", async function () {
            const { user1, user2, user3 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user3)
                    .cancelSmartLockEnvelope(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "UnauthorizedCaller");
        });

        it("emits EnvelopeReversed and SmartLockEnvelopeCancelled events", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            const tx = await deployment.facets.smartLockEnvelope
                .connect(user1)
                .cancelSmartLockEnvelope(envelopeId);
            const receipt = await tx.wait();

            const cancelledIface = new ethers.Interface([
                "event SmartLockEnvelopeCancelled(bytes32 indexed envelopeId, address indexed cancelledBy)"
            ]);
            const cancelledLog = receipt.logs.find(l => {
                try { return cancelledIface.parseLog(l) !== null; } catch { return false; }
            });
            expect(cancelledLog, "SmartLockEnvelopeCancelled not found").to.not.be.undefined;

            const reversedIface = new ethers.Interface([
                "event EnvelopeReversed(bytes32 indexed envelopeId, uint256 reversedAmount, uint40 reversedAt)"
            ]);
            const reversedLog = receipt.logs.find(l => {
                try { return reversedIface.parseLog(l) !== null; } catch { return false; }
            });
            expect(reversedLog, "EnvelopeReversed not found").to.not.be.undefined;
        });
    });

    // =========================================================================
    // State machine integrity — no release after cancel, no cancel after release
    // =========================================================================

    describe("State machine integrity", function () {
        it("cannot release after cancel (ES_REVERSED is terminal)", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .cancelSmartLockEnvelope(envelopeId);

            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user1)
                    .releaseSmartLockEnvelope(envelopeId, fragment)
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "EnvelopeNotInState");
        });

        it("cannot cancel after release (ES_FINALIZED is terminal)", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .releaseSmartLockEnvelope(envelopeId, fragment);

            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user1)
                    .cancelSmartLockEnvelope(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "EnvelopeNotInState");
        });

        it("cannot release the same envelope twice", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .releaseSmartLockEnvelope(envelopeId, fragment);

            await expect(
                deployment.facets.smartLockEnvelope
                    .connect(user1)
                    .releaseSmartLockEnvelope(envelopeId, fragment)
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "EnvelopeNotInState");
        });

        it("state transitions: CREATED → FINALIZED on release", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            let [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(1); // ES_CREATED

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .releaseSmartLockEnvelope(envelopeId, fragment);

            [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(2); // ES_FINALIZED
        });

        it("state transitions: CREATED → REVERSED on cancel", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            let [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(1); // ES_CREATED

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .cancelSmartLockEnvelope(envelopeId);

            [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(3); // ES_REVERSED
        });
    });

    // =========================================================================
    // Escrow accounting — total supply invariant
    // =========================================================================

    describe("Escrow accounting", function () {
        it("preserves total supply after create + release", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("500");
            await mintTokens(user1, amount);

            const supplyBefore = await deployment.facets.erc20.totalSupply();

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            const supplyDuringEscrow = await deployment.facets.erc20.totalSupply();
            expect(supplyDuringEscrow).to.equal(supplyBefore, "Supply must not change during escrow");

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .releaseSmartLockEnvelope(envelopeId, fragment);

            const supplyAfter = await deployment.facets.erc20.totalSupply();
            expect(supplyAfter).to.equal(supplyBefore, "Supply must not change after release");
        });

        it("preserves total supply after create + cancel", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("250");
            await mintTokens(user1, amount);

            const supplyBefore = await deployment.facets.erc20.totalSupply();

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .cancelSmartLockEnvelope(envelopeId);

            const supplyAfter = await deployment.facets.erc20.totalSupply();
            expect(supplyAfter).to.equal(supplyBefore);
        });

        it("diamond escrow balance returns to zero after release", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mintTokens(user1, amount);

            const escrowBefore = await deployment.facets.erc20.balanceOf(deployment.diamondAddress);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .releaseSmartLockEnvelope(envelopeId, fragment);

            const escrowAfter = await deployment.facets.erc20.balanceOf(deployment.diamondAddress);
            expect(escrowAfter).to.equal(escrowBefore);
        });

        it("diamond escrow balance returns to zero after cancel", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("100");
            await mintTokens(user1, amount);

            const escrowBefore = await deployment.facets.erc20.balanceOf(deployment.diamondAddress);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({ sender: user1, recipient: user2, amount, fragment, nonce });

            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .cancelSmartLockEnvelope(envelopeId);

            const escrowAfter = await deployment.facets.erc20.balanceOf(deployment.diamondAddress);
            expect(escrowAfter).to.equal(escrowBefore);
        });

        it("two independent SmartLock envelopes do not interfere with each other's escrow", async function () {
            const { user1, user2, user3 } = deployment.signers;
            const amount1 = ethers.parseEther("100");
            const amount2 = ethers.parseEther("200");
            await mintTokens(user1, amount1 + amount2);

            const fragment1 = randomBytes32();
            const nonce1 = randomBytes32();
            const fragment2 = randomBytes32();
            const nonce2 = randomBytes32();

            const env1 = await createEnvelope({ sender: user1, recipient: user2, amount: amount1, fragment: fragment1, nonce: nonce1 });
            const env2 = await createEnvelope({ sender: user1, recipient: user3, amount: amount2, fragment: fragment2, nonce: nonce2 });

            // Release env1 only
            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .releaseSmartLockEnvelope(env1, fragment1);

            // env2 should still be in escrow
            const escrowBal = await deployment.facets.erc20.balanceOf(deployment.diamondAddress);
            expect(escrowBal).to.equal(amount2);

            // Cancel env2
            await deployment.facets.smartLockEnvelope
                .connect(user1)
                .cancelSmartLockEnvelope(env2);

            const escrowFinal = await deployment.facets.erc20.balanceOf(deployment.diamondAddress);
            expect(escrowFinal).to.equal(0n);
        });
    });

    // =========================================================================
    // getSmartLockCondition
    // =========================================================================

    describe("getSmartLockCondition", function () {
        it("returns correct hashCommitment, nonce, and releaseAuthorizedAddress", async function () {
            const { user1, user2, custodian1 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const hashCommitment = makeCommitment(fragment, nonce);

            const envelopeId = await createEnvelope({
                sender: user1,
                recipient: user2,
                amount,
                fragment,
                nonce,
                releaseAuthorizedAddress: custodian1.address
            });

            const [retHash, retNonce, retAuth] =
                await deployment.facets.smartLockEnvelope.getSmartLockCondition(envelopeId);

            expect(retHash).to.equal(hashCommitment);
            expect(retNonce).to.equal(nonce);
            expect(retAuth).to.equal(custodian1.address);
        });

        it("reverts with EnvelopeNotFound for a non-existent envelopeId", async function () {
            const bogusId = ethers.keccak256(ethers.toUtf8Bytes("bogus"));
            await expect(
                deployment.facets.smartLockEnvelope.getSmartLockCondition(bogusId)
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "EnvelopeNotFound")
             .withArgs(bogusId);
        });

        it("returns ZeroAddress for releaseAuthorizedAddress when not set", async function () {
            const { user1, user2 } = deployment.signers;
            const amount = ethers.parseEther("10");
            await mintTokens(user1, amount);

            const fragment = randomBytes32();
            const nonce = randomBytes32();
            const envelopeId = await createEnvelope({
                sender: user1,
                recipient: user2,
                amount,
                fragment,
                nonce,
                releaseAuthorizedAddress: ethers.ZeroAddress
            });

            const [,, retAuth] = await deployment.facets.smartLockEnvelope.getSmartLockCondition(envelopeId);
            expect(retAuth).to.equal(ethers.ZeroAddress);
        });
    });

    // =========================================================================
    // Selector registration — INV-IFACE-01 for SmartLock
    // =========================================================================

    describe("INV-IFACE-01: ISmartLockEnvelope selectors registered in diamond", function () {
        const expectedSelectors = [
            "createSmartLockEnvelope(address,uint256,bytes32,bytes32,uint40,address)",
            "releaseSmartLockEnvelope(bytes32,bytes32)",
            "cancelSmartLockEnvelope(bytes32)",
            "getSmartLockCondition(bytes32)"
        ];

        let registeredSelectors;

        before(async function () {
            const loupe = deployment.facets.diamondLoupe;
            const allFacets = await loupe.facets();
            registeredSelectors = new Set(allFacets.flatMap(f => f.functionSelectors));
        });

        for (const sig of expectedSelectors) {
            it(`selector for ${sig} is registered in the diamond`, function () {
                const selector = ethers.id(sig).slice(0, 10);
                expect(registeredSelectors.has(selector)).to.equal(true,
                    `Missing selector for ${sig} (${selector})`);
            });
        }
    });
});
