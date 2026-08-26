// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

library ScreeningStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.compliance-screening.v1");

    enum ScreeningStatus { NONE, CLEAR, FLAGGED, BLOCKED }

    event InstitutionSanctionsEnabledSet(bytes32 indexed institutionId, bool enabled, address setBy);

    struct Screening {
        uint8 status;
        uint40 lastScreenedAt;
        bytes32 listVersionHash;
        address attestor;
    }

    // 8E-1: false-positive correction record (distinct from exemption).
    // FIELD ORDER IS STORAGE-SENSITIVE and NOT covered by check-storage-layout.js
    // (it parses only the top-level `struct Layout`). Do NOT reorder. See Task 9 decode test.
    struct NetworkClearance {
        uint40  clearedAt;      // slot 0 (packed)
        address clearedBy;      // slot 0 (packed)
        bytes32 reasonHash;     // slot 1
        uint8   previousStatus; // slot 2 (packed) — audit: status before clearance
    }

    struct Layout {
        mapping(address => Screening) screenings;   // network scope (unchanged)
        uint40 screeningStaleAfter;                 // unchanged
        // --- 8E-1 additive tail (tail-append only, no reorder) ---
        mapping(bytes32 => mapping(address => Screening)) scopedScreenings;   // scopeId(=institutionId) => wallet => screening
        mapping(address => NetworkClearance) networkClearances;              // network false-positive corrections
        mapping(bytes32 => bool) institutionSanctionsEnabled;               // DP-A: per-institution sanctions enable bit
        // DP-B: enumerable index of institutions that have a non-NONE scoped screening for a wallet.
        mapping(address => EnumerableSet.Bytes32Set) walletScopedInstitutions;
        // 8E-1: number of institutions with DP-A sanctions enforcement enabled.
        uint256 sanctionsEnabledCount;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly { l.slot := slot }
    }
}
