// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ReserveControlLib } from "./ReserveControlLib.sol";
import { ClaimAttributionStorage } from "./ClaimAttributionStorage.sol";
import { IssuanceControlStorage } from "./IssuanceControlStorage.sol";

/**
 * @title IssuanceCapacityLib
 * @notice Per-bank issuance headroom for the Wave 4 capacity model.
 * @dev Capacity = available reserve (factor-adjusted, net of reimbursement encumbrance —
 *      see ReserveControlLib.availableReserve, council C1) minus the bank's outstanding
 *      attributed liability, then bounded by active reservations and the daily cap so that
 *      concurrent reservations cannot oversubscribe (council security S-reservation).
 */
library IssuanceCapacityLib {
    uint256 internal constant DAY = 1 days;

    /// @notice Raw capacity: factor-adjusted available reserve minus outstanding liability (saturating).
    function issuanceCapacity(address bank) internal view returns (uint256) {
        uint256 reserve = ReserveControlLib.availableReserve(bank);
        uint256 outstanding = ClaimAttributionStorage.layout().issuerAttributedOutstanding[bank];
        return reserve > outstanding ? reserve - outstanding : 0;
    }

    /// @notice Remaining daily allowance (type(uint256).max when no cap configured).
    function dailyRemaining(address bank) internal view returns (uint256) {
        IssuanceControlStorage.Layout storage l = IssuanceControlStorage.layout();
        uint256 cap = l.dailyCapLimit[bank];
        if (cap == 0) return type(uint256).max;
        uint40 today = uint40(block.timestamp / DAY);
        if (l.dailyBucket[bank] != today) return cap; // bucket rolls over → full allowance
        uint256 used = l.dailyUsed[bank];
        return cap > used ? cap - used : 0;
    }

    /// @notice Amount a bank may reserve now: free capacity (capacity − active reservations)
    ///         bounded by the daily remaining allowance.
    function availableToReserve(address bank) internal view returns (uint256) {
        IssuanceControlStorage.Layout storage l = IssuanceControlStorage.layout();
        uint256 cap = issuanceCapacity(bank);
        uint256 reserved = l.reservedTotal[bank];
        uint256 freeCapacity = cap > reserved ? cap - reserved : 0;
        uint256 daily = dailyRemaining(bank);
        return freeCapacity < daily ? freeCapacity : daily;
    }

    /// @notice Record daily-cap consumption on execute, rolling the day bucket if needed.
    function consumeDaily(address bank, uint256 amount) internal {
        IssuanceControlStorage.Layout storage l = IssuanceControlStorage.layout();
        if (l.dailyCapLimit[bank] == 0) return; // no cap → nothing to track
        uint40 today = uint40(block.timestamp / DAY);
        if (l.dailyBucket[bank] != today) {
            l.dailyBucket[bank] = today;
            l.dailyUsed[bank] = amount;
        } else {
            l.dailyUsed[bank] += amount;
        }
    }
}
