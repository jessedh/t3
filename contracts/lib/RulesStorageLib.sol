// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library RulesStorageLib {
    // keccak256("t3.rules.storage.v1")
    bytes32 internal constant RULES_STORAGE_SLOT = 0x48036d02d4626b8820d91b02f7d150a50efa736d63e0d5cb187bd788d6eef629;

    struct CountWindow { uint256 windowStart; uint32 count; uint48 windowSecs; }

    struct FeatureFees {
        uint256 baseFee;
        uint256 perRuleSurcharge;
        uint256 surchargeCap;
        // Feature key => surcharge (e.g., keccak256("HalfLife"))
        mapping(bytes32 => uint256) featureSurcharge;
    }

    struct RuleSet {
        uint256 enabledBits; // bitmask for enabled public rules
        uint16 warnThreshold; // 0..1000
        uint16 blockThreshold; // 0..1000
        uint48 velocityWindowSecs;
        uint256 maxAmount;
        uint256 maxOutflowAmount;
        uint256 maxPerRecipientDaily; // daily cap per (sender->recipient)
        uint256 maxEvalCount; // gas guardrail
        bool restrictContracts; // disallow contracts unless allowlisted
        bool extendCommitOnWarn; // extend commit window on WARN
        uint48 warnExtendSeconds; // extension to commit window on WARN
        // KYC parameters
        bool requireKyc;
        uint256 kycAmountThreshold;
        uint48 kycSoonSeconds;
        uint256 createdAt;
        uint256 effectiveFrom;
    }

    struct RulesStorage {
        uint256 rulesVersion;
        // Scope key => RuleSet
        mapping(bytes32 => RuleSet) ruleSets;
        // Per-scope per-rule severity weights (0..1000)
        mapping(bytes32 => mapping(uint8 => uint16)) ruleWeight;
        FeatureFees feeSchedule;
        // Merkle roots for large lists
        bytes32 allowlistRoot;
        bytes32 denylistRoot;
        // Hot lists for critical addresses
        mapping(address => bool) hotAllow;
        mapping(address => bool) hotDeny;
        // Institution mapping: wallet => institution controller (address)
        mapping(address => address) walletInstitution;
        // Observation / enforcement controls
        bool observationMode; // if true, never DENY in engine result
        uint16 enforceWarnAt;
        uint16 enforceDenyAt;
        // Usage metrics for velocity/daily caps
        mapping(address => OutflowWindow) outflowByWallet;
        mapping(address => mapping(address => DailyPerRecipient)) dailyByPair;
        // Rolling transaction count window per wallet (for scoring)
        mapping(address => CountWindow) txCountByWallet;
        // M-2: If true, rules engine revert = transfer blocked (fail-closed).
        // If false, rules engine revert = transfer allowed (fail-open, legacy default).
        bool failClosed;
    }

    struct OutflowWindow { uint256 windowStart; uint256 sum; uint48 windowSecs; }
    struct DailyPerRecipient { uint256 day; uint256 sum; }

    function rulesStorage() internal pure returns (RulesStorage storage rs) {
        bytes32 slot = RULES_STORAGE_SLOT;
        assembly {
            rs.slot := slot
        }
    }
}
