// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";

/**
 * @title MockDiamondUpgradeInit
 * @dev Helper contract used in tests to validate diamond cut initializer execution.
 */
contract MockDiamondUpgradeInit {
    function init(uint256 newVersion) external {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ds.storageVersion = newVersion;
    }
}
