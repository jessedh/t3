// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title AggregatorV3Interface
 * @dev Mock interface to avoid external dependency
 */
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function version() external view returns (uint256);
    function getRoundData(uint80 _roundId) external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

/**
 * @title MockAggregatorV3
 * @dev Mock implementation of Chainlink's AggregatorV3Interface for testing
 */
contract MockAggregatorV3 is AggregatorV3Interface {
    uint8 private _decimals;
    string private _description;
    uint256 private _version;
    
    int256 private _latestAnswer;
    uint256 private _latestTimestamp;
    uint80 private _latestRound;
    
    mapping(uint80 => int256) private _answers;
    mapping(uint80 => uint256) private _timestamps;
    mapping(uint80 => uint80) private _startedAts;
    
    constructor(
        uint8 decimals_,
        string memory description_,
        uint256 version_,
        int256 initialAnswer
    ) {
        _decimals = decimals_;
        _description = description_;
        _version = version_;
        _latestAnswer = initialAnswer;
        _latestTimestamp = block.timestamp;
        _latestRound = 1;
        
        _answers[1] = initialAnswer;
        _timestamps[1] = block.timestamp;
        _startedAts[1] = 1;
    }
    
    function decimals() external view override returns (uint8) {
        return _decimals;
    }
    
    function description() external view override returns (string memory) {
        return _description;
    }
    
    function version() external view override returns (uint256) {
        return _version;
    }
    
    function getRoundData(uint80 _roundId) external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (
            _roundId,
            _answers[_roundId],
            _startedAts[_roundId],
            _timestamps[_roundId],
            _roundId
        );
    }
    
    function latestRoundData() external view override returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (
            _latestRound,
            _latestAnswer,
            _startedAts[_latestRound],
            _latestTimestamp,
            _latestRound
        );
    }
    
    // Test helper functions
    function setLatestAnswer(int256 answer) external {
        _latestRound++;
        _latestAnswer = answer;
        _latestTimestamp = block.timestamp;
        
        _answers[_latestRound] = answer;
        _timestamps[_latestRound] = block.timestamp;
        _startedAts[_latestRound] = _latestRound;
    }
    
    function setRoundData(
        uint80 roundId,
        int256 answer,
        uint256 timestamp,
        uint80 startedAt
    ) external {
        _answers[roundId] = answer;
        _timestamps[roundId] = timestamp;
        _startedAts[roundId] = startedAt;
    }
    
    function setLatestRoundData(
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) external {
        _latestRound = roundId;
        _latestAnswer = answer;
        _latestTimestamp = updatedAt;
        
        _answers[roundId] = answer;
        _timestamps[roundId] = updatedAt;
        _startedAts[roundId] = uint80(startedAt);
    }
}