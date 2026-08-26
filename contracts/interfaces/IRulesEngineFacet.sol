// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title IRulesEngineFacet
 * @notice Minimal interface for RulesEngineFacet cross-facet calls.
 */
interface IRulesEngineFacet {
    enum Action { ALLOW, WARN, DENY }

    function beforeTransferCheck(
        address from,
        address to,
        uint256 amount,
        bytes calldata data,
        bytes32[] calldata allowProof,
        bytes32[] calldata denyProof
    ) external returns (uint16 score, uint8 action);

    function postTransferUpdate(address from, address to, uint256 amount) external;
}
