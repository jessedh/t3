// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "./StorageLib.sol";
import { ClaimAttributionLib } from "./ClaimAttributionLib.sol";
import { ClaimAttributionStorage } from "./ClaimAttributionStorage.sol";
import { ComplianceStatusLib } from "./ComplianceStatusLib.sol";

/**
 * @title T3CommonLib
 * @notice Consolidated library for common utility functions used across T3Token facets.
 * @dev This library eliminates code duplication by providing centralized implementations
 * of frequently used functions like profile management, transfers, and calculations.
 */
library T3CommonLib {
    
    // --- Profile Management Functions ---
    
    /**
     * @notice Ensures that a wallet profile exists for view operations.
     * @dev This is a conceptual check for view functions. Profile creation occurs in write operations.
     * @param ds The application's shared storage.
     * @param wallet The address of the wallet to check.
     */
    function ensureProfileExistsView(StorageLib.AppStorage storage ds, address wallet) internal view {
        // No explicit action needed in view context as Solidity structs are zero-initialized.
        // This function serves as documentation that profile existence is being considered.
        if (wallet == address(0)) {
            return; // No profile for the zero address.
        }
        // Subsequent logic should handle cases where creationTime might be 0.
    }
    
    /**
     * @notice Ensures that a wallet profile exists, creating it if necessary for write operations.
     * @dev This function is called before any state-changing operations that modify wallet profiles.
     * @param ds The application's shared storage.
     * @param wallet The address of the wallet to ensure exists.
     */
    function ensureProfileExistsForWrite(StorageLib.AppStorage storage ds, address wallet) internal {
        if (wallet != address(0) && ds.walletRiskProfiles[wallet].creationTime == 0) {
            ds.walletRiskProfiles[wallet].creationTime = block.timestamp;
        }
    }
    
    // --- Transfer Functions ---
    
    /**
     * @notice Internal function to perform basic token transfers.
     * @dev Handles balance validation, updates, and emits Transfer events.
     * @param ds The application's shared storage.
     * @param sender The address sending tokens.
     * @param recipient The address receiving tokens.
     * @param amount The amount of tokens to transfer.
     */
    function internalTransfer(
        StorageLib.AppStorage storage ds, 
        address sender, 
        address recipient, 
        uint256 amount
    ) internal {
        if (sender == address(0)) { revert StorageLib.TransferToZeroAddress(); }
        if (recipient == address(0)) { revert StorageLib.TransferToZeroAddress(); }
        
        uint256 senderBalance = ds._balances[sender];
        if (senderBalance < amount) {
            revert StorageLib.ERC20InsufficientBalance(sender, senderBalance, amount);
        }
        
        unchecked { ds._balances[sender] = senderBalance - amount; }
        ds._balances[recipient] += amount;

        // Claim attribution (no-op when !initialized)
        ClaimAttributionStorage.Layout storage claims = ClaimAttributionStorage.layout();
        if (claims.initialized) {
            ClaimAttributionLib.moveClaims(claims, sender, recipient, amount);
        }

        // Note: Events must be emitted by calling facet to maintain proper event source
        // emit Transfer(sender, recipient, amount); // Called by facet
    }
    
    // --- Fee Processing Functions ---
    
    /**
     * @notice Attempts to use a user's prefunded fee balance to cover a part of the fee.
     * @dev This function mutates the prefundedFeeBalances in storage.
     * @param ds The application's shared storage.
     * @param user The user whose prefunded balance is to be used.
     * @param amountToUse The amount of fee to try and cover from prefunded balance.
     * @return success True if some prefunded amount could be used, false otherwise.
     * @return actuallyUsed The amount actually debited from the prefunded balance.
     */
    function usePrefundedFees(
        StorageLib.AppStorage storage ds, 
        address user, 
        uint256 amountToUse
    ) internal returns (bool success, uint256 actuallyUsed) {
        if (amountToUse == 0) return (true, 0);
        
        ensureProfileExistsForWrite(ds, user);
        uint256 prefundedBalance = ds.prefundedFeeBalances[user];
        if (prefundedBalance == 0) return (false, 0);

        actuallyUsed = amountToUse > prefundedBalance ? prefundedBalance : amountToUse;
        ds.prefundedFeeBalances[user] -= actuallyUsed;
        
        return (true, actuallyUsed);
    }
    
    /**
     * @notice Applies a user's incentive credits to cover a part of the fee.
     * @dev This function mutates the incentiveCredits in storage.
     * @param ds The application's shared storage.
     * @param wallet The user whose credits are to be applied.
     * @param feeToCover The amount of fee to try and cover with credits.
     * @return remainingFeeAfterCredits The fee amount still remaining after applying credits.
     * @return creditsActuallyUsed The amount of credits actually used.
     */
    function applyCredits(
        StorageLib.AppStorage storage ds, 
        address wallet, 
        uint256 feeToCover
    ) internal returns (uint256 remainingFeeAfterCredits, uint256 creditsActuallyUsed) {
        ensureProfileExistsForWrite(ds, wallet);
        StorageLib.IncentiveCredits storage credits = ds.incentiveCredits[wallet];
        
        if (credits.amount == 0 || feeToCover == 0) {
            return (feeToCover, 0);
        }

        if (credits.amount >= feeToCover) {
            creditsActuallyUsed = feeToCover;
            credits.amount -= feeToCover;
            remainingFeeAfterCredits = 0;
        } else {
            creditsActuallyUsed = credits.amount;
            remainingFeeAfterCredits = feeToCover - credits.amount;
            credits.amount = 0;
        }
        
        if (creditsActuallyUsed > 0) {
            credits.lastUpdated = block.timestamp;
        }
        
        return (remainingFeeAfterCredits, creditsActuallyUsed);
    }
    
    // --- Rolling Average Functions ---
    
    /**
     * @notice Updates the sender's rolling average transaction amount.
     * @dev Resets if the inactivity period has passed since the last update.
     * @param ds The application's shared storage.
     * @param wallet The sender's address.
     * @param amount The amount of the current transaction.
     */
    function updateRollingAverage(
        StorageLib.AppStorage storage ds, 
        address wallet, 
        uint256 amount
    ) internal {
        ensureProfileExistsForWrite(ds, wallet);
        StorageLib.RollingAverage storage avg = ds.rollingAverages[wallet];
        
        // Check for inactivity and reset rolling average if period exceeded.
        if (avg.lastUpdated > 0 && block.timestamp - avg.lastUpdated > ds.inactivityResetPeriod) {
            avg.totalAmount = 0;
            avg.count = 0;
        }
        
        avg.totalAmount += amount;
        avg.count++;
        avg.lastUpdated = block.timestamp;
    }
    
    // --- Half-Life Calculation Functions ---
    
    /**
     * @notice Calculates an adaptive half-life duration for a transaction.
     * @dev The duration can be reduced based on transaction history between parties
     * and increased for unusually large transactions compared to sender's average.
     * Result is bounded by min/max half-life durations.
     * @param ds The application's shared storage.
     * @param sender The sender's address.
     * @param recipient The recipient's address.
     * @param amount The transaction amount.
     * @return The calculated adaptive half-life duration in seconds.
     */
    function calculateAdaptiveHalfLife(
        StorageLib.AppStorage storage ds,
        address sender,
        address recipient,
        uint256 amount
    ) internal view returns (uint256) {
        uint256 currentHalfLife = ds.halfLifeDuration; // Start with base duration.
        uint256 txCount = ds.transactionCountBetween[sender][recipient];

        // Reduce half-life based on transaction frequency (e.g., 10% reduction per tx, max 90%).
        if (txCount > 0) {
            uint256 reductionPercent = (txCount * 10 > 90) ? 90 : txCount * 10;
            currentHalfLife = currentHalfLife * (100 - reductionPercent) / 100;
        }

        StorageLib.RollingAverage storage avg = ds.rollingAverages[sender];
        // Increase half-life if transaction amount is significantly larger than sender's average.
        if (avg.count > 0 && avg.totalAmount > 0) {
            uint256 avgAmount = avg.totalAmount / avg.count;
            if (amount > avgAmount * 10 && avgAmount > 0) { // If amount is >10x average.
                uint256 doubledDuration = currentHalfLife * 2;
                if (currentHalfLife <= type(uint256).max / 2) { // Prevent overflow.
                    currentHalfLife = doubledDuration;
                } else {
                    currentHalfLife = type(uint256).max; // Cap at max uint256.
                }
            }
        }

        // Enforce global min/max half-life bounds.
        if (currentHalfLife < ds.minHalfLifeDuration) { 
            currentHalfLife = ds.minHalfLifeDuration; 
        } else if (currentHalfLife > ds.maxHalfLifeDuration) { 
            currentHalfLife = ds.maxHalfLifeDuration; 
        }
        
        return currentHalfLife;
    }

    /**
     * @notice Calculates KYC-based minimum half-life for non-KYC participants
     * @dev Implements piecewise linear algorithm: $1→5min, $100→39min, $10K→24hrs, $100K→48hrs, $1M→7days
     * @param ds The application's shared storage
     * @param sender The sender's address
     * @param recipient The recipient's address
     * @param usdValue The transaction amount in wei (18 decimals)
     * @return The minimum half-life duration in seconds (0 if both parties are KYC'd)
     */
    function calculateKycMinimumHalfLife(
        StorageLib.AppStorage storage ds,
        address sender,
        address recipient,
        uint256 usdValue
    ) internal view returns (uint256) {
        // If both parties are KYC'd, no minimum half-life
        if (ComplianceStatusLib.effectiveKycStatus(ds, sender) && ComplianceStatusLib.effectiveKycStatus(ds, recipient)) {
            return 0;
        }

        // Convert to dollar amount (assuming 18 decimals for usdValue)
        uint256 dollarAmount = usdValue / (10**18);
        
        // Handle edge case for amounts less than $1
        if (dollarAmount == 0) return 5 minutes;
        
        // Piecewise linear scaling based on transaction amount
        if (dollarAmount <= 1) {
            return 5 minutes; // $0-$1: 5 minutes
        }
        
        if (dollarAmount <= 100) {
            // $1-$100: 5min to 39min (logarithmic-like segment)
            // Linear approximation: 5 + (amount-1) * 34/99
            return 300 + ((dollarAmount - 1) * 2040) / 99; // 5min + scaled increase
        }
        
        if (dollarAmount <= 10000) {
            // $100-$10K: 39min to 24hrs (1440 minutes)
            // Linear segment: 39 + (amount-100) * 1401/9900
            return 2340 + ((dollarAmount - 100) * 84060) / 9900; // 39min base + scaled
        }
        
        if (dollarAmount <= 100000) {
            // $10K-$100K: 24hrs to 48hrs
            // Linear segment: 1440 + (amount-10000) * 1440/90000
            return 86400 + ((dollarAmount - 10000) * 86400) / 90000; // 24hrs base + scaled
        }
        
        if (dollarAmount <= 1000000) {
            // $100K-$1M: 48hrs to 7 days (10080 minutes)
            // Linear segment: 2880 + (amount-100000) * 4320/900000
            return 172800 + ((dollarAmount - 100000) * 432000) / 900000; // 48hrs base + scaled
        }
        
        return 604800; // 7 days maximum for $1M+
    }

    /**
     * @notice Calculates enhanced half-life combining adaptive and KYC minimum requirements
     * @dev Returns the maximum of adaptive half-life and KYC minimum half-life
     * @param ds The application's shared storage
     * @param sender The sender's address
     * @param recipient The recipient's address
     * @param amount The transaction amount
     * @return The final enhanced half-life duration in seconds
     */
    function calculateEnhancedHalfLife(
        StorageLib.AppStorage storage ds,
        address sender,
        address recipient,
        uint256 amount,
        uint256 usdValue,
        uint256 userMinLock
    ) internal view returns (uint256) {
        uint256 adaptiveHalfLife = calculateAdaptiveHalfLife(ds, sender, recipient, amount);
        uint256 kycMinimum = calculateKycMinimumHalfLife(ds, sender, recipient, usdValue);
        
        // Return the maximum of adaptive, KYC minimum, and user-requested minimum half-life
        uint256 systemMin = adaptiveHalfLife > kycMinimum ? adaptiveHalfLife : kycMinimum;
        return userMinLock > systemMin ? userMinLock : systemMin;
    }
    
    // --- KYC Status Caching Functions ---

    /**
     * @notice Gets cached KYC status for an address
     * @dev Returns cached value if still valid, otherwise returns last known value
     * @param ds The application's shared storage
     * @param user The user address to check
     * @return isValid Whether the user has valid KYC status
     */
    function getKycStatusCached(
        StorageLib.AppStorage storage ds,
        address user
    ) internal view returns (bool) {
        StorageLib.KycCache storage cache = ds.kycStatusCache[user];
        
        // Return cached value if still valid
        if (block.timestamp < cache.cacheExpiry && cache.lastChecked > 0) {
            return cache.isValid;
        }
        
        // M-3: Cache expired - return false (conservative default).
        // Stale data should NOT be treated as valid KYC. Callers should use
        // refreshKycCache() for state-changing paths to get fresh data.
        return false;
    }

    /**
     * @notice Refreshes KYC cache for a user by checking current status
     * @dev This is a state-changing function that updates the cache
     * @param ds The application's shared storage
     * @param user The user address to refresh
     * @return currentStatus The current KYC status
     */
    function refreshKycCache(
        StorageLib.AppStorage storage ds,
        address user
    ) internal returns (bool currentStatus) {
        // Check current KYC status from CustodianRegistry
        StorageLib.CustodyData storage data = ds._custodyInfo[user];
        currentStatus = (data.kycValidatedTimestamp > 0 && 
                        (data.kycExpiresTimestamp == 0 || data.kycExpiresTimestamp >= block.timestamp));
        
        // Update cache
        ds.kycStatusCache[user] = StorageLib.KycCache({
            isValid: currentStatus,
            lastChecked: block.timestamp,
            cacheExpiry: block.timestamp + ds.kycCacheDuration
        });
        
        return currentStatus;
    }

    /**
     * @notice Batch refresh KYC cache for multiple users
     * @dev Efficiently updates cache for multiple addresses
     * @param ds The application's shared storage
     * @param users Array of user addresses to refresh
     */
    function batchRefreshKycCache(
        StorageLib.AppStorage storage ds,
        address[] memory users
    ) internal {
        uint256 cacheDuration = ds.kycCacheDuration;
        uint256 currentTime = block.timestamp;
        
        for (uint256 i = 0; i < users.length; i++) {
            address user = users[i];
            StorageLib.CustodyData storage data = ds._custodyInfo[user];
            bool currentStatus = (data.kycValidatedTimestamp > 0 && 
                                (data.kycExpiresTimestamp == 0 || data.kycExpiresTimestamp >= currentTime));
            
            ds.kycStatusCache[user] = StorageLib.KycCache({
                isValid: currentStatus,
                lastChecked: currentTime,
                cacheExpiry: currentTime + cacheDuration
            });
        }
    }

    // --- Fee Distribution Functions ---
    
    /**
     * @notice Processes the collected fee by distributing incentive credits.
     * @dev Currently, 25% of the fee goes to the sender and 25% to the recipient as credits.
     * The remaining 50% implicitly goes to the treasury.
     * @param ds The application's shared storage.
     * @param sender The sender of the original transaction.
     * @param recipient The recipient of the original transaction.
     * @param totalFeeCollected The total fee amount that was collected for the transaction.
     */
    function processFee(
        StorageLib.AppStorage storage ds, 
        address sender, 
        address recipient, 
        uint256 totalFeeCollected
    ) internal {
        if (totalFeeCollected == 0) { return; }

        // Calculate the share of the fee to be distributed as incentive credits.
        uint256 creditShare = totalFeeCollected / 4; // 25% share for incentives.

        if (creditShare > 0) {
            // Ensure profiles exist before updating credits.
            ensureProfileExistsForWrite(ds, sender);
            ds.incentiveCredits[sender].amount += creditShare;
            ds.incentiveCredits[sender].lastUpdated = block.timestamp;

            ensureProfileExistsForWrite(ds, recipient);
            ds.incentiveCredits[recipient].amount += creditShare;
            ds.incentiveCredits[recipient].lastUpdated = block.timestamp;
        }
        // The remaining fee (50%) is implicitly kept by the treasury, as fees are transferred there.
    }
    // --- Ledger-Based Locking Functions ---

    /**
     * @notice Removes a pending transfer from the user's list by index.
     * @dev Uses swap-and-pop for O(1) removal. Deletes the mapping entry to refund gas.
     * @param ds The application's shared storage.
     * @param user The user address.
     * @param index The index in the pendingTransferIds array to remove.
     */
    function removePendingTransfer(StorageLib.AppStorage storage ds, address user, uint256 index) internal {
        bytes32[] storage ids = ds.pendingTransferIds[user];
        if (index >= ids.length) return; // Safety check

        bytes32 idToRemove = ids[index];
        
        // Swap with last element
        ids[index] = ids[ids.length - 1];
        ids.pop();
        
        // Clean up the mapping details to refund gas
        delete ds.pendingTransfers[idToRemove];
    }
}