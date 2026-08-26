// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "./StorageLib.sol";
import { RoleConstants } from "./RoleConstants.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title T3FeeLib
 * @notice Library for calculating T3 Token transaction fees.
 * @dev This library centralizes all fee calculation logic to ensure consistency
 * across different parts of the system (e.g., estimation and actual transfer).
 * It operates on the shared AppStorage provided by StorageLib.
 */
library T3FeeLib {
    using EnumerableSet for EnumerableSet.AddressSet;

    // --- Fee Structure Constants ---
    // Represents 100% or the denominator for basis points calculations.
    uint256 private constant BASIS_POINTS = 10000;
    // M-5: Maximum risk factor cap (500% = 50000 BPS) to prevent runaway fees
    uint256 private constant MAX_RISK_FACTOR_BPS = 50000;
    // Multiplier for fee rates to allow for finer precision (e.g., 0.1 bps).
    // If a rate is 1 bps, it's stored as 1 * 1000 = 1000.
    uint256 private constant FEE_PRECISION_MULTIPLIER = 1000;
    // Effective basis points considering the precision multiplier.
    // Used when applying rates that are already scaled by FEE_PRECISION_MULTIPLIER.
    uint256 private constant EFFECTIVE_BASIS_POINTS = BASIS_POINTS * FEE_PRECISION_MULTIPLIER;
    // uint256 private constant AMOUNT_RISK_TIER_MULTIPLIER = 10; // Not directly used in current core logic but available for extensions.

    /**
     * @notice Ensures that a wallet profile is considered to exist for view functions.
     * @dev This is a conceptual check. Actual profile creation with timestamp occurs in write operations.
     * Functions using this should handle cases where `creationTime` might be 0 if a profile truly doesn't exist.
     * @param ds The application's shared storage.
     * @param wallet The address of the wallet to check.
     */
    function _ensureProfileExistsView(StorageLib.AppStorage storage ds, address wallet) internal view {
        // No explicit action needed in view context as Solidity structs are zero-initialized.
        // Subsequent logic directly accesses ds.walletRiskProfiles[wallet] and should handle
        // default (zero) values appropriately (e.g., profile.creationTime == 0).
        if (wallet == address(0)) {
            // No profile for the zero address.
            return;
        }
        // WalletRiskProfile is accessed directly, e.g., ds.walletRiskProfiles[wallet].creationTime
    }

    /**
     * @notice Calculates the risk factor for a given wallet based on its profile.
     * @dev The risk factor starts at BASIS_POINTS (100%) and increases based on:
     * - Newness of the wallet (less than 7 days old).
     * - Recent reversals (less than 30 days ago).
     * - Total number of reversals.
     * - Number of flagged abnormal transactions.
     * @param ds The application's shared storage.
     * @param wallet The address of the wallet.
     * @return riskFactor_ The calculated risk factor in basis points (e.g., 11000 for 110%).
     */
    function calculateWalletRiskFactor(StorageLib.AppStorage storage ds, address wallet)
        internal
        view
        returns (uint256 riskFactor_)
    {
        // Ensure the profile is notionally acknowledged for view operations.
        _ensureProfileExistsView(ds, wallet);
        StorageLib.WalletRiskProfile storage profile = ds.walletRiskProfiles[wallet];

        // Start with a base risk factor of 100% (no adverse impact).
        riskFactor_ = BASIS_POINTS;

        // Penalty for very new wallets (e.g., less than 7 days old).
        if (profile.creationTime > 0 && block.timestamp - profile.creationTime < 7 days) {
            riskFactor_ += 5000; // Adds 50% to the risk factor.
        }

        // Penalty for recent transaction reversals (e.g., within the last 30 days).
        if (profile.lastReversal > 0 && block.timestamp - profile.lastReversal < 30 days) {
            riskFactor_ += 10000; // Adds 100% to the risk factor.
        }

        // Penalty based on the cumulative count of reversals.
        riskFactor_ += profile.reversalCount * 1000; // Adds 10% for each reversal.

        // Penalty based on the count of administratively flagged abnormal transactions.
        riskFactor_ += profile.abnormalTxCount * 500; // Adds 5% for each abnormal transaction.

        // M-5: Cap the maximum risk factor to prevent excessive fees.
        if (riskFactor_ > MAX_RISK_FACTOR_BPS) riskFactor_ = MAX_RISK_FACTOR_BPS;
    }

    /**
     * @notice Determines the applicable risk score for a transaction.
     * @dev It's the higher of the sender's and recipient's individual risk scores.
     * @param ds The application's shared storage.
     * @param sender The sender's address.
     * @param recipient The recipient's address.
     * @return senderScore_ Sender's calculated risk score.
     * @return recipientScore_ Recipient's calculated risk score.
     * @return applicableScore_ The higher score to be used for fee calculation.
     */
    function getApplicableRiskScore(
        StorageLib.AppStorage storage ds,
        address sender,
        address recipient
    )
        internal
        view
        returns (
            uint256 senderScore_,
            uint256 recipientScore_,
            uint256 applicableScore_
        )
    {
        senderScore_ = calculateWalletRiskFactor(ds, sender);
        recipientScore_ = calculateWalletRiskFactor(ds, recipient);
        applicableScore_ = senderScore_ > recipientScore_ ? senderScore_ : recipientScore_;
    }

    /**
     * @notice Calculates a risk scaler based on the transaction amount.
     * @dev Larger amounts might incur a higher risk scaler, up to a maximum.
     * The scaler itself is in basis points.
     * @param ds The application's shared storage.
     * @param amount The transaction amount.
     * @return The amount-based risk scaler in basis points.
     */
    function calculateAmountRiskScaler(StorageLib.AppStorage storage ds, uint256 amount)
        internal
        view
        returns (uint256)
    {
        if (amount == 0) {
            return 0; // No risk for zero amount.
        }

        // The number of decimals for the token (e.g., 18 for ETH-like tokens).
        // This is assumed to be static for the T3 token.
        uint8 tokenDecimals = 18;
        uint256 oneToken = 1 * (10**tokenDecimals);

        // Apply base risk scaler for amounts less than one full token unit.
        if (amount < oneToken) {
            return ds.baseRiskScalerBps;
        }
        // Apply a medium risk scaler for amounts between 1 and 100 tokens.
        // This is a simple tiered approach; a curve or more tiers could be used.
        if (amount < oneToken * 100) {
            return (ds.baseRiskScalerBps + ds.maxRiskScalerBps) / 2; // Mid-point scaler.
        }
        // Apply maximum risk scaler for large amounts (100 tokens or more).
        return ds.maxRiskScalerBps;
    }

    /**
     * @notice Calculates the base fee amount before risk adjustments and bounds.
     * @dev This uses a tiered fee structure. Different rates apply to different portions of the amount.
     * @param ds The application's shared storage.
     * @param amount The transaction amount.
     * @return totalBaseFee_ The calculated base fee.
     */
    function calculateBaseFeeAmount(StorageLib.AppStorage storage ds, uint256 amount)
        internal
        view
        returns (uint256 totalBaseFee_)
    {
        if (amount == 0) {
            return 0; // No fee for zero amount.
        }

        totalBaseFee_ = 0;
        uint256[] memory thresholds = ds.feeTierThresholds; // Wei thresholds for each tier.
        uint256[] memory ratesBps = ds.feeTierRatesBps; // Scaled BPS rates for each tier.

        // M-6: Accumulate weighted numerator across all tiers, divide once at end
        // to minimize per-tier truncation precision loss.
        uint256 accumulatedNumerator = 0;
        uint256 accumulatedAmount = 0; // Tracks the amount already processed through lower tiers.
        for (uint i = 0; i < thresholds.length; i++) {
            if (amount <= accumulatedAmount) {
                break;
            }

            uint256 tierUpperBoundary = thresholds[i];
            uint256 amountInThisTier;

            if (amount >= tierUpperBoundary) {
                amountInThisTier = tierUpperBoundary - accumulatedAmount;
            } else {
                amountInThisTier = amount - accumulatedAmount;
            }

            // Accumulate numerator (defer division to reduce precision loss)
            accumulatedNumerator += amountInThisTier * ratesBps[i];
            accumulatedAmount = tierUpperBoundary;

            if (amount < tierUpperBoundary) {
                break;
            }
        }

        // Single division at the end, rounding up for protocol's benefit
        if (accumulatedNumerator > 0) {
            totalBaseFee_ = (accumulatedNumerator + EFFECTIVE_BASIS_POINTS - 1) / EFFECTIVE_BASIS_POINTS;
        }
    }

    /**
     * @notice Calculates the full, detailed fee breakdown for a transfer.
     * @dev This is the main fee calculation function, incorporating base fees, risk adjustments,
     * bounds (min/max fee), and simulates the application of sender's incentive credits.
     * This function is pure calculation and does not mutate state.
     * @param ds The application's shared storage.
     * @param sender The sender's address.
     * @param recipient The recipient's address.
     * @param amountIntendedForRecipient The amount the recipient should receive.
     * @return details_ A struct containing all fee components.
     */
    function getFullFeeDetails(
        StorageLib.AppStorage storage ds,
        address sender,
        address recipient,
        uint256 amountIntendedForRecipient
    ) internal view returns (StorageLib.FeeDetails memory details_) {
        // --- Parameter Validation ---
        if (recipient == address(0)) {
            revert StorageLib.TransferToZeroAddress();
        }
        if (amountIntendedForRecipient == 0) {
            revert StorageLib.TransferAmountZero();
        }

        // --- Initialization ---
        details_.requestedAmount = amountIntendedForRecipient;

        // --- Fee Exemption Check ---
        if (ds._roles[RoleConstants.FEE_EXEMPT_ROLE].contains(sender) || 
            ds._roles[RoleConstants.FEE_EXEMPT_ROLE].contains(recipient)) {
            // If sender or recipient is exempt, all fee components remain 0.
            details_.netAmountToSendToRecipient = amountIntendedForRecipient;
            return details_;
        }

        // --- 1. Calculate Base Fee ---
        // The fee based on amount tiers, before any risk adjustments.
        details_.baseFeeAmount = calculateBaseFeeAmount(ds, amountIntendedForRecipient);

        // --- 2. Determine Risk Scores ---
        // Get individual risk scores for sender and recipient, and the higher applicable score.
        (
            details_.senderRiskScore,
            details_.recipientRiskScore,
            details_.applicableRiskScore
        ) = getApplicableRiskScore(ds, sender, recipient);

        // --- 3. Calculate Amount-Based Risk Scaler ---
        // A scaler that can increase the impact of risk for larger transaction amounts.
        details_.amountRiskScaler = calculateAmountRiskScaler(ds, amountIntendedForRecipient);

        // --- 4. Calculate Risk Impact ---
        // Determine how much the applicable risk score deviates from the baseline (100%).
        uint256 riskDeviationBps = details_.applicableRiskScore > BASIS_POINTS
            ? details_.applicableRiskScore - BASIS_POINTS
            : 0;
        // Apply the amount risk scaler to this deviation.
        details_.scaledRiskImpactBps = (riskDeviationBps * details_.amountRiskScaler) / BASIS_POINTS;
        // Final risk factor combines baseline risk with the scaled impact.
        details_.finalRiskFactorBps = BASIS_POINTS + details_.scaledRiskImpactBps;
        // Optional: Cap finalRiskFactorBps if necessary.
        // e.g., if (details_.finalRiskFactorBps > SOME_MAX_CAP_BPS) details_.finalRiskFactorBps = SOME_MAX_CAP_BPS;

        // --- 5. Calculate Fee Before Credits and Bounds ---
        // Apply the final risk factor to the base fee.
        details_.feeBeforeCreditsAndBounds =
            (details_.baseFeeAmount * details_.finalRiskFactorBps) /
            BASIS_POINTS;

        // --- 6. Apply Fee Bounds (Min and Max) ---
        // Maximum fee allowed, calculated as a percentage of the transaction amount.
        details_.maxFeeBound = (amountIntendedForRecipient * ds.maxFeePercentBps) / BASIS_POINTS;
        // Minimum fee Wei, a fixed value.
        details_.minFeeBound = ds.minFeeWei;

        details_.totalFeeAssessed = details_.feeBeforeCreditsAndBounds; // Start with the risk-adjusted fee.

        // Apply Maximum Fee Bound:
        // If calculated fee exceeds maxFeeBound, cap it at maxFeeBound (if maxFeeBound > 0).
        if (details_.maxFeeBound > 0 && details_.totalFeeAssessed > details_.maxFeeBound) {
            details_.totalFeeAssessed = details_.maxFeeBound;
            details_.maxFeeApplied = true;
        }

        // Apply Minimum Fee Bound:
        // If calculated fee is below minFeeBound, set it to minFeeBound,
        // provided minFeeBound is sensible (not exceeding amount or already applied max fee).
        if (details_.totalFeeAssessed < details_.minFeeBound && // Only if current fee is less than min
            details_.minFeeBound <= amountIntendedForRecipient && // Min fee cannot be more than the transaction amount itself.
            (!details_.maxFeeApplied || details_.minFeeBound <= details_.maxFeeBound) // Min fee cannot exceed an already applied max fee.
        ) {
            details_.totalFeeAssessed = details_.minFeeBound;
            details_.minFeeApplied = true;
            // If applying min fee made it equal to max fee, then max fee is also considered applied.
            if (details_.maxFeeApplied && details_.totalFeeAssessed != details_.maxFeeBound) {
                // This case should ideally not happen if logic is correct,
                // but defensively reset maxFeeApplied if minFee application changes the value from maxFeeBound.
                details_.maxFeeApplied = false;
            } else if (!details_.maxFeeApplied && details_.totalFeeAssessed == details_.maxFeeBound && details_.maxFeeBound > 0) {
                 details_.maxFeeApplied = true; // Min fee application resulted in hitting the max fee.
            }
        }


        // --- 7. Simulate Application of Incentive Credits (View-Only) ---
        // This part estimates how credits would apply without changing state.
        _ensureProfileExistsView(ds, sender); // Ensure sender profile is notionally considered.
        StorageLib.IncentiveCredits storage credits = ds.incentiveCredits[sender];
        details_.availableCredits = credits.amount;

        if (details_.availableCredits >= details_.totalFeeAssessed) {
            // Sender has enough credits to cover the entire fee.
            details_.creditsToApply = details_.totalFeeAssessed;
            details_.feeAfterCredits = 0; // No fee payable from balance/prefund.
        } else {
            // Sender has some credits, but not enough to cover the full fee.
            details_.creditsToApply = details_.availableCredits;
            details_.feeAfterCredits = details_.totalFeeAssessed - details_.availableCredits;
        }

        // --- 8. Determine Net Amount for Recipient ---
        // In the T3 model, the sender pays the fee, and the recipient gets the full intended amount.
        details_.netAmountToSendToRecipient = amountIntendedForRecipient;
    }
}