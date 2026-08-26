// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title IssuanceControlStorage
 * @notice Isolated namespaced storage for the legacy mint kill-switch.
 * @dev Storage slot: keccak256("t3.storage.issuancecontrol.v1")
 */
library IssuanceControlStorage {
    error LegacyMintLocked();

    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.issuancecontrol.v1");

    /// @notice Lifecycle of an issuance reservation (Wave 4 quote/reserve/execute).
    enum ReservationState { None, Active, Executed, Cancelled, Expired }

    struct Reservation {
        address bank;        // bank the capacity is reserved for / issued to
        uint256 amount;      // reserved issuance amount (18-decimal)
        uint40 expiry;       // reservation TTL; after this it is no longer executable
        uint8 state;         // ReservationState
        address creator;     // who reserved (execute/cancel restricted to creator or admin)
    }

    struct Layout {
        /// @notice Inverted fail-safe flag: false = locked, true = unlocked.
        bool legacyMintUnlocked;
        /// @notice When true, legacy mintForConsortiumBank is gated off and issuance must
        ///         go through quote/reserve/execute (Wave 4).
        bool capacityModelActive;
        /// @notice Monotonic counter for deterministic reservation IDs.
        uint256 reservationNonce;
        /// @notice reservationId => Reservation.
        mapping(bytes32 => Reservation) reservations;
        /// @notice Sum of Active reservation amounts per bank (reduces available capacity).
        mapping(address => uint256) reservedTotal;
        /// @notice Per-bank daily issuance cap (0 = no cap).
        mapping(address => uint256) dailyCapLimit;
        /// @notice Amount issued in the bank's current day bucket.
        mapping(address => uint256) dailyUsed;
        /// @notice Day index (block.timestamp / 1 days) of the bank's current bucket.
        mapping(address => uint40) dailyBucket;
        /// @notice Reserved slots. 6 slots consumed by the fields above (capacityModelActive
        ///         packs into slot 0 with legacyMintUnlocked), so the gap is 50 - 6 = 44.
        uint256[44] __gap;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }

    /**
     * @notice Reverts with LegacyMintLocked unless the legacy mint path is unlocked.
     */
    function requireUnlocked() internal view {
        if (!layout().legacyMintUnlocked) {
            revert LegacyMintLocked();
        }
    }
}
