// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { InstitutionStorage } from "./InstitutionStorage.sol";
import { ScreeningStorage } from "./ScreeningStorage.sol";
import { StorageLib } from "./StorageLib.sol";
import { ComplianceLib } from "./ComplianceLib.sol";
import { ComplianceConfigStorage } from "./ComplianceConfigStorage.sol";
import { ComplianceRequirementLib } from "./ComplianceRequirementLib.sol";
import { ComplianceStatusLib } from "./ComplianceStatusLib.sol";
import { CambioEnvelopeStorage } from "./CambioEnvelopeStorage.sol";
import { TravelRuleStorage } from "./TravelRuleStorage.sol";
import { WalletRecoverySnapshotLib } from "./WalletRecoverySnapshotLib.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title WalletRecoverySanctionsLib
 * @notice External library for migrating sanctions, affiliation, and scoped
 *         screening state during wallet recovery. Called via DELEGATECALL from
 *         WalletRecoveryFacet so diamond storage and msg.sender are preserved.
 */
library WalletRecoverySanctionsLib {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    // Envelope-ops policy keys (canonical declarations in InstitutionPolicyFacet;
    // duplicated-by-keccak here like ComplianceRequirementLib duplicates the
    // requirement-control keys). Together with the 4 requirement-control keys
    // these form the full 8-key wallet-policy family for DP-5.0-D auto-merge.
    bytes32 private constant CANCEL_OOB_THRESHOLD_USD = keccak256("cancel_oob_threshold_usd");
    bytes32 private constant SHORTEN_OOB_REQUIRED = keccak256("shorten_oob_required");
    bytes32 private constant DUAL_APPROVAL_THRESHOLD_USD = keccak256("dual_approval_threshold_usd");
    bytes32 private constant MAX_HALFLIFE_ADJUSTMENTS = keccak256("max_halflife_adjustments");

    /**
     * @dev ESCROW_RELEASE compliance gate for bulk recovery resolutions
     *      (fiat-confirm burns and Cambio-note releases), matching the
     *      normal-path release checks. Lives here — external, DELEGATECALLed —
     *      so the logic does not grow WalletRecoveryFacet past EIP-170.
     *      Despite living in the sanctions lib, this runs the FULL armed
     *      precheck gate (sanctions + KYC + CIP) via precheckGated, exactly
     *      like every other ESCROW_RELEASE call site.
     */
    function precheckEscrowRelease(address from, address to, uint256 amount) external view {
        ComplianceLib.precheckGated(
            StorageLib.diamondStorage(), from, to, amount, ComplianceLib.Context.ESCROW_RELEASE
        );
    }

    /**
     * @dev Atomic migration of compliance state to a recovery successor:
     *      sanctions/affiliation (network screening, institution affiliation,
     *      scoped screening for the active affiliation institution), CIP status,
     *      the Cambio issuer profile, and the pending travel-rule commitment,
     *      from oldWallet to newWallet.
     *      Merge-most-restrictive: never downgrades a pre-seeded successor record,
     *      never silently drops source state, and reverts on irreconcilable clearance
     *      conflicts where no natural ordering exists.
     *
     *      Task 5.3: before any move, both wallets' pre-move records are journaled
     *      via WalletRecoverySnapshotLib so a reversible cancelRecovery can restore
     *      them bit-identically. Also owns the Cambio issuer profile transfer
     *      (moved here from the facet — EIP-170 freeze).
     */
    function migrateComplianceStateToSuccessor(
        bytes32 recoveryId,
        address oldWallet,
        address newWallet
    ) external {
        if (oldWallet == address(0) || newWallet == address(0) || oldWallet == newWallet) {
            return;
        }

        // Snapshot BEFORE any move (Task 5.3, DP-5.0-A/C).
        WalletRecoverySnapshotLib.snapshotBothSides(recoveryId, oldWallet, newWallet);

        ScreeningStorage.Layout storage s = ScreeningStorage.layout();
        InstitutionStorage.Layout storage inst = InstitutionStorage.layout();

        // Network screening
        // Merge-most-restrictive: BLOCKED > FLAGGED > CLEAR > NONE. The facet-level
        // _requireNotNetworkBlockedForMigration guard prevents migration when either
        // wallet is network-BLOCKED; this block preserves FLAGGED/CLEAR ordering.
        ScreeningStorage.Screening storage oldNetwork = s.screenings[oldWallet];
        if (oldNetwork.status != uint8(ScreeningStorage.ScreeningStatus.NONE)) {
            ScreeningStorage.Screening storage newNetwork = s.screenings[newWallet];
            if (
                newNetwork.status == uint8(ScreeningStorage.ScreeningStatus.NONE) ||
                _isMoreRestrictiveScreening(oldNetwork.status, newNetwork.status)
            ) {
                s.screenings[newWallet] = oldNetwork;
            }
            delete s.screenings[oldWallet];
        }

        // Network false-positive clearance record.
        // ClearedAt is the non-zero sentinel. There is no natural restrictiveness ordering
        // between two differing clearance records, so a conflict is fail-closed: revert and
        // require manual admin resolution. Identical records are treated as a no-op.
        ScreeningStorage.NetworkClearance storage oldClearance = s.networkClearances[oldWallet];
        if (oldClearance.clearedAt != 0) {
            ScreeningStorage.NetworkClearance storage newClearance = s.networkClearances[newWallet];
            if (newClearance.clearedAt == 0) {
                s.networkClearances[newWallet] = oldClearance;
            } else if (
                oldClearance.clearedAt != newClearance.clearedAt ||
                oldClearance.clearedBy != newClearance.clearedBy ||
                oldClearance.reasonHash != newClearance.reasonHash ||
                oldClearance.previousStatus != newClearance.previousStatus
            ) {
                revert IWalletRecovery.SuccessorStateConflict(newWallet, bytes32("NetworkClearance"));
            }
            delete s.networkClearances[oldWallet];
        }

        // Wallet affiliation (only one active affiliation can exist).
        // Merge-most-restrictive: Revoked > Suspended > Active > None.
        InstitutionStorage.WalletAffiliation storage oldAff = inst.walletAffiliations[oldWallet];
        if (oldAff.status != InstitutionStorage.WalletAffiliationStatus.None) {
            InstitutionStorage.WalletAffiliation storage newAff = inst.walletAffiliations[newWallet];
            if (
                newAff.status == InstitutionStorage.WalletAffiliationStatus.None ||
                _isMoreRestrictiveAffiliation(uint8(oldAff.status), uint8(newAff.status))
            ) {
                inst.walletAffiliations[newWallet] = oldAff;
            }
            delete inst.walletAffiliations[oldWallet];
        }

        // Scoped screenings across all institutions that have screened this wallet.
        // Snapshot the enumerable set to memory before mutating it; OZ remove() swaps the
        // last element into the vacated slot, so iterating while removing skips entries
        // and can read past the shrinking length.
        EnumerableSet.Bytes32Set storage scopedInsts = s.walletScopedInstitutions[oldWallet];
        bytes32[] memory ids = scopedInsts.values();
        for (uint256 i = 0; i < ids.length; ) {
            bytes32 institutionId = ids[i];
            ScreeningStorage.Screening storage oldScoped = s.scopedScreenings[institutionId][oldWallet];
            if (oldScoped.status != uint8(ScreeningStorage.ScreeningStatus.NONE)) {
                ScreeningStorage.Screening storage newScoped = s.scopedScreenings[institutionId][newWallet];
                bool upgrade = newScoped.status == uint8(ScreeningStorage.ScreeningStatus.NONE) ||
                    _isMoreRestrictiveScreening(oldScoped.status, newScoped.status);
                if (upgrade) {
                    s.scopedScreenings[institutionId][newWallet] = oldScoped;
                }
                delete s.scopedScreenings[institutionId][oldWallet];
                if (upgrade) {
                    s.walletScopedInstitutions[newWallet].add(institutionId);
                }
            }
            scopedInsts.remove(institutionId);
            unchecked { ++i; }
        }

        // Wallet-policy auto-merge (DP-5.0-D, ratified 2026-07-05): all 8 wallet-policy
        // keys merge most-restrictive at designation/redirect, so policies join the
        // snapshot families and the manual migrateInstitutionState helper becomes an
        // idempotent no-op for already-merged keys.
        _mergePolicy(oldWallet, newWallet, CANCEL_OOB_THRESHOLD_USD);
        _mergePolicy(oldWallet, newWallet, SHORTEN_OOB_REQUIRED);
        _mergePolicy(oldWallet, newWallet, DUAL_APPROVAL_THRESHOLD_USD);
        _mergePolicy(oldWallet, newWallet, MAX_HALFLIFE_ADJUSTMENTS);
        _mergePolicy(oldWallet, newWallet, ComplianceRequirementLib.KYC_ENFORCE_ACTIVE);
        _mergePolicy(oldWallet, newWallet, ComplianceRequirementLib.CIP_ENFORCE_ACTIVE);
        _mergePolicy(oldWallet, newWallet, ComplianceRequirementLib.TRAVEL_RULE_ENFORCE_ACTIVE);
        _mergePolicy(oldWallet, newWallet, ComplianceRequirementLib.TRAVEL_RULE_THRESHOLD_USD);

        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        // Successor CIP eligibility (Task 5.2, CF-3c): when CIP is armed for the
        // successor's scope, the successor must carry its OWN CIP record — raw
        // cipStatusOf, mirroring the RECOVERY_MIGRATE raw-KYC convention. Evaluated
        // AFTER the policy merge (so an armed override inherited from the source
        // binds the successor) and BEFORE the record move below (so a copied
        // predecessor record can never satisfy it).
        if (ComplianceRequirementLib._cipRequired(newWallet) &&
            !ComplianceStatusLib.cipStatusOf(ds, newWallet)) {
            revert IWalletRecovery.SuccessorCipMissing(newWallet);
        }

        // CIP record move-and-merge (Task 5.2, CF-3). Copy the predecessor's record
        // only when the successor lacks its own; a successor with its own attested
        // record keeps it — differing record hashes are the NORMAL case (each
        // custodian attests independently), so no conflict-revert. Predecessor
        // fields are cleared either way (move semantics, like the families above).
        // No synthetic CIPRecorded/CIPRevoked events: those imply a custodian
        // attestation act; indexers derive migrations from the designation event.
        StorageLib.CustodyData storage oldCd = ds._custodyInfo[oldWallet];
        if (oldCd.cipCompletedAt != 0) {
            StorageLib.CustodyData storage newCd = ds._custodyInfo[newWallet];
            if (newCd.cipCompletedAt == 0) {
                newCd.cipCompletedAt = oldCd.cipCompletedAt;
                newCd.cipRecordHash = oldCd.cipRecordHash;
            }
            oldCd.cipCompletedAt = 0;
            oldCd.cipRecordHash = bytes32(0);
        }

        // Cambio issuer profile transfer (moved from WalletRecoveryFacet, Task 5.3).
        // The successor's rolling ceiling buckets are RESET, not carried: usage
        // history is per-wallet, and a fresh window fails closed against ceilings.
        CambioEnvelopeStorage.Layout storage cl = CambioEnvelopeStorage.layout();
        if (cl.issuerProfiles[oldWallet].isActive) {
            cl.issuerProfiles[newWallet] = cl.issuerProfiles[oldWallet];
            delete cl.issuerProfiles[oldWallet];

            CambioEnvelopeStorage.RollingCeilingBuckets storage newBuckets =
                cl.issuerCeilingBuckets[newWallet];
            newBuckets.lastUpdatedHour = block.timestamp / 3600;
            for (uint256 i = 0; i < 24; i++) {
                newBuckets.buckets[i] = 0;
            }
            delete cl.issuerCeilingBuckets[oldWallet];
        }

        // Pending travel-rule commitment (wave-panel MED-1). Move-if-destination-
        // empty: a successor with its OWN staged commitment keeps it, and the
        // predecessor's record is left in place rather than silently dropped —
        // quarantine blocks predecessor creates during recovery, and after
        // completion the predecessor has no balance or roles, so the stranded
        // staging is inert and simply expires at its deadline. bindOnCreate's
        // pending lookup stays raw-keyed, so the moved record binds only
        // transfers the SUCCESSOR creates (the bound-commitment fields —
        // recipient/amount/objectType — still must match exactly).
        TravelRuleStorage.Layout storage t = TravelRuleStorage.layout();
        if (t.pending[oldWallet].ref != bytes32(0) &&
            t.pending[newWallet].ref == bytes32(0)) {
            t.pending[newWallet] = t.pending[oldWallet];
            delete t.pending[oldWallet];
        }
    }

    /**
     * @dev Task 5.1 (CF-3a): merge-most-restrictive wallet-policy migration,
     *      replacing the copy-only-if-unset rule that let a looser pre-seeded
     *      successor override survive recovery.
     *
     *      Per-key direction (Task 2.2 relax-direction table):
     *      - boolean requirement controls (kyc/cip/travel_rule_enforce_active):
     *        armed (nonzero) is stricter than 0. When BOTH sides carried an armed
     *        override, the dedupe removes one armed wallet-scope, so the global
     *        arming counter is decremented to match (a stale counter would keep
     *        the control armed network-wide with no live scope).
     *      - travel_rule_threshold_usd: 0 = enforce-all (strictest); otherwise
     *        the lower threshold screens more transfers.
     *      - all other keys have no restrictiveness ordering: differing values
     *        fail closed with SuccessorStateConflict (NetworkClearance precedent),
     *        equal values dedupe.
     */
    function mergeWalletPolicies(
        address oldWallet,
        address newWallet,
        bytes32[] calldata policyIds
    ) external {
        for (uint256 i = 0; i < policyIds.length; i++) {
            _mergePolicy(oldWallet, newWallet, policyIds[i]);
        }
    }

    /// @dev Single-key merge-most-restrictive move. Skips keys the source never
    ///      explicitly set, so re-running after the designation-time auto-merge
    ///      (DP-5.0-D) is an idempotent no-op.
    function _mergePolicy(address oldWallet, address newWallet, bytes32 pid) private {
        InstitutionStorage.Layout storage inst = InstitutionStorage.layout();
        if (!inst.walletPolicySet[oldWallet][pid]) return;
        uint256 oldVal = inst.walletPolicies[oldWallet][pid];

        if (!inst.walletPolicySet[newWallet][pid]) {
            // Plain move — the armed scope (if any) moves 1:1, no counter delta.
            inst.walletPolicies[newWallet][pid] = oldVal;
            inst.walletPolicySet[newWallet][pid] = true;
        } else {
            uint256 newVal = inst.walletPolicies[newWallet][pid];
            if (_isBooleanRequirementControl(pid)) {
                if (oldVal != 0 && newVal == 0) {
                    inst.walletPolicies[newWallet][pid] = oldVal;
                } else if (oldVal != 0 && newVal != 0) {
                    _decrementScopeCount(pid);
                }
                // oldVal == 0: successor is already at least as strict.
            } else if (pid == ComplianceRequirementLib.TRAVEL_RULE_THRESHOLD_USD) {
                uint256 merged = (oldVal == 0 || newVal == 0)
                    ? 0
                    : (oldVal < newVal ? oldVal : newVal);
                inst.walletPolicies[newWallet][pid] = merged;
            } else if (oldVal != newVal) {
                revert IWalletRecovery.SuccessorStateConflict(newWallet, pid);
            }
        }

        delete inst.walletPolicies[oldWallet][pid];
        delete inst.walletPolicySet[oldWallet][pid];
    }

    function _isBooleanRequirementControl(bytes32 key) private pure returns (bool) {
        return key == ComplianceRequirementLib.KYC_ENFORCE_ACTIVE
            || key == ComplianceRequirementLib.CIP_ENFORCE_ACTIVE
            || key == ComplianceRequirementLib.TRAVEL_RULE_ENFORCE_ACTIVE;
    }

    function _decrementScopeCount(bytes32 key) private {
        ComplianceConfigStorage.Layout storage c = ComplianceConfigStorage.layout();
        if (key == ComplianceRequirementLib.KYC_ENFORCE_ACTIVE) {
            c.kycScopeCount -= 1;
        } else if (key == ComplianceRequirementLib.CIP_ENFORCE_ACTIVE) {
            c.cipScopeCount -= 1;
        } else if (key == ComplianceRequirementLib.TRAVEL_RULE_ENFORCE_ACTIVE) {
            c.travelRuleScopeCount -= 1;
        }
    }

    function _isMoreRestrictiveScreening(uint8 oldStatus, uint8 newStatus) private pure returns (bool) {
        return oldStatus > newStatus;
    }

    function _isMoreRestrictiveAffiliation(uint8 oldStatus, uint8 newStatus) private pure returns (bool) {
        return oldStatus > newStatus;
    }
}
