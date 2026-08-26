// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { ScreeningStorage } from "../lib/ScreeningStorage.sol";
import { ComplianceConfigStorage } from "../lib/ComplianceConfigStorage.sol";
import { InstitutionStorage } from "../lib/InstitutionStorage.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { ViewACLLib } from "../lib/ViewACLLib.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title ComplianceScreeningFacet
 * @dev ERC-2771 posture (K-F12): raw msg.sender by design. Every mutation is
 *      a role-gated institutional action (screening authority / attestor /
 *      admin roles) and the trusted forwarder holds no roles, so relayed
 *      calls fail closed at the role gate. Aligning to _msgSender() would
 *      expand meta-transaction reachability of privileged actions, not fix a
 *      bug.
 */
contract ComplianceScreeningFacet is ReentrancyGuardBase {
    using EnumerableSet for EnumerableSet.Bytes32Set;

    uint256 internal constant MAX_DEFUNCT_BATCH = 200;
    event WalletScreened(
        address indexed wallet,
        uint8 status,
        bytes32 listVersionHash,
        address indexed attestor
    );
    event ScreeningBlocked(
        address indexed wallet,
        address indexed attestor
    );
    event ScreeningStaleAfterSet(
        uint40 secs,
        address indexed admin
    );
    event ScopedWalletScreened(
        bytes32 indexed institutionId,
        address indexed wallet,
        uint8 status,
        bytes32 listVersionHash,
        address attestor
    );
    event NetworkBlockPlaced(
        address indexed wallet,
        bytes32 listVersionHash,
        address authority
    );
    event NetworkCleared(
        address indexed wallet,
        uint8 previousStatus,
        bytes32 reasonHash,
        address authority
    );
    event DefunctInstitutionBlocksCleared(
        bytes32 indexed institutionId,
        uint256 count,
        address authority
    );

    error NotNetworkBlocked(address wallet);
    error BatchTooLarge(uint256 provided, uint256 max);

    /**
     * @notice Legacy network screening entrypoint.
     * @dev Retained for backward compatibility but now requires NETWORK_SCREENING_AUTHORITY_ROLE.
     *      Institution attestors must use `recordScopedScreening`.
     */
    function recordScreening(
        address wallet,
        uint8 status,
        bytes32 listVersionHash
    ) external nonReentrant {
        _requireNetworkAuthority();
        _writeNetworkScreening(wallet, status, listVersionHash);
    }

    /**
     * @notice Record a screening result scoped to a single institution.
     * @dev Requires the caller to hold SCREENING_ATTESTOR_ROLE scoped to `institutionId`.
     */
    function recordScopedScreening(
        bytes32 institutionId,
        address wallet,
        uint8 status,
        bytes32 listVersionHash
    ) external nonReentrant {
        if (status > uint8(ScreeningStorage.ScreeningStatus.BLOCKED)) {
            revert("Invalid screening status");
        }
        if (wallet == address(0)) {
            revert("Invalid wallet address");
        }

        InstitutionStorage.Layout storage inst = InstitutionStorage.layout();
        if (!inst.scopedRoles[institutionId][RoleConstants.SCREENING_ATTESTOR_ROLE][msg.sender]) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.SCREENING_ATTESTOR_ROLE);
        }

        ScreeningStorage.Layout storage s = ScreeningStorage.layout();
        s.scopedScreenings[institutionId][wallet] = ScreeningStorage.Screening({
            status: status,
            lastScreenedAt: uint40(block.timestamp),
            listVersionHash: listVersionHash,
            attestor: msg.sender
        });

        if (status != uint8(ScreeningStorage.ScreeningStatus.NONE)) {
            s.walletScopedInstitutions[wallet].add(institutionId);
        } else {
            s.walletScopedInstitutions[wallet].remove(institutionId);
        }

        emit ScopedWalletScreened(institutionId, wallet, status, listVersionHash, msg.sender);
    }

    /**
     * @notice Record a network-binding screening result.
     * @dev Requires NETWORK_SCREENING_AUTHORITY_ROLE (higher bar than institution attestor).
     */
    function recordNetworkScreening(
        address wallet,
        uint8 status,
        bytes32 listVersionHash
    ) external nonReentrant {
        _requireNetworkAuthority();
        _writeNetworkScreening(wallet, status, listVersionHash);
    }

    function setScreeningStaleAfter(uint40 secs) external nonReentrant {
        AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender);
        ScreeningStorage.layout().screeningStaleAfter = secs;
        emit ScreeningStaleAfterSet(secs, msg.sender);
    }

    // C-F10: wallet-scoped screening views are gated by ViewACLLib
    // (wallet / its custodian / operator) to match the envelope/CIP view
    // pattern and prevent cross-bank screening-status enumeration.

    function getScreening(address wallet)
        external
        view
        returns (ScreeningStorage.Screening memory)
    {
        ViewACLLib.requireWalletAccess(wallet);
        return ScreeningStorage.layout().screenings[wallet];
    }

    function getScopedScreening(bytes32 institutionId, address wallet)
        external
        view
        returns (ScreeningStorage.Screening memory)
    {
        ViewACLLib.requireWalletAccess(wallet);
        return ScreeningStorage.layout().scopedScreenings[institutionId][wallet];
    }

    function isWalletScopedInstitution(address wallet, bytes32 institutionId)
        external
        view
        returns (bool)
    {
        ViewACLLib.requireWalletAccess(wallet);
        return ScreeningStorage.layout().walletScopedInstitutions[wallet].contains(institutionId);
    }

    function isScreeningBlocked(address wallet) external view returns (bool) {
        ViewACLLib.requireWalletAccess(wallet);
        return
            ScreeningStorage.layout().screenings[wallet].status ==
            uint8(ScreeningStorage.ScreeningStatus.BLOCKED);
    }

    /// @notice Informational staleness view. Returns false for never-screened
    ///         wallets (lastScreenedAt == 0). Enforcement in
    ///         ComplianceSanctionsLib.checkNotSanctioned is stricter: when
    ///         sanctions are armed and screeningStaleAfter > 0, never-screened
    ///         parties fail closed (ComplianceScreeningStale) even though this
    ///         view reports them as not-stale.
    function isScreeningStale(address wallet) external view returns (bool) {
        ViewACLLib.requireWalletAccess(wallet);
        ScreeningStorage.Layout storage l = ScreeningStorage.layout();
        uint40 staleAfter = l.screeningStaleAfter;
        uint40 lastScreenedAt = l.screenings[wallet].lastScreenedAt;
        return staleAfter > 0 && lastScreenedAt > 0 && block.timestamp > lastScreenedAt + staleAfter;
    }

    // Wave 8E-1 — DP-A: per-institution sanctions enablement bit (off the policy stack).
    function setInstitutionSanctionsEnabled(bytes32 institutionId, bool enabled) external nonReentrant {
        _requireNetworkAuthorityOrInstitutionAdmin(institutionId);
        ScreeningStorage.Layout storage s = ScreeningStorage.layout();
        bool was = s.institutionSanctionsEnabled[institutionId];
        if (was != enabled) {
            ComplianceConfigStorage.Layout storage c = ComplianceConfigStorage.layout();
            if (enabled) {
                c.sanctionsScopeCount += 1;
                s.sanctionsEnabledCount += 1;
            } else {
                c.sanctionsScopeCount -= 1;
                s.sanctionsEnabledCount -= 1;
            }
            s.institutionSanctionsEnabled[institutionId] = enabled;
            emit ScreeningStorage.InstitutionSanctionsEnabledSet(institutionId, enabled, msg.sender);
        }
    }

    // C-F10 deliberate exception: institution-level configuration bit, no
    // wallet-scoped data — stays public so any member can confirm whether an
    // institution's sanctions regime is active.
    function isInstitutionSanctionsEnabled(bytes32 institutionId) external view returns (bool) {
        return ScreeningStorage.layout().institutionSanctionsEnabled[institutionId];
    }

    /**
     * @notice Clear a network-binding screening block (false-positive correction).
     * @dev Requires NETWORK_SCREENING_AUTHORITY_ROLE. Sets the network status back to CLEAR
     *      and stores an audit row in `networkClearances`. Institution-scoped blocks are untouched.
     */
    function clearNetworkBlock(address wallet, bytes32 reasonHash) external nonReentrant {
        _requireNetworkAuthority();
        ScreeningStorage.Layout storage s = ScreeningStorage.layout();
        uint8 prev = s.screenings[wallet].status;
        if (prev != uint8(ScreeningStorage.ScreeningStatus.BLOCKED)) {
            revert NotNetworkBlocked(wallet);
        }
        s.networkClearances[wallet] = ScreeningStorage.NetworkClearance({
            clearedAt: uint40(block.timestamp),
            clearedBy: msg.sender,
            reasonHash: reasonHash,
            previousStatus: prev
        });
        s.screenings[wallet].status = uint8(ScreeningStorage.ScreeningStatus.CLEAR);
        emit NetworkCleared(wallet, prev, reasonHash, msg.sender);
    }

    function getNetworkClearance(address wallet)
        external
        view
        returns (ScreeningStorage.NetworkClearance memory)
    {
        ViewACLLib.requireWalletAccess(wallet);
        return ScreeningStorage.layout().networkClearances[wallet];
    }

    // ───── Task 5.4 (K-F7): recovery-resolved view variants ─────
    // Enforcement (ComplianceSanctionsLib / ComplianceStatusLib) judges the
    // recovery-RESOLVED payee, while the raw views above read the literal
    // address — mid-recovery those diverge. These variants mirror the write
    // path and also return the resolved subject so callers can see whose
    // record produced the answer. Raw views are kept for ops/audit reads.

    // C-F10 ACL note: the recovery successor (resolved payee) may also read —
    // the record returned is the successor's own, so denying them would
    // recreate the read/write asymmetry these views exist to fix (K-F7).

    function getResolvedScreening(address wallet)
        external
        view
        returns (address resolvedWallet, ScreeningStorage.Screening memory screening)
    {
        resolvedWallet = WalletRecoveryStorage._resolveRecoveryPayee(wallet);
        if (msg.sender != resolvedWallet) {
            ViewACLLib.requireWalletAccess(wallet);
        }
        screening = ScreeningStorage.layout().screenings[resolvedWallet];
    }

    function getResolvedScopedScreening(bytes32 institutionId, address wallet)
        external
        view
        returns (address resolvedWallet, ScreeningStorage.Screening memory screening)
    {
        resolvedWallet = WalletRecoveryStorage._resolveRecoveryPayee(wallet);
        if (msg.sender != resolvedWallet) {
            ViewACLLib.requireWalletAccess(wallet);
        }
        screening = ScreeningStorage.layout().scopedScreenings[institutionId][resolvedWallet];
    }

    function isResolvedScreeningBlocked(address wallet) external view returns (bool) {
        address resolvedWallet = WalletRecoveryStorage._resolveRecoveryPayee(wallet);
        if (msg.sender != resolvedWallet) {
            ViewACLLib.requireWalletAccess(wallet);
        }
        return
            ScreeningStorage.layout().screenings[resolvedWallet].status ==
            uint8(ScreeningStorage.ScreeningStatus.BLOCKED);
    }

    /**
     * @notice Explicitly delete scoped blocks for a defunct institution.
     * @dev Bounded by caller-supplied array; network authority only. No unbounded hot-path loop.
     */
    function clearDefunctInstitutionBlocks(
        bytes32 institutionId,
        address[] calldata wallets
    ) external nonReentrant {
        _requireNetworkAuthority();
        if (wallets.length > MAX_DEFUNCT_BATCH) {
            revert BatchTooLarge(wallets.length, MAX_DEFUNCT_BATCH);
        }
        ScreeningStorage.Layout storage s = ScreeningStorage.layout();
        for (uint256 i = 0; i < wallets.length; i++) {
            delete s.scopedScreenings[institutionId][wallets[i]];
            s.walletScopedInstitutions[wallets[i]].remove(institutionId);
        }
        emit DefunctInstitutionBlocksCleared(institutionId, wallets.length, msg.sender);
    }

    function _writeNetworkScreening(
        address wallet,
        uint8 status,
        bytes32 listVersionHash
    ) internal {
        if (status > uint8(ScreeningStorage.ScreeningStatus.BLOCKED)) {
            revert("Invalid screening status");
        }
        if (wallet == address(0)) {
            revert("Invalid wallet address");
        }

        ScreeningStorage.Layout storage l = ScreeningStorage.layout();
        l.screenings[wallet] = ScreeningStorage.Screening({
            status: status,
            lastScreenedAt: uint40(block.timestamp),
            listVersionHash: listVersionHash,
            attestor: msg.sender
        });

        emit WalletScreened(wallet, status, listVersionHash, msg.sender);
        if (status == uint8(ScreeningStorage.ScreeningStatus.BLOCKED)) {
            // A previous clearance is no longer authoritative once the wallet is re-blocked.
            delete l.networkClearances[wallet];
            emit ScreeningBlocked(wallet, msg.sender);
            emit NetworkBlockPlaced(wallet, listVersionHash, msg.sender);
        }
    }

    function _requireNetworkAuthority() internal view {
        if (IAccessControl(address(this)).hasRole(RoleConstants.NETWORK_SCREENING_AUTHORITY_ROLE, msg.sender)) {
            return;
        }
        revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.NETWORK_SCREENING_AUTHORITY_ROLE);
    }

    function _requireNetworkAuthorityOrInstitutionAdmin(bytes32 institutionId) internal view {
        IAccessControl ac = IAccessControl(address(this));
        if (ac.hasRole(RoleConstants.NETWORK_SCREENING_AUTHORITY_ROLE, msg.sender)) {
            return;
        }

        InstitutionStorage.Institution storage inst = InstitutionStorage.layout().institutions[institutionId];
        if (
            inst.id != bytes32(0) &&
            inst.status == InstitutionStorage.InstitutionStatus.Active &&
            inst.adminAddress == msg.sender &&
            ac.hasRole(RoleConstants.INSTITUTION_ADMIN_ROLE, msg.sender)
        ) {
            return;
        }

        revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.NETWORK_SCREENING_AUTHORITY_ROLE);
    }
}
