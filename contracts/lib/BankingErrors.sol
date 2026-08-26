// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title BankingErrors
 * @notice Canonical decoupled errors for banking control domains.
 * @dev All state parameters use uint8 so this library does not import interfaces.
 *      [Certain]
 */
library BankingErrors {
    error StaleCapacityAttestation(address issuer, uint40 expiresAt, uint40 currentTime);
    error InsufficientFundedCapacity(address issuer, uint256 requested, uint256 available);
    error TransferHeadroomExceeded(address receivingIssuer, uint256 requested, uint256 available);
    error StandingAssumptionLimitExceeded(address outgoingIssuer, address receivingIssuer, uint256 requested, uint256 limit);
    error CeilingExceeded(address issuer, uint256 requested, uint256 ceiling);
    error IneligibleWallet(address wallet, bytes32 reason);
    error InvalidSponsor(address requestingBank, address sponsorIssuer);
    error InvalidCycleState(bytes32 cycleId, uint8 currentState, uint8 expectedState);
    error MissingPositionConfirmation(bytes32 cycleId, address institution);
    error DuplicateObligation(bytes32 obligationId);
    error ReusedPaymentReference(bytes32 paymentRef);
    error ReserveFloorBreached(address issuer, uint256 effectiveReserve, uint256 requiredFloor);
    error LifecycleFreeze(address institution, uint8 mode);
}
