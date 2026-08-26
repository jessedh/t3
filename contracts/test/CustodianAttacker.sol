// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

// Simple interface for the custodian registry functions we need to test
interface ICustodianRegistry {
    function isCustodian(address account) external view returns (bool);
    function getCustodian(address userAddress) external view returns (address);
}

contract CustodianAttacker {
    ICustodianRegistry public registry;
    address public owner;

    constructor(address registryAddress) {
        registry = ICustodianRegistry(registryAddress);
        owner = msg.sender;
    }

    function attemptCustodianReentrancy(address user) public {
        registry.isCustodian(user);
    }

    receive() external payable {
        // some logic to attack custodian registry
    }
}
