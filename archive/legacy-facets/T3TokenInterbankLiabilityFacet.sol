// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { AccessControlFacet } from "./AccessControlFacet.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { ERC20PausableFacet } from "./ERC20PausableFacet.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";


contract T3TokenInterbankLiabilityFacet is ReentrancyGuardBase, ERC20PausableFacet {
    using StorageLib for StorageLib.AppStorage;
    using EnumerableSet for EnumerableSet.AddressSet;
    
    // Internal function to check role that doesn't rely on static call
    function _checkRole(bytes32 role, address account) internal view override {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[role].contains(account)) {
            revert StorageLib.UnauthorizedRole(account, role);
        }
    }

    event InterbankLiabilityRecorded(address indexed debtor, address indexed creditor, uint256 amount);
    event InterbankLiabilityCleared(address indexed debtor, address indexed creditor, uint256 amountCleared);

    function recordInterbankLiability(address debtor, address creditor, uint256 amount) external nonReentrant whenNotPaused {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _checkRole(RoleConstants.ADMIN_ROLE, msg.sender);

        WalletRecoveryStorage.Layout storage _ws = WalletRecoveryStorage.layout();
        if (_ws.activeRecoveryCount[debtor] > 0) revert IWalletRecovery.WalletInRecovery(debtor);
        if (_ws.activeRecoveryCount[creditor] > 0) revert IWalletRecovery.WalletInRecovery(creditor);

        if (debtor == address(0)) { revert StorageLib.DebtorCannotBeZeroAddress(); }
        if (creditor == address(0)) { revert StorageLib.CreditorCannotBeZeroAddress(); }
        if (debtor == creditor) { revert StorageLib.DebtorCannotBeCreditor(); }
        if (amount == 0) { revert StorageLib.AmountMustBePositive(); }

        ds.interbankLiabilities[debtor][creditor] += amount;
        emit InterbankLiabilityRecorded(debtor, creditor, amount);
    }

    function clearInterbankLiability(address debtor, address creditor, uint256 amountToClear) external nonReentrant whenNotPaused {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _checkRole(RoleConstants.ADMIN_ROLE, msg.sender);

        if (debtor == address(0)) { revert StorageLib.DebtorCannotBeZeroAddress(); }
        if (creditor == address(0)) { revert StorageLib.CreditorCannotBeZeroAddress(); }
        if (debtor == creditor) { revert StorageLib.DebtorCannotBeCreditor(); }
        if (amountToClear == 0) { revert StorageLib.AmountMustBePositive(); }

        uint256 currentLiability = ds.interbankLiabilities[debtor][creditor];
        if (amountToClear > currentLiability) {
            revert StorageLib.AmountToClearExceedsOutstandingLiability();
        }
        ds.interbankLiabilities[debtor][creditor] = currentLiability - amountToClear;
        emit InterbankLiabilityCleared(debtor, creditor, amountToClear);
    }

    function getInterbankLiability(address debtor, address creditor) external view returns (uint256) {
        return StorageLib.diamondStorage().interbankLiabilities[debtor][creditor];
    }

    function getNetInterbankLiability(address bank1, address bank2) external view returns (int256 netLiabilityBank1ToBank2) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        uint256 liabilityBank1To2 = ds.interbankLiabilities[bank1][bank2];
        uint256 liabilityBank2To1 = ds.interbankLiabilities[bank2][bank1];

        // Positive means bank1 owes bank2, negative means bank2 owes bank1
        return int256(liabilityBank1To2) - int256(liabilityBank2To1);
    }
}
