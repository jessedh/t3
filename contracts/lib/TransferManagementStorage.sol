// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library TransferManagementStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.transfermgmt.v1");

    // ═══════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════

    // Reason codes 1-8 are valid. 0 is invalid (NONE). 9+ reserved.
    // Use uint8 in function signatures; enum here is for documentation.

    // ═══════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════

    struct CancellationRecord {
        bytes32 transferId;
        address actualActor;       // _msgSender() — human/operator in meta-tx
        address txExecutor;        // msg.sender — EOA/forwarder/service account
        bytes32 actorRole;         // Role used for authorization
        uint8 reasonCode;          // 1-8 from taxonomy
        bytes32 reasonHash;        // Hash of off-chain detailed narrative
        bytes32 reasonNotesHash;   // keccak256(bytes(reasonNotes))
        string reasonURI;          // Ticket/evidence pointer
        uint256 amountCancelled;   // Amount returned to originator
        bool reverseFees;          // Whether fee reversal was requested
        uint256 timestamp;         // block.timestamp of cancellation
        bool isPartial;            // true if remaining amount > 0
    }

    // ═══════════════════════════════════════════════════════════════
    // STORAGE LAYOUT
    // ═══════════════════════════════════════════════════════════════

    struct Layout {
        // transferId => array of cancellation records (supports multiple partials)
        mapping(bytes32 => CancellationRecord[]) cancellationHistory;
        // transferId => total cancellation count
        mapping(bytes32 => uint256) cancellationCount;
    }

    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════

    event PendingTransferCancelled(
        bytes32 indexed transferId,
        address indexed originator,
        address indexed recipient,
        uint256 amountCancelled,
        uint256 remainingAmount,
        bool reverseFees,
        address actualActor,
        address txExecutor,
        bytes32 actorRole,
        uint8 reasonCode,
        bytes32 reasonHash,
        bytes32 reasonNotesHash,
        string reasonNotes,   // Full text in event for indexer capture
        bool isPartial,
        uint256 timestamp
    );

    // ═══════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════

    error TransferNotActive(bytes32 transferId);
    error UnauthorizedCancellation(address caller);
    error PartialCancellationNotAllowed(address caller);
    error InvalidReasonCode(uint8 code);
    error ReasonNotesExceedMaxLength(uint256 length, uint256 maxLength);
    error CancellationAmountExceedsRemaining(uint256 requested, uint256 available);
    error TransferAlreadyFullyCancelled(bytes32 transferId);
    error TransferExpired(bytes32 transferId);
    error InsufficientRecipientBalance(address recipient, uint256 balance, uint256 required);

    // ═══════════════════════════════════════════════════════════════
    // STORAGE ACCESS
    // ═══════════════════════════════════════════════════════════════

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            // slither-disable-next-line assembly
            l.slot := slot
        }
    }
}
