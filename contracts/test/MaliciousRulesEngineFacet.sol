// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MaliciousRulesEngineFacet {
    IERC20 public token;

    event Attack(address from, address to, uint256 amount);

    constructor(address _tokenAddress) {
        token = IERC20(_tokenAddress);
    }

    function beforeTransferCheck(
        address from,
        address to,
        uint256 amount,
        bytes calldata data,
        bytes32[] calldata allowProof,
        bytes32[] calldata denyProof
    ) external returns (uint16 score, uint8 action) {
        emit Attack(from, to, amount);
        // Re-enter the token contract
        token.transfer(to, amount);
        return (0, 0);
    }
}