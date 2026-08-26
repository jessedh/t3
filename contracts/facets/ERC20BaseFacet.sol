// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { ClaimAttributionStorage } from "../lib/ClaimAttributionStorage.sol";
import { IssuanceControlStorage } from "../lib/IssuanceControlStorage.sol";
import { IssuanceAccountingLib } from "../lib/IssuanceAccountingLib.sol";

contract ERC20BaseFacet {
    
    /**
     * @notice Extracts the original sender from meta-transaction or returns msg.sender
     * @dev This is the core ERC-2771 functionality. When called via trusted forwarder,
     * the original sender is extracted from the last 20 bytes of calldata.
     * @return sender The original transaction sender
     */
    function _msgSender() internal view returns (address sender) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (ds.trustedForwarder != address(0) && msg.sender == ds.trustedForwarder && msg.data.length >= 20) {
            // Extract sender from the last 20 bytes of calldata (ERC-2771 standard)
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    // Note: ERC165 interface support moved to unified ERC165Facet

    function name() external view returns (string memory) {
        return StorageLib.diamondStorage()._name;
    }

    function symbol() external view returns (string memory) {
        return StorageLib.diamondStorage()._symbol;
    }

    function decimals() external pure returns (uint8) {
        return 18;
    }

    function totalSupply() external view returns (uint256) {
        return StorageLib.diamondStorage()._totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        if (account == address(0)) { revert StorageLib.TransferToZeroAddress(); }
        return StorageLib.diamondStorage()._balances[account];
    }

    // transfer() function removed - implemented in T3TokenTransferFacet with T3 logic

    function allowance(address owner, address spender) external view returns (uint256) {
        return StorageLib.diamondStorage()._allowances[owner][spender];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        internal_approve(StorageLib.diamondStorage(), _msgSender(), spender, amount);
        return true;
    }

    // transferFrom() function removed - implemented in T3TokenTransferFacet with T3 logic

    function internal_transfer(StorageLib.AppStorage storage ds, address sender, address recipient, uint256 amount) internal {
        if (sender == address(0)) { revert StorageLib.TransferToZeroAddress(); }
        if (recipient == address(0)) { revert StorageLib.TransferToZeroAddress(); }
        // Allow zero amount transfers for internal logic if necessary, but typically TransferAmountZero is good.
        // T3TokenTransferFacet would check amountIntendedForRecipient > 0.
        // if (amount == 0) { revert StorageLib.TransferAmountZero(); } // Re-evaluate if zero amount is ever valid

        uint256 senderBalance = ds._balances[sender];
        if (senderBalance < amount) {
            revert StorageLib.ERC20InsufficientBalance(sender, senderBalance, amount);
        }
        unchecked { ds._balances[sender] = senderBalance - amount; }
        ds._balances[recipient] += amount;
        emit Transfer(sender, recipient, amount);
    }

    function internal_approve(StorageLib.AppStorage storage ds, address owner, address spender, uint256 amount) internal {
        if (owner == address(0) || spender == address(0)) { revert StorageLib.UserAddressZero(); }
        ds._allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    function internal_spendAllowance(StorageLib.AppStorage storage ds, address owner, address spender, uint256 amount) internal {
        uint256 currentAllowance = ds._allowances[owner][spender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) {
                revert StorageLib.ERC20InsufficientBalance(spender, currentAllowance, amount); // Using this error for insufficient allowance
            }
            unchecked { internal_approve(ds, owner, spender, currentAllowance - amount); }
        }
    }

    function _guardLegacyMint() private view {
        ClaimAttributionStorage.Layout storage claims = ClaimAttributionStorage.layout();
        if (claims.initialized) {
            IssuanceControlStorage.Layout storage ctrl = IssuanceControlStorage.layout();
            if (!ctrl.legacyMintUnlocked) {
                revert IssuanceAccountingLib.LegacyIssuanceDisabled();
            }
        }
    }

    function internal_mint(StorageLib.AppStorage storage ds, address account, uint256 amount) internal {
        _guardLegacyMint();
        if (account == address(0)) { revert StorageLib.MintToZeroAddress(); }
        if (amount == 0) { revert StorageLib.MintAmountZero(); }
        ds._totalSupply += amount;
        ds._balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    function internal_burn(StorageLib.AppStorage storage ds, address account, uint256 amount) internal {
        _guardLegacyMint();
        if (account == address(0)) { revert StorageLib.UserAddressZero(); } // Cannot burn from zero address
        if (amount == 0) { revert StorageLib.BurnAmountZero(); }

        uint256 accountBalance = ds._balances[account];
        if (accountBalance < amount) {
            revert StorageLib.ERC20InsufficientBalance(account, accountBalance, amount);
        }
        unchecked { ds._balances[account] = accountBalance - amount; }
        ds._totalSupply -= amount;
        emit Transfer(account, address(0), amount);
    }
}