// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { TransferManagementStorage } from "../lib/TransferManagementStorage.sol";

interface ITransferManagement {
    /// @notice Cancel an active pending transfer and return funds to originator
    /// @param transferId The pending transfer ID (bytes32)
    /// @param amount Amount to cancel (0 = full remaining amount)
    /// @param reverseFees Whether to request fee reversal (Phase 3 — recorded but not enforced)
    /// @param reasonCode Structured reason code (1-8)
    /// @param reasonHash Hash of off-chain detailed narrative/evidence
    /// @param reasonURI Ticket or evidence URI pointer
    /// @param reasonNotes Short human-readable note (max 512 bytes, not for PII)
    function cancelPendingTransfer(
        bytes32 transferId,
        uint256 amount,
        bool reverseFees,
        uint8 reasonCode,
        bytes32 reasonHash,
        string calldata reasonURI,
        string calldata reasonNotes
    ) external;

    /// @notice Get a specific cancellation record for a transfer
    /// @param transferId The pending transfer ID
    /// @param index Index in the cancellation history array
    function getCancellationRecord(
        bytes32 transferId,
        uint256 index
    ) external view returns (TransferManagementStorage.CancellationRecord memory);

    /// @notice Get the total number of cancellation operations for a transfer
    /// @param transferId The pending transfer ID
    function getCancellationCount(
        bytes32 transferId
    ) external view returns (uint256);

    /// @notice Get the full cancellation history for a transfer
    /// @param transferId The pending transfer ID
    function getCancellationHistory(
        bytes32 transferId
    ) external view returns (TransferManagementStorage.CancellationRecord[] memory);
}
