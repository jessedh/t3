// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title EnvelopeStorage
 * @notice Dedicated storage library for the T3 transfer envelope system.
 * @dev Isolated from legacy StorageLib.AppStorage via diamond storage pattern.
 *      Storage slot: keccak256("t3.storage.envelope.v1")
 *
 *      Each envelope represents a programmable transfer with:
 *      - per-envelope lifecycle state (not per-sender or per-recipient),
 *      - configurable expiration behavior (6 modes from FR-1002),
 *      - optional dispute/oracle surface (FR-1004).
 *
 *      BESU CONSORTIUM VISIBILITY MODEL (ADR-004)
 *      ==========================================
 *      This contract is deployed on a permissioned Hyperledger Besu consortium
 *      network operated by T3. All amounts are stored and emitted as plaintext.
 *      Visibility is enforced by operator-controlled infrastructure and
 *      authenticated API gating — not cryptographic isolation.
 *      See ADR-004 for the full visibility and governance model.
 *
 *      COEXISTENCE WITH LEGACY TRANSFERS
 *      ==================================
 *      The existing transfer system (StorageLib.AppStorage + TransferManagementFacet)
 *      continues to operate independently during rollout. Envelope transfers are a
 *      parallel path; there is no cross-system dependency. A migration strategy from
 *      legacy pending transfers to envelope-based transfers will be defined in a
 *      separate FR once envelope lifecycle (FR-1001) is stable.
 */
library EnvelopeStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.envelope.v1");

    // =========================================================================
    // ENUMS
    // =========================================================================

    /**
     * @notice Lifecycle state of an envelope.
     */
    enum EnvelopeState {
        None,                    // 0 - Default / non-existent
        Created,                 // 1 - Envelope created, funds escrowed
        Finalized,               // 2 - Funds released to recipient (or burned for fiat)
        Reversed,                // 3 - Funds returned to sender (full or partial)
        Disputed,                // 4 - Dispute active; finalization and reversal blocked
        Expired,                 // 5 - Envelope expired per its expiration behavior
        PendingFiatConfirmation  // 6 - FIAT_INSTITUTIONAL provisional: awaiting confirmFiatDelivery or clawback
    }

    /**
     * @notice Settlement type for the envelope.
     */
    enum SettlementType {
        CRYPTO_DIRECT,       // 0 - Direct on-chain settlement
        FIAT_INSTITUTIONAL   // 1 - Institutional / off-chain fiat settlement
    }

    /**
     * @notice Expiration behavior governing what happens when the envelope reaches
     *         a time or condition boundary. See FR-1002 for authoritative specification.
     */
    enum ExpirationBehavior {
        IMMEDIATE_FINALIZE,  // 0 - Auto-finalize at commitWindowEnd
        HALFLIFE_DECAY,      // 1 - Reversibility decays over time (per-envelope, not per-recipient)
        HOLD_UNTIL_MANUAL,   // 2 - Escrow until explicit release (SmartLock adapter)
        ORACLE_CONDITIONAL,  // 3 - Depends on external oracle callback
        AUTO_REVERSE,        // 4 - Auto-reverse at commitWindowEnd if not finalized
        DISPUTE_HOLD         // 5 - Frozen during active dispute
    }

    /**
     * @notice Outcome of a dispute resolution.
     */
    enum DisputeOutcome {
        FINALIZE_TO_RECIPIENT, // 0 - Funds released to recipient
        REVERSE_TO_SENDER,     // 1 - Funds returned to sender
        PARTIAL_SPLIT          // 2 - Funds split between sender and recipient
    }

    // =========================================================================
    // STRUCTS
    // =========================================================================

    /**
     * @notice Core per-envelope state.
     * @dev All lifecycle operations key on envelopeId. No per-(sender, recipient) keying
     *      to avoid the TC-INT-003 overwrite bug from legacy HalfLife tracking.
     */
    struct EnvelopeData {
        bytes32 id;                   // Unique envelope identifier
        address sender;               // Originator of the transfer
        address recipient;            // Intended recipient
        uint256 amount;               // Plaintext transfer amount (see ADR-004 visibility model)
        uint40 commitWindowEnd;       // Deadline timestamp for commit window
        uint8 settlementType;         // SettlementType enum value (uint8 for ABI compat)
        uint8 expirationBehavior;     // ExpirationBehavior enum value (uint8 for ABI compat)
        uint8 state;                  // EnvelopeState enum value (uint8 for ABI compat)
        uint40 createdAt;             // Block timestamp at creation
        uint256 reversedAmount;       // Amount reversed (for partial reversal tracking)
        bytes32 conditionDataHash;    // Hash of condition/oracle metadata (full data off-chain)
        uint40 clawbackDeadline;      // FIAT_INSTITUTIONAL: deadline for clawback (0 for CRYPTO_DIRECT)
        address receivingIssuer;      // Cross-institution: bank credited with T3 attribution on finalization. Zero = same-institution.
    }

    /**
     * @notice Dispute metadata for an envelope under DISPUTE_HOLD.
     */
    struct DisputeData {
        address raisedBy;             // Who raised the dispute
        uint40 raisedAt;              // When the dispute was raised
        uint40 timeoutAt;             // Deadline for resolution before default outcome
        uint8 defaultOutcome;         // DisputeOutcome to apply on timeout
        bytes32 reasonHash;           // Hash of dispute reason (details off-chain)
        address resolver;             // Who resolved the dispute (zero if unresolved)
        uint40 resolvedAt;            // When the dispute was resolved (0 if unresolved)
        uint8 outcome;                // DisputeOutcome applied (valid only after resolution)
        uint256 splitAmount;          // Recipient portion in PARTIAL_SPLIT outcome
    }

    /**
     * @notice Oracle registration for ORACLE_CONDITIONAL envelopes.
     */
    struct OracleBinding {
        address oracleAddress;        // Registered oracle contract
        bytes4 callbackSelector;      // Function selector for callback
        bool callbackReceived;        // Whether the oracle has responded
        bool callbackResult;          // true = finalize, false = reverse
    }

    // =========================================================================
    // LAYOUT
    // =========================================================================

    /**
     * @notice Main storage layout for the envelope system.
     */
    struct Layout {
        // --- Per-envelope data ---
        mapping(bytes32 => EnvelopeData) envelopes;
        mapping(bytes32 => DisputeData) disputes;
        mapping(bytes32 => OracleBinding) oracleBindings;

        // --- Indexing mappings ---
        mapping(address => bytes32[]) senderEnvelopeIds;
        mapping(address => bytes32[]) recipientEnvelopeIds;

        // --- Nonce for deterministic envelope ID generation ---
        uint256 envelopeNonce;

        // --- Global configuration ---
        uint40 defaultDisputeTimeout;  // Default timeout for dispute resolution
        uint40 defaultClawbackWindow;  // FIAT_INSTITUTIONAL: default clawback window (0 = use 2-day fallback)
    }

    // =========================================================================
    // CUSTOM ERRORS
    // =========================================================================

    error EnvelopeAlreadyExists(bytes32 envelopeId);
    error EnvelopeNotFound(bytes32 envelopeId);
    error EnvelopeNotInState(bytes32 envelopeId, uint8 currentState, uint8 requiredState);
    error EnvelopeExpired(bytes32 envelopeId);
    error EnvelopeNotExpired(bytes32 envelopeId);

    error InvalidRecipient();
    error InvalidAmount();
    error InvalidCommitWindowEnd();
    error InvalidExpirationBehavior(uint8 provided);
    error InvalidSettlementType(uint8 provided);

    error DisputeAlreadyActive(bytes32 envelopeId);
    error DisputeNotActive(bytes32 envelopeId);
    error DisputeTimedOut(bytes32 envelopeId);
    error InvalidDisputeOutcome(uint8 provided);

    error OracleAlreadyRegistered(bytes32 envelopeId);
    error OracleNotRegistered(bytes32 envelopeId);
    error OracleCallbackAlreadyReceived(bytes32 envelopeId);
    error OracleCallbackUnauthorized(bytes32 envelopeId, address caller);
    error OracleRequiredForBehavior(bytes32 envelopeId);

    error ReversalExceedsRemaining(bytes32 envelopeId, uint256 requested, uint256 remaining);
    error ReversalNotPermitted(bytes32 envelopeId);

    error ConditionDataRequired();

    error ClawbackWindowExpired(bytes32 envelopeId);
    error ClawbackWindowActive(bytes32 envelopeId);

    // =========================================================================
    // EVENTS
    // =========================================================================

    /**
     * @notice Emitted when a new envelope is created.
     * @dev Emits plaintext amount per ADR-004 Besu consortium visibility model.
     */
    event EnvelopeCreated(
        bytes32 indexed envelopeId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint40 commitWindowEnd,
        uint8 settlementType,
        uint8 expirationBehavior
    );

    /**
     * @notice Emitted when an envelope is finalized (funds released to recipient).
     */
    event EnvelopeFinalized(
        bytes32 indexed envelopeId,
        uint40 finalizedAt
    );

    /**
     * @notice Emitted when an envelope is fully or partially reversed.
     * @dev Emits plaintext reversed amount per ADR-004 Besu consortium visibility model.
     */
    event EnvelopeReversed(
        bytes32 indexed envelopeId,
        uint256 reversedAmount,
        uint40 reversedAt
    );

    /**
     * @notice Emitted when a dispute is raised on an envelope.
     */
    event DisputeRaised(
        bytes32 indexed envelopeId,
        address indexed raisedBy,
        bytes32 reasonHash,
        uint40 timeoutAt
    );

    /**
     * @notice Emitted when a dispute is resolved.
     */
    event DisputeResolved(
        bytes32 indexed envelopeId,
        address indexed resolver,
        uint8 outcome,
        uint40 resolvedAt
    );

    /**
     * @notice Emitted when an oracle is registered for an ORACLE_CONDITIONAL envelope.
     */
    event OracleRegistered(
        bytes32 indexed envelopeId,
        address indexed oracleAddress,
        bytes4 callbackSelector
    );

    /**
     * @notice Emitted when a FIAT_INSTITUTIONAL envelope enters provisional settlement.
     * @dev Ponder indexer watches this to trigger the off-chain fiat wire.
     *      Tokens remain in the diamond's escrow until confirmFiatDelivery or clawbackSettlement.
     */
    event FiatSettlementTriggered(
        bytes32 indexed envelopeId,
        uint256 amount,
        uint40 clawbackDeadline
    );

    /**
     * @notice Emitted when a FIAT_INSTITUTIONAL settlement is confirmed.
     * @dev Tokens are burned from escrow. Total supply decreases.
     */
    event FiatDeliveryConfirmed(
        bytes32 indexed envelopeId,
        uint40 confirmedAt
    );

    /**
     * @notice Emitted when a FIAT_INSTITUTIONAL settlement is clawed back.
     * @dev Tokens returned from escrow to sender. Settlement reversed.
     */
    event FiatSettlementClawedBack(
        bytes32 indexed envelopeId,
        uint256 amount,
        uint40 clawedBackAt
    );

    /**
     * @notice Emitted when an oracle callback is received.
     */
    event OracleCallbackReceived(
        bytes32 indexed envelopeId,
        address indexed oracleAddress,
        bool result
    );

    /**
     * @notice Emitted when the receiving issuer is set for cross-institution routing.
     * @dev Required for off-chain compliance audit trail per banking regulations.
     *      Indexed on envelopeId and receivingIssuer to allow fast lookups by either.
     */
    event ReceivingIssuerSet(
        bytes32 indexed envelopeId,
        address indexed receivingIssuer,
        address indexed setBy,
        uint40 timestamp
    );

    // =========================================================================
    // STORAGE ACCESS
    // =========================================================================

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }
}
