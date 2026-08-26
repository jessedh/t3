// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

// This is the interface the mock needs to implement for the test.
interface IRewardsEscrow {
    function addReward(address user, uint256 amount) external;
}

contract MockRewardsEscrow is AccessControl, IRewardsEscrow {
    bytes32 public constant T3TOKEN_ROLE = keccak256("T3TOKEN_ROLE");

    address public t3TokenDiamond;
    address public rewardsToken;
    address public treasury;

    event RewardAdded(address indexed user, uint256 amount);

    constructor(address _t3Token, address _rewardsToken, address _treasury, address _admin) {
        t3TokenDiamond = _t3Token;
        rewardsToken = _rewardsToken;
        treasury = _treasury;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    function addReward(address user, uint256 amount) external override {
        require(hasRole(T3TOKEN_ROLE, msg.sender), "MockRewardsEscrow: Caller is not the T3Token contract");
        emit RewardAdded(user, amount);
    }

    // Helper function to grant the T3TOKEN_ROLE for testing purposes, callable by admin.
    function grantT3TokenRole(address _t3TokenAddress) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "MockRewardsEscrow: Caller is not an admin");
        _grantRole(T3TOKEN_ROLE, _t3TokenAddress);
    }
}
