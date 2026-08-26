// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { IssuanceControlStorage } from "./IssuanceControlStorage.sol";
import { IssuanceCapacityLib } from "./IssuanceCapacityLib.sol";

/**
 * @title IssuanceRoutingLib
 * @notice Quote -> reserve -> execute state machine for Wave 4 attributed issuance.
 * @dev Pure state-machine logic over IssuanceControlStorage. Access control, reentrancy
 *      protection, and the actual mintAttributed call live in IssuanceControlFacet — this
 *      library only manages reservation lifecycle, reservedTotal (anti-oversubscription),
 *      and daily-cap enforcement (hard check at execute). Reservations are idempotent: once
 *      Executed/Cancelled/Expired they cannot transition again.
 */
library IssuanceRoutingLib {
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientCapacity(address bank, uint256 requested, uint256 available);
    error DailyCapExceeded(address bank, uint256 requested, uint256 remaining);
    error ReservationNotActive(bytes32 id);
    error ReservationExpired(bytes32 id);
    error ReservationNotExpired(bytes32 id);

    uint40 internal constant DEFAULT_TTL = 1 hours;

    event IssuanceReserved(bytes32 indexed id, address indexed bank, uint256 amount, uint40 expiry);
    event IssuanceExecuted(bytes32 indexed id, address indexed bank, uint256 amount);
    event IssuanceReservationReleased(bytes32 indexed id, address indexed bank, uint256 amount, uint8 newState);

    /// @notice Quote the amount a bank may reserve right now (view).
    function quote(address bank) internal view returns (uint256) {
        return IssuanceCapacityLib.availableToReserve(bank);
    }

    /// @notice Create an Active reservation that encumbers capacity for TTL seconds.
    /// @param creator the caller; execute/cancel are restricted to it (or admin) at the facet.
    function reserve(address bank, uint256 amount, address creator) internal returns (bytes32 id) {
        if (bank == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 avail = IssuanceCapacityLib.availableToReserve(bank);
        if (amount > avail) revert InsufficientCapacity(bank, amount, avail);

        IssuanceControlStorage.Layout storage l = IssuanceControlStorage.layout();
        uint256 nonce = ++l.reservationNonce;
        id = keccak256(abi.encode(bank, amount, block.timestamp, nonce));
        uint40 expiry = uint40(block.timestamp) + DEFAULT_TTL;
        l.reservations[id] = IssuanceControlStorage.Reservation({
            bank: bank,
            amount: amount,
            expiry: expiry,
            state: uint8(IssuanceControlStorage.ReservationState.Active),
            creator: creator
        });
        l.reservedTotal[bank] += amount;
        emit IssuanceReserved(id, bank, amount, expiry);
    }

    /// @notice Execute an Active, non-expired reservation. Enforces the daily cap (hard gate),
    ///         frees reservedTotal, records daily usage. Returns (bank, amount) for the facet
    ///         to mintAttributed. Idempotent: state flips to Executed.
    /// @dev Daily cap is enforced and consumed against the day in which EXECUTE occurs, not the
    ///      day of reserve(). A reservation created late on day N may execute within its TTL
    ///      into day N+1 and consume day N+1's allowance (intended). The cap can never be
    ///      exceeded — execute reverts the overage; an over-reserved amount simply fails to
    ///      execute and can be cancelled/expired.
    function execute(bytes32 id) internal returns (address bank, uint256 amount) {
        IssuanceControlStorage.Layout storage l = IssuanceControlStorage.layout();
        IssuanceControlStorage.Reservation storage r = l.reservations[id];
        if (r.state != uint8(IssuanceControlStorage.ReservationState.Active)) revert ReservationNotActive(id);
        if (uint40(block.timestamp) > r.expiry) revert ReservationExpired(id);

        bank = r.bank;
        amount = r.amount;
        uint256 remaining = IssuanceCapacityLib.dailyRemaining(bank);
        if (amount > remaining) revert DailyCapExceeded(bank, amount, remaining);

        r.state = uint8(IssuanceControlStorage.ReservationState.Executed);
        l.reservedTotal[bank] -= amount;
        IssuanceCapacityLib.consumeDaily(bank, amount);
        emit IssuanceExecuted(id, bank, amount);
    }

    /// @notice Cancel an Active, non-expired reservation (facet restricts to bank/admin).
    function cancel(bytes32 id) internal returns (address bank, uint256 amount) {
        IssuanceControlStorage.Layout storage l = IssuanceControlStorage.layout();
        IssuanceControlStorage.Reservation storage r = l.reservations[id];
        if (r.state != uint8(IssuanceControlStorage.ReservationState.Active)) revert ReservationNotActive(id);
        if (uint40(block.timestamp) > r.expiry) revert ReservationExpired(id); // use expire() instead
        bank = r.bank;
        amount = r.amount;
        r.state = uint8(IssuanceControlStorage.ReservationState.Cancelled);
        l.reservedTotal[bank] -= amount;
        emit IssuanceReservationReleased(id, bank, amount, r.state);
    }

    /// @notice Sweep an expired Active reservation back into free capacity (facet may allow anyone).
    function expire(bytes32 id) internal returns (address bank, uint256 amount) {
        IssuanceControlStorage.Layout storage l = IssuanceControlStorage.layout();
        IssuanceControlStorage.Reservation storage r = l.reservations[id];
        if (r.state != uint8(IssuanceControlStorage.ReservationState.Active)) revert ReservationNotActive(id);
        if (uint40(block.timestamp) <= r.expiry) revert ReservationNotExpired(id);
        bank = r.bank;
        amount = r.amount;
        r.state = uint8(IssuanceControlStorage.ReservationState.Expired);
        l.reservedTotal[bank] -= amount;
        emit IssuanceReservationReleased(id, bank, amount, r.state);
    }
}
