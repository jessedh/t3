// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";

contract T3TokenCommonLogicFacet {

    function internal_ensureProfileExists(StorageLib.AppStorage storage ds, address wallet) internal view {
        // This function is primarily a conceptual check for view functions.
        // The actual creation happens in ensureProfileExistsForWrite.
        // If a profile must exist for a view operation, the caller should handle the case where creationTime is 0.
        if (wallet == address(0)) { return; } // No profile for zero address
        // No explicit action, but other functions might rely on creationTime > 0.
    }

    function internal_ensureProfileExistsForWrite(StorageLib.AppStorage storage ds, address wallet) internal {
        if (wallet != address(0) && ds.walletRiskProfiles[wallet].creationTime == 0) {
            ds.walletRiskProfiles[wallet].creationTime = block.timestamp;
        }
    }

    // --- View functions for T3 specific data, callable via Diamond Proxy ---
    function getTransferData(address account) external view returns (StorageLib.TransferMetadata memory) {
        return StorageLib.diamondStorage().transferData[account];
    }

    function getWalletRiskProfile(address account) external view returns (StorageLib.WalletRiskProfile memory) {
        return StorageLib.diamondStorage().walletRiskProfiles[account];
    }

    function getIncentiveCredits(address account) external view returns (StorageLib.IncentiveCredits memory) {
        return StorageLib.diamondStorage().incentiveCredits[account];
    }
}