// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ReserveValuationLib } from "../lib/ReserveValuationLib.sol";
import { ReserveControlStorage } from "../lib/ReserveControlStorage.sol";

/// @dev Test harness exposing ReserveValuationLib pure functions for Hardhat tests.
contract ReserveValuationHarness {

    function eligibleValue(
        uint256 quantity,
        uint8 decimals,
        uint256 price,
        uint16 collateralFactorBps,
        uint16 haircutBps
    ) external pure returns (uint256) {
        return ReserveValuationLib.eligibleValue(quantity, decimals, price, collateralFactorBps, haircutBps);
    }

    function effectiveValue(
        uint256 settledQuantity,
        uint256 encumberedQuantity,
        uint8 decimals,
        uint256 price,
        uint16 collateralFactorBps,
        uint16 haircutBps
    ) external pure returns (uint256) {
        return ReserveValuationLib.effectiveValue(
            settledQuantity, encumberedQuantity, decimals, price, collateralFactorBps, haircutBps
        );
    }

    function setAssetPrice(uint256 assetType, uint256 price, uint32 stalenessThreshold) external {
        ReserveControlStorage.Layout storage rc = ReserveControlStorage.layout();
        rc.assetPrices[assetType] = ReserveControlStorage.AssetPrice({
            price: price,
            updatedAt: uint40(block.timestamp),
            stalenessThreshold: stalenessThreshold
        });
    }

    function checkNotStalePrice(uint256 assetType) external view {
        ReserveControlStorage.Layout storage rc = ReserveControlStorage.layout();
        ReserveValuationLib.assertNotStalePrice(rc.assetPrices[assetType]);
    }

    function checkNotStaleSettlement(uint256 custodySettledAt, uint32 stalenessThreshold) external view {
        ReserveValuationLib.assertNotStaleSettlement(custodySettledAt, stalenessThreshold);
    }
}
