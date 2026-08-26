// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title IWalletRecovery
 * @notice Interface for the T3 wallet recovery redesign (FR-1402).
 */
interface IWalletRecovery {
    // =========================================================================
    // ENUMS
    // =========================================================================

    enum RecoveryState {
        None,
        RecoveryPending,
        RecoveryActive,
        RecoveryComplete,
        RecoveryCancelled
    }

    enum RecoveryType {
        LostKey,
        Compromised,
        BankExit,
        KeyRotation
    }

    enum EnvelopeRecoveryChoice {
        Finalize,
        Reverse,
        Clawback,
        ConfirmFiat,
        CarryDispute
    }

    // =========================================================================
    // STRUCTS
    // =========================================================================

    struct RecoveryPolicy {
        EnvelopeRecoveryChoice senderDefault;
        EnvelopeRecoveryChoice recipientDefault;
        EnvelopeRecoveryChoice disputedDefault;
        EnvelopeRecoveryChoice pendingFiatDefault;
    }

    // =========================================================================
    // CUSTOM ERRORS
    // =========================================================================

    error RecoveryNotFound(bytes32 recoveryId);
    error InvalidRecoveryState(bytes32 recoveryId, uint8 currentState, uint8 expectedState);
    error WalletInRecovery(address wallet);
    error RecoveryBlockedOnLegacyTransfers(address wallet);
    error RecoveryBlockedOnInterbankLiabilities(address wallet, address counterparty);
    error BatchTooLarge(uint256 provided, uint256 max);
    error StandbyWalletInvalid(address standby);
    error SuccessorNotCustodian(address successor);
    error CancelNotAllowed(bytes32 recoveryId, string reason);
    error ElectionWindowExpired(bytes32 recoveryId);
    error ElectionWindowNotExpired(bytes32 recoveryId);
    error InvalidEnvelopeRecoveryChoice(uint8 choice);
    error InvalidNoteAction(uint8 action);
    error CambioNoteNotInRecovery(bytes32 noteId, bytes32 recoveryId);
    error EnvelopeNotInRecovery(bytes32 envelopeId, bytes32 recoveryId);
    error TimelockActive(bytes32 recoveryId, uint40 timelockEndsAt);
    error RecoveryNotMigrated(bytes32 recoveryId);
    error CompletionStateNotZero(address oldWallet);
    error MigrationArrayLengthMismatch();
    error RecoveryBlockedBySanctions(address wallet);
    error SuccessorStateConflict(address successor, bytes32 tag);
    error SuccessorCipMissing(address successor);

    // =========================================================================
    // EVENTS
    // =========================================================================

    event RecoveryInitiated(
        bytes32 indexed recoveryId,
        address indexed oldWallet,
        uint8 recoveryType,
        uint40 initiatedAt
    );

    event RecoveryTimelockStarted(
        bytes32 indexed recoveryId,
        uint40 timelockEndsAt
    );

    event RecoverySuccessorDesignated(
        bytes32 indexed recoveryId,
        address indexed newWallet,
        address indexed designatedBy
    );

    event RecoverySuccessorRedirected(
        bytes32 indexed recoveryId,
        address indexed oldNewWallet,
        address indexed newNewWallet
    );

    event RecoveryElectionWindowExpired(
        bytes32 indexed recoveryId,
        uint40 electionWindowEndsAt,
        address indexed emittedBy
    );

    event RecoveryStandbySet(
        address indexed bankWallet,
        address indexed standbyWallet,
        address indexed setBy
    );

    event RecoveryEnvelopeResolved(
        bytes32 indexed recoveryId,
        bytes32 indexed envelopeId,
        uint8 choice,        // 0=finalized, 1=reversed, 2=clawback, 3=confirmed, 4=carried dispute
        uint256 amountMoved,
        bool replayed
    );

    event EnvelopeChoiceOverridden(
        bytes32 indexed recoveryId,
        bytes32 indexed envelopeId,
        uint8 choice
    );

