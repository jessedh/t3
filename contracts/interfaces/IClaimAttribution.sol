// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title IClaimAttribution
 * @notice Stable interface for holder claim attribution and issuer liability.
 * @dev Wave 1 freezes events, types, errors, and roles. Mutating facet selectors
 *      are added in later implementation waves after economics/state transitions
 *      are specified. [Certain]
 */
interface IClaimAttribution {
    // ==================== STRUCTS ====================

    struct ClaimBucket {
        address issuer;
        uint256 amount;
    }

    // ==================== EVENTS ====================

    event ClaimBucketsMoved(
        bytes32 indexed movementId,
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes32 compositionHash
    );

    event IssuerLiabilitySubstituted(
        bytes32 indexed transferId,
        address indexed outgoingIssuer,
        address indexed receivingIssuer,
        uint256 amount
    );

    event EnvelopeClaimEscrowed(
        bytes32 indexed envelopeId,
        bytes32 compositionHash,
        uint256 amount
    );

    event EnvelopeLiabilitySubstituted(
        bytes32 indexed envelopeId,
        address indexed receivingIssuer,
        uint256 amount
    );

    // ==================== STABLE READS ====================

    /**
     * @notice Return the active issuer addresses for a wallet's claim buckets.
     * @param wallet The wallet to query.
     * @return issuers Array of issuer addresses with non-zero claims.
     */
    function getWalletClaimIssuers(address wallet)
        external
        view
        returns (address[] memory issuers);

    /**
     * @notice Return the claim amount a wallet holds from a specific issuer.
     * @param wallet The wallet to query.
     * @param issuer The issuer address.
     * @return amount The attributed claim amount.
     */
    function getWalletClaimAmount(address wallet, address issuer)
        external
        view
        returns (uint256 amount);

    /**
     * @notice Return the total attributed outstanding for a single issuer.
     * @param issuer The issuer address.
     * @return amount The issuer's total attributed outstanding T3.
     */
    function getIssuerAttributedOutstanding(address issuer)
        external
        view
        returns (uint256 amount);

    /**
     * @notice Return the aggregate attributed outstanding across all issuers.
     * @return amount The total attributed outstanding T3.
     */
    function totalAttributedOutstanding()
        external
        view
        returns (uint256 amount);
}
