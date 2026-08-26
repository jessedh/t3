// ============================================================
// ARCHIVED - NEVER SAFE TO DEPLOY
// This facet is retained solely as historical evidence of a
// deprecated design. It contains known, unfixed vulnerabilities:
//   Ghost execution on external assets (Tier-0 A.3).
// It is excluded from the compile path and the deploy manifest.
// Do not deploy, import, or copy this code.
// ============================================================

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title SecureSettleFacet
 * @notice Multi-asset settlement system with oracle price validation and time-locked execution
 * @dev Implements secure settlement for high-value transactions with custodian approval workflows
 */
contract SecureSettleFacet is ReentrancyGuardBase {
    using StorageLib for StorageLib.AppStorage;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Settlement status enumeration
    uint8 constant STATUS_PENDING = 0;
    uint8 constant STATUS_APPROVED = 1;
    uint8 constant STATUS_EXECUTED = 2;
    uint8 constant STATUS_CANCELLED = 3;

    // Events
    event SettlementProposed(
        bytes32 indexed settlementId,
        address indexed initiator,
        address[] assets,
        uint256[] amounts,
        address[] recipients,
        uint256 totalUsdValue,
        uint256 executesAt
    );

    event SettlementApproved(
        bytes32 indexed settlementId,
        address indexed approver
    );

    event SettlementExecuted(
        bytes32 indexed settlementId,
        address indexed initiator,
        uint256 totalUsdValue
    );

    event SettlementCancelled(
        bytes32 indexed settlementId,
        address indexed canceller,
        string reason
    );

    event SecureSettleThresholdUpdated(
        address indexed asset,
        uint256 oldThreshold,
        uint256 newThreshold
    );

    event DefaultSettlementDelayUpdated(
        uint256 oldDelay,
        uint256 newDelay
    );

    event OracleManagerUpdated(
        address indexed oldOracle,
        address indexed newOracle
    );

    // Custom errors
    error InvalidArrayLength();
    error ZeroAddress();
    error ZeroAmount();
    error BelowSecureSettleThreshold(uint256 usdValue, uint256 threshold);
    error SettlementNotFound(bytes32 settlementId);
    error SettlementNotPending(bytes32 settlementId);
    error SettlementNotReady(bytes32 settlementId, uint256 currentTime, uint256 readyTime);
    error SettlementExpired(bytes32 settlementId);
    error InsufficientBalance(address asset, uint256 available, uint256 required);
    error OracleNotConfigured();
    error PriceDataStale(address asset);
    error InvalidPriceData(address asset);
    error UnauthorizedCancellation(address caller);
    error SelfTransfer();

    // Internal modifier to check if paused
    modifier whenNotPaused() {
        if (StorageLib.diamondStorage()._paused) {
            revert("Pausable: paused");
        }
        _;
    }

    /**
     * @notice Proposes a multi-asset settlement requiring secure approval
     * @param assets Array of asset addresses (address(this) for T3 tokens)
     * @param amounts Array of amounts for each asset
     * @param recipients Array of recipient addresses for each asset
     * @param description Description of the settlement purpose
     * @param requestedDelay Optional requested delay in seconds (must be >= system delay)
     * @return settlementId Unique identifier for the settlement
     */
    function proposeMultiAssetSettlement(
        address[] calldata assets,
        uint256[] calldata amounts,
        address[] calldata recipients,
        string calldata description,
        uint256 requestedDelay
    ) external nonReentrant whenNotPaused returns (bytes32 settlementId) {
        if (assets.length != amounts.length || assets.length != recipients.length) {
            revert InvalidArrayLength();
        }
        if (assets.length == 0) revert InvalidArrayLength();

        AccessControlLib.checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        if (WalletRecoveryStorage.layout().activeRecoveryCount[msg.sender] > 0) {
            revert IWalletRecovery.WalletInRecovery(msg.sender);
        }
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        // Calculate total USD value using oracle
        uint256 totalUsdValue = 0;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i] == address(0) || recipients[i] == address(0)) revert ZeroAddress();
            if (amounts[i] == 0) revert ZeroAmount();
            if (assets[i] == address(this) && msg.sender == recipients[i]) revert SelfTransfer();

            uint256 usdValue = _getUsdValue(ds, assets[i], amounts[i]);
            totalUsdValue += usdValue;

            // Validate balance for T3Token transfers
            if (assets[i] == address(this)) {
                require(ds._balances[msg.sender] >= amounts[i], "Insufficient T3Token balance");
            }
        }

        // Check if settlement meets threshold requirements
        uint256 requiredThreshold = ds.secureSettle.defaultThreshold;
        if (assets.length == 1) {
            uint256 assetThreshold = ds.secureSettle.assetThresholds[assets[0]];
            if (assetThreshold > 0) {
                requiredThreshold = assetThreshold;
            }
        }

        if (totalUsdValue < requiredThreshold) {
            revert BelowSecureSettleThreshold(totalUsdValue, requiredThreshold);
        }

        // Generate unique settlement ID
        settlementId = keccak256(abi.encodePacked(
            msg.sender,
            assets,
            amounts,
            recipients,
            description,
            block.timestamp,
            block.chainid
        ));

        // Ensure settlement doesn't already exist
        require(ds.secureSettle.settlements[settlementId].initiator == address(0), "Settlement already exists");

        // Calculate settlement delay based on USD value and user request
        uint256 minDelay = _calculateSettlementDelay(ds, totalUsdValue);
        uint256 finalDelay = requestedDelay > minDelay ? requestedDelay : minDelay;
        uint256 executesAt = block.timestamp + finalDelay;

        // Create settlement proposal
        ds.secureSettle.settlements[settlementId] = StorageLib.SettlementData({
            initiator: msg.sender,
            assets: assets,
            amounts: amounts,
            recipients: recipients,
            totalUsdValue: totalUsdValue,
            proposedAt: block.timestamp,
            executesAt: executesAt,
            status: STATUS_PENDING,
            hashCommitment: keccak256(abi.encodePacked(settlementId, block.timestamp)),
            description: description
        });

        emit SettlementProposed(
            settlementId,
            msg.sender,
            assets,
            amounts,
            recipients,
            totalUsdValue,
            executesAt
        );
    }

    /**
     * @notice Approves a pending settlement (custodian-only)
     * @param settlementId The settlement ID to approve
     */
    function approveSettlement(bytes32 settlementId) external nonReentrant whenNotPaused {
        AccessControlLib.checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        if (WalletRecoveryStorage.layout().activeRecoveryCount[msg.sender] > 0) {
            revert IWalletRecovery.WalletInRecovery(msg.sender);
        }
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        StorageLib.SettlementData storage settlement = ds.secureSettle.settlements[settlementId];
        if (settlement.initiator == address(0)) revert SettlementNotFound(settlementId);
        if (settlement.status != STATUS_PENDING) revert SettlementNotPending(settlementId);
        
        // Check if settlement hasn't expired (24 hour approval window)
        require(block.timestamp <= settlement.proposedAt + 86400, "Settlement approval expired");

        settlement.status = STATUS_APPROVED;
        
        emit SettlementApproved(settlementId, msg.sender);
    }

    /**
     * @notice Executes an approved settlement after time delay
     * @param settlementId The settlement ID to execute
     */
    function executeSettlement(bytes32 settlementId) external nonReentrant whenNotPaused {
        AccessControlLib.checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        if (WalletRecoveryStorage.layout().activeRecoveryCount[msg.sender] > 0) {
            revert IWalletRecovery.WalletInRecovery(msg.sender);
        }
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        StorageLib.SettlementData storage settlement = ds.secureSettle.settlements[settlementId];
        if (settlement.initiator == address(0)) revert SettlementNotFound(settlementId);
        if (settlement.status != STATUS_APPROVED) revert SettlementNotPending(settlementId);
        
        // Check if settlement is ready for execution
        if (block.timestamp < settlement.executesAt) {
            revert SettlementNotReady(settlementId, block.timestamp, settlement.executesAt);
        }

        // Check if settlement hasn't expired (48 hours after ready time)
        if (block.timestamp > settlement.executesAt + 172800) {
            revert SettlementExpired(settlementId);
        }

        // Mark as executed
        settlement.status = STATUS_EXECUTED;

        // Execute all transfers in the settlement
        for (uint256 i = 0; i < settlement.assets.length; i++) {
            address asset = settlement.assets[i];
            uint256 amount = settlement.amounts[i];
            address recipient = settlement.recipients[i];

            if (asset == address(this)) {
                // T3Token transfer
                _executeT3Transfer(ds, settlement.initiator, recipient, amount);
            } else {
                // External asset transfer (would require additional implementation)
                // For now, we'll emit an event for external handling
                emit SettlementExecuted(settlementId, settlement.initiator, settlement.totalUsdValue);
            }
        }

        emit SettlementExecuted(settlementId, settlement.initiator, settlement.totalUsdValue);
    }

    /**
     * @notice Cancels a pending settlement
     * @param settlementId The settlement ID to cancel
     * @param reason Reason for cancellation
     */
    function cancelSettlement(bytes32 settlementId, string calldata reason) external nonReentrant whenNotPaused {
        if (WalletRecoveryStorage.layout().activeRecoveryCount[msg.sender] > 0) {
            revert IWalletRecovery.WalletInRecovery(msg.sender);
        }
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        StorageLib.SettlementData storage settlement = ds.secureSettle.settlements[settlementId];
        if (settlement.initiator == address(0)) revert SettlementNotFound(settlementId);
        if (settlement.status == STATUS_EXECUTED || settlement.status == STATUS_CANCELLED) {
            revert SettlementNotPending(settlementId);
        }

        // Only initiator or admin can cancel
        bool isInitiator = (msg.sender == settlement.initiator);
        bool isAdmin = ds._roles[RoleConstants.ADMIN_ROLE].contains(msg.sender);
        if (!isInitiator && !isAdmin) revert UnauthorizedCancellation(msg.sender);

        settlement.status = STATUS_CANCELLED;
        
        emit SettlementCancelled(settlementId, msg.sender, reason);
    }

    /**
     * @notice Sets the secure settlement threshold for an asset
     * @param asset The asset address (address(this) for T3Token)
     * @param threshold The new threshold in USD (18 decimals)
     */
    function setSecureSettleThreshold(address asset, uint256 threshold) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        uint256 oldThreshold = ds.secureSettle.assetThresholds[asset];
        ds.secureSettle.assetThresholds[asset] = threshold;
        
        emit SecureSettleThresholdUpdated(asset, oldThreshold, threshold);
    }

    /**
     * @notice Sets the default secure settlement threshold
     * @param threshold The new default threshold in USD (18 decimals)
     */
    function setDefaultSecureSettleThreshold(uint256 threshold) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        uint256 oldThreshold = ds.secureSettle.defaultThreshold;
        ds.secureSettle.defaultThreshold = threshold;
        
        emit SecureSettleThresholdUpdated(address(0), oldThreshold, threshold);
    }

    /**
     * @notice Sets the default settlement delay
     * @param delay The new default delay in seconds
     */
    function setDefaultSettlementDelay(uint256 delay) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        require(delay >= 1 hours && delay <= 7 days, "Invalid delay range");
        
        uint256 oldDelay = ds.secureSettle.settlementDelay;
        ds.secureSettle.settlementDelay = delay;
        
        emit DefaultSettlementDelayUpdated(oldDelay, delay);
    }

    /**
     * @notice Updates the oracle manager address
     * @param newOracle The new oracle manager address
     */
    function setOracleManager(address newOracle) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        if (newOracle == address(0)) revert ZeroAddress();
        
        address oldOracle = ds.secureSettle.oracleManager;
        ds.secureSettle.oracleManager = newOracle;
        
        emit OracleManagerUpdated(oldOracle, newOracle);
    }

    function setMaxSettlementDelay(uint256 delay) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        ds.secureSettle.maxSettlementDelay = delay;
    }

    /**
     * @notice Sets the secure settlement active status
     * @param _active The new active status
     */
    function setSecureSettleActive(bool _active) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ds.secureSettle.secureSettleActive = _active;
    }

    /**
     * @notice Gets settlement information
     * @param settlementId The settlement ID
     * @return settlement The settlement data
     */
    function getSettlement(bytes32 settlementId) external view returns (StorageLib.SettlementData memory settlement) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        return ds.secureSettle.settlements[settlementId];
    }

    /**
     * @notice Gets the secure settlement threshold for an asset
     * @param asset The asset address
     * @return threshold The threshold in USD (18 decimals)
     */
    function getSecureSettleThreshold(address asset) external view returns (uint256 threshold) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        threshold = ds.secureSettle.assetThresholds[asset];
        if (threshold == 0) {
            threshold = ds.secureSettle.defaultThreshold;
        }
    }

    /**
     * @notice Checks if a transfer requires secure settlement
     * @param asset The asset address
     * @param amount The transfer amount
     * @return required Whether secure settlement is required
     */
    function requiresSecureSettlement(address asset, uint256 amount) external view returns (bool required) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds.secureSettle.secureSettleActive) return false;
        
        uint256 usdValue = _getUsdValue(ds, asset, amount);
        uint256 threshold = ds.secureSettle.assetThresholds[asset];
        if (threshold == 0) threshold = ds.secureSettle.defaultThreshold;
        
        return usdValue >= threshold;
    }

    // Internal functions

    /**
     * @notice Executes a T3Token transfer as part of settlement
     */
    function _executeT3Transfer(
        StorageLib.AppStorage storage ds,
        address from,
        address to,
        uint256 amount
    ) internal {
        require(ds._balances[from] >= amount, "Insufficient balance for settlement");
        
        ds._balances[from] -= amount;
        ds._balances[to] += amount;
        
        // Emit Transfer event for ERC20 compliance
        emit ERC20BaseFacet.Transfer(from, to, amount);
    }

    /**
     * @notice Gets USD value for an asset amount using oracle
     */
    function _getUsdValue(
        StorageLib.AppStorage storage ds,
        address asset,
        uint256 amount
    ) internal view returns (uint256 usdValue) {
        if (ds.secureSettle.oracleManager == address(0)) {
            revert OracleNotConfigured();
        }

        if (asset == address(this)) {
            // For T3Token, assume 1:1 USD parity
            return amount;
        }

        // For other assets, would call oracle manager
        // This is a placeholder implementation
        try IOracleManager(ds.secureSettle.oracleManager).getUsdValue(asset, amount) returns (uint256 value) {
            return value;
        } catch {
            revert InvalidPriceData(asset);
        }
    }

    /**
     * @notice Calculates settlement delay based on USD value
     */
    function _calculateSettlementDelay(
        StorageLib.AppStorage storage ds,
        uint256 usdValue
    ) internal view returns (uint256 delay) {
        // Base delay
        delay = ds.secureSettle.settlementDelay;
        
        // Increase delay for larger amounts
        if (usdValue >= 1000000 * 10**18) { // $1M+
            delay = delay * 3; // 3x delay for $1M+
        } else if (usdValue >= 100000 * 10**18) { // $100K+
            delay = delay * 2; // 2x delay for $100K+
        }
        
        // Cap at maximum delay
        if (delay > ds.secureSettle.maxSettlementDelay) {
            delay = ds.secureSettle.maxSettlementDelay;
        }
    }
}

/**
 * @notice Interface for Oracle Manager
 */
interface IOracleManager {
    function getUsdValue(address asset, uint256 amount) external view returns (uint256);
}
