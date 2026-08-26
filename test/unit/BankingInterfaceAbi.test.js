const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BankingInterfaceAbi", function () {
    let harness;

    before(async function () {
        const Harness = await ethers.getContractFactory("BankingAbiHarness");
        harness = await Harness.deploy();
        await harness.waitForDeployment();
    });

    // ==================== EVENTS ====================

    const EXPECTED_EVENTS = {
        IClaimAttribution: [
            {
                name: "ClaimBucketsMoved",
                signature: "ClaimBucketsMoved(bytes32,address,address,uint256,bytes32)",
                inputs: [
                    { name: "movementId", type: "bytes32", indexed: true },
                    { name: "from", type: "address", indexed: true },
                    { name: "to", type: "address", indexed: true },
                    { name: "amount", type: "uint256", indexed: false },
                    { name: "compositionHash", type: "bytes32", indexed: false },
                ],
            },
            {
                name: "IssuerLiabilitySubstituted",
                signature: "IssuerLiabilitySubstituted(bytes32,address,address,uint256)",
                inputs: [
                    { name: "transferId", type: "bytes32", indexed: true },
                    { name: "outgoingIssuer", type: "address", indexed: true },
                    { name: "receivingIssuer", type: "address", indexed: true },
                    { name: "amount", type: "uint256", indexed: false },
                ],
            },
            {
                name: "EnvelopeClaimEscrowed",
                signature: "EnvelopeClaimEscrowed(bytes32,bytes32,uint256)",
                inputs: [
                    { name: "envelopeId", type: "bytes32", indexed: true },
                    { name: "compositionHash", type: "bytes32", indexed: false },
                    { name: "amount", type: "uint256", indexed: false },
                ],
            },
            {
                name: "EnvelopeLiabilitySubstituted",
                signature: "EnvelopeLiabilitySubstituted(bytes32,address,uint256)",
                inputs: [
                    { name: "envelopeId", type: "bytes32", indexed: true },
                    { name: "receivingIssuer", type: "address", indexed: true },
                    { name: "amount", type: "uint256", indexed: false },
                ],
            },
        ],
        IIssuanceControl: [
            {
                name: "CapacityAttested",
                signature: "CapacityAttested(address,uint256,uint40,bytes32)",
                inputs: [
                    { name: "issuer", type: "address", indexed: true },
                    { name: "ceiling", type: "uint256", indexed: false },
                    { name: "expiresAt", type: "uint40", indexed: false },
                    { name: "evidenceHash", type: "bytes32", indexed: false },
                ],
            },
            {
                name: "SponsorshipUpdated",
                signature: "SponsorshipUpdated(address,address,bool)",
                inputs: [
                    { name: "requestingBank", type: "address", indexed: true },
                    { name: "sponsorIssuer", type: "address", indexed: true },
                    { name: "active", type: "bool", indexed: false },
                ],
            },
            {
                name: "IssuanceQuoted",
                signature: "IssuanceQuoted(bytes32,address,address,uint256)",
                inputs: [
                    { name: "quoteId", type: "bytes32", indexed: true },
                    { name: "servicingInstitution", type: "address", indexed: true },
                    { name: "legalIssuer", type: "address", indexed: true },
                    { name: "amount", type: "uint256", indexed: false },
                ],
            },
            {
                name: "IssuanceReserved",
                signature: "IssuanceReserved(bytes32,bytes32,uint256,uint40)",
                inputs: [
                    { name: "reservationId", type: "bytes32", indexed: true },
                    { name: "quoteId", type: "bytes32", indexed: true },
                    { name: "amount", type: "uint256", indexed: false },
                    { name: "expiresAt", type: "uint40", indexed: false },
                ],
            },
            {
                name: "IssuanceExecuted",
                signature: "IssuanceExecuted(bytes32,address,address,uint256)",
                inputs: [
                    { name: "reservationId", type: "bytes32", indexed: true },
                    { name: "beneficiary", type: "address", indexed: true },
                    { name: "legalIssuer", type: "address", indexed: true },
                    { name: "amount", type: "uint256", indexed: false },
                ],
            },
            {
                name: "EnvelopeCapacityReserved",
                signature: "EnvelopeCapacityReserved(bytes32,address,uint256,uint40)",
                inputs: [
                    { name: "envelopeId", type: "bytes32", indexed: true },
                    { name: "receivingIssuer", type: "address", indexed: true },
                    { name: "amount", type: "uint256", indexed: false },
                    { name: "expiresAt", type: "uint40", indexed: false },
                ],
            },
            {
                name: "EnvelopeCapacityReleased",
                signature: "EnvelopeCapacityReleased(bytes32,address,uint256)",
                inputs: [
                    { name: "envelopeId", type: "bytes32", indexed: true },
                    { name: "receivingIssuer", type: "address", indexed: true },
                    { name: "amount", type: "uint256", indexed: false },
                ],
            },
        ],
        ISettlementCycle: [
            {
                name: "SettlementObligationRecorded",
                signature: "SettlementObligationRecorded(bytes32,address,address,uint256)",
                inputs: [
                    { name: "obligationId", type: "bytes32", indexed: true },
                    { name: "outgoingIssuer", type: "address", indexed: true },
                    { name: "receivingIssuer", type: "address", indexed: true },
                    { name: "amount", type: "uint256", indexed: false },
                ],
            },
            {
                name: "SettlementCycleProposed",
                signature: "SettlementCycleProposed(bytes32,bytes32,uint40)",
                inputs: [
                    { name: "cycleId", type: "bytes32", indexed: true },
                    { name: "obligationRoot", type: "bytes32", indexed: false },
                    { name: "confirmationDeadline", type: "uint40", indexed: false },
                ],
            },
            {
                name: "SettlementCycleConfirmed",
                signature: "SettlementCycleConfirmed(bytes32,address,uint256)",
                inputs: [
                    { name: "cycleId", type: "bytes32", indexed: true },
                    { name: "institution", type: "address", indexed: true },
                    { name: "netAmount", type: "uint256", indexed: false },
                ],
            },
            {
                name: "SettlementCycleFunded",
                signature: "SettlementCycleFunded(bytes32,address,address,uint256)",
                inputs: [
                    { name: "cycleId", type: "bytes32", indexed: true },
                    { name: "fundingIssuer", type: "address", indexed: true },
                    { name: "settlementAsset", type: "address", indexed: false },
                    { name: "amount", type: "uint256", indexed: false },
                ],
            },
            {
                name: "SettlementCycleFinalized",
                signature: "SettlementCycleFinalized(bytes32,uint40)",
                inputs: [
                    { name: "cycleId", type: "bytes32", indexed: true },
                    { name: "finalizedAt", type: "uint40", indexed: false },
                ],
            },
            {
                name: "SettlementCycleFailed",
                signature: "SettlementCycleFailed(bytes32,bytes32)",
                inputs: [
                    { name: "cycleId", type: "bytes32", indexed: true },
                    { name: "exceptionRoot", type: "bytes32", indexed: false },
                ],
            },
            {
                name: "FedwireFallbackInitiated",
                signature: "FedwireFallbackInitiated(bytes32,bytes32,uint40)",
                inputs: [
                    { name: "cycleId", type: "bytes32", indexed: true },
                    { name: "paymentRef", type: "bytes32", indexed: true },
                    { name: "challengeDeadline", type: "uint40", indexed: false },
                ],
            },
            {
                name: "FedwireAttested",
                signature: "FedwireAttested(bytes32,address,bytes32)",
                inputs: [
                    { name: "cycleId", type: "bytes32", indexed: true },
                    { name: "institution", type: "address", indexed: true },
                    { name: "paymentRef", type: "bytes32", indexed: true },
                ],
            },
            {
                name: "FedwireChallenged",
                signature: "FedwireChallenged(bytes32,address)",
                inputs: [
                    { name: "cycleId", type: "bytes32", indexed: true },
                    { name: "challenger", type: "address", indexed: true },
                ],
            },
            {
                name: "FedwireFinalized",
                signature: "FedwireFinalized(bytes32,bytes32)",
                inputs: [
                    { name: "cycleId", type: "bytes32", indexed: true },
                    { name: "paymentRef", type: "bytes32", indexed: true },
                ],
            },
        ],
        IInstitutionLifecycle: [
            {
                name: "InstitutionModeUpdated",
                signature: "InstitutionModeUpdated(address,uint8,uint8,bytes32)",
                inputs: [
                    { name: "institution", type: "address", indexed: true },
                    { name: "previousMode", type: "uint8", indexed: false },
                    { name: "newMode", type: "uint8", indexed: false },
                    { name: "evidenceHash", type: "bytes32", indexed: false },
                ],
            },
            {
                name: "WalletInstitutionReassigned",
                signature: "WalletInstitutionReassigned(address,address,address)",
                inputs: [
                    { name: "wallet", type: "address", indexed: true },
                    { name: "previousInstitution", type: "address", indexed: true },
                    { name: "newInstitution", type: "address", indexed: true },
                ],
            },
        ],
    };

    it("owns exactly 23 events across the four interfaces with canonical signatures", async function () {
        const hre = require("hardhat");
        let totalEvents = 0;

        for (const [interfaceName, events] of Object.entries(EXPECTED_EVENTS)) {
            const artifact = await hre.artifacts.readArtifact(interfaceName);
            const iface = new ethers.Interface(artifact.abi);

            for (const expected of events) {
                const evt = iface.getEvent(expected.name);
                expect(evt, `${interfaceName}.${expected.name} missing`).to.not.be.undefined;

                // Verify full signature string
                const sig = evt.format("sighash");
                expect(sig).to.equal(
                    expected.signature,
                    `${interfaceName}.${expected.name} signature mismatch`
                );

                // Verify parameter count, types, and indexed flags
                expect(evt.inputs.length).to.equal(
                    expected.inputs.length,
                    `${interfaceName}.${expected.name} input count mismatch`
                );
                for (let i = 0; i < expected.inputs.length; i++) {
                    const actual = evt.inputs[i];
                    const exp = expected.inputs[i];
                    expect(actual.name).to.equal(exp.name, `${interfaceName}.${expected.name}[${i}] name mismatch`);
                    expect(actual.type).to.equal(exp.type, `${interfaceName}.${expected.name}[${i}] type mismatch`);
                    expect(actual.indexed).to.equal(exp.indexed, `${interfaceName}.${expected.name}[${i}] indexed mismatch`);
                }

                totalEvents++;
            }
        }

        expect(totalEvents).to.equal(23, `Expected 23 total events, found ${totalEvents}`);
    });

    // ==================== FUNCTIONS ====================

    const EXPECTED_READS = {
        IClaimAttribution: [
            "getWalletClaimIssuers(address)",
            "getWalletClaimAmount(address,address)",
            "getIssuerAttributedOutstanding(address)",
            "totalAttributedOutstanding()",
        ],
        IIssuanceControl: [
            "getCapacityAttestation(address)",
            "getIssuerPosition(address)",
            "getSponsorship(address,address)",
        ],
        ISettlementCycle: [
            "getSettlementObligation(bytes32)",
            "getSettlementCycle(bytes32)",
        ],
        IInstitutionLifecycle: [
            "getInstitutionMode(address)",
        ],
    };

    it("contains exactly the approved stable read functions and no mutating functions", async function () {
        const hre = require("hardhat");
        let totalReads = 0;

        for (const [interfaceName, readSigs] of Object.entries(EXPECTED_READS)) {
            const artifact = await hre.artifacts.readArtifact(interfaceName);
            const iface = new ethers.Interface(artifact.abi);

            // Collect all function entries from ABI
            const abiFunctions = artifact.abi.filter(item => item.type === "function");

            for (const expectedSig of readSigs) {
                const frag = iface.getFunction(expectedSig);
                expect(frag, `${interfaceName} missing ${expectedSig}`).to.not.be.undefined;
                expect(frag.stateMutability).to.equal(
                    "view",
                    `${interfaceName}.${expectedSig} must be view`
                );
                totalReads++;
            }

            // Assert no non-view functions exist
            const mutating = abiFunctions.filter(f => f.stateMutability !== "view");
            expect(mutating.length).to.equal(
                0,
                `${interfaceName} has unexpected mutating functions: ${mutating.map(f => f.name).join(", ")}`
            );
        }

        expect(totalReads).to.equal(10, `Expected 10 total read functions, found ${totalReads}`);
    });

    // ==================== ERRORS ====================

    const EXPECTED_ERRORS = [
        { name: "StaleCapacityAttestation", signature: "StaleCapacityAttestation(address,uint40,uint40)" },
        { name: "InsufficientFundedCapacity", signature: "InsufficientFundedCapacity(address,uint256,uint256)" },
        { name: "TransferHeadroomExceeded", signature: "TransferHeadroomExceeded(address,uint256,uint256)" },
        { name: "StandingAssumptionLimitExceeded", signature: "StandingAssumptionLimitExceeded(address,address,uint256,uint256)" },
        { name: "CeilingExceeded", signature: "CeilingExceeded(address,uint256,uint256)" },
        { name: "IneligibleWallet", signature: "IneligibleWallet(address,bytes32)" },
        { name: "InvalidSponsor", signature: "InvalidSponsor(address,address)" },
        { name: "InvalidCycleState", signature: "InvalidCycleState(bytes32,uint8,uint8)" },
        { name: "MissingPositionConfirmation", signature: "MissingPositionConfirmation(bytes32,address)" },
        { name: "DuplicateObligation", signature: "DuplicateObligation(bytes32)" },
        { name: "ReusedPaymentReference", signature: "ReusedPaymentReference(bytes32)" },
        { name: "ReserveFloorBreached", signature: "ReserveFloorBreached(address,uint256,uint256)" },
        { name: "LifecycleFreeze", signature: "LifecycleFreeze(address,uint8)" },
    ];

    it("defines exactly 13 BankingErrors with matching selectors", async function () {
        for (const expected of EXPECTED_ERRORS) {
            const selector = await harness[`${expected.name.charAt(0).toLowerCase() + expected.name.slice(1)}Selector`]();
            const computed = ethers.id(expected.signature).slice(0, 10);
            expect(selector).to.equal(
                computed,
                `Selector mismatch for ${expected.signature}: harness=${selector}, computed=${computed}`
            );
        }
    });

    // ==================== ENUMS ====================

    it("IssuanceState has safe zero default and expected ordinals", async function () {
        expect(await harness.issuanceStateNone()).to.equal(0);
        expect(await harness.issuanceStateQuoted()).to.equal(1);
        expect(await harness.issuanceStateReserved()).to.equal(2);
        expect(await harness.issuanceStateExecuted()).to.equal(3);
        expect(await harness.issuanceStateCancelled()).to.equal(4);
        expect(await harness.issuanceStateExpired()).to.equal(5);
    });

    it("CycleState has safe zero default and expected ordinals", async function () {
        expect(await harness.cycleStateNone()).to.equal(0);
        expect(await harness.cycleStateOpen()).to.equal(1);
        expect(await harness.cycleStateProposed()).to.equal(2);
        expect(await harness.cycleStateConfirmed()).to.equal(3);
        expect(await harness.cycleStateFunding()).to.equal(4);
        expect(await harness.cycleStateFinalized()).to.equal(5);
        expect(await harness.cycleStateFailed()).to.equal(6);
    });

    it("InstitutionMode has safe zero default and expected ordinals", async function () {
        // UNREGISTERED was removed; harness returns 255 sentinel to signal it is not a real value.
        // Storage default(0) = ACTIVE; all enum values shifted down by 1 vs the old interface.
        expect(await harness.institutionModeUnregistered()).to.equal(255);
        expect(await harness.institutionModeActive()).to.equal(0);
        expect(await harness.institutionModeIssuancePaused()).to.equal(1);
        expect(await harness.institutionModeOrderlyExit()).to.equal(2);
        expect(await harness.institutionModeDefaulted()).to.equal(3);
        expect(await harness.institutionModeResolved()).to.equal(4);
    });
});
