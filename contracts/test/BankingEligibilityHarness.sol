// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { BankingEligibilityLib }         from "../lib/BankingEligibilityLib.sol";
import { ConsortiumStorage }              from "../lib/ConsortiumStorage.sol";
import { WalletRecoveryStorage }          from "../lib/WalletRecoveryStorage.sol";
import { InstitutionLifecycleStorage }    from "../lib/InstitutionLifecycleStorage.sol";

/// @dev Test harness for BankingEligibilityLib.
///      Provides setters that write directly to the namespaced storage slots
///      so tests can configure state without the full Diamond fixture.
contract BankingEligibilityHarness {

    // ─── Error re-exports (so test can reference via harness) ─────────────────
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

    // ─── Storage setters ──────────────────────────────────────────────────────

    function setActiveBanks(address bank, bool active) external {
        ConsortiumStorage.layout().activeBanks[bank] = active;
    }

    function setActiveRecoveryCount(address wallet, uint256 count) external {
        WalletRecoveryStorage.layout().activeRecoveryCount[wallet] = count;
    }

    function setInstitutionMode(
        address institution,
        InstitutionLifecycleStorage.InstitutionMode mode
    ) external {
        InstitutionLifecycleStorage.layout().institutionMode[institution] = mode;
    }

    // ─── Functions under test ─────────────────────────────────────────────────

    function callRequireEligibleWallet(address wallet) external view returns (address) {
        return BankingEligibilityLib.requireEligibleWallet(wallet);
    }

    function callRequireRiskIncreasingInstitution(address institution) external view {
        BankingEligibilityLib.requireRiskIncreasingInstitution(institution);
    }

    function callRequireRiskReducingInstitution(address institution) external view {
        BankingEligibilityLib.requireRiskReducingInstitution(institution);
    }
}
