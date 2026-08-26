// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { ERC20PausableFacet } from "./ERC20PausableFacet.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { T3CommonLib } from "../lib/T3CommonLib.sol";

contract T3TokenPrefundedFeesFacet is ReentrancyGuardBase {
    using StorageLib for StorageLib.AppStorage;
    using EnumerableSet for EnumerableSet.AddressSet;
    
    // Override the _checkRole function from ERC20PausableFacet
    function _checkRole(bytes32 role, address account) internal view {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[role].contains(account)) {
            revert StorageLib.UnauthorizedRole(account, role);
        }
    }
    
    function _internal_transfer(StorageLib.AppStorage storage ds, address sender, address recipient, uint256 amount) internal {
        // Use consolidated transfer logic from T3CommonLib
        T3CommonLib.internalTransfer(ds, sender, recipient, amount);
        // Emit event from this facet context
        emit ERC20BaseFacet.Transfer(sender, recipient, amount);
    }

    event FeePrefunded(address indexed user, uint256 amount);
    event PrefundedFeeWithdrawn(address indexed user, uint256 amount);
    event PrefundedFeeUsed(address indexed user, uint256 amountUsed); // Internal event, for T3TransferFacet to emit

    function prefundFees(uint256 amount) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (amount == 0) { revert StorageLib.PrefundAmountPositive(); }

        // Transfer tokens from sender to treasury address (as pre-funded fees)
        // The tokens are moved to treasury, and a credit is recorded for the user.
        _internal_transfer(ds, msg.sender, ds.treasuryAddress, amount);
        ds.prefundedFeeBalances[msg.sender] += amount;
        emit FeePrefunded(msg.sender, amount);
    }

    function withdrawPrefundedFees(uint256 amount) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (amount == 0) { revert StorageLib.WithdrawAmountPositive(); }

        if (ds.prefundedFeeBalances[msg.sender] < amount) {
            revert StorageLib.InsufficientPrefundedBalance();
        }
        ds.prefundedFeeBalances[msg.sender] -= amount;
        // Transfer tokens from treasury address back to sender
        _internal_transfer(ds, ds.treasuryAddress, msg.sender, amount);
        emit PrefundedFeeWithdrawn(msg.sender, amount);
    }

    function getPrefundedFeeBalance(address wallet) external view returns (uint256) {
        if (wallet == address(0)) { revert StorageLib.UserAddressZero(); }
        return StorageLib.diamondStorage().prefundedFeeBalances[wallet];
    }

    // Internal function for T3TokenTransferFacet to use prefunded fees
    function internal_usePrefundedFees(StorageLib.AppStorage storage ds, address user, uint256 amountToUse)
        internal returns (bool success, uint256 actuallyUsed)
    {
        if (amountToUse == 0) return (true, 0);
        uint256 prefundedBalance = ds.prefundedFeeBalances[user];
        if (prefundedBalance == 0) return (false, 0);

        actuallyUsed = amountToUse > prefundedBalance ? prefundedBalance : amountToUse;
        ds.prefundedFeeBalances[user] -= actuallyUsed;
        // The fee amount `actuallyUsed` is already in the treasury from the prefund operation.
        // No further transfer to treasury is needed here.
        // emit PrefundedFeeUsed(user, actuallyUsed); // T3TransferFacet can emit this
        return (true, actuallyUsed);
    }
}
