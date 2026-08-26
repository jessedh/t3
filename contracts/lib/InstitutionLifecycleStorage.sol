// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library InstitutionLifecycleStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.institution-lifecycle.v1");

    enum InstitutionMode {
        ACTIVE,           // 0 — normal operations; storage default(0) = ACTIVE for backward compat
        ISSUANCE_PAUSED,  // 1 — can redeem and transfer, cannot issue or release reserve
        ORDERLY_EXIT,     // 2 — winding down; no new issuance; existing obligations settling
        DEFAULTED,        // 3 — all risk-increasing operations blocked (was DEFAULT)
        RESOLVED          // 4 — all obligations settled; effectively deactivated
    }

    struct Layout {
        uint32 storageVersion;
        bool initialized;
        // Institution lifecycle mode; default(0) = ACTIVE for backward compat
        mapping(address => InstitutionMode) institutionMode;
        // Bidirectional cross-reference: InstitutionStorage ID ↔ bank address
        mapping(bytes32 => address) institutionIdToBank;
        mapping(address => bytes32) bankToInstitutionId;
        uint256[45] __gap;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly { l.slot := slot }
    }
}
