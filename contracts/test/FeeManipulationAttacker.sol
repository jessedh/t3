// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "../lib/StorageLib.sol";

// Simple interface for the fee logic functions we need to test
interface IT3TokenFeeLogic {
    function estimateTransferFeeDetails(
        address sender,
        address recipient,
        uint256 amountIntendedForRecipient
    ) external view returns (StorageLib.FeeDetails memory details_);
}

contract FeeManipulationAttacker {
    IT3TokenFeeLogic public token;
    address public owner;

    constructor(address tokenAddress) {
        token = IT3TokenFeeLogic(tokenAddress);
        owner = msg.sender;
    }

    function attemptFeeManipulation(address user, uint256 amount) public {
        token.estimateTransferFeeDetails(address(this), user, amount);
    }

    receive() external payable {
        // some logic to manipulate fees
    }
}
