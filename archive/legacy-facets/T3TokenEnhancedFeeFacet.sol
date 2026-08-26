// ============================================================
// ARCHIVED - NEVER SAFE TO DEPLOY
// This facet is retained solely as historical evidence of a
// deprecated design. It contains known, unfixed vulnerabilities:
//   Permissionless fee mutation (Tier-0 A.1).
// It is excluded from the compile path and the deploy manifest.
// Do not deploy, import, or copy this code.
// ============================================================

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { T3CommonLib } from "../lib/T3CommonLib.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title T3TokenEnhancedFeeFacet
 * @notice Enhanced fee processing with KYC-based escrow routing
 * @dev Integrates with RewardsEscrow contract for non-KYC participant rewards
 */
contract T3TokenEnhancedFeeFacet {
    using StorageLib for StorageLib.AppStorage;
    using SafeERC20 for IERC20;

    // Events
    event FeeProcessedWithEscrow(
        address indexed sender,
        address indexed recipient,
        uint256 totalFee,
        uint256 senderReward,
        uint256 recipientReward,
        uint256 senderToEscrow,
        uint256 recipientToEscrow,
        uint256 treasuryAmount
    );

    event RewardsEscrowContractUpdated(
        address indexed oldContract,
        address indexed newContract
    );

    event KycCacheDurationUpdated(
        uint256 oldDuration,
        uint256 newDuration
    );

    event IncentiveCreditsMigrated(
        address indexed user,
        uint256 amount,
        bool toEscrow
    );

    event DirectRewardAwarded(
        address indexed user,
        uint256 amount
    );

    event EscrowRewardAwarded(
        address indexed user,
        uint256 amount
    );

    event RewardRoutingConfigUpdated(
        uint256 rewardPercentageBps,
        uint256 maxRewardPerTransaction,
        bool routingEnabled,
        uint256 minTransactionForReward
    );

    // Custom errors
    error ZeroAddress();
    error InvalidCacheDuration(uint256 duration);
    error RewardRoutingDisabled();
    error TransferAmountTooSmall(uint256 amount, uint256 minimum);
    error InvalidRewardPercentage(uint256 percentage);
    error RewardsEscrowContractNotSet();
    error EscrowTransferFailed();
    error InvalidFeeAmount(uint256 amount);

    /**
     * @notice Processes fee with KYC-based escrow routing
     * @dev Routes rewards based on KYC status: direct credits for KYC'd users, escrow for non-KYC'd
     * @param sender The transaction sender
     * @param recipient The transaction recipient  
     * @param amount The transaction amount
     * @param totalFeeCollected The total fee collected
     * @return senderReward Amount of reward for sender
     * @return recipientReward Amount of reward for recipient
     */
    function processFeeWithEscrow(
        address sender,
        address recipient,
        uint256 amount,
        uint256 totalFeeCollected
    ) external returns (uint256 senderReward, uint256 recipientReward) {
        if (totalFeeCollected == 0) return (0, 0);
        if (totalFeeCollected > amount) revert InvalidFeeAmount(totalFeeCollected);

        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Refresh KYC cache for both parties if needed
        bool senderKyc = T3CommonLib.getKycStatusCached(ds, sender);
        bool recipientKyc = T3CommonLib.getKycStatusCached(ds, recipient);

        // Check if cache needs refresh (simple heuristic: if cache is near expiry)
        if (_shouldRefreshKycCache(ds, sender)) {
            senderKyc = T3CommonLib.refreshKycCache(ds, sender);
        }
        if (_shouldRefreshKycCache(ds, recipient)) {
            recipientKyc = T3CommonLib.refreshKycCache(ds, recipient);
        }

        // Calculate reward shares (25% each to sender and recipient)
        senderReward = totalFeeCollected / 4;
        recipientReward = totalFeeCollected / 4;
        uint256 treasuryAmount = totalFeeCollected - senderReward - recipientReward; // Remaining 50%

        uint256 senderToEscrow = 0;
        uint256 recipientToEscrow = 0;

        // Process sender reward based on KYC status
        if (senderKyc) {
            // KYC'd sender gets immediate reward credits (use struct for consistency with applyCredits)
            T3CommonLib.ensureProfileExistsForWrite(ds, sender);
            ds.incentiveCredits[sender].amount += senderReward;
            ds.incentiveCredits[sender].lastUpdated = block.timestamp;
        } else {
            // Non-KYC'd sender reward goes to escrow
            _addRewardToEscrow(ds, sender, senderReward);
            senderToEscrow = senderReward;
        }

        // Process recipient reward based on KYC status
        if (recipientKyc) {
            // KYC'd recipient gets immediate reward credits (use struct for consistency with applyCredits)
            T3CommonLib.ensureProfileExistsForWrite(ds, recipient);
            ds.incentiveCredits[recipient].amount += recipientReward;
            ds.incentiveCredits[recipient].lastUpdated = block.timestamp;
        } else {
            // Non-KYC'd recipient reward goes to escrow
            _addRewardToEscrow(ds, recipient, recipientReward);
            recipientToEscrow = recipientReward;
        }

        // NOTE: Treasury share is handled by the caller (fee already transferred to treasury).
        // This function only distributes credits/escrow from the fee already in treasury.

        emit FeeProcessedWithEscrow(
            sender,
            recipient,
            totalFeeCollected,
            senderReward,
            recipientReward,
            senderToEscrow,
            recipientToEscrow,
            treasuryAmount
        );

        return (senderReward, recipientReward);
    }

    /**
     * @notice Sets the rewards escrow contract address
     * @param newEscrowContract The new escrow contract address
     */
    function setRewardsEscrowContract(address newEscrowContract) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        if (newEscrowContract == address(0)) revert ZeroAddress();

        address oldContract = ds.rewardsEscrowContract;
        ds.rewardsEscrowContract = newEscrowContract;

        emit RewardsEscrowContractUpdated(oldContract, newEscrowContract);
    }

    /**
     * @notice Sets the KYC cache duration
     * @param duration The cache duration in seconds
     */
    function setKycCacheDuration(uint256 duration) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        if (duration < 300 || duration > 86400) revert InvalidCacheDuration(duration); // 5 minutes to 24 hours

        uint256 oldDuration = ds.kycCacheDuration;
        ds.kycCacheDuration = duration;

        emit KycCacheDurationUpdated(oldDuration, duration);
    }

    /**
     * @notice Migrates existing incentive credits for a user based on current KYC status
     * @param user The user address to migrate
     */
    function migrateIncentiveCredits(address user) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _migrateIncentiveCreditsInternal(ds, user);
    }

    /**
     * @notice Batch migrates incentive credits for multiple users
     * @param users Array of user addresses to migrate
     */
    function batchMigrateIncentiveCredits(address[] calldata users) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        for (uint256 i = 0; i < users.length; i++) {
            _migrateIncentiveCreditsInternal(ds, users[i]);
        }
    }

    /**
     * @dev Internal implementation of incentive credits migration
     */
    function _migrateIncentiveCreditsInternal(StorageLib.AppStorage storage ds, address user) internal {
        // Check both legacy (_incentiveCredits) and canonical (incentiveCredits) fields
        uint256 legacyCredits = ds._incentiveCredits[user];
        uint256 structCredits = ds.incentiveCredits[user].amount;
        uint256 existingCredits = legacyCredits + structCredits;
        if (existingCredits == 0) return;

        bool userKyc = T3CommonLib.refreshKycCache(ds, user);

        if (!userKyc) {
            // User is not KYC'd, move credits to escrow
            ds._incentiveCredits[user] = 0; // Clear legacy
            ds.incentiveCredits[user].amount = 0; // Clear canonical
            ds.incentiveCredits[user].lastUpdated = block.timestamp;
            _addRewardToEscrow(ds, user, existingCredits);

            emit IncentiveCreditsMigrated(user, existingCredits, true);
        } else {
            emit IncentiveCreditsMigrated(user, existingCredits, false);
        }
    }

    /**
     * @notice Refreshes KYC cache for multiple users
     * @param users Array of user addresses to refresh
     */
    function batchRefreshKycCache(address[] calldata users) external {
        // Allow custodians to refresh cache for efficiency
        AccessControlLib.checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        T3CommonLib.batchRefreshKycCache(ds, users);
    }

    /**
     * @notice Gets user's incentive credits balance
     * @param user The user address
     * @return credits The current incentive credits balance
     */
    function getIncentiveCreditsBalance(address user) external view returns (uint256 credits) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        // Return combined balance from canonical struct and legacy uint256 field
        return ds.incentiveCredits[user].amount + ds._incentiveCredits[user];
    }

    /**
     * @notice Gets KYC cache information for a user
     * @param user The user address
     * @return isValid Current cached KYC status
     * @return lastChecked Last time the cache was updated
     * @return cacheExpiry When the cache expires
     */
    function getKycCacheInfo(address user) external view returns (
        bool isValid,
        uint256 lastChecked,
        uint256 cacheExpiry
    ) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        StorageLib.KycCache storage cache = ds.kycStatusCache[user];
        
        return (cache.isValid, cache.lastChecked, cache.cacheExpiry);
    }

    /**
     * @notice Gets enhanced fee processing configuration
     * @return rewardsEscrowContract Current escrow contract address
     * @return kycCacheDuration Current cache duration in seconds
     */
    function getEnhancedFeeConfig() external view returns (
        address rewardsEscrowContract,
        uint256 kycCacheDuration
    ) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        rewardsEscrowContract = ds.rewardsEscrowContract;
        kycCacheDuration = ds.kycCacheDuration;
        
        // Set default if not configured
        if (kycCacheDuration == 0) {
            kycCacheDuration = 3600; // 1 hour default
        }
    }

    // Internal functions


    /**
     * @notice Checks if KYC cache should be refreshed
     * @param ds Storage reference
     * @param user User address
     * @return shouldRefresh Whether cache should be refreshed
     */
    function _shouldRefreshKycCache(
        StorageLib.AppStorage storage ds,
        address user
    ) internal view returns (bool shouldRefresh) {
        StorageLib.KycCache storage cache = ds.kycStatusCache[user];
        
        // Refresh if cache has never been set
        if (cache.lastChecked == 0) return true;
        
        // Refresh if cache has expired
        if (block.timestamp >= cache.cacheExpiry) return true;
        
        // Refresh if cache is close to expiry (within 5 minutes)
        uint256 timeToExpiry = cache.cacheExpiry > block.timestamp ? 
                               cache.cacheExpiry - block.timestamp : 0;
        
        return timeToExpiry < 300; // 5 minutes
    }

    /**
     * @notice Processes transaction fee with KYC-aware reward routing
     * @param from Sender address
     * @param to Recipient address
     * @param transferAmount Transfer amount
     * @return netFeeAmount Fee amount after credit application
     * @return fromReward Reward allocated to sender
     * @return toReward Reward allocated to recipient
     */
    function processTransactionFee(
        address from,
        address to,
        uint256 transferAmount
    ) external returns (
        uint256 netFeeAmount,
        uint256 fromReward,
        uint256 toReward
    ) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Check if reward routing is enabled
        if (!ds.rewardRoutingConfig.routingEnabled) {
            revert RewardRoutingDisabled();
        }
        
        // Check minimum transaction amount for rewards
        if (transferAmount < ds.rewardRoutingConfig.minTransactionForReward) {
            revert TransferAmountTooSmall(transferAmount, ds.rewardRoutingConfig.minTransactionForReward);
        }
        
        // Calculate base fee (using existing fee logic)
        uint256 baseFee = _calculateBaseFee(ds, from, to, transferAmount);
        
        // Apply incentive credits to reduce fee
        uint256 feeAfterCredits = _applyIncentiveCredits(ds, from, baseFee);
        
        // Calculate rewards based on original fee amount
        (fromReward, toReward) = _calculateRewards(ds, baseFee);
        
        // Route rewards based on KYC status
        _routeRewards(ds, from, fromReward);
        _routeRewards(ds, to, toReward);
        
        netFeeAmount = feeAfterCredits;
        
        emit FeeProcessedWithEscrow(
            from,
            to,
            baseFee,
            fromReward,
            toReward,
            _isUserKYCVerified(ds, from) ? 0 : fromReward,
            _isUserKYCVerified(ds, to) ? 0 : toReward,
            netFeeAmount
        );
    }

    /**
     * @notice Updates reward routing configuration
     * @param rewardPercentageBps Reward percentage in basis points
     * @param maxRewardPerTransaction Maximum reward per transaction
     * @param routingEnabled Whether routing is enabled
     * @param minTransactionForReward Minimum transaction amount for rewards
     */
    function updateRewardRoutingConfig(
        uint256 rewardPercentageBps,
        uint256 maxRewardPerTransaction,
        bool routingEnabled,
        uint256 minTransactionForReward
    ) external {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        if (rewardPercentageBps > 1000) revert InvalidRewardPercentage(rewardPercentageBps); // Max 10%
        
        ds.rewardRoutingConfig.rewardPercentageBps = rewardPercentageBps;
        ds.rewardRoutingConfig.maxRewardPerTransaction = maxRewardPerTransaction;
        ds.rewardRoutingConfig.routingEnabled = routingEnabled;
        ds.rewardRoutingConfig.minTransactionForReward = minTransactionForReward;
        
        emit RewardRoutingConfigUpdated(
            rewardPercentageBps,
            maxRewardPerTransaction,
            routingEnabled,
            minTransactionForReward
        );
    }

    /**
     * @notice Checks if user is KYC verified (with caching)
     * @param ds Storage reference
     * @param user User address
     * @return verified Whether user is KYC verified
     */
    function _isUserKYCVerified(
        StorageLib.AppStorage storage ds,
        address user
    ) internal returns (bool verified) {
        // Use existing T3CommonLib functionality for KYC checking with cache
        return T3CommonLib.refreshKycCache(ds, user);
    }

    /**
     * @notice Routes rewards based on user KYC status
     * @param ds Storage reference
     * @param user User address
     * @param rewardAmount Reward amount
     */
    function _routeRewards(
        StorageLib.AppStorage storage ds,
        address user,
        uint256 rewardAmount
    ) internal {
        if (rewardAmount == 0) return;
        
        if (_isUserKYCVerified(ds, user)) {
            // Direct route: Add to incentive credits (use canonical struct field)
            ds.incentiveCredits[user].amount += rewardAmount;
            ds.incentiveCredits[user].lastUpdated = block.timestamp;
            emit DirectRewardAwarded(user, rewardAmount);
        } else {
            // Escrow route: Add reward directly to escrow storage
            if (ds.rewardsEscrowContract == address(0)) {
                revert RewardsEscrowContractNotSet();
            }
            
            // Add reward directly to escrow system (avoiding external call and permission issues)
            _addRewardToEscrow(ds, user, rewardAmount);
            emit EscrowRewardAwarded(user, rewardAmount);
        }
    }

    /**
     * @notice Adds reward directly to escrow system (internal helper)
     * @param ds Storage reference
     * @param user User to receive escrow reward
     * @param amount Reward amount
     */
    function _addRewardToEscrow(
        StorageLib.AppStorage storage ds,
        address user,
        uint256 amount
    ) internal {
        if (amount == 0) return;
        
        // Check and advance epoch if needed (simplified version)
        uint256 currentTime = block.timestamp;
        uint256 currentEpoch = ds.rewardsEscrow.currentEpoch;
        
        // If this is the first reward or epoch has ended, advance epoch
        if (ds.rewardsEscrow.epochs[currentEpoch].startTime == 0 || 
            currentTime >= ds.rewardsEscrow.epochs[currentEpoch].startTime + ds.rewardsEscrow.epochDuration) {
            
            if (ds.rewardsEscrow.epochs[currentEpoch].startTime != 0) {
                // Close current epoch and start new one
                ds.rewardsEscrow.currentEpoch++;
                currentEpoch = ds.rewardsEscrow.currentEpoch;
            }
            
            // Initialize new epoch
            ds.rewardsEscrow.epochs[currentEpoch].startTime = currentTime;
            ds.rewardsEscrow.epochs[currentEpoch].endTime = currentTime + ds.rewardsEscrow.epochDuration;
        }
        
        // Add reward to current epoch
        StorageLib.EpochRewards storage epoch = ds.rewardsEscrow.epochs[currentEpoch];
        
        // Update user rewards
        if (epoch.userRewards[user] == 0) {
            // First reward for this user in this epoch
            ds.rewardsEscrow.userEpochs[user].push(currentEpoch);
        }
        
        epoch.userRewards[user] += amount;
        epoch.totalRewards += amount;
    }

    /**
     * @notice Calculates base fee using existing fee logic
     * @param ds Storage reference
     * @param from Sender address
     * @param to Recipient address
     * @param amount Transfer amount
     * @return fee Calculated fee amount
     */
    function _calculateBaseFee(
        StorageLib.AppStorage storage ds,
        address from,
        address to,
        uint256 amount
    ) internal view returns (uint256 fee) {
        // Use existing fee tier calculation logic
        uint256 feeRate = _getFeeRateForAmount(ds, amount);
        fee = (amount * feeRate) / 10000; // Convert basis points to actual fee
        
        // Apply minimum and maximum fee bounds
        if (fee < ds.minFeeWei) {
            fee = ds.minFeeWei;
        }
        
        uint256 maxFee = (amount * ds.maxFeePercentBps) / 10000;
        if (fee > maxFee) {
            fee = maxFee;
        }
    }

    /**
     * @notice Gets fee rate for amount using existing fee tiers
     * @param ds Storage reference
     * @param amount Transfer amount
     * @return feeRate Fee rate in basis points
     */
    function _getFeeRateForAmount(
        StorageLib.AppStorage storage ds,
        uint256 amount
    ) internal view returns (uint256 feeRate) {
        uint256[] memory thresholds = ds.feeTierThresholds;
        uint256[] memory rates = ds.feeTierRatesBps;
        
        // Default to highest tier if no tiers configured
        if (thresholds.length == 0 || rates.length == 0) {
            return ds.baseRiskScalerBps;
        }
        
        // Find appropriate tier
        for (uint256 i = 0; i < thresholds.length; i++) {
            if (amount <= thresholds[i]) {
                return rates[i];
            }
        }
        
        // If amount exceeds all thresholds, use the last (highest) rate
        return rates[rates.length - 1];
    }

    /**
     * @notice Applies incentive credits to reduce fee
     * @param ds Storage reference
     * @param user User address
     * @param fee Original fee amount
     * @return feeAfterCredits Fee amount after applying credits
     */
    function _applyIncentiveCredits(
        StorageLib.AppStorage storage ds,
        address user,
        uint256 fee
    ) internal returns (uint256 feeAfterCredits) {
        // Use canonical struct field (consistent with applyCredits in T3CommonLib)
        uint256 availableCredits = ds.incentiveCredits[user].amount;

        if (availableCredits == 0) {
            return fee;
        }

        uint256 creditsToUse = availableCredits > fee ? fee : availableCredits;

        ds.incentiveCredits[user].amount -= creditsToUse;
        ds.incentiveCredits[user].lastUpdated = block.timestamp;
        feeAfterCredits = fee - creditsToUse;
    }

    /**
     * @notice Calculates reward amounts for sender and recipient
     * @param ds Storage reference
     * @param feeAmount Fee amount to base rewards on
     * @return fromReward Reward for sender
     * @return toReward Reward for recipient
     */
    function _calculateRewards(
        StorageLib.AppStorage storage ds,
        uint256 feeAmount
    ) internal view returns (uint256 fromReward, uint256 toReward) {
        uint256 totalReward = (feeAmount * ds.rewardRoutingConfig.rewardPercentageBps) / 10000;
        
        // Split reward between sender and recipient (70/30 split)
        fromReward = (totalReward * 70) / 100;
        toReward = totalReward - fromReward;
        
        // Apply maximum reward limits
        if (fromReward > ds.rewardRoutingConfig.maxRewardPerTransaction) {
            fromReward = ds.rewardRoutingConfig.maxRewardPerTransaction;
        }
        
        if (toReward > ds.rewardRoutingConfig.maxRewardPerTransaction) {
            toReward = ds.rewardRoutingConfig.maxRewardPerTransaction;
        }
    }
}

/**
 * @notice Interface for RewardsEscrow contract
 */
interface IRewardsEscrow {
    function addReward(address user, uint256 amount) external;
}
