// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { IssuanceControlStorage } from "../lib/IssuanceControlStorage.sol";
import { ClaimAttributionLib } from "../lib/ClaimAttributionLib.sol";
import { ClaimAttributionStorage } from "../lib/ClaimAttributionStorage.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { IssuanceCapacityLib } from "../lib/IssuanceCapacityLib.sol";
import { IssuanceRoutingLib } from "../lib/IssuanceRoutingLib.sol";
import { IssuanceAccountingLib } from "../lib/IssuanceAccountingLib.sol";
import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol";
import { ConsortiumEmergencyLib } from "../lib/ConsortiumEmergencyLib.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";

/**
 * @title IssuanceControlFacet
 * @notice Kill-switch and lifecycle control for the issuance pipeline.
 * @dev Wave 0.5: legacy mint gate. G.0.a: claim attribution init + views.
 *      Wave 4: quote/reserve/execute attributed-issuance capacity model.
 */
contract IssuanceControlFacet is ReentrancyGuardBase {
    event LegacyMintUnlockedSet(address indexed admin, bool unlocked);
    event ClaimAttributionInitialized(address indexed admin);
    event CapacityModelActiveSet(address indexed admin, bool active);
    event BankDailyCapSet(address indexed admin, address indexed bank, uint256 limit);
    /// @dev Mirrors T3TokenMintBurnFacet.ConsortiumTokensMinted (same topic) so indexers
    ///      see capacity-path issuance identically to the legacy path.
    event ConsortiumTokensMinted(address indexed bank, address indexed to, uint256 amount);

    error ClaimAttributionMustInitAtZeroSupply(uint256 currentSupply);
    error CapacityExceededAtExecute(address bank, uint256 amount, uint256 capacity);
    error AttributionNotInitialized();
    error NotReservationOwner(bytes32 reservationId, address caller);
    error BankNotActive(address bank);

    // ─────────────────────────────────────────────────────────────────────────
    // Legacy gate + attribution init (Wave 0.5 / G.0.a)
    // ─────────────────────────────────────────────────────────────────────────

    function setLegacyMintUnlocked(bool unlocked) external {
        AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender);
        IssuanceControlStorage.layout().legacyMintUnlocked = unlocked;
        emit LegacyMintUnlockedSet(msg.sender, unlocked);
    }

    function isLegacyMintUnlocked() external view returns (bool) {
        return IssuanceControlStorage.layout().legacyMintUnlocked;
    }

    /**
     * @notice One-time initialization of the claim attribution subledger.
     * @dev Must be called at zero supply. See OPERATOR WARNING below.
     *      `legacyMintUnlocked` must remain true until Wave 4 burn wiring lands;
     *      `burnForConsortiumBank` reverts with `ConsortiumBurnRequiresAttributedPath`
     *      while initialized.
     */
    function initializeClaimAttribution() external {
        AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender);
        uint256 supply = StorageLib.diamondStorage()._totalSupply;
        if (supply > 0) revert ClaimAttributionMustInitAtZeroSupply(supply);
        ClaimAttributionLib.initialize(ClaimAttributionStorage.layout());
        emit ClaimAttributionInitialized(msg.sender);
    }

    function isClaimAttributionInitialized() external view returns (bool) {
        return ClaimAttributionStorage.layout().initialized;
    }

    function getTotalAttributedOutstanding() external view returns (uint256) {
        return ClaimAttributionStorage.layout().totalAttributedOutstanding;
    }

    function getIssuerAttributedOutstanding(address issuer) external view returns (uint256) {
        return ClaimAttributionStorage.layout().issuerAttributedOutstanding[issuer];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Wave 4: capacity model admin
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice When active, legacy `mintForConsortiumBank` is gated off and issuance must
    ///         flow through reserveIssuance/executeIssuance.
    function setCapacityModelActive(bool active) external {
        AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender);
        IssuanceControlStorage.layout().capacityModelActive = active;
        emit CapacityModelActiveSet(msg.sender, active);
    }

    function isCapacityModelActive() external view returns (bool) {
        return IssuanceControlStorage.layout().capacityModelActive;
    }

    /// @notice Set a bank's per-day issuance cap (0 = no cap).
    function setBankDailyCap(address bank, uint256 limit) external {
        AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender);
        IssuanceControlStorage.layout().dailyCapLimit[bank] = limit;
        emit BankDailyCapSet(msg.sender, bank, limit);
    }

    function getBankDailyCap(address bank) external view returns (uint256) {
        return IssuanceControlStorage.layout().dailyCapLimit[bank];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Wave 4: quote / reserve / execute
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Amount a bank may reserve right now (capacity bounded by reservations + daily cap).
    function quoteIssuance(address bank) external view returns (uint256) {
        return IssuanceCapacityLib.availableToReserve(bank);
    }

    /// @notice Reserve issuance capacity for a bank. Returns the reservation id.
    function reserveIssuance(address bank, uint256 amount) external nonReentrant returns (bytes32) {
        AccessControlLib.checkRole(RoleConstants.MINTER_ROLE, msg.sender);
        _requireBankIssuable(bank);
        return IssuanceRoutingLib.reserve(bank, amount, msg.sender);
    }

    /// @notice Execute a reservation: consume it and mint the attributed supply to the bank.
    /// @dev Re-checks live capacity at execute (reserves may have dropped since reserve()).
    ///      Requires the attribution subledger to be initialized (the capacity model is part
    ///      of the attributed-issuance system). Emits the same supply events as
    ///      mintForConsortiumBank and updates the consortium ledger so the two issuance paths
    ///      stay coherent if the capacity model is toggled.
    function executeIssuance(bytes32 reservationId) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.MINTER_ROLE, msg.sender);
        if (!ClaimAttributionStorage.layout().initialized) revert AttributionNotInitialized();
        _requireReservationOwner(reservationId);
        (address bank, uint256 amount) = IssuanceRoutingLib.execute(reservationId);

        // Wave 8B: forward bank mint
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ComplianceLib.precheckGated(ds, address(0), bank, amount, ComplianceLib.Context.BANK_MINT);

        // bug_004: mirror mintForConsortiumBank's guards — the capacity path is the ONLY mint
        // path once capacityModelActive, so the active-bank / recovery / emergency checks must
        // hold here too (re-checked at execute since bank state may have changed since reserve).
        _requireBankIssuable(bank);
        uint256 capacity = IssuanceCapacityLib.issuanceCapacity(bank);
        if (amount > capacity) revert CapacityExceededAtExecute(bank, amount, capacity);
        IssuanceAccountingLib.mintAttributed(bank, bank, amount);
        emit ERC20BaseFacet.Transfer(address(0), bank, amount);
        ConsortiumStorage.layout().depositAccounts[bank].totalMinted += amount;
        emit ConsortiumTokensMinted(bank, bank, amount);
    }

    /// @notice Cancel an active, non-expired reservation, freeing the capacity.
    function cancelReservation(bytes32 reservationId) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.MINTER_ROLE, msg.sender);
        _requireReservationOwner(reservationId);
        IssuanceRoutingLib.cancel(reservationId);
    }

    /// @notice Sweep an expired reservation back into free capacity (permissionless cleanup).
    function expireReservation(bytes32 reservationId) external nonReentrant {
        IssuanceRoutingLib.expire(reservationId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Wave 4: views
    // ─────────────────────────────────────────────────────────────────────────

    function getReservation(bytes32 reservationId)
        external
        view
        returns (address bank, uint256 amount, uint40 expiry, uint8 state)
    {
        IssuanceControlStorage.Reservation storage r =
            IssuanceControlStorage.layout().reservations[reservationId];
        return (r.bank, r.amount, r.expiry, r.state);
    }

    function getReservedTotal(address bank) external view returns (uint256) {
        return IssuanceControlStorage.layout().reservedTotal[bank];
    }

    function getDailyRemaining(address bank) external view returns (uint256) {
        return IssuanceCapacityLib.dailyRemaining(bank);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // internal guards (bug_004)
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Mirror mintForConsortiumBank's issuance preconditions: bank active, not in wallet
    ///      recovery, and consortium mint operation not emergency-halted.
    function _requireBankIssuable(address bank) private view {
        if (!ConsortiumStorage.layout().activeBanks[bank]) revert BankNotActive(bank);
        if (WalletRecoveryStorage.layout().activeRecoveryCount[bank] > 0) {
            revert IWalletRecovery.WalletInRecovery(bank);
        }
        ConsortiumEmergencyLib.enforceOperationActive(ConsortiumEmergencyLib.OP_MINT);
    }

    /// @dev execute/cancel restricted to the reservation creator or a DEFAULT_ADMIN, so one
    ///      MINTER cannot consume or release another's reservation.
    function _requireReservationOwner(bytes32 reservationId) private view {
        address creator = IssuanceControlStorage.layout().reservations[reservationId].creator;
        if (
            msg.sender != creator &&
            !AccessControlLib.hasRole(StorageLib.diamondStorage(), RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender)
        ) revert NotReservationOwner(reservationId, msg.sender);
    }
}
