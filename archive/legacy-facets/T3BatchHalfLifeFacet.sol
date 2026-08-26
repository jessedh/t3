// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { ERC20PausableFacet } from "./ERC20PausableFacet.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { T3CommonLib } from "../lib/T3CommonLib.sol";

/**
 * @title T3BatchHalfLifeFacet
 * @notice Batch HalfLife processing for gas efficiency improvements
 * @dev Allows multiple HalfLife operations (expirations, reversals) to be processed
 * in a single transaction, significantly reducing gas costs for custodians
 * managing large volumes of transactions in the T3Token system
 */
contract T3BatchHalfLifeFacet is ERC20PausableFacet {
    using StorageLib for StorageLib.AppStorage;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Events for batch operations
    event BatchHalfLifeExpired(
        address[] indexed recipients,
        uint256 totalProcessed,
        uint256 totalGasSaved
    );
    
    event BatchHalfLifeReversed(
        address[] indexed recipients,
        uint256 totalProcessed,
        uint256 totalAmount
    );
    
    event BatchOperationCompleted(
        string indexed operationType,
        uint256 successfulOperations,
        uint256 failedOperations,
        uint256 gasUsed
    );
    
    event HalfLifeExpiredSingle(
        address indexed recipient,
        address indexed originator,
        uint256 amount,
        bytes32 reversalHash
    );
    
    event HalfLifeReversedSingle(
        address indexed recipient,
        address indexed originator,
        uint256 amount,
        bytes32 reversalHash
    );

    /**
     * @notice Batch processes expired HalfLife windows for multiple recipients
     * @param recipients Array of recipient addresses to check for expired HalfLife
     * @param maxGasPerOperation Maximum gas to use per operation (prevents gas limit issues)
     * @return results Array indicating success/failure for each recipient
     * @return totalProcessed Number of successfully processed recipients
     */
    /**
     * @notice Batch processes expired HalfLife windows for multiple recipients
     * @param recipients Array of recipient addresses to check for expired HalfLife
     * @param maxGasPerOperation Maximum gas to use per operation (prevents gas limit issues)
     * @return results Array indicating success/failure for each recipient
     * @return totalProcessed Number of successfully processed recipients
     */
    function batchCheckHalfLifeExpiry(
        address[] calldata recipients,
        uint256 maxGasPerOperation
    ) external returns (bool[] memory results, uint256 totalProcessed) {
        _checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        // StorageLib.AppStorage storage ds = StorageLib.diamondStorage(); // Unused
        
        require(recipients.length > 0, "BatchHalfLife: Empty recipients array");
        require(recipients.length <= 100, "BatchHalfLife: Too many recipients"); // Gas limit protection
        require(maxGasPerOperation > 0, "BatchHalfLife: Invalid gas limit");
        
        results = new bool[](recipients.length);
        totalProcessed = 0;
        uint256 initialGas = gasleft();
        
        for (uint256 i = 0; i < recipients.length; i++) {
            uint256 gasBeforeOperation = gasleft();
            
            // Check if we have enough gas for this operation
            if (gasBeforeOperation < maxGasPerOperation + 10000) { // 10k buffer
                break; // Stop processing to avoid out-of-gas
            }
            
            try this._processSingleHalfLifeExpiry(recipients[i]) {
                results[i] = true;
                totalProcessed++;
            } catch {
                results[i] = false;
                // Continue with next recipient
            }
            
            // Check if operation used too much gas
            uint256 gasUsed = gasBeforeOperation - gasleft();
            if (gasUsed > maxGasPerOperation) {
                // Log warning but continue
                emit BatchOperationCompleted("EXPIRY_GAS_EXCEEDED", i + 1, 0, gasUsed);
            }
        }
        
        uint256 totalGasUsed = initialGas - gasleft();
        uint256 estimatedGasSaved = _calculateGasSavings(totalProcessed, totalGasUsed);
        
        emit BatchHalfLifeExpired(recipients, totalProcessed, estimatedGasSaved);
        emit BatchOperationCompleted("EXPIRY", totalProcessed, recipients.length - totalProcessed, totalGasUsed);
    }

    /**
     * @notice Batch processes HalfLife reversals for multiple transfers
     * @param transferIds Array of transfer IDs to reverse
     * @param maxGasPerOperation Maximum gas to use per operation
     * @return results Array indicating success/failure for each transfer
     * @return totalProcessed Number of successfully processed transfers
     * @return totalAmount Total amount reversed across all transfers
     */
    function batchReverseHalfLife(
        bytes32[] calldata transferIds,
        uint256 maxGasPerOperation
    ) external returns (bool[] memory results, uint256 totalProcessed, uint256 totalAmount) {
        _checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        // StorageLib.AppStorage storage ds = StorageLib.diamondStorage(); // Unused
        
        require(transferIds.length > 0, "BatchHalfLife: Empty transferIds array");
        require(transferIds.length <= 50, "BatchHalfLife: Too many transfers for reversal"); // Lower limit for reversals
        require(maxGasPerOperation > 0, "BatchHalfLife: Invalid gas limit");
        
        results = new bool[](transferIds.length);
        totalProcessed = 0;
        totalAmount = 0;
        uint256 initialGas = gasleft();
        
        // We need a dummy address array for the event to match signature if we want to keep event same.
        // But the event takes address[] recipients. We have IDs.
        // We can't easily emit BatchHalfLifeReversed with addresses without looking them up.
        // For now, we will emit the event with empty addresses or update the event.
        // Updating event is breaking. Let's look up addresses as we go.
        address[] memory recipients = new address[](transferIds.length);

        for (uint256 i = 0; i < transferIds.length; i++) {
            uint256 gasBeforeOperation = gasleft();
            
            // Check if we have enough gas for this operation
            if (gasBeforeOperation < maxGasPerOperation + 15000) { // 15k buffer for reversals
                break;
            }
            
            try this._processSingleHalfLifeReversal(transferIds[i]) returns (uint256 reversedAmount, address recipient) {
                results[i] = true;
                totalProcessed++;
                totalAmount += reversedAmount;
                recipients[i] = recipient;
            } catch {
                results[i] = false;
                // Continue with next
            }
        }
        
        uint256 totalGasUsed = initialGas - gasleft();
        
        emit BatchHalfLifeReversed(recipients, totalProcessed, totalAmount);
        emit BatchOperationCompleted("REVERSAL", totalProcessed, transferIds.length - totalProcessed, totalGasUsed);
    }

    /**
     * @notice Batch processes mixed HalfLife operations (expiry and reversal) based on eligibility
     * @dev DISABLED in Ledger-Based Locking due to signature mismatch (Reversals need IDs, Expiry needs Addresses)
     */
    function batchProcessMixedHalfLife(
        address[] calldata recipients,
        uint8[] calldata operations,
        uint256 maxGasPerOperation
    ) external returns (bool[] memory results, uint256 totalProcessed) {
        revert("BatchMixed: Not supported in Ledger-Based Locking");
    }

    /**
     * @notice Gets addresses eligible for HalfLife expiry processing
     * @param maxResults Maximum number of results to return
     * @return eligibleAddresses Array of addresses with expired HalfLife windows
     */
    function getEligibleForExpiry(uint256 maxResults) external view returns (address[] memory eligibleAddresses) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // This is a simplified implementation - production would need indexing
        address[] memory candidates = new address[](maxResults);
        uint256 count = 0;
        
        // In production, you'd maintain an index of active HalfLife windows
        // For now, this is a placeholder that demonstrates the concept
        
        return _resizeArray(candidates, count);
    }

    /**
     * @notice Gets addresses eligible for HalfLife reversal processing  
     * @param maxResults Maximum number of results to return
     * @return eligibleAddresses Array of addresses with reversible HalfLife windows
     */
    function getEligibleForReversal(uint256 maxResults) external view returns (address[] memory eligibleAddresses) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // This is a simplified implementation - production would need indexing
        address[] memory candidates = new address[](maxResults);
        uint256 count = 0;
        
        // In production, you'd maintain an index of active HalfLife windows
        // For now, this is a placeholder that demonstrates the concept
        
        return _resizeArray(candidates, count);
    }

    /**
     * @notice Estimates gas costs for batch operations
     * @param recipientCount Number of recipients to process
     * @param operationType Type of operation: 0=expiry, 1=reversal, 2=mixed
     * @return estimatedGas Estimated gas cost for the batch operation
     * @return recommendedBatchSize Recommended batch size for single transaction
     */
    function estimateBatchGasCosts(
        uint256 recipientCount,
        uint8 operationType
    ) external pure returns (uint256 estimatedGas, uint256 recommendedBatchSize) {
        uint256 baseGas = 50000; // Base transaction cost
        uint256 perOperationGas;
        
        if (operationType == 0) { // Expiry
            perOperationGas = 25000;
            recommendedBatchSize = 100;
        } else if (operationType == 1) { // Reversal
            perOperationGas = 45000;
            recommendedBatchSize = 50;
        } else { // Mixed
            perOperationGas = 35000;
            recommendedBatchSize = 75;
        }
        
        estimatedGas = baseGas + (recipientCount * perOperationGas);
        
        // Adjust recommended batch size based on gas limit (assuming 30M gas limit)
        uint256 maxOperations = (30000000 - baseGas) / perOperationGas;
        if (recommendedBatchSize > maxOperations) {
            recommendedBatchSize = maxOperations;
        }
    }

    // External functions for individual processing (called by batch functions)
    function _processSingleHalfLifeExpiry(address recipient) external returns (bool) {
        require(msg.sender == address(this), "BatchHalfLife: Internal function");
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Iterate and clean up expired locks
        bytes32[] storage ids = ds.pendingTransferIds[recipient];
        uint256 length = ids.length;
        bool anyExpired = false;

        for (uint256 i = length; i > 0; i--) {
            uint256 index = i - 1;
            bytes32 id = ids[index];
            StorageLib.PendingTransfer storage pt = ds.pendingTransfers[id];

            if (block.timestamp >= pt.unlockTime && !pt.isReversed) {
                // Expired
                emit HalfLifeExpiredSingle(
                    recipient,
                    pt.originator,
                    pt.amount,
                    pt.reversalHash
                );
                T3CommonLib.removePendingTransfer(ds, recipient, index);
                anyExpired = true;
            } else if (pt.isReversed) {
                // Clean up reversed
                T3CommonLib.removePendingTransfer(ds, recipient, index);
            }
        }
        
        if (!anyExpired) {
             revert StorageLib.HalfLifeNotExpiredYet();
        }
        return true;
    }

    function _processSingleHalfLifeReversal(bytes32 transferId) external returns (uint256 reversedAmount, address recipient) {
        require(msg.sender == address(this), "BatchHalfLife: Internal function");
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        StorageLib.PendingTransfer storage pt = ds.pendingTransfers[transferId];
        
        if (pt.originator == address(0)) { revert StorageLib.NoActiveTransferData(); }
        if (pt.isReversed) { revert StorageLib.TransferAlreadyReversed(); }
        if (block.timestamp >= pt.unlockTime) { revert StorageLib.HalfLifeExpired(); }
        
        reversedAmount = pt.amount;
        recipient = pt.recipient;
        address originator = pt.originator;
        
        // Perform the reversal transfer
        if (reversedAmount > 0) {
            _internal_transfer(ds, recipient, originator, reversedAmount);
        }
        
        // Mark as reversed
        pt.isReversed = true;
        
        emit HalfLifeReversedSingle(
            recipient,
            originator,
            reversedAmount,
            pt.reversalHash
        );
        
        return (reversedAmount, recipient);
    }



    // Internal helper functions
    function _internal_transfer(StorageLib.AppStorage storage ds, address sender, address recipient, uint256 amount) internal {
        require(sender != address(0), "BatchHalfLife: Transfer from zero address");
        require(recipient != address(0), "BatchHalfLife: Transfer to zero address");
        
        uint256 senderBalance = ds._balances[sender];
        require(senderBalance >= amount, "BatchHalfLife: Insufficient balance");
        
        ds._balances[sender] = senderBalance - amount;
        ds._balances[recipient] += amount;
        
        emit ERC20BaseFacet.Transfer(sender, recipient, amount);
    }

    function _calculateGasSavings(uint256 operationsProcessed, uint256 actualGasUsed) internal pure returns (uint256) {
        if (operationsProcessed == 0) return 0;
        
        // Estimate individual transaction costs
        uint256 individualTxCost = 21000; // Base transaction cost
        uint256 operationCost = 30000; // Estimated cost per operation
        uint256 estimatedIndividualTotal = operationsProcessed * (individualTxCost + operationCost);
        
        // Calculate savings
        if (estimatedIndividualTotal > actualGasUsed) {
            return estimatedIndividualTotal - actualGasUsed;
        }
        
        return 0;
    }

    function _resizeArray(address[] memory array, uint256 newSize) internal pure returns (address[] memory) {
        address[] memory resized = new address[](newSize);
        for (uint256 i = 0; i < newSize && i < array.length; i++) {
            resized[i] = array[i];
        }
        return resized;
    }

    // View functions for monitoring batch operations
    function getBatchProcessingLimits() external pure returns (
        uint256 maxExpiryBatch,
        uint256 maxReversalBatch,
        uint256 maxMixedBatch
    ) {
        maxExpiryBatch = 100;
        maxReversalBatch = 50;
        maxMixedBatch = 75;
    }

    function getOptimalBatchSize(uint8 operationType, uint256 availableGas) external pure returns (uint256 optimalSize) {
        uint256 baseGas = 50000;
        uint256 perOperationGas;
        
        if (operationType == 0) { // Expiry
            perOperationGas = 25000;
        } else if (operationType == 1) { // Reversal
            perOperationGas = 45000;
        } else { // Mixed
            perOperationGas = 35000;
        }
        
        if (availableGas <= baseGas) {
            return 0;
        }
        
        optimalSize = (availableGas - baseGas) / perOperationGas;
        
        // Cap at maximum safe batch sizes
        uint256 maxSafe = operationType == 0 ? 100 : (operationType == 1 ? 50 : 75);
        if (optimalSize > maxSafe) {
            optimalSize = maxSafe;
        }
    }
}