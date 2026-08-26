// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ComplexReentrancy {
    IERC20 public token;
    address public owner;

    constructor(address tokenAddress) {
        token = IERC20(tokenAddress);
        owner = msg.sender;
    }

    function attemptComplexReentrancy(address to, uint256 amount) public {
        token.transfer(to, amount);
    }

    function anotherFunction() public {
        // This function is called during the reentrancy attack
    }

    receive() external payable {
        if (address(token).balance > 0) {
            this.anotherFunction();
            token.transfer(owner, address(token).balance);
        }
    }
}