    event RecoveryCambioNoteResolved(
        bytes32 indexed recoveryId,
        bytes32 indexed noteId,
        uint8 action,        // 0=transferred, 1=cancelled, 2=expired
        uint256 amountReturned,
        bool replayed
    );

    event NoteRedeemed(
        bytes32 indexed noteId,
        address indexed legacyIssuer,
        address indexed effectiveIssuer,
        address redeemer,
        uint256 amount
    );

    event RecoveryBalanceMigrated(
        bytes32 indexed recoveryId,
        address indexed oldWallet,
        address indexed newWallet,
        uint256 amount
    );

    event ConsortiumStateMigrated(
        bytes32 indexed recoveryId,
        address indexed oldWallet,
        address indexed newWallet
    );

    event InstitutionStateMigrated(
        bytes32 indexed recoveryId,
        address indexed oldWallet,
        address indexed newWallet
    );

    /// @notice Emitted when a manual migrate helper crosses the point of no return
    ///         (DP-5.0-B): the recovery can no longer be reversibly cancelled.
    /// @param family Which helper crossed it: "Consortium", "Institution", or "DepositorIdentity".
    event RecoveryStateMigrated(
        bytes32 indexed recoveryId,
        bytes32 family
    );

    event DepositorIdentityStateMigrated(
        bytes32 indexed recoveryId,
        address indexed oldWallet,
        address indexed newWallet,
        uint256 movedThisCall,
        uint256 remaining
    );

    event RecoveryComplete(
        bytes32 indexed recoveryId,
        address indexed oldWallet,
        address indexed newWallet,
        uint40 completedAt
    );

    event RecoveryCancelled(
        bytes32 indexed recoveryId,
        address indexed oldWallet,
        address indexed cancelledBy,
        bool irreversible
    );

    // =========================================================================
    // FUNCTIONS
    // =========================================================================

    function initiateRecovery(address wallet, uint8 recoveryType) external returns (bytes32 recoveryId);
    function designateSuccessor(bytes32 recoveryId, address newWallet) external;
    function redirectSuccessor(bytes32 recoveryId, address newWallet) external;
    function overrideEnvelopeChoice(bytes32 recoveryId, bytes32 envelopeId, uint8 choice) external;
    function applyBulkPolicy(bytes32 recoveryId, bytes32[] calldata envelopeIds) external;
    function resolveCambioNotesBulk(bytes32 recoveryId, bytes32[] calldata noteIds, uint8[] calldata actions) external;
    function migrateBalance(bytes32 recoveryId, address[] calldata liabilityCounterparties) external;
    function migrateConsortiumState(bytes32 recoveryId, uint256[] calldata assetTypes, address[] calldata tokens) external;
    function migrateInstitutionState(bytes32 recoveryId, bytes32[] calldata institutionIds, bytes32[] calldata scopes, bytes32[] calldata policyIds) external;
    function migrateDepositorIdentityState(bytes32 recoveryId, uint256 maxHashes) external;
    function completeRecovery(bytes32 recoveryId, address[] calldata predecessors) external;
    function cancelRecovery(bytes32 recoveryId) external;
    function setRecoveryStandby(address bankWallet, address standbyWallet) external;
    
    function getRecoveryStandby(address bankWallet) external view returns (address);
    function getRecovery(bytes32 recoveryId) external view returns (
        bytes32 id,
        address oldWallet,
        address newWallet,
        uint8 recoveryType,
        uint8 state,
        uint40 initiatedAt,
        uint40 electionWindowEndsAt,
        uint40 timelockEndsAt,
        uint256 envelopesResolved,
        uint256 cambioNotesResolved
    );
    function getRecoveryPolicy(bytes32 recoveryId) external view returns (RecoveryPolicy memory);
    function isEnvelopeResolved(bytes32 recoveryId, bytes32 envelopeId) external view returns (bool);
    function getEnvelopeOverride(bytes32 recoveryId, bytes32 envelopeId) external view returns (uint8 storedOverride);
    function isElectionWindowExpired(bytes32 recoveryId) external view returns (bool);
    function emitElectionWindowExpired(bytes32 recoveryId) external;
}
