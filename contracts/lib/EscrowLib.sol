// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "./StorageLib.sol";
import { ERC20BaseFacet } from "../facets/ERC20BaseFacet.sol";
import { ClaimAttributionLib } from "./ClaimAttributionLib.sol";
import { ClaimAttributionStorage } from "./ClaimAttributionStorage.sol";

/**
 * @title EscrowLib
 * @notice Shared escrow primitives for the envelope model (FR-1006).
 * @dev All functions are `internal` and inlined at compile time — no runtime
 *      coupling between consuming facets. Any token movement through
 *      address(this) escrow MUST use this library to guarantee Transfer
 *      event emission (required for Ponder indexer balance reconciliation).
 *
 *      Three operations:
 *        escrowFrom  — sender → diamond escrow
 *        releaseEscrow — diamond escrow → recipient
 *        burnEscrow  — diamond escrow → supply reduction (FIAT_INSTITUTIONAL)
 */
library EscrowLib {

    error InsufficientEscrowBalance(address diamond, uint256 available, uint256 requested);

    /**
     * @notice Transfer `amount` from `from` into the diamond's escrow balance.
     * @dev Emits ERC-20 Transfer event for indexer compatibility.
     */
    function escrowFrom(address from, uint256 amount) internal {
        escrowFrom(from, bytes32(0), bytes32(0), amount);
    }

    /**
     * @notice Transfer `amount` from `from` into the diamond's escrow balance,
     *         with claim-attribution tracking keyed by domain + business object ID.
     * @dev Attribution is a no-op when claim attribution has not been initialized.
     */
    function escrowFrom(
        address from,
        bytes32 domainSeparator,
        bytes32 businessObjectId,
        uint256 amount
    ) internal {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        uint256 bal = ds._balances[from];
        if (bal < amount) {
            revert StorageLib.ERC20InsufficientBalance(from, bal, amount);
        }
        unchecked {
            ds._balances[from] = bal - amount;
        }
        ds._balances[address(this)] += amount;
        emit ERC20BaseFacet.Transfer(from, address(this), amount);

        // Attribution (no-op when !initialized)
        ClaimAttributionStorage.Layout storage claims = ClaimAttributionStorage.layout();
        if (claims.initialized && domainSeparator != bytes32(0)) {
            ClaimAttributionLib.escrowClaims(claims, domainSeparator, businessObjectId, from, amount);
        }
    }

    /**
     * @notice Release `amount` from the diamond's escrow balance to `to`.
     * @dev Emits ERC-20 Transfer event for indexer compatibility.
     */
    function releaseEscrow(address to, uint256 amount) internal {
        releaseEscrow(to, bytes32(0), bytes32(0), amount);
    }

    /**
     * @notice Release `amount` from the diamond's escrow balance to `to`,
     *         with claim-attribution tracking keyed by domain + business object ID.
     * @dev Attribution is a no-op when claim attribution has not been initialized
     *      or when no domain is supplied (legacy callers).
     */
    function releaseEscrow(
        address to,
        bytes32 domainSeparator,
        bytes32 businessObjectId,
        uint256 amount
    ) internal {
        if (amount == 0) return;
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        uint256 bal = ds._balances[address(this)];
        if (bal < amount) {
            revert InsufficientEscrowBalance(address(this), bal, amount);
        }
        unchecked {
            ds._balances[address(this)] = bal - amount;
        }
        ds._balances[to] += amount;
        emit ERC20BaseFacet.Transfer(address(this), to, amount);

        // Attribution (no-op when !initialized or legacy domain)
        ClaimAttributionStorage.Layout storage claims = ClaimAttributionStorage.layout();
        if (claims.initialized && domainSeparator != bytes32(0)) {
            ClaimAttributionLib.releaseEnvelopeToSender(claims, domainSeparator, businessObjectId, to, amount);
        }
    }

    /**
     * @notice Burn `amount` from the diamond's escrow balance (FIAT_INSTITUTIONAL settlement).
     * @dev Reduces total supply. Emits ERC-20 Transfer(_, address(0), _) event.
     *      Legacy overload provided for callers without domain context.
     */
    function burnEscrow(uint256 amount) internal {
        burnEscrow(bytes32(0), bytes32(0), amount);
    }

    /**
     * @notice Burn `amount` from the diamond's escrow balance, attributing the
     *         supply reduction to the issuers held in the domain-separated escrow record.
     * @dev Reduces total supply. Emits ERC-20 Transfer(_, address(0), _) event.
     *      Attribution is a no-op when claim attribution has not been initialized
     *      or when no domain is supplied (legacy callers).
     */
    function burnEscrow(
        bytes32 domainSeparator,
        bytes32 businessObjectId,
        uint256 amount
    ) internal {
        if (amount == 0) return;
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        uint256 bal = ds._balances[address(this)];
        if (bal < amount) {
            revert InsufficientEscrowBalance(address(this), bal, amount);
        }

        // Attribution (no-op when !initialized or legacy domain, but must happen
        // BEFORE balance changes to keep conservation invariants aligned).
        ClaimAttributionStorage.Layout storage claims = ClaimAttributionStorage.layout();
        if (claims.initialized && domainSeparator != bytes32(0)) {
            bytes32 escrowKey = keccak256(abi.encode(domainSeparator, businessObjectId));
            ClaimAttributionStorage.EscrowClaims storage ec = claims.escrowClaims[escrowKey];
            // Decrement each issuer's attributed outstanding
            for (uint256 i = 0; i < ec.issuers.length; i++) {
                address issuer = ec.issuers[i];
                uint256 issuerAmt = ec.amountByIssuer[issuer];
                if (issuerAmt > 0) {
                    claims.issuerAttributedOutstanding[issuer] -= issuerAmt;
                    claims.totalAttributedOutstanding -= issuerAmt;
                    delete ec.amountByIssuer[issuer];
                    delete ec.issuerIndexPlusOne[issuer];
                }
            }
            delete ec.issuers;
            ec.remainingAmount = 0;
            if (claims.totalActiveEscrowClaims >= amount) {
                claims.totalActiveEscrowClaims -= amount;
            } else {
                claims.totalActiveEscrowClaims = 0;
            }
            ec.status = ClaimAttributionLib.ESCROW_STATUS_EXHAUSTED;
        }

        unchecked {
            ds._balances[address(this)] = bal - amount;
        }
        ds._totalSupply -= amount;
        emit ERC20BaseFacet.Transfer(address(this), address(0), amount);
    }
}
