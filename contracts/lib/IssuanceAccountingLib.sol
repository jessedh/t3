// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "./StorageLib.sol";
import "./ClaimAttributionStorage.sol";
import "./ClaimAttributionLib.sol";

library IssuanceAccountingLib {
    error ZeroAddress();
    error ZeroAmount();
    error ArrayLengthMismatch();
    error EmptyComposition();
    error DuplicateIssuer(address issuer);
    error AmountMismatch(uint256 expected, uint256 actual);
    error InsufficientIssuerOutstanding(
        address issuer,
        uint256 requested,
        uint256 available
    );
    error AttributedSupplyMismatch(uint256 attributedOutstanding, uint256 totalSupply);
    error LegacyIssuanceDisabled();

    function mintAttributed(
        address issuer,
        address beneficiary,
        uint256 amount
    ) internal {
        if (issuer == address(0) || beneficiary == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ClaimAttributionStorage.Layout storage claims = ClaimAttributionStorage.layout();
        _assertConservation(ds, claims);

        ds._totalSupply += amount;
        ds._balances[beneficiary] += amount;
        ClaimAttributionLib.credit(claims, beneficiary, issuer, amount);
        claims.issuerAttributedOutstanding[issuer] += amount;
        claims.totalAttributedOutstanding += amount;

        _assertConservation(ds, claims);
    }

    function burnAttributed(
        address account,
        uint256 amount
    ) internal returns (address[] memory issuers, uint256[] memory amounts) {
        if (account == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ClaimAttributionStorage.Layout storage claims = ClaimAttributionStorage.layout();
        _assertConservation(ds, claims);

        uint256 balance = ds._balances[account];
        if (balance < amount) {
            revert StorageLib.ERC20InsufficientBalance(account, balance, amount);
        }

        (issuers, amounts) = ClaimAttributionLib.debitFifo(claims, account, amount);
        _requireIssuerOutstanding(claims, issuers, amounts);

        for (uint256 i = 0; i < issuers.length; i++) {
            claims.issuerAttributedOutstanding[issuers[i]] -= amounts[i];
        }
        claims.totalAttributedOutstanding -= amount;
        unchecked {
            ds._balances[account] = balance - amount;
        }
        ds._totalSupply -= amount;

        _assertConservation(ds, claims);
    }

    function substituteLiability(
        address[] memory outgoingIssuers,
        uint256[] memory outgoingAmounts,
        address receivingIssuer,
        uint256 amount
    ) internal {
        if (receivingIssuer == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (outgoingIssuers.length == 0) revert EmptyComposition();
        if (outgoingIssuers.length != outgoingAmounts.length) {
            revert ArrayLengthMismatch();
        }

        uint256 compositionTotal;
        for (uint256 i = 0; i < outgoingIssuers.length; i++) {
            if (outgoingIssuers[i] == address(0)) revert ZeroAddress();
            if (outgoingAmounts[i] == 0) revert ZeroAmount();
            for (uint256 j = i + 1; j < outgoingIssuers.length; j++) {
                if (outgoingIssuers[i] == outgoingIssuers[j]) {
                    revert DuplicateIssuer(outgoingIssuers[i]);
                }
            }
            compositionTotal += outgoingAmounts[i];
        }
        if (compositionTotal != amount) {
            revert AmountMismatch(amount, compositionTotal);
        }

        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ClaimAttributionStorage.Layout storage claims = ClaimAttributionStorage.layout();
        _assertConservation(ds, claims);
        _requireIssuerOutstanding(claims, outgoingIssuers, outgoingAmounts);

        for (uint256 i = 0; i < outgoingIssuers.length; i++) {
            claims.issuerAttributedOutstanding[outgoingIssuers[i]] -= outgoingAmounts[i];
        }
        claims.issuerAttributedOutstanding[receivingIssuer] += amount;

        _assertConservation(ds, claims);
    }

    function assertAttributedSupplyConservation() internal view {
        _assertConservation(
            StorageLib.diamondStorage(),
            ClaimAttributionStorage.layout()
        );
    }

    function _requireIssuerOutstanding(
        ClaimAttributionStorage.Layout storage claims,
        address[] memory issuers,
        uint256[] memory amounts
    ) private view {
        for (uint256 i = 0; i < issuers.length; i++) {
            uint256 available = claims.issuerAttributedOutstanding[issuers[i]];
            if (available < amounts[i]) {
                revert InsufficientIssuerOutstanding(
                    issuers[i],
                    amounts[i],
                    available
                );
            }
        }
    }

    function _assertConservation(
        StorageLib.AppStorage storage ds,
        ClaimAttributionStorage.Layout storage claims
    ) private view {
        if (!claims.initialized) return;
        if (claims.totalAttributedOutstanding != ds._totalSupply) {
            revert AttributedSupplyMismatch(
                claims.totalAttributedOutstanding,
                ds._totalSupply
            );
        }
    }
}
