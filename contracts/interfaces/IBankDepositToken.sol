// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";

interface IBankDepositToken {
    event DepositLedgerAdjusted(address indexed bank, int256 delta, uint256 newBalance);
    event DepositTokenStatsUpdated(address indexed bank, uint256 totalMinted, uint256 totalBurned);

    function getDepositAccount(address bank) external view returns (ConsortiumStorage.DepositTokenAccount memory);

    function adjustDepositBalance(address bank, int256 delta) external;

    function recordMintBurn(address bank, uint256 minted, uint256 burned) external;
}
