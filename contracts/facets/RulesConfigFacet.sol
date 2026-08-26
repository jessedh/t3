// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { RulesStorageLib } from "../lib/RulesStorageLib.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { InstitutionStorage } from "../lib/InstitutionStorage.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

contract RulesConfigFacet {
    using EnumerableSet for EnumerableSet.AddressSet;
    using RulesStorageLib for RulesStorageLib.RulesStorage;

    event RuleSetUpdated(bytes32 indexed scopeKey, uint256 indexed version, uint256 effectiveFrom);
    event FeeScheduleUpdated(uint256 baseFee, uint256 perRuleSurcharge, uint256 surchargeCap);
    event MerkleRootsUpdated(bytes32 allowRoot, bytes32 denyRoot);
    event HotlistUpdated(address indexed account, bool allow, bool deny);
    event RuleWeightUpdated(bytes32 indexed scopeKey, uint8 indexed ruleId, uint16 weight);
    event ObservationModeUpdated(bool observationMode, uint16 warnAt, uint16 denyAt);
    event WalletInstitutionSet(address indexed wallet, address indexed institution);

    modifier onlyRulesAdmin() {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        // Bootstrap: if no roles set yet, allow contractOwner
        bool bootstrap = ds._roles[RoleConstants.DEFAULT_ADMIN_ROLE].length() == 0;
        if (bootstrap && msg.sender == ds.contractOwner) {
            _;
            return;
        }
        // Allow DEFAULT_ADMIN_ROLE or COMPLIANCE_OFFICER_ROLE
        if (
            !AccessControlLib.hasRole(ds, RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender) &&
            !AccessControlLib.hasRole(ds, RoleConstants.COMPLIANCE_OFFICER_ROLE, msg.sender)
        ) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.COMPLIANCE_OFFICER_ROLE);
        }
        _;
    }

    // Helper to compute scope keys (optional for callers that prefer on-chain derivation)
    function scopeKeyForNetwork() external pure returns (bytes32) {
        return keccak256(abi.encodePacked("NETWORK", bytes32(0)));
    }

    function scopeKeyForInstitution(address institution) external pure returns (bytes32) {
        return keccak256(abi.encodePacked("INSTITUTION", institution));
    }

    function scopeKeyForWallet(address wallet) external pure returns (bytes32) {
        return keccak256(abi.encodePacked("WALLET", wallet));
    }

    function setRuleSet(bytes32 scopeKey, RulesStorageLib.RuleSet calldata rules) external onlyRulesAdmin {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        rs.ruleSets[scopeKey] = rules;
        rs.rulesVersion += 1;
        emit RuleSetUpdated(scopeKey, rs.rulesVersion, rules.effectiveFrom);
    }

    // View getters for UI/ops
    function getRuleSet(bytes32 scopeKey) external view returns (RulesStorageLib.RuleSet memory) {
        return RulesStorageLib.rulesStorage().ruleSets[scopeKey];
    }

    function getRuleWeight(bytes32 scopeKey, uint8 ruleId) external view returns (uint16) {
        return RulesStorageLib.rulesStorage().ruleWeight[scopeKey][ruleId];
    }

    function getFeeSchedule() external view returns (uint256 baseFee, uint256 perRuleSurcharge, uint256 surchargeCap) {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        return (rs.feeSchedule.baseFee, rs.feeSchedule.perRuleSurcharge, rs.feeSchedule.surchargeCap);
    }

    // Added: consolidated observation/enforcement getter for ops/export
    function getObservationConfig() external view returns (bool observationMode, uint16 warnAt, uint16 denyAt) {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        return (rs.observationMode, rs.enforceWarnAt, rs.enforceDenyAt);
    }

    // Added: merkle roots getter to support audits and export
    function getMerkleRoots() external view returns (bytes32 allowRoot, bytes32 denyRoot) {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        return (rs.allowlistRoot, rs.denylistRoot);
    }

    function setObservationMode(bool observationMode, uint16 warnAt, uint16 denyAt) external onlyRulesAdmin {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        rs.observationMode = observationMode;
        rs.enforceWarnAt = warnAt;
        rs.enforceDenyAt = denyAt;
        emit ObservationModeUpdated(observationMode, warnAt, denyAt);
    }

    function setRuleWeight(bytes32 scopeKey, uint8 ruleId, uint16 weight) external onlyRulesAdmin {
        RulesStorageLib.rulesStorage().ruleWeight[scopeKey][ruleId] = weight;
        emit RuleWeightUpdated(scopeKey, ruleId, weight);
    }

    function setRuleWeights(bytes32 scopeKey, uint8[] calldata ruleIds, uint16[] calldata weights) external onlyRulesAdmin {
        require(ruleIds.length == weights.length, "Length mismatch");
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        for (uint256 i; i < ruleIds.length; i++) {
            rs.ruleWeight[scopeKey][ruleIds[i]] = weights[i];
            emit RuleWeightUpdated(scopeKey, ruleIds[i], weights[i]);
        }
    }

    // Institution linking (wallet -> institution address)
    function setWalletInstitution(address wallet, address institution) external onlyRulesAdmin {
        RulesStorageLib.rulesStorage().walletInstitution[wallet] = institution;
        emit WalletInstitutionSet(wallet, institution);
    }

    function getWalletInstitution(address wallet) external view returns (address) {
        return RulesStorageLib.rulesStorage().walletInstitution[wallet];
    }

    // Institution registry model (bytes32 id) exposed from dedicated InstitutionStorage.
    function getWalletInstitutionId(address wallet) external view returns (bytes32) {
        return InstitutionStorage.layout().walletAffiliations[wallet].institutionId;
    }

    function setFeeSchedule(
        uint256 baseFee,
        uint256 perRuleSurcharge,
        uint256 surchargeCap
    ) external onlyRulesAdmin {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        rs.feeSchedule.baseFee = baseFee;
        rs.feeSchedule.perRuleSurcharge = perRuleSurcharge;
        rs.feeSchedule.surchargeCap = surchargeCap;
        emit FeeScheduleUpdated(baseFee, perRuleSurcharge, surchargeCap);
    }

    function setFeatureSurcharge(bytes32 featureKey, uint256 surcharge) external onlyRulesAdmin {
        RulesStorageLib.rulesStorage().feeSchedule.featureSurcharge[featureKey] = surcharge;
        // FeeScheduleUpdated not emitted for single feature to limit noise
    }

    function setMerkleRoots(bytes32 allowRoot, bytes32 denyRoot) external onlyRulesAdmin {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        rs.allowlistRoot = allowRoot;
        rs.denylistRoot = denyRoot;
        emit MerkleRootsUpdated(allowRoot, denyRoot);
    }

    function setHotlist(address account, bool allow, bool deny) external onlyRulesAdmin {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        if (allow) rs.hotAllow[account] = true; else rs.hotAllow[account] = false;
        if (deny) rs.hotDeny[account] = true; else rs.hotDeny[account] = false;
        emit HotlistUpdated(account, allow, deny);
    }
}
