// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MaliciousReentrancy {
    IERC20 public token;
    address public owner;

    constructor(address tokenAddress) {
        token = IERC20(tokenAddress);
        owner = msg.sender;
    }

    function attemptReentrancyAttack(address to, uint256 amount) public {
        token.transfer(to, amount);
    }

    receive() external payable {
        if (address(token).balance > 0) {
            token.transfer(owner, address(token).balance);
        }
    }
}
