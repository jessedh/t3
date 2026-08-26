// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library ReserveControlStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.reserve-control.v1");

    struct ReservePosition {
        uint256 settledQuantity;     // confirmed custody (native token decimals)
        uint256 pendingQuantity;     // in-flight pledge, awaiting settlement confirmation
        uint256 custodySettledAt;    // timestamp of last settlement confirmation
        uint256 encumberedQuantity;  // locked: floor + reimbursement + disputed
    }

    struct AssetPrice {
        uint256 price;               // 18-decimal price per unit of reserve asset
        uint40  updatedAt;           // oracle last update timestamp
        uint32  stalenessThreshold;  // seconds; 0 = never stale
    }

    struct Layout {
        uint32 storageVersion;
        bool initialized;
        // key: keccak256(abi.encode(issuer, assetType))
        mapping(bytes32 => ReservePosition) reservePositions;
        // price oracle per asset type
        mapping(uint256 => AssetPrice) assetPrices;
        // per-issuer dynamic floor (18-decimal T3-equivalent value)
        mapping(address => uint256) issuerFloor;
        // reimbursement encumbrance per outgoing issuer (18-decimal T3-equivalent)
        mapping(address => uint256) reimbursementEncumbered;
        // ordered list of active asset type IDs for iteration in effectiveReserve
        uint256[] activeAssetTypes;
        uint256[43] __gap;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly { l.slot := slot }
    }

    function positionKey(address issuer, uint256 assetType) internal pure returns (bytes32) {
        return keccak256(abi.encode(issuer, assetType));
    }
}
