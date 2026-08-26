// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { SettlementCycleStorage } from "../lib/SettlementCycleStorage.sol";
import { SettlementCycleLib } from "../lib/SettlementCycleLib.sol";
import { SettlementFundingLib } from "../lib/SettlementFundingLib.sol";
import { ISettlementCycle } from "../interfaces/ISettlementCycle.sol";

/**
 * @title SettlementCycleFacet
 * @notice Wave 5 on-chain surface for the multilateral settlement cycle with bilateral-net
 *         liens (ADR-003 Amendment 2). Keepers open/propose/finalize cycles; member banks
 *         confirm their own positions; attestors record bilateral funding; emergency role can
 *         fail a cycle. The atomic obligation-recording path (substituteLiability +
 *         recordObligation) is wired from TransferEnvelopeFacet on cross-institution settlement;
 *         recordObligation is also exposed here (keeper-gated) for keeper-driven recording.
 */
contract SettlementCycleFacet is ISettlementCycle, ReentrancyGuardBase {
    event SettlementCycleOpened(bytes32 indexed cycleId, uint8 cycleType, uint40 openedAt);
    event SettlementModelActiveSet(address indexed admin, bool active);

    error ZeroPaymentRef();
    error AttestorIsFundingParty(address attestor);
    error CycleChallenged(bytes32 cycleId);
    error SelfFunding(address party);
    error CycleNotInFunding(bytes32 cycleId, uint8 status);
    error ChallengeWindowClosed(bytes32 cycleId);
    error CycleAlreadyActive(bytes32 currentCycleId);
    error CycleNotCurrentRoutingCycle(bytes32 provided, bytes32 current);

    // ─── activation gate ──────────────────────────────────────────────────────

    /// @notice Activate/deactivate cross-bank settlement-cycle recording in envelope finalize.
    ///         While inactive (default), cross-institution finalize keeps the G.0.b
    ///         attribution-only behavior (no cycle/lien) — the safe pre-activation rollout state.
    function setSettlementModelActive(bool active) external {
        AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender);
        SettlementCycleStorage.layout().settlementModelActive = active;
        emit SettlementModelActiveSet(msg.sender, active);
    }

    function isSettlementModelActive() external view returns (bool) {
        return SettlementCycleStorage.layout().settlementModelActive;
    }

    // ─── keeper lifecycle ───────────────────────────────────────────────────

    function openSettlementCycle(uint8 cycleType) external nonReentrant returns (bytes32 cycleId) {
        AccessControlLib.checkRole(RoleConstants.SETTLEMENT_KEEPER_ROLE, msg.sender);
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        // bug_005: refuse to open a second routing cycle while one is in flight (would orphan it,
        // stranding its liens with no on-chain pointer). currentCycleId is cleared on propose.
        if (l.currentCycleId != bytes32(0)) revert CycleAlreadyActive(l.currentCycleId);
        cycleId = SettlementCycleLib.openCycle(cycleType);
        l.currentCycleId = cycleId;
        emit SettlementCycleOpened(cycleId, cycleType, uint40(block.timestamp));
    }

    /// @notice Keeper-driven obligation recording (the envelope triple-write calls the lib directly).
    function recordObligation(
        bytes32 cycleId,
        address outgoingIssuer,
        address receivingIssuer,
        address senderInstitution,
        address recipientInstitution,
        uint256 amount,
        bytes32 sourceTransferId
    ) external nonReentrant returns (bytes32) {
        AccessControlLib.checkRole(RoleConstants.SETTLEMENT_KEEPER_ROLE, msg.sender);
        return SettlementCycleLib.recordObligation(
            cycleId, outgoingIssuer, receivingIssuer, senderInstitution, recipientInstitution, amount, sourceTransferId
        );
    }

    function proposeSettlementCycle(bytes32 cycleId, bytes32 obligationRoot, uint40 confirmationDeadline)
        external
        nonReentrant
    {
        AccessControlLib.checkRole(RoleConstants.SETTLEMENT_KEEPER_ROLE, msg.sender);
        SettlementCycleLib.propose(cycleId, obligationRoot, confirmationDeadline);
        // bug_005: once a cycle leaves OPEN it can no longer take obligations, so it must stop
        // being the routing target. Cross-bank finalize then reverts NoOpenSettlementCycle
        // (explicit) until the keeper opens the next cycle, rather than the misleading
        // CycleNotInState from recordObligation against a non-OPEN cycle.
        // NOTE: this leaves a liveness/blackout window until the next openSettlementCycle.
        // Use proposeAndRolloverSettlementCycle for steady-state operation (no window);
        // keep this variant for the final cycle at shutdown.
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        if (l.currentCycleId == cycleId) l.currentCycleId = bytes32(0);
    }

    /// @notice E1 liveness fix: atomically propose the current cycle AND open the next routing
    ///         cycle in the same transaction, so `currentCycleId` is never null between cycles.
    ///         This closes the settlement blackout window where a cross-bank finalize would
    ///         revert `NoOpenSettlementCycle`. The next cycle inherits the proposed cycle's type;
    ///         to change cycle type, use plain `proposeSettlementCycle` + `openSettlementCycle`
    ///         (accepting the blackout window) at a planned boundary.
    /// @param cycleId The current routing cycle (must equal `currentCycleId`) to propose.
    /// @param obligationRoot The obligation root committed for the proposed cycle.
    /// @param confirmationDeadline Deadline for member confirmation of the proposed cycle.
    /// @return nextCycleId the id of the freshly-opened routing cycle.
    function proposeAndRolloverSettlementCycle(
        bytes32 cycleId,
        bytes32 obligationRoot,
        uint40 confirmationDeadline
    ) external nonReentrant returns (bytes32 nextCycleId) {
        AccessControlLib.checkRole(RoleConstants.SETTLEMENT_KEEPER_ROLE, msg.sender);
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        // Machine-enforce keeper intent: only the current routing cycle may be rolled over,
        // so a mistaken cycleId cannot silently propose a stale cycle and retarget routing.
        if (l.currentCycleId != cycleId) revert CycleNotCurrentRoutingCycle(cycleId, l.currentCycleId);
        // Capture the cycle type before the state transition; propose() requires OPEN state.
        uint8 cycleType = l.cycles[cycleId].cycleType;
        SettlementCycleLib.propose(cycleId, obligationRoot, confirmationDeadline);
        // Atomic roll-over: open the next cycle and retarget routing to it in the same tx.
        nextCycleId = SettlementCycleLib.openCycle(cycleType);
        l.currentCycleId = nextCycleId;
        emit SettlementCycleOpened(nextCycleId, cycleType, uint40(block.timestamp));
    }

    // ─── member confirmation ──────────────────────────────────────────────────

    /// @notice A member bank confirms its own net position in a proposed cycle.
    function confirmSettlementCycle(bytes32 cycleId) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.CONSORTIUM_MEMBER_ROLE, msg.sender);
        SettlementCycleLib.confirm(cycleId, msg.sender);
    }

    // ─── attestor funding + challenge ─────────────────────────────────────────

    /// @notice Attest a bilateral net funding. Attestor must not be the funding party (self-deal guard).
    function recordFunding(
        bytes32 cycleId,
        address debtor,
        address creditor,
        address settlementAsset,
        uint256 amount,
        bytes32 paymentRef,
        uint40 challengeWindow
    ) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.SETTLEMENT_ATTESTOR_ROLE, msg.sender);
        if (paymentRef == bytes32(0)) revert ZeroPaymentRef();
        if (debtor == creditor) revert SelfFunding(debtor);
        if (msg.sender == debtor || msg.sender == creditor) revert AttestorIsFundingParty(msg.sender);
        SettlementFundingLib.recordFunding(cycleId, debtor, creditor, settlementAsset, amount, paymentRef, challengeWindow);
    }

    /// @notice Raise a challenge against a FUNDING cycle within its challenge window; blocks finalize.
    function challengeSettlementCycle(bytes32 cycleId) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.SETTLEMENT_ATTESTOR_ROLE, msg.sender);
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        ISettlementCycle.SettlementCycle storage c = l.cycles[cycleId];
        if (c.status != uint8(ISettlementCycle.CycleState.FUNDING)) revert CycleNotInFunding(cycleId, c.status);
        if (uint40(block.timestamp) > c.challengeDeadline) revert ChallengeWindowClosed(cycleId);
        l.challenged[cycleId] = true;
        emit FedwireChallenged(cycleId, msg.sender);
    }

    // ─── keeper finalize / emergency fail ─────────────────────────────────────

    function finalizeSettlementCycle(bytes32 cycleId) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.SETTLEMENT_KEEPER_ROLE, msg.sender);
        if (SettlementCycleStorage.layout().challenged[cycleId]) revert CycleChallenged(cycleId);
        SettlementFundingLib.finalize(cycleId);
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        if (l.currentCycleId == cycleId) l.currentCycleId = bytes32(0);
    }

    function failSettlementCycle(bytes32 cycleId, bytes32 exceptionRoot) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.EMERGENCY_SETTLEMENT_ROLE, msg.sender);
        SettlementCycleLib.markFailed(cycleId, exceptionRoot);
        SettlementCycleStorage.Layout storage l = SettlementCycleStorage.layout();
        l.challenged[cycleId] = false; // resolution: failing a challenged cycle clears the flag
        if (l.currentCycleId == cycleId) l.currentCycleId = bytes32(0);
    }

    // ─── views (ISettlementCycle + extras) ────────────────────────────────────

    function getSettlementCycle(bytes32 cycleId) external view returns (ISettlementCycle.SettlementCycle memory) {
        return SettlementCycleStorage.layout().cycles[cycleId];
    }

    function getSettlementObligation(bytes32 obligationId)
        external
        view
        returns (ISettlementCycle.SettlementObligation memory)
    {
        return SettlementCycleStorage.layout().obligations[obligationId];
    }

    function getCurrentCycleId() external view returns (bytes32) {
        return SettlementCycleStorage.layout().currentCycleId;
    }

    function getPairNet(bytes32 cycleId, address a, address b) external view returns (int256) {
        return SettlementCycleLib.pairNetOf(cycleId, a, b);
    }

    function getCycleLien(bytes32 cycleId, address bank) external view returns (uint256) {
        return SettlementCycleLib.lienOf(cycleId, bank);
    }
}
