const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");

/**
 * TransferEnvelopeFacet Structural Invariant Tests (FR-0005)
 *
 * These tests verify structural correctness of the envelope system before any
 * behavioral tests (FR-1001+). They must all pass before behavioral tests are written.
 *
 * Invariants covered:
 *   INV-SLOT-01  Storage slot uniqueness across all diamond facets
 *   INV-IFACE-01 Interface completeness — all ITransferEnvelope selectors present in diamond
 *   INV-ENUM-01  Enum value ranges — out-of-range values revert with correct custom errors
 *   INV-VIS-01   Events emit plaintext uint256 amount (not commitment hashes)
 *   INV-COMP-01  Compilation — covered by `npm run compile`; verified here via deployment
 */
describe("TransferEnvelopeFacet — Structural Invariants (FR-0005)", function () {
    let deployment;

    async function setupFixture() {
        deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        return deployment;
    }

    beforeEach(async function () {
        deployment = await loadFixture(setupFixture);
    });

    // =========================================================================
    // INV-SLOT-01: Storage slot uniqueness
    // =========================================================================

    describe("INV-SLOT-01: Storage slot uniqueness", function () {
        it("all known storage slot strings produce unique keccak256 values", function () {
            // All storage slot strings used across the diamond system.
            // If a new storage library is added, its slot string must be added here.
            const slotStrings = [
                "com.t3programmablefiat.diamond.AppStorage.v1.995ced7e2b6e426f836004bd3a63670d", // StorageLib
                "t3.storage.cambioissuer.v1",        // CambioIssuerStorage
                "t3.storage.consortium.v1",          // ConsortiumStorage
                "t3.storage.depositoridentity.v1",   // DepositorIdentityStorage
                "t3.storage.envelope.v1",            // EnvelopeStorage ← new
                "t3.storage.institution.v1",         // InstitutionStorage
                "t3.storage.transfermgmt.v1",        // TransferManagementStorage
                "t3token.storage.sponsorbank.v1",    // SponsorBankStorage
            ];

            const computed = slotStrings.map(s => ethers.keccak256(ethers.toUtf8Bytes(s)));

            // RulesStorageLib uses a hardcoded slot (not derived from a string)
            const rulesSlot = "0x48036d02d4626b8820d91b02f7d150a50efa736d63e0d5cb187bd788d6eef629";
            const allSlots = [...computed, rulesSlot];

            const unique = new Set(allSlots);
            expect(unique.size).to.equal(allSlots.length,
                "Duplicate storage slots detected — check storage library constants");
        });

        it("envelope storage slot does not collide with AppStorage slot", function () {
            const appSlot = ethers.keccak256(ethers.toUtf8Bytes(
                "com.t3programmablefiat.diamond.AppStorage.v1.995ced7e2b6e426f836004bd3a63670d"
            ));
            const envelopeSlot = ethers.keccak256(ethers.toUtf8Bytes("t3.storage.envelope.v1"));
            expect(envelopeSlot).to.not.equal(appSlot);
        });
    });

    // =========================================================================
    // INV-COMP-01: Deployment succeeds (compilation + diamond cut)
    // =========================================================================

    describe("INV-COMP-01: Diamond deployment with envelope facets", function () {
        it("diamond cut succeeds with TransferEnvelopeFacet included", function () {
            expect(deployment.diamondCutSucceeded).to.equal(true,
                "Diamond cut failed — envelope facets may have a selector collision or compilation issue");
        });

        it("TransferEnvelopeFacet is accessible on the diamond", function () {
            expect(deployment.facets.envelope).to.not.be.undefined;
        });

        it("EnvelopeInheritanceFacet is accessible on the diamond", function () {
            expect(deployment.facets.envelopeInheritance).to.not.be.undefined;
        });

        it("WalletRecoveryFacet is accessible on the diamond", function () {
            expect(deployment.facets.walletRecovery).to.not.be.undefined;
        });
    });

    // =========================================================================
    // INV-IFACE-01: Interface completeness
    // =========================================================================

    describe("INV-IFACE-01: All ITransferEnvelope selectors registered in diamond", function () {
        // Canonical function signatures from ITransferEnvelope.sol.
        // If the interface changes, update this list to match.
        const ifaceSelectors = [
            "createEnvelope(address,uint256,uint40,uint8,uint8,bytes)",
            "finalizeEnvelope(bytes32)",
            "reverseEnvelope(bytes32,uint256)",
            "raiseDispute(bytes32,bytes)",
            "resolveDispute(bytes32,uint8,uint256)",
            "registerOracle(bytes32,address,bytes4)",
            "confirmFiatDelivery(bytes32)",
            "clawbackSettlement(bytes32)",
            "setDefaultClawbackWindow(uint40)",
            "getEnvelope(bytes32)",
            "getEnvelopesBySender(address)",
            "getEnvelopesByRecipient(address)",
            "getDispute(bytes32)",
            "getOracleBinding(bytes32)",
        ];

        // Extra functions on TransferEnvelopeFacet not in ITransferEnvelope
        const facetOnlySelectors = [
            "receiveOracleCallback(bytes32,bool)",
            "processExpiration(bytes32)",
            "realBalanceOf(address)",
        ];

        let registeredSelectors;

        beforeEach(async function () {
            const loupe = deployment.facets.diamondLoupe;
            const allFacets = await loupe.facets();
            registeredSelectors = new Set(
                allFacets.flatMap(f => f.functionSelectors)
            );
        });

        for (const sig of [...ifaceSelectors, ...facetOnlySelectors]) {
            it(`selector for ${sig} is registered in the diamond`, function () {
                const selector = ethers.id(sig).slice(0, 10);
                expect(registeredSelectors.has(selector)).to.equal(true,
                    `Missing selector for ${sig} (${selector})`);
            });
        }
    });

    // =========================================================================
    // INV-ENUM-01: Enum value range enforcement
    // =========================================================================

    describe("INV-ENUM-01: Out-of-range enum values revert with custom errors", function () {
        let envelope, sender, recipient;
        const futureWindow = async () => (await time.latest()) + 3600;

        beforeEach(async function () {
            envelope = deployment.facets.envelope;
            sender = deployment.signers.user1;
            recipient = deployment.signers.user2;

            // Mint tokens to sender so createEnvelope has balance to escrow
            const mintAmount = ethers.parseEther("1000");
            await deployment.facets.mintBurn.connect(deployment.signers.owner).mint(sender.address, mintAmount);
        });

        it("rejects settlementType > 1 (max valid = FIAT_INSTITUTIONAL = 1)", async function () {
            await expect(
                envelope.connect(sender).createEnvelope(
                    recipient.address,
                    ethers.parseEther("1"),
                    await futureWindow(),
                    2, // invalid settlementType
                    0, // IMMEDIATE_FINALIZE
                    "0x"
                )
            ).to.be.revertedWithCustomError(envelope, "InvalidSettlementType")
             .withArgs(2);
        });

        it("rejects expirationBehavior > 5 (max valid = DISPUTE_HOLD = 5)", async function () {
            await expect(
                envelope.connect(sender).createEnvelope(
                    recipient.address,
                    ethers.parseEther("1"),
                    await futureWindow(),
                    0, // CRYPTO_DIRECT
                    6, // invalid expirationBehavior
                    "0x"
                )
            ).to.be.revertedWithCustomError(envelope, "InvalidExpirationBehavior")
             .withArgs(6);
        });

        it("rejects zero amount", async function () {
            await expect(
                envelope.connect(sender).createEnvelope(
                    recipient.address,
                    0,
                    await futureWindow(),
                    0,
                    0,
                    "0x"
                )
            ).to.be.revertedWithCustomError(envelope, "InvalidAmount");
        });

        it("rejects zero address recipient", async function () {
            await expect(
                envelope.connect(sender).createEnvelope(
                    ethers.ZeroAddress,
                    ethers.parseEther("1"),
                    futureWindow(),
                    0,
                    0,
                    "0x"
                )
            ).to.be.revertedWithCustomError(envelope, "InvalidRecipient");
        });

        it("rejects commitWindowEnd in the past", async function () {
            const pastWindow = (await time.latest()) - 1;
            await expect(
                envelope.connect(sender).createEnvelope(
                    recipient.address,
                    ethers.parseEther("1"),
                    pastWindow,
                    0,
                    0,
                    "0x"
                )
            ).to.be.revertedWithCustomError(envelope, "InvalidCommitWindowEnd");
        });
    });

    // =========================================================================
    // INV-VIS-01: Events emit plaintext uint256 amount
    // =========================================================================

    describe("INV-VIS-01: EnvelopeCreated event emits plaintext amount", function () {
        let envelope, sender, recipient;

        beforeEach(async function () {
            envelope = deployment.facets.envelope;
            sender = deployment.signers.user1;
            recipient = deployment.signers.user2;

            const mintAmount = ethers.parseEther("1000");
            await deployment.facets.mintBurn.connect(deployment.signers.owner).mint(sender.address, mintAmount);
        });

        it("EnvelopeCreated event amount matches the input amount exactly", async function () {
            const transferAmount = ethers.parseEther("123.456");
            const commitWindowEnd = (await time.latest()) + 3600;

            const tx = await envelope.connect(sender).createEnvelope(
                recipient.address,
                transferAmount,
                commitWindowEnd,
                0, // CRYPTO_DIRECT
                0, // IMMEDIATE_FINALIZE
                "0x"
            );
            const receipt = await tx.wait();

            // Find the EnvelopeCreated event
            const envelopeStorageIface = new ethers.Interface([
                "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
            ]);
            const log = receipt.logs.find(l => envelopeStorageIface.parseLog(l) !== null);
            expect(log, "EnvelopeCreated event not found in receipt").to.not.be.undefined;

            const parsed = envelopeStorageIface.parseLog(log);
            expect(parsed.args.amount).to.equal(transferAmount,
                "Amount in EnvelopeCreated event must be plaintext (not a hash or commitment)");
            expect(parsed.args.sender).to.equal(sender.address);
            expect(parsed.args.recipient).to.equal(recipient.address);
        });

        it("getEnvelope returns the same plaintext amount after creation", async function () {
            const transferAmount = ethers.parseEther("42");
            const commitWindowEnd = (await time.latest()) + 3600;

            const tx = await envelope.connect(sender).createEnvelope(
                recipient.address,
                transferAmount,
                commitWindowEnd,
                0,
                0,
                "0x"
            );
            const receipt = await tx.wait();

            const envelopeStorageIface = new ethers.Interface([
                "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
            ]);
            const log = receipt.logs.find(l => envelopeStorageIface.parseLog(l) !== null);
            expect(log, "EnvelopeCreated event not found in receipt").to.not.be.undefined;
            const envelopeId = envelopeStorageIface.parseLog(log).args.envelopeId;

            const [,,storedAmount] = await envelope.getEnvelope(envelopeId);
            expect(storedAmount).to.equal(transferAmount,
                "Stored amount must match input — no masking in Besu consortium model");
        });
    });
});
