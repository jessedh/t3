// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title ITransferEnvelope
 * @notice Interface for the T3 programmable transfer envelope system.
 * @dev Defines the Besu-native contract surface. All downstream FRs
 *      (FR-1001 lifecycle, FR-1002 expiration, FR-1003 settlement, FR-1004 dispute/oracle)
 *      build on this interface.
 *
 *      BESU VISIBILITY MODEL (ADR-004)
 *      ============================================================================
 *      All events emit plaintext amounts. The permissioned Besu consortium network
 *      provides the visibility boundary — only authenticated consortium members can
 *      read chain state. Cryptographic commitment-only events are not required.
 *      ============================================================================
 */
interface ITransferEnvelope {
    // ==================== ENUMS (for ABI documentation) ====================
    // Canonical definitions live in EnvelopeStorage.sol.
    // uint8 is used in function signatures for ABI compatibility.

    // ExpirationBehavior:
    //   0 = IMMEDIATE_FINALIZE   — auto-finalize at commitWindowEnd
    //   1 = HALFLIFE_DECAY       — reversibility decays over time (per-envelope)
    //   2 = HOLD_UNTIL_MANUAL    — escrow until explicit release (SmartLock)
    //   3 = ORACLE_CONDITIONAL   — depends on external oracle callback
    //   4 = AUTO_REVERSE         — auto-reverse at commitWindowEnd if not finalized
    //   5 = DISPUTE_HOLD         — frozen during active dispute

    // SettlementType:
    //   0 = CRYPTO_DIRECT        — direct on-chain settlement
    //   1 = FIAT_INSTITUTIONAL   — institutional off-chain fiat settlement

    // DisputeOutcome:
    //   0 = FINALIZE_TO_RECIPIENT
    //   1 = REVERSE_TO_SENDER
    //   2 = PARTIAL_SPLIT

    // EnvelopeState:
    //   0 = None
    //   1 = Created
    //   2 = Finalized
    //   3 = Reversed
    //   4 = Disputed
    //   5 = Expired
    //   6 = PendingFiatConfirmation  (FIAT_INSTITUTIONAL provisional — awaiting confirm or clawback)

    // ==================== ENVELOPE LIFECYCLE ====================

    /**
     * @notice Create a new transfer envelope with funds escrowed from msg.sender.
     * @dev The corrected create path carries all inputs required by FR-1001, FR-1002,
     *      FR-1003, and FR-1004. Gas optimization for the expanded signature is an
     *      explicit implementation concern, not a reason to omit required inputs.
     *
     *      For ORACLE_CONDITIONAL expirationBehavior, an oracle MUST be registered
     *      via registerOracle() before commitWindowEnd. conditionData carries
     *      auxiliary metadata (e.g. condition thresholds), NOT oracle binding info.
     *      For other behaviors, conditionData MAY be empty.
     *
     * @param recipient         Target address for fund release on finalization.
     * @param amount            Amount to escrow (plaintext per ADR-004).
     * @param commitWindowEnd   Timestamp after which expiration behavior activates.
     * @param settlementType    Settlement path (uint8-encoded SettlementType).
     * @param expirationBehavior What happens at time/condition boundary (uint8-encoded).
     * @param conditionData     ABI-encoded condition/oracle metadata (may be empty).
     * @return envelopeId       Unique identifier for the created envelope.
     */
    function createEnvelope(
        address recipient,
        uint256 amount,
        uint40 commitWindowEnd,
        uint8 settlementType,
        uint8 expirationBehavior,
        bytes calldata conditionData
    ) external returns (bytes32 envelopeId);

    /**
     * @notice Finalize an envelope, releasing escrowed funds to the recipient.
     * @dev Behavior depends on the envelope's expirationBehavior and current state.
     *      Cannot finalize if envelope is in Disputed state.
     * @param envelopeId The envelope to finalize.
     */
    function finalizeEnvelope(bytes32 envelopeId) external;

    /**
     * @notice Reverse an envelope, returning some or all escrowed funds to the sender.
     * @dev For HALFLIFE_DECAY, the reversible amount diminishes over time.
     *      Cannot reverse if envelope is in Disputed state.
     *      A reversal of the full remaining amount transitions to Reversed state.
     *      A partial reversal keeps the envelope in Created state with reduced escrow.
     * @param envelopeId The envelope to reverse.
     * @param amount     The amount to reverse (must not exceed remaining escrowed amount).
     */
    function reverseEnvelope(bytes32 envelopeId, uint256 amount) external;

    // ==================== DISPUTE SURFACE (FR-1004) ====================

    /**
     * @notice Raise a dispute on an envelope, freezing it in DISPUTE_HOLD.
     * @dev Only callable on envelopes in Created state. Transitions envelope to
     *      Disputed state. While disputed, finalization and reversal are blocked.
     * @param envelopeId The envelope to dispute.
     * @param reason     ABI-encoded dispute reason (hashed for on-chain event;
     *                   full reason delivered via off-chain compliance service).
     */
    function raiseDispute(bytes32 envelopeId, bytes calldata reason) external;

