// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "./StorageLib.sol";
import { InstitutionStorage } from "./InstitutionStorage.sol";
import { InstitutionLifecycleStorage } from "./InstitutionLifecycleStorage.sol";
import { WalletRecoveryStorage } from "./WalletRecoveryStorage.sol";

/**
 * @title ComplianceStatusLib
 * @notice Canonical KYC/compliance status resolver used by all KYC consumers.
 * @dev Internal library with no storage of its own. Reads from the diamond's
 *      AppStorage plus isolated institution and recovery storage libraries.
 */
library ComplianceStatusLib {
    /// @notice Direct KYC status of a wallet (no recovery resolution).
    ///         Valid = KYC timestamps current AND affiliation not Suspended/Revoked AND
    ///         the custodian's institution not DEFAULTED/RESOLVED. Superset of CustodianRegistry.isKYCValid.
    function kycStatusOf(StorageLib.AppStorage storage ds, address user) internal view returns (bool) {
        StorageLib.CustodyData storage cd = ds._custodyInfo[user];
        // base time-checked KYC (same logic as CustodianRegistryFacet.isKYCValid)
        if (!(cd.kycValidatedTimestamp > 0 && (cd.kycExpiresTimestamp == 0 || cd.kycExpiresTimestamp >= block.timestamp))) {
            return false;
        }
        // explicit wallet affiliation suspension/revocation invalidates
        InstitutionStorage.WalletAffiliation storage aff = InstitutionStorage.layout().walletAffiliations[user];
        if (aff.status == InstitutionStorage.WalletAffiliationStatus.Suspended ||
            aff.status == InstitutionStorage.WalletAffiliationStatus.Revoked) {
            return false;
        }
        // custodian institution in a risk-blocking lifecycle mode invalidates member wallets
        InstitutionLifecycleStorage.InstitutionMode mode =
            InstitutionLifecycleStorage.layout().institutionMode[cd.custodian];
        if (mode == InstitutionLifecycleStorage.InstitutionMode.DEFAULTED ||
            mode == InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
            return false;
        }
        return true;
    }

    /// @notice Recovery-aware effective KYC status: judges the wallet that would actually receive value
    ///         (the resolved recovery payee). Used by transfer-party / half-life reads.
    function effectiveKycStatus(StorageLib.AppStorage storage ds, address user) internal view returns (bool) {
        address subject = WalletRecoveryStorage._resolveRecoveryPayee(user);
        return kycStatusOf(ds, subject);
    }

    /// @notice Direct CIP status of a wallet (no recovery resolution). Task 5.2 (CF-3b).
    ///         Valid = CIP record present AND the attesting custodian's institution not
    ///         DEFAULTED/RESOLVED (mirrors kycStatusOf lifecycle-awareness; Task 7.2 blocks
    ///         NEW attestations from defaulted institutions, this invalidates EXISTING ones
    ///         for gating). No affiliation check: CIP records that the identification
    ///         program was performed; standing is KYC's concern.
    function cipStatusOf(StorageLib.AppStorage storage ds, address user) internal view returns (bool) {
        StorageLib.CustodyData storage cd = ds._custodyInfo[user];
        if (cd.cipCompletedAt == 0) {
            return false;
        }
        InstitutionLifecycleStorage.InstitutionMode mode =
            InstitutionLifecycleStorage.layout().institutionMode[cd.custodian];
        if (mode == InstitutionLifecycleStorage.InstitutionMode.DEFAULTED ||
            mode == InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
            return false;
        }
        return true;
    }

    /// @notice Recovery-aware effective CIP status: resolves the recovery payee first,
    ///         then applies cipStatusOf. Mirrors effectiveKycStatus.
    function effectiveCipStatus(StorageLib.AppStorage storage ds, address user) internal view returns (bool) {
        address subject = WalletRecoveryStorage._resolveRecoveryPayee(user);
        return cipStatusOf(ds, subject);
    }
}
