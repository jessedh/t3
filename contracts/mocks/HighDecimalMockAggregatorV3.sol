// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title HighDecimalMockAggregatorV3
 * @dev Mock aggregator with non-standard decimals for testing decimal conversion
 */
contract HighDecimalMockAggregatorV3 {
    function decimals() external pure returns (uint8) {
        return 18; // High precision
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        // Return price with 18 decimals (1 USD = 1e18)
        return (1, 1000000000000000000, block.timestamp, block.timestamp, 1);
    }
}