// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ISettlementCycle } from "../interfaces/ISettlementCycle.sol";

library SettlementCycleStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.settlement-cycle.v1");

    /// @notice An ordered counterparty pair (lo < hi) for bilateral netting.
    struct Pair {
        address lo;
        address hi;
    }

    struct Layout {
        uint32 storageVersion;
        bool initialized;
        // Wave 5 fields (18 fields inserted before __gap; gap shrunk 48 -> 30). Bilateral-net model
        // (ADR-003 Amendment 2): liens/funding net per counterparty pair, not gross/multilateral.
        uint256 cycleNonce;
        uint256 obligationNonce;
        mapping(bytes32 => ISettlementCycle.SettlementCycle) cycles;
        mapping(bytes32 => ISettlementCycle.SettlementObligation) obligations;
        mapping(bytes32 => bytes32[]) cycleObligationIds;
        mapping(bytes32 => address[]) cycleIssuers;                   // cycle => issuers touched (for confirm)
        mapping(bytes32 => mapping(address => bool)) issuerSeen;      // cycle => issuer => in cycleIssuers
        mapping(bytes32 => mapping(address => bool)) confirmedBy;     // cycle => institution => confirmed
        mapping(bytes32 => uint256) confirmedCount;                  // cycle => # confirmations
        // Bilateral pair netting: pairNet[cycle][lo][hi] = signed net (lo owes hi if > 0).
        mapping(bytes32 => mapping(address => mapping(address => int256))) pairNet;
        mapping(bytes32 => Pair[]) cyclePairs;                        // cycle => ordered pairs touched
        mapping(bytes32 => mapping(address => mapping(address => bool))) pairSeen; // dedup into cyclePairs
        mapping(bytes32 => mapping(address => mapping(address => bool))) pairFunded; // [lo][hi] funded
        mapping(bytes32 => mapping(address => uint256)) cycleLien;    // cycle => bank => current bilateral-net lien
        mapping(bytes32 => bool) consumedFundingRef;                 // replay protection
        bytes32 currentCycleId;                                       // the OPEN cycle obligations route into
        mapping(bytes32 => bool) challenged;                          // cycle => a funding challenge was raised
        bool settlementModelActive;                                   // gate: when false, cross-bank finalize skips cycle recording
        uint256[30] __gap;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly { l.slot := slot }
    }
}
