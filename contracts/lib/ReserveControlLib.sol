// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ReserveControlStorage } from "./ReserveControlStorage.sol";
import { ReserveValuationLib }   from "./ReserveValuationLib.sol";
import { ConsortiumStorage }     from "./ConsortiumStorage.sol";

library ReserveControlLib {

    error ReleaseBelowFloor(address issuer, uint256 postReleaseReserve, uint256 floor);
    error InsufficientSettledReserve(address issuer, uint256 assetType, uint256 settled, uint256 requested);
    error SubstitutionNotCompliant(address issuer, uint256 postSubstitutionReserve, uint256 floor);
    error EncumbranceExceedsReserve(address issuer, uint256 requestedTotal, uint256 effectiveReserve);

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Total effective reserve (18-decimal) for an issuer across all active asset types.
    ///         Only counts settled (not pending) quantity, net of encumbrances.
    function effectiveReserve(address issuer) internal view returns (uint256 total) {
        ReserveControlStorage.Layout storage rc = ReserveControlStorage.layout();
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        uint256 len = rc.activeAssetTypes.length;
        for (uint256 i = 0; i < len; i++) {
            uint256 assetType = rc.activeAssetTypes[i];
            ConsortiumStorage.AssetTypeConfig storage cfg = cs.assetTypes[assetType];
            if (!cfg.isActive) continue;
            ReserveControlStorage.AssetPrice storage p = rc.assetPrices[assetType];
            uint256 price = p.price == 0 ? 1e18 : p.price; // fallback $1 when oracle not set
            ReserveControlStorage.ReservePosition storage pos = rc.reservePositions[
                ReserveControlStorage.positionKey(issuer, assetType)
            ];
            total += ReserveValuationLib.effectiveValue(
                pos.settledQuantity,
                pos.encumberedQuantity,
                cfg.decimals,
                price,
                uint16(cfg.collateralFactorBps),
                uint16(cfg.haircutBps)
            );
        }
    }

    /// @notice Effective reserve net of pending reimbursement encumbrances (18-decimal).
    ///         This is the base for issuance-capacity math (Wave 4): a bank may not issue
    ///         against reserves already pledged to a pending interbank reimbursement.
    ///         Saturates at zero. (Council C1, 2026-06-14.)
    function availableReserve(address issuer) internal view returns (uint256) {
        uint256 eff = effectiveReserve(issuer);
        uint256 enc = ReserveControlStorage.layout().reimbursementEncumbered[issuer];
        return eff > enc ? eff - enc : 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pledge (two-phase)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Phase 1: record pledge as pending before the token transfer occurs.
    function recordPendingPledge(address issuer, uint256 assetType, uint256 quantity) internal {
        bytes32 key = ReserveControlStorage.positionKey(issuer, assetType);
        ReserveControlStorage.layout().reservePositions[key].pendingQuantity += quantity;
    }

    /// @notice Phase 2: move pending → settled after the token transfer succeeds.
    function confirmPledge(address issuer, uint256 assetType, uint256 quantity) internal {
        bytes32 key = ReserveControlStorage.positionKey(issuer, assetType);
        ReserveControlStorage.ReservePosition storage pos = ReserveControlStorage.layout().reservePositions[key];
        require(pos.pendingQuantity >= quantity, "pending underflow");
        pos.pendingQuantity   -= quantity;
        pos.settledQuantity   += quantity;
        pos.custodySettledAt   = block.timestamp;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Release
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deduct from settled and revert if post-release reserve falls below the dynamic floor.
    function releaseWithFloorCheck(address issuer, uint256 assetType, uint256 quantity) internal {
        ReserveControlStorage.Layout storage rc = ReserveControlStorage.layout();
        bytes32 key = ReserveControlStorage.positionKey(issuer, assetType);
        ReserveControlStorage.ReservePosition storage pos = rc.reservePositions[key];
        if (pos.settledQuantity < quantity) {
            revert InsufficientSettledReserve(issuer, assetType, pos.settledQuantity, quantity);
        }
        pos.settledQuantity -= quantity;
        // Post-release reserve must cover BOTH the dynamic floor AND any pending reimbursement
        // encumbrance (bug_018: the release side previously ignored reimbursementEncumbered,
        // letting a bank drain reserves below its bilateral-net liens). Equivalent to
        // availableReserve(issuer) >= floor.
        uint256 postRelease = effectiveReserve(issuer);
        uint256 minRequired = rc.issuerFloor[issuer] + rc.reimbursementEncumbered[issuer];
        if (postRelease < minRequired) {
            revert ReleaseBelowFloor(issuer, postRelease, minRequired);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Reimbursement encumbrances
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Encumber outgoing issuer reserve (18-decimal T3-equivalent) for pending reimbursement.
    /// @dev Reverts if the new total encumbrance would exceed the issuer's effective reserve.
    ///      (Council C1, 2026-06-14 — was previously an unconditional increment.)
    function encumberForReimbursement(address outgoingIssuer, uint256 amount) internal {
        ReserveControlStorage.Layout storage rc = ReserveControlStorage.layout();
        uint256 newTotal = rc.reimbursementEncumbered[outgoingIssuer] + amount;
        uint256 eff = effectiveReserve(outgoingIssuer);
        if (newTotal > eff) {
            revert EncumbranceExceedsReserve(outgoingIssuer, newTotal, eff);
        }
        rc.reimbursementEncumbered[outgoingIssuer] = newTotal;
    }

    /// @notice Release reimbursement encumbrance on completed reimbursement.
    function releaseReimbursementEncumbrance(address outgoingIssuer, uint256 amount) internal {
        ReserveControlStorage.Layout storage rc = ReserveControlStorage.layout();
        require(rc.reimbursementEncumbered[outgoingIssuer] >= amount, "encumbrance underflow");
        rc.reimbursementEncumbered[outgoingIssuer] -= amount;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Atomic substitution
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Swap old asset for new asset atomically, reverting if the floor is breached.
    function atomicSubstitution(
        address issuer,
        uint256 oldAssetType,
        uint256 oldQuantity,
        uint256 newAssetType,
        uint256 newQuantity
    ) internal {
        ReserveControlStorage.Layout storage rc = ReserveControlStorage.layout();
        bytes32 oldKey = ReserveControlStorage.positionKey(issuer, oldAssetType);
        bytes32 newKey = ReserveControlStorage.positionKey(issuer, newAssetType);
        ReserveControlStorage.ReservePosition storage oldPos = rc.reservePositions[oldKey];
        require(oldPos.settledQuantity >= oldQuantity, "insufficient old reserve");
        oldPos.settledQuantity -= oldQuantity;
        ReserveControlStorage.ReservePosition storage newPos = rc.reservePositions[newKey];
        newPos.settledQuantity  += newQuantity;
        newPos.custodySettledAt  = block.timestamp;
        uint256 postSubstitution = effectiveReserve(issuer);
        uint256 minRequired = rc.issuerFloor[issuer] + rc.reimbursementEncumbered[issuer];
        if (postSubstitution < minRequired) {
            revert SubstitutionNotCompliant(issuer, postSubstitution, minRequired);
        }
    }
}
