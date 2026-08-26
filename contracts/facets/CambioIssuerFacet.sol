// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { CambioIssuerStorage } from "../lib/CambioIssuerStorage.sol";
import { CambioEnvelopeStorage } from "../lib/CambioEnvelopeStorage.sol";
import { SponsorBankStorage } from "../lib/SponsorBankStorage.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";

/**
 * @title CambioIssuerFacet
 * @notice Manages non-bank Cambio note issuers.
 * @dev Pure risk controls + sponsor chain registry. USDC custody mechanics removed.
 *      Supports both legacy issuer profiles (CambioIssuerStorage) and envelope-mode
 *      issuer profiles (CambioEnvelopeStorage) during cutover.
 */
contract CambioIssuerFacet is ReentrancyGuardBase {
    using EnumerableSet for EnumerableSet.AddressSet;

    // ── Modifiers ──────────────────────────────────────────────────────

    modifier onlyCambioAdmin() {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[RoleConstants.CAMBIO_ADMIN_ROLE].contains(msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.CAMBIO_ADMIN_ROLE);
        }
        _;
    }

    modifier onlyDefaultAdminOrCambioAdmin() {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        bool isDefaultAdmin = ds._roles[RoleConstants.DEFAULT_ADMIN_ROLE].contains(msg.sender);
        bool isCambioAdmin = ds._roles[RoleConstants.CAMBIO_ADMIN_ROLE].contains(msg.sender);
        if (!isDefaultAdmin && !isCambioAdmin) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.CAMBIO_ADMIN_ROLE);
        }
        _;
    }

    modifier onlySponsorBankOperator() {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[RoleConstants.SPONSOR_BANK_OPERATOR_ROLE].contains(msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.SPONSOR_BANK_OPERATOR_ROLE);
        }
        _;
    }

    modifier whenNotPaused() {
        if (StorageLib.diamondStorage()._paused) {
            revert("Pausable: paused");
        }
        _;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      LEGACY FUNCTIONS (unchanged selectors)
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Legacy issuer registration (single-arg). Uses CambioIssuerStorage.
     * @dev Kept for backward compatibility during cutover.
     */
    function registerIssuer(address issuer) external onlyCambioAdmin whenNotPaused {
        CambioIssuerStorage.Layout storage cis = CambioIssuerStorage.layout();
        CambioIssuerStorage.IssuerProfile storage profile = cis.issuers[issuer];
        if (profile.registeredAt != 0) {
            revert CambioIssuerStorage.IssuerAlreadyRegistered(issuer);
        }
        profile.isActive = true;
        profile.registeredAt = block.timestamp;

        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.grantRole(ds, RoleConstants.CAMBIO_ISSUER_ROLE, issuer);

        emit CambioIssuerStorage.IssuerRegistered(issuer, block.timestamp);
    }

    /**
     * @notice Deactivate an issuer. Updates both legacy and envelope profiles.
     */
    function deactivateIssuer(address issuer) external onlyCambioAdmin whenNotPaused {
        CambioIssuerStorage.Layout storage cis = CambioIssuerStorage.layout();
        CambioIssuerStorage.IssuerProfile storage legacyProfile = cis.issuers[issuer];

        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        bool hasLegacyProfile = legacyProfile.registeredAt > 0;
        bool hasEnvelopeProfile = es.issuerProfiles[issuer].registeredAt > 0;

        if (!hasLegacyProfile && !hasEnvelopeProfile) {
            revert CambioIssuerStorage.IssuerNotRegistered(issuer);
        }

        if (hasLegacyProfile) {
            legacyProfile.isActive = false;
            emit CambioIssuerStorage.IssuerDeactivated(issuer, block.timestamp);
        }

        if (hasEnvelopeProfile) {
            es.issuerProfiles[issuer].isActive = false;
            emit CambioEnvelopeStorage.IssuerPauseStateChanged(issuer, CambioEnvelopeStorage.PauseState.FULLY_PAUSED);
        }
    }

    /**
     * @notice Set open redemption flag for an issuer. Updates both legacy and envelope profiles.
     * @dev Reverts only if BOTH legacy and envelope profiles are unregistered.
     */
    function setIssuerOpenRedemption(address issuer, bool open) external onlyCambioAdmin whenNotPaused {
        CambioIssuerStorage.Layout storage cis = CambioIssuerStorage.layout();
        CambioIssuerStorage.IssuerProfile storage legacyProfile = cis.issuers[issuer];

        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage envelopeProfile = es.issuerProfiles[issuer];

        bool hasLegacy = legacyProfile.registeredAt != 0;
        bool hasEnvelope = envelopeProfile.registeredAt != 0;

        if (!hasLegacy && !hasEnvelope) {
            revert CambioIssuerStorage.IssuerNotRegistered(issuer);
        }

        if (hasLegacy) {
            legacyProfile.openRedemption = open;
            emit CambioIssuerStorage.IssuerOpenRedemptionSet(issuer, open);
        }

        if (hasEnvelope) {
            envelopeProfile.openRedemption = open;
            emit CambioEnvelopeStorage.IssuerOpenRedemptionUpdated(issuer, open);
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      ENVELOPE-MODE FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Sponsor bank endorses a non-bank issuer for Cambio note issuance.
     * @param issuer The address of the non-bank issuer to endorse.
     * @dev Requires SPONSOR_BANK_OPERATOR_ROLE. Records a pending endorsement
     *      that must be confirmed by protocol admin via registerIssuer(issuer, sponsorBank).
     */
    function endorseNonBankIssuer(address issuer) external onlySponsorBankOperator whenNotPaused {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        es.pendingEndorsements[msg.sender][issuer] = true;
        emit CambioEnvelopeStorage.SponsorBankEndorsed(msg.sender, issuer, block.timestamp);
    }

    /**
     * @notice Envelope-mode issuer registration (two-arg overload).
     * @param issuer The address of the issuer to register.
     * @param sponsorBank The address of the sponsor bank that endorsed the issuer.
     * @dev Requires DEFAULT_ADMIN_ROLE or CAMBIO_ADMIN_ROLE. Reverts if no pending
     *      endorsement exists from the named sponsorBank. Grants CAMBIO_ISSUER_ROLE.
     */
    function registerIssuer(address issuer, address sponsorBank) external onlyDefaultAdminOrCambioAdmin whenNotPaused {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();

        if (!es.pendingEndorsements[sponsorBank][issuer]) {
            revert CambioEnvelopeStorage.NoPendingEndorsement(sponsorBank, issuer);
        }

        CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile = es.issuerProfiles[issuer];
        if (profile.registeredAt != 0) {
            revert CambioEnvelopeStorage.IssuerAlreadyRegistered(issuer);
        }

        profile.sponsorBank = sponsorBank;
        profile.isActive = true;
        profile.openRedemption = false;
        profile.registeredAt = block.timestamp;
        profile.pauseState = CambioEnvelopeStorage.PauseState.ACTIVE;

        // Grant CAMBIO_ISSUER_ROLE
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.grantRole(ds, RoleConstants.CAMBIO_ISSUER_ROLE, issuer);

        emit CambioEnvelopeStorage.IssuerRegistered(issuer, sponsorBank, block.timestamp);
    }

    /**
     * @notice Set the pause state for an envelope-mode issuer.
     * @param issuer The address of the issuer.
     * @param state The new PauseState (ACTIVE, ISSUANCE_PAUSED, FULLY_PAUSED).
     */
    function setIssuerPauseState(address issuer, CambioEnvelopeStorage.PauseState state) external onlyCambioAdmin whenNotPaused {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile = es.issuerProfiles[issuer];
        if (profile.registeredAt == 0) {
            revert CambioEnvelopeStorage.IssuerNotRegistered(issuer);
        }
        profile.pauseState = state;
        emit CambioEnvelopeStorage.IssuerPauseStateChanged(issuer, state);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                       VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Legacy issuer profile view. Returns CambioIssuerStorage data.
     */
    function getIssuerProfile(address issuer)
        external
        view
        returns (
            bool isActive,
            bool openRedemption,
            uint256 registeredAt
        )
    {
        CambioIssuerStorage.IssuerProfile storage profile = CambioIssuerStorage.layout().issuers[issuer];
        return (
            profile.isActive,
            profile.openRedemption,
            profile.registeredAt
        );
    }

    /**
     * @notice Check whether a sponsor bank has endorsed an issuer.
     * @param sponsorBank The address of the sponsor bank.
     * @param issuer The address of the issuer.
     * @return True if a pending endorsement exists.
     */
    function getPendingEndorsement(address sponsorBank, address issuer) external view returns (bool) {
        return CambioEnvelopeStorage.layout().pendingEndorsements[sponsorBank][issuer];
    }

    /**
     * @notice Compute the effective pause state for an envelope-mode issuer.
     * @dev This is a read-time computation that accounts for the sponsor bank's state.
     *      No iteration over sponsored issuers — safe for unbounded relationships.
     *      - Sponsor bank active → issuer's own state controls.
     *      - Sponsor bank inactive/exit → forced to at least ISSUANCE_PAUSED.
     *      - Sponsor bank FULLY_PAUSED → forced to FULLY_PAUSED.
     * @param issuer The address of the issuer.
     * @return The effective PauseState.
     */
    function issuerEffectiveState(address issuer) external view returns (CambioEnvelopeStorage.PauseState) {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile = es.issuerProfiles[issuer];

        if (profile.registeredAt == 0) {
            // Legacy issuer — check legacy profile
            CambioIssuerStorage.Layout storage cis = CambioIssuerStorage.layout();
            CambioIssuerStorage.IssuerProfile storage legacy = cis.issuers[issuer];
            if (legacy.registeredAt > 0 && !legacy.isActive) {
                return CambioEnvelopeStorage.PauseState.FULLY_PAUSED;
            }
            return CambioEnvelopeStorage.PauseState.ACTIVE;
        }

        // Check sponsor bank registration status in SponsorBankStorage
        SponsorBankStorage.Storage storage sbs = SponsorBankStorage.layout();
        SponsorBankStorage.SponsorBank storage sponsorBank = sbs.banks[profile.sponsorBank];

        // Sponsor bank not registered or inactive → force at least ISSUANCE_PAUSED
        if (profile.sponsorBank == address(0) || !sponsorBank.isRegistered || !sponsorBank.isActive) {
            if (uint256(profile.pauseState) > uint256(CambioEnvelopeStorage.PauseState.ISSUANCE_PAUSED)) {
                return profile.pauseState;
            }
            return CambioEnvelopeStorage.PauseState.ISSUANCE_PAUSED;
        }

        // Sponsor bank FULLY_PAUSED via envelope profile → force FULLY_PAUSED
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage sponsorProfile = es.issuerProfiles[profile.sponsorBank];
        if (sponsorProfile.registeredAt != 0 && sponsorProfile.pauseState == CambioEnvelopeStorage.PauseState.FULLY_PAUSED) {
            return CambioEnvelopeStorage.PauseState.FULLY_PAUSED;
        }

        // Otherwise → issuer's own state
        return profile.pauseState;
    }
}
