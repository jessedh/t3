// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { RulesStorageLib } from "../lib/RulesStorageLib.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { T3CommonLib } from "../lib/T3CommonLib.sol";
import { ComplianceStatusLib } from "../lib/ComplianceStatusLib.sol";

contract RulesEngineFacet {
    using RulesStorageLib for RulesStorageLib.RulesStorage;

    error CallerNotDiamond(address caller);

    modifier onlyDiamond() {
        if (msg.sender != address(this)) revert CallerNotDiamond(msg.sender);
        _;
    }

    enum Action {
        ALLOW,
        WARN,
        DENY
    }

    event RuleEvaluated(
        uint256 indexed ruleSetVersion,
        bytes32 indexed scopeKey,
        address indexed from,
        address to,
        uint256 amount,
        uint16 score,
        uint8 action,
        bytes4 selector
    );

    event FeeApplied(
        address indexed from,
        address indexed to,
        uint256 amount,
        uint256 fee,
        uint256 base,
        uint256 ruleSurcharge
    );

    error Paused();

    // Rule IDs (subset)
    uint8 internal constant RULE_DENYLIST = 0;
    uint8 internal constant RULE_ALLOWLIST_ONLY = 1;
    uint8 internal constant RULE_MAX_PER_TX = 2;
    uint8 internal constant RULE_VELOCITY_WINDOW = 3;
    uint8 internal constant RULE_MAX_OUTFLOW_IN_WINDOW = 4;
    uint8 internal constant RULE_RESTRICT_CONTRACT = 5;
    uint8 internal constant RULE_MAX_PER_RECIPIENT_DAILY = 6;
    uint8 internal constant RULE_SPONSORED_CAP = 7;
    uint8 internal constant RULE_KYC_SENDER_MISSING = 10;
    uint8 internal constant RULE_KYC_RECIPIENT_MISSING = 11;
    uint8 internal constant RULE_KYC_SENDER_SOON = 12;
    uint8 internal constant RULE_KYC_RECIPIENT_SOON = 13;
    // New scoring rules
    uint8 internal constant RULE_BASE_TX = 20; // +10 for any amount > 0
    uint8 internal constant RULE_TX_COUNT_24H = 21; // +50 per tx in last 24h (including current)

    // Evaluate rules and produce a total score and action. Observation mode never returns DENY.
    function beforeTransferCheck(
        address from,
        address to,
        uint256 amount,
        bytes calldata data,
        bytes32[] calldata allowProof,
        bytes32[] calldata denyProof
    ) external returns (uint16 score, uint8 action) {
        // Honor global pause (atomic)
        if (StorageLib.diamondStorage()._paused) {
            revert Paused();
        }

        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();

        uint16 total;
        bytes32 scopeKeyNetwork = keccak256(abi.encodePacked("NETWORK", bytes32(0)));
        bytes32 scopeKeyWallet = keccak256(abi.encodePacked("WALLET", from));
        address inst = rs.walletInstitution[from];
        bytes32 scopeKeyInstitution = inst != address(0) ? keccak256(abi.encodePacked("INSTITUTION", inst)) : bytes32(0);
        bytes4 selector = data.length >= 4 ? bytes4(data[0:4]) : bytes4(0);

        // 1) Denylist recipient
        if (rs.hotDeny[to]) {
            total += _weight(rs, scopeKeyNetwork, RULE_DENYLIST);
        } else if (rs.denylistRoot != bytes32(0)) {
            if (MerkleProof.verify(denyProof, rs.denylistRoot, keccak256(abi.encodePacked(to)))) {
                total += _weight(rs, scopeKeyNetwork, RULE_DENYLIST);
            }
        }

        // 2) Allowlist-only mode
        if ((rs.ruleSets[scopeKeyNetwork].enabledBits & (1 << RULE_ALLOWLIST_ONLY)) != 0) {
            bool allowed = rs.hotAllow[to];
            if (!allowed && rs.allowlistRoot != bytes32(0)) {
                allowed = MerkleProof.verify(allowProof, rs.allowlistRoot, keccak256(abi.encodePacked(to)));
            }
            if (!allowed) {
                total += _weight(rs, scopeKeyNetwork, RULE_ALLOWLIST_ONLY);
            }
        }

        // Sponsored cap (read from first byte of data == 0x01)
        bool isSponsored = (data.length > 0 && uint8(bytes1(data[0])) == 0x01);

        // 3) Max per-tx amount
        uint256 maxAmt = _effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 1); // 1 => maxAmount
        if (maxAmt > 0 && amount > maxAmt) {
            total += _weight(rs, scopeKeyNetwork, RULE_MAX_PER_TX);
        }

        // Sponsored per-tx cap
        if (isSponsored) {
            // Reuse maxAmt if a specific sponsored cap isn't configured yet; treat as cap for now
            if (maxAmt > 0 && amount > maxAmt) {
                total += _weight(rs, scopeKeyNetwork, RULE_SPONSORED_CAP);
            }
        }

        // 4) Restrict contract recipients
        if (_effectiveBool(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 1)) { // 1 => restrictContracts
            uint32 size;
            assembly {
                size := extcodesize(to)
            }
            if (size > 0 && !rs.hotAllow[to]) {
                total += _weight(rs, scopeKeyNetwork, RULE_RESTRICT_CONTRACT);
            }
        }

        // Base per-tx scoring and tx-count-in-24h (predictive)
        if (amount > 0) {
            total += _weight(rs, scopeKeyNetwork, RULE_BASE_TX);
        }
        {
            RulesStorageLib.CountWindow storage cw = rs.txCountByWallet[from];
            uint32 predictedCount = 1;
            if (cw.windowStart != 0 && block.timestamp < cw.windowStart + cw.windowSecs) {
                predictedCount = cw.count + 1;
            }
            uint16 wtc = _weight(rs, scopeKeyNetwork, RULE_TX_COUNT_24H);
            total += uint16(uint32(wtc) * uint32(predictedCount));
        }

        // Velocity/outflow and daily per-recipient (predictive check)
        RulesStorageLib.OutflowWindow storage ow = rs.outflowByWallet[from];
        uint48 vwin = uint48(_effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 2)); // 2 => velocityWindowSecs
        if (vwin > 0) {
            uint256 winStart = ow.windowStart;
            uint256 sum = ow.sum;
            if (winStart == 0 || block.timestamp >= winStart + vwin) {
                sum = 0;
            }
            uint256 predicted = sum + amount;
            uint256 cap = _effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 3); // 3 => maxOutflowAmount
            if (cap > 0) {
                if (predicted > cap) total += _weight(rs, scopeKeyNetwork, RULE_MAX_OUTFLOW_IN_WINDOW);
                else if (predicted * 1000 / cap >= 600) total += _weight(rs, scopeKeyNetwork, RULE_VELOCITY_WINDOW); // warn band ~60%
            }
        }

        uint256 dailyCap = _effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 4); // 4 => maxPerRecipientDaily
        if (dailyCap > 0) {
            RulesStorageLib.DailyPerRecipient storage dp = rs.dailyByPair[from][to];
            uint256 day = block.timestamp / 1 days;
            uint256 sumDay = (dp.day == day) ? dp.sum : 0;
            uint256 predictedDay = sumDay + amount;
            if (predictedDay > dailyCap) total += _weight(rs, scopeKeyNetwork, RULE_MAX_PER_RECIPIENT_DAILY);
        }

        // KYC rules (sender/recipient)
        RulesStorageLib.RuleSet storage net = rs.ruleSets[scopeKeyNetwork];
        bool reqKyc = _effectiveBool(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 2); // 2 => requireKyc
        uint256 kycThreshold = _effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 5); // 5 => kycAmountThreshold
        uint48 kycSoon = uint48(_effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 6)); // 6 => kycSoonSeconds
        if (reqKyc && amount >= kycThreshold) {
            bool senderKyc = ComplianceStatusLib.effectiveKycStatus(StorageLib.diamondStorage(), from);
            bool recipientKyc = ComplianceStatusLib.effectiveKycStatus(StorageLib.diamondStorage(), to);
            if (!senderKyc) total += _weight(rs, scopeKeyNetwork, RULE_KYC_SENDER_MISSING);
            if (!recipientKyc) total += _weight(rs, scopeKeyNetwork, RULE_KYC_RECIPIENT_MISSING);
            // Expiring soon
            if (kycSoon > 0) {
                StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
                uint256 sExp = ds._custodyInfo[from].kycExpiresTimestamp;
                uint256 rExp = ds._custodyInfo[to].kycExpiresTimestamp;
                if (sExp != 0 && sExp <= block.timestamp + kycSoon) total += _weight(rs, scopeKeyNetwork, RULE_KYC_SENDER_SOON);
                if (rExp != 0 && rExp <= block.timestamp + kycSoon) total += _weight(rs, scopeKeyNetwork, RULE_KYC_RECIPIENT_SOON);
            }
        }

        // Decide action with observation mode
        uint8 act = uint8(Action.ALLOW);
        if (!rs.observationMode) {
            if (total >= rs.enforceDenyAt && rs.enforceDenyAt > 0) act = uint8(Action.DENY);
            else if (total >= rs.enforceWarnAt && rs.enforceWarnAt > 0) act = uint8(Action.WARN);
        } else {
            // In observation mode we may still compute WARN/DENY for telemetry, but ALLOW for effect
            if (total >= rs.enforceDenyAt && rs.enforceDenyAt > 0) act = uint8(Action.DENY);
            else if (total >= rs.enforceWarnAt && rs.enforceWarnAt > 0) act = uint8(Action.WARN);
            // Effectively ALLOW will be observed by callers choosing not to revert on DENY in obs mode
        }

        emit RuleEvaluated(rs.rulesVersion, scopeKeyNetwork, from, to, amount, total, act, selector);
        return (total, act);
    }

    // Preview function returning the rules that contributed to the score (ids only)
    // Preview function returning the rules that contributed to the score (ids only)
    function evaluateRulesPreview(
        address from,
        address to,
        uint256 amount,
        bytes calldata data,
        bytes32[] calldata allowProof,
        bytes32[] calldata denyProof
    ) external view returns (uint16 totalScore, uint8 action, uint8[] memory hits) {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        
        // Resolve scopes (mirroring beforeTransferCheck)
        bytes32 scopeKeyNetwork = keccak256(abi.encodePacked("NETWORK", bytes32(0)));
        bytes32 scopeKeyWallet = keccak256(abi.encodePacked("WALLET", from));
        address inst = rs.walletInstitution[from];
        bytes32 scopeKeyInstitution = inst != address(0) ? keccak256(abi.encodePacked("INSTITUTION", inst)) : bytes32(0);

        uint8[] memory temp = new uint8[](16);
        uint8 idx;

        // Denylist
        if (rs.hotDeny[to] || (rs.denylistRoot != bytes32(0) && MerkleProof.verify(denyProof, rs.denylistRoot, keccak256(abi.encodePacked(to))))) {
            totalScore += _weight(rs, scopeKeyNetwork, RULE_DENYLIST);
            temp[idx++] = RULE_DENYLIST;
        }
        // Allowlist-only miss
        if ((rs.ruleSets[scopeKeyNetwork].enabledBits & (1 << RULE_ALLOWLIST_ONLY)) != 0) {
            bool allowed = rs.hotAllow[to];
            if (!allowed && rs.allowlistRoot != bytes32(0)) {
                allowed = MerkleProof.verify(allowProof, rs.allowlistRoot, keccak256(abi.encodePacked(to)));
            }
            if (!allowed) {
                totalScore += _weight(rs, scopeKeyNetwork, RULE_ALLOWLIST_ONLY);
                temp[idx++] = RULE_ALLOWLIST_ONLY;
            }
        }
        
        // Sponsored cap
        bool isSponsored = (data.length > 0 && uint8(bytes1(data[0])) == 0x01);

        // Max per tx
        uint256 maxAmt = _effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 1);
        if (maxAmt > 0 && amount > maxAmt) {
            totalScore += _weight(rs, scopeKeyNetwork, RULE_MAX_PER_TX);
            temp[idx++] = RULE_MAX_PER_TX;
        }

        if (isSponsored) {
            if (maxAmt > 0 && amount > maxAmt) {
                totalScore += _weight(rs, scopeKeyNetwork, RULE_SPONSORED_CAP);
                temp[idx++] = RULE_SPONSORED_CAP;
            }
        }

        // Restrict contract recipients
        if (_effectiveBool(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 1)) {
            uint32 size;
            assembly { size := extcodesize(to) }
            if (size > 0 && !rs.hotAllow[to]) {
                totalScore += _weight(rs, scopeKeyNetwork, RULE_RESTRICT_CONTRACT);
                temp[idx++] = RULE_RESTRICT_CONTRACT;
            }
        }

        // Base and tx-count
        if (amount > 0) { totalScore += _weight(rs, scopeKeyNetwork, RULE_BASE_TX); temp[idx++] = RULE_BASE_TX; }
        {
            RulesStorageLib.CountWindow storage cw2 = rs.txCountByWallet[from];
            uint32 predictedCount2 = 1;
            if (cw2.windowStart != 0 && block.timestamp < cw2.windowStart + cw2.windowSecs) {
                predictedCount2 = cw2.count + 1;
            }
            uint16 wtc2 = _weight(rs, scopeKeyNetwork, RULE_TX_COUNT_24H);
            totalScore += uint16(uint32(wtc2) * uint32(predictedCount2));
            temp[idx++] = RULE_TX_COUNT_24H;
        }

        // Velocity/outflow (predictive)
        RulesStorageLib.OutflowWindow storage ow = rs.outflowByWallet[from];
        uint48 vwin = uint48(_effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 2));
        if (vwin > 0) {
            uint256 winStart = ow.windowStart;
            uint256 sum = ow.sum;
            if (winStart == 0 || block.timestamp >= winStart + vwin) {
                sum = 0;
            }
            uint256 predicted = sum + amount;
            uint256 cap = _effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 3);
            if (cap > 0) {
                if (predicted > cap) {
                    totalScore += _weight(rs, scopeKeyNetwork, RULE_MAX_OUTFLOW_IN_WINDOW);
                    temp[idx++] = RULE_MAX_OUTFLOW_IN_WINDOW;
                }
                else if (predicted * 1000 / cap >= 600) {
                    totalScore += _weight(rs, scopeKeyNetwork, RULE_VELOCITY_WINDOW);
                    temp[idx++] = RULE_VELOCITY_WINDOW;
                }
            }
        }

        // Daily per recipient (predictive)
        uint256 dailyCap = _effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 4);
        if (dailyCap > 0) {
            RulesStorageLib.DailyPerRecipient storage dp = rs.dailyByPair[from][to];
            uint256 day = block.timestamp / 1 days;
            uint256 sumDay = (dp.day == day) ? dp.sum : 0;
            uint256 predictedDay = sumDay + amount;
            if (predictedDay > dailyCap) {
                totalScore += _weight(rs, scopeKeyNetwork, RULE_MAX_PER_RECIPIENT_DAILY);
                temp[idx++] = RULE_MAX_PER_RECIPIENT_DAILY;
            }
        }

        // KYC
        if (_effectiveBool(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 2) && 
            amount >= _effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 5)) {
            
            bool senderKyc = ComplianceStatusLib.effectiveKycStatus(StorageLib.diamondStorage(), from);
            bool recipientKyc = ComplianceStatusLib.effectiveKycStatus(StorageLib.diamondStorage(), to);
            
            if (!senderKyc) { totalScore += _weight(rs, scopeKeyNetwork, RULE_KYC_SENDER_MISSING); temp[idx++] = RULE_KYC_SENDER_MISSING; }
            if (!recipientKyc) { totalScore += _weight(rs, scopeKeyNetwork, RULE_KYC_RECIPIENT_MISSING); temp[idx++] = RULE_KYC_RECIPIENT_MISSING; }
            
            uint48 kycSoon = uint48(_effectiveUint(rs, scopeKeyWallet, scopeKeyInstitution, scopeKeyNetwork, 6));
            if (kycSoon > 0) {
                StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
                uint256 sExp = ds._custodyInfo[from].kycExpiresTimestamp;
                uint256 rExp = ds._custodyInfo[to].kycExpiresTimestamp;
                if (sExp != 0 && sExp <= block.timestamp + kycSoon) { totalScore += _weight(rs, scopeKeyNetwork, RULE_KYC_SENDER_SOON); temp[idx++] = RULE_KYC_SENDER_SOON; }
                if (rExp != 0 && rExp <= block.timestamp + kycSoon) { totalScore += _weight(rs, scopeKeyNetwork, RULE_KYC_RECIPIENT_SOON); temp[idx++] = RULE_KYC_RECIPIENT_SOON; }
            }
        }

        // Build hits output sized to idx
        hits = new uint8[](idx);
        for (uint8 i; i < idx; i++) hits[i] = temp[i];

        // Action per observation settings
        uint8 act = uint8(Action.ALLOW);
        if (!rs.observationMode) {
            if (totalScore >= rs.enforceDenyAt && rs.enforceDenyAt > 0) act = uint8(Action.DENY);
            else if (totalScore >= rs.enforceWarnAt && rs.enforceWarnAt > 0) act = uint8(Action.WARN);
        } else {
            if (totalScore >= rs.enforceDenyAt && rs.enforceDenyAt > 0) act = uint8(Action.DENY);
            else if (totalScore >= rs.enforceWarnAt && rs.enforceWarnAt > 0) act = uint8(Action.WARN);
        }
        return (totalScore, act, hits);
    }

    // Update usage metrics after a successful transfer (called by transfer facet)
    function postTransferUpdate(address from, address to, uint256 amount) external onlyDiamond {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        RulesStorageLib.OutflowWindow storage ow = rs.outflowByWallet[from];
        uint48 vwin = rs.ruleSets[keccak256(abi.encodePacked("NETWORK", bytes32(0)))].velocityWindowSecs;
        if (vwin > 0) {
            if (ow.windowStart == 0 || block.timestamp >= ow.windowStart + vwin) {
                ow.windowStart = block.timestamp;
                ow.sum = amount;
                ow.windowSecs = vwin;
            } else {
                ow.sum += amount;
            }
        }
        // Daily per recipient
        RulesStorageLib.DailyPerRecipient storage dp = rs.dailyByPair[from][to];
        uint256 day = block.timestamp / 1 days;
        if (dp.day != day) { dp.day = day; dp.sum = amount; } else { dp.sum += amount; }
        // Tx count window (24h)
        RulesStorageLib.CountWindow storage cw = rs.txCountByWallet[from];
        uint48 cwin = 24 hours;
        if (cw.windowStart == 0 || block.timestamp >= cw.windowStart + cw.windowSecs) {
            cw.windowStart = block.timestamp;
            cw.count = 1;
            cw.windowSecs = cwin;
        } else {
            unchecked { cw.count += 1; }
        }
    }

    // Helpers for tests/ops
    function getOutflow(address wallet) external view returns (uint256 windowStart, uint256 sum, uint48 windowSecs) {
        RulesStorageLib.OutflowWindow storage ow = RulesStorageLib.rulesStorage().outflowByWallet[wallet];
        return (ow.windowStart, ow.sum, ow.windowSecs);
    }
    function getDailyPair(address from, address to) external view returns (uint256 day, uint256 sum) {
        RulesStorageLib.DailyPerRecipient storage dp = RulesStorageLib.rulesStorage().dailyByPair[from][to];
        return (dp.day, dp.sum);
    }

    // Pure fee quote scaffold: returns base fee only; extended surcharges added later.
    function quoteFee(
        address /*from*/,
        address /*to*/,
        uint256 /*amount*/,
        bytes32[] calldata /*features*/,
        uint256 ruleChecksCount
    ) external view returns (uint256) {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        uint256 base = rs.feeSchedule.baseFee;
        uint256 surcharge = rs.feeSchedule.perRuleSurcharge * ruleChecksCount;
        uint256 cap = rs.feeSchedule.surchargeCap;
        
        if (cap > 0 && surcharge > cap) {
            surcharge = cap;
        }
        
        return base + surcharge;
    }

    function isAddressAllowed(address a, bytes32[] calldata allowProof, bytes32[] calldata denyProof) external view returns (bool) {
        RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
        if (rs.hotDeny[a]) return false;
        if (rs.denylistRoot != bytes32(0)) {
            if (MerkleProof.verify(denyProof, rs.denylistRoot, keccak256(abi.encodePacked(a)))) return false;
        }
        if (rs.hotAllow[a]) return true;
        if (rs.allowlistRoot != bytes32(0)) {
            if (MerkleProof.verify(allowProof, rs.allowlistRoot, keccak256(abi.encodePacked(a)))) return true;
        }
        // If no lists configured, default allow.
        return rs.allowlistRoot == bytes32(0);
    }
}

