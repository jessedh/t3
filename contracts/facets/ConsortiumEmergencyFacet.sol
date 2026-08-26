// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";
import { ConsortiumEmergencyLib } from "../lib/ConsortiumEmergencyLib.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";

/**
 * @title ConsortiumEmergencyFacet
 * @notice Provides granular pause controls for consortium operations.
 */
contract ConsortiumEmergencyFacet {
    event OperationPaused(bytes32 indexed operation, address indexed actor);
    event OperationResumed(bytes32 indexed operation, address indexed actor);
    event EmergencyGuardianUpdated(address indexed guardian);

    modifier onlyAdmin() {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        _;
    }

    modifier onlyGuardian() {
        _requireGuardian(msg.sender);
        _;
    }

    function setEmergencyGuardian(address guardian) external onlyAdmin {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        require(guardian != address(0), "guardian zero");
        cs.emergencyGuardian = guardian;
        emit EmergencyGuardianUpdated(guardian);
    }

    function getEmergencyGuardian() external view returns (address) {
        return ConsortiumStorage.layout().emergencyGuardian;
    }

    function pauseOperation(bytes32 operation) external onlyGuardian {
        _pauseOperation(operation, msg.sender);
    }

    function pauseOperations(bytes32[] calldata operations) external onlyGuardian {
        for (uint256 i = 0; i < operations.length; i++) {
            _pauseOperation(operations[i], msg.sender);
        }
    }

    function resumeOperation(bytes32 operation) external onlyAdmin {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        require(cs.pausedOperations[operation], "operation not paused");
        cs.pausedOperations[operation] = false;
        emit OperationResumed(operation, msg.sender);
    }

    function isOperationPaused(bytes32 operation) external view returns (bool) {
        return ConsortiumEmergencyLib.isOperationPaused(operation);
    }

    function _pauseOperation(bytes32 operation, address actor) internal {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        require(!cs.pausedOperations[operation], "operation already paused");
        cs.pausedOperations[operation] = true;
        emit OperationPaused(operation, actor);
    }

    function _requireGuardian(address actor) internal view {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        if (actor == cs.emergencyGuardian) {
            return;
        }
        if (AccessControlLib.hasRole(StorageLib.diamondStorage(), RoleConstants.EMERGENCY_COORDINATOR_ROLE, actor)) {
            return;
        }
        revert("not guardian");
    }
}
