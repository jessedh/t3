// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
// Removed: import { T3TokenCommonLogicFacet } from "./T3TokenCommonLogicFacet.sol";
// Removed: import { ERC20BaseFacet } from "./ERC20BaseFacet.sol"; // For decimals - decimals are now hardcoded in Lib
// Removed: import { RoleConstants } from "../lib/RoleConstants.sol";
// Removed: import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { T3FeeLib } from "../lib/T3FeeLib.sol"; // Import the new library

contract T3TokenFeeLogicFacet {
    // No 'using StorageLib for StorageLib.AppStorage;' needed if ds is only passed to library.
    // using EnumerableSet for EnumerableSet.AddressSet; // Only if EnumerableSet is directly used here.

    // All fee calculation logic has been consolidated into T3FeeLib for consistency

    /**
     * @notice Provides direct access to the fee tier thresholds stored in AppStorage.
     * @dev Useful for clients or other contracts to understand the current fee structure.
     * @return An array of uint256 representing the upper wei boundaries for each fee tier.
     */
    function getFeeTierThresholds() external view returns (uint256[] memory) {
        // Directly access storage as this is a simple read.
        return StorageLib.diamondStorage().feeTierThresholds; //
    }

    /**
     * @notice Provides direct access to the fee tier rates stored in AppStorage.
     * @dev Rates are provided in basis points, scaled by FEE_PRECISION_MULTIPLIER.
     * @return An array of uint256 representing the scaled BPS rates for each fee tier.
     */
    function getFeeTierRates() external view returns (uint256[] memory) {
        // Directly access storage.
        return StorageLib.diamondStorage().feeTierRatesBps; //
    }

    /**
     * @notice Estimates all details of a transfer fee without executing the transfer.
     * @dev Calls the centralized T3FeeLib.getFullFeeDetails to perform the calculation.
     * This ensures that fee estimation uses the exact same logic as actual transfers.
     * @param sender The address of the prospective sender.
     * @param recipient The address of the prospective recipient.
     * @param amountIntendedForRecipient The amount the recipient would receive, before fees.
     * @return details_ A struct (StorageLib.FeeDetails) containing a comprehensive breakdown
     * of all calculated fee components, including base fee, risk adjustments,
     * applied bounds, available credits, credits to apply, and the final fee after credits.
     */
    function estimateTransferFeeDetails(
        address sender,
        address recipient,
        uint256 amountIntendedForRecipient
    ) external view returns (StorageLib.FeeDetails memory details_) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        // Delegate the entire fee calculation and detail population to the T3FeeLib.
        // T3FeeLib.getFullFeeDetails handles all sub-calculations (base fee, risk, bounds, credit simulation).
        details_ = T3FeeLib.getFullFeeDetails(
            ds,
            sender,
            recipient,
            amountIntendedForRecipient
        );
        // The 'details_' struct is populated by the library call.
        // No further calculation or struct population is needed here.
        // Citations for lines [625-640] previously in this function are now covered by T3FeeLib's implementation.
    }
}