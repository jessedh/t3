// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { ERC20PausableFacet } from "./ERC20PausableFacet.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { T3CommonLib } from "../lib/T3CommonLib.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title T3MultiSigSettlementFacet
 * @notice Multi-signature settlement approval for large interbank settlements
 * @dev Implements threshold-based approvals for high-value transactions between custodians
 * to enhance security and regulatory compliance in the T3Token system
 */
contract T3MultiSigSettlementFacet is ERC20PausableFacet {
    using StorageLib for StorageLib.AppStorage;
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // Events for multi-signature operations
    event SettlementProposed(
        bytes32 indexed settlementId,
        address indexed fromCustodian,
        address indexed toCustodian,
        uint256 amount,
        address proposer
    );
    
    event SettlementApproved(
        bytes32 indexed settlementId,
        address indexed approver,
        uint256 currentApprovals,
        uint256 requiredApprovals
    );
    
    event SettlementExecuted(
        bytes32 indexed settlementId,
        address indexed fromCustodian,
        address indexed toCustodian,
        uint256 amount
    );
    
    event SettlementCancelled(
        bytes32 indexed settlementId,
        address indexed canceller,
        string reason
    );
    
    event ApprovalThresholdUpdated(
        uint256 oldThreshold,
        uint256 newThreshold
    );
    
    event LargeSettlementThresholdUpdated(
        uint256 oldThreshold,
        uint256 newThreshold
    );

    /**
     * @notice Proposes a large settlement that requires multi-signature approval
     * @param fromCustodian The custodian address sending funds
     * @param toCustodian The custodian address receiving funds
     * @param amount The settlement amount in wei
     * @param description Description of the settlement purpose
     * @return settlementId Unique identifier for the proposed settlement
     */
    function proposeSettlement(
        address fromCustodian,
        address toCustodian,
        uint256 amount,
        string calldata description
    ) external returns (bytes32 settlementId) {
        AccessControlLib.checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        require(fromCustodian != toCustodian, "MultiSig: Cannot settle with self");
        require(amount > 0, "MultiSig: Amount must be positive");
        require(amount >= ds.largeSettlementThreshold, "MultiSig: Amount below threshold");
        
        // Verify both parties are custodians
        require(ds._roles[RoleConstants.CUSTODIAN_ROLE].contains(fromCustodian), "MultiSig: Invalid from custodian");
        require(ds._roles[RoleConstants.CUSTODIAN_ROLE].contains(toCustodian), "MultiSig: Invalid to custodian");
        
        // Check if fromCustodian has sufficient balance for settlement
        require(ds._balances[fromCustodian] >= amount, "MultiSig: Insufficient balance");
        
        settlementId = keccak256(abi.encodePacked(
            fromCustodian,
            toCustodian,
            amount,
            description,
            block.timestamp,
            block.chainid
        ));
        
        require(ds.pendingSettlements[settlementId].proposer == address(0), "MultiSig: Settlement already exists");
        
        // Create the settlement proposal
        ds.pendingSettlements[settlementId] = StorageLib.PendingSettlement({
            fromCustodian: fromCustodian,
            toCustodian: toCustodian,
            amount: amount,
            description: description,
            proposer: msg.sender,
            proposedAt: block.timestamp,
            executedAt: 0,
            isExecuted: false,
            isCancelled: false,
            approvalCount: 0
        });
        
        // Add to active settlements
        ds.activeSettlements.add(settlementId);
        
        emit SettlementProposed(settlementId, fromCustodian, toCustodian, amount, msg.sender);
    }

    /**
     * @notice Approves a pending settlement
     * @param settlementId The ID of the settlement to approve
     */
    function approveMultiSigSettlement(bytes32 settlementId) external {
        AccessControlLib.checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _approveMultiSigSettlementInternal(ds, settlementId);
    }

    function _approveMultiSigSettlementInternal(StorageLib.AppStorage storage ds, bytes32 settlementId) internal {
        StorageLib.PendingSettlement storage settlement = ds.pendingSettlements[settlementId];
        require(settlement.proposer != address(0), "MultiSig: Settlement not found");
        require(!settlement.isExecuted, "MultiSig: Settlement already executed");
        require(!settlement.isCancelled, "MultiSig: Settlement cancelled");

        // Check if approval period hasn't expired (24 hours)
        require(block.timestamp - settlement.proposedAt <= 86400, "MultiSig: Approval period expired");

        // Check if approver hasn't already approved
        require(!ds.settlementApprovers[settlementId].contains(msg.sender), "MultiSig: Already approved");

        // Approver cannot be the proposer
        require(msg.sender != settlement.proposer, "MultiSig: Proposer cannot approve");

        // Add approval
        ds.settlementApprovers[settlementId].add(msg.sender);
        settlement.approvalCount++;

        emit SettlementApproved(settlementId, msg.sender, settlement.approvalCount, ds.requiredApprovals);

        // Check if we have enough approvals to execute
        if (settlement.approvalCount >= ds.requiredApprovals) {
            _executeSettlement(settlementId);
        }
    }

    /**
     * @notice Cancels a pending settlement (only by proposer or admin)
     * @param settlementId The ID of the settlement to cancel
     * @param reason Reason for cancellation
     */
    function cancelMultiSigSettlement(bytes32 settlementId, string calldata reason) external {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        StorageLib.PendingSettlement storage settlement = ds.pendingSettlements[settlementId];
        require(settlement.proposer != address(0), "MultiSig: Settlement not found");
        require(!settlement.isExecuted, "MultiSig: Settlement already executed");
        require(!settlement.isCancelled, "MultiSig: Settlement already cancelled");
        
        // Only proposer or admin can cancel
        bool isProposer = (msg.sender == settlement.proposer);
        bool isAdmin = ds._roles[RoleConstants.ADMIN_ROLE].contains(msg.sender);
        require(isProposer || isAdmin, "MultiSig: Not authorized to cancel");
        
        settlement.isCancelled = true;
        ds.activeSettlements.remove(settlementId);
        
        emit SettlementCancelled(settlementId, msg.sender, reason);
    }

    /**
     * @notice Sets the number of approvals required for settlement execution
     * @param newThreshold The new approval threshold (minimum 2)
     */
    function setApprovalThreshold(uint256 newThreshold) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        require(newThreshold >= 2, "MultiSig: Threshold must be at least 2");
        require(newThreshold <= 10, "MultiSig: Threshold too high");
        
        uint256 oldThreshold = ds.requiredApprovals;
        ds.requiredApprovals = newThreshold;
        
        emit ApprovalThresholdUpdated(oldThreshold, newThreshold);
    }

    /**
     * @notice Sets the minimum amount that requires multi-signature approval
     * @param newThreshold The new threshold amount in wei
     */
    function setLargeSettlementThreshold(uint256 newThreshold) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        require(newThreshold > 0, "MultiSig: Threshold must be positive");
        
        uint256 oldThreshold = ds.largeSettlementThreshold;
        ds.largeSettlementThreshold = newThreshold;
        
        emit LargeSettlementThresholdUpdated(oldThreshold, newThreshold);
    }

    /**
     * @notice Batch approves multiple settlements in a single transaction
     * @param settlementIds Array of settlement IDs to approve
     */
    function batchApproveSettlements(bytes32[] calldata settlementIds) external {
        AccessControlLib.checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        for (uint256 i = 0; i < settlementIds.length; i++) {
            _approveMultiSigSettlementInternal(ds, settlementIds[i]);
        }
    }

    /**
     * @notice Emergency function to expire old pending settlements
     * @param maxAge Maximum age in seconds (default 7 days)
     */
    function cleanupExpiredSettlements(uint256 maxAge) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        if (maxAge == 0) {
            maxAge = 604800; // 7 days default
        }
        
        bytes32[] memory activeIds = ds.activeSettlements.values();
        uint256 cutoff = block.timestamp - maxAge;
        
        for (uint256 i = 0; i < activeIds.length; i++) {
            bytes32 settlementId = activeIds[i];
            StorageLib.PendingSettlement storage settlement = ds.pendingSettlements[settlementId];
            
            if (settlement.proposedAt < cutoff && !settlement.isExecuted) {
                settlement.isCancelled = true;
                ds.activeSettlements.remove(settlementId);
                
                emit SettlementCancelled(settlementId, msg.sender, "Expired - cleanup");
            }
        }
    }

    // View functions
    function getMultiSigSettlement(bytes32 settlementId) external view returns (StorageLib.PendingSettlement memory) {
        return StorageLib.diamondStorage().pendingSettlements[settlementId];
    }

    function getSettlementApprovers(bytes32 settlementId) external view returns (address[] memory) {
        return StorageLib.diamondStorage().settlementApprovers[settlementId].values();
    }

    function getActiveSettlements() external view returns (bytes32[] memory) {
        return StorageLib.diamondStorage().activeSettlements.values();
    }

    function getApprovalThreshold() external view returns (uint256) {
        return StorageLib.diamondStorage().requiredApprovals;
    }

    function getLargeSettlementThreshold() external view returns (uint256) {
        return StorageLib.diamondStorage().largeSettlementThreshold;
    }

    function isSettlementApprovedBy(bytes32 settlementId, address approver) external view returns (bool) {
        return StorageLib.diamondStorage().settlementApprovers[settlementId].contains(approver);
    }

    function getPendingApprovalsCount(bytes32 settlementId) external view returns (uint256 current, uint256 required) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        current = ds.pendingSettlements[settlementId].approvalCount;
        required = ds.requiredApprovals;
    }

    // Internal functions
    function _executeSettlement(bytes32 settlementId) internal {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        StorageLib.PendingSettlement storage settlement = ds.pendingSettlements[settlementId];
        
        require(!settlement.isExecuted, "MultiSig: Already executed");
        require(settlement.approvalCount >= ds.requiredApprovals, "MultiSig: Insufficient approvals");
        
        // Mark as executed
        settlement.isExecuted = true;
        settlement.executedAt = block.timestamp;
        ds.activeSettlements.remove(settlementId);
        
        // Perform the actual settlement transfer
        _internal_transfer(ds, settlement.fromCustodian, settlement.toCustodian, settlement.amount);
        
        // Update interbank liabilities if needed
        if (settlement.fromCustodian != settlement.toCustodian) {
            _updateInterbankLiabilities(
                settlement.fromCustodian,
                settlement.toCustodian,
                settlement.amount
            );
        }
        
        emit SettlementExecuted(settlementId, settlement.fromCustodian, settlement.toCustodian, settlement.amount);
    }

    function _internal_transfer(StorageLib.AppStorage storage ds, address sender, address recipient, uint256 amount) internal {
        T3CommonLib.internalTransfer(ds, sender, recipient, amount);
        // Emit standard ERC20 Transfer event
        emit ERC20BaseFacet.Transfer(sender, recipient, amount);
    }

    function _updateInterbankLiabilities(address fromCustodian, address toCustodian, uint256 amount) internal {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Update the liability tracking
        // This is a simplified version - production might need more complex liability management
        ds.interbankLiabilities[fromCustodian][toCustodian] += amount;
    }
}
