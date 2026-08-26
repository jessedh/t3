// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { TravelRuleStorage } from "../lib/TravelRuleStorage.sol";
import { ComplianceTravelRuleLib } from "../lib/ComplianceTravelRuleLib.sol";
import { EnvelopeStorage } from "../lib/EnvelopeStorage.sol";
import { ViewACLLib } from "../lib/ViewACLLib.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";

contract ComplianceTravelRuleFacet is ReentrancyGuardBase {
    event PendingTravelRuleSet(
        address indexed sender,
        bytes32 indexed ref,
        address recipient,
        uint256 amount,
        uint8 objectType,
        uint40 deadline
    );
    event PendingTravelRuleCleared(
        address indexed sender
    );

    error InvalidObjectType(uint8 objectType);
    error DeadlineInPast(uint40 deadline);

    /**
     * @notice Stage a travel-rule ref bound to the exact transfer it attests.
     * @dev C-F3: the ref is committed to (recipient, amount, objectType) and
     *      expires at `deadline`; bindOnCreate matches all fields or reverts, so
     *      a staged ref is useless for any other transfer. UX implication: the
     *      sender/relayer must know the transfer parameters before staging.
     *      Remains sender-callable — the "authorized attestor" model is a
     *      documented gate-arming blocker (Task 7.4), not closed here.
     * @param ref        Off-chain travel-rule message reference (non-zero).
     * @param recipient  Counterparty of the committed transfer; address(0) for
     *                   bearer instruments (Cambio notes).
     * @param amount     Exact 18-dec token amount of the committed transfer.
     * @param objectType ComplianceTravelRuleLib.OBJ_* (1=envelope, 2=smartlock,
     *                   3=cambio note).
     * @param deadline   Staging expiry (unix seconds); must be in the future.
     */
    function setPendingTravelRule(
        bytes32 ref,
        address recipient,
        uint256 amount,
        uint8 objectType,
        uint40 deadline
    ) external {
        if (ref == bytes32(0)) revert TravelRuleStorage.InvalidRef();
        if (
            objectType < ComplianceTravelRuleLib.OBJ_ENVELOPE ||
            objectType > ComplianceTravelRuleLib.OBJ_CAMBIO_NOTE
        ) revert InvalidObjectType(objectType);
        if (deadline <= uint40(block.timestamp)) revert DeadlineInPast(deadline);

        address sender = _msgSender();
        // Quarantine check: sender cannot be in recovery (consistent with all
        // other write paths; a mid-recovery staging would be inert anyway —
        // the pending record migrates to the successor or expires).
        if (WalletRecoveryStorage.layout().activeRecoveryCount[sender] > 0) {
            revert IWalletRecovery.WalletInRecovery(sender);
        }
        TravelRuleStorage.layout().pending[sender] = TravelRuleStorage.PendingTravelRule({
            ref: ref,
            recipient: recipient,
            amount: amount,
            objectType: objectType,
            deadline: deadline
        });
        emit PendingTravelRuleSet(sender, ref, recipient, amount, objectType, deadline);
    }

    function clearPendingTravelRule() external {
        address sender = _msgSender();
        if (WalletRecoveryStorage.layout().activeRecoveryCount[sender] > 0) {
            revert IWalletRecovery.WalletInRecovery(sender);
        }
        delete TravelRuleStorage.layout().pending[sender];
        emit PendingTravelRuleCleared(sender);
    }

    // C-F4: the threshold setter/getter pair was removed. It wrote
    // TravelRuleStorage.threshold, which enforcement never read — the live
    // threshold is the travel_rule_threshold policy key (ComplianceTravelRuleLib).

    /**
     * @notice Travel-rule record bound to an envelope, SmartLock, or Cambio note id.
     * @dev C-F10: envelope-keyed records use the standard envelope ACL
     *      (parties / custodians / operator). Cambio note ids do not exist in
     *      EnvelopeStorage, and a bearer note has no on-chain counterparty to
     *      carve out — those records are compliance data, operator-only.
     *      Strangers get UnauthorizedViewer for both existing and non-existing
     *      ids, so this surface cannot be used to probe envelope existence.
     */
    function getTravelRule(bytes32 envelopeId)
        external
        view
        returns (TravelRuleStorage.TravelRule memory)
    {
        if (EnvelopeStorage.layout().envelopes[envelopeId].sender != address(0)) {
            ViewACLLib.requireEnvelopeAccess(envelopeId);
        } else {
            ViewACLLib.requireOperatorAccess();
        }
        return TravelRuleStorage.layout().byEnvelope[envelopeId];
    }

    function getPendingTravelRule(address sender)
        external
        view
        returns (TravelRuleStorage.PendingTravelRule memory)
    {
        address caller = _msgSender();
        if (caller != sender) {
            AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, caller);
        }
        return TravelRuleStorage.layout().pending[sender];
    }

    function _msgSender() internal view returns (address sender) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (ds.trustedForwarder != address(0) && msg.sender == ds.trustedForwarder && msg.data.length >= 20) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }
}
