// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

// Simple interface for the mint/burn functions we need to test
interface IT3TokenMintBurn {
    function mint(address recipient, uint256 amount) external;
}

contract MintReentrancyAttacker {
    IT3TokenMintBurn public token;
    address public owner;

    constructor(address tokenAddress) {
        token = IT3TokenMintBurn(tokenAddress);
        owner = msg.sender;
    }

    function attemptMintReentrancy(address to, uint256 amount) public {
        token.mint(to, amount);
    }

    receive() external payable {
        if (address(token).balance > 0) {
            token.mint(owner, 1);
        }
    }
}
