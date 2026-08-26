// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { EnvelopeStorage } from "../lib/EnvelopeStorage.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { EscrowLib } from "../lib/EscrowLib.sol";
import { ClaimAttributionLib } from "../lib/ClaimAttributionLib.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { ViewACLLib } from "../lib/ViewACLLib.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";
import { ComplianceTravelRuleLib } from "../lib/ComplianceTravelRuleLib.sol";
import { EnvelopeGuardLib } from "../lib/EnvelopeGuardLib.sol";
import { ComplianceHoldLib } from "../lib/ComplianceHoldLib.sol";
import { ComplianceHoldStorage } from "../lib/ComplianceHoldStorage.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title TransferEnvelopeAdminFacet
 * @notice Lifecycle creation, reversal, dispute raising, oracle registration,
 *         fiat settlement administration, configuration, and envelope views.
 * @dev This facet owns the envelope operations that do NOT depend on the heavy
 *      settlement internals (_settle, _settleAmount, _initiateProvisionalFiat).
 *      It pairs with TransferEnvelopeFacet so that both facets stay under the
 *      EIP-170 deployed-bytecode limit.
 *
 *      All events emit plaintext amounts per ADR-004 Besu consortium
 *      visibility model. No commitment-only events.
 */
contract TransferEnvelopeAdminFacet is ReentrancyGuardBase {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // =========================================================================
    // ERRORS (facet-specific — storage errors are in EnvelopeStorage)
    // =========================================================================

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
    // FR-1001: CORE LIFECYCLE
    // =========================================================================

    /**
     * @notice Create a new transfer envelope with funds escrowed from msg.sender.
     * @dev Escrows `amount` tokens from msg.sender into this contract.
     *      Generates a deterministic envelopeId from nonce + block context.
     *      For ORACLE_CONDITIONAL, an oracle must be registered before
     *      commitWindowEnd via registerOracle().
     */
    function createEnvelope(
        address recipient,
        uint256 amount,
        uint40 commitWindowEnd,
        uint8 settlementType,
        uint8 expirationBehavior,
        bytes calldata conditionData
    ) external nonReentrant returns (bytes32 envelopeId) {
        // --- Input validation ---
        if (recipient == address(0)) revert EnvelopeStorage.InvalidRecipient();
        if (amount == 0) revert EnvelopeStorage.InvalidAmount();
        if (commitWindowEnd <= uint40(block.timestamp)) revert EnvelopeStorage.InvalidCommitWindowEnd();
        if (settlementType > ST_FIAT_INSTITUTIONAL) revert EnvelopeStorage.InvalidSettlementType(settlementType);
        if (expirationBehavior > EB_DISPUTE_HOLD) revert EnvelopeStorage.InvalidExpirationBehavior(expirationBehavior);
        // ORACLE_CONDITIONAL requires conditionData to be present (at minimum a non-empty hint)
        if (expirationBehavior == EB_ORACLE_CONDITIONAL && conditionData.length == 0) {
            revert EnvelopeStorage.ConditionDataRequired();
        }

        // Quarantine check: sender cannot be in recovery
        if (WalletRecoveryStorage.layout().activeRecoveryCount[msg.sender] > 0) {
            revert IWalletRecovery.WalletInRecovery(msg.sender);
        }

        // Wave 8B: forward escrow in
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ComplianceLib.precheckGated(ds, msg.sender, recipient, amount, ComplianceLib.Context.ESCROW_IN);

        // --- Generate unique envelope ID ---
        EnvelopeStorage.Layout storage l = EnvelopeStorage.layout();
        l.envelopeNonce++;
        envelopeId = keccak256(
            abi.encodePacked(
                msg.sender,
                recipient,
                amount,
                commitWindowEnd,
                l.envelopeNonce,
                block.chainid,
                block.timestamp
            )
        );

        // Guard against collision (extremely unlikely but defense-in-depth)
        if (l.envelopes[envelopeId].state != ES_NONE) {
            revert EnvelopeStorage.EnvelopeAlreadyExists(envelopeId);
        }

        // Wave 8D: atomic travel-rule binding at create time
        ComplianceTravelRuleLib.bindOnCreate(
            ds, msg.sender, recipient, envelopeId, amount, ComplianceTravelRuleLib.OBJ_ENVELOPE
        );

        // --- Escrow: transfer tokens from sender to diamond ---
        EscrowLib.escrowFrom(msg.sender, ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, amount);

        // --- Persist envelope state ---
        EnvelopeStorage.EnvelopeData storage env = l.envelopes[envelopeId];
        env.id                = envelopeId;
        env.sender            = msg.sender;
        env.recipient         = recipient;
        env.amount            = amount;
        env.commitWindowEnd   = commitWindowEnd;
        env.settlementType    = settlementType;
        env.expirationBehavior = expirationBehavior;
        env.state             = ES_CREATED;
        env.createdAt         = uint40(block.timestamp);
        env.reversedAmount    = 0;
        if (conditionData.length > 0) {
            env.conditionDataHash = keccak256(conditionData);
        }

        // --- Index by sender and recipient ---
        l.senderEnvelopeIds[msg.sender].push(envelopeId);
        l.recipientEnvelopeIds[recipient].push(envelopeId);

        // --- Emit plaintext event per ADR-004 ---
        emit EnvelopeStorage.EnvelopeCreated(
            envelopeId,
            msg.sender,
            recipient,
            amount,
            commitWindowEnd,
            settlementType,
            expirationBehavior
        );
    }

    /**
     * @notice Reverse an envelope, returning some or all escrowed funds to the sender.
     * @dev Releases `amount` from escrow back to sender.
     *      For HALFLIFE_DECAY, the reversible amount decays over time.
     *      A full reversal transitions to Reversed state;
     *      a partial reversal keeps envelope in Created state.
     */
    function reverseEnvelope(bytes32 envelopeId, uint256 amount) external nonReentrant {
        EnvelopeStorage.Layout storage l = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = l.envelopes[envelopeId];

        EnvelopeGuardLib.requireExists(env, envelopeId);
        EnvelopeGuardLib.requireState(env, envelopeId, ES_CREATED);

        // Only sender can reverse (or admin)
        if (msg.sender != env.sender) {
            if (!EnvelopeGuardLib.isAdmin(msg.sender)) {
                revert EnvelopeGuardLib.CallerNotSenderOrArbiter(envelopeId);
            }
        }

        uint256 escrowed = env.amount - env.reversedAmount;

        // For HALFLIFE_DECAY: compute reversible amount based on elapsed time
        if (env.expirationBehavior == EB_HALFLIFE_DECAY) {
            uint256 reversible = _computeHalflifeReversible(env);
            if (amount > reversible) {
                revert EnvelopeStorage.ReversalExceedsRemaining(envelopeId, amount, reversible);
            }
        } else if (env.expirationBehavior == EB_HOLD_UNTIL_MANUAL) {
            // HOLD_UNTIL_MANUAL: only admin/arbiter can reverse
            EnvelopeGuardLib.requireAdminOrArbiter(envelopeId);
        } else if (env.expirationBehavior == EB_ORACLE_CONDITIONAL) {
            // ORACLE_CONDITIONAL: reversal requires oracle result=false or no oracle yet
            EnvelopeStorage.OracleBinding storage ob = l.oracleBindings[envelopeId];
            if (ob.callbackReceived && ob.callbackResult) {
                revert EnvelopeStorage.ReversalNotPermitted(envelopeId);
            }
        }

        if (amount == 0 || amount > escrowed) {
            revert EnvelopeStorage.ReversalExceedsRemaining(envelopeId, amount, escrowed);
        }

        // Task 4.2 (D2): screened-out sender routes to an admin hold BEFORE the
        // reversal accounting — resolveComplianceHold re-applies reversedAmount
        // and restores the pre-park state for partial reversals.
        if (_holdRefundLeg(env, envelopeId, amount, ComplianceHoldLib.LEG_REVERSE)) {
            return;
        }

        // Update reversed amount
        env.reversedAmount += amount;
        uint256 remaining = env.amount - env.reversedAmount;

        if (remaining == 0) {
            // Full reversal — transition to Reversed
            env.state = ES_REVERSED;
            EscrowLib.releaseEscrow(WalletRecoveryStorage._resolveRecoveryPayee(env.sender), ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, amount);
            emit EnvelopeStorage.EnvelopeReversed(envelopeId, amount, uint40(block.timestamp));
        } else {
            // Partial reversal — stays in Created with reduced escrow
            EscrowLib.releaseEscrow(WalletRecoveryStorage._resolveRecoveryPayee(env.sender), ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, amount);
            emit EnvelopeStorage.EnvelopeReversed(envelopeId, amount, uint40(block.timestamp));
        }
    }

    // =========================================================================
    // FR-1004: DISPUTE SURFACE
    // =========================================================================

    /**
     * @notice Raise a dispute on an envelope, freezing it in DISPUTED.
     * @dev Sender, recipient, or admin can raise a dispute.
     *      Transitions envelope from Created to Disputed.
     */
    function raiseDispute(bytes32 envelopeId, bytes calldata reason) external nonReentrant {
        EnvelopeStorage.Layout storage l = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = l.envelopes[envelopeId];

        EnvelopeGuardLib.requireExists(env, envelopeId);
        EnvelopeGuardLib.requireState(env, envelopeId, ES_CREATED);

        // Only sender, recipient, or admin can raise a dispute
        if (msg.sender != env.sender && msg.sender != env.recipient) {
            if (!EnvelopeGuardLib.isAdmin(msg.sender)) {
                revert EnvelopeGuardLib.CallerNotSenderOrArbiter(envelopeId);
            }
        }

        // Guard: no existing active dispute
        if (l.disputes[envelopeId].raisedAt != 0) {
            revert EnvelopeStorage.DisputeAlreadyActive(envelopeId);
        }

        uint40 timeoutAt = uint40(block.timestamp) + _disputeTimeout(l);

        EnvelopeStorage.DisputeData storage d = l.disputes[envelopeId];
        d.raisedBy      = msg.sender;
        d.raisedAt      = uint40(block.timestamp);
        d.timeoutAt     = timeoutAt;
        d.defaultOutcome = DO_REVERSE_TO_SENDER; // Safe default: return funds to sender
        d.reasonHash    = keccak256(reason);

        env.state = ES_DISPUTED;

        emit EnvelopeStorage.DisputeRaised(envelopeId, msg.sender, d.reasonHash, timeoutAt);
    }

    /**
     * @notice Register an oracle for an ORACLE_CONDITIONAL envelope.
     * @dev Only admin or ORACLE_ROLE can register an oracle.
     *      Oracle must be registered before commitWindowEnd for timely callback.
     */
    function registerOracle(
        bytes32 envelopeId,
        address oracleAddress,
        bytes4 callbackSelector
    ) external {
        EnvelopeStorage.Layout storage l = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = l.envelopes[envelopeId];

        EnvelopeGuardLib.requireExists(env, envelopeId);

        // Only ORACLE_CONDITIONAL envelopes can have an oracle registered
        if (env.expirationBehavior != EB_ORACLE_CONDITIONAL) {
            revert EnvelopeStorage.OracleRequiredForBehavior(envelopeId);
        }

        // Only admin or ORACLE_ROLE can register
        if (!EnvelopeGuardLib.isAdmin(msg.sender) && !EnvelopeGuardLib.hasOracleRole(msg.sender)) {
            revert EnvelopeGuardLib.CallerNotArbiter(envelopeId);
        }

        EnvelopeStorage.OracleBinding storage ob = l.oracleBindings[envelopeId];
        if (ob.oracleAddress != address(0)) {
            revert EnvelopeStorage.OracleAlreadyRegistered(envelopeId);
        }

        ob.oracleAddress    = oracleAddress;
        ob.callbackSelector = callbackSelector;
        ob.callbackReceived = false;
        ob.callbackResult   = false;

        emit EnvelopeStorage.OracleRegistered(envelopeId, oracleAddress, callbackSelector);
    }

    // =========================================================================
    // FR-1003: FIAT INSTITUTIONAL PROVISIONAL SETTLEMENT ADMINISTRATION
    // =========================================================================

    /**
     * @notice Confirm that fiat delivery occurred for a FIAT_INSTITUTIONAL envelope.
     * @dev Burns tokens from escrow. Callable by admin/relayer after fiat wire confirmed.
     */
    function confirmFiatDelivery(bytes32 envelopeId) external nonReentrant {
        EnvelopeStorage.Layout storage l = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = l.envelopes[envelopeId];

        EnvelopeGuardLib.requireExists(env, envelopeId);
        if (env.state != ES_PENDING_FIAT) {
            revert EnvelopeStorage.EnvelopeNotInState(envelopeId, env.state, ES_PENDING_FIAT);
        }
        EnvelopeGuardLib.requireAdmin();

        uint256 escrowed = env.amount - env.reversedAmount;

        // Wave 8B: forward escrow release to recipient
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ComplianceLib.precheckGated(ds, env.sender, env.recipient, escrowed, ComplianceLib.Context.ESCROW_RELEASE);

        env.state = ES_FINALIZED;
        EscrowLib.burnEscrow(ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, escrowed);
        emit EnvelopeStorage.FiatDeliveryConfirmed(envelopeId, uint40(block.timestamp));
    }

    /**
     * @notice Claw back a FIAT_INSTITUTIONAL settlement within the clawback window.
     * @dev Returns tokens from escrow to sender. Only callable within clawback window.
     */
    function clawbackSettlement(bytes32 envelopeId) external nonReentrant {
        EnvelopeStorage.Layout storage l = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = l.envelopes[envelopeId];

        EnvelopeGuardLib.requireExists(env, envelopeId);
        if (env.state != ES_PENDING_FIAT) {
            revert EnvelopeStorage.EnvelopeNotInState(envelopeId, env.state, ES_PENDING_FIAT);
        }
        if (uint40(block.timestamp) >= env.clawbackDeadline) {
            revert EnvelopeStorage.ClawbackWindowExpired(envelopeId);
        }
        EnvelopeGuardLib.requireAdmin();

        uint256 escrowed = env.amount - env.reversedAmount;
        if (_holdRefundLeg(env, envelopeId, escrowed, ComplianceHoldLib.LEG_CLAWBACK)) {
            return;
        }
        env.state = ES_REVERSED;
        EscrowLib.releaseEscrow(WalletRecoveryStorage._resolveRecoveryPayee(env.sender), ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, escrowed);
        emit EnvelopeStorage.FiatSettlementClawedBack(envelopeId, escrowed, uint40(block.timestamp));
    }

    // =========================================================================
    // COMPLIANCE HOLD ADMINISTRATION (Sprint 4, D2)
    // =========================================================================

    /**
     * @notice Dispose of a compliance payout hold.
     * @dev ADMIN_ROLE only. outcome: 1 = pay original payee (re-screened),
     *      2 = pay alternate payee (re-screened), 3 = burn to issuer reserve.
     *      Returns false (without reverting) when a re-screen still blocks the
     *      payee — the hold stays active for a later attempt.
     */
    function resolveComplianceHold(
        bytes32 domain,
        bytes32 objectId,
        uint8 outcome,
        address alternatePayee
    ) external nonReentrant returns (bool released) {
        EnvelopeGuardLib.requireAdmin();
        return ComplianceHoldLib.resolveComplianceHold(domain, objectId, outcome, alternatePayee);
    }

    /// @notice Get the hold record for a domain object. Operator-only.
    function getComplianceHold(
        bytes32 domain,
        bytes32 objectId
    ) external view returns (ComplianceHoldStorage.HoldRecord memory) {
        ViewACLLib.requireOperatorAccess();
        return ComplianceHoldStorage.layout().holds[
            ComplianceHoldStorage.holdKey(domain, objectId)
        ];
    }

    /**
     * @notice Run the compliance funnel on a sender-refund leg; park a hold on failure.
     * @dev Task 4.2 (D2). MUST be called BEFORE the caller mutates env.state /
     *      env.reversedAmount — resolution re-applies the reversal accounting and
     *      restores env.state from the snapshot taken here. Passes RAW env.sender:
     *      recovery-payee resolution happens exactly once, inside ComplianceHoldLib.
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

    /// @notice Paged list of active (unresolved) hold keys. Operator-only.
    /// @dev `limit` is clamped to 100 per page (kimi Sprint 4 exit LOW-4):
    ///      an unbounded page could OOG the eth_call on a large hold backlog;
    ///      callers page via `offset` and the returned `total`.
    function activeComplianceHolds(
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory keys, uint256 total) {
        ViewACLLib.requireOperatorAccess();
        if (limit > 100) limit = 100;
        EnumerableSet.Bytes32Set storage active = ComplianceHoldStorage.layout().activeHolds;
        total = active.length();
        if (offset >= total) return (new bytes32[](0), total);
        uint256 end = offset + limit;
        if (end > total) end = total;
        keys = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; ) {
            keys[i - offset] = active.at(i);
            unchecked { ++i; }
        }
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    /// @notice Get the current state of an envelope.
    function getEnvelope(bytes32 envelopeId)
        external
        view
        returns (
            address sender,
            address recipient,
            uint256 amount,
            uint40 commitWindowEnd,
            uint8 settlementType,
            uint8 expirationBehavior,
            uint8 state,
            uint40 createdAt,
            uint256 reversedAmount
        )
    {
        ViewACLLib.requireEnvelopeAccess(envelopeId);
        EnvelopeStorage.EnvelopeData storage env = EnvelopeStorage.layout().envelopes[envelopeId];
        return (
            env.sender,
            env.recipient,
            env.amount,
            env.commitWindowEnd,
            env.settlementType,
            env.expirationBehavior,
            env.state,
            env.createdAt,
            env.reversedAmount
        );
    }

    /// @notice Get envelope IDs for a given sender.
    function getEnvelopesBySender(address sender)
        external
        view
        returns (bytes32[] memory envelopeIds)
    {
        ViewACLLib.requireWalletAccess(sender);
        return EnvelopeStorage.layout().senderEnvelopeIds[sender];
    }

    /// @notice Get envelope IDs for a given recipient.
    function getEnvelopesByRecipient(address recipient)
        external
        view
        returns (bytes32[] memory envelopeIds)
    {
        ViewACLLib.requireWalletAccess(recipient);
        return EnvelopeStorage.layout().recipientEnvelopeIds[recipient];
    }

    /// @notice Get dispute data for an envelope.
    function getDispute(bytes32 envelopeId)
        external
        view
        returns (
            address raisedBy,
            uint40 raisedAt,
            uint40 timeoutAt,
            bytes32 reasonHash,
            bool resolved,
            uint8 outcome
        )
    {
        ViewACLLib.requireEnvelopeAccess(envelopeId);
        EnvelopeStorage.DisputeData storage d = EnvelopeStorage.layout().disputes[envelopeId];
        return (
            d.raisedBy,
            d.raisedAt,
            d.timeoutAt,
            d.reasonHash,
            d.resolver != address(0),
            d.outcome
        );
    }

    /// @notice Get oracle binding for an envelope.
    function getOracleBinding(bytes32 envelopeId)
        external
        view
        returns (
            address oracleAddress,
            bytes4 callbackSelector,
            bool callbackReceived,
            bool callbackResult
        )
    {
        ViewACLLib.requireEnvelopeAccess(envelopeId);
        EnvelopeStorage.OracleBinding storage ob = EnvelopeStorage.layout().oracleBindings[envelopeId];
        return (
            ob.oracleAddress,
            ob.callbackSelector,
            ob.callbackReceived,
            ob.callbackResult
        );
    }

    /**
     * @notice Returns the real (unmasked) balance for compliance/institutional access.
     * @dev Gated to COMPLIANCE_ROLE. Distinct from COMPLIANCE_OFFICER_ROLE.
     *      Returns the ERC-20 balance from AppStorage (the canonical source of truth).
     *      The masked balance model (M2) is out of scope until the 30-day partner
     *      notification period is complete. This implementation returns the real balance
     *      directly from AppStorage — same as balanceOf() until masking is activated.
     */
    function realBalanceOf(address account) external view returns (uint256) {
        if (!IAccessControl(address(this)).hasRole(RoleConstants.COMPLIANCE_ROLE, msg.sender)) {
            revert EnvelopeGuardLib.UnauthorizedCaller();
        }
        return StorageLib.diamondStorage()._balances[account];
    }

    // =========================================================================
    // CROSS-INSTITUTION ROUTING
    // =========================================================================

    /**
     * @notice Set the receiving issuer for cross-institution claim attribution.
     * @dev Admin only. Envelope must be in Created state. Setting address(0) means
     *      same-institution: the original sender-side issuer composition is preserved
     *      through to the recipient on finalization. A non-zero address triggers
     *      finalizeEnvelopeClaims(crossInstitution=true) + substituteLiability on finalize.
     *      No-op on the attribution layer if attribution has not been initialized.
     *
     *      CALLER RESPONSIBILITY: The admin must validate that receivingIssuer is an
     *      active consortium member with sufficient funded floor before setting this value.
     *      The contract does not enforce membership or capacity — that validation lives
     *      in the off-chain routing layer that determines cross-institution routing.
     */
    function setEnvelopeReceivingIssuer(bytes32 envelopeId, address receivingIssuer) external nonReentrant {
        EnvelopeGuardLib.requireAdmin();
        EnvelopeStorage.Layout storage l = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = l.envelopes[envelopeId];
        EnvelopeGuardLib.requireExists(env, envelopeId);
        EnvelopeGuardLib.requireState(env, envelopeId, ES_CREATED);
        // C2 (ADR-003): cross-institution FIAT_INSTITUTIONAL settlement is not yet routed through
        // the settlement-cycle obligation path; block it rather than silently break conservation.
        if (
            receivingIssuer != address(0) &&
            env.settlementType == uint8(EnvelopeStorage.SettlementType.FIAT_INSTITUTIONAL)
        ) revert CrossInstitutionFiatNotSupported();
        env.receivingIssuer = receivingIssuer;
        emit EnvelopeStorage.ReceivingIssuerSet(envelopeId, receivingIssuer, msg.sender, uint40(block.timestamp));
    }

    /**
     * @notice Set the global default clawback window for new FIAT_INSTITUTIONAL envelopes.
     * @dev Only callable by admin.
     */
    function setDefaultClawbackWindow(uint40 windowSeconds) external {
        EnvelopeGuardLib.requireAdmin();
        EnvelopeStorage.layout().defaultClawbackWindow = windowSeconds;
    }

    /// @notice Set the global default dispute timeout for new disputes.
    function setDefaultDisputeTimeout(uint40 timeoutSeconds) external {
        EnvelopeGuardLib.requireAdmin();
        EnvelopeStorage.layout().defaultDisputeTimeout = timeoutSeconds;
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    /**
     * @notice Compute the reversible amount for a HALFLIFE_DECAY envelope.
     * @dev Linear decay from full amount at createdAt to 0 at commitWindowEnd.
     *      Returns 0 after commitWindowEnd.
     */
    function _computeHalflifeReversible(
        EnvelopeStorage.EnvelopeData storage env
    ) internal view returns (uint256) {
        uint40 now_ = uint40(block.timestamp);
        if (now_ >= env.commitWindowEnd) return 0;

        uint40 elapsed = now_ - env.createdAt;
        uint40 window  = env.commitWindowEnd - env.createdAt;

        uint256 total = env.amount - env.reversedAmount;
        return (total * uint256(window - elapsed)) / uint256(window);
    }

    /**
     * @notice Return the effective dispute timeout for a new dispute.
     */
    function _disputeTimeout(EnvelopeStorage.Layout storage l) internal view returns (uint40) {
        return l.defaultDisputeTimeout > 0 ? l.defaultDisputeTimeout : DEFAULT_DISPUTE_TIMEOUT;
    }
}
