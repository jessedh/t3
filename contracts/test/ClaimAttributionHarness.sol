// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "../lib/ClaimAttributionStorage.sol";
import "../lib/ClaimAttributionLib.sol";
import "../interfaces/IClaimAttribution.sol";

/**
 * @title ClaimAttributionHarness
 * @dev Test-only harness exposing ClaimAttributionLib internals for unit testing.
 */
contract ClaimAttributionHarness {
    // ==================== INITIALIZATION ====================

    function initialize() external {
        ClaimAttributionLib.initialize(ClaimAttributionStorage.layout());
    }

    function setMaxIssuerBucketsPerWallet(uint16 maxBuckets) external {
        ClaimAttributionLib.setMaxIssuerBucketsPerWallet(ClaimAttributionStorage.layout(), maxBuckets);
    }

    // ==================== MUTATORS ====================

    function credit(address wallet, address issuer, uint256 amount) external {
        ClaimAttributionLib.credit(ClaimAttributionStorage.layout(), wallet, issuer, amount);
    }

    function debitFifo(address wallet, uint256 amount)
        external
        returns (address[] memory issuers, uint256[] memory amounts)
    {
        return ClaimAttributionLib.debitFifo(ClaimAttributionStorage.layout(), wallet, amount);
    }

    function creditComposition(
        address wallet,
        address[] memory issuers,
        uint256[] memory amounts
    ) external {
        ClaimAttributionLib.creditComposition(ClaimAttributionStorage.layout(), wallet, issuers, amounts);
    }

    function moveClaims(address from, address to, uint256 amount)
        external
        returns (bytes32 compositionHash)
    {
        return ClaimAttributionLib.moveClaims(ClaimAttributionStorage.layout(), from, to, amount);
    }

    function escrowClaims(
        bytes32 domainSeparator,
        bytes32 businessObjectId,
        address sender,
        uint256 amount
    ) external returns (bytes32 escrowKey, bytes32 compositionHash) {
        return ClaimAttributionLib.escrowClaims(
            ClaimAttributionStorage.layout(),
            domainSeparator,
            businessObjectId,
            sender,
            amount
        );
    }

    function releaseEnvelopeToSender(
        bytes32 domainSeparator,
        bytes32 businessObjectId,
        address sender,
        uint256 amount
    ) external {
        ClaimAttributionLib.releaseEnvelopeToSender(
            ClaimAttributionStorage.layout(),
            domainSeparator,
            businessObjectId,
            sender,
            amount
        );
    }

    function substituteForReceivingIssuer(
        address sender,
        address recipient,
        uint256 amount,
        address receivingIssuer
    )
        external
        returns (
            bytes32 outgoingCompositionHash,
            address[] memory outgoingIssuers,
            uint256[] memory outgoingAmounts
        )
    {
        return ClaimAttributionLib.substituteForReceivingIssuer(
            ClaimAttributionStorage.layout(),
            sender,
            recipient,
            amount,
            receivingIssuer
        );
    }

    function finalizeEnvelopeClaims(
        bytes32 escrowKey,
        address recipient,
        address receivingIssuer,
        uint256 amount,
        bool crossInstitution
    )
        external
        returns (
            bytes32 outgoingCompositionHash,
            address[] memory outgoingIssuers,
            uint256[] memory outgoingAmounts
        )
    {
        return ClaimAttributionLib.finalizeEnvelopeClaims(
            ClaimAttributionStorage.layout(),
            escrowKey,
            recipient,
            receivingIssuer,
            amount,
            crossInstitution
        );
    }

    // ==================== READ HELPERS ====================

    function getWalletClaimAmount(address wallet, address issuer)
        external
        view
        returns (uint256)
    {
        return ClaimAttributionStorage.layout().walletClaims[wallet].amountByIssuer[issuer];
    }

    function getWalletClaimIssuers(address wallet)
        external
        view
        returns (address[] memory)
    {
        return ClaimAttributionStorage.layout().walletClaims[wallet].issuers;
    }

    function getWalletBuckets(address wallet)
        external
        view
        returns (IClaimAttribution.ClaimBucket[] memory buckets)
    {
        ClaimAttributionStorage.WalletClaims storage wc =
            ClaimAttributionStorage.layout().walletClaims[wallet];
        buckets = new IClaimAttribution.ClaimBucket[](wc.issuers.length);
        for (uint256 i = 0; i < wc.issuers.length; i++) {
            address issuer = wc.issuers[i];
            buckets[i] = IClaimAttribution.ClaimBucket({
                issuer: issuer,
                amount: wc.amountByIssuer[issuer]
            });
        }
    }

    function getEscrowBuckets(bytes32 escrowKey)
        external
        view
        returns (IClaimAttribution.ClaimBucket[] memory buckets)
    {
        ClaimAttributionStorage.EscrowClaims storage ec =
            ClaimAttributionStorage.layout().escrowClaims[escrowKey];
        buckets = new IClaimAttribution.ClaimBucket[](ec.issuers.length);
        for (uint256 i = 0; i < ec.issuers.length; i++) {
            address issuer = ec.issuers[i];
            buckets[i] = IClaimAttribution.ClaimBucket({
                issuer: issuer,
                amount: ec.amountByIssuer[issuer]
            });
        }
    }

    function getEscrowRemainingAmount(bytes32 escrowKey)
        external
        view
        returns (uint256)
    {
        return ClaimAttributionStorage.layout().escrowClaims[escrowKey].remainingAmount;
    }

    function getIssuerAttributedOutstanding(address issuer)
        external
        view
        returns (uint256)
    {
        return ClaimAttributionStorage.layout().issuerAttributedOutstanding[issuer];
    }

    function totalAttributedOutstanding() external view returns (uint256) {
        return ClaimAttributionStorage.layout().totalAttributedOutstanding;
    }

    function sumWalletClaims(address wallet) external view returns (uint256 total) {
        ClaimAttributionStorage.WalletClaims storage wc =
            ClaimAttributionStorage.layout().walletClaims[wallet];
        for (uint256 i = 0; i < wc.issuers.length; i++) {
            total += wc.amountByIssuer[wc.issuers[i]];
        }
    }

    function sumActiveEscrowClaims() external view returns (uint256 total) {
        return ClaimAttributionStorage.layout().totalActiveEscrowClaims;
    }

    function getMaxIssuerBucketsPerWallet() external view returns (uint16) {
        return ClaimAttributionStorage.layout().maxIssuerBucketsPerWallet;
    }

    function computeEscrowKey(bytes32 domainSeparator, bytes32 businessObjectId)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(domainSeparator, businessObjectId));
    }

    function computeCompositionHash(address[] memory issuers, uint256[] memory amounts)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(issuers, amounts));
    }
}
