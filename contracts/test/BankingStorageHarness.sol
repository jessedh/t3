// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "../lib/ClaimAttributionStorage.sol";
import "../lib/IssuanceCapacityStorage.sol";
import "../lib/IssuanceSponsorshipStorage.sol";
import "../lib/ReserveControlStorage.sol";
import "../lib/SettlementCycleStorage.sol";
import "../lib/InstitutionLifecycleStorage.sol";

/**
 * @title BankingStorageHarness
 * @dev Test-only harness exposing the six new banking storage namespace slots.
 */
contract BankingStorageHarness {
    function getBankingStorageSlots() external pure returns (bytes32[6] memory) {
        return [
            ClaimAttributionStorage.STORAGE_SLOT,
            IssuanceCapacityStorage.STORAGE_SLOT,
            IssuanceSponsorshipStorage.STORAGE_SLOT,
            ReserveControlStorage.STORAGE_SLOT,
            SettlementCycleStorage.STORAGE_SLOT,
            InstitutionLifecycleStorage.STORAGE_SLOT
        ];
    }
}
