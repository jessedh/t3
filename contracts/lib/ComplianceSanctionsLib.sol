// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ScreeningStorage } from "./ScreeningStorage.sol";
import { InstitutionStorage } from "./InstitutionStorage.sol";
import { InstitutionLifecycleStorage } from "./InstitutionLifecycleStorage.sol";
import { WalletRecoveryStorage } from "./WalletRecoveryStorage.sol";
import { ComplianceLib } from "./ComplianceLib.sol";

/**
 * @title ComplianceSanctionsLib
 * @notice Sanctions/screening predicate: union / most-restrictive / non-exemptable.
 * @dev This library NEVER imports or calls InstitutionPolicyFacet/getEffectivePolicy.
 *      It reads only ScreeningStorage, InstitutionStorage affiliation/lifecycle, and
 *      the dedicated per-institution sanctions-enable bit (DP-A).
 *
 *      Task 4.1: refactored to the non-reverting predicate form. The single
 *      caller is ComplianceLib.check, which maps failures back onto the exact
 *      pre-refactor custom errors via revertForReason. Check ORDER is preserved
 *      exactly: network block (from, to) → freshness (from, to) → scoped block
 *      (from, to).
 */
library ComplianceSanctionsLib {
    function checkNotSanctioned(
        address from,
        address to,
        ComplianceLib.Context ctx
    ) internal view returns (bool ok, address failingParty, bytes32 reasonCode) {
        (bool checkFrom, bool checkTo) = _partySelection(ctx);

        // Cambio bearer notes escrow in with no predetermined recipient
        // (to == address(0)); there is no party to screen on that leg.
        if (to == address(0)) checkTo = false;

        address sFrom = checkFrom ? WalletRecoveryStorage._resolveRecoveryPayee(from) : address(0);
        address sTo   = checkTo   ? WalletRecoveryStorage._resolveRecoveryPayee(to)   : address(0);

        // 1. Network-binding block: non-exemptable, applies to each CHECKED party.
        if (checkFrom && _networkBlocked(sFrom)) {
            return (false, sFrom, ComplianceLib.REASON_SANCTIONED);
        }
        if (checkTo && _networkBlocked(sTo)) {
            return (false, sTo, ComplianceLib.REASON_SANCTIONED);
        }

        // 1b. C-F9 screening freshness. Reached only while sanctions are armed
        //     (ComplianceLib.check gates this call on sanctionsScopeCount > 0), and
        //     enforced only when an admin has configured a stale window. Under that
        //     armed freshness regime a never-screened party (lastScreenedAt == 0)
        //     fails closed — no record is worse than an expired one. Window 0
        //     (default) short-circuits and preserves prior behavior exactly.
        //     Deliberately stricter than the informational isScreeningStale() view,
        //     which reports false for never-screened wallets.
        uint40 staleAfter = ScreeningStorage.layout().screeningStaleAfter;
        if (staleAfter != 0) {
            if (checkFrom && _screeningStale(sFrom, staleAfter)) {
                return (false, sFrom, ComplianceLib.REASON_SCREENING_STALE);
            }
            if (checkTo && _screeningStale(sTo, staleAfter)) {
                return (false, sTo, ComplianceLib.REASON_SCREENING_STALE);
            }
        }

        // 2. Institution-scope block: bites only when the OTHER party is actively affiliated to
        //    an active, sanctions-enforcing institution that has blocked this party (P2 sovereignty).
        bytes32 fromInst = checkFrom ? _activeAffiliation(sFrom) : bytes32(0);
        bytes32 toInst   = checkTo   ? _activeAffiliation(sTo)   : bytes32(0);

        if (checkFrom && toInst != bytes32(0) && _institutionEnforcing(toInst)) {
            if (_scopedBlocked(toInst, sFrom) || _customerBlocked(toInst, sFrom)) {
                return (false, sFrom, ComplianceLib.REASON_SANCTIONED);
            }
        }
        if (checkTo && fromInst != bytes32(0) && _institutionEnforcing(fromInst)) {
            if (_scopedBlocked(fromInst, sTo) || _customerBlocked(fromInst, sTo)) {
                return (false, sTo, ComplianceLib.REASON_SANCTIONED);
            }
        }

        return (true, address(0), bytes32(0));
    }

    function _partySelection(
        ComplianceLib.Context ctx
    ) internal pure returns (bool checkFrom, bool checkTo) {
        if (ctx == ComplianceLib.Context.WALLET_TRANSFER) return (true, true);
        // K-F1: escrow creation screens the named recipient too, so a blocked
        // wallet cannot be designated payee of new escrow (fail-closed at intake).
        if (ctx == ComplianceLib.Context.ESCROW_IN)       return (true, true);
        if (ctx == ComplianceLib.Context.ESCROW_RELEASE)  return (false, true);
        if (ctx == ComplianceLib.Context.RECOVERY_MIGRATE)return (false, true);
        // BANK_MINT: recipient is screened (CF-1 narrowed). The minter leg is
        // deliberately unscreened: MINTER_ROLE is bank/admin-held in production (D5).
        return (false, true);
    }

    function _networkBlocked(address resolvedParty) internal view returns (bool) {
        // Caller must pass an already recovery-resolved address (checkNotSanctioned
        // resolves sFrom/sTo before calling). Avoid a second _resolveRecoveryPayee
        // to save gas and eliminate a latent correctness trap if resolution ever chains.
        return ScreeningStorage.layout().screenings[resolvedParty].status ==
            uint8(ScreeningStorage.ScreeningStatus.BLOCKED);
    }

    function _screeningStale(address resolvedParty, uint40 staleAfter) internal view returns (bool) {
        uint40 last = ScreeningStorage.layout().screenings[resolvedParty].lastScreenedAt;
        return last == 0 || block.timestamp > uint256(last) + staleAfter;
    }

    function _activeAffiliation(address party) internal view returns (bytes32) {
        InstitutionStorage.WalletAffiliation storage a =
            InstitutionStorage.layout().walletAffiliations[party];
        if (a.status == InstitutionStorage.WalletAffiliationStatus.Active) {
            return a.institutionId;
        }
        return bytes32(0);
    }

    function _institutionEnforcing(bytes32 institutionId) internal view returns (bool) {
        InstitutionStorage.Institution storage institution =
            InstitutionStorage.layout().institutions[institutionId];
        if (institution.status != InstitutionStorage.InstitutionStatus.Active) {
            return false;
        }

        address bank = InstitutionLifecycleStorage.layout().institutionIdToBank[institutionId];
        InstitutionLifecycleStorage.InstitutionMode mode =
            InstitutionLifecycleStorage.layout().institutionMode[bank];
        if (mode == InstitutionLifecycleStorage.InstitutionMode.DEFAULTED ||
            mode == InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
            return false;
        }

        return ScreeningStorage.layout().institutionSanctionsEnabled[institutionId];
    }

    function _scopedBlocked(bytes32 institutionId, address party) internal view returns (bool) {
        return ScreeningStorage.layout().scopedScreenings[institutionId][party].status ==
            uint8(ScreeningStorage.ScreeningStatus.BLOCKED);
    }

    function _customerBlocked(bytes32, address) internal pure returns (bool) {
        // 8E-1 stub: customer-subject layer lands in 8E-2 as a pure body change.
        return false;
    }
}
