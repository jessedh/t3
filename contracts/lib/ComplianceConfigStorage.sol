// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library ComplianceConfigStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.compliance-config.v1");

    struct Layout {
        bool kycEnforceActive;       // legacy; authoritative for nothing after 8E-1
        bool screeningEnforceActive; // legacy; authoritative for nothing after 8E-1
        bool travelRuleEnforceActive;// legacy; authoritative for nothing after 8E-1
        bool cipEnforceActive;       // legacy; reserved (8E-2)
        // --- 8E-1 tail-append ---
        // CF-R Obs-1: retired — the single counter made arming ANY control activate
        // ALL of them (e.g. travel rule armed alone switched on sanctions screening).
        // Slot preserved; never reuse. Live gating uses the per-control counters below.
        uint256 retired_activeScopeCount;
        // --- CF-R Obs-1 tail-append: per-control arming counters ---
        uint256 sanctionsScopeCount;  // fed by ComplianceScreeningFacet.setInstitutionSanctionsEnabled (DP-A)
        uint256 kycScopeCount;        // fed by InstitutionPolicyFacet (kyc_enforce_active)
        uint256 cipScopeCount;        // fed by InstitutionPolicyFacet (cip_enforce_active)
        uint256 travelRuleScopeCount; // fed by InstitutionPolicyFacet (travel_rule_enforce_active)
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly { l.slot := slot }
    }
}
