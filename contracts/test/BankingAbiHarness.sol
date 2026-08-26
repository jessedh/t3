// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "../interfaces/IIssuanceControl.sol";
import "../interfaces/ISettlementCycle.sol";
import "../interfaces/IInstitutionLifecycle.sol";
import "../lib/BankingErrors.sol";

/**
 * @title BankingAbiHarness
 * @dev Test-only harness exposing enum ordinals and error selectors so the
 *      JS test suite can verify ABI freeze invariants without deploying facets.
 */
contract BankingAbiHarness {
    // ==================== ENUM ORDINALS ====================

    function issuanceStateNone() external pure returns (uint8) {
        return uint8(IIssuanceControl.IssuanceState.NONE);
    }

    function issuanceStateQuoted() external pure returns (uint8) {
        return uint8(IIssuanceControl.IssuanceState.QUOTED);
    }

    function issuanceStateReserved() external pure returns (uint8) {
        return uint8(IIssuanceControl.IssuanceState.RESERVED);
    }

    function issuanceStateExecuted() external pure returns (uint8) {
        return uint8(IIssuanceControl.IssuanceState.EXECUTED);
    }

    function issuanceStateCancelled() external pure returns (uint8) {
        return uint8(IIssuanceControl.IssuanceState.CANCELLED);
    }

    function issuanceStateExpired() external pure returns (uint8) {
        return uint8(IIssuanceControl.IssuanceState.EXPIRED);
    }

    function cycleStateNone() external pure returns (uint8) {
        return uint8(ISettlementCycle.CycleState.NONE);
    }

    function cycleStateOpen() external pure returns (uint8) {
        return uint8(ISettlementCycle.CycleState.OPEN);
    }

    function cycleStateProposed() external pure returns (uint8) {
        return uint8(ISettlementCycle.CycleState.PROPOSED);
    }

    function cycleStateConfirmed() external pure returns (uint8) {
        return uint8(ISettlementCycle.CycleState.CONFIRMED);
    }

    function cycleStateFunding() external pure returns (uint8) {
        return uint8(ISettlementCycle.CycleState.FUNDING);
    }

    function cycleStateFinalized() external pure returns (uint8) {
        return uint8(ISettlementCycle.CycleState.FINALIZED);
    }

    function cycleStateFailed() external pure returns (uint8) {
        return uint8(ISettlementCycle.CycleState.FAILED);
    }

    function institutionModeUnregistered() external pure returns (uint8) {
        // UNREGISTERED was removed from the interface; storage default(0) = ACTIVE.
        // Return 255 as a sentinel so callers know this concept no longer has a value.
        return type(uint8).max;
    }

    function institutionModeActive() external pure returns (uint8) {
        return uint8(IInstitutionLifecycle.InstitutionMode.ACTIVE);
    }

    function institutionModeIssuancePaused() external pure returns (uint8) {
        return uint8(IInstitutionLifecycle.InstitutionMode.ISSUANCE_PAUSED);
    }

    function institutionModeOrderlyExit() external pure returns (uint8) {
        return uint8(IInstitutionLifecycle.InstitutionMode.ORDERLY_EXIT);
    }

    function institutionModeDefaulted() external pure returns (uint8) {
        return uint8(IInstitutionLifecycle.InstitutionMode.DEFAULTED);
    }

    function institutionModeResolved() external pure returns (uint8) {
        return uint8(IInstitutionLifecycle.InstitutionMode.RESOLVED);
    }

    // ==================== ERROR SELECTORS ====================

    function staleCapacityAttestationSelector() external pure returns (bytes4) {
        return BankingErrors.StaleCapacityAttestation.selector;
    }

    function insufficientFundedCapacitySelector() external pure returns (bytes4) {
        return BankingErrors.InsufficientFundedCapacity.selector;
    }

    function transferHeadroomExceededSelector() external pure returns (bytes4) {
        return BankingErrors.TransferHeadroomExceeded.selector;
    }

    function standingAssumptionLimitExceededSelector() external pure returns (bytes4) {
        return BankingErrors.StandingAssumptionLimitExceeded.selector;
    }

    function ceilingExceededSelector() external pure returns (bytes4) {
        return BankingErrors.CeilingExceeded.selector;
    }

    function ineligibleWalletSelector() external pure returns (bytes4) {
        return BankingErrors.IneligibleWallet.selector;
    }

    function invalidSponsorSelector() external pure returns (bytes4) {
        return BankingErrors.InvalidSponsor.selector;
    }

    function invalidCycleStateSelector() external pure returns (bytes4) {
        return BankingErrors.InvalidCycleState.selector;
    }

    function missingPositionConfirmationSelector() external pure returns (bytes4) {
        return BankingErrors.MissingPositionConfirmation.selector;
    }

    function duplicateObligationSelector() external pure returns (bytes4) {
        return BankingErrors.DuplicateObligation.selector;
    }

    function reusedPaymentReferenceSelector() external pure returns (bytes4) {
        return BankingErrors.ReusedPaymentReference.selector;
    }

    function reserveFloorBreachedSelector() external pure returns (bytes4) {
        return BankingErrors.ReserveFloorBreached.selector;
    }

    function lifecycleFreezeSelector() external pure returns (bytes4) {
        return BankingErrors.LifecycleFreeze.selector;
    }
}
