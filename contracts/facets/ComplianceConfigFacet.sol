// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { ComplianceConfigStorage } from "../lib/ComplianceConfigStorage.sol";
import { ScreeningStorage } from "../lib/ScreeningStorage.sol";
import { IInstitutionPolicy } from "../interfaces/IInstitutionManager.sol";

contract ComplianceConfigFacet is ReentrancyGuardBase {
    event ComplianceGateSet(bytes32 indexed gate, bool active, address indexed admin);

    error Deprecated();

    bytes32 internal constant KYC_GATE = keccak256("KYC");
    bytes32 internal constant SCREENING_GATE = keccak256("SCREENING");
    bytes32 internal constant TRAVEL_RULE_GATE = keccak256("TRAVEL_RULE");
    bytes32 internal constant CIP_GATE = keccak256("CIP");

    // Wave 8E-1 — authoritative policy keys for the legacy getters.
    bytes32 internal constant KYC_ENFORCE_ACTIVE = keccak256("kyc_enforce_active");
    bytes32 internal constant TRAVEL_RULE_ENFORCE_ACTIVE = keccak256("travel_rule_enforce_active");
    bytes32 internal constant CIP_ENFORCE_ACTIVE = keccak256("cip_enforce_active");

    function setKycEnforceActive(bool) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender);
        revert Deprecated();
    }

    function setScreeningEnforceActive(bool) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender);
        revert Deprecated();
    }

    function setTravelRuleEnforceActive(bool) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender);
        revert Deprecated();
    }

    function setCipEnforceActive(bool) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender);
        revert Deprecated();
    }

    function isKycEnforceActive() external view returns (bool) {
        return IInstitutionPolicy(address(this)).getNetworkPolicy(KYC_ENFORCE_ACTIVE) != 0;
    }

    function isScreeningEnforceActive() external view returns (bool) {
        // Wave 8E-1: sanctions enablement moved off the policy stack to the
        // per-institution bit in ScreeningStorage. Returns true when at least
        // one institution has DP-A sanctions enforcement enabled.
        return ScreeningStorage.layout().sanctionsEnabledCount > 0;
    }

    function isTravelRuleEnforceActive() external view returns (bool) {
        return IInstitutionPolicy(address(this)).getNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE) != 0;
    }

    function isCipEnforceActive() external view returns (bool) {
        return IInstitutionPolicy(address(this)).getNetworkPolicy(CIP_ENFORCE_ACTIVE) != 0;
    }

    // CF-R Obs-1: the single counter was split into per-control counters so each
    // control is independently armable. activeScopeCount is kept as the sum for
    // observability; gating never reads it.
    function activeScopeCount() external view returns (uint256) {
        ComplianceConfigStorage.Layout storage c = ComplianceConfigStorage.layout();
        return c.sanctionsScopeCount + c.kycScopeCount + c.cipScopeCount + c.travelRuleScopeCount;
    }

    function complianceArmed() external view returns (bool) {
        ComplianceConfigStorage.Layout storage c = ComplianceConfigStorage.layout();
        return c.sanctionsScopeCount > 0 || c.kycScopeCount > 0
            || c.cipScopeCount > 0 || c.travelRuleScopeCount > 0;
    }

    function sanctionsScopeCount() external view returns (uint256) {
        return ComplianceConfigStorage.layout().sanctionsScopeCount;
    }

    function kycScopeCount() external view returns (uint256) {
        return ComplianceConfigStorage.layout().kycScopeCount;
    }

    function cipScopeCount() external view returns (uint256) {
        return ComplianceConfigStorage.layout().cipScopeCount;
    }

    function travelRuleScopeCount() external view returns (uint256) {
        return ComplianceConfigStorage.layout().travelRuleScopeCount;
    }
}
