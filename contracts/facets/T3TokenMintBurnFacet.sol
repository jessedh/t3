// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { ClaimAttributionStorage } from "../lib/ClaimAttributionStorage.sol";
import { IssuanceAccountingLib } from "../lib/IssuanceAccountingLib.sol";
import { AccessControlFacet } from "./AccessControlFacet.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { T3TokenCommonLogicFacet } from "./T3TokenCommonLogicFacet.sol";
import { ERC20PausableFacet } from "./ERC20PausableFacet.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { T3CommonLib } from "../lib/T3CommonLib.sol";
import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";
import { ConsortiumEmergencyLib } from "../lib/ConsortiumEmergencyLib.sol";
import { IssuanceControlStorage } from "../lib/IssuanceControlStorage.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";

contract T3TokenMintBurnFacet is ReentrancyGuardBase {
    using StorageLib for StorageLib.AppStorage;
    using EnumerableSet for EnumerableSet.AddressSet;
    
    // Override the _checkRole function from ERC20PausableFacet
    function _requireNotInRecovery(address wallet) internal view {
        if (WalletRecoveryStorage.layout().activeRecoveryCount[wallet] > 0) {
            revert IWalletRecovery.WalletInRecovery(wallet);
        }
    }

    function _checkRole(bytes32 role, address account) internal view {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[role].contains(account)) {
            revert StorageLib.UnauthorizedRole(account, role);
        }
    }
    
    // Removed: _ensureProfileExistsForWrite - now using T3CommonLib.ensureProfileExistsForWrite

    event TokensMinted(address indexed minter, address indexed to, uint256 amount);
    event ConsortiumTokensMinted(address indexed bank, address indexed to, uint256 amount);
    event ConsortiumTokensBurned(address indexed bank, address indexed account, uint256 amount);
    // Burn event (Transfer to address(0)) is emitted by ERC20BaseFacet.internal_burn

    // Emitted when burnForConsortiumBank is called after attribution is initialized.
    // Signals that the caller must wait for Wave 4's burnAttributed wiring.
    error ConsortiumBurnRequiresAttributedPath();
    error CapacityModelActive();

    function _guardLegacyMint(bool isMint, bool isConsortiumBankMint) private view {
        ClaimAttributionStorage.Layout storage claims = ClaimAttributionStorage.layout();
        IssuanceControlStorage.Layout storage ctrl = IssuanceControlStorage.layout();
        if (ctrl.legacyMintUnlocked) {
            return;
        }
        if (!claims.initialized) {
            // Pre-activation: legacy external mint is locked, but collateralized
            // consortium issuance must remain available.
            if (isMint && !isConsortiumBankMint) {
                revert IssuanceControlStorage.LegacyMintLocked();
            }
            return;
        }
        revert IssuanceAccountingLib.LegacyIssuanceDisabled();
    }

    // Internal wrapper function to replace ERC20BaseFacet.internal_mint
    function _internal_mint(StorageLib.AppStorage storage ds, address account, uint256 amount, bool isConsortiumBankMint) internal {
        _guardLegacyMint(true, isConsortiumBankMint);
        if (account == address(0)) { revert StorageLib.MintToZeroAddress(); }
        if (amount == 0) { revert StorageLib.MintAmountZero(); }
        ds._totalSupply += amount;
        ds._balances[account] += amount;
        // Use the IERC20 event definition from the imported ERC20BaseFacet
        emit ERC20BaseFacet.Transfer(address(0), account, amount);
    }
    
    function mint(address recipient, uint256 amount) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _checkRole(RoleConstants.MINTER_ROLE, msg.sender);
        // Wave 4: when the capacity model is active, all issuance must flow through the
        // attributed reserve/execute path; gate the generic legacy mint too.
        if (IssuanceControlStorage.layout().capacityModelActive) revert CapacityModelActive();
        _requireNotInRecovery(recipient);

        // Wave 8B: forward legacy mint recipient check.
        // ESCROW_RELEASE context checks the recipient leg only; a zero from-address
        // means sanctions enforcement is a no-op, while KYC/CIP still gate the recipient.
        ComplianceLib.precheckGated(ds, address(0), recipient, amount, ComplianceLib.Context.ESCROW_RELEASE);

        _internal_mint(ds, recipient, amount, false); // Handles zero address/amount checks
        ds.mintedByMinter[msg.sender] += amount;
        T3CommonLib.ensureProfileExistsForWrite(ds, recipient);
        emit TokensMinted(msg.sender, recipient, amount);
    }

    // Internal wrapper function to replace ERC20BaseFacet.internal_burn
    function _internal_burn(StorageLib.AppStorage storage ds, address account, uint256 amount) internal {
        _guardLegacyMint(false, false);
        if (account == address(0)) { revert StorageLib.UserAddressZero(); } // Cannot burn from zero address
        if (amount == 0) { revert StorageLib.BurnAmountZero(); }
        uint256 accountBalance = ds._balances[account];
        if (accountBalance < amount) {
            revert StorageLib.ERC20InsufficientBalance(account, accountBalance, amount);
        }
        unchecked { ds._balances[account] = accountBalance - amount; }
        ds._totalSupply -= amount;
        emit ERC20BaseFacet.Transfer(account, address(0), amount);
    }
    
    function burn(uint256 amount) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _internal_burn(ds, msg.sender, amount); // Handles zero amount & balance checks
    }

    function burnFrom(address account, uint256 amount) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _checkRole(RoleConstants.BURNER_ROLE, msg.sender);
        _internal_burn(ds, account, amount);
    }

    function getMintedByMinter(address minter) external view returns (uint256) {
        return StorageLib.diamondStorage().mintedByMinter[minter];
    }

    function mintForConsortiumBank(address bank, uint256 amount) external nonReentrant {
        _checkRole(RoleConstants.MINTER_ROLE, msg.sender);
        _checkRole(RoleConstants.DEPOSIT_TOKEN_ISSUER_ROLE, msg.sender);
        // Wave 4: once the capacity model is active, direct consortium mint is gated off;
        // issuance must flow through IssuanceControlFacet.reserveIssuance/executeIssuance.
        if (IssuanceControlStorage.layout().capacityModelActive) revert CapacityModelActive();
        _requireNotInRecovery(bank);
        ConsortiumEmergencyLib.enforceOperationActive(ConsortiumEmergencyLib.OP_MINT);
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        require(cs.activeBanks[bank], "bank inactive");

        // Wave 8B: forward bank mint
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ComplianceLib.precheckGated(ds, address(0), bank, amount, ComplianceLib.Context.BANK_MINT);

        ConsortiumStorage.DepositTokenAccount storage ledger = cs.depositAccounts[bank];
        uint256 outstanding = _getOutstandingMinted(ledger);
        // Factor-based collateral check. factorBps defaults to 10_000 (1:1) at MVP;
        // Wave 4 sets real policy via MultiAssetVaultFacet.setBankCollateralFactor.
        uint256 factorBps = cs.bankCollateralFactorBps[bank];
        if (factorBps == 0) factorBps = 10_000;
        uint256 adjustedCapacity = (ledger.totalDeposits * factorBps) / 10_000;
        require(adjustedCapacity >= outstanding + amount, "insufficient collateral");

        // Mint only to the bank itself — tokens can be distributed via standard ERC-20
        // transfers. Minting to arbitrary recipients would strand collateral because
        // burnForConsortiumBank can only reduce the ledger when the bank holds the tokens.
        // G.0.a: structural swap — mintAttributed replaces _internal_mint so every
        // consortium mint writes an issuer-claim bucket. _guardLegacyMint is called here
        // (it was previously inside _internal_mint). Transfer event emitted separately
        // because mintAttributed does not emit it.
        _guardLegacyMint(true, true);
        IssuanceAccountingLib.mintAttributed(bank, bank, amount);
        emit ERC20BaseFacet.Transfer(address(0), bank, amount);
        ledger.totalMinted += amount;
        emit ConsortiumTokensMinted(bank, bank, amount);
    }

    function burnForConsortiumBank(address bank, uint256 amount) external nonReentrant {
        // G.0.a guard: once attribution is initialized, _internal_burn would decrement
        // totalSupply without updating totalAttributedOutstanding, permanently violating
        // the conservation invariant and bricking all future mintForConsortiumBank calls.
        // Wave 4 will replace this with burnAttributed and remove this guard.
        if (ClaimAttributionStorage.layout().initialized) {
            revert ConsortiumBurnRequiresAttributedPath();
        }
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _checkRole(RoleConstants.DEPOSIT_TOKEN_ISSUER_ROLE, msg.sender);
        _requireNotInRecovery(bank);
        ConsortiumEmergencyLib.enforceOperationActive(ConsortiumEmergencyLib.OP_BURN);
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        ConsortiumStorage.DepositTokenAccount storage ledger = cs.depositAccounts[bank];
        require(_getOutstandingMinted(ledger) >= amount, "insufficient outstanding");

        _internal_burn(ds, bank, amount);
        ledger.totalBurned += amount;
        emit ConsortiumTokensBurned(bank, bank, amount);
    }

    function _getOutstandingMinted(ConsortiumStorage.DepositTokenAccount storage account) internal view returns (uint256) {
        return account.totalMinted > account.totalBurned ? account.totalMinted - account.totalBurned : 0;
    }
}
