// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title CambioIssuerStorage
 * @notice Isolated storage for non-bank Cambio note issuers.
 * @dev Uses dedicated storage slot to avoid collisions with StorageLib.AppStorage.
 */
library CambioIssuerStorage {
    bytes32 internal constant STORAGE_SLOT = keccak256("t3.storage.cambioissuer.v1");

    struct IssuerProfile {
        bool isActive;
        bool openRedemption;     // when true, anyone can redeem notes (no CAMBIO_REDEEMER_ROLE needed)
        uint256 registeredAt;
    }

    struct Layout {
        mapping(address => IssuerProfile) issuers;
    }

    // --- Events ---
    event IssuerRegistered(address indexed issuer, uint256 timestamp);
    event IssuerDeactivated(address indexed issuer, uint256 timestamp);
    event IssuerOpenRedemptionSet(address indexed issuer, bool open);

    // --- Custom Errors ---
    error IssuerNotRegistered(address issuer);
    error IssuerAlreadyRegistered(address issuer);
    error IssuerInactive(address issuer);

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly { l.slot := slot }
    }
}
