// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";

/**
 * @title ReentrancyGuardBase
 * @dev Cross-facet reentrancy guard using shared Diamond AppStorage.
 * This is a base-only helper (no external functions), not a facet.
 */
contract ReentrancyGuardBase {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    modifier nonReentrant() {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (ds._reentrancyMutex == _ENTERED) {
            revert("ReentrancyGuard: reentrant call");
        }
        ds._reentrancyMutex = _ENTERED;
        _;
        ds._reentrancyMutex = _NOT_ENTERED;
    }
}

