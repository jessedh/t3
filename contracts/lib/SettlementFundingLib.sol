// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { SettlementCycleStorage } from "./SettlementCycleStorage.sol";
import { ISettlementCycle } from "../interfaces/ISettlementCycle.sol";
import { ReserveControlLib } from "./ReserveControlLib.sol";

/**
 * @title SettlementFundingLib
 * @notice Wave 5 BILATERAL funding (DvP) + finalization (ADR-003 Amendment 2). Each counterparty
 *         PAIR settles its net: the pair's net debtor funds the net owed to the pair's net
 *         creditor. Multilateral pooling is deliberately avoided (that is the CCP model).
 *         Funding is an on-chain attestation of the net payment (off-chain Fedwire), replay-
 *         protected by hash(cycleId, debtor, creditor, netOwed, asset, paymentRef) [council S2].
 *         Finalization requires every nonzero pair funded + the (short, configurable) challenge
 *         window elapsed, then releases each bank's bilateral-net lien. FAILED never releases
 *         liens (failure preserves the bilateral-net secured obligation).
 */
library SettlementFundingLib {
    error CycleNotConfirmedOrFunding(bytes32 cycleId, uint8 status);
    error NoPairDebt(bytes32 cycleId, address a, address b);
    error WrongPairParties(bytes32 cycleId);
    error FundingAmountMismatch(uint256 expected, uint256 provided);
    error FundingRefAlreadyUsed(bytes32 key);
    error PairAlreadyFunded(bytes32 cycleId);
    error CycleNotFunding(bytes32 cycleId, uint8 status);
    error ChallengeWindowNotElapsed(bytes32 cycleId, uint40 challengeDeadline);
    error PairNotFunded(bytes32 cycleId, address lo, address hi);

    /// @notice Deterministic replay key for a bilateral funding attestation.
    function fundingRefKey(
        bytes32 cycleId,
        address debtor,
        address creditor,
        uint256 netOwed,
        address settlementAsset,
        bytes32 paymentRef
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(cycleId, debtor, creditor, netOwed, settlementAsset, paymentRef));
    }

    /// @notice Attest that a pair's net debtor funded its net to the pair's net creditor.
    /// @dev First funding moves CONFIRMED -> FUNDING and opens the challenge window.
    function recordFunding(
        bytes32 cycleId,
        address debtor,
        address creditor,
        address settlementAsset,
        uint256 amount,
        bytes32 paymentRef,
        uint40 challengeWindow
    ) internal {
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        ISettlementCycle.SettlementCycle storage c = l.cycles[cycleId];
        if (
            c.status != uint8(ISettlementCycle.CycleState.CONFIRMED) &&
            c.status != uint8(ISettlementCycle.CycleState.FUNDING)
        ) revert CycleNotConfirmedOrFunding(cycleId, c.status);

        (address lo, address hi) = debtor < creditor ? (debtor, creditor) : (creditor, debtor);
        int256 p = l.pairNet[cycleId][lo][hi];
        if (p == 0) revert NoPairDebt(cycleId, debtor, creditor);

        // Identify the true debtor/creditor and net owed from the signed pair net.
        (address trueDebtor, uint256 netOwed) = p > 0 ? (lo, uint256(p)) : (hi, uint256(-p));
        if (debtor != trueDebtor) revert WrongPairParties(cycleId);
        if (amount != netOwed) revert FundingAmountMismatch(netOwed, amount);

        bytes32 key = fundingRefKey(cycleId, debtor, creditor, netOwed, settlementAsset, paymentRef);
        if (l.consumedFundingRef[key]) revert FundingRefAlreadyUsed(key);
        if (l.pairFunded[cycleId][lo][hi]) revert PairAlreadyFunded(cycleId);
        l.consumedFundingRef[key] = true;
        l.pairFunded[cycleId][lo][hi] = true;

        if (c.status == uint8(ISettlementCycle.CycleState.CONFIRMED)) {
            c.status = uint8(ISettlementCycle.CycleState.FUNDING);
            c.challengeDeadline = uint40(block.timestamp) + challengeWindow;
        }
        emit ISettlementCycle.SettlementCycleFunded(cycleId, debtor, settlementAsset, amount);
    }

    /// @notice Finalize once every nonzero pair is funded and the challenge window elapsed,
    ///         releasing each bank's bilateral-net lien.
    function finalize(bytes32 cycleId) internal {
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        ISettlementCycle.SettlementCycle storage c = l.cycles[cycleId];

        // Zero-net short-circuit (bug_008): a fully-offset cycle (every pair nets to zero —
        // the marquee A<->B $100-each-way case) has nothing to fund, so it can never reach
        // FUNDING. Allow CONFIRMED -> FINALIZED directly when every pair is zero. The lien-
        // release loop below would be a no-op (all liens are zero by construction), and there
        // is no off-chain payment to challenge.
        if (c.status == uint8(ISettlementCycle.CycleState.CONFIRMED)) {
            SettlementCycleStorage.Pair[] storage zpairs = l.cyclePairs[cycleId];
            for (uint256 i = 0; i < zpairs.length; i++) {
                if (l.pairNet[cycleId][zpairs[i].lo][zpairs[i].hi] != 0) {
                    revert CycleNotFunding(cycleId, c.status); // nonzero pair must go through funding
                }
            }
            c.status = uint8(ISettlementCycle.CycleState.FINALIZED);
            emit ISettlementCycle.SettlementCycleFinalized(cycleId, uint40(block.timestamp));
            return;
        }

        if (c.status != uint8(ISettlementCycle.CycleState.FUNDING)) revert CycleNotFunding(cycleId, c.status);
        if (uint40(block.timestamp) <= c.challengeDeadline) {
            revert ChallengeWindowNotElapsed(cycleId, c.challengeDeadline);
        }

        // Every pair with a nonzero net must be funded.
        SettlementCycleStorage.Pair[] storage pairs = l.cyclePairs[cycleId];
        for (uint256 i = 0; i < pairs.length; i++) {
            address lo = pairs[i].lo;
            address hi = pairs[i].hi;
            if (l.pairNet[cycleId][lo][hi] != 0 && !l.pairFunded[cycleId][lo][hi]) {
                revert PairNotFunded(cycleId, lo, hi);
            }
        }

        // Release each bank's bilateral-net lien (cycle settled net via the funding leg).
        address[] storage issuers = l.cycleIssuers[cycleId];
        for (uint256 i = 0; i < issuers.length; i++) {
            address bank = issuers[i];
            uint256 lien = l.cycleLien[cycleId][bank];
            if (lien > 0) {
                l.cycleLien[cycleId][bank] = 0;
                ReserveControlLib.releaseReimbursementEncumbrance(bank, lien);
            }
        }

        c.status = uint8(ISettlementCycle.CycleState.FINALIZED);
        emit ISettlementCycle.SettlementCycleFinalized(cycleId, uint40(block.timestamp));
    }
}
