// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { IRulesEngineFacet } from "../interfaces/IRulesEngineFacet.sol";
import { RulesStorageLib } from "../lib/RulesStorageLib.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { T3CommonLib } from "../lib/T3CommonLib.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";

/**
 * @title T3TokenDirectTransferFacet
 * @notice Institution-only ERC-20 compatibility facet for direct balance transfers.
 * @dev Owns standard ERC-20 `transfer` and `transferFrom` selectors after legacy
 *      T3TokenTransferFacet is removed. No fees, no pending transfers, no envelopes.
 *
 *      Obs-4 / E2 (2026-07-07): both entry points are gated on
 *      DIRECT_TRANSFER_ROLE. Customer value movement is envelope-mediated
 *      (travel-rule binding fires at envelope/SmartLock/inheritance/Cambio
 *      creation); direct transfers exist only for institutional treasury and
 *      custody-platform operations. `transfer` requires the resolved sender to
 *      hold the role; `transferFrom` requires BOTH the spender and the `from`
 *      wallet to hold it, so an allowance from a customer wallet cannot be used
 *      to route value around the envelope perimeter.
 */
contract T3TokenDirectTransferFacet is ReentrancyGuardBase {

    // --- Events ---

    event DirectTransferExecuted(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 feeAmount,
        uint8 transferKind,
        bytes32 correlationId
    );

    // --- Enums ---

    uint8 internal constant DIRECT_TRANSFER = 0;
    uint8 internal constant DELEGATED_TRANSFER_FROM = 1;

    // --- Modifiers ---

    modifier whenNotPaused() {
        if (StorageLib.diamondStorage()._paused) {
            revert("Pausable: paused");
        }
        _;
    }

    // --- Internal Helpers ---

    /**
     * @notice Extracts the original sender from meta-transaction or returns msg.sender.
     * @dev ERC-2771 standard: when called via trusted forwarder, sender is extracted
     *      from the last 20 bytes of calldata.
     */
    function _msgSender() internal view returns (address sender) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (ds.trustedForwarder != address(0) && msg.sender == ds.trustedForwarder && msg.data.length >= 20) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    /**
     * @notice Spend allowance for a delegated transfer.
     */
    function _spendAllowance(StorageLib.AppStorage storage ds, address owner, address spender, uint256 amount) internal {
        uint256 currentAllowance = ds._allowances[owner][spender];
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) {
                revert StorageLib.ERC20InsufficientBalance(spender, currentAllowance, amount);
            }
            unchecked {
                ds._allowances[owner][spender] = currentAllowance - amount;
            }
            emit ERC20BaseFacet.Approval(owner, spender, ds._allowances[owner][spender]);
        }
    }

    /**
     * @notice Shared direct transfer logic.
     * @param operator The actor executing the transfer (_msgSender).
     * @param from The debited wallet.
     * @param to The credited wallet.
     * @param amount The net token amount.
     * @param transferKind 0 for direct transfer, 1 for delegated transferFrom.
     */
    function _directTransfer(
        address operator,
        address from,
        address to,
        uint256 amount,
        uint8 transferKind
    ) internal {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        // --- Pre-Transfer Validations ---
        if (from == address(0) || to == address(0)) {
            revert StorageLib.TransferToZeroAddress();
        }
        if (amount == 0) {
            revert StorageLib.TransferAmountZero();
        }

        // --- Wallet Recovery Quarantine Checks ---
        if (WalletRecoveryStorage.layout().activeRecoveryCount[from] > 0) {
            revert IWalletRecovery.WalletInRecovery(from);
        }
        if (WalletRecoveryStorage.layout().activeRecoveryCount[to] > 0) {
            revert IWalletRecovery.WalletInRecovery(to);
        }
        if (WalletRecoveryStorage.layout().activeRecoveryCount[operator] > 0) {
            revert IWalletRecovery.WalletInRecovery(operator);
        }

        // --- Profile Initialization ---
        T3CommonLib.ensureProfileExistsForWrite(ds, from);
        T3CommonLib.ensureProfileExistsForWrite(ds, to);

        // --- Wave 8B Compliance Pre-Check ---
        ComplianceLib.precheckGated(ds, from, to, amount, ComplianceLib.Context.WALLET_TRANSFER);

        // --- Rules Engine Pre-Check ---
        // NOTE: This facet always enforces DENY results from the rules engine.
        // The rules engine's "observationMode" flag controls whether the engine
        // itself computes WARN/DENY actions; it does NOT bypass enforcement here.
        // Callers who need observation-only behavior should use a different flow.
        bool isSponsored = (ds.trustedForwarder != address(0) && msg.sender == ds.trustedForwarder);
        bytes memory rulesData = new bytes(1);
        rulesData[0] = isSponsored ? bytes1(0x01) : bytes1(0x00);

        uint8 rulesAction = 0; // default ALLOW
        try IRulesEngineFacet(address(this)).beforeTransferCheck(
            from,
            to,
            amount,
            rulesData,
            new bytes32[](0),
            new bytes32[](0)
        ) returns (uint16 score, uint8 action) {
            rulesAction = action;
            if (rulesAction == uint8(IRulesEngineFacet.Action.DENY)) {
                revert("Rules: denied by policy");
            }
        } catch {
            if (RulesStorageLib.rulesStorage().failClosed) {
                revert("Rules: engine failure (fail-closed)");
            }
        }

        // --- Balance Transfer ---
        T3CommonLib.internalTransfer(ds, from, to, amount);
        emit ERC20BaseFacet.Transfer(from, to, amount);

        // --- Transaction Metadata ---
        ds.transactionCountBetween[from][to]++;

        ds.transactionHistory[from].push(StorageLib.TransactionRecord({
            recipient: to,
            amount: amount,
            timestamp: block.timestamp,
            transactionType: "TRANSFER"
        }));

        ds.transactionHistory[to].push(StorageLib.TransactionRecord({
            recipient: from,
            amount: amount,
            timestamp: block.timestamp,
            transactionType: "RECEIVE"
        }));

        ds.walletRiskProfiles[from].lastTransactionTime = block.timestamp;
        ds.walletRiskProfiles[to].lastTransactionTime = block.timestamp;

        // --- Post-Transfer Rules Update ---
        try IRulesEngineFacet(address(this)).postTransferUpdate(from, to, amount) { } catch {}

        // --- Supplemental Business Event ---
        emit DirectTransferExecuted(
            operator,
            from,
            to,
            amount,
            0, // feeAmount: direct transfers are fee-free
            transferKind,
            bytes32(0) // correlationId: derived by indexer
        );
    }

    // --- External Functions ---

    /**
     * @notice Direct ERC-20 transfer.
     * @param recipient The address to receive tokens.
     * @param amount The amount of tokens to transfer.
     * @return True on success.
     */
    function transfer(address recipient, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        returns (bool)
    {
        address sender = _msgSender();
        AccessControlLib.checkRole(RoleConstants.DIRECT_TRANSFER_ROLE, sender);
        _directTransfer(sender, sender, recipient, amount, DIRECT_TRANSFER);
        return true;
    }

    /**
     * @notice Delegated ERC-20 transfer spending an allowance.
     * @param sender The address whose tokens are debited.
     * @param recipient The address to receive tokens.
     * @param amount The amount of tokens to transfer.
     * @return True on success.
     */
    function transferFrom(address sender, address recipient, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        returns (bool)
    {
        address operator = _msgSender();
        AccessControlLib.checkRole(RoleConstants.DIRECT_TRANSFER_ROLE, operator);
        // The debited wallet must also be institutional — otherwise a role
        // holder could drain any approving customer wallet around the
        // envelope perimeter (see facet-level dev note).
        AccessControlLib.checkRole(RoleConstants.DIRECT_TRANSFER_ROLE, sender);
        _spendAllowance(StorageLib.diamondStorage(), sender, operator, amount);
        _directTransfer(operator, sender, recipient, amount, DELEGATED_TRANSFER_FROM);
        return true;
    }
}
