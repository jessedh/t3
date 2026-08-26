// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "./StorageLib.sol";
import { TravelRuleStorage } from "./TravelRuleStorage.sol";
import { ComplianceConfigStorage } from "./ComplianceConfigStorage.sol";
import { WalletRecoveryStorage } from "./WalletRecoveryStorage.sol";
import { IInstitutionPolicy } from "../interfaces/IInstitutionManager.sol";

library ComplianceTravelRuleLib {
    error TravelRuleRequired(address sender, uint256 amount, uint256 threshold);
    // C-F3: staged commitment does not match the transfer being created.
    error TravelRuleCommitmentMismatch(address sender, bytes32 ref);
    // C-F3: staged commitment expired before it was consumed (fail-closed).
    error TravelRuleRefExpired(address sender, bytes32 ref, uint40 deadline);

    event TravelRuleAttached(
        bytes32 indexed envelopeId,
        address indexed sender,
        bytes32 ref
    );

    // Wave 8E-1 — scoped Travel Rule policy keys.
    bytes32 internal constant TRAVEL_RULE_ENFORCE_ACTIVE =
        keccak256("travel_rule_enforce_active");
    bytes32 internal constant TRAVEL_RULE_THRESHOLD_USD =
        keccak256("travel_rule_threshold_usd");

    // C-F3 commitment object types. A ref staged for one object type cannot
    // bind another (an envelope ref cannot satisfy a Cambio note, etc).
    uint8 internal constant OBJ_ENVELOPE = 1;     // TransferEnvelope + inheritance child
    uint8 internal constant OBJ_SMARTLOCK = 2;
    uint8 internal constant OBJ_CAMBIO_NOTE = 3;

    // Called by each escrow-in create AFTER envelopeId is known. Atomic binding.
    // C-F3: the staged ref binds only if its full commitment (recipient, amount,
    // objectType) matches this transfer and the staging has not expired.
    function bindOnCreate(
        StorageLib.AppStorage storage ds,
        address sender,
        address recipient,
        bytes32 envelopeId,
        uint256 amount,
        uint8 objectType
    ) internal {
        // Gate OFF at the sender's scope -> no-op.
        if (!_travelRuleArmed(sender)) return;

        // Effective threshold for the sender's scope (network -> institution -> wallet).
        // C-F5: threshold is denominated in 18-dec token units — the same units as
        // `amount` — so the comparison below is raw, with no scaling factor.
        // Wave-panel MED-1: policy reads resolve the recovery payee (CF-3 gate —
        // enforcement reads are recovery-resolving; the wallet-scoped threshold
        // migrated to the successor at designation). The pending[sender] lookup
        // below deliberately stays RAW-keyed: the actual transaction creator is
        // the party that staged the commitment.
        (uint256 threshold, ) = IInstitutionPolicy(address(this)).getEffectivePolicy(
            WalletRecoveryStorage._resolveRecoveryPayee(sender),
            TRAVEL_RULE_THRESHOLD_USD
        );

        // threshold 0 + gate ON = enforce-all (fail-closed); admin must set a threshold before activation or every create requires a ref
        if (amount < threshold) return;                              // below threshold -> no-op

        TravelRuleStorage.Layout storage t = TravelRuleStorage.layout();
        TravelRuleStorage.PendingTravelRule storage p = t.pending[sender];
        bytes32 ref = p.ref;
        if (ref == bytes32(0)) revert TravelRuleRequired(sender, amount, threshold);
        if (block.timestamp > p.deadline) revert TravelRuleRefExpired(sender, ref, p.deadline);
        if (p.recipient != recipient || p.amount != amount || p.objectType != objectType) {
            revert TravelRuleCommitmentMismatch(sender, ref);
        }

        t.byEnvelope[envelopeId] = TravelRuleStorage.TravelRule({
            ref: ref,
            satisfied: true,
            attachedAt: uint40(block.timestamp)
        });
        // Single-use: consumed on successful bind.
        delete t.pending[sender];

        emit TravelRuleAttached(envelopeId, sender, ref);
    }

    function _travelRuleArmed(address sender) internal view returns (bool) {
        // CF-R Obs-1: control runs iff its own counter is armed.
        if (ComplianceConfigStorage.layout().travelRuleScopeCount == 0) return false;
        // Wave-panel MED-1: recovery-resolving read — a wallet-scoped arming
        // override migrated to the successor must still bind transfers created
        // in the predecessor's name (mirrors ComplianceSanctionsLib).
        (uint256 armed, ) = IInstitutionPolicy(address(this)).getEffectivePolicy(
            WalletRecoveryStorage._resolveRecoveryPayee(sender),
            TRAVEL_RULE_ENFORCE_ACTIVE
        );
        return armed != 0;
    }
}
