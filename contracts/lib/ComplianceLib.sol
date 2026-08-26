// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "./StorageLib.sol";
import { ComplianceConfigStorage } from "./ComplianceConfigStorage.sol";
import { ComplianceSanctionsLib } from "./ComplianceSanctionsLib.sol";
import { ComplianceRequirementLib } from "./ComplianceRequirementLib.sol";
import { IComplianceGate } from "../interfaces/IComplianceGate.sol";

library ComplianceLib {
    enum Context {
        WALLET_TRANSFER,
        ESCROW_IN,
        ESCROW_RELEASE,
        BANK_MINT,
        RECOVERY_MIGRATE
    }

    error ComplianceKycRequired(address party, uint8 context);
    error ComplianceCIPRequired(address wallet, uint8 context);
    error ComplianceBankNotEligible(address bank);
    error ComplianceSanctioned(address party);
    error ComplianceScreeningStale(address party);
    error ComplianceUnknownReason(bytes32 reason);

    // Reason codes returned by the non-reverting predicate (Sprint 4, Task 4.1).
    // Each maps 1:1 onto one of the custom errors above via revertForReason so
    // the reverting path preserves exact pre-refactor error fidelity.
    bytes32 internal constant REASON_SANCTIONED        = "SANCTIONED";
    bytes32 internal constant REASON_SCREENING_STALE   = "SCREENING_STALE";
    bytes32 internal constant REASON_KYC_REQUIRED      = "KYC_REQUIRED";
    bytes32 internal constant REASON_CIP_REQUIRED      = "CIP_REQUIRED";
    bytes32 internal constant REASON_BANK_NOT_ELIGIBLE = "BANK_NOT_ELIGIBLE";

    /**
     * @notice Lightweight inline wrapper used by hooked facets.
     * @dev Safe to inline because it is small. The heavy branching is deferred to
     *      ComplianceGateFacet.enforceCompliance via an external call only when a
     *      gate is active, keeping caller facets under the EIP-170 limit.
     */
    function precheckGated(
        StorageLib.AppStorage storage ds,
        address from,
        address to,
        uint256 amount,
        Context ctx
    ) internal view {
        if (_anyPrecheckControlArmed()) {
            IComplianceGate(address(this)).enforceCompliance(from, to, amount, uint8(ctx));
        }
    }

    function precheck(
        StorageLib.AppStorage storage ds,
        address from,
        address to,
        uint256 amount,
        Context ctx
    ) internal view {
        (bool ok, address failingParty, bytes32 reasonCode) = check(ds, from, to, amount, ctx);
        if (!ok) {
            revertForReason(failingParty, reasonCode, ctx);
        }
    }

    /**
     * @notice Non-reverting compliance predicate (Task 4.1). Single source of
     *         truth for both the reverting funnel (precheck) and the hold path
     *         (ComplianceHoldLib.checkOrHold via ComplianceGateFacet.complianceCheck).
     * @dev Check order matches the pre-refactor reverting funnel exactly:
     *      sanctions first (iff armed), then KYC/CIP requirements (iff armed).
     *      CF-R Obs-1: per-control arming. Each control runs iff ITS counter is
     *      armed — arming travel rule (or KYC) alone must not switch on sanctions
     *      screening. Travel rule is not a precheck control; it enforces at
     *      creation via ComplianceTravelRuleLib.bindOnCreate.
     */
    function check(
        StorageLib.AppStorage storage ds,
        address from,
        address to,
        uint256 amount,
        Context ctx
    ) internal view returns (bool ok, address failingParty, bytes32 reasonCode) {
        ComplianceConfigStorage.Layout storage c = ComplianceConfigStorage.layout();
        if (c.sanctionsScopeCount > 0) {
            (ok, failingParty, reasonCode) = ComplianceSanctionsLib.checkNotSanctioned(from, to, ctx);
            if (!ok) return (false, failingParty, reasonCode);
        }
        if (c.kycScopeCount > 0 || c.cipScopeCount > 0) {
            (ok, failingParty, reasonCode) =
                ComplianceRequirementLib.checkRequirements(ds, from, to, amount, ctx);
            if (!ok) return (false, failingParty, reasonCode);
        }
        return (true, address(0), bytes32(0));
    }

    /**
     * @notice Map a predicate failure back onto the exact pre-refactor custom
     *         error, preserving ctx in the KYC/CIP errors (kimi MED-1).
     */
    function revertForReason(address party, bytes32 reasonCode, Context ctx) internal pure {
        if (reasonCode == REASON_SANCTIONED)        revert ComplianceSanctioned(party);
        if (reasonCode == REASON_SCREENING_STALE)   revert ComplianceScreeningStale(party);
        if (reasonCode == REASON_KYC_REQUIRED)      revert ComplianceKycRequired(party, uint8(ctx));
        if (reasonCode == REASON_CIP_REQUIRED)      revert ComplianceCIPRequired(party, uint8(ctx));
        if (reasonCode == REASON_BANK_NOT_ELIGIBLE) revert ComplianceBankNotEligible(party);
        // Fail closed on any reason code this mapping does not recognize.
        revert ComplianceUnknownReason(reasonCode);
    }

    function _anyPrecheckControlArmed() internal view returns (bool) {
        ComplianceConfigStorage.Layout storage c = ComplianceConfigStorage.layout();
        return c.sanctionsScopeCount > 0 || c.kycScopeCount > 0 || c.cipScopeCount > 0;
    }
}
