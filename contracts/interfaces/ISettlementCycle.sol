// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title ISettlementCycle
 * @notice Stable interface for settlement obligations and cycles.
 * @dev Wave 1 freezes events, types, errors, and roles. Mutating facet selectors
 *      are added in later implementation waves after economics/state transitions
 *      are specified. [Certain]
 */
interface ISettlementCycle {
    // ==================== ENUMS ====================

    enum CycleState {
        NONE,
        OPEN,
        PROPOSED,
        CONFIRMED,
        FUNDING,
        FINALIZED,
        FAILED
    }

    // ==================== STRUCTS ====================

    struct SettlementObligation {
        address outgoingIssuer;
        address receivingIssuer;
        address senderInstitution;
        address recipientInstitution;
        uint256 amount;
        bytes32 cycleId;
        bytes32 sourceTransferId;
        uint8 status;
    }

    struct SettlementCycle {
        uint8 status;
        uint8 cycleType;
        uint40 openedAt;
        uint40 proposalDeadline;
        uint40 confirmationDeadline;
        uint40 fundingDeadline;
        uint40 challengeDeadline;
        bytes32 obligationRoot;
        bytes32 exceptionRoot;
    }

    // ==================== EVENTS ====================

    event SettlementObligationRecorded(
        bytes32 indexed obligationId,
        address indexed outgoingIssuer,
        address indexed receivingIssuer,
        uint256 amount
    );

    event SettlementCycleProposed(
        bytes32 indexed cycleId,
        bytes32 obligationRoot,
        uint40 confirmationDeadline
    );

    event SettlementCycleConfirmed(
        bytes32 indexed cycleId,
        address indexed institution,
        uint256 netAmount
    );

    event SettlementCycleFunded(
        bytes32 indexed cycleId,
        address indexed fundingIssuer,
        address settlementAsset,
        uint256 amount
    );

    event SettlementCycleFinalized(
        bytes32 indexed cycleId,
        uint40 finalizedAt
    );

    event SettlementCycleFailed(
        bytes32 indexed cycleId,
        bytes32 exceptionRoot
    );

    event FedwireFallbackInitiated(
        bytes32 indexed cycleId,
        bytes32 indexed paymentRef,
        uint40 challengeDeadline
    );

    event FedwireAttested(
        bytes32 indexed cycleId,
        address indexed institution,
        bytes32 indexed paymentRef
    );

    event FedwireChallenged(
        bytes32 indexed cycleId,
        address indexed challenger
    );

    event FedwireFinalized(
        bytes32 indexed cycleId,
        bytes32 indexed paymentRef
    );

    // ==================== STABLE READS ====================

    /**
     * @notice Return a settlement obligation by ID.
     * @param obligationId The obligation identifier.
     * @return obligation The settlement obligation struct.
     */
    function getSettlementObligation(bytes32 obligationId)
        external
        view
        returns (SettlementObligation memory obligation);

    /**
     * @notice Return a settlement cycle by ID.
     * @param cycleId The cycle identifier.
     * @return cycle The settlement cycle struct.
     */
    function getSettlementCycle(bytes32 cycleId)
        external
        view
        returns (SettlementCycle memory cycle);
}
