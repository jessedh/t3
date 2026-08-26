// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { SettlementCycleStorage } from "./SettlementCycleStorage.sol";
import { ISettlementCycle } from "../interfaces/ISettlementCycle.sol";
import { ReserveControlLib } from "./ReserveControlLib.sol";

/**
 * @title SettlementCycleLib
 * @notice Wave 5 multilateral cycle container with BILATERAL-net liens (ADR-003 Amendment 2,
 *         2026-06-15). Each obligation updates the signed net between its counterparty pair and
 *         re-derives each bank's lien from its current bilateral net debit — so a reverse-
 *         direction flow RELEASES a counterparty's lien (a $100-each-way A<->B exchange nets to
 *         zero and locks zero collateral). Liens are reflected into ReserveControlLib's
 *         reimbursement encumbrance as deltas. Funding/finalization live in SettlementFundingLib.
 */
library SettlementCycleLib {
    error ZeroAddress();
    error ZeroAmount();
    error SelfObligation(address issuer);
    error CycleNotFound(bytes32 cycleId);
    error CycleNotInState(bytes32 cycleId, uint8 current, uint8 required);
    error NotCycleIssuer(bytes32 cycleId, address institution);
    error AlreadyConfirmed(bytes32 cycleId, address institution);
    error CycleAlreadyFinal(bytes32 cycleId, uint8 status);
    error TooManyIssuers(bytes32 cycleId);

    /// @dev Bounds the per-cycle issuer set so confirm()/finalize() loops stay gas-safe.
    uint256 internal constant MAX_CYCLE_ISSUERS = 25;

    function _requireState(
        SettlementCycleStorage.Layout storage l,
        bytes32 cycleId,
        ISettlementCycle.CycleState required
    ) private view returns (ISettlementCycle.SettlementCycle storage c) {
        c = l.cycles[cycleId];
        if (c.status == uint8(ISettlementCycle.CycleState.NONE)) revert CycleNotFound(cycleId);
        if (c.status != uint8(required)) revert CycleNotInState(cycleId, c.status, uint8(required));
    }

    /// @notice Open a new settlement cycle in OPEN state.
    function openCycle(uint8 cycleType) internal returns (bytes32 cycleId) {
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        uint256 nonce = ++l.cycleNonce;
        cycleId = keccak256(abi.encode("t3.cycle", nonce, block.timestamp));
        ISettlementCycle.SettlementCycle storage c = l.cycles[cycleId];
        c.status = uint8(ISettlementCycle.CycleState.OPEN);
        c.cycleType = cycleType;
        c.openedAt = uint40(block.timestamp);
    }

    /// @notice Record an interbank obligation into an OPEN cycle, updating the pair net and
    ///         re-deriving both banks' bilateral-net liens (encumbrance deltas applied).
    function recordObligation(
        bytes32 cycleId,
        address outgoingIssuer,
        address receivingIssuer,
        address senderInstitution,
        address recipientInstitution,
        uint256 amount,
        bytes32 sourceTransferId
    ) internal returns (bytes32 obligationId) {
        if (outgoingIssuer == address(0) || receivingIssuer == address(0)) revert ZeroAddress();
        if (outgoingIssuer == receivingIssuer) revert SelfObligation(outgoingIssuer);
        if (amount == 0) revert ZeroAmount();

        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        _requireState(l, cycleId, ISettlementCycle.CycleState.OPEN);

        uint256 nonce = ++l.obligationNonce;
        obligationId = keccak256(abi.encode(cycleId, sourceTransferId, nonce));
        l.obligations[obligationId] = ISettlementCycle.SettlementObligation({
            outgoingIssuer: outgoingIssuer,
            receivingIssuer: receivingIssuer,
            senderInstitution: senderInstitution,
            recipientInstitution: recipientInstitution,
            amount: amount,
            cycleId: cycleId,
            sourceTransferId: sourceTransferId,
            status: uint8(ISettlementCycle.CycleState.OPEN)
        });
        l.cycleObligationIds[cycleId].push(obligationId);

        _touchIssuer(l, cycleId, outgoingIssuer);
        _touchIssuer(l, cycleId, receivingIssuer);

        // Canonical ordered pair; track signed net (lo owes hi if > 0).
        (address lo, address hi) = outgoingIssuer < receivingIssuer
            ? (outgoingIssuer, receivingIssuer)
            : (receivingIssuer, outgoingIssuer);
        _touchPair(l, cycleId, lo, hi);

        int256 p = l.pairNet[cycleId][lo][hi];
        // outgoing owes receiving more: if outgoing == lo, lo owes hi more (+), else (-).
        int256 pNew = outgoingIssuer == lo ? p + int256(amount) : p - int256(amount);
        l.pairNet[cycleId][lo][hi] = pNew;

        // Re-derive each side's lien for this pair and apply the delta.
        _applyLienDelta(l, cycleId, lo, _pos(pNew) - _pos(p));
        _applyLienDelta(l, cycleId, hi, _pos(-pNew) - _pos(-p));

        emit ISettlementCycle.SettlementObligationRecorded(obligationId, outgoingIssuer, receivingIssuer, amount);
    }

    /// @notice OPEN -> PROPOSED.
    function propose(bytes32 cycleId, bytes32 obligationRoot, uint40 confirmationDeadline) internal {
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        ISettlementCycle.SettlementCycle storage c = _requireState(l, cycleId, ISettlementCycle.CycleState.OPEN);
        c.status = uint8(ISettlementCycle.CycleState.PROPOSED);
        c.obligationRoot = obligationRoot;
        c.confirmationDeadline = confirmationDeadline;
        emit ISettlementCycle.SettlementCycleProposed(cycleId, obligationRoot, confirmationDeadline);
    }

    /// @notice Per-institution confirmation; cycle flips PROPOSED -> CONFIRMED at full quorum.
    function confirm(bytes32 cycleId, address institution) internal {
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        ISettlementCycle.SettlementCycle storage c = _requireState(l, cycleId, ISettlementCycle.CycleState.PROPOSED);
        if (!l.issuerSeen[cycleId][institution]) revert NotCycleIssuer(cycleId, institution);
        if (l.confirmedBy[cycleId][institution]) revert AlreadyConfirmed(cycleId, institution);

        l.confirmedBy[cycleId][institution] = true;
        uint256 count = ++l.confirmedCount[cycleId];
        emit ISettlementCycle.SettlementCycleConfirmed(cycleId, institution, l.cycleLien[cycleId][institution]);

        if (count == l.cycleIssuers[cycleId].length) {
            c.status = uint8(ISettlementCycle.CycleState.CONFIRMED);
        }
    }

    /// @notice Mark a non-final cycle FAILED. Liens are NOT released (ADR-003: failure preserves
    ///         the outgoing issuer's secured reimbursement obligation, now bilateral-net).
    function markFailed(bytes32 cycleId, bytes32 exceptionRoot) internal {
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        ISettlementCycle.SettlementCycle storage c = l.cycles[cycleId];
        if (c.status == uint8(ISettlementCycle.CycleState.NONE)) revert CycleNotFound(cycleId);
        if (
            c.status == uint8(ISettlementCycle.CycleState.FINALIZED) ||
            c.status == uint8(ISettlementCycle.CycleState.FAILED)
        ) revert CycleAlreadyFinal(cycleId, c.status);
        c.status = uint8(ISettlementCycle.CycleState.FAILED);
        c.exceptionRoot = exceptionRoot;
        emit ISettlementCycle.SettlementCycleFailed(cycleId, exceptionRoot);
    }

    // ─── views ───────────────────────────────────────────────────────────────

    /// @notice Signed net for an ordered/unordered pair (positive = `a` owes `b`).
    function pairNetOf(bytes32 cycleId, address a, address b) internal view returns (int256) {
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        (address lo, address hi) = a < b ? (a, b) : (b, a);
        int256 p = l.pairNet[cycleId][lo][hi];
        return a == lo ? p : -p;
    }

    /// @notice A bank's current bilateral-net lien in the cycle (sum of its net debits).
    function lienOf(bytes32 cycleId, address bank) internal view returns (uint256) {
        return SettlementCycleStorage.layout().cycleLien[cycleId][bank];
    }

    // ─── internal ──────────────────────────────────────────────────────────────

    function _applyLienDelta(
        SettlementCycleStorage.Layout storage l,
        bytes32 cycleId,
        address bank,
        int256 delta
    ) private {
        if (delta > 0) {
            uint256 d = uint256(delta);
            l.cycleLien[cycleId][bank] += d;
            ReserveControlLib.encumberForReimbursement(bank, d);
        } else if (delta < 0) {
            uint256 d = uint256(-delta);
            l.cycleLien[cycleId][bank] -= d;
            ReserveControlLib.releaseReimbursementEncumbrance(bank, d);
        }
    }

    function _pos(int256 x) private pure returns (int256) {
        return x > 0 ? x : int256(0);
    }

    function _touchIssuer(SettlementCycleStorage.Layout storage l, bytes32 cycleId, address issuer) private {
        if (!l.issuerSeen[cycleId][issuer]) {
            if (l.cycleIssuers[cycleId].length >= MAX_CYCLE_ISSUERS) revert TooManyIssuers(cycleId);
            l.issuerSeen[cycleId][issuer] = true;
            l.cycleIssuers[cycleId].push(issuer);
        }
    }

    function _touchPair(SettlementCycleStorage.Layout storage l, bytes32 cycleId, address lo, address hi) private {
        if (!l.pairSeen[cycleId][lo][hi]) {
            l.pairSeen[cycleId][lo][hi] = true;
            l.cyclePairs[cycleId].push(SettlementCycleStorage.Pair({ lo: lo, hi: hi }));
        }
    }
}
