// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ComplianceHoldStorage } from "./ComplianceHoldStorage.sol";
import { ComplianceLib } from "./ComplianceLib.sol";
import { IComplianceGate } from "../interfaces/IComplianceGate.sol";
import { EnvelopeStorage } from "./EnvelopeStorage.sol";
import { CambioEnvelopeStorage } from "./CambioEnvelopeStorage.sol";
import { EscrowLib } from "./EscrowLib.sol";
import { ClaimAttributionLib } from "./ClaimAttributionLib.sol";
import { ClaimAttributionStorage } from "./ClaimAttributionStorage.sol";
import { WalletRecoveryStorage } from "./WalletRecoveryStorage.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title ComplianceHoldLib
 * @notice Non-reverting compliance hold mechanism for escrow-release legs (D2).
 * @dev EXTERNAL library, called via DELEGATECALL from hooked facets (same
 *      pattern as WalletRecoverySanctionsLib) so diamond storage and msg.sender
 *      are preserved while the logic stays out of the facets' EIP-170 budget.
 *
 *      checkOrHold: run the armed compliance funnel on a release leg. On pass,
 *      return false and let the caller pay out normally. On fail, park the
 *      funds (they never leave diamond escrow) under a HoldRecord and return
 *      true — the caller must skip its payout and leave the domain object in
 *      its held state.
 *
 *      resolveComplianceHold: admin disposition — pay the original payee
 *      (after a mandatory re-screen), pay an alternate payee (also
 *      re-screened), or burn to issuer reserve. A failed re-screen NEVER
 *      reverts and NEVER pays: it emits ComplianceHoldReleaseBlocked and
 *      returns false so the hold survives for a later attempt.
 *
 *      Events and errors are declared here (not in ComplianceHoldStorage)
 *      because this library is the emitter: solc only includes
 *      externally-defined events in the ABI of the artifact that emits them,
 *      and tests/indexer decode hold events through this library's ABI
 *      attached at the diamond address.
 */
library ComplianceHoldLib {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // Mirrors EnvelopeStorage.EnvelopeState values (uint8 in storage).
    uint8 internal constant ES_REVERSED = 3;
    uint8 internal constant ES_DISPUTED = 4;

    // HoldRecord.requestedAction leg codes for single-item refund legs
    // (design Q5 encoding table; bulk legs pass the raw bulk choice/action).
    uint8 internal constant LEG_EXPIRY_AUTO_REVERSE = 10;
    uint8 internal constant LEG_ORACLE_REVERSE      = 11;
    uint8 internal constant LEG_DISPUTE_REFUND      = 12;
    uint8 internal constant LEG_REVERSE             = 13;
    uint8 internal constant LEG_CLAWBACK            = 14;
    uint8 internal constant LEG_SMARTLOCK_CANCEL    = 15;
    uint8 internal constant LEG_NOTE_CANCEL         = 20;
    uint8 internal constant LEG_NOTE_REDEMPTION     = 21;

    // Recovery bulk-map sentinel (Q4): unreachable as `choice+1` / `action+1`
    // (both are small validated enums), so it marks "held — not bulk-actionable".
    uint8 internal constant HELD_SENTINEL           = 0xFF;

    event RecoveryBulkItemHeld(
        bytes32 indexed recoveryId,
        bytes32 indexed domain,
        bytes32 indexed objectId
    );

    event CompliancePayoutHeld(
        bytes32 indexed domain,
        bytes32 indexed objectId,
        address resolvedPayee,
        address failingParty,
        bytes32 reasonCode,
        uint256 amount
    );

    event ComplianceHoldResolved(
        bytes32 indexed domain,
        bytes32 indexed objectId,
        uint8 disposition,
        address payee,
        uint256 amount,
        address resolvedBy
    );

    event ComplianceHoldReleaseBlocked(
        bytes32 indexed domain,
        bytes32 indexed objectId,
        address failingParty,
        bytes32 reasonCode
    );

    /// @notice Audit signal: a note-hold disposition found the effective
    ///         issuer's `valueOutstanding` below the hold amount and clamped
    ///         to zero instead of panicking. Expected only mid-recovery
    ///         before profile migration; outside that window it indicates
    ///         accounting drift that should be investigated off-chain.
    event ComplianceHoldNoteProfileClamped(
        bytes32 indexed domain,
        bytes32 indexed objectId,
        address effectiveIssuer,
        uint256 valueOutstandingBefore,
        uint256 holdAmount
    );

    error ComplianceHoldActive(bytes32 objectId);
    error ComplianceHoldNotFound(bytes32 domain, bytes32 objectId);
    error ComplianceHoldAlreadyResolved(bytes32 domain, bytes32 objectId);
    error ComplianceHoldUnsupportedDomain(bytes32 domain);
    error ComplianceHoldInvalidOutcome(uint8 outcome);
    error ComplianceHoldInvalidPayee();
    error ComplianceHoldPartialBurn(bytes32 objectId);

    /**
     * @notice True while an unresolved compliance hold exists for the object.
     * @dev Internal — inlined into guard facets with no library linking.
     */
    function isHeld(bytes32 domain, bytes32 objectId) internal view returns (bool) {
        return ComplianceHoldStorage.layout()
            .holds[ComplianceHoldStorage.holdKey(domain, objectId)]
            .status == ComplianceHoldStorage.HOLD_HELD;
    }

    /**
     * @notice Run the armed compliance funnel on a release leg; hold on failure.
     * @dev `to` is the RAW payee — recovery-payee resolution happens exactly once,
     *      inside this function (snapshot) and inside the sanctions predicate
     *      (screening). Callers must NOT pre-resolve, or resolution would chain.
     * @return held true when the leg was parked in a hold (caller must skip payout)
     */
    function checkOrHold(
        bytes32 domain,
        bytes32 objectId,
        address from,
        address to,
        uint256 amount,
        ComplianceLib.Context ctx,
        bytes32 recoveryId,
        uint8 priorState,
        uint8 requestedAction
    ) external returns (bool held) {
        return _checkOrHold(
            domain, objectId, from, to, amount, ctx, recoveryId, priorState, requestedAction
        );
    }

    /**
     * @notice Bulk-loop variant (Task 4.4): checkOrHold + held-item bookkeeping.
     * @dev On hold, writes the HELD_SENTINEL into the recovery's per-item
     *      resolution map and bumps the resolved counter — from the bulk loop's
     *      perspective the item is disposed (Q4); the HoldRecord keeps the audit
     *      trail. Lives here (not in WalletRecoveryFacet) per the EIP-170 size
     *      freeze on that facet. ctx is always ESCROW_RELEASE for bulk refund legs.
     * @return held true when the leg was parked (caller must `continue`)
     */
    function checkOrHoldBulk(
        bytes32 domain,
        bytes32 objectId,
        address from,
        address to,
        uint256 amount,
        bytes32 recoveryId,
        uint8 priorState,
        uint8 requestedAction
    ) external returns (bool held) {
        held = _checkOrHold(
            domain, objectId, from, to, amount,
            ComplianceLib.Context.ESCROW_RELEASE, recoveryId, priorState, requestedAction
        );
        if (held) {
            WalletRecoveryStorage.RecoveryRecord storage rec =
                WalletRecoveryStorage.layout().recoveries[recoveryId];
            if (domain == ClaimAttributionLib.CAMBIO_NOTE_DOMAIN) {
                rec.resolvedNotes[objectId] = HELD_SENTINEL;
                rec.cambioNotesResolved++;
            } else {
                rec.resolvedEnvelopes[objectId] = HELD_SENTINEL;
                rec.envelopesResolved++;
            }
            emit RecoveryBulkItemHeld(recoveryId, domain, objectId);
        }
    }

    function _checkOrHold(
        bytes32 domain,
        bytes32 objectId,
        address from,
        address to,
        uint256 amount,
        ComplianceLib.Context ctx,
        bytes32 recoveryId,
        uint8 priorState,
        uint8 requestedAction
    ) private returns (bool held) {
        // Matches precheckGated: nothing armed → no external gate call at all.
        if (!ComplianceLib._anyPrecheckControlArmed()) return false;

        (bool ok, address failingParty, bytes32 reasonCode) =
            IComplianceGate(address(this)).complianceCheck(from, to, amount, uint8(ctx));
        if (ok) return false;

        ComplianceHoldStorage.Layout storage l = ComplianceHoldStorage.layout();
        bytes32 key = ComplianceHoldStorage.holdKey(domain, objectId);
        ComplianceHoldStorage.HoldRecord storage rec = l.holds[key];
        if (rec.status == ComplianceHoldStorage.HOLD_HELD) {
            revert ComplianceHoldActive(objectId);
        }

        address resolvedPayee = WalletRecoveryStorage._resolveRecoveryPayee(to);

        rec.domain          = domain;
        rec.objectId        = objectId;
        rec.originalPayee   = to;
        rec.resolvedPayee   = resolvedPayee;
        rec.failingParty    = failingParty;
        rec.amount          = amount;
        rec.reasonCode      = reasonCode;
        rec.recoveryId      = recoveryId;
        rec.priorState      = priorState;
        rec.requestedAction = requestedAction;
        rec.status          = ComplianceHoldStorage.HOLD_HELD;
        rec.disposition     = ComplianceHoldStorage.DISP_NONE;
        rec.resolvedBy      = address(0);
        rec.heldAt          = uint40(block.timestamp);
        rec.resolvedAt      = 0;
        l.activeHolds.add(key);

        // Envelope-shaped held state = DISPUTED (Q2): freezes the object
        // against settlement/cancel paths (they all require CREATED /
        // PENDING_FIAT); the isHeld guard (Task 4.2) blocks resolveDispute /
        // timeout from bypassing the hold. SmartLock envelopes share
        // EnvelopeStorage but escrow under SMARTLOCK_DOMAIN.
        if (_isEnvelopeShaped(domain)) {
            EnvelopeStorage.layout().envelopes[objectId].state = ES_DISPUTED;
        }

        emit CompliancePayoutHeld(domain, objectId, resolvedPayee, failingParty, reasonCode, amount);
        return true;
    }

    /**
     * @notice Admin disposition of a compliance hold.
     * @dev Caller facet enforces ADMIN_ROLE + nonReentrant (guards are
     *      facet-scoped; this library never self-guards — kimi LOW-3).
     * @param outcome 1 = pay original payee, 2 = pay alternate payee, 3 = burn
     *        to issuer reserve (full-amount escrow burn with attribution).
     * @return released true when funds actually moved (pay or burn); false when
     *         a re-screen blocked the release and the hold remains active.
     */
    function resolveComplianceHold(
        bytes32 domain,
        bytes32 objectId,
        uint8 outcome,
        address alternatePayee
    ) external returns (bool released) {
        ComplianceHoldStorage.Layout storage l = ComplianceHoldStorage.layout();
        bytes32 key = ComplianceHoldStorage.holdKey(domain, objectId);
        ComplianceHoldStorage.HoldRecord storage rec = l.holds[key];

        if (rec.status == ComplianceHoldStorage.HOLD_NONE) {
            revert ComplianceHoldNotFound(domain, objectId);
        }
        if (rec.status == ComplianceHoldStorage.HOLD_RESOLVED) {
            revert ComplianceHoldAlreadyResolved(domain, objectId);
        }
        bool isEnvelope = _isEnvelopeShaped(domain);
        if (!isEnvelope && domain != ClaimAttributionLib.CAMBIO_NOTE_DOMAIN) {
            revert ComplianceHoldUnsupportedDomain(domain);
        }

        uint256 amount = rec.amount;

        if (
            outcome == ComplianceHoldStorage.OUTCOME_PAY_ORIGINAL ||
            outcome == ComplianceHoldStorage.OUTCOME_PAY_ALTERNATE
        ) {
            address rawPayee = outcome == ComplianceHoldStorage.OUTCOME_PAY_ORIGINAL
                ? rec.originalPayee
                : alternatePayee;
            if (rawPayee == address(0)) revert ComplianceHoldInvalidPayee();

            // Re-resolve at release time: the payee may have entered/completed
            // recovery while the hold was pending.
            address payee = WalletRecoveryStorage._resolveRecoveryPayee(rawPayee);

            // Mandatory re-screen (Q6): still-blocked → emit + return false,
            // never revert, never pay. `from` mirrors the interrupted leg's
            // economic counterparty (ESCROW_RELEASE screens `to` only for
            // KYC/CIP; sanctions screens both parties).
            (bool ok, address failingParty, bytes32 reasonCode) =
                IComplianceGate(address(this)).complianceCheck(
                    _rescreenCounterparty(isEnvelope, objectId, rec.requestedAction),
                    payee,
                    amount,
                    uint8(ComplianceLib.Context.ESCROW_RELEASE)
                );
            if (!ok) {
                emit ComplianceHoldReleaseBlocked(domain, objectId, failingParty, reasonCode);
                return false;
            }

            uint8 disposition = outcome == ComplianceHoldStorage.OUTCOME_PAY_ORIGINAL
                ? ComplianceHoldStorage.DISP_PAID_ORIGINAL
                : ComplianceHoldStorage.DISP_PAID_ALTERNATE;
            if (isEnvelope) {
                _closeEnvelopeHold(l, key, rec, objectId, disposition);
            } else {
                _closeNoteHold(l, key, rec, objectId, disposition);
            }
            EscrowLib.releaseEscrow(payee, domain, objectId, amount);
            if (isEnvelope) {
                emit EnvelopeStorage.EnvelopeReversed(objectId, amount, uint40(block.timestamp));
            }
            emit ComplianceHoldResolved(domain, objectId, disposition, payee, amount, msg.sender);
            return true;
        }

        if (outcome == ComplianceHoldStorage.OUTCOME_BURN) {
            // EscrowLib.burnEscrow wipes the ENTIRE attribution record for the
            // escrow key regardless of `amount` (kimi HIGH-3), so a burn
            // disposition is only sound when the hold covers the full remaining
            // escrow. No re-screen: a burn pays nobody (Q6).
            ClaimAttributionStorage.Layout storage claims = ClaimAttributionStorage.layout();
            if (claims.initialized) {
                bytes32 escrowKey = keccak256(abi.encode(domain, objectId));
                if (claims.escrowClaims[escrowKey].remainingAmount != amount) {
                    revert ComplianceHoldPartialBurn(objectId);
                }
            }

            if (isEnvelope) {
                _closeEnvelopeHold(l, key, rec, objectId, ComplianceHoldStorage.DISP_BURNED);
            } else {
                _closeNoteHold(l, key, rec, objectId, ComplianceHoldStorage.DISP_BURNED);
            }
            EscrowLib.burnEscrow(domain, objectId, amount);
            if (isEnvelope) {
                emit EnvelopeStorage.EnvelopeReversed(objectId, amount, uint40(block.timestamp));
            }
            emit ComplianceHoldResolved(
                domain, objectId, ComplianceHoldStorage.DISP_BURNED, address(0), amount, msg.sender
            );
            return true;
        }

        revert ComplianceHoldInvalidOutcome(outcome);
    }

    /// @dev Envelope-shaped domains share EnvelopeStorage state parking and the
    ///      envelope disposition branch; only the escrow attribution key differs.
    function _isEnvelopeShaped(bytes32 domain) private pure returns (bool) {
        return domain == ClaimAttributionLib.ENVELOPE_DOMAIN ||
            domain == ClaimAttributionLib.SMARTLOCK_DOMAIN;
    }

    /**
     * @dev Envelope-domain close-out (CEI: all state transitions before the
     *      escrow movement in the caller). Every disposition is reversal-shaped
     *      for the envelope: the escrowed amount leaves the envelope without
     *      settling to the envelope recipient. Partial-amount holds (partial
     *      reverseEnvelope, PARTIAL_SPLIT senderPortion) restore the pre-park
     *      state so the non-held remainder is not stranded in DISPUTED.
     */
    function _closeEnvelopeHold(
        ComplianceHoldStorage.Layout storage l,
        bytes32 key,
        ComplianceHoldStorage.HoldRecord storage rec,
        bytes32 objectId,
        uint8 disposition
    ) private {
        EnvelopeStorage.EnvelopeData storage env = EnvelopeStorage.layout().envelopes[objectId];
        env.reversedAmount += rec.amount;
        if (env.amount - env.reversedAmount == 0) {
            env.state = ES_REVERSED;
        } else {
            env.state = rec.priorState;
        }

        rec.status      = ComplianceHoldStorage.HOLD_RESOLVED;
        rec.disposition = disposition;
        rec.resolvedBy  = msg.sender;
        rec.resolvedAt  = uint40(block.timestamp);
        l.activeHolds.remove(key);
    }

    /**
     * @dev Cambio-note close-out (Task 4.3). Note state was deliberately left
     *      untouched at hold time (Q3: note.active stays true while held), so
     *      disposition completes the interrupted leg's note accounting — only
     *      the escrow destination differs by outcome. Cancel-shaped legs close
     *      the note; redemption legs advance `spent` and close the note only
     *      when fully spent. The burn path's full-remaining-escrow guard in the
     *      caller guarantees burned notes always end terminal (Q7).
     */
    function _closeNoteHold(
        ComplianceHoldStorage.Layout storage l,
        bytes32 key,
        ComplianceHoldStorage.HoldRecord storage rec,
        bytes32 objectId,
        uint8 disposition
    ) private {
        CambioEnvelopeStorage.Layout storage cs = CambioEnvelopeStorage.layout();
        CambioEnvelopeStorage.CambioEnvelopeNote storage note = cs.envelopeNotes[objectId];
        address effIssuer = _effectiveIssuer(note.issuer);
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile =
            cs.issuerProfiles[effIssuer];

        // Underflow guards mirror WalletRecoveryFacet.resolveCambioNotesBulk:
        // during an active recovery the effective issuer is the successor, whose
        // profile may not have been migrated yet. Disposition must never be
        // blockable by a counter panic. The clamp emits an audit event so a
        // clamp outside the migration window is visible as accounting drift
        // (kimi Sprint 4 exit LOW-2).
        if (profile.valueOutstanding >= rec.amount) {
            profile.valueOutstanding -= rec.amount;
        } else {
            emit ComplianceHoldNoteProfileClamped(
                rec.domain, objectId, effIssuer, profile.valueOutstanding, rec.amount
            );
            profile.valueOutstanding = 0;
        }
        if (rec.requestedAction == LEG_NOTE_REDEMPTION) {
            note.spent += rec.amount;
            profile.t3usdRedeemed += rec.amount;
            if (note.escrowedAmount - note.spent == 0) {
                note.active = false;
                if (profile.notesOutstanding > 0) {
                    profile.notesOutstanding--;
                }
            }
        } else {
            note.active = false;
            if (profile.notesOutstanding > 0) {
                profile.notesOutstanding--;
            }
            profile.t3usdCancelled += rec.amount;
        }

        rec.status      = ComplianceHoldStorage.HOLD_RESOLVED;
        rec.disposition = disposition;
        rec.resolvedBy  = msg.sender;
        rec.resolvedAt  = uint40(block.timestamp);
        l.activeHolds.remove(key);
    }

    /**
     * @dev Re-screen `from` mirrors the interrupted leg's original tuple:
     *      envelope refund legs → envelope recipient; note redemption legs →
     *      the note's effective issuer; note cancel legs → address(0) (bearer
     *      note, no specific counterparty). Cancel legs must NOT re-screen the
     *      issuer as `from` — the issuer is the blocked *payee* there, and
     *      screening it on both sides would permanently block the pay-alternate
     *      escape hatch for sanctioned-issuer notes.
     */
    function _rescreenCounterparty(
        bool isEnvelope,
        bytes32 objectId,
        uint8 requestedAction
    ) private view returns (address) {
        if (isEnvelope) {
            return EnvelopeStorage.layout().envelopes[objectId].recipient;
        }
        if (requestedAction == LEG_NOTE_REDEMPTION) {
            return _effectiveIssuer(CambioEnvelopeStorage.layout().envelopeNotes[objectId].issuer);
        }
        return address(0);
    }

    /// @dev Mirrors CambioEnvelopeFacet.resolveEffectiveIssuer: bounded 3-hop
    ///      walk of the recovery-successor chain.
    function _effectiveIssuer(address issuer) private view returns (address current) {
        current = issuer;
        WalletRecoveryStorage.Layout storage s = WalletRecoveryStorage.layout();
        for (uint256 i = 0; i < 3; i++) {
            address next = s.recoverySuccessor[current];
            if (next == address(0) || next == current) break;
            current = next;
        }
    }
}
