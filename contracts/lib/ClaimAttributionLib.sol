// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "./ClaimAttributionStorage.sol";

library ClaimAttributionLib {
    error AlreadyInitialized();
    error NotInitialized();
    error TooManyIssuerBuckets(uint256 requested, uint256 maximum);
    error InsufficientClaims(address wallet, uint256 requested, uint256 available);
    error ExactCompositionMismatch(
        address wallet,
        address issuer,
        uint256 requested,
        uint256 available
    );
    error ZeroAddress();
    error ZeroAmount();
    error EmptyComposition();
    error ArrayLengthMismatch();
    error DuplicateIssuer(address issuer);
    error HardMaximumExceeded(uint256 requested, uint256 hardMaximum);
    error InvalidBucketLimit(uint256 requested);
    error BucketLimitDecrease(uint256 current, uint256 requested);
    error SelfTransfer();
    error EscrowAlreadyExists(bytes32 escrowKey);
    error EscrowNotActive(bytes32 escrowKey);
    error EscrowInsufficientClaims(bytes32 escrowKey, uint256 requested, uint256 available);

    uint16 internal constant INITIAL_MAX_ISSUER_BUCKETS = 16;
    uint16 internal constant HARD_MAX_ISSUER_BUCKETS = 32;

    uint8 internal constant ESCROW_STATUS_ACTIVE = 1;
    uint8 internal constant ESCROW_STATUS_EXHAUSTED = 2;

    bytes32 internal constant ENVELOPE_DOMAIN      = keccak256("T3_TRANSFER_ENVELOPE_V1");
    bytes32 internal constant SMARTLOCK_DOMAIN     = keccak256("T3_SMARTLOCK_ENVELOPE_V1");
    bytes32 internal constant CAMBIO_ESCROW_DOMAIN = keccak256("T3_CAMBIO_ESCROW_V1");
    bytes32 internal constant CAMBIO_NOTE_DOMAIN   = keccak256("T3_CAMBIO_NOTE_V1");

    function initialize(ClaimAttributionStorage.Layout storage l) internal {
        if (l.initialized) revert AlreadyInitialized();
        l.storageVersion = 1;
        l.initialized = true;
        l.maxIssuerBucketsPerWallet = INITIAL_MAX_ISSUER_BUCKETS;
    }

    function setMaxIssuerBucketsPerWallet(
        ClaimAttributionStorage.Layout storage l,
        uint16 maxBuckets
    ) internal {
        _requireInitialized(l);
        if (maxBuckets == 0) revert InvalidBucketLimit(maxBuckets);
        if (maxBuckets > HARD_MAX_ISSUER_BUCKETS) {
            revert HardMaximumExceeded(maxBuckets, HARD_MAX_ISSUER_BUCKETS);
        }
        if (maxBuckets < l.maxIssuerBucketsPerWallet) {
            revert BucketLimitDecrease(l.maxIssuerBucketsPerWallet, maxBuckets);
        }
        l.maxIssuerBucketsPerWallet = maxBuckets;
    }

    function _requireInitialized(ClaimAttributionStorage.Layout storage l) private view {
        if (!l.initialized) revert NotInitialized();
    }

    function _removeWalletIssuer(
        ClaimAttributionStorage.WalletClaims storage wc,
        address issuer
    ) private {
        uint256 indexPlusOne = wc.issuerIndexPlusOne[issuer];
        if (indexPlusOne == 0) return;

        uint256 index = indexPlusOne - 1;
        uint256 length = wc.issuers.length;
        for (uint256 i = index; i + 1 < length; i++) {
            address shifted = wc.issuers[i + 1];
            wc.issuers[i] = shifted;
            wc.issuerIndexPlusOne[shifted] = i + 1;
        }
        wc.issuers.pop();
        delete wc.issuerIndexPlusOne[issuer];
    }

    function _removeEscrowIssuer(
        ClaimAttributionStorage.EscrowClaims storage ec,
        address issuer
    ) private {
        uint256 indexPlusOne = ec.issuerIndexPlusOne[issuer];
        if (indexPlusOne == 0) return;

        uint256 index = indexPlusOne - 1;
        uint256 length = ec.issuers.length;
        for (uint256 i = index; i + 1 < length; i++) {
            address shifted = ec.issuers[i + 1];
            ec.issuers[i] = shifted;
            ec.issuerIndexPlusOne[shifted] = i + 1;
        }
        ec.issuers.pop();
        delete ec.issuerIndexPlusOne[issuer];
    }

    function _creditWallet(
        ClaimAttributionStorage.Layout storage l,
        ClaimAttributionStorage.WalletClaims storage wc,
        address issuer,
        uint256 amount
    ) private {
        if (amount == 0) return;

        if (wc.issuerIndexPlusOne[issuer] == 0) {
            if (wc.issuers.length >= l.maxIssuerBucketsPerWallet) {
                revert TooManyIssuerBuckets(
                    wc.issuers.length + 1,
                    l.maxIssuerBucketsPerWallet
                );
            }
            wc.issuers.push(issuer);
            wc.issuerIndexPlusOne[issuer] = wc.issuers.length;
        }
        wc.amountByIssuer[issuer] += amount;
    }

    function _creditWalletComposition(
        ClaimAttributionStorage.Layout storage l,
        ClaimAttributionStorage.WalletClaims storage wc,
        address[] memory issuers,
        uint256[] memory amounts
    ) private {
        for (uint256 i = 0; i < issuers.length; i++) {
            _creditWallet(l, wc, issuers[i], amounts[i]);
        }
    }

    function _debitWallet(
        ClaimAttributionStorage.WalletClaims storage wc,
        address wallet,
        uint256 amount
    ) private returns (address[] memory outIssuers, uint256[] memory outAmounts) {
        if (amount == 0) revert ZeroAmount();

        uint256 total;
        for (uint256 i = 0; i < wc.issuers.length; i++) {
            total += wc.amountByIssuer[wc.issuers[i]];
        }
        if (total < amount) revert InsufficientClaims(wallet, amount, total);

        uint256 remaining = amount;
        uint256 count;
        for (uint256 i = 0; i < wc.issuers.length && remaining > 0; i++) {
            uint256 bucketAmount = wc.amountByIssuer[wc.issuers[i]];
            uint256 take = remaining > bucketAmount ? bucketAmount : remaining;
            if (take > 0) {
                count++;
                remaining -= take;
            }
        }

        outIssuers = new address[](count);
        outAmounts = new uint256[](count);
        remaining = amount;
        uint256 outputIndex;
        for (uint256 i = 0; i < wc.issuers.length && remaining > 0; ) {
            address issuer = wc.issuers[i];
            uint256 bucketAmount = wc.amountByIssuer[issuer];
            uint256 take = remaining > bucketAmount ? bucketAmount : remaining;

            wc.amountByIssuer[issuer] = bucketAmount - take;
            outIssuers[outputIndex] = issuer;
            outAmounts[outputIndex] = take;
            outputIndex++;
            remaining -= take;

            if (wc.amountByIssuer[issuer] == 0) {
                _removeWalletIssuer(wc, issuer);
            } else {
                i++;
            }
        }
    }

    function _debitWalletComposition(
        ClaimAttributionStorage.WalletClaims storage wc,
        address wallet,
        address[] memory issuers,
        uint256[] memory amounts
    ) private {
        if (issuers.length != amounts.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < issuers.length; i++) {
            for (uint256 j = i + 1; j < issuers.length; j++) {
                if (issuers[i] == issuers[j]) revert DuplicateIssuer(issuers[i]);
            }
            uint256 available = wc.amountByIssuer[issuers[i]];
            if (available < amounts[i]) {
                revert ExactCompositionMismatch(wallet, issuers[i], amounts[i], available);
            }
        }

        for (uint256 i = 0; i < issuers.length; i++) {
            if (amounts[i] == 0) continue;
            address issuer = issuers[i];
            wc.amountByIssuer[issuer] -= amounts[i];
            if (wc.amountByIssuer[issuer] == 0) {
                _removeWalletIssuer(wc, issuer);
            }
        }
    }

    function _createEscrow(
        ClaimAttributionStorage.EscrowClaims storage ec,
        address[] memory issuers,
        uint256[] memory amounts,
        uint256 totalAmount
    ) private {
        ec.status = ESCROW_STATUS_ACTIVE;
        ec.remainingAmount = totalAmount;
        for (uint256 i = 0; i < issuers.length; i++) {
            if (amounts[i] == 0) continue;
            address issuer = issuers[i];
            ec.issuers.push(issuer);
            ec.issuerIndexPlusOne[issuer] = ec.issuers.length;
            ec.amountByIssuer[issuer] = amounts[i];
        }
    }

    function _debitEscrow(
        ClaimAttributionStorage.Layout storage l,
        bytes32 escrowKey,
        uint256 amount
    ) private returns (address[] memory outIssuers, uint256[] memory outAmounts) {
        if (amount == 0) revert ZeroAmount();
        ClaimAttributionStorage.EscrowClaims storage ec = l.escrowClaims[escrowKey];
        if (ec.status != ESCROW_STATUS_ACTIVE) revert EscrowNotActive(escrowKey);
        if (ec.remainingAmount < amount) {
            revert EscrowInsufficientClaims(escrowKey, amount, ec.remainingAmount);
        }

        uint256 remaining = amount;
        uint256 count;
        for (uint256 i = 0; i < ec.issuers.length && remaining > 0; i++) {
            uint256 bucketAmount = ec.amountByIssuer[ec.issuers[i]];
            uint256 take = remaining > bucketAmount ? bucketAmount : remaining;
            if (take > 0) {
                count++;
                remaining -= take;
            }
        }

        outIssuers = new address[](count);
        outAmounts = new uint256[](count);
        remaining = amount;
        uint256 outputIndex;
        for (uint256 i = 0; i < ec.issuers.length && remaining > 0; ) {
            address issuer = ec.issuers[i];
            uint256 bucketAmount = ec.amountByIssuer[issuer];
            uint256 take = remaining > bucketAmount ? bucketAmount : remaining;

            ec.amountByIssuer[issuer] = bucketAmount - take;
            outIssuers[outputIndex] = issuer;
            outAmounts[outputIndex] = take;
            outputIndex++;
            remaining -= take;

            if (ec.amountByIssuer[issuer] == 0) {
                _removeEscrowIssuer(ec, issuer);
            } else {
                i++;
            }
        }

        ec.remainingAmount -= amount;
        l.totalActiveEscrowClaims -= amount;
        if (ec.remainingAmount == 0) ec.status = ESCROW_STATUS_EXHAUSTED;
    }

    function credit(
        ClaimAttributionStorage.Layout storage l,
        address wallet,
        address issuer,
        uint256 amount
    ) internal {
        if (!l.initialized) return;
        if (wallet == address(0) || issuer == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _creditWallet(l, l.walletClaims[wallet], issuer, amount);
    }

    function debitFifo(
        ClaimAttributionStorage.Layout storage l,
        address wallet,
        uint256 amount
    ) internal returns (address[] memory issuers, uint256[] memory amounts) {
        if (!l.initialized) return (new address[](0), new uint256[](0));
        if (wallet == address(0)) revert ZeroAddress();
        return _debitWallet(l.walletClaims[wallet], wallet, amount);
    }

    function creditComposition(
        ClaimAttributionStorage.Layout storage l,
        address wallet,
        address[] memory issuers,
        uint256[] memory amounts
    ) internal {
        if (!l.initialized) return;
        if (wallet == address(0)) revert ZeroAddress();
        if (issuers.length == 0) revert EmptyComposition();
        if (issuers.length != amounts.length) revert ArrayLengthMismatch();

        ClaimAttributionStorage.WalletClaims storage wc = l.walletClaims[wallet];
        uint256 newIssuerCount;
        for (uint256 i = 0; i < issuers.length; i++) {
            if (issuers[i] == address(0)) revert ZeroAddress();
            for (uint256 j = i + 1; j < issuers.length; j++) {
                if (issuers[i] == issuers[j]) revert DuplicateIssuer(issuers[i]);
            }
            if (amounts[i] > 0 && wc.issuerIndexPlusOne[issuers[i]] == 0) {
                newIssuerCount++;
            }
        }
        if (wc.issuers.length + newIssuerCount > l.maxIssuerBucketsPerWallet) {
            revert TooManyIssuerBuckets(
                wc.issuers.length + newIssuerCount,
                l.maxIssuerBucketsPerWallet
            );
        }
        _creditWalletComposition(l, wc, issuers, amounts);
    }

    function moveClaims(
        ClaimAttributionStorage.Layout storage l,
        address from,
        address to,
        uint256 amount
    ) internal returns (bytes32 compositionHash) {
        if (!l.initialized) return bytes32(0);
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (from == to) revert SelfTransfer();

        (address[] memory issuers, uint256[] memory amounts) =
            _debitWallet(l.walletClaims[from], from, amount);
        compositionHash = keccak256(abi.encode(issuers, amounts));
        _creditWalletComposition(l, l.walletClaims[to], issuers, amounts);
    }

    function escrowClaims(
        ClaimAttributionStorage.Layout storage l,
        bytes32 domainSeparator,
        bytes32 businessObjectId,
        address sender,
        uint256 amount
    ) internal returns (bytes32 escrowKey, bytes32 compositionHash) {
        if (!l.initialized) return (bytes32(0), bytes32(0));
        if (sender == address(0)) revert ZeroAddress();
        escrowKey = keccak256(abi.encode(domainSeparator, businessObjectId));

        ClaimAttributionStorage.EscrowClaims storage ec = l.escrowClaims[escrowKey];
        if (ec.status != 0) revert EscrowAlreadyExists(escrowKey);

        (address[] memory issuers, uint256[] memory amounts) =
            _debitWallet(l.walletClaims[sender], sender, amount);
        compositionHash = keccak256(abi.encode(issuers, amounts));

        _creditWalletComposition(l, l.walletClaims[address(this)], issuers, amounts);
        _createEscrow(ec, issuers, amounts, amount);
        l.totalActiveEscrowClaims += amount;
    }

    function releaseEnvelopeToSender(
        ClaimAttributionStorage.Layout storage l,
        bytes32 domainSeparator,
        bytes32 businessObjectId,
        address sender,
        uint256 amount
    ) internal {
        if (!l.initialized) return;
        if (sender == address(0)) revert ZeroAddress();
        bytes32 escrowKey = keccak256(abi.encode(domainSeparator, businessObjectId));

        (address[] memory issuers, uint256[] memory amounts) =
            _debitEscrow(l, escrowKey, amount);
        _debitWalletComposition(
            l.walletClaims[address(this)],
            address(this),
            issuers,
            amounts
        );
        _creditWalletComposition(l, l.walletClaims[sender], issuers, amounts);
    }

    /**
     * @dev The caller must validate receiving-issuer eligibility, funded floor,
     * ceiling headroom, concentration, and standing-assumption authority.
     */
    function substituteForReceivingIssuer(
        ClaimAttributionStorage.Layout storage l,
        address sender,
        address recipient,
        uint256 amount,
        address receivingIssuer
    )
        internal
        returns (
            bytes32 outgoingCompositionHash,
            address[] memory outgoingIssuers,
            uint256[] memory outgoingAmounts
        )
    {
        if (!l.initialized) return (bytes32(0), new address[](0), new uint256[](0));
        if (
            sender == address(0) ||
            recipient == address(0) ||
            receivingIssuer == address(0)
        ) revert ZeroAddress();
        if (sender == recipient) revert SelfTransfer();

        (outgoingIssuers, outgoingAmounts) =
            _debitWallet(l.walletClaims[sender], sender, amount);
        outgoingCompositionHash = keccak256(abi.encode(outgoingIssuers, outgoingAmounts));
        _creditWallet(l, l.walletClaims[recipient], receivingIssuer, amount);
    }

    /**
     * @dev The caller must validate and reserve receiving-issuer capacity before
     * cross-institution finalization.
     */
    function finalizeEnvelopeClaims(
        ClaimAttributionStorage.Layout storage l,
        bytes32 escrowKey,
        address recipient,
        address receivingIssuer,
        uint256 amount,
        bool crossInstitution
    )
        internal
        returns (
            bytes32 outgoingCompositionHash,
            address[] memory outgoingIssuers,
            uint256[] memory outgoingAmounts
        )
    {
        if (!l.initialized) return (bytes32(0), new address[](0), new uint256[](0));
        if (recipient == address(0)) revert ZeroAddress();
        if (crossInstitution && receivingIssuer == address(0)) revert ZeroAddress();

        (outgoingIssuers, outgoingAmounts) = _debitEscrow(l, escrowKey, amount);
        outgoingCompositionHash = keccak256(abi.encode(outgoingIssuers, outgoingAmounts));
        _debitWalletComposition(
            l.walletClaims[address(this)],
            address(this),
            outgoingIssuers,
            outgoingAmounts
        );

        if (crossInstitution) {
            _creditWallet(l, l.walletClaims[recipient], receivingIssuer, amount);
        } else {
            _creditWalletComposition(
                l,
                l.walletClaims[recipient],
                outgoingIssuers,
                outgoingAmounts
            );
        }
    }
}
