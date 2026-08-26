// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { EnvelopeStorage } from "./EnvelopeStorage.sol";
import { EscrowLib } from "./EscrowLib.sol";
import { ClaimAttributionLib } from "./ClaimAttributionLib.sol";
import { ISmartLockEnvelope } from "../interfaces/ISmartLockEnvelope.sol";
import { WalletRecoveryStorage } from "./WalletRecoveryStorage.sol";
import { ComplianceLib } from "./ComplianceLib.sol";
import { ComplianceHoldLib } from "./ComplianceHoldLib.sol";

library SmartLockEnvelopeLib {
    error EnvelopeNotFound(bytes32 envelopeId);
    error EnvelopeNotInState(bytes32 envelopeId, uint8 current, uint8 required);

    uint8 private constant ES_NONE = 0;
    uint8 private constant ES_CREATED = 1;
    uint8 private constant ES_REVERSED = 3;

    /**
     * @notice Internal helper to cancel a SmartLock envelope.
     * @dev Transitions state to ES_REVERSED and releases remaining escrowed amount to sender (or successor).
     * @param envelopeId The envelope to cancel.
     * @param cancelledBy The address initiating the cancellation (for event logging).
     */
    function _cancelSmartLockEnvelope(bytes32 envelopeId, address cancelledBy) internal {
        EnvelopeStorage.Layout storage el = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = el.envelopes[envelopeId];

        if (env.state == ES_NONE && env.sender == address(0)) {
            revert EnvelopeNotFound(envelopeId);
        }
        if (env.state != ES_CREATED) {
            revert EnvelopeNotInState(envelopeId, env.state, ES_CREATED);
        }

        uint256 escrowed = env.amount - env.reversedAmount;
        env.state = ES_REVERSED;

        // Payee routing: route sender payout through _resolveRecoveryPayee
        address payee = WalletRecoveryStorage._resolveRecoveryPayee(env.sender);
        EscrowLib.releaseEscrow(payee, ClaimAttributionLib.SMARTLOCK_DOMAIN, envelopeId, escrowed);

        emit EnvelopeStorage.EnvelopeReversed(envelopeId, escrowed, uint40(block.timestamp));
        emit ISmartLockEnvelope.SmartLockEnvelopeCancelled(envelopeId, cancelledBy);
    }

    /**
     * @notice Cancel with a compliance-hold check on the sender refund leg (Task 4.2, D2).
     * @dev Used by the single-item cancel path (SmartLockEnvelopeFacet). The recovery
     *      bulk loops keep calling _cancelSmartLockEnvelope directly — they get isHeld
     *      skip guards in Task 4.4 instead, and must not inline the checkOrHold
     *      delegatecall (WalletRecoveryFacet size freeze). A hold parks the envelope in
     *      DISPUTED under SMARTLOCK_DOMAIN; disposition runs via resolveComplianceHold.
     * @return held true when the refund was parked in a hold (no cancel performed).
     */
    function _cancelSmartLockEnvelopeOrHold(
        bytes32 envelopeId,
        address cancelledBy
    ) internal returns (bool held) {
        EnvelopeStorage.EnvelopeData storage env = EnvelopeStorage.layout().envelopes[envelopeId];

        if (env.state == ES_NONE && env.sender == address(0)) {
            revert EnvelopeNotFound(envelopeId);
        }
        if (env.state != ES_CREATED) {
            revert EnvelopeNotInState(envelopeId, env.state, ES_CREATED);
        }

        held = ComplianceHoldLib.checkOrHold(
            ClaimAttributionLib.SMARTLOCK_DOMAIN,
            envelopeId,
            env.recipient,
            env.sender, // RAW — recovery resolution happens inside the lib
            env.amount - env.reversedAmount,
            ComplianceLib.Context.ESCROW_RELEASE,
            bytes32(0),
            ES_CREATED,
            ComplianceHoldLib.LEG_SMARTLOCK_CANCEL
        );
        if (held) return true;

        _cancelSmartLockEnvelope(envelopeId, cancelledBy);
        return false;
    }
}
