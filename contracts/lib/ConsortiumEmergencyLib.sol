// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ConsortiumStorage } from "./ConsortiumStorage.sol";

/**
 * @title ConsortiumEmergencyLib
 * @notice Shared helpers/constants for consortium emergency pause controls.
 */
library ConsortiumEmergencyLib {
    bytes32 internal constant OP_PLEDGE = keccak256("CONSORTIUM_OP_PLEDGE");
    bytes32 internal constant OP_RELEASE = keccak256("CONSORTIUM_OP_RELEASE");
    bytes32 internal constant OP_MINT = keccak256("CONSORTIUM_OP_MINT");
    bytes32 internal constant OP_BURN = keccak256("CONSORTIUM_OP_BURN");
    bytes32 internal constant OP_YIELD = keccak256("CONSORTIUM_OP_YIELD");
    bytes32 internal constant OP_GOVERNANCE = keccak256("CONSORTIUM_OP_GOVERNANCE");

    error ConsortiumOperationPaused(bytes32 operation);

    function enforceOperationActive(bytes32 operation) internal view {
        if (ConsortiumStorage.layout().pausedOperations[operation]) {
            revert ConsortiumOperationPaused(operation);
        }
    }

    function isOperationPaused(bytes32 operation) internal view returns (bool) {
        return ConsortiumStorage.layout().pausedOperations[operation];
    }
}
