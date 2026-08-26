// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { InstitutionLifecycleStorage } from "./InstitutionLifecycleStorage.sol";
import { ConsortiumStorage }            from "./ConsortiumStorage.sol";
import { WalletRecoveryStorage }        from "./WalletRecoveryStorage.sol";

library BankingEligibilityLib {

    error InstitutionInactive(address institution);
    error InstitutionModeBlocksRiskIncrease(
        address institution,
        InstitutionLifecycleStorage.InstitutionMode mode
    );
    error InstitutionModeBlocksAllOps(
        address institution,
        InstitutionLifecycleStorage.InstitutionMode mode
    );
    error WalletInRecovery(address wallet);
    error InstitutionInRecovery(address institution);

    // ─────────────────────────────────────────────────────────────────────────
    // requireEligibleWallet
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Check that a wallet can receive or hold T3.
    ///
    ///  Current checks:
    ///   - wallet must not be in active recovery
    ///   - if the wallet is itself a registered bank, that bank must be active
    ///
    ///  Deferred to Wave 3B.2:
    ///   - non-bank wallet affiliation lookup via CustodianRegistryFacet
    ///   - KYC expiry check
    ///
    ///  DESIGN NOTE: institution mode is intentionally NOT checked here.
    ///  requireEligibleWallet guards the receive/hold side; institution-mode
    ///  restrictions (ISSUANCE_PAUSED, ORDERLY_EXIT, DEFAULT) only block the
    ///  ISSUER side, gated via requireRiskIncreasingInstitution.
    ///
    /// @return institutionId  The bank this wallet is affiliated with,
    ///                        or address(0) for non-bank wallets (Wave 3B.2 wires this).
    function requireEligibleWallet(address wallet) internal view returns (address institutionId) {
        WalletRecoveryStorage.Layout storage wr = WalletRecoveryStorage.layout();
        if (wr.activeRecoveryCount[wallet] > 0) {
            revert WalletInRecovery(wallet);
        }
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        if (cs.activeBanks[wallet]) {
            institutionId = wallet;
            // active check is already true (activeBanks[wallet] == true)
        }
        // Non-bank wallets: institutionId = address(0), no further check until Wave 3B.2
    }

    // ─────────────────────────────────────────────────────────────────────────
    // requireRiskIncreasingInstitution
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Check that an institution can perform risk-increasing operations
    ///         (issuance, reserve pledge, wallet linking, sponsorship).
    ///
    ///  Requirements:
    ///   - activeBanks[institution] must be true
    ///   - activeRecoveryCount[institution] must be 0
    ///   - institutionMode must be ACTIVE
    function requireRiskIncreasingInstitution(address institution) internal view {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        if (!cs.activeBanks[institution]) {
            revert InstitutionInactive(institution);
        }
        WalletRecoveryStorage.Layout storage wr = WalletRecoveryStorage.layout();
        if (wr.activeRecoveryCount[institution] > 0) {
            revert InstitutionInRecovery(institution);
        }
        InstitutionLifecycleStorage.InstitutionMode mode =
            InstitutionLifecycleStorage.layout().institutionMode[institution];
        if (mode != InstitutionLifecycleStorage.InstitutionMode.ACTIVE) {
            revert InstitutionModeBlocksRiskIncrease(institution, mode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // requireRiskReducingInstitution
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Check that an institution can perform risk-reducing operations
    ///         (redemption, attributed burn, settlement completion, collateral enforcement).
    ///
    ///  ACTIVE, ISSUANCE_PAUSED, ORDERLY_EXIT, DEFAULT → all permit risk-reducing ops.
    ///  Only RESOLVED blocks all further operations.
    ///
    ///  Recovery is NOT checked here: a wallet under active recovery may still need
    ///  to complete pending redemptions. Recovery-specific guards live in the facets.
    function requireRiskReducingInstitution(address institution) internal view {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        if (!cs.activeBanks[institution]) {
            revert InstitutionInactive(institution);
        }
        InstitutionLifecycleStorage.InstitutionMode mode =
            InstitutionLifecycleStorage.layout().institutionMode[institution];
        if (mode == InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
            revert InstitutionModeBlocksAllOps(institution, mode);
        }
    }
}
