const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClaimAttributionLib", function () {
    let harness;
    let walletA, walletB, walletC;
    let issuer1, issuer2, issuer3, issuer4;
    let domainSep;

    beforeEach(async function () {
        const Harness = await ethers.getContractFactory("ClaimAttributionHarness");
        harness = await Harness.deploy();
        await harness.waitForDeployment();
        await harness.initialize();

        const signers = await ethers.getSigners();
        walletA = signers[10].address;
        walletB = signers[11].address;
        walletC = signers[12].address;
        issuer1 = signers[13].address;
        issuer2 = signers[14].address;
        issuer3 = signers[15].address;
        issuer4 = signers[16].address;

        domainSep = ethers.keccak256(ethers.toUtf8Bytes("T3_ENVELOPE_DOMAIN"));
    });

    // ==================== HELPERS ====================

    async function credit(wallet, issuer, amount) {
        return harness.credit(wallet, issuer, amount);
    }

    async function getBuckets(wallet) {
        return harness.getWalletBuckets(wallet);
    }

    async function getEscrow(key) {
        return harness.getEscrowBuckets(key);
    }

    async function walletTotal(wallet) {
        return harness.sumWalletClaims(wallet);
    }

    function deterministicAddress(index) {
        return ethers.getAddress(ethers.zeroPadValue(ethers.toBeHex(index), 20));
    }

    describe("initialization", function () {
        it("rejects repeated initialization", async function () {
            await expect(
                harness.initialize()
            ).to.be.revertedWithCustomError(harness, "AlreadyInitialized");
        });

        it("operations before initialization are no-ops", async function () {
            const Harness = await ethers.getContractFactory("ClaimAttributionHarness");
            const freshHarness = await Harness.deploy();
            await freshHarness.waitForDeployment();
            await expect(freshHarness.credit(walletA, issuer1, 1))
                .to.not.be.reverted;
            const buckets = await freshHarness.getWalletBuckets(walletA);
            expect(buckets.length).to.equal(0);
        });
    });

    // ==================== credit ====================

    describe("credit", function () {
        it("credits a new issuer bucket", async function () {
            await credit(walletA, issuer1, 1000);
            const buckets = await getBuckets(walletA);
            expect(buckets.length).to.equal(1);
            expect(buckets[0].issuer).to.equal(issuer1);
            expect(buckets[0].amount).to.equal(1000);
        });

        it("credits an existing issuer bucket", async function () {
            await credit(walletA, issuer1, 1000);
            await credit(walletA, issuer1, 500);
            const buckets = await getBuckets(walletA);
            expect(buckets.length).to.equal(1);
            expect(buckets[0].amount).to.equal(1500);
        });

        it("creates multiple issuer buckets in insertion order", async function () {
            await credit(walletA, issuer1, 1000);
            await credit(walletA, issuer2, 2000);
            await credit(walletA, issuer3, 3000);
            const buckets = await getBuckets(walletA);
            expect(buckets.length).to.equal(3);
            expect(buckets[0].issuer).to.equal(issuer1);
            expect(buckets[1].issuer).to.equal(issuer2);
            expect(buckets[2].issuer).to.equal(issuer3);
        });

        it("reverts on zero address wallet", async function () {
            await expect(
                harness.credit(ethers.ZeroAddress, issuer1, 1000)
            ).to.be.revertedWithCustomError(harness, "ZeroAddress");
        });

        it("reverts on zero address issuer", async function () {
            await expect(
                harness.credit(walletA, ethers.ZeroAddress, 1000)
            ).to.be.revertedWithCustomError(harness, "ZeroAddress");
        });

        it("reverts on zero amount", async function () {
            await expect(
                harness.credit(walletA, issuer1, 0)
            ).to.be.revertedWithCustomError(harness, "ZeroAmount");
        });

        it("reverts when exceeding the initial 16-bucket maximum", async function () {
            for (let i = 1; i <= 16; i++) {
                await credit(walletA, deterministicAddress(1000 + i), i);
            }
            await expect(
                credit(walletA, deterministicAddress(1017), 17)
            ).to.be.revertedWithCustomError(harness, "TooManyIssuerBuckets");
        });
    });

    // ==================== debitFifo ====================

    describe("debitFifo", function () {
        beforeEach(async function () {
            await credit(walletA, issuer1, 1000);
            await credit(walletA, issuer2, 2000);
            await credit(walletA, issuer3, 3000);
        });

        it("debits a single bucket fully", async function () {
            const [issuers, amounts] = await harness.debitFifo.staticCall(walletA, 1000);
            expect(issuers.length).to.equal(1);
            expect(issuers[0]).to.equal(issuer1);
            expect(amounts[0]).to.equal(1000);

            await harness.debitFifo(walletA, 1000);
            const buckets = await getBuckets(walletA);
            expect(buckets.length).to.equal(2);
            expect(buckets[0].issuer).to.equal(issuer2);
            expect(buckets[1].issuer).to.equal(issuer3);
        });

        it("debits across multiple buckets in FIFO order", async function () {
            const [issuers, amounts] = await harness.debitFifo.staticCall(walletA, 2500);
            expect(issuers.length).to.equal(2);
            expect(issuers[0]).to.equal(issuer1);
            expect(amounts[0]).to.equal(1000);
            expect(issuers[1]).to.equal(issuer2);
            expect(amounts[1]).to.equal(1500);

            await harness.debitFifo(walletA, 2500);
            const buckets = await getBuckets(walletA);
            expect(buckets.length).to.equal(2);
            expect(buckets[0].issuer).to.equal(issuer2);
            expect(buckets[0].amount).to.equal(500);
            expect(buckets[1].issuer).to.equal(issuer3);
            expect(buckets[1].amount).to.equal(3000);
        });

        it("removes zero buckets immediately", async function () {
            await harness.debitFifo(walletA, 1000);
            const buckets = await getBuckets(walletA);
            expect(buckets.length).to.equal(2);
            expect(buckets[0].issuer).to.equal(issuer2);
            expect(buckets[1].issuer).to.equal(issuer3);
        });

        it("preserves FIFO order after removals and re-credits", async function () {
            await harness.debitFifo(walletA, 1000); // remove issuer1
            await credit(walletA, issuer1, 500); // re-add issuer1 at end
            const buckets = await getBuckets(walletA);
            expect(buckets.length).to.equal(3);
            expect(buckets[0].issuer).to.equal(issuer2);
            expect(buckets[1].issuer).to.equal(issuer3);
            expect(buckets[2].issuer).to.equal(issuer1);
        });

        it("reverts when debit exceeds available claims", async function () {
            await expect(
                harness.debitFifo(walletA, 7000)
            ).to.be.revertedWithCustomError(harness, "InsufficientClaims");
        });

        it("reverts on zero amount debit", async function () {
            await expect(
                harness.debitFifo(walletA, 0)
            ).to.be.revertedWithCustomError(harness, "ZeroAmount");
        });

        it("reverts on zero address", async function () {
            await expect(
                harness.debitFifo(ethers.ZeroAddress, 100)
            ).to.be.revertedWithCustomError(harness, "ZeroAddress");
        });
    });

    // ==================== creditComposition ====================

    describe("creditComposition", function () {
        it("credits multiple issuers at once", async function () {
            await harness.creditComposition(walletA, [issuer1, issuer2], [1000, 2000]);
            const buckets = await getBuckets(walletA);
            expect(buckets.length).to.equal(2);
            expect(buckets[0].amount).to.equal(1000);
            expect(buckets[1].amount).to.equal(2000);
        });

        it("skips zero amounts without creating buckets", async function () {
            await harness.creditComposition(walletA, [issuer1, issuer2], [1000, 0]);
            const buckets = await getBuckets(walletA);
            expect(buckets.length).to.equal(1);
            expect(buckets[0].issuer).to.equal(issuer1);
        });

        it("reverts on duplicate issuers", async function () {
            await expect(
                harness.creditComposition(walletA, [issuer1, issuer1], [1000, 2000])
            ).to.be.revertedWithCustomError(harness, "DuplicateIssuer");
        });

        it("reverts on array length mismatch", async function () {
            await expect(
                harness.creditComposition(walletA, [issuer1], [1000, 2000])
            ).to.be.revertedWithCustomError(harness, "ArrayLengthMismatch");
        });

        it("reverts on empty composition", async function () {
            await expect(
                harness.creditComposition(walletA, [], [])
            ).to.be.revertedWithCustomError(harness, "EmptyComposition");
        });
    });

    // ==================== moveClaims ====================

    describe("moveClaims", function () {
        beforeEach(async function () {
            await credit(walletA, issuer1, 1000);
            await credit(walletA, issuer2, 2000);
        });

        it("moves exact composition and returns its deterministic hash", async function () {
            const compositionHash = await harness.moveClaims.staticCall(walletA, walletB, 1500);
            const expectedHash = await harness.computeCompositionHash(
                [issuer1, issuer2],
                [1000, 500]
            );
            expect(compositionHash).to.equal(expectedHash);
            await harness.moveClaims(walletA, walletB, 1500);

            const aBuckets = await getBuckets(walletA);
            expect(aBuckets.length).to.equal(1);
            expect(aBuckets[0].issuer).to.equal(issuer2);
            expect(aBuckets[0].amount).to.equal(1500);

            const bBuckets = await getBuckets(walletB);
            expect(bBuckets.length).to.equal(2);
            expect(bBuckets[0].issuer).to.equal(issuer1);
            expect(bBuckets[0].amount).to.equal(1000);
            expect(bBuckets[1].issuer).to.equal(issuer2);
            expect(bBuckets[1].amount).to.equal(500);
        });

        it("reverts if destination would exceed max buckets without changing either wallet", async function () {
            for (let i = 1; i <= 16; i++) {
                await credit(walletB, deterministicAddress(2000 + i), i);
            }
            const beforeSender = await getBuckets(walletA);
            const beforeRecipient = await getBuckets(walletB);
            await expect(
                harness.moveClaims(walletA, walletB, 1000)
            ).to.be.revertedWithCustomError(harness, "TooManyIssuerBuckets");
            expect(await getBuckets(walletA)).to.deep.equal(beforeSender);
            expect(await getBuckets(walletB)).to.deep.equal(beforeRecipient);
        });

        it("reverts on insufficient claims", async function () {
            await expect(
                harness.moveClaims(walletA, walletB, 5000)
            ).to.be.revertedWithCustomError(harness, "InsufficientClaims");
        });

        it("rejects self-movement without changing FIFO order", async function () {
            const before = await getBuckets(walletA);
            await expect(
                harness.moveClaims(walletA, walletA, 1500)
            ).to.be.revertedWithCustomError(harness, "SelfTransfer");
            expect(await getBuckets(walletA)).to.deep.equal(before);
        });
    });

    // ==================== escrowClaims ====================

    describe("escrowClaims", function () {
        beforeEach(async function () {
            await credit(walletA, issuer1, 1000);
            await credit(walletA, issuer2, 2000);
        });

        it("escrows exact issuer composition by domain-separated key", async function () {
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-1"));
            const [escrowKey, compositionHash] = await harness.escrowClaims.staticCall(
                domainSep, objectId, walletA, 1500
            );
            expect(compositionHash).to.equal(
                await harness.computeCompositionHash([issuer1, issuer2], [1000, 500])
            );
            await harness.escrowClaims(domainSep, objectId, walletA, 1500);

            const expectedKey = await harness.computeEscrowKey(domainSep, objectId);
            expect(escrowKey).to.equal(expectedKey);

            const escrowBuckets = await getEscrow(escrowKey);
            expect(escrowBuckets.length).to.equal(2);
            expect(escrowBuckets[0].issuer).to.equal(issuer1);
            expect(escrowBuckets[0].amount).to.equal(1000);
            expect(escrowBuckets[1].issuer).to.equal(issuer2);
            expect(escrowBuckets[1].amount).to.equal(500);

            const aBuckets = await getBuckets(walletA);
            expect(aBuckets.length).to.equal(1);
            expect(aBuckets[0].amount).to.equal(1500);

            const diamondBuckets = await getBuckets(await harness.getAddress());
            expect(diamondBuckets.length).to.equal(2);
            expect(diamondBuckets[0].issuer).to.equal(issuer1);
            expect(diamondBuckets[0].amount).to.equal(1000);
            expect(diamondBuckets[1].issuer).to.equal(issuer2);
            expect(diamondBuckets[1].amount).to.equal(500);
            expect(await harness.sumActiveEscrowClaims()).to.equal(1500);
            expect(await walletTotal(await harness.getAddress())).to.equal(1500);
            expect(await harness.getEscrowRemainingAmount(escrowKey)).to.equal(1500);
        });

        it("rejects reuse of an active escrow key", async function () {
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-reuse-active"));
            await harness.escrowClaims(domainSep, objectId, walletA, 500);
            await expect(
                harness.escrowClaims(domainSep, objectId, walletA, 500)
            ).to.be.revertedWithCustomError(harness, "EscrowAlreadyExists");
        });

        it("computes deterministic escrow key", async function () {
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-2"));
            const key1 = await harness.computeEscrowKey(domainSep, objectId);
            const key2 = await harness.computeEscrowKey(domainSep, objectId);
            expect(key1).to.equal(key2);
        });

        it("domain-separates business objects", async function () {
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-3"));
            const key1 = await harness.computeEscrowKey(domainSep, objectId);
            const otherDomain = ethers.keccak256(ethers.toUtf8Bytes("OTHER_DOMAIN"));
            const key2 = await harness.computeEscrowKey(otherDomain, objectId);
            expect(key1).to.not.equal(key2);
        });
    });

    // ==================== releaseEnvelopeToSender ====================

    describe("releaseEnvelopeToSender", function () {
        beforeEach(async function () {
            await credit(walletA, issuer1, 1000);
            await credit(walletA, issuer2, 2000);
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-rel"));
            await harness.escrowClaims(domainSep, objectId, walletA, 1500);
        });

        it("returns exact composition to sender", async function () {
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-rel"));
            const escrowKey = await harness.computeEscrowKey(domainSep, objectId);

            await harness.releaseEnvelopeToSender(domainSep, objectId, walletA, 1500);

            const aBuckets = await getBuckets(walletA);
            expect(aBuckets.length).to.equal(2);
            // Existing issuer2 bucket remains first; issuer1 is re-credited at end
            expect(aBuckets[0].issuer).to.equal(issuer2);
            expect(aBuckets[0].amount).to.equal(2000);
            expect(aBuckets[1].issuer).to.equal(issuer1);
            expect(aBuckets[1].amount).to.equal(1000);

            const escrowBuckets = await getEscrow(escrowKey);
            expect(escrowBuckets.length).to.equal(0);
            expect(await harness.getEscrowRemainingAmount(escrowKey)).to.equal(0);
            expect(await walletTotal(await harness.getAddress())).to.equal(0);
            expect(await harness.sumActiveEscrowClaims()).to.equal(0);
        });

        it("supports partial release preserving exact FIFO escrow composition", async function () {
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-rel"));
            const escrowKey = await harness.computeEscrowKey(domainSep, objectId);

            await harness.releaseEnvelopeToSender(domainSep, objectId, walletA, 800);

            const aBuckets = await getBuckets(walletA);
            expect(aBuckets.length).to.equal(2);
            // WalletA had issuer2: 1500 after escrow. Partial release credits issuer1: 800
            // at the end, so issuer2 remains first.
            expect(aBuckets[0].issuer).to.equal(issuer2);
            expect(aBuckets[0].amount).to.equal(1500);
            expect(aBuckets[1].issuer).to.equal(issuer1);
            expect(aBuckets[1].amount).to.equal(800);

            const escrowBuckets = await getEscrow(escrowKey);
            expect(escrowBuckets.length).to.equal(2);
            expect(escrowBuckets[0].issuer).to.equal(issuer1);
            expect(escrowBuckets[0].amount).to.equal(200);
            expect(escrowBuckets[1].issuer).to.equal(issuer2);
            expect(escrowBuckets[1].amount).to.equal(500);
            expect(await harness.getEscrowRemainingAmount(escrowKey)).to.equal(700);
            const diamondBuckets = await getBuckets(await harness.getAddress());
            expect(diamondBuckets.length).to.equal(2);
            expect(diamondBuckets[0].issuer).to.equal(issuer1);
            expect(diamondBuckets[0].amount).to.equal(200);
            expect(diamondBuckets[1].issuer).to.equal(issuer2);
            expect(diamondBuckets[1].amount).to.equal(500);
            expect(await harness.sumActiveEscrowClaims()).to.equal(700);
            expect(await walletTotal(await harness.getAddress())).to.equal(700);
        });

        it("rejects reuse of an exhausted escrow key", async function () {
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-rel"));
            await harness.releaseEnvelopeToSender(domainSep, objectId, walletA, 1500);
            await expect(
                harness.escrowClaims(domainSep, objectId, walletA, 500)
            ).to.be.revertedWithCustomError(harness, "EscrowAlreadyExists");
        });

        it("debits the exact object composition when escrows are interleaved", async function () {
            const objectId1 = ethers.keccak256(ethers.toUtf8Bytes("env-rel"));
            const objectId2 = ethers.keccak256(ethers.toUtf8Bytes("env-interleaved-2"));

            await credit(walletB, issuer2, 1000);
            await credit(walletB, issuer3, 1000);
            await harness.escrowClaims(domainSep, objectId2, walletB, 1500);

            await harness.releaseEnvelopeToSender(domainSep, objectId2, walletB, 1500);

            const firstKey = await harness.computeEscrowKey(domainSep, objectId1);
            const firstEscrow = await getEscrow(firstKey);
            expect(firstEscrow[0].issuer).to.equal(issuer1);
            expect(firstEscrow[0].amount).to.equal(1000);
            expect(firstEscrow[1].issuer).to.equal(issuer2);
            expect(firstEscrow[1].amount).to.equal(500);

            const diamondBuckets = await getBuckets(await harness.getAddress());
            expect(diamondBuckets.length).to.equal(2);
            expect(diamondBuckets[0].issuer).to.equal(issuer1);
            expect(diamondBuckets[0].amount).to.equal(1000);
            expect(diamondBuckets[1].issuer).to.equal(issuer2);
            expect(diamondBuckets[1].amount).to.equal(500);
            expect(await harness.sumActiveEscrowClaims()).to.equal(1500);
        });
    });

    // ==================== substituteForReceivingIssuer ====================

    describe("substituteForReceivingIssuer", function () {
        beforeEach(async function () {
            await credit(walletA, issuer1, 1000);
            await credit(walletA, issuer2, 2000);
        });

        it("substitutes outgoing issuers and returns the outgoing composition", async function () {
            const result = await harness.substituteForReceivingIssuer.staticCall(
                walletA, walletB, 1500, issuer3
            );
            expect(result[0]).to.equal(
                await harness.computeCompositionHash([issuer1, issuer2], [1000, 500])
            );
            expect(result[1]).to.deep.equal([issuer1, issuer2]);
            expect(result[2]).to.deep.equal([1000n, 500n]);
            await harness.substituteForReceivingIssuer(walletA, walletB, 1500, issuer3);

            const aBuckets = await getBuckets(walletA);
            expect(aBuckets.length).to.equal(1);
            expect(aBuckets[0].issuer).to.equal(issuer2);
            expect(aBuckets[0].amount).to.equal(1500);

            const bBuckets = await getBuckets(walletB);
            expect(bBuckets.length).to.equal(1);
            expect(bBuckets[0].issuer).to.equal(issuer3);
            expect(bBuckets[0].amount).to.equal(1500);
        });
    });

    // ==================== finalizeEnvelopeClaims ====================

    describe("finalizeEnvelopeClaims", function () {
        beforeEach(async function () {
            await credit(walletA, issuer1, 1000);
            await credit(walletA, issuer2, 2000);
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-fin"));
            await harness.escrowClaims(domainSep, objectId, walletA, 1500);
        });

        it("same-institution finalization preserves exact composition", async function () {
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-fin"));
            const escrowKey = await harness.computeEscrowKey(domainSep, objectId);

            const result = await harness.finalizeEnvelopeClaims.staticCall(
                escrowKey, walletB, ethers.ZeroAddress, 1500, false
            );
            expect(result[0]).to.equal(
                await harness.computeCompositionHash([issuer1, issuer2], [1000, 500])
            );
            expect(result[1]).to.deep.equal([issuer1, issuer2]);
            expect(result[2]).to.deep.equal([1000n, 500n]);
            await harness.finalizeEnvelopeClaims(escrowKey, walletB, ethers.ZeroAddress, 1500, false);

            const bBuckets = await getBuckets(walletB);
            expect(bBuckets.length).to.equal(2);
            expect(bBuckets[0].issuer).to.equal(issuer1);
            expect(bBuckets[0].amount).to.equal(1000);
            expect(bBuckets[1].issuer).to.equal(issuer2);
            expect(bBuckets[1].amount).to.equal(500);
            expect(await walletTotal(await harness.getAddress())).to.equal(0);
            expect(await harness.sumActiveEscrowClaims()).to.equal(0);
        });

        it("cross-institution finalization substitutes released amount into one receiving-issuer bucket", async function () {
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-fin"));
            const escrowKey = await harness.computeEscrowKey(domainSep, objectId);

            const result = await harness.finalizeEnvelopeClaims.staticCall(
                escrowKey, walletB, issuer3, 1500, true
            );
            expect(result[0]).to.equal(
                await harness.computeCompositionHash([issuer1, issuer2], [1000, 500])
            );
            await harness.finalizeEnvelopeClaims(escrowKey, walletB, issuer3, 1500, true);

            const bBuckets = await getBuckets(walletB);
            expect(bBuckets.length).to.equal(1);
            expect(bBuckets[0].issuer).to.equal(issuer3);
            expect(bBuckets[0].amount).to.equal(1500);
            expect(await walletTotal(await harness.getAddress())).to.equal(0);
            expect(await harness.sumActiveEscrowClaims()).to.equal(0);
        });

        it("cross-institution partial finalization substitutes only released portion", async function () {
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-fin"));
            const escrowKey = await harness.computeEscrowKey(domainSep, objectId);

            await harness.finalizeEnvelopeClaims(escrowKey, walletB, issuer3, 800, true);

            // Released 800: first 1000 from issuer1 in escrow, so 800 issuer1 released
            // Escrow remaining: 200 issuer1 + 500 issuer2 = 700
            const bBuckets = await getBuckets(walletB);
            expect(bBuckets.length).to.equal(1);
            expect(bBuckets[0].issuer).to.equal(issuer3);
            expect(bBuckets[0].amount).to.equal(800);

            const escrowBuckets = await getEscrow(escrowKey);
            expect(escrowBuckets.length).to.equal(2);
            expect(escrowBuckets[0].issuer).to.equal(issuer1);
            expect(escrowBuckets[0].amount).to.equal(200);
            expect(escrowBuckets[1].issuer).to.equal(issuer2);
            expect(escrowBuckets[1].amount).to.equal(500);
            expect(await walletTotal(await harness.getAddress())).to.equal(700);
            expect(await harness.sumActiveEscrowClaims()).to.equal(700);
        });

        it("rolls back escrow and Diamond claims if recipient bucket capacity is exhausted", async function () {
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-fin"));
            const escrowKey = await harness.computeEscrowKey(domainSep, objectId);
            for (let i = 1; i <= 16; i++) {
                await credit(walletB, deterministicAddress(5000 + i), i);
            }

            const escrowBefore = await getEscrow(escrowKey);
            const diamondBefore = await getBuckets(await harness.getAddress());
            await expect(
                harness.finalizeEnvelopeClaims(
                    escrowKey,
                    walletB,
                    ethers.ZeroAddress,
                    1500,
                    false
                )
            ).to.be.revertedWithCustomError(harness, "TooManyIssuerBuckets");

            expect(await getEscrow(escrowKey)).to.deep.equal(escrowBefore);
            expect(await getBuckets(await harness.getAddress())).to.deep.equal(diamondBefore);
            expect(await harness.getEscrowRemainingAmount(escrowKey)).to.equal(1500);
            expect(await harness.sumActiveEscrowClaims()).to.equal(1500);
        });
    });

    // ==================== max buckets administration ====================

    describe("max issuer buckets", function () {
        it("defaults to 16", async function () {
            expect(await harness.getMaxIssuerBucketsPerWallet()).to.equal(16);
        });

        it("allows administrative increase up to hard maximum 32", async function () {
            await harness.setMaxIssuerBucketsPerWallet(32);
            expect(await harness.getMaxIssuerBucketsPerWallet()).to.equal(32);
        });

        it("rejects zero", async function () {
            await expect(
                harness.setMaxIssuerBucketsPerWallet(0)
            ).to.be.revertedWithCustomError(harness, "InvalidBucketLimit");
        });

        it("rejects decreases", async function () {
            await harness.setMaxIssuerBucketsPerWallet(32);
            await expect(
                harness.setMaxIssuerBucketsPerWallet(31)
            ).to.be.revertedWithCustomError(harness, "BucketLimitDecrease");
        });

        it("rejects setting above hard maximum 32", async function () {
            await expect(
                harness.setMaxIssuerBucketsPerWallet(33)
            ).to.be.revertedWithCustomError(harness, "HardMaximumExceeded");
        });

        it("permits 32 buckets after increase and rejects bucket 33", async function () {
            await harness.setMaxIssuerBucketsPerWallet(32);
            for (let i = 1; i <= 32; i++) {
                await credit(walletA, deterministicAddress(3000 + i), i);
            }
            expect((await getBuckets(walletA)).length).to.equal(32);
            await expect(
                credit(walletA, deterministicAddress(3033), 33)
            ).to.be.revertedWithCustomError(harness, "TooManyIssuerBuckets");
        });
    });

    // ==================== conservation and rollback ====================

    describe("conservation and rollback", function () {
        it("credit increases wallet claim total by exact amount", async function () {
            await credit(walletA, issuer1, 1000);
            await credit(walletA, issuer2, 2000);
            expect(await walletTotal(walletA)).to.equal(3000);
        });

        it("debit decreases wallet claim total by exact amount", async function () {
            await credit(walletA, issuer1, 1000);
            await credit(walletA, issuer2, 2000);
            await harness.debitFifo(walletA, 500);
            expect(await walletTotal(walletA)).to.equal(2500);
        });

        it("pure claim movement preserves aggregate wallet claims", async function () {
            await credit(walletA, issuer1, 1000);
            await credit(walletA, issuer2, 2000);
            await harness.moveClaims(walletA, walletB, 1500);
            expect(await walletTotal(walletA) + await walletTotal(walletB)).to.equal(3000);
        });

        it("escrow creation and release preserve aggregate wallet claims", async function () {
            await credit(walletA, issuer1, 1000);
            const objectId = ethers.keccak256(ethers.toUtf8Bytes("env-conserve"));
            await harness.escrowClaims(domainSep, objectId, walletA, 500);
            expect(
                await walletTotal(walletA) + await walletTotal(await harness.getAddress())
            ).to.equal(1000);
            await harness.releaseEnvelopeToSender(domainSep, objectId, walletA, 500);
            expect(await walletTotal(walletA)).to.equal(1000);
            expect(await walletTotal(await harness.getAddress())).to.equal(0);
        });

        it("reverts with no partial state on failed creditComposition", async function () {
            for (let i = 1; i <= 16; i++) {
                await credit(walletA, deterministicAddress(4000 + i), i);
            }
            const before = await getBuckets(walletA);
            await expect(
                harness.creditComposition(walletA, [issuer2, issuer3], [100, 200])
            ).to.be.revertedWithCustomError(harness, "TooManyIssuerBuckets");
            expect(await getBuckets(walletA)).to.deep.equal(before);
        });
    });
});
