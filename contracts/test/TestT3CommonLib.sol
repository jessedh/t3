// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "../lib/T3CommonLib.sol";
import "../lib/StorageLib.sol";

/**
 * @title TestT3CommonLib
 * @dev A helper contract to test the internal functions of the T3CommonLib library.
 */
contract TestT3CommonLib {
    function testCalculateKycMinimumHalfLife(
        address sender,
        address recipient,
        uint256 usdValue
    ) external returns (uint256) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        return T3CommonLib.calculateKycMinimumHalfLife(ds, sender, recipient, usdValue);
    }

    function testCalculateEnhancedHalfLife(
        address sender,
        address recipient,
        uint256 amount,
        uint256 usdValue
    ) external returns (uint256) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        return T3CommonLib.calculateEnhancedHalfLife(ds, sender, recipient, amount, usdValue, 0);
    }

    function testCalculateAdaptiveHalfLife(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (uint256) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        return T3CommonLib.calculateAdaptiveHalfLife(ds, sender, recipient, amount);
    }

    function testRefreshKycCache(address user) external {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        T3CommonLib.refreshKycCache(ds, user);
    }

    function testSetKycCacheDuration(uint256 duration) external {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ds.kycCacheDuration = duration;
    }
}
