// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library ClaimAttributionStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.claim-attribution.v1");

    struct WalletClaims {
        address[] issuers;
        mapping(address => uint256) amountByIssuer;
        mapping(address => uint256) issuerIndexPlusOne;
    }

    struct EscrowClaims {
        address[] issuers;
        mapping(address => uint256) amountByIssuer;
        mapping(address => uint256) issuerIndexPlusOne;
        uint256 remainingAmount;
        uint8 escrowType;
        address receivingIssuer;
        uint256 reservedReceivingHeadroom;
        uint40 reservationExpiresAt;
        uint8 status;
    }

    struct Layout {
        uint32 storageVersion;
        bool initialized;
        mapping(address => WalletClaims) walletClaims;
        mapping(bytes32 => EscrowClaims) escrowClaims;
        mapping(address => uint256) issuerAttributedOutstanding;
        uint256 totalAttributedOutstanding;
        uint16 maxIssuerBucketsPerWallet;
        uint64 nextClaimMovementNonce;
        uint256 totalActiveEscrowClaims;
        uint256[42] __gap;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly { l.slot := slot }
    }
}