    /**
     * @notice Resolve a dispute, determining the outcome for escrowed funds.
     * @dev Only callable by authorized arbiter/admin on envelopes in Disputed state.
     *      For PARTIAL_SPLIT outcome, splitAmount specifies the recipient's share;
     *      the remainder returns to the sender. For other outcomes, splitAmount is
     *      ignored (pass 0).
     * @param envelopeId  The disputed envelope.
     * @param outcome     Resolution outcome (uint8-encoded DisputeOutcome).
     * @param splitAmount Recipient's share for PARTIAL_SPLIT (ignored otherwise).
     */
    function resolveDispute(bytes32 envelopeId, uint8 outcome, uint256 splitAmount) external;

    // ==================== ORACLE SURFACE (FR-1004) ====================

    /**
     * @notice Register an oracle for an ORACLE_CONDITIONAL envelope.
     * @dev Only callable by authorized roles. The oracle will be called back
     *      to determine finalization or reversal. Must be registered before
     *      commitWindowEnd for the callback to be valid.
     * @param envelopeId       The envelope to bind an oracle to.
     * @param oracleAddress    The oracle contract address.
     * @param callbackSelector The function selector for the oracle callback.
     */
    function registerOracle(
        bytes32 envelopeId,
        address oracleAddress,
        bytes4 callbackSelector
    ) external;

    // ==================== FIAT SETTLEMENT (FR-1003) ====================

    /**
     * @notice Confirm that fiat delivery occurred for a FIAT_INSTITUTIONAL envelope.
     * @dev Callable by admin/relayer after off-chain fiat wire confirmation.
     *      Burns tokens from escrow. Transitions to Finalized.
     * @param envelopeId The envelope to confirm.
     */
    function confirmFiatDelivery(bytes32 envelopeId) external;

    /**
     * @notice Claw back a FIAT_INSTITUTIONAL settlement within the clawback window.
     * @dev Callable by admin before clawbackDeadline (fiat delivery failed).
     *      Returns tokens from escrow to sender. Transitions to Reversed.
     * @param envelopeId The envelope to claw back.
     */
    function clawbackSettlement(bytes32 envelopeId) external;

    /**
     * @notice Set the global default clawback window for new FIAT_INSTITUTIONAL envelopes.
     * @dev Only callable by admin. Default fallback is 2 days if not set.
     * @param windowSeconds New clawback window duration in seconds.
     */
    function setDefaultClawbackWindow(uint40 windowSeconds) external;

    /**
     * @notice Set the global default dispute timeout for new disputes.
     * @dev Only callable by admin. Default fallback is 7 days if not set.
     * @param timeoutSeconds New dispute timeout duration in seconds. Pass 0 to reset to default.
     */
    function setDefaultDisputeTimeout(uint40 timeoutSeconds) external;

    // ==================== VIEW FUNCTIONS ====================

    /**
     * @notice Get the current state of an envelope.
     * @param envelopeId The envelope to query.
     * @return sender             Originator address.
     * @return recipient          Target address.
     * @return amount             Plaintext transfer amount.
     * @return commitWindowEnd    Commit window deadline.
     * @return settlementType     Settlement path.
     * @return expirationBehavior Expiration mode.
     * @return state              Current lifecycle state.
     * @return createdAt          Creation timestamp.
     * @return reversedAmount     Cumulative amount reversed (for partial reversal tracking).
     */
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
        );

    /**
     * @notice Get envelope IDs for a given sender.
     * @param sender The sender address to query.
     * @return envelopeIds Array of envelope IDs originated by the sender.
     */
    function getEnvelopesBySender(address sender)
        external
        view
        returns (bytes32[] memory envelopeIds);

    /**
     * @notice Get envelope IDs for a given recipient.
     * @param recipient The recipient address to query.
     * @return envelopeIds Array of envelope IDs targeting the recipient.
     */
    function getEnvelopesByRecipient(address recipient)
        external
        view
        returns (bytes32[] memory envelopeIds);

    /**
     * @notice Get dispute data for an envelope.
     * @param envelopeId The envelope to query.
     * @return raisedBy     Who raised the dispute.
     * @return raisedAt     When the dispute was raised.
     * @return timeoutAt    Deadline for resolution.
     * @return reasonHash   Hash of the dispute reason.
     * @return resolved     Whether the dispute is resolved.
     * @return outcome      Resolution outcome (valid only if resolved).
     */
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
        );

    /**
     * @notice Get oracle binding for an envelope.
     * @param envelopeId The envelope to query.
     * @return oracleAddress    Registered oracle contract.
     * @return callbackSelector Callback function selector.
     * @return callbackReceived Whether the oracle has responded.
     * @return callbackResult   Oracle result (valid only if callbackReceived).
     */
    function getOracleBinding(bytes32 envelopeId)
        external
        view
        returns (
            address oracleAddress,
            bytes4 callbackSelector,
            bool callbackReceived,
            bool callbackResult
        );

    // ==================== CROSS-INSTITUTION ROUTING ====================

    /**
     * @notice Set the receiving issuer for cross-institution claim attribution.
     * @dev Admin only. Must be called before finalization while envelope is in Created state.
     *      When set, finalization credits the recipient with the receiving issuer's claims
     *      (via finalizeEnvelopeClaims + substituteLiability) instead of preserving the
     *      original sender-side issuer composition. Pass address(0) for same-institution
     *      envelopes (original composition preserved). No-op when attribution is not initialized.
     * @param envelopeId       The envelope to configure.
     * @param receivingIssuer  The consortium bank that should receive the T3 attribution.
     */
    function setEnvelopeReceivingIssuer(bytes32 envelopeId, address receivingIssuer) external;
}
