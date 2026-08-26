// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title BrokenMockAggregatorV3
 * @dev Mock aggregator that fails validation for testing
 */
contract BrokenMockAggregatorV3 {
    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external pure returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        revert("Broken aggregator");
    }
}