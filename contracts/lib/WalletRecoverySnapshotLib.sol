// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { WalletRecoveryStorage } from "./WalletRecoveryStorage.sol";
import { ScreeningStorage } from "./ScreeningStorage.sol";
import { InstitutionStorage } from "./InstitutionStorage.sol";
import { CambioEnvelopeStorage } from "./CambioEnvelopeStorage.sol";
import { TravelRuleStorage } from "./TravelRuleStorage.sol";
import { StorageLib } from "./StorageLib.sol";
import { ComplianceRequirementLib } from "./ComplianceRequirementLib.sol";
import { ComplianceConfigStorage } from "./ComplianceConfigStorage.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title WalletRecoverySnapshotLib
 * @notice External library implementing the Task 5.3 snapshot-and-restore journal
 *         (design: 2026-07-05 defer-vs-snapshot §4(b), ratified DP-5.0-A/C).
 *         Called via DELEGATECALL from WalletRecoveryFacet / WalletRecoverySanctionsLib
 *         so diamond storage is preserved.
 * @dev At each designateSuccessor/redirectSuccessor, BEFORE the sanctions-lib moves,
 *      `snapshotBothSides` journals the pre-move records of BOTH wallets for every
 *      family the move can touch. A reversible cancelRecovery replays the journal in
 *      reverse via `restoreFromJournal`, leaving the predecessor and every prior
 *      successor bit-identical to their pre-move state. A family is journaled only
 *      when the SOURCE record exists — otherwise the migration is a no-op for it.
 *      Storage slot: keccak256("t3.storage.wallet.recovery.snapshot.v1")
 */
library WalletRecoverySnapshotLib {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.wallet.recovery.snapshot.v1");

    // Snapshot families (journal entry tags).
    uint8 internal constant FAM_NETWORK_SCREENING = 1;
    uint8 internal constant FAM_NETWORK_CLEARANCE = 2;
    uint8 internal constant FAM_AFFILIATION = 3;
    uint8 internal constant FAM_SCOPED_SCREENING = 4;
    uint8 internal constant FAM_WALLET_POLICY = 5;
    uint8 internal constant FAM_CIP = 6;
    uint8 internal constant FAM_CAMBIO_PROFILE = 7;
    uint8 internal constant FAM_TRAVEL_RULE_PENDING = 8;

    // Envelope-ops policy keys, duplicated-by-keccak (canonical declarations in
    // InstitutionPolicyFacet; same precedent as WalletRecoverySanctionsLib).
    bytes32 private constant CANCEL_OOB_THRESHOLD_USD = keccak256("cancel_oob_threshold_usd");
    bytes32 private constant SHORTEN_OOB_REQUIRED = keccak256("shorten_oob_required");
    bytes32 private constant DUAL_APPROVAL_THRESHOLD_USD = keccak256("dual_approval_threshold_usd");
    bytes32 private constant MAX_HALFLIFE_ADJUSTMENTS = keccak256("max_halflife_adjustments");

    /**
     * @dev One pre-move record. Only the payload matching `family` is populated;
     *      untouched fields are never written (zero storage cost). `present == false`
     *      means the record did not exist at snapshot time, so restore = delete.
     */
    struct JournalEntry {
        address wallet;
        uint8 family;
        bytes32 key;      // institutionId (scoped screening) or policyId (wallet policy)
        bool present;
        ScreeningStorage.Screening screening;             // families 1, 4
        ScreeningStorage.NetworkClearance clearance;      // family 2
        InstitutionStorage.WalletAffiliation affiliation; // family 3
        uint256 policyValue;                              // family 5
        uint256 cipCompletedAt;                           // family 6
        bytes32 cipRecordHash;                            // family 6
        CambioEnvelopeStorage.IssuerEnvelopeProfile profile;   // family 7
        CambioEnvelopeStorage.RollingCeilingBuckets buckets;   // family 7
        TravelRuleStorage.PendingTravelRule pendingTR;         // family 8
    }

    struct Layout {
        // recoveryId => append-only journal of pre-move records.
        mapping(bytes32 => JournalEntry[]) journals;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }

    /**
     * @notice Journal both wallets' pre-move records for every family the
     *         designation/redirect move can touch. Called BEFORE the moves.
     * @param recoveryId The recovery whose journal receives the entries.
     * @param source The wallet state is moving FROM (predecessor, or prior successor on redirect).
     * @param dest The wallet state is moving TO (the new successor).
     */
    function snapshotBothSides(bytes32 recoveryId, address source, address dest) external {
        JournalEntry[] storage j = layout().journals[recoveryId];
        ScreeningStorage.Layout storage s = ScreeningStorage.layout();
        InstitutionStorage.Layout storage inst = InstitutionStorage.layout();

        if (s.screenings[source].status != uint8(ScreeningStorage.ScreeningStatus.NONE)) {
            _journalNetworkScreening(j, s, source);
            _journalNetworkScreening(j, s, dest);
        }

        if (s.networkClearances[source].clearedAt != 0) {
            _journalNetworkClearance(j, s, source);
            _journalNetworkClearance(j, s, dest);
        }

        if (inst.walletAffiliations[source].status != InstitutionStorage.WalletAffiliationStatus.None) {
            _journalAffiliation(j, inst, source);
            _journalAffiliation(j, inst, dest);
        }

        // Scoped screenings: bounded by the SOURCE's membership set — those are the
        // only (institutionId, wallet) pairs the migration loop touches, on both sides.
        bytes32[] memory ids = s.walletScopedInstitutions[source].values();
        for (uint256 i = 0; i < ids.length; ) {
            _journalScopedScreening(j, s, source, ids[i]);
            _journalScopedScreening(j, s, dest, ids[i]);
            unchecked { ++i; }
        }

        bytes32[8] memory keys = _policyKeys();
        for (uint256 i = 0; i < 8; ) {
            if (inst.walletPolicySet[source][keys[i]]) {
                _journalPolicy(j, inst, source, keys[i]);
                _journalPolicy(j, inst, dest, keys[i]);
            }
            unchecked { ++i; }
        }

        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (ds._custodyInfo[source].cipCompletedAt != 0) {
            _journalCip(j, ds, source);
            _journalCip(j, ds, dest);
        }

        CambioEnvelopeStorage.Layout storage cl = CambioEnvelopeStorage.layout();
        if (cl.issuerProfiles[source].isActive) {
            _journalCambioProfile(j, cl, source);
            _journalCambioProfile(j, cl, dest);
        }

        // Wave-panel MED-1: pending travel-rule commitment (single-use staging).
        TravelRuleStorage.Layout storage t = TravelRuleStorage.layout();
        if (t.pending[source].ref != bytes32(0)) {
            _journalPendingTravelRule(j, t, source);
            _journalPendingTravelRule(j, t, dest);
        }
    }

    /**
     * @notice Replay the journal in REVERSE, rewriting every journaled record at its
     *         origin. Reverse order makes the earliest (original) snapshot land last
     *         for wallets journaled at multiple hops (redirect chains), so all parties
     *         end bit-identical to their pre-designation state.
     * @dev Only invoked from the REVERSIBLE cancelRecovery branch. Irreversible
     *      cancels keep today's semantics (no restore).
     */
    function restoreFromJournal(bytes32 recoveryId) external {
        JournalEntry[] storage j = layout().journals[recoveryId];
        for (uint256 k = j.length; k > 0; ) {
            unchecked { --k; }
            _restoreEntry(j[k]);
        }
        // recoveryIds are counter-derived and never reused, so clearing the length
        // is enough; no journal residue can leak into a future recovery.
        delete layout().journals[recoveryId];
    }

    /**
     * @notice Flip the recovery irreversible (DP-5.0-B): manual migrate helpers move
     *         un-journaled families, after which restore would be silently lossy.
     * @param recoveryId The recovery being marked.
     * @param family Human-readable family tag for the event (e.g. "Consortium").
     */
    function markStateMigrated(bytes32 recoveryId, bytes32 family) external {
        WalletRecoveryStorage.layout().recoveries[recoveryId].stateMigrated = true;
        emit IWalletRecovery.RecoveryStateMigrated(recoveryId, family);
    }

    // =========================================================================
    // JOURNAL WRITERS
    // =========================================================================

    function _journalNetworkScreening(
        JournalEntry[] storage j,
        ScreeningStorage.Layout storage s,
        address w
    ) private {
        JournalEntry storage e = j.push();
        e.wallet = w;
        e.family = FAM_NETWORK_SCREENING;
        ScreeningStorage.Screening storage rec = s.screenings[w];
        if (rec.status != uint8(ScreeningStorage.ScreeningStatus.NONE)) {
            e.present = true;
            e.screening = rec;
        }
    }

    function _journalNetworkClearance(
        JournalEntry[] storage j,
        ScreeningStorage.Layout storage s,
        address w
    ) private {
        JournalEntry storage e = j.push();
        e.wallet = w;
        e.family = FAM_NETWORK_CLEARANCE;
        ScreeningStorage.NetworkClearance storage rec = s.networkClearances[w];
        if (rec.clearedAt != 0) {
            e.present = true;
            e.clearance = rec;
        }
    }

    function _journalAffiliation(
        JournalEntry[] storage j,
        InstitutionStorage.Layout storage inst,
        address w
    ) private {
        JournalEntry storage e = j.push();
        e.wallet = w;
        e.family = FAM_AFFILIATION;
        InstitutionStorage.WalletAffiliation storage rec = inst.walletAffiliations[w];
        if (rec.status != InstitutionStorage.WalletAffiliationStatus.None) {
            e.present = true;
            e.affiliation = rec;
        }
    }

    function _journalScopedScreening(
        JournalEntry[] storage j,
        ScreeningStorage.Layout storage s,
        address w,
        bytes32 institutionId
    ) private {
        JournalEntry storage e = j.push();
        e.wallet = w;
        e.family = FAM_SCOPED_SCREENING;
        e.key = institutionId;
        ScreeningStorage.Screening storage rec = s.scopedScreenings[institutionId][w];
        if (rec.status != uint8(ScreeningStorage.ScreeningStatus.NONE)) {
            e.present = true;
            e.screening = rec;
        }
    }

    function _journalPolicy(
        JournalEntry[] storage j,
        InstitutionStorage.Layout storage inst,
        address w,
        bytes32 pid
    ) private {
        JournalEntry storage e = j.push();
        e.wallet = w;
        e.family = FAM_WALLET_POLICY;
        e.key = pid;
        if (inst.walletPolicySet[w][pid]) {
            e.present = true;
            e.policyValue = inst.walletPolicies[w][pid];
        }
    }

    function _journalCip(
        JournalEntry[] storage j,
        StorageLib.AppStorage storage ds,
        address w
    ) private {
        JournalEntry storage e = j.push();
        e.wallet = w;
        e.family = FAM_CIP;
        StorageLib.CustodyData storage cd = ds._custodyInfo[w];
        if (cd.cipCompletedAt != 0) {
            e.present = true;
            e.cipCompletedAt = cd.cipCompletedAt;
            e.cipRecordHash = cd.cipRecordHash;
        }
    }

    function _journalCambioProfile(
        JournalEntry[] storage j,
        CambioEnvelopeStorage.Layout storage cl,
        address w
    ) private {
        JournalEntry storage e = j.push();
        e.wallet = w;
        e.family = FAM_CAMBIO_PROFILE;
        if (cl.issuerProfiles[w].isActive) {
            e.present = true;
            e.profile = cl.issuerProfiles[w];
            // Buckets journaled too: the move RESETS the destination's buckets, so a
            // profile-only snapshot would not restore bit-identical (kimi finding 3).
            e.buckets = cl.issuerCeilingBuckets[w];
        }
    }

    function _journalPendingTravelRule(
        JournalEntry[] storage j,
        TravelRuleStorage.Layout storage t,
        address w
    ) private {
        JournalEntry storage e = j.push();
        e.wallet = w;
        e.family = FAM_TRAVEL_RULE_PENDING;
        TravelRuleStorage.PendingTravelRule storage rec = t.pending[w];
        if (rec.ref != bytes32(0)) {
            e.present = true;
            e.pendingTR = rec;
        }
    }

    // =========================================================================
    // RESTORE
    // =========================================================================

    function _restoreEntry(JournalEntry storage e) private {
        uint8 fam = e.family;
        if (fam == FAM_NETWORK_SCREENING) {
            ScreeningStorage.Layout storage s = ScreeningStorage.layout();
            if (e.present) {
                s.screenings[e.wallet] = e.screening;
            } else {
                delete s.screenings[e.wallet];
            }
        } else if (fam == FAM_NETWORK_CLEARANCE) {
            ScreeningStorage.Layout storage s = ScreeningStorage.layout();
            if (e.present) {
                s.networkClearances[e.wallet] = e.clearance;
            } else {
                delete s.networkClearances[e.wallet];
            }
        } else if (fam == FAM_AFFILIATION) {
            InstitutionStorage.Layout storage inst = InstitutionStorage.layout();
            if (e.present) {
                inst.walletAffiliations[e.wallet] = e.affiliation;
            } else {
                delete inst.walletAffiliations[e.wallet];
            }
        } else if (fam == FAM_SCOPED_SCREENING) {
            ScreeningStorage.Layout storage s = ScreeningStorage.layout();
            if (e.present) {
                s.scopedScreenings[e.key][e.wallet] = e.screening;
                s.walletScopedInstitutions[e.wallet].add(e.key);
            } else {
                delete s.scopedScreenings[e.key][e.wallet];
                s.walletScopedInstitutions[e.wallet].remove(e.key);
            }
        } else if (fam == FAM_WALLET_POLICY) {
            _restorePolicy(e);
        } else if (fam == FAM_CIP) {
            StorageLib.CustodyData storage cd =
                StorageLib.diamondStorage()._custodyInfo[e.wallet];
            cd.cipCompletedAt = e.cipCompletedAt; // 0 when !present
            cd.cipRecordHash = e.cipRecordHash;
        } else if (fam == FAM_CAMBIO_PROFILE) {
            CambioEnvelopeStorage.Layout storage cl = CambioEnvelopeStorage.layout();
            if (e.present) {
                cl.issuerProfiles[e.wallet] = e.profile;
                cl.issuerCeilingBuckets[e.wallet] = e.buckets;
            } else {
                delete cl.issuerProfiles[e.wallet];
                delete cl.issuerCeilingBuckets[e.wallet];
            }
        } else if (fam == FAM_TRAVEL_RULE_PENDING) {
            TravelRuleStorage.Layout storage t = TravelRuleStorage.layout();
            if (e.present) {
                t.pending[e.wallet] = e.pendingTR;
            } else {
                delete t.pending[e.wallet];
            }
        }
    }

    /**
     * @dev Policy write-back with armed-scope counter fixup. Each write-back adjusts
     *      the counter by (snapshotArmed − currentArmed); across a reverse replay the
     *      deltas telescope to exactly the pre-designation counter, regardless of how
     *      many hops are unwound or what the merge dedupe did.
     */
    function _restorePolicy(JournalEntry storage e) private {
        InstitutionStorage.Layout storage inst = InstitutionStorage.layout();
        bytes32 pid = e.key;
        if (_isBooleanRequirementControl(pid)) {
            bool curArmed = inst.walletPolicySet[e.wallet][pid]
                && inst.walletPolicies[e.wallet][pid] != 0;
            bool snapArmed = e.present && e.policyValue != 0;
            if (curArmed != snapArmed) {
                _adjustScopeCount(pid, snapArmed);
            }
        }
        if (e.present) {
            inst.walletPolicies[e.wallet][pid] = e.policyValue;
            inst.walletPolicySet[e.wallet][pid] = true;
        } else {
            delete inst.walletPolicies[e.wallet][pid];
            delete inst.walletPolicySet[e.wallet][pid];
        }
    }

    function _adjustScopeCount(bytes32 key, bool increment) private {
        ComplianceConfigStorage.Layout storage c = ComplianceConfigStorage.layout();
        if (key == ComplianceRequirementLib.KYC_ENFORCE_ACTIVE) {
            if (increment) { c.kycScopeCount += 1; } else { c.kycScopeCount -= 1; }
        } else if (key == ComplianceRequirementLib.CIP_ENFORCE_ACTIVE) {
            if (increment) { c.cipScopeCount += 1; } else { c.cipScopeCount -= 1; }
        } else if (key == ComplianceRequirementLib.TRAVEL_RULE_ENFORCE_ACTIVE) {
            if (increment) { c.travelRuleScopeCount += 1; } else { c.travelRuleScopeCount -= 1; }
        }
    }

    function _isBooleanRequirementControl(bytes32 key) private pure returns (bool) {
        return key == ComplianceRequirementLib.KYC_ENFORCE_ACTIVE
            || key == ComplianceRequirementLib.CIP_ENFORCE_ACTIVE
            || key == ComplianceRequirementLib.TRAVEL_RULE_ENFORCE_ACTIVE;
    }

    function _policyKeys() private pure returns (bytes32[8] memory k) {
        k[0] = CANCEL_OOB_THRESHOLD_USD;
        k[1] = SHORTEN_OOB_REQUIRED;
        k[2] = DUAL_APPROVAL_THRESHOLD_USD;
        k[3] = MAX_HALFLIFE_ADJUSTMENTS;
        k[4] = ComplianceRequirementLib.KYC_ENFORCE_ACTIVE;
        k[5] = ComplianceRequirementLib.CIP_ENFORCE_ACTIVE;
        k[6] = ComplianceRequirementLib.TRAVEL_RULE_ENFORCE_ACTIVE;
        k[7] = ComplianceRequirementLib.TRAVEL_RULE_THRESHOLD_USD;
    }
}
