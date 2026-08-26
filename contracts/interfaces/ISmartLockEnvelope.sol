// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title ISmartLockEnvelope
 * @notice Interface for the SmartLock Envelope Adapter (FR-1403).
 * @dev Maps the LockedTransferManagerFacet hash-commitment escrow flow into the
 *      envelope model using HOLD_UNTIL_MANUAL expiration behavior + CRYPTO_DIRECT
 *      settlement. Fragment-based security is preserved: release requires
 *      keccak256(fragment || nonce) == hashCommitment.
 */
interface ISmartLockEnvelope {

    // =========================================================================
    // EVENTS
    // =========================================================================

    /**
     * @notice Emitted when a SmartLock envelope is created.
     * @dev envelopeId is also indexed in EnvelopeStorage (EnvelopeCreated event).
     */
    event SmartLockEnvelopeCreated(
        bytes32 indexed envelopeId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        address releaseAuthorizedAddress
    );

    /**
     * @notice Emitted when a SmartLock envelope is released via fragment validation.
     */
    event SmartLockEnvelopeReleased(
        bytes32 indexed envelopeId,
        address indexed releasedBy
    );

    /**
     * @notice Emitted when a SmartLock envelope is cancelled.
     */
    event SmartLockEnvelopeCancelled(
        bytes32 indexed envelopeId,
        address indexed cancelledBy
    );

    // =========================================================================
    // MUTATING FUNCTIONS
    // =========================================================================

    /**
     * @notice Create a SmartLock envelope: escrow tokens and store hash-commitment conditions.
     * @dev Creates an EnvelopeData with HOLD_UNTIL_MANUAL + CRYPTO_DIRECT and stores
     *      the SmartLockCondition (hashCommitment, nonce, releaseAuthorizedAddress).
     *      Tokens are transferred from msg.sender to address(this) (diamond escrow).
     * @param recipient               Intended recipient of the escrowed tokens.
     * @param amount                  Amount to escrow (plaintext, per ADR-004).
     * @param hashCommitment          keccak256(fragment || nonce) — commitment to the secret fragment.
     * @param nonce                   Anchor stored on-chain; paired with fragment at release.
     * @param commitWindowEnd         Deadline timestamp for the commit window.
     * @param releaseAuthorizedAddress Address authorized to release; must hold CUSTODIAN_ROLE when used.
     *                                 Zero address means only fragment-based release is available.
     * @return envelopeId             The unique identifier for the created envelope.
     */
    function createSmartLockEnvelope(
        address recipient,
        uint256 amount,
        bytes32 hashCommitment,
        bytes32 nonce,
        uint40 commitWindowEnd,
        address releaseAuthorizedAddress
    ) external returns (bytes32 envelopeId);

    /**
     * @notice Release a SmartLock envelope by revealing the secret fragment.
     * @dev Validates keccak256(fragment || nonce) == hashCommitment.
     *      If caller is the releaseAuthorizedAddress, CUSTODIAN_ROLE is required.
     *      Any other caller with the valid fragment may release without a role check.
     *      On success: state → ES_FINALIZED, escrow released to recipient.
     * @param envelopeId The SmartLock envelope to release.
     * @param fragment   The secret fragment that, combined with the stored nonce, satisfies the commitment.
     */
    function releaseSmartLockEnvelope(bytes32 envelopeId, bytes32 fragment) external;

    /**
     * @notice Cancel a SmartLock envelope and return escrowed tokens to sender.
     * @dev Only callable by the original sender or an admin.
     *      On success: state → ES_REVERSED, escrow returned to sender.
     * @param envelopeId The SmartLock envelope to cancel.
     */
    function cancelSmartLockEnvelope(bytes32 envelopeId) external;

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    /**
     * @notice Return the stored SmartLock conditions for an envelope.
     * @param envelopeId              The envelope to query.
     * @return hashCommitment         Stored hash commitment.
     * @return nonce                  Stored nonce anchor.
     * @return releaseAuthorizedAddress Address authorized to release (0x0 if none set).
     */
    function getSmartLockCondition(bytes32 envelopeId)
        external
        view
        returns (
            bytes32 hashCommitment,
            bytes32 nonce,
            address releaseAuthorizedAddress
        );
}
