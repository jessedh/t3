// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IAccessControl {
    function hasRole(bytes32 role, address account) external view returns (bool);
    function grantRole(bytes32 role, address account) external; // Added
    function revokeRole(bytes32 role, address account) external; // Added
    // Add other functions like grantRole, revokeRole if you plan to call them
    // via an interface from other contracts/scripts, but for this specific fix,
    // hasRole is the main one needed for checks.
}