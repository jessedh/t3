// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "./StorageLib.sol";
import { ComplianceLib } from "./ComplianceLib.sol";
import { ComplianceConfigStorage } from "./ComplianceConfigStorage.sol";
import { ComplianceStatusLib } from "./ComplianceStatusLib.sol";
import { InstitutionStorage } from "./InstitutionStorage.sol";
import { InstitutionLifecycleStorage } from "./InstitutionLifecycleStorage.sol";
import { ConsortiumStorage } from "./ConsortiumStorage.sol";
import { WalletRecoveryStorage } from "./WalletRecoveryStorage.sol";
import { IInstitutionPolicy } from "../interfaces/IInstitutionManager.sol";

/**
 * @title ComplianceRequirementLib
 * @notice Requirement-control resolution (KYC / Travel Rule arming / CIP reserved).
 * @dev This is the relaxable side of the split: it MAY route through
 *      InstitutionPolicyFacet.getEffectivePolicy. Sanctions logic lives in
 *      ComplianceSanctionsLib and must never be routed through the resolver.
 *
 *      Task 4.1: refactored to the non-reverting predicate form. The single
 *      caller is ComplianceLib.check, which maps failures back onto the exact
 *      pre-refactor custom errors (ctx-preserving) via revertForReason. Per-ctx
 *      check ORDER is preserved exactly, including the RECOVERY_MIGRATE use of
 *      raw kycStatusOf (not effectiveKycStatus).
 */
library ComplianceRequirementLib {
    bytes32 public constant KYC_ENFORCE_ACTIVE = keccak256("kyc_enforce_active");
    bytes32 public constant TRAVEL_RULE_ENFORCE_ACTIVE = keccak256("travel_rule_enforce_active");
    bytes32 public constant CIP_ENFORCE_ACTIVE = keccak256("cip_enforce_active");
    bytes32 public constant TRAVEL_RULE_THRESHOLD_USD = keccak256("travel_rule_threshold_usd");

    function checkRequirements(
        StorageLib.AppStorage storage ds,
        address from,
        address to,
        uint256 /* amount */,
        ComplianceLib.Context ctx
    ) internal view returns (bool ok, address failingParty, bytes32 reasonCode) {
        // KYC checks: most-specific-wins per party. A party whose effective value is
        // 0 is exempt; a party whose effective value is nonzero must be KYC-valid.
        if (ctx == ComplianceLib.Context.WALLET_TRANSFER) {
            if (_kycRequired(from) && !_kycValid(ds, from)) {
                return (false, from, ComplianceLib.REASON_KYC_REQUIRED);
            }
            if (_kycRequired(to) && !_kycValid(ds, to)) {
                return (false, to, ComplianceLib.REASON_KYC_REQUIRED);
            }
            if (_cipRequired(from) && !_cipValid(ds, from)) {
                return (false, from, ComplianceLib.REASON_CIP_REQUIRED);
            }
            if (_cipRequired(to) && !_cipValid(ds, to)) {
                return (false, to, ComplianceLib.REASON_CIP_REQUIRED);
            }
        } else if (ctx == ComplianceLib.Context.ESCROW_IN) {
            if (_kycRequired(from) && !_kycValid(ds, from)) {
                return (false, from, ComplianceLib.REASON_KYC_REQUIRED);
            }
            if (_cipRequired(from) && !_cipValid(ds, from)) {
                return (false, from, ComplianceLib.REASON_CIP_REQUIRED);
            }
        } else if (ctx == ComplianceLib.Context.ESCROW_RELEASE) {
            if (_kycRequired(to) && !_kycValid(ds, to)) {
                return (false, to, ComplianceLib.REASON_KYC_REQUIRED);
            }
            if (_cipRequired(to) && !_cipValid(ds, to)) {
                return (false, to, ComplianceLib.REASON_CIP_REQUIRED);
            }
        } else if (ctx == ComplianceLib.Context.RECOVERY_MIGRATE) {
            // Raw kycStatusOf/cipStatusOf (NOT effective*): a successor must carry
            // its own attestations; inherited/effective status is insufficient here.
            if (_kycRequired(to) && !ComplianceStatusLib.kycStatusOf(ds, to)) {
                return (false, to, ComplianceLib.REASON_KYC_REQUIRED);
            }
            if (_cipRequired(to) && !ComplianceStatusLib.cipStatusOf(ds, to)) {
                return (false, to, ComplianceLib.REASON_CIP_REQUIRED);
            }
        } else if (ctx == ComplianceLib.Context.BANK_MINT) {
            if (_kycRequired(to) && !_bankEligible(to)) {
                return (false, to, ComplianceLib.REASON_BANK_NOT_ELIGIBLE);
            }
        }

        return (true, address(0), bytes32(0));
    }

    function _kycRequired(address wallet) internal view returns (bool) {
        // CF-R Obs-1: control runs iff its own counter is armed.
        if (ComplianceConfigStorage.layout().kycScopeCount == 0) return false;
        // Sprint 5 exit MED-1: arming must judge the same subject validity judges.
        // Designation MOVES wallet-scope overrides to the successor, so reading the
        // literal predecessor mid-recovery sees an unarmed key and skips the check.
        (uint256 value, ) = IInstitutionPolicy(address(this)).getEffectivePolicy(
            WalletRecoveryStorage._resolveRecoveryPayee(wallet),
            KYC_ENFORCE_ACTIVE
        );
        return value != 0;
    }

    function _kycValid(
        StorageLib.AppStorage storage ds,
        address wallet
    ) internal view returns (bool) {
        return ComplianceStatusLib.effectiveKycStatus(ds, wallet);
    }

    function _cipRequired(address wallet) internal view returns (bool) {
        // CF-R Obs-1: control runs iff its own counter is armed.
        if (ComplianceConfigStorage.layout().cipScopeCount == 0) return false;
        // Sprint 5 exit MED-1: resolve the payee before the arming read (see _kycRequired).
        (uint256 value, ) = IInstitutionPolicy(address(this)).getEffectivePolicy(
            WalletRecoveryStorage._resolveRecoveryPayee(wallet),
            CIP_ENFORCE_ACTIVE
        );
        return value != 0;
    }

    function _cipValid(
        StorageLib.AppStorage storage ds,
        address wallet
    ) internal view returns (bool) {
        // Task 5.2 (CF-3b): recovery-resolving + lifecycle-aware, mirroring _kycValid.
        // Pre-5.2 this read the literal wallet's cipCompletedAt, so a wallet in active
        // recovery kept passing CIP on its dead key while KYC/sanctions judged the payee.
        return ComplianceStatusLib.effectiveCipStatus(ds, wallet);
    }

    function _bankEligible(address bank) internal view returns (bool) {
        if (!ConsortiumStorage.layout().activeBanks[bank]) {
            return false;
        }

        InstitutionLifecycleStorage.InstitutionMode mode =
            InstitutionLifecycleStorage.layout().institutionMode[bank];
        if (mode == InstitutionLifecycleStorage.InstitutionMode.DEFAULTED ||
            mode == InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
            return false;
        }
        return true;
    }
}
