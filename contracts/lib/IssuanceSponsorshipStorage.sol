// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library IssuanceSponsorshipStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.issuance-sponsorship.v1");

    struct Layout {
        uint32 storageVersion;
        bool initialized;
        // wave-specific fields inserted HERE in later waves, BEFORE the gap,
        // shrinking __gap by the number of slots consumed. Never append after the gap.
        uint256[48] __gap;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly { l.slot := slot }
    }
}
