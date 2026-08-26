// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { WalletRecoveryStorage } from "./WalletRecoveryStorage.sol";
import { StorageLib } from "./StorageLib.sol";
import { AccessControlLib } from "./AccessControlLib.sol";
import { RoleConstants } from "./RoleConstants.sol";
import { DepositorIdentityStorage } from "./DepositorIdentityStorage.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title WalletRecoveryDepositorIdentityLib
 * @notice External library for migrating depositor-identity (TIN-hash) registry state
 *         during wallet recovery. Called via DELEGATECALL from WalletRecoveryFacet so
 *         diamond storage and msg.sender are preserved.
 */
library WalletRecoveryDepositorIdentityLib {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;

    uint256 private constant MAX_LIABILITY_COUNTERPARTIES = 100;
    uint8 private constant RS_ACTIVE = 2;

    /**
     * @dev Move up to `maxHashes` entries from bankRegistries[oldWallet] to
     *      bankRegistries[newWallet]. Idempotent and paginated.
     */
    function migrateDepositorIdentityState(bytes32 recoveryId, uint256 maxHashes) external {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (
            !AccessControlLib.hasRole(ds, RoleConstants.ADMIN_ROLE, msg.sender) &&
            !AccessControlLib.hasRole(ds, RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender)
        ) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.ADMIN_ROLE);
        }

        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];

        if (rec.state != RS_ACTIVE) {
            revert IWalletRecovery.InvalidRecoveryState(recoveryId, rec.state, RS_ACTIVE);
        }
        if (maxHashes == 0 || maxHashes > MAX_LIABILITY_COUNTERPARTIES) {
            revert IWalletRecovery.BatchTooLarge(maxHashes, MAX_LIABILITY_COUNTERPARTIES);
        }

        address oldW = rec.oldWallet;
        address newW = rec.newWallet;
        if (newW == address(0)) {
            revert IWalletRecovery.StandbyWalletInvalid(newW);
        }
        // Defense-in-depth: a self-migration would wipe the source registry.
        // The facet already enforces newWallet != oldWallet, but guard the library
        // in case it is ever reused outside that invariant.
        if (oldW == newW) {
            return;
        }

        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();
        DepositorIdentityStorage.BankHashRegistry storage oldReg = dis.bankRegistries[oldW];
        DepositorIdentityStorage.BankHashRegistry storage newReg = dis.bankRegistries[newW];

        uint256 moved = 0;
        while (moved < maxHashes && oldReg.tinHashes.length() > 0) {
            bytes32 tinHash = oldReg.tinHashes.at(0);

            if (!newReg.tinHashes.contains(tinHash)) {
                newReg.tinHashes.add(tinHash);
                newReg.tinHashEpochs[tinHash] = oldReg.tinHashEpochs[tinHash];
                newReg.hashCount++;
                dis.totalHashesRegistered++;
            }

            oldReg.tinHashes.remove(tinHash);
            delete oldReg.tinHashEpochs[tinHash];
            oldReg.hashCount--;
            dis.totalHashesRegistered--;

            unchecked { ++moved; }
        }

        uint256 ts = block.timestamp;
        newReg.lastUpdated = ts;
        oldReg.lastUpdated = ts;
        if (newReg.tinHashes.length() > 0 && !dis.banksWithHashes.contains(newW)) {
            dis.banksWithHashes.add(newW);
        }
        if (oldReg.tinHashes.length() == 0 && dis.banksWithHashes.contains(oldW)) {
            dis.banksWithHashes.remove(oldW);
        }

        emit IWalletRecovery.DepositorIdentityStateMigrated(
            recoveryId, oldW, newW, moved, oldReg.tinHashes.length()
        );
    }
}
