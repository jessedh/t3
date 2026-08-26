// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { SponsorBankStorage } from "./SponsorBankStorage.sol";
import { StorageLib } from "./StorageLib.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title DistributionCalculationLib
 * @dev Library for calculating pro-rata distributions and fee breakdowns
 * @notice Handles complex distribution mathematics with precision and validation
 */
library DistributionCalculationLib {
    using SponsorBankStorage for SponsorBankStorage.Storage;
    using SafeERC20 for IERC20;

    struct CalculationResult {
        address[] recipients;
        uint256[] amounts;
        uint256 sponsorBankFee;
        uint256 kycBankFees;
        uint256 totalDistributed;
        uint256 dustAmount;
    }

    struct ValidationParams {
        uint256 totalAmount;
        uint256 totalShares;
        uint256 sponsorFeeRate;
        uint256 kycFeeRate;
        bool requiresPrecisionCheck;
    }

    error InvalidDistributionAmount();
    error InvalidTotalShares();
    error DistributionValidationFailed();
    error InsufficientAmountForFees();
    error PrecisionLossDetected();

    /**
     * @notice Calculate pro-rata distribution with fee deductions
     * @param distributionId The distribution to calculate for
     * @param totalAmount Total amount to distribute
     * @param totalShares Total shares across all recipients
     * @return result Complete calculation result with recipients and amounts
     */
    function calculateProRataDistribution(
        bytes32 distributionId,
        uint256 totalAmount,
        uint256 totalShares
    ) internal view returns (CalculationResult memory result) {
        
        if (totalAmount == 0) revert InvalidDistributionAmount();
        if (totalShares == 0) revert InvalidTotalShares();
        
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        SponsorBankStorage.Distribution storage distribution = s.distributions[distributionId];
        
        // Get bank information for fee calculation
        SponsorBankStorage.SponsorBank storage bank = s.banks[distribution.sponsor];
        
        // Calculate fees
        result.sponsorBankFee = (totalAmount * bank.feeRate) / 10000;
        result.kycBankFees = (totalAmount * s.globalKYCFeeRate) / 10000;
        
        // Validate sufficient amount after fees
        uint256 totalFees = result.sponsorBankFee + result.kycBankFees;
        if (totalAmount <= totalFees) revert InsufficientAmountForFees();
        
        uint256 netDistribution = totalAmount - totalFees;
        result.totalDistributed = netDistribution;
        
        // Get recipients and their shares
        (address[] memory recipients, uint256[] memory shares) = getRegisteredWallets(distributionId);
        
        result.recipients = recipients;
        result.amounts = new uint256[](recipients.length);
        
        // Calculate pro-rata amounts
        uint256 distributedSum = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            result.amounts[i] = (netDistribution * shares[i]) / totalShares;
            distributedSum += result.amounts[i];
        }
        
        // Handle dust (rounding differences)
        result.dustAmount = netDistribution - distributedSum;
        
        // Distribute dust to the first recipient if any
        if (result.dustAmount > 0 && recipients.length > 0) {
            result.amounts[0] += result.dustAmount;
            result.dustAmount = 0;
        }
        
        return result;
    }

    /**
     * @notice Validate distribution integrity and precision
     * @param amounts Array of distribution amounts
     * @param expectedTotal Expected total distribution amount
     * @param precision Precision tolerance (e.g., 1000000 for 0.0001% tolerance)
     * @return isValid True if distribution is valid within tolerance
     */
    function validateDistributionIntegrity(
        uint256[] memory amounts,
        uint256 expectedTotal,
        uint256 precision
    ) internal pure returns (bool isValid) {
        
        uint256 calculatedTotal = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            calculatedTotal += amounts[i];
        }
        
        // Allow for small rounding errors within precision tolerance
        uint256 tolerance = expectedTotal / precision;
        return (calculatedTotal >= expectedTotal - tolerance && 
                calculatedTotal <= expectedTotal + tolerance);
    }

    /**
     * @notice Execute the actual token distribution
     * @param distributionId The distribution to execute
     * @param totalAmount Total amount being distributed
     * @param distributionToken Token contract address
     * @return totalDistributed Total amount successfully distributed
     */
    function executeDistribution(
        bytes32 distributionId,
        uint256 totalAmount,
        address distributionToken
    ) internal returns (uint256 totalDistributed) {
        
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        SponsorBankStorage.Distribution storage distribution = s.distributions[distributionId];
        
        // Get total shares for this distribution
        uint256 totalShares = getTotalShares(distributionId);
        
        // Calculate distribution
        CalculationResult memory result = calculateProRataDistribution(
            distributionId, 
            totalAmount, 
            totalShares
        );
        
        // Validate distribution integrity
        if (!validateDistributionIntegrity(result.amounts, result.totalDistributed, 1000000)) {
            revert DistributionValidationFailed();
        }
        
        IERC20 token = IERC20(distributionToken);
        address sponsor = distribution.sponsor;
        
        // Distribute directly from sponsor to recipients to avoid T3Token business rule conflicts
        // This bypasses the diamond contract holding tokens and making multiple transfers
        totalDistributed = 0;
        for (uint256 i = 0; i < result.recipients.length; i++) {
            address recipient = result.recipients[i];
            uint256 amount = result.amounts[i];
            
            if (amount > 0) {
                token.safeTransferFrom(sponsor, recipient, amount);
                totalDistributed += amount;
                
                // Record for tax reporting
                recordTaxableDistribution(recipient, amount, distributionToken);
            }
        }
        
        // Transfer fees to this contract (diamond) for later fee distribution
        if (result.sponsorBankFee > 0 || result.kycBankFees > 0) {
            uint256 totalFees = result.sponsorBankFee + result.kycBankFees;
            token.safeTransferFrom(sponsor, address(this), totalFees);
        }
        
        // Store fee amounts for later distribution
        distribution.sponsorFee = result.sponsorBankFee;
        distribution.kycBankFees = result.kycBankFees;
        
        // Keep fees in contract for later claim by banks
        // The remaining tokens (fees) stay in the contract
        
        return totalDistributed;
    }

    /**
     * @notice Get registered wallets and their shares for a distribution
     * @param distributionId The distribution to query
     * @return recipients Array of wallet addresses
     * @return shares Array of corresponding share amounts
     */
    function getRegisteredWallets(bytes32 distributionId) 
        internal view returns (address[] memory recipients, uint256[] memory shares) {
        
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        SponsorBankStorage.Distribution storage distribution = s.distributions[distributionId];
        
        recipients = distribution.recipients;
        shares = new uint256[](recipients.length);
        
        for (uint256 i = 0; i < recipients.length; i++) {
            shares[i] = distribution.walletShares[recipients[i]];
        }
        
        return (recipients, shares);
    }

    /**
     * @notice Get total shares for a distribution
     * @param distributionId The distribution to query
     * @return totalShares Sum of all wallet shares
     */
    function getTotalShares(bytes32 distributionId) internal view returns (uint256 totalShares) {
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        SponsorBankStorage.Distribution storage distribution = s.distributions[distributionId];
        
        address[] memory recipients = distribution.recipients;
        totalShares = 0;
        
        for (uint256 i = 0; i < recipients.length; i++) {
            totalShares += distribution.walletShares[recipients[i]];
        }
        
        return totalShares;
    }

    /**
     * @notice Get sponsor bank for a distribution
     * @param distributionId The distribution to query
     * @return bank The sponsor bank information
     */
    function getSponsorBankForDistribution(bytes32 distributionId) 
        internal view returns (SponsorBankStorage.SponsorBank storage bank) {
        
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        address sponsor = s.distributions[distributionId].sponsor;
        return s.banks[sponsor];
    }

    /**
     * @notice Record taxable distribution for compliance
     * @param recipient The recipient of the distribution
     * @param amount The amount distributed
     * @param token The token that was distributed
     */
    function recordTaxableDistribution(
        address recipient,
        uint256 amount,
        address token
    ) internal {
        // This would integrate with the tax reporting system
        // For now, we emit an event for tracking
        // In Phase 4, this would call TaxReportingFacet
        
        // TODO: Implement proper tax recording integration
        // emit TaxableDistributionRecorded(recipient, amount, token, block.timestamp);
    }

    /**
     * @notice Calculate fees for a given amount and bank
     * @param bankAddress The sponsor bank address
     * @param amount The distribution amount
     * @return sponsorFee Fee for the sponsor bank
     * @return kycFee Fee for KYC banks
     * @return netAmount Amount after all fees
     */
    function calculateFees(
        address bankAddress,
        uint256 amount
    ) internal view returns (uint256 sponsorFee, uint256 kycFee, uint256 netAmount) {
        
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        SponsorBankStorage.SponsorBank storage bank = s.banks[bankAddress];
        
        sponsorFee = (amount * bank.feeRate) / 10000;
        kycFee = (amount * s.globalKYCFeeRate) / 10000;
        netAmount = amount - sponsorFee - kycFee;
        
        return (sponsorFee, kycFee, netAmount);
    }

    /**
     * @notice Optimize distribution calculation for gas efficiency
     * @param distributionId The distribution to optimize
     * @return gasEstimate Estimated gas cost for execution
     * @return canOptimize True if batch optimization is possible
     */
    function optimizeDistributionGas(bytes32 distributionId) 
        internal view returns (uint256 gasEstimate, bool canOptimize) {
        
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        SponsorBankStorage.Distribution storage distribution = s.distributions[distributionId];
        
        uint256 recipientCount = distribution.recipients.length;
        
        // Base gas cost + per-recipient cost
        gasEstimate = 50000 + (recipientCount * 25000);
        
        // Can optimize if batch size is within limits
        canOptimize = recipientCount <= s.maxBatchSize;
        
        return (gasEstimate, canOptimize);
    }
}