// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { EnvelopeStorage } from "../lib/EnvelopeStorage.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { EscrowLib } from "../lib/EscrowLib.sol";
import { ClaimAttributionLib } from "../lib/ClaimAttributionLib.sol";
import { ClaimAttributionStorage } from "../lib/ClaimAttributionStorage.sol";
import { IssuanceAccountingLib } from "../lib/IssuanceAccountingLib.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { SettlementCycleLib } from "../lib/SettlementCycleLib.sol";
import { SettlementCycleStorage } from "../lib/SettlementCycleStorage.sol";
import { InstitutionLifecycleStorage } from "../lib/InstitutionLifecycleStorage.sol";
import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";
import { ComplianceHoldLib } from "../lib/ComplianceHoldLib.sol";
import { EnvelopeGuardLib } from "../lib/EnvelopeGuardLib.sol";

/**
 * @title TransferEnvelopeFacet
 * @notice Settlement, dispute resolution, oracle callback, and expiration
 *         processing for T3 transfer envelopes (FR-1002, FR-1003, FR-1004).
 * @dev This facet holds the heavy settlement internals and the functions that
 *      depend on them. The lifecycle/admin/view surface lives in
 *      TransferEnvelopeAdminFacet to keep both facets under the EIP-170 limit.
 *
 *      All events emit plaintext amounts per ADR-004 Besu consortium
 *      visibility model. No commitment-only events.
 *
 *      Escrow model: tokens are held in the diamond's own ERC-20 balance
 *      (transferred from sender to address(this) on create; released on
 *      finalize/reverse/dispute-resolve). This keeps total supply invariant.
 *
 *      ERC-2771 posture (K-F12): raw msg.sender by design. Escrow pulls from
 *      the caller's balance and lifecycle actions match against stored
 *      env.sender/env.recipient, so switching to _msgSender() would change
 *      whose funds move — a semantic redesign, not a hygiene fix. Relayed
 *      calls fail safe (forwarder has no balance / fails the party match).
 */
contract TransferEnvelopeFacet is ReentrancyGuardBase {

    // =========================================================================
    // ERRORS (facet-specific — storage errors are in EnvelopeStorage)
    // =========================================================================

    error NotImplemented();
    error ReceivingIssuerNotActive(address receivingIssuer);
    error NoOpenSettlementCycle();
    error CrossInstitutionFiatNotSupported();

    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// @dev Default dispute timeout (7 days). Can be overridden in storage.
    uint40 internal constant DEFAULT_DISPUTE_TIMEOUT = 7 days;

    /// @dev Default clawback window for FIAT_INSTITUTIONAL (2 days). Can be overridden in storage.
    uint40 internal constant DEFAULT_CLAWBACK_WINDOW = 2 days;

    /// @dev ExpirationBehavior enum values (mirrors EnvelopeStorage.ExpirationBehavior)
    uint8 internal constant EB_IMMEDIATE_FINALIZE = 0;
    uint8 internal constant EB_HALFLIFE_DECAY     = 1;
    uint8 internal constant EB_HOLD_UNTIL_MANUAL  = 2;
    uint8 internal constant EB_ORACLE_CONDITIONAL = 3;
    uint8 internal constant EB_AUTO_REVERSE        = 4;
    uint8 internal constant EB_DISPUTE_HOLD        = 5;

    /// @dev SettlementType enum values
    uint8 internal constant ST_CRYPTO_DIRECT      = 0;
    uint8 internal constant ST_FIAT_INSTITUTIONAL = 1;

    /// @dev EnvelopeState enum values
    uint8 internal constant ES_NONE         = 0;
    uint8 internal constant ES_CREATED      = 1;
    uint8 internal constant ES_FINALIZED    = 2;
    uint8 internal constant ES_REVERSED     = 3;
    uint8 internal constant ES_DISPUTED     = 4;
    uint8 internal constant ES_EXPIRED      = 5;
    uint8 internal constant ES_PENDING_FIAT = 6;

    /// @dev DisputeOutcome enum values
    uint8 internal constant DO_FINALIZE_TO_RECIPIENT = 0;
    uint8 internal constant DO_REVERSE_TO_SENDER     = 1;
    uint8 internal constant DO_PARTIAL_SPLIT         = 2;

    // =========================================================================
    // FR-1003: FINALIZATION
    // =========================================================================

    /**
     * @notice Finalize an envelope, releasing escrowed funds to the recipient.
     * @dev Routes through settlement branch (FR-1003) and validates expiration
     *      behavior (FR-1002) before releasing funds.
     *      Can be called by: sender (IMMEDIATE_FINALIZE after window), recipient
     *      (when they want to pull), or admin. For HOLD_UNTIL_MANUAL, only admin
     *      or authorized arbiter can finalize. For ORACLE_CONDITIONAL, anyone can
     *      call this after a successful oracle callback.
     */
    function finalizeEnvelope(bytes32 envelopeId) external nonReentrant {
        EnvelopeStorage.Layout storage l = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = l.envelopes[envelopeId];

        EnvelopeGuardLib.requireExists(env, envelopeId);
        EnvelopeGuardLib.requireState(env, envelopeId, ES_CREATED);

        uint8 behavior = env.expirationBehavior;

        // Trigger expiration processing first — auto-behaviors may change state
        _processExpirationOnFinalize(l, env, envelopeId, behavior);

        // Re-check state (expiration processing might have moved it to Expired/Reversed)
        if (env.state != ES_CREATED) {
            // State transition happened during expiration; return without double-settling.
            return;
        }

        // Authorization check:
        // - HOLD_UNTIL_MANUAL requires admin or arbiter
        // - ORACLE_CONDITIONAL requires the oracle callback to have been received with result=true
        // - Others allow sender, recipient, or admin
        if (behavior == EB_HOLD_UNTIL_MANUAL) {
            EnvelopeGuardLib.requireAdminOrArbiter(envelopeId);
        } else if (behavior == EB_ORACLE_CONDITIONAL) {
            _requireOracleApproval(l, envelopeId);
        } else {
            EnvelopeGuardLib.requireSenderRecipientOrAdmin(env, envelopeId);
        }

        // Settle per settlement type (FR-1003)
        if (env.settlementType == ST_FIAT_INSTITUTIONAL) {
            _initiateProvisionalFiat(l, env, envelopeId);
        } else {
            env.state = ES_FINALIZED;
            _settle(l, env, envelopeId);
        }
    }

    // =========================================================================
    // FR-1004: DISPUTE RESOLUTION
    // =========================================================================

    /**
     * @notice Resolve a dispute, determining the outcome for escrowed funds.
     * @dev Only admin can resolve disputes. Implements FR-1004 outcome routing.
     *      Also handles timeout-based default resolution.
     *
     *      Compliance-hold interaction (Task 4.2 / kimi Sprint 4 exit LOW-3):
     *      the DisputeData resolution fields (resolver/resolvedAt/outcome) are
     *      recorded BEFORE the REVERSE_TO_SENDER refund leg runs its compliance
     *      check. If that leg parks a hold, `getDispute()` reports the dispute
     *      as resolved while the envelope stays ES_DISPUTED and the funds sit
     *      in the hold until `resolveComplianceHold` dispositions them. This is
     *      intentional: the dispute DECISION is final; only the payout is
     *      deferred. Consumers must treat `isHeld(ENVELOPE_DOMAIN, id)` — not
     *      `getDispute().resolver` — as the settlement-liveness signal.
     */
    function resolveDispute(bytes32 envelopeId, uint8 outcome, uint256 splitAmount) external nonReentrant {
        EnvelopeStorage.Layout storage l = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = l.envelopes[envelopeId];
        EnvelopeStorage.DisputeData storage d = l.disputes[envelopeId];

        EnvelopeGuardLib.requireExists(env, envelopeId);
        EnvelopeGuardLib.requireState(env, envelopeId, ES_DISPUTED);

        // Task 4.2 (Q2): a compliance-held envelope parks in DISPUTED — block
        // dispute resolution (incl. the post-timeout defaultOutcome path, which
        // would pay the blocked party) until the hold is dispositioned via
        // resolveComplianceHold.
        if (ComplianceHoldLib.isHeld(ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId)) {
            revert ComplianceHoldLib.ComplianceHoldActive(envelopeId);
        }

        if (d.raisedAt == 0) revert EnvelopeStorage.DisputeNotActive(envelopeId);
        if (d.resolver != address(0)) revert EnvelopeStorage.DisputeNotActive(envelopeId); // already resolved

        if (outcome > DO_PARTIAL_SPLIT) revert EnvelopeStorage.InvalidDisputeOutcome(outcome);

        // Only admin can resolve disputes (FR-1004 authority model)
        if (!EnvelopeGuardLib.isAdmin(msg.sender)) {
            // Check for timeout-based default resolution (anyone can trigger after timeout)
            if (uint40(block.timestamp) < d.timeoutAt) {
                revert EnvelopeGuardLib.CallerNotArbiter(envelopeId);
            }
            // Timeout reached — enforce default outcome (ignore caller's outcome parameter)
            outcome = d.defaultOutcome;
        }

        // Record resolution
        d.resolver    = msg.sender;
        d.resolvedAt  = uint40(block.timestamp);
        d.outcome     = outcome;
        d.splitAmount = (outcome == DO_PARTIAL_SPLIT) ? splitAmount : 0;

        uint256 escrowed = env.amount - env.reversedAmount;

        // Execute outcome
        if (outcome == DO_FINALIZE_TO_RECIPIENT) {
            env.state = ES_FINALIZED;
            _settle(l, env, envelopeId);
        } else if (outcome == DO_REVERSE_TO_SENDER) {
            if (!_holdRefundLeg(env, envelopeId, escrowed, ComplianceHoldLib.LEG_DISPUTE_REFUND)) {
                env.state = ES_REVERSED;
                EscrowLib.releaseEscrow(WalletRecoveryStorage._resolveRecoveryPayee(env.sender), ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, escrowed);
            }
        } else {
            // PARTIAL_SPLIT
            if (splitAmount > escrowed) splitAmount = escrowed;
            uint256 senderPortion = escrowed - splitAmount;
            env.state = ES_FINALIZED; // Mark as resolved (finalized is terminal)
            if (splitAmount > 0) {
                _settleAmount(l, env, envelopeId, splitAmount);
            }
            if (senderPortion > 0 && !_holdRefundLeg(env, envelopeId, senderPortion, ComplianceHoldLib.LEG_DISPUTE_REFUND)) {
                EscrowLib.releaseEscrow(WalletRecoveryStorage._resolveRecoveryPayee(env.sender), ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, senderPortion);
            }
        }

        emit EnvelopeStorage.DisputeResolved(envelopeId, msg.sender, outcome, uint40(block.timestamp));
    }

    // =========================================================================
    // FR-1004: ORACLE SURFACE
    // =========================================================================

    /**
     * @notice Called by the registered oracle to deliver its callback result.
     * @dev FR-1004: Only the registered oracle address can call this.
     *      If oracle reverts or is unavailable, the envelope remains in escrow (safe fallback).
     *      Replay protection: callbackReceived flag prevents duplicate callbacks.
     * @param envelopeId The envelope the oracle is resolving.
     * @param result     true = finalize to recipient, false = reverse to sender.
     */
    function receiveOracleCallback(bytes32 envelopeId, bool result) external nonReentrant {
        EnvelopeStorage.Layout storage l = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = l.envelopes[envelopeId];
        EnvelopeStorage.OracleBinding storage ob = l.oracleBindings[envelopeId];

        EnvelopeGuardLib.requireExists(env, envelopeId);
        EnvelopeGuardLib.requireState(env, envelopeId, ES_CREATED);

        // Only the registered oracle may call this
        if (ob.oracleAddress == address(0)) revert EnvelopeStorage.OracleNotRegistered(envelopeId);
        if (msg.sender != ob.oracleAddress) revert EnvelopeStorage.OracleCallbackUnauthorized(envelopeId, msg.sender);
        // Replay protection
        if (ob.callbackReceived) revert EnvelopeStorage.OracleCallbackAlreadyReceived(envelopeId);

        ob.callbackReceived = true;
        ob.callbackResult   = result;

        emit EnvelopeStorage.OracleCallbackReceived(envelopeId, msg.sender, result);

        // Auto-execute: result=true finalizes, result=false reverses
        if (result) {
            env.state = ES_FINALIZED;
            _settle(l, env, envelopeId);
            emit EnvelopeStorage.EnvelopeFinalized(envelopeId, uint40(block.timestamp));
        } else {
            uint256 escrowed = env.amount - env.reversedAmount;
            if (!_holdRefundLeg(env, envelopeId, escrowed, ComplianceHoldLib.LEG_ORACLE_REVERSE)) {
                env.state = ES_REVERSED;
                EscrowLib.releaseEscrow(WalletRecoveryStorage._resolveRecoveryPayee(env.sender), ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, escrowed);
                emit EnvelopeStorage.EnvelopeReversed(envelopeId, escrowed, uint40(block.timestamp));
            }
        }
    }

    /**
     * @notice Trigger time-based expiration processing for an envelope.
     * @dev Anyone can call this after commitWindowEnd to trigger AUTO_REVERSE
     *      or IMMEDIATE_FINALIZE expiration behaviors. This is the external
     *      entrypoint for keepers / relayers to settle expired envelopes.
     * @param envelopeId The envelope to expire.
     */
    function processExpiration(bytes32 envelopeId) external nonReentrant {
        EnvelopeStorage.Layout storage l = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = l.envelopes[envelopeId];

        EnvelopeGuardLib.requireExists(env, envelopeId);

        // Handle expired provisional fiat settlement: clawback window passed → auto-confirm
        if (env.state == ES_PENDING_FIAT) {
            if (uint40(block.timestamp) < env.clawbackDeadline) {
                revert EnvelopeStorage.ClawbackWindowActive(envelopeId);
            }
            uint256 escrowed = env.amount - env.reversedAmount;

            // Wave 8B: forward pending-fiat auto-confirm release to recipient
            StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
            ComplianceLib.precheckGated(ds, env.sender, env.recipient, escrowed, ComplianceLib.Context.ESCROW_RELEASE);

            env.state = ES_FINALIZED;
            EscrowLib.burnEscrow(ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, escrowed);
            emit EnvelopeStorage.FiatDeliveryConfirmed(envelopeId, uint40(block.timestamp));
            return;
        }

        EnvelopeGuardLib.requireState(env, envelopeId, ES_CREATED);

        if (uint40(block.timestamp) < env.commitWindowEnd) {
            revert EnvelopeStorage.EnvelopeNotExpired(envelopeId);
        }

        uint8 behavior = env.expirationBehavior;

        if (behavior == EB_IMMEDIATE_FINALIZE) {
            // Auto-finalize: settle per settlement type
            if (env.settlementType == ST_FIAT_INSTITUTIONAL) {
                _initiateProvisionalFiat(l, env, envelopeId);
            } else {
                env.state = ES_FINALIZED;
                _settle(l, env, envelopeId);
            }
        } else if (behavior == EB_AUTO_REVERSE) {
            // Auto-reverse: return funds to sender
            uint256 escrowed = env.amount - env.reversedAmount;
            if (!_holdRefundLeg(env, envelopeId, escrowed, ComplianceHoldLib.LEG_EXPIRY_AUTO_REVERSE)) {
                env.state = ES_REVERSED;
                EscrowLib.releaseEscrow(WalletRecoveryStorage._resolveRecoveryPayee(env.sender), ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, escrowed);
                emit EnvelopeStorage.EnvelopeReversed(envelopeId, escrowed, uint40(block.timestamp));
            }
        } else if (behavior == EB_ORACLE_CONDITIONAL) {
            // Oracle unavailable/expired: safe fallback — return to sender
            EnvelopeStorage.OracleBinding storage ob = l.oracleBindings[envelopeId];
            if (!ob.callbackReceived) {
                uint256 escrowed = env.amount - env.reversedAmount;
                if (!_holdRefundLeg(env, envelopeId, escrowed, ComplianceHoldLib.LEG_EXPIRY_AUTO_REVERSE)) {
                    env.state = ES_REVERSED;
                    EscrowLib.releaseEscrow(WalletRecoveryStorage._resolveRecoveryPayee(env.sender), ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, escrowed);
                    emit EnvelopeStorage.EnvelopeReversed(envelopeId, escrowed, uint40(block.timestamp));
                }
            }
            // If callback already received, do nothing here (caller should use finalizeEnvelope/reverseEnvelope)
        } else {
            // HALFLIFE_DECAY, HOLD_UNTIL_MANUAL, DISPUTE_HOLD: not auto-processed here
            revert EnvelopeStorage.EnvelopeNotExpired(envelopeId);
        }
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    /**
     * @notice Run the compliance funnel on a sender-refund leg; park a hold on failure.
     * @dev Task 4.2 (D2): refund/return legs to screened-out counterparties route to
     *      an admin hold instead of paying out. MUST be called BEFORE the caller
     *      mutates env.state / env.reversedAmount — resolution re-applies the
     *      reversal accounting and restores env.state from the snapshot taken here.
     *      Passes RAW env.sender: recovery-payee resolution happens exactly once,
     *      inside ComplianceHoldLib (callers must not pre-resolve).
     * @return held true when the payout was parked (caller skips release + state change)
     */
    function _holdRefundLeg(
        EnvelopeStorage.EnvelopeData storage env,
        bytes32 envelopeId,
        uint256 amount,
        uint8 leg
    ) private returns (bool held) {
        return ComplianceHoldLib.checkOrHold(
            ClaimAttributionLib.ENVELOPE_DOMAIN,
            envelopeId,
            env.recipient,
            env.sender,
            amount,
            ComplianceLib.Context.ESCROW_RELEASE,
            bytes32(0),
            env.state,
            leg
        );
    }

    /**
     * @notice Revert if the oracle callback has not delivered a true result.
     */
    function _requireOracleApproval(
        EnvelopeStorage.Layout storage l,
        bytes32 envelopeId
    ) internal view {
        EnvelopeStorage.OracleBinding storage ob = l.oracleBindings[envelopeId];
        if (!ob.callbackReceived || !ob.callbackResult) {
            revert EnvelopeStorage.OracleNotRegistered(envelopeId);
        }
    }

    /**
     * @notice Process expiration logic on finalize attempt.
     * @dev Called at the start of finalizeEnvelope to handle time-based transitions.
     *      Auto-behaviors (IMMEDIATE_FINALIZE, AUTO_REVERSE) fire if commitWindowEnd
     *      has passed and someone calls finalizeEnvelope. This avoids the need for
     *      a separate keeper call in those cases.
     */
    function _processExpirationOnFinalize(
        EnvelopeStorage.Layout storage l,
        EnvelopeStorage.EnvelopeData storage env,
        bytes32 envelopeId,
        uint8 behavior
    ) internal {
        // Only auto-process if the window has passed
        if (uint40(block.timestamp) < env.commitWindowEnd) return;

        if (behavior == EB_AUTO_REVERSE) {
            // AUTO_REVERSE: window expired without prior finalization — return to sender.
            // A hold parks the envelope in DISPUTED; finalizeEnvelope's post-helper
            // state re-check then returns without settling.
            uint256 escrowed = env.amount - env.reversedAmount;
            if (!_holdRefundLeg(env, envelopeId, escrowed, ComplianceHoldLib.LEG_EXPIRY_AUTO_REVERSE)) {
                env.state = ES_REVERSED;
                EscrowLib.releaseEscrow(WalletRecoveryStorage._resolveRecoveryPayee(env.sender), ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, escrowed);
                emit EnvelopeStorage.EnvelopeReversed(envelopeId, escrowed, uint40(block.timestamp));
            }
        }
        // IMMEDIATE_FINALIZE: fall through to normal finalization path (no early exit needed)
        // HALFLIFE_DECAY: window may have passed; finalization is still allowed (decay just reduces reversals)
        // HOLD_UNTIL_MANUAL: no time-based expiration — admin must explicitly act
        // ORACLE_CONDITIONAL: handled by oracle callback path; timeout handled by processExpiration()
        // DISPUTE_HOLD: state is ES_DISPUTED; won't reach here
    }

    /**
     * @notice Compute the reversible amount for a HALFLIFE_DECAY envelope.
     * @dev Linear decay from full amount at createdAt to 0 at commitWindowEnd.
     *      Per-envelope state (not per-recipient) — fixes TC-INT-003.
     *      Returns 0 after commitWindowEnd.
     */
    function _computeHalflifeReversible(
        EnvelopeStorage.EnvelopeData storage env
    ) internal view returns (uint256) {
        uint40 now_ = uint40(block.timestamp);
        if (now_ >= env.commitWindowEnd) return 0;

        uint40 elapsed = now_ - env.createdAt;
        uint40 window  = env.commitWindowEnd - env.createdAt;

        // Reversible = total * (window - elapsed) / window  (linear decay)
        uint256 total = env.amount - env.reversedAmount;
        // Avoid division by zero (window > 0 guaranteed since commitWindowEnd > createdAt)
        return (total * uint256(window - elapsed)) / uint256(window);
    }

    /**
     * @notice Settle the full remaining escrowed amount per settlement type.
     */
    function _settle(
        EnvelopeStorage.Layout storage l,
        EnvelopeStorage.EnvelopeData storage env,
        bytes32 envelopeId
    ) internal {
        uint256 escrowed = env.amount - env.reversedAmount;
        _settleAmount(l, env, envelopeId, escrowed);
        emit EnvelopeStorage.EnvelopeFinalized(envelopeId, uint40(block.timestamp));
    }

    /**
     * @notice Settle a specific amount — always CRYPTO_DIRECT (direct release to recipient).
     * @dev Called from admin/oracle override paths (resolveDispute, receiveOracleCallback)
     *      where the settlement is authoritative and bypasses the provisional fiat flow.
     *      For user-initiated FIAT_INSTITUTIONAL settlement, use _initiateProvisionalFiat instead.
     *
     *      When claim attribution is initialized, this wires finalizeEnvelopeClaims to transfer
     *      the sender-side issuer composition to the recipient (same-institution), or applies
     *      substituteLiability to swap to env.receivingIssuer (cross-institution).
     *      When not initialized, falls back to the legacy releaseEscrow attribution path.
     *      Supports partial amounts (PARTIAL_SPLIT): _debitEscrow leaves the remainder in the
     *      escrow claims bucket for the subsequent reversal leg in resolveDispute.
     */
    function _settleAmount(
        EnvelopeStorage.Layout storage, // l (unused)
        EnvelopeStorage.EnvelopeData storage env,
        bytes32, // envelopeId (unused)
        uint256 amount
    ) internal {
        // 8B: forward release; sender-return leg intentionally not checked
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ComplianceLib.precheckGated(ds, env.sender, env.recipient, amount, ComplianceLib.Context.ESCROW_RELEASE);

        address resolvedRecipient = WalletRecoveryStorage._resolveRecoveryPayee(env.recipient);
        ClaimAttributionStorage.Layout storage claims = ClaimAttributionStorage.layout();
        if (claims.initialized) {
            bytes32 escrowKey = keccak256(abi.encode(ClaimAttributionLib.ENVELOPE_DOMAIN, env.id));
            bool crossInstitution = env.receivingIssuer != address(0);
            (, address[] memory outIssuers, uint256[] memory outAmounts) =
                ClaimAttributionLib.finalizeEnvelopeClaims(
                    claims, escrowKey, resolvedRecipient, env.receivingIssuer, amount, crossInstitution
                );
            if (crossInstitution && outIssuers.length > 0) {
                // S1 (ADR-003): only a REGISTERED, ACTIVE bank may take on new attributed
                // liability. The activeBanks predicate is required because InstitutionMode's
                // default is ACTIVE(0) — without it an unregistered address would pass (bug_030).
                // Matches BankingEligibilityLib.requireRiskIncreasingInstitution composition.
                if (
                    !ConsortiumStorage.layout().activeBanks[env.receivingIssuer] ||
                    InstitutionLifecycleStorage.layout().institutionMode[env.receivingIssuer]
                        != InstitutionLifecycleStorage.InstitutionMode.ACTIVE
                ) revert ReceivingIssuerNotActive(env.receivingIssuer);

                IssuanceAccountingLib.substituteLiability(
                    outIssuers, outAmounts, env.receivingIssuer, amount
                );

                // Double-write (only once the settlement model is activated by an admin):
                // record interbank obligations into the current open cycle. The bilateral-net
                // reimbursement lien is encumbered inside recordObligation, so no separate
                // encumber call. Fail-closed if no cycle is open (no unsecured settlement).
                // Until activation, cross-bank finalize keeps the G.0.b attribution-only behavior.
                SettlementCycleStorage.Layout storage sc = SettlementCycleStorage.layout();
                if (sc.settlementModelActive) {
                    bytes32 cycleId = sc.currentCycleId;
                    if (cycleId == bytes32(0)) revert NoOpenSettlementCycle();
                    for (uint256 i = 0; i < outIssuers.length; i++) {
                        SettlementCycleLib.recordObligation(
                            cycleId,
                            outIssuers[i],          // outgoing issuer (owes reimbursement)
                            env.receivingIssuer,    // receiving issuer (owed)
                            outIssuers[i],          // senderInstitution (issuer = institution in this model)
                            env.receivingIssuer,    // recipientInstitution
                            outAmounts[i],
                            env.id
                        );
                    }
                }
            }
            EscrowLib.releaseEscrow(resolvedRecipient, amount);
        } else {
            EscrowLib.releaseEscrow(resolvedRecipient, ClaimAttributionLib.ENVELOPE_DOMAIN, env.id, amount);
        }
    }

    /**
     * @notice Initiate provisional settlement for a FIAT_INSTITUTIONAL envelope.
     * @dev Tokens remain in the diamond's escrow balance. State transitions to
     *      PendingFiatConfirmation. The Ponder indexer watches FiatSettlementTriggered
     *      to drive the off-chain fiat wire. Admin calls confirmFiatDelivery or
     *      clawbackSettlement to complete the settlement.
     */
    function _initiateProvisionalFiat(
        EnvelopeStorage.Layout storage l,
        EnvelopeStorage.EnvelopeData storage env,
        bytes32 envelopeId
    ) internal {
        uint40 window = l.defaultClawbackWindow > 0 ? l.defaultClawbackWindow : DEFAULT_CLAWBACK_WINDOW;
        uint40 deadline = uint40(block.timestamp) + window;
        env.state = ES_PENDING_FIAT;
        env.clawbackDeadline = deadline;
        uint256 escrowed = env.amount - env.reversedAmount;
        emit EnvelopeStorage.FiatSettlementTriggered(envelopeId, escrowed, deadline);
    }
}
