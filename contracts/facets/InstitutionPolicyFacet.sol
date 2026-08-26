// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { InstitutionStorage } from "../lib/InstitutionStorage.sol";
import { IInstitutionPolicy } from "../interfaces/IInstitutionManager.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { ComplianceConfigStorage } from "../lib/ComplianceConfigStorage.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";

contract InstitutionPolicyFacet is ReentrancyGuardBase, IInstitutionPolicy {
    // Canonical policy keys shared by contract + UI.
    bytes32 public constant CANCEL_OOB_THRESHOLD_USD =
        keccak256("cancel_oob_threshold_usd");
    bytes32 public constant SHORTEN_OOB_REQUIRED =
        keccak256("shorten_oob_required");
    bytes32 public constant DUAL_APPROVAL_THRESHOLD_USD =
        keccak256("dual_approval_threshold_usd");
    bytes32 public constant MAX_HALFLIFE_ADJUSTMENTS =
        keccak256("max_halflife_adjustments");

    // Wave 8E-1 — requirement-control policy keys (sanctions key is deliberately NOT here).
    bytes32 public constant KYC_ENFORCE_ACTIVE = keccak256("kyc_enforce_active");
    bytes32 public constant TRAVEL_RULE_ENFORCE_ACTIVE = keccak256("travel_rule_enforce_active");
    bytes32 public constant CIP_ENFORCE_ACTIVE = keccak256("cip_enforce_active");
    bytes32 public constant TRAVEL_RULE_THRESHOLD_USD = keccak256("travel_rule_threshold_usd");

    // C-F5: threshold policy values are denominated in 18-dec token units (1 token
    // = 1e18), the same units as the ERC-20 amounts they are compared against.
    // The "_usd" suffix in the key STRINGS above is historical labeling only —
    // renaming the strings would change the storage key hashes, so it stays.
    // $1,000,000 face value at 1 token = $1.
    uint256 internal constant DEFAULT_THRESHOLD_18DEC = 1_000_000e18;

    function setNetworkPolicy(bytes32 key, uint256 value) external nonReentrant {
        _requireGlobalAdmin();
        _requireValidPolicyKey(key);

        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        // CF-R Obs-2: lowering the network baseline for an enforcement-class key
        // is a relax and requires COMPLIANCE_EXEMPTION_ROLE; raising stays admin-only.
        _checkExemptionForRelax(bytes32(0), key, l.networkPolicies[key], value, bytes32(0));

        if (_isBooleanRequirementControl(key)) {
            bool wasArmed = l.networkPolicies[key] != 0;
            bool nowArmed = value != 0;
            _applyScopeDelta(key, wasArmed, nowArmed);
        }
        l.networkPolicies[key] = value;

        emit InstitutionStorage.NetworkPolicySet(key, value, msg.sender);
    }

    function setInstitutionPolicy(
        bytes32 institutionId,
        bytes32 key,
        uint256 value
    ) external nonReentrant {
        _requireValidPolicyKey(key);
        _requireInstitutionPolicyAdmin(institutionId);

        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        _checkExemptionForRelax(institutionId, key, l.networkPolicies[key], value, bytes32(0));

        if (_isBooleanRequirementControl(key)) {
            bool wasArmed = l.institutionPolicySet[institutionId][key] &&
                l.institutionPolicies[institutionId][key] != 0;
            bool nowArmed = value != 0;
            _applyScopeDelta(key, wasArmed, nowArmed);
        }
        // Keep explicit-set flag so "0" is treated as a valid override.
        l.institutionPolicies[institutionId][key] = value;
        l.institutionPolicySet[institutionId][key] = true;

        emit InstitutionStorage.InstitutionPolicySet(
            institutionId,
            key,
            value,
            msg.sender
        );
    }

    function setInstitutionPolicyWithReason(
        bytes32 institutionId,
        bytes32 key,
        uint256 value,
        bytes32 reasonHash
    ) external nonReentrant {
        _requireValidPolicyKey(key);
        _requireInstitutionPolicyAdmin(institutionId);

        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        _checkExemptionForRelax(institutionId, key, l.networkPolicies[key], value, reasonHash);

        if (_isBooleanRequirementControl(key)) {
            bool wasArmed = l.institutionPolicySet[institutionId][key] &&
                l.institutionPolicies[institutionId][key] != 0;
            bool nowArmed = value != 0;
            _applyScopeDelta(key, wasArmed, nowArmed);
        }
        l.institutionPolicies[institutionId][key] = value;
        l.institutionPolicySet[institutionId][key] = true;

        emit InstitutionStorage.InstitutionPolicySet(
            institutionId,
            key,
            value,
            msg.sender
        );
    }

    function clearInstitutionPolicy(
        bytes32 institutionId,
        bytes32 key
    ) external nonReentrant {
        _requireValidPolicyKey(key);
        _requireInstitutionPolicyAdmin(institutionId);

        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        // CF-R Obs-2 follow-up: clearing a tighter override reverts the scope to a
        // looser parent — the same effective relax as setting the parent value
        // directly, so it takes the same exemption gate (baseline = the override
        // being removed, proposal = the parent that takes effect after the clear).
        if (l.institutionPolicySet[institutionId][key]) {
            _checkExemptionForRelax(
                institutionId,
                key,
                l.institutionPolicies[institutionId][key],
                l.networkPolicies[key],
                bytes32(0)
            );
        }
        if (_isBooleanRequirementControl(key)) {
            bool wasArmed = l.institutionPolicySet[institutionId][key] &&
                l.institutionPolicies[institutionId][key] != 0;
            if (wasArmed) {
                _applyScopeDelta(key, true, false);
            }
        }
        delete l.institutionPolicies[institutionId][key];
        // Clearing resets explicit flag rather than inferring from numeric value.
        l.institutionPolicySet[institutionId][key] = false;

        emit InstitutionStorage.InstitutionPolicyCleared(
            institutionId,
            key,
            msg.sender
        );
    }

    function setWalletPolicy(
        address wallet,
        bytes32 key,
        uint256 value
    ) external nonReentrant {
        _requireDefaultAdmin();
        _requireValidPolicyKey(key);

        if (wallet == address(0)) {
            revert InstitutionStorage.ZeroAddressNotAllowed();
        }

        bytes32 scopeId = bytes32(uint256(uint160(wallet)));
        _checkExemptionForRelax(scopeId, key, _effectiveParentForWallet(wallet, key), value, bytes32(0));

        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        if (_isBooleanRequirementControl(key)) {
            bool wasArmed = l.walletPolicySet[wallet][key] &&
                l.walletPolicies[wallet][key] != 0;
            bool nowArmed = value != 0;
            _applyScopeDelta(key, wasArmed, nowArmed);
        }
        l.walletPolicies[wallet][key] = value;
        // Keep explicit-set flag so "0" is treated as a valid override.
        l.walletPolicySet[wallet][key] = true;

        emit InstitutionStorage.WalletPolicySet(wallet, key, value, msg.sender);
    }

    function setWalletPolicyWithReason(
        address wallet,
        bytes32 key,
        uint256 value,
        bytes32 reasonHash
    ) external nonReentrant {
        _requireDefaultAdmin();
        _requireValidPolicyKey(key);

        if (wallet == address(0)) {
            revert InstitutionStorage.ZeroAddressNotAllowed();
        }

        bytes32 scopeId = bytes32(uint256(uint160(wallet)));
        _checkExemptionForRelax(scopeId, key, _effectiveParentForWallet(wallet, key), value, reasonHash);

        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        if (_isBooleanRequirementControl(key)) {
            bool wasArmed = l.walletPolicySet[wallet][key] &&
                l.walletPolicies[wallet][key] != 0;
            bool nowArmed = value != 0;
            _applyScopeDelta(key, wasArmed, nowArmed);
        }
        l.walletPolicies[wallet][key] = value;
        l.walletPolicySet[wallet][key] = true;

        emit InstitutionStorage.WalletPolicySet(wallet, key, value, msg.sender);
    }

    function clearWalletPolicy(
        address wallet,
        bytes32 key
    ) external nonReentrant {
        _requireDefaultAdmin();
        _requireValidPolicyKey(key);

        if (wallet == address(0)) {
            revert InstitutionStorage.ZeroAddressNotAllowed();
        }

        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        // CF-R Obs-2 follow-up: same implicit-relax gate as clearInstitutionPolicy,
        // judged against the wallet's EFFECTIVE parent (institution override if
        // set, else network).
        if (l.walletPolicySet[wallet][key]) {
            _checkExemptionForRelax(
                bytes32(uint256(uint160(wallet))),
                key,
                l.walletPolicies[wallet][key],
                _effectiveParentForWallet(wallet, key),
                bytes32(0)
            );
        }
        if (_isBooleanRequirementControl(key)) {
            bool wasArmed = l.walletPolicySet[wallet][key] &&
                l.walletPolicies[wallet][key] != 0;
            if (wasArmed) {
                _applyScopeDelta(key, true, false);
            }
        }
        delete l.walletPolicies[wallet][key];
        // Clearing resets explicit flag rather than inferring from numeric value.
        l.walletPolicySet[wallet][key] = false;

        emit InstitutionStorage.WalletPolicyCleared(wallet, key, msg.sender);
    }

    /// @notice DELIBERATE PUBLIC EXCEPTION (wave-panel NOTE-1): the policy
    ///         getters below (getEffectivePolicy, getResolvedEffectivePolicy,
    ///         getNetworkPolicy, getInstitutionPolicyValue, getWalletPolicyValue)
    ///         carry NO view ACL, unlike the screening/CIP resolved views.
    ///         Policy values are operational configuration (enforcement gates,
    ///         thresholds), not wallet-scoped PII or screening verdicts — any
    ///         consortium participant must be able to read the rules it is
    ///         subject to before transacting. Recorded as an exception in the
    ///         cross-facet closure matrix; do not add ViewACLLib gating here
    ///         without revisiting that decision.
    function getEffectivePolicy(
        address wallet,
        bytes32 key
    ) external view returns (uint256 value, string memory source) {
        _requireValidPolicyKey(key);
        return _effectivePolicyOf(wallet, key);
    }

    /// @notice Task 5.4 (K-F7): effective policy for the recovery-RESOLVED payee.
    /// @dev Enforcement resolves the payee before judging policy; this view
    ///      mirrors that so mid-recovery reads match the write path. The raw
    ///      getEffectivePolicy is kept for ops reads of the literal address.
    function getResolvedEffectivePolicy(
        address wallet,
        bytes32 key
    ) external view returns (address resolvedWallet, uint256 value, string memory source) {
        _requireValidPolicyKey(key);
        resolvedWallet = WalletRecoveryStorage._resolveRecoveryPayee(wallet);
        (value, source) = _effectivePolicyOf(resolvedWallet, key);
    }

    function _effectivePolicyOf(
        address wallet,
        bytes32 key
    ) private view returns (uint256 value, string memory source) {
        InstitutionStorage.Layout storage l = InstitutionStorage.layout();

        // Precedence order is strict:
        // 1) wallet override, 2) institution override, 3) network default.
        if (l.walletPolicySet[wallet][key]) {
            return (l.walletPolicies[wallet][key], "wallet");
        }

        bytes32 institutionId = l.walletAffiliations[wallet].institutionId;
        if (
            institutionId != bytes32(0) &&
            l.institutionPolicySet[institutionId][key]
        ) {
            return (l.institutionPolicies[institutionId][key], "institution");
        }

        return (l.networkPolicies[key], "network");
    }

    function getNetworkPolicy(bytes32 key) external view returns (uint256) {
        _requireValidPolicyKey(key);
        return InstitutionStorage.layout().networkPolicies[key];
    }

    function getInstitutionPolicyValue(
        bytes32 institutionId,
        bytes32 key
    ) external view returns (uint256 value, bool isExplicitlySet) {
        _requireValidPolicyKey(key);
        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        return (
            l.institutionPolicies[institutionId][key],
            l.institutionPolicySet[institutionId][key]
        );
    }

    function getWalletPolicyValue(
        address wallet,
        bytes32 key
    ) external view returns (uint256 value, bool isExplicitlySet) {
        _requireValidPolicyKey(key);
        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        return (l.walletPolicies[wallet][key], l.walletPolicySet[wallet][key]);
    }

    function hasScopedRole(
        bytes32 role,
        address account,
        bytes32 institutionId
    ) external view returns (bool) {
        // Scoped roles are institution-local and do not imply global AccessControl roles.
        return InstitutionStorage.layout().scopedRoles[institutionId][role][account];
    }

    function grantScopedRole(
        bytes32 role,
        address account,
        bytes32 institutionId
    ) external nonReentrant {
        _requireScopedRoleAdmin(role, institutionId);
        _requireInstitutionExists(institutionId);

        if (account == address(0)) {
            revert InstitutionStorage.ZeroAddressNotAllowed();
        }

        InstitutionStorage.layout().scopedRoles[institutionId][role][account] = true;

        emit InstitutionStorage.ScopedRoleGranted(
            role,
            account,
            institutionId,
            msg.sender
        );
    }

    function revokeScopedRole(
        bytes32 role,
        address account,
        bytes32 institutionId
    ) external nonReentrant {
        _requireScopedRoleAdmin(role, institutionId);
        _requireInstitutionExists(institutionId);

        if (account == address(0)) {
            revert InstitutionStorage.ZeroAddressNotAllowed();
        }

        InstitutionStorage.layout().scopedRoles[institutionId][role][account] = false;

        emit InstitutionStorage.ScopedRoleRevoked(
            role,
            account,
            institutionId,
            msg.sender
        );
    }

    // TRAVEL_RULE_THRESHOLD_USD is intentionally NOT seeded here: arming the
    // travel-rule gate requires an operator to set an explicit threshold first,
    // and an unset (0) threshold with the gate ON enforces every create
    // fail-closed rather than silently applying a default.
    function initializeDefaultPolicies() external nonReentrant {
        _requireGlobalAdmin();

        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        l.networkPolicies[CANCEL_OOB_THRESHOLD_USD] = DEFAULT_THRESHOLD_18DEC;
        l.networkPolicies[SHORTEN_OOB_REQUIRED] = 1;
        l.networkPolicies[DUAL_APPROVAL_THRESHOLD_USD] = DEFAULT_THRESHOLD_18DEC;

        emit InstitutionStorage.NetworkPolicySet(
            CANCEL_OOB_THRESHOLD_USD,
            DEFAULT_THRESHOLD_18DEC,
            msg.sender
        );
        emit InstitutionStorage.NetworkPolicySet(
            SHORTEN_OOB_REQUIRED,
            1,
            msg.sender
        );
        emit InstitutionStorage.NetworkPolicySet(
            DUAL_APPROVAL_THRESHOLD_USD,
            DEFAULT_THRESHOLD_18DEC,
            msg.sender
        );
    }

    function _isGlobalAdmin(address account) internal view returns (bool) {
        // Cross-facet role lookup through the diamond.
        IAccessControl ac = IAccessControl(address(this));
        return
            ac.hasRole(RoleConstants.DEFAULT_ADMIN_ROLE, account) ||
            ac.hasRole(RoleConstants.ADMIN_ROLE, account);
    }

    function _requireGlobalAdmin() internal view {
        if (_isGlobalAdmin(msg.sender)) {
            return;
        }
        revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.ADMIN_ROLE);
    }

    function _requireDefaultAdmin() internal view {
        if (
            IAccessControl(address(this)).hasRole(
                RoleConstants.DEFAULT_ADMIN_ROLE,
                msg.sender
            )
        ) {
            return;
        }
        revert StorageLib.UnauthorizedRole(
            msg.sender,
            RoleConstants.DEFAULT_ADMIN_ROLE
        );
    }

    function _requireInstitutionPolicyAdmin(bytes32 institutionId) internal view {
        InstitutionStorage.Institution storage institution = _requireInstitutionExists(
            institutionId
        );

        if (_isGlobalAdmin(msg.sender)) {
            return;
        }

        IAccessControl ac = IAccessControl(address(this));
        if (
            institution.status == InstitutionStorage.InstitutionStatus.Active &&
            ac.hasRole(RoleConstants.INSTITUTION_ADMIN_ROLE, msg.sender) &&
            institution.adminAddress == msg.sender
        ) {
            return;
        }

        revert StorageLib.UnauthorizedRole(
            msg.sender,
            RoleConstants.INSTITUTION_ADMIN_ROLE
        );
    }

    function _requireScopedRoleAdmin(bytes32 role, bytes32 institutionId) internal view {
        if (_isGlobalAdmin(msg.sender)) {
            return;
        }

        InstitutionStorage.Institution storage institution = _requireInstitutionExists(
            institutionId
        );

        IAccessControl ac = IAccessControl(address(this));
        if (
            institution.status == InstitutionStorage.InstitutionStatus.Active &&
            ac.hasRole(RoleConstants.INSTITUTION_ADMIN_ROLE, msg.sender) &&
            institution.adminAddress == msg.sender &&
            _isScopeableInstitutionRole(role)
        ) {
            return;
        }

        revert StorageLib.UnauthorizedRole(
            msg.sender,
            RoleConstants.INSTITUTION_ADMIN_ROLE
        );
    }

    function _isScopeableInstitutionRole(bytes32 role) internal pure returns (bool) {
        return role == RoleConstants.SCREENING_ATTESTOR_ROLE;
    }

    function _isBooleanRequirementControl(bytes32 key) internal pure returns (bool) {
        return key == KYC_ENFORCE_ACTIVE
            || key == TRAVEL_RULE_ENFORCE_ACTIVE
            || key == CIP_ENFORCE_ACTIVE;
    }

    function _applyScopeDelta(bytes32 key, bool wasArmed, bool nowArmed) internal {
        if (wasArmed == nowArmed) return;
        ComplianceConfigStorage.Layout storage c = ComplianceConfigStorage.layout();
        if (key == KYC_ENFORCE_ACTIVE) {
            if (nowArmed) { c.kycScopeCount += 1; } else { c.kycScopeCount -= 1; }
        } else if (key == CIP_ENFORCE_ACTIVE) {
            if (nowArmed) { c.cipScopeCount += 1; } else { c.cipScopeCount -= 1; }
        } else if (key == TRAVEL_RULE_ENFORCE_ACTIVE) {
            if (nowArmed) { c.travelRuleScopeCount += 1; } else { c.travelRuleScopeCount -= 1; }
        }
        // Sanctions arming never routes here: it lives on the DP-A per-institution
        // bit (ComplianceScreeningFacet.setInstitutionSanctionsEnabled), off the
        // policy stack by design (8E-1).
    }

    // CF-R Obs-2 — relax-direction table for enforcement-class keys:
    //   kyc/cip/travel_rule_enforce_active (boolean): parent armed (!=0) and the
    //     proposed value 0 = relax.
    //   travel_rule_threshold_usd: 0 is enforce-all (strictest). A nonzero proposal
    //     above the parent baseline — or replacing a 0 baseline — screens fewer
    //     transfers = relax. A proposal of 0 is itself enforce-all and never relaxes.
    //   All other keys are not enforcement-class: never guarded.
    // Tightening (the opposite direction) never requires the exemption role.
    function _relaxes(
        bytes32 key,
        uint256 parentValue,
        uint256 proposedValue
    ) internal pure returns (bool) {
        if (_isBooleanRequirementControl(key)) {
            return (parentValue != 0) && (proposedValue == 0);
        }
        if (key == TRAVEL_RULE_THRESHOLD_USD) {
            return (proposedValue != 0) && (parentValue == 0 || proposedValue > parentValue);
        }
        return false;
    }

    function _checkExemptionForRelax(
        bytes32 scopeId,
        bytes32 key,
        uint256 baselineValue,
        uint256 proposedValue,
        bytes32 reasonHash
    ) internal {
        // CF-R Obs-2: for set* the baseline is the EFFECTIVE parent for the scope
        // (wallet -> institution override if set, else network; institution -> network;
        // network -> its own current value) and the proposal is the new override.
        // For clear* the baseline is the override being removed and the proposal is
        // the parent that takes effect after the clear.
        if (!_relaxes(key, baselineValue, proposedValue)) return;
        if (!IAccessControl(address(this)).hasRole(RoleConstants.COMPLIANCE_EXEMPTION_ROLE, msg.sender)) {
            revert InstitutionStorage.ComplianceExemptionRequired(scopeId, key);
        }
        emit InstitutionStorage.ComplianceExemptionGranted(scopeId, key, reasonHash, msg.sender);
    }

    function _effectiveParentForWallet(
        address wallet,
        bytes32 key
    ) internal view returns (uint256) {
        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        bytes32 institutionId = l.walletAffiliations[wallet].institutionId;
        if (institutionId != bytes32(0) && l.institutionPolicySet[institutionId][key]) {
            return l.institutionPolicies[institutionId][key];
        }
        return l.networkPolicies[key];
    }

    function _requireValidPolicyKey(bytes32 key) internal pure {
        if (
            key != CANCEL_OOB_THRESHOLD_USD &&
            key != SHORTEN_OOB_REQUIRED &&
            key != DUAL_APPROVAL_THRESHOLD_USD &&
            key != MAX_HALFLIFE_ADJUSTMENTS &&
            key != KYC_ENFORCE_ACTIVE &&
            key != TRAVEL_RULE_ENFORCE_ACTIVE &&
            key != CIP_ENFORCE_ACTIVE &&
            key != TRAVEL_RULE_THRESHOLD_USD
        ) {
            revert InstitutionStorage.InvalidPolicyKey();
        }
    }

    function _requireInstitutionExists(
        bytes32 institutionId
    ) internal view returns (InstitutionStorage.Institution storage institution) {
        institution = InstitutionStorage.layout().institutions[institutionId];
        if (institution.id == bytes32(0)) {
            revert InstitutionStorage.InstitutionNotFound(institutionId);
        }
    }
}
