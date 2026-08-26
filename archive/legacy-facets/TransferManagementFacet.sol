// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { TransferManagementStorage } from "../lib/TransferManagementStorage.sol";
import { ITransferManagement } from "../interfaces/ITransferManagement.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol";
import { T3CommonLib } from "../lib/T3CommonLib.sol";

contract TransferManagementFacet is ReentrancyGuardBase, ITransferManagement {
    using StorageLib for StorageLib.AppStorage;

    uint256 internal constant MAX_REASON_NOTES_LENGTH = 512;

    // ═══════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════

    modifier whenNotPaused() {
        if (StorageLib.diamondStorage()._paused) {
            revert("Pausable: paused");
        }
        _;
    }

    // ═══════════════════════════════════════════════════════════════
    // META-TRANSACTION SUPPORT
    // ═══════════════════════════════════════════════════════════════

    /// @dev ERC-2771 meta-transaction sender extraction.
    /// When called via trusted forwarder, extracts actual sender from
    /// the last 20 bytes of calldata.
    function _msgSender() internal view returns (address sender) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (
            ds.trustedForwarder != address(0) &&
            msg.sender == ds.trustedForwarder &&
            msg.data.length >= 20
        ) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // AUTHORIZATION
    // ═══════════════════════════════════════════════════════════════

    /// @dev Checks that msg.sender holds one of the 7 cancellation-authorized
    /// roles and returns the matched role hash for audit attribution.
    /// Reverts with UnauthorizedCancellation if no role matches.
    function _requireCancellationRole() internal view returns (bytes32 matchedRole) {
        IAccessControl ac = IAccessControl(address(this));

        if (ac.hasRole(RoleConstants.ADMIN_ROLE, msg.sender)) {
            return RoleConstants.ADMIN_ROLE;
        }
        if (ac.hasRole(RoleConstants.MINTER_ROLE, msg.sender)) {
            return RoleConstants.MINTER_ROLE;
        }
        if (ac.hasRole(RoleConstants.CUSTODIAN_ROLE, msg.sender)) {
            return RoleConstants.CUSTODIAN_ROLE;
        }
        if (ac.hasRole(RoleConstants.CAMBIO_ADMIN_ROLE, msg.sender)) {
            return RoleConstants.CAMBIO_ADMIN_ROLE;
        }
        if (ac.hasRole(RoleConstants.CAMBIO_ISSUER_ROLE, msg.sender)) {
            return RoleConstants.CAMBIO_ISSUER_ROLE;
        }
        if (ac.hasRole(RoleConstants.REVENUE_MANAGER_ROLE, msg.sender)) {
            return RoleConstants.REVENUE_MANAGER_ROLE;
        }
        if (ac.hasRole(RoleConstants.CONSORTIUM_MEMBER_ROLE, msg.sender)) {
            return RoleConstants.CONSORTIUM_MEMBER_ROLE;
        }

        revert TransferManagementStorage.UnauthorizedCancellation(msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════
    // VALIDATION
    // ═══════════════════════════════════════════════════════════════

    /// @dev Validates reasonCode is in the valid range 1-8.
    function _validateReasonCode(uint8 reasonCode) internal pure {
        if (reasonCode == 0 || reasonCode > 8) {
            revert TransferManagementStorage.InvalidReasonCode(reasonCode);
        }
    }

    /// @dev Validates reasonNotes does not exceed max length.
    function _validateReasonNotes(string calldata reasonNotes) internal pure {
        if (bytes(reasonNotes).length > MAX_REASON_NOTES_LENGTH) {
            revert TransferManagementStorage.ReasonNotesExceedMaxLength(
                bytes(reasonNotes).length,
                MAX_REASON_NOTES_LENGTH
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // INTERNAL TRANSFER
    // ═══════════════════════════════════════════════════════════════

    /// @dev Transfers tokens between addresses at the storage level.
    /// Follows the same pattern as T3TokenReversalExpiryFacet._internal_transfer.
    function _internal_transfer(
        StorageLib.AppStorage storage ds,
        address sender,
        address recipient,
        uint256 amount
    ) internal {
        if (sender == address(0)) {
            revert StorageLib.TransferToZeroAddress();
        }
        if (recipient == address(0)) {
            revert StorageLib.TransferToZeroAddress();
        }

        uint256 senderBalance = ds._balances[sender];
        if (senderBalance < amount) {
            revert TransferManagementStorage.InsufficientRecipientBalance(
                sender,
                senderBalance,
                amount
            );
        }

        ds._balances[sender] = senderBalance - amount;
        ds._balances[recipient] += amount;
    }

    // ═══════════════════════════════════════════════════════════════
    // CORE CANCELLATION
    // ═══════════════════════════════════════════════════════════════

    /// @inheritdoc ITransferManagement
    function cancelPendingTransfer(
        bytes32 transferId,
        uint256 amount,
        bool reverseFees,
        uint8 reasonCode,
        bytes32 reasonHash,
        string calldata reasonURI,
        string calldata reasonNotes
    ) external nonReentrant whenNotPaused {
        // 1. Authorization — get matched role for audit
        bytes32 actorRole = _requireCancellationRole();

        // 2. Validate reason metadata
        _validateReasonCode(reasonCode);
        _validateReasonNotes(reasonNotes);

        // 3. Load pending transfer from main AppStorage
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        StorageLib.PendingTransfer storage pt = ds.pendingTransfers[transferId];

        // 4. Validate transfer is active
        if (pt.originator == address(0)) {
            revert TransferManagementStorage.TransferNotActive(transferId);
        }
        if (pt.isReversed) {
            revert TransferManagementStorage.TransferAlreadyFullyCancelled(transferId);
        }
        if (pt.amount == 0) {
            revert TransferManagementStorage.TransferAlreadyFullyCancelled(transferId);
        }
        if (block.timestamp >= pt.unlockTime) {
            revert TransferManagementStorage.TransferExpired(transferId);
        }

        // 5. Determine cancellation amount
        uint256 amountToCancel = (amount == 0) ? pt.amount : amount;

        // 6. Validate amount
        if (amountToCancel > pt.amount) {
            revert TransferManagementStorage.CancellationAmountExceedsRemaining(
                amountToCancel,
                pt.amount
            );
        }

        // 7. Partial cancellation guard — only ADMIN_ROLE
        bool isPartial = (amountToCancel < pt.amount);
        if (isPartial) {
            IAccessControl ac = IAccessControl(address(this));
            if (!ac.hasRole(RoleConstants.ADMIN_ROLE, msg.sender)) {
                revert TransferManagementStorage.PartialCancellationNotAllowed(msg.sender);
            }
        }

        // 8. Balance check on recipient
        uint256 recipientBalance = ds._balances[pt.recipient];
        if (recipientBalance < amountToCancel) {
            revert TransferManagementStorage.InsufficientRecipientBalance(
                pt.recipient,
                recipientBalance,
                amountToCancel
            );
        }

        // 9. Update PendingTransfer state
        pt.totalReversed += amountToCancel;
        pt.reversalCount++;

        if (pt.firstReversalTime == 0) {
            pt.firstReversalTime = block.timestamp;
        }
        pt.lastReversalTime = block.timestamp;

        if (isPartial) {
            pt.amount -= amountToCancel;
        } else {
            pt.isReversed = true;
            pt.amount = 0;
        }

        // 10. Execute fund return: recipient -> originator
        _internal_transfer(ds, pt.recipient, pt.originator, amountToCancel);

        // 11. Actor attribution
        address actualActor = _msgSender();
        address txExecutor = msg.sender;

        // 12. Compute reasonNotesHash for on-chain record
        bytes32 reasonNotesHash = keccak256(bytes(reasonNotes));

        // 13. Record cancellation in TransferManagement storage
        TransferManagementStorage.Layout storage tms = TransferManagementStorage.layout();
        tms.cancellationHistory[transferId].push(
            TransferManagementStorage.CancellationRecord({
                transferId: transferId,
                actualActor: actualActor,
                txExecutor: txExecutor,
                actorRole: actorRole,
                reasonCode: reasonCode,
                reasonHash: reasonHash,
                reasonNotesHash: reasonNotesHash,
                reasonURI: reasonURI,
                amountCancelled: amountToCancel,
                reverseFees: reverseFees,
                timestamp: block.timestamp,
                isPartial: isPartial
            })
        );
        tms.cancellationCount[transferId]++;

        // 14. Emit event (includes full reasonNotes for indexer capture)
        emit TransferManagementStorage.PendingTransferCancelled(
            transferId,
            pt.originator,
            pt.recipient,
            amountToCancel,
            pt.amount,         // remaining after cancellation
            reverseFees,
            actualActor,
            txExecutor,
            actorRole,
            reasonCode,
            reasonHash,
            reasonNotesHash,
            reasonNotes,       // Full text in event log
            isPartial,
            block.timestamp
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /// @inheritdoc ITransferManagement
    function getCancellationRecord(
        bytes32 transferId,
        uint256 index
    ) external view returns (TransferManagementStorage.CancellationRecord memory) {
        TransferManagementStorage.Layout storage tms = TransferManagementStorage.layout();
        require(
            index < tms.cancellationHistory[transferId].length,
            "TransferMgmt: index out of bounds"
        );
        return tms.cancellationHistory[transferId][index];
    }

    /// @inheritdoc ITransferManagement
    function getCancellationCount(
        bytes32 transferId
    ) external view returns (uint256) {
        return TransferManagementStorage.layout().cancellationCount[transferId];
    }

    /// @inheritdoc ITransferManagement
    function getCancellationHistory(
        bytes32 transferId
    ) external view returns (TransferManagementStorage.CancellationRecord[] memory) {
        return TransferManagementStorage.layout().cancellationHistory[transferId];
    }
}
