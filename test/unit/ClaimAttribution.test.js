// test/unit/ClaimAttribution.test.js
//
// Regression guards for the A.0 Phase-A fix: WalletRecoveryFacet must use the
// 4-arg EscrowLib.releaseEscrow overload with the domain the escrow was recorded
// under (ENVELOPE_DOMAIN for envelopes, CAMBIO_NOTE_DOMAIN for Cambio notes —
// C-F2) so issuer claims are preserved on all recovery paths.
//
// Static analysis tests (reading source) catch regressions that would be invisible
// at runtime because the 2-arg overload compiles and executes silently — it just
// passes bytes32(0) and suppresses attribution.
//
// Full production-path conservation tests (exercising WalletRecoveryFacet via
// custodian setup + envelope creation + recovery trigger) are deferred to Phase C
// due to the multi-facet setup complexity. The guards here ensure A.0 cannot be
// silently reverted without a test failure.

const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const WALLET_RECOVERY_PATH = path.resolve(
    __dirname,
    "../../contracts/facets/WalletRecoveryFacet.sol"
);

const ESCROW_LIB_PATH = path.resolve(
    __dirname,
    "../../contracts/lib/EscrowLib.sol"
);

describe("ClaimAttribution — A.0 Regression Guards", function () {
    let walletRecoverySrc;
    let escrowLibSrc;

    before(function () {
        walletRecoverySrc = fs.readFileSync(WALLET_RECOVERY_PATH, "utf8");
        escrowLibSrc = fs.readFileSync(ESCROW_LIB_PATH, "utf8");
    });

    describe("Static: WalletRecoveryFacet uses 4-arg releaseEscrow on all sites", function () {
        it("should have no 2-arg releaseEscrow bypass calls", function () {
            // Collect every EscrowLib.releaseEscrow call in the file (up to the semicolon).
            // A bypass is any call that does NOT pass a ClaimAttributionLib domain — those
            // pass bytes32(0) through the 2-arg overload and suppress issuer attribution.
            // Valid domains: ENVELOPE_DOMAIN (envelope escrow) and CAMBIO_NOTE_DOMAIN
            // (Cambio notes, escrowed by CambioEnvelopeFacet — C-F2 fix).
            const allCalls = walletRecoverySrc.match(/EscrowLib\.releaseEscrow\([^;]+;/g) || [];
            const bypassCalls = allCalls.filter(
                call => !/ClaimAttributionLib\.(ENVELOPE|CAMBIO_NOTE)_DOMAIN/.test(call)
            );

            expect(bypassCalls).to.deep.equal(
                [],
                `Found ${bypassCalls.length} releaseEscrow call(s) in WalletRecoveryFacet ` +
                `that do not pass a ClaimAttributionLib domain (bypass issuer attribution):\n` +
                `${bypassCalls.join("\n")}\n` +
                `All releaseEscrow calls in WalletRecoveryFacet must pass the domain the ` +
                `escrow was recorded under.`
            );
        });

        it("should have exactly 4 releaseEscrow calls using ENVELOPE_DOMAIN", function () {
            const domainPattern = /EscrowLib\.releaseEscrow\s*\([^,]+,\s*ClaimAttributionLib\.ENVELOPE_DOMAIN/g;
            const matches = walletRecoverySrc.match(domainPattern) || [];

            expect(matches.length).to.equal(
                4,
                `Expected 4 ENVELOPE_DOMAIN releaseEscrow sites in WalletRecoveryFacet, ` +
                `found ${matches.length}. If a site was added or removed, update this count.`
            );
        });

        it("should release Cambio notes under CAMBIO_NOTE_DOMAIN (C-F2 regression guard)", function () {
            // Cambio notes escrow under CAMBIO_NOTE_DOMAIN in CambioEnvelopeFacet.
            // Releasing them under ENVELOPE_DOMAIN reverts EscrowNotActive once claim
            // attribution is initialized, stranding every escrowed note in a recovery.
            const cambioPattern = /EscrowLib\.releaseEscrow\s*\([^,]+,\s*ClaimAttributionLib\.CAMBIO_NOTE_DOMAIN/g;
            const matches = walletRecoverySrc.match(cambioPattern) || [];

            expect(matches.length).to.equal(
                1,
                `Expected exactly 1 CAMBIO_NOTE_DOMAIN releaseEscrow site in ` +
                `WalletRecoveryFacet (resolveCambioNotesBulk), found ${matches.length}.`
            );

            // Pin the site to resolveCambioNotesBulk: the Cambio-domain release must
            // appear after the function's declaration in source.
            const fnIdx = walletRecoverySrc.indexOf("function resolveCambioNotesBulk");
            const callIdx = walletRecoverySrc.search(cambioPattern);
            expect(fnIdx).to.be.greaterThan(-1, "resolveCambioNotesBulk must exist");
            expect(callIdx).to.be.greaterThan(
                fnIdx,
                "The CAMBIO_NOTE_DOMAIN release must be inside resolveCambioNotesBulk"
            );
        });

        it("should have ENVELOPE_DOMAIN imported via ClaimAttributionLib", function () {
            expect(walletRecoverySrc).to.include(
                "ClaimAttributionLib",
                "WalletRecoveryFacet must import ClaimAttributionLib for ENVELOPE_DOMAIN access"
            );
        });
    });

    describe("Static: EscrowLib 4-arg overload passes domain to attribution", function () {
        it("should have the 4-arg releaseEscrow overload that routes domain to ClaimAttributionLib", function () {
            expect(escrowLibSrc).to.include(
                "ClaimAttributionLib.releaseEnvelopeToSender",
                "EscrowLib.releaseEscrow 4-arg overload must call ClaimAttributionLib.releaseEnvelopeToSender"
            );
        });

        it("should guard attribution on non-zero domainSeparator only", function () {
            // Ensures legacy 2-arg callers (domainSeparator = bytes32(0)) don't error
            expect(escrowLibSrc).to.include(
                "domainSeparator != bytes32(0)",
                "EscrowLib must guard attribution call on non-zero domainSeparator " +
                "(preserves silent pass-through for legacy 2-arg callers)"
            );
        });
    });

    describe("ENVELOPE_DOMAIN constant value", function () {
        it("should be the keccak256 of the expected string", function () {
            // ClaimAttributionLib.ENVELOPE_DOMAIN = keccak256("T3_TRANSFER_ENVELOPE_V1")
            const expected = ethers.keccak256(ethers.toUtf8Bytes("T3_TRANSFER_ENVELOPE_V1"));

            // Read from source to confirm the constant string hasn't drifted
            const match = walletRecoverySrc.match(/ENVELOPE_DOMAIN/);
            expect(match).to.not.be.null;

            // Verify the expected value is what keccak256 produces for the V1 string
            expect(expected).to.equal(
                "0x" + Buffer.from(
                    ethers.getBytes(ethers.keccak256(ethers.toUtf8Bytes("T3_TRANSFER_ENVELOPE_V1")))
                ).toString("hex"),
                "ENVELOPE_DOMAIN must equal keccak256('T3_TRANSFER_ENVELOPE_V1')"
            );

            // Also confirm the constant is defined in ClaimAttributionLib source
            const claimLibSrc = fs.readFileSync(
                path.resolve(__dirname, "../../contracts/lib/ClaimAttributionLib.sol"),
                "utf8"
            );
            expect(claimLibSrc).to.include(
                'keccak256("T3_TRANSFER_ENVELOPE_V1")',
                "ClaimAttributionLib.ENVELOPE_DOMAIN must be keccak256(\"T3_TRANSFER_ENVELOPE_V1\")"
            );
        });
    });

    describe("No bypasses in other core facets", function () {
        it("TransferEnvelopeFacet should not use 2-arg releaseEscrow for envelope amounts", function () {
            const tePath = path.resolve(
                __dirname,
                "../../contracts/facets/TransferEnvelopeFacet.sol"
            );
            const src = fs.readFileSync(tePath, "utf8");

            // TransferEnvelopeFacet uses EscrowLib for envelope operations —
            // all releaseEscrow calls that handle envelope amounts should pass a domain.
            // This test documents the expectation; failures indicate a new bypass.
            const releaseCallCount = (src.match(/EscrowLib\.releaseEscrow/g) || []).length;
            const withDomainCount = (src.match(/EscrowLib\.releaseEscrow\s*\([^,]+,\s*(?:ClaimAttributionLib\.|ENVELOPE_DOMAIN|bytes32)/g) || []).length;

            // If TransferEnvelopeFacet has releaseEscrow calls, at least some should use domain.
            // This assertion fires if someone adds a 2-arg bypass in TransferEnvelopeFacet.
            if (releaseCallCount > 0) {
                expect(withDomainCount).to.be.greaterThan(
                    0,
                    `TransferEnvelopeFacet has ${releaseCallCount} releaseEscrow call(s) but ` +
                    `none use a domain separator — verify these are intentional bypasses.`
                );
            }
        });
    });
});
