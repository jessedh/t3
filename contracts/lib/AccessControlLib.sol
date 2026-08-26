// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "./StorageLib.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { RoleConstants } from "./RoleConstants.sol";

library AccessControlLib {
    using EnumerableSet for EnumerableSet.AddressSet;

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    function checkRole(bytes32 role, address account) internal view {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[role].contains(account)) {
            revert StorageLib.UnauthorizedRole(account, role);
        }
    }

    function hasRole(StorageLib.AppStorage storage ds, bytes32 role, address account) internal view returns (bool) {
        return ds._roles[role].contains(account);
    }

    function getRoleAdmin(bytes32 role) internal pure returns (bytes32) {
        // In OpenZeppelin's AccessControl, DEFAULT_ADMIN_ROLE is the admin for all other roles
        // unless explicitly set otherwise.
        if (role == RoleConstants.DEFAULT_ADMIN_ROLE) {
            return RoleConstants.DEFAULT_ADMIN_ROLE; // Admin of DEFAULT_ADMIN_ROLE is itself
        }
        return RoleConstants.DEFAULT_ADMIN_ROLE;
    }

    function requireRoleAdmin(StorageLib.AppStorage storage ds, bytes32 role, address account) internal view {
        bytes32 adminRole = getRoleAdmin(role);
        checkRole(adminRole, account);
    }

    function grantRole(StorageLib.AppStorage storage ds, bytes32 role, address account) internal {
        if (!ds._roles[role].contains(account)) {
            ds._roles[role].add(account);
            emit RoleGranted(role, account, msg.sender);
        }
    }

    function revokeRole(StorageLib.AppStorage storage ds, bytes32 role, address account) internal {
        if (ds._roles[role].contains(account)) {
            ds._roles[role].remove(account);
            emit RoleRevoked(role, account, msg.sender);
        }
    }

    function requireRole(StorageLib.AppStorage storage ds, bytes32 role, address account) internal view {
        checkRole(role, account);
    }

    function requireSenderRole(StorageLib.AppStorage storage ds, bytes32 role) internal view {
        checkRole(role, msg.sender);
    }
}