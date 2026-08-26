// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "../lib/StorageLib.sol";
import "../lib/T3CommonLib.sol";
import "../lib/ClaimAttributionStorage.sol";
import "../lib/ClaimAttributionLib.sol";
import "../lib/IssuanceAccountingLib.sol";

contract IssuanceAccountingHarness {
    function initialize() external {
        ClaimAttributionLib.initialize(ClaimAttributionStorage.layout());
    }

    function mintAttributed(
        address issuer,
        address beneficiary,
        uint256 amount
    ) external {
        IssuanceAccountingLib.mintAttributed(issuer, beneficiary, amount);
    }

    function burnAttributed(
        address account,
        uint256 amount
    ) external returns (address[] memory issuers, uint256[] memory amounts) {
        return IssuanceAccountingLib.burnAttributed(account, amount);
    }

    function substituteLiability(
        address[] memory outgoingIssuers,
        uint256[] memory outgoingAmounts,
        address receivingIssuer,
        uint256 amount
    ) external {
        IssuanceAccountingLib.substituteLiability(
            outgoingIssuers,
            outgoingAmounts,
            receivingIssuer,
            amount
        );
    }

    function substituteAttributed(
        address sender,
        address recipient,
        uint256 amount,
        address receivingIssuer
    ) external returns (bytes32 outgoingCompositionHash) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        // Perform a raw balance shift only; ClaimAttributionLib handles the
        // claim migration for this helper.
        if (ds._balances[sender] < amount) {
            revert("insufficient balance");
        }
        ds._balances[sender] -= amount;
        ds._balances[recipient] += amount;

        address[] memory outgoingIssuers;
        uint256[] memory outgoingAmounts;
        (
            outgoingCompositionHash,
            outgoingIssuers,
            outgoingAmounts
        ) = ClaimAttributionLib.substituteForReceivingIssuer(
            ClaimAttributionStorage.layout(),
            sender,
            recipient,
            amount,
            receivingIssuer
        );
        IssuanceAccountingLib.substituteLiability(
            outgoingIssuers,
            outgoingAmounts,
            receivingIssuer,
            amount
        );
    }

    function creditClaimOnly(
        address wallet,
        address issuer,
        uint256 amount
    ) external {
        ClaimAttributionLib.credit(
            ClaimAttributionStorage.layout(),
            wallet,
            issuer,
            amount
        );
    }

    function assertAttributedSupplyConservation() external view {
        IssuanceAccountingLib.assertAttributedSupplyConservation();
    }

    function setRawAccountingState(
        uint256 supply,
        uint256 attributedOutstanding
    ) external {
        StorageLib.diamondStorage()._totalSupply = supply;
        ClaimAttributionStorage.layout().totalAttributedOutstanding =
            attributedOutstanding;
    }

    function balanceOf(address account) external view returns (uint256) {
        return StorageLib.diamondStorage()._balances[account];
    }

    function totalSupply() external view returns (uint256) {
        return StorageLib.diamondStorage()._totalSupply;
    }

    function getWalletClaimAmount(
        address wallet,
        address issuer
    ) external view returns (uint256) {
        return ClaimAttributionStorage
            .layout()
            .walletClaims[wallet]
            .amountByIssuer[issuer];
    }

    function sumWalletClaims(address wallet) external view returns (uint256 total) {
        ClaimAttributionStorage.WalletClaims storage wc =
            ClaimAttributionStorage.layout().walletClaims[wallet];
        for (uint256 i = 0; i < wc.issuers.length; i++) {
            total += wc.amountByIssuer[wc.issuers[i]];
        }
    }

    function getIssuerAttributedOutstanding(
        address issuer
    ) external view returns (uint256) {
        return ClaimAttributionStorage.layout().issuerAttributedOutstanding[issuer];
    }

    function totalAttributedOutstanding() external view returns (uint256) {
        return ClaimAttributionStorage.layout().totalAttributedOutstanding;
    }

    function computeCompositionHash(
        address[] memory issuers,
        uint256[] memory amounts
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(issuers, amounts));
    }
}
