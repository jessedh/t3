// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title IIssuanceControl
 * @notice Stable interface for issuance capacity, sponsorship, and issuer position.
 * @dev Wave 1 freezes events, types, errors, and roles. Mutating facet selectors
 *      are added in later implementation waves after economics/state transitions
 *      are specified. [Certain]
 */
interface IIssuanceControl {
    // ==================== ENUMS ====================

    enum IssuanceState {
        NONE,
        QUOTED,
        RESERVED,
        EXECUTED,
        CANCELLED,
        EXPIRED
    }

    // ==================== STRUCTS ====================

    struct CapacityAttestation {
        uint256 ceiling;
        uint256 capitalHeadroom;
        uint256 liquidityHeadroom;
        uint256 concentrationHeadroom;
        uint256 growthHeadroom;
        uint40 effectiveAt;
        uint40 expiresAt;
        bytes32 sourcePeriod;
        bytes32 formulaVersion;
        bytes32 evidenceHash;
    }

    struct IssuerPosition {
        uint256 attributedOutstanding;
        uint256 pendingInboundReserveReimbursement;
        uint256 pendingOutboundReserveReimbursement;
        uint256 reservedIssuanceCapacity;
        uint256 reservedEnvelopeAssumptionCapacity;
        uint256 fixedLiquidityBuffer;
        uint16 variableLiquidityBufferBps;
        uint256 targetSurplus;
    }

    struct Sponsorship {
        address sponsorIssuer;
        uint256 sponsorLimit;
        uint40 effectiveAt;
        uint40 expiresAt;
        bool bankOptedOut;
        bool sponsorAccepted;
    }

    // ==================== EVENTS ====================

    event CapacityAttested(
        address indexed issuer,
        uint256 ceiling,
        uint40 expiresAt,
        bytes32 evidenceHash
    );

    event SponsorshipUpdated(
        address indexed requestingBank,
        address indexed sponsorIssuer,
        bool active
    );

    event IssuanceQuoted(
        bytes32 indexed quoteId,
        address indexed servicingInstitution,
        address indexed legalIssuer,
        uint256 amount
    );

    event IssuanceReserved(
        bytes32 indexed reservationId,
        bytes32 indexed quoteId,
        uint256 amount,
        uint40 expiresAt
    );

    event IssuanceExecuted(
        bytes32 indexed reservationId,
        address indexed beneficiary,
        address indexed legalIssuer,
        uint256 amount
    );

    event EnvelopeCapacityReserved(
        bytes32 indexed envelopeId,
        address indexed receivingIssuer,
        uint256 amount,
        uint40 expiresAt
    );

    event EnvelopeCapacityReleased(
        bytes32 indexed envelopeId,
        address indexed receivingIssuer,
        uint256 amount
    );

    // ==================== STABLE READS ====================

    /**
     * @notice Return the latest capacity attestation for an issuer.
     * @param issuer The issuer address.
     * @return attestation The capacity attestation struct.
     */
    function getCapacityAttestation(address issuer)
        external
        view
        returns (CapacityAttestation memory attestation);

    /**
     * @notice Return the current issuer position.
     * @param issuer The issuer address.
     * @return position The issuer position struct.
     */
    function getIssuerPosition(address issuer)
        external
        view
        returns (IssuerPosition memory position);

    /**
     * @notice Return the sponsorship configuration between a bank and sponsor.
     * @param requestingBank The requesting bank address.
     * @param sponsorIssuer The sponsor issuer address.
     * @return sponsorship The sponsorship struct.
     */
    function getSponsorship(address requestingBank, address sponsorIssuer)
        external
        view
        returns (Sponsorship memory sponsorship);
}
