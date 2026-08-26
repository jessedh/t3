// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IComplianceGate {
    function enforceCompliance(address from, address to, uint256 amount, uint8 ctx) external view;

    function complianceCheck(
        address from,
        address to,
        uint256 amount,
        uint8 ctx
    ) external view returns (bool ok, address failingParty, bytes32 reasonCode);
}
