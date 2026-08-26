// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ReserveControlStorage } from "./ReserveControlStorage.sol";

/**
 * @title ReserveValuationLib
 * @notice Pure math library for reserve valuation calculations.
 *         All output values are in 18-decimal fixed point (T3-equivalent USD).
 *         No storage reads — callers supply all inputs.
 */
library ReserveValuationLib {

    error StalePrice(uint256 updatedAt, uint32 stalenessThreshold, uint256 currentTime);
    error StaleSettlement(uint256 settledAt, uint32 stalenessThreshold, uint256 currentTime);

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant PRICE_SCALE     = 1e18;

    /**
     * @notice Compute eligible collateral value for a quantity of reserve asset.
     *
     * Formula:
     *   eligible = normalize(quantity, decimals) * price / 1e18
     *              * collateralFactorBps / 10000
     *              * (10000 - haircutBps) / 10000
     *
     * @param quantity           Native-decimal token quantity
     * @param decimals           Decimals of the reserve asset
     * @param price              18-decimal price per unit
     * @param collateralFactorBps Collateral factor in basis points (0–10000)
     * @param haircutBps         Haircut in basis points (0–10000)
     * @return                   18-decimal eligible value
     */
    function eligibleValue(
        uint256 quantity,
        uint8 decimals,
        uint256 price,
        uint16 collateralFactorBps,
        uint16 haircutBps
    ) internal pure returns (uint256) {
        uint256 normalized = _normalize(quantity, decimals);
        uint256 value = (normalized * price) / PRICE_SCALE;
        value = (value * collateralFactorBps) / BPS_DENOMINATOR;
        value = (value * (BPS_DENOMINATOR - haircutBps)) / BPS_DENOMINATOR;
        return value;
    }

    /**
     * @notice Compute effective collateral value after subtracting encumbered quantity.
     *         Returns 0 if encumberedQuantity >= settledQuantity (saturating subtraction).
     *
     * @param settledQuantity    Confirmed custody quantity (native decimals)
     * @param encumberedQuantity Locked quantity (native decimals)
     * @param decimals           Decimals of the reserve asset
     * @param price              18-decimal price per unit
     * @param collateralFactorBps Collateral factor in basis points
     * @param haircutBps         Haircut in basis points
     * @return                   18-decimal effective value
     */
    function effectiveValue(
        uint256 settledQuantity,
        uint256 encumberedQuantity,
        uint8 decimals,
        uint256 price,
        uint16 collateralFactorBps,
        uint16 haircutBps
    ) internal pure returns (uint256) {
        if (encumberedQuantity >= settledQuantity) return 0;
        uint256 available = settledQuantity - encumberedQuantity;
        return eligibleValue(available, decimals, price, collateralFactorBps, haircutBps);
    }

    /**
     * @notice Revert if the oracle price is stale.
     * @param p AssetPrice storage reference
     */
    function assertNotStalePrice(
        ReserveControlStorage.AssetPrice storage p
    ) internal view {
        if (p.stalenessThreshold == 0) return;
        if (p.updatedAt == 0) return; // unset oracle → treat as never stale for now
        if (block.timestamp - p.updatedAt > p.stalenessThreshold) {
            revert StalePrice(p.updatedAt, p.stalenessThreshold, block.timestamp);
        }
    }

    /**
     * @notice Revert if the custody settlement record is stale.
     */
    function assertNotStaleSettlement(
        uint256 custodySettledAt,
        uint32 stalenessThreshold
    ) internal view {
        if (stalenessThreshold == 0 || custodySettledAt == 0) return;
        if (block.timestamp - custodySettledAt > stalenessThreshold) {
            revert StaleSettlement(custodySettledAt, stalenessThreshold, block.timestamp);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Normalize quantity from native decimals to 18 decimals.
    function _normalize(uint256 quantity, uint8 decimals) internal pure returns (uint256) {
        if (decimals == 18) return quantity;
        if (decimals < 18) return quantity * (10 ** (18 - decimals));
        return quantity / (10 ** (decimals - 18));
    }
}
