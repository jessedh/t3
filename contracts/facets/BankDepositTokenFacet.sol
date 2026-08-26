// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { IssuanceControlStorage } from "../lib/IssuanceControlStorage.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";

/**
 * @title BankDepositTokenFacet
 * @notice Lightweight ledger for per-bank deposit token accounting.
 */
contract BankDepositTokenFacet {
    event DepositLedgerAdjusted(address indexed bank, int256 delta, uint256 newBalance);
    event DepositTokenStatsUpdated(address indexed bank, uint256 totalMinted, uint256 totalBurned);

    modifier onlyDepositController() {
        AccessControlLib.checkRole(RoleConstants.DEPOSIT_TOKEN_ISSUER_ROLE, msg.sender);
        _;
    }

    function _requireNotInRecovery(address wallet) private view {
        if (WalletRecoveryStorage.layout().activeRecoveryCount[wallet] > 0) {
            revert IWalletRecovery.WalletInRecovery(wallet);
        }
    }

    function getDepositAccount(address bank) external view returns (ConsortiumStorage.DepositTokenAccount memory) {
        return ConsortiumStorage.layout().depositAccounts[bank];
    }

    function adjustDepositBalance(address bank, int256 delta) external onlyDepositController {
        IssuanceControlStorage.requireUnlocked();
        _requireNotInRecovery(bank);
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        ConsortiumStorage.DepositTokenAccount storage account = cs.depositAccounts[bank];
        if (delta >= 0) {
            uint256 increase = uint256(delta);
            account.totalDeposits += increase;
            cs.aggregateDepositBalance += increase;
        } else {
            uint256 decrease = uint256(-delta);
            uint256 outstanding = _getOutstandingMinted(account);
            require(account.totalDeposits >= decrease, "ledger underflow");
            require(account.totalDeposits - decrease >= outstanding, "insufficient collateral");
            account.totalDeposits -= decrease;
            require(cs.aggregateDepositBalance >= decrease, "aggregate underflow");
            cs.aggregateDepositBalance -= decrease;
        }
        emit DepositLedgerAdjusted(bank, delta, account.totalDeposits);
    }

    function recordMintBurn(address bank, uint256 minted, uint256 burned) external onlyDepositController {
        IssuanceControlStorage.requireUnlocked();
        _requireNotInRecovery(bank);
        ConsortiumStorage.DepositTokenAccount storage account = ConsortiumStorage.layout().depositAccounts[bank];
        if (minted > 0) {
            account.totalMinted += minted;
        }
        if (burned > 0) {
            account.totalBurned += burned;
        }
        emit DepositTokenStatsUpdated(bank, account.totalMinted, account.totalBurned);
    }

    function _getOutstandingMinted(ConsortiumStorage.DepositTokenAccount storage account) internal view returns (uint256) {
        return account.totalMinted > account.totalBurned ? account.totalMinted - account.totalBurned : 0;
    }
}
