// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { CambioEnvelopeStorage } from "../lib/CambioEnvelopeStorage.sol";

/**
 * @title CambioEnvelopeTestFacet
 * @notice Test helper facet that exposes envelope storage writes and helper checks
 *         for isolation and phase-gate testing. Does NOT inherit CambioEnvelopeFacet
 *         to avoid selector collisions in the diamond.
 */
contract CambioEnvelopeTestFacet {
    function requireEnvelopePhaseEnabled() external view {
        if (CambioEnvelopeStorage.layout().phase == CambioEnvelopeStorage.CambioEnvelopePhase.DISABLED) {
            revert CambioEnvelopeStorage.CambioEnvelopeDisabled();
        }
    }

    function checkMaxOutstanding(address issuer) external view {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile = es.issuerProfiles[issuer];
        CambioEnvelopeStorage.CambioEnvelopeConfig storage cfg = es.config;

        // Use per-issuer cap if set; otherwise fall back to global config default.
        // A value of 0 means unlimited (permissive default during legacy cutover).
        uint256 maxCount = profile.maxOutstandingNoteCount;
        if (maxCount == 0) {
            maxCount = cfg.globalMaxOutstandingNoteCount;
        }
        if (maxCount > 0 && profile.notesOutstanding >= maxCount) {
            revert CambioEnvelopeStorage.CambioMaxOutstandingNotesExceeded(
                issuer,
                profile.notesOutstanding,
                maxCount
            );
        }

        uint256 maxValue = profile.maxOutstandingNoteValue;
        if (maxValue == 0) {
            maxValue = cfg.globalMaxOutstandingNoteValue;
        }
        if (maxValue > 0 && profile.valueOutstanding >= maxValue) {
            revert CambioEnvelopeStorage.CambioMaxOutstandingValueExceeded(
                issuer,
                profile.valueOutstanding,
                maxValue
            );
        }
    }

    function checkDailyCeiling(address issuer, uint256 amount) external {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile = es.issuerProfiles[issuer];
        uint256 ceiling = profile.dailyRedemptionCeiling;
        if (ceiling == 0) return;

        CambioEnvelopeStorage.RollingCeilingBuckets storage buckets = es.issuerCeilingBuckets[issuer];
        uint256 currentHour = block.timestamp / 3600;
        uint256 bucketIndex = currentHour % 24;

        if (buckets.lastUpdatedHour < currentHour) {
            uint256 hoursPassed = currentHour - buckets.lastUpdatedHour;
            if (hoursPassed >= 24) {
                for (uint256 i = 0; i < 24; ) {
                    buckets.buckets[i] = 0;
                    unchecked { ++i; }
                }
            } else {
                for (uint256 i = 1; i <= hoursPassed; ) {
                    uint256 staleIndex = (buckets.lastUpdatedHour + i) % 24;
                    buckets.buckets[staleIndex] = 0;
                    unchecked { ++i; }
                }
            }
            buckets.lastUpdatedHour = currentHour;
        }

        uint256 rollingTotal = 0;
        for (uint256 i = 0; i < 24; ) {
            rollingTotal += buckets.buckets[i];
            unchecked { ++i; }
        }

        if (rollingTotal + amount > ceiling) {
            revert CambioEnvelopeStorage.CambioDailyRedemptionCeilingExceeded(
                issuer,
                amount,
                ceiling
            );
        }

        buckets.buckets[bucketIndex] += amount;
    }

    function writeEnvelopeNote(bytes32 noteId, CambioEnvelopeStorage.CambioEnvelopeNote calldata note) external {
        if (CambioEnvelopeStorage.layout().phase == CambioEnvelopeStorage.CambioEnvelopePhase.DISABLED) {
            revert CambioEnvelopeStorage.CambioEnvelopeDisabled();
        }
        CambioEnvelopeStorage.layout().envelopeNotes[noteId] = note;
    }

    function getEnvelopeNote(bytes32 noteId) external view returns (CambioEnvelopeStorage.CambioEnvelopeNote memory) {
        return CambioEnvelopeStorage.layout().envelopeNotes[noteId];
    }

    function setTestIssuerProfile(address issuer, CambioEnvelopeStorage.IssuerEnvelopeProfile calldata profile) external {
        CambioEnvelopeStorage.layout().issuerProfiles[issuer] = profile;
    }

    function getTestIssuerProfile(address issuer) external view returns (CambioEnvelopeStorage.IssuerEnvelopeProfile memory) {
        return CambioEnvelopeStorage.layout().issuerProfiles[issuer];
    }
}