// Internal helpers
function _weight(RulesStorageLib.RulesStorage storage rs, bytes32 scopeKey, uint8 ruleId) view returns (uint16) {
    uint16 w = rs.ruleWeight[scopeKey][ruleId];
    if (w == 0) {
        // Provide sane defaults if not configured
        if (ruleId == 0 || ruleId == 1) return 1000; // hard list rules
        if (ruleId == 2 || ruleId == 5) return 700;  // caps/contract
        if (ruleId >= 10 && ruleId <= 13) return 600; // KYC
        if (ruleId == 20) return 10; // base per-tx
        if (ruleId == 21) return 50; // per-tx within 24h
        return 300;
    }
    return w;
}

// Effective param helpers: prefer wallet override if set; else network
function _effectiveUint(
    RulesStorageLib.RulesStorage storage rs,
    bytes32 scopeWallet,
    bytes32 scopeInstitution,
    bytes32 scopeNetwork,
    uint8 field
) view returns (uint256) {
    RulesStorageLib.RuleSet storage w = rs.ruleSets[scopeWallet];
    RulesStorageLib.RuleSet storage i = rs.ruleSets[scopeInstitution];
    RulesStorageLib.RuleSet storage n = rs.ruleSets[scopeNetwork];
    if (field == 1) return w.maxAmount != 0 ? w.maxAmount : (i.maxAmount != 0 ? i.maxAmount : n.maxAmount);
    if (field == 2) return w.velocityWindowSecs != 0 ? w.velocityWindowSecs : (i.velocityWindowSecs != 0 ? i.velocityWindowSecs : n.velocityWindowSecs);
    if (field == 3) return w.maxOutflowAmount != 0 ? w.maxOutflowAmount : (i.maxOutflowAmount != 0 ? i.maxOutflowAmount : n.maxOutflowAmount);
    if (field == 4) return w.maxPerRecipientDaily != 0 ? w.maxPerRecipientDaily : (i.maxPerRecipientDaily != 0 ? i.maxPerRecipientDaily : n.maxPerRecipientDaily);
    if (field == 5) return w.kycAmountThreshold != 0 ? w.kycAmountThreshold : (i.kycAmountThreshold != 0 ? i.kycAmountThreshold : n.kycAmountThreshold);
    if (field == 6) return w.kycSoonSeconds != 0 ? w.kycSoonSeconds : (i.kycSoonSeconds != 0 ? i.kycSoonSeconds : n.kycSoonSeconds);
    return 0;
}

function _effectiveBool(
    RulesStorageLib.RulesStorage storage rs,
    bytes32 scopeWallet,
    bytes32 scopeInstitution,
    bytes32 scopeNetwork,
    uint8 field
) view returns (bool) {
    RulesStorageLib.RuleSet storage w = rs.ruleSets[scopeWallet];
    RulesStorageLib.RuleSet storage i = rs.ruleSets[scopeInstitution];
    RulesStorageLib.RuleSet storage n = rs.ruleSets[scopeNetwork];
    if (field == 1) return w.restrictContracts ? true : (i.restrictContracts ? true : n.restrictContracts);
    if (field == 2) return w.requireKyc ? true : (i.requireKyc ? true : n.requireKyc);
    return false;
}
