// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { InstitutionStorage } from "../lib/InstitutionStorage.sol";
import { IInstitutionRegistry } from "../interfaces/IInstitutionManager.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { InstitutionLifecycleStorage } from "../lib/InstitutionLifecycleStorage.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";

contract InstitutionRegistryFacet is ReentrancyGuardBase, IInstitutionRegistry {
    error InstitutionModeBlocksWalletLinking(
        bytes32 institutionId,
        InstitutionLifecycleStorage.InstitutionMode mode
    );
    function registerInstitution(
        string calldata name,
        bytes32 metadataHash,
        string calldata metadataURI,
        address adminAddress
    ) external nonReentrant returns (bytes32 institutionId) {
        _requireGlobalAdmin();

        if (bytes(name).length == 0) {
            revert InstitutionStorage.InvalidInstitutionName();
        }
        if (adminAddress == address(0)) {
            revert InstitutionStorage.ZeroAddressNotAllowed();
        }

        InstitutionStorage.Layout storage l = InstitutionStorage.layout();
        // IDs are deterministic by insertion index to support testability and enumeration.
        institutionId = keccak256(abi.encodePacked(l.institutionCount));

        if (l.institutions[institutionId].id != bytes32(0)) {
            revert InstitutionStorage.InstitutionAlreadyExists(institutionId);
        }

        l.institutions[institutionId] = InstitutionStorage.Institution({
            id: institutionId,
            name: name,
            metadataHash: metadataHash,
            metadataURI: metadataURI,
            status: InstitutionStorage.InstitutionStatus.Active,
            adminAddress: adminAddress,
            registeredAt: block.timestamp,
            updatedAt: block.timestamp,
            registeredBy: msg.sender
        });
        l.institutionIds.push(institutionId);
        unchecked {
            l.institutionCount++;
        }

        emit InstitutionStorage.InstitutionRegistered(
            institutionId,
            name,
            adminAddress,
            msg.sender
        );
    }

    function updateInstitution(
        bytes32 institutionId,
        string calldata name,
        bytes32 metadataHash,
        string calldata metadataURI
    ) external nonReentrant {
        _requireInstitutionAdminOrGlobalAdmin(institutionId);

        if (bytes(name).length == 0) {
            revert InstitutionStorage.InvalidInstitutionName();
        }

        InstitutionStorage.Institution storage institution = InstitutionStorage
            .layout()
            .institutions[institutionId];

        institution.name = name;
        institution.metadataHash = metadataHash;
        institution.metadataURI = metadataURI;
        institution.updatedAt = block.timestamp;

        emit InstitutionStorage.InstitutionUpdated(institutionId, name, msg.sender);
    }

    function setInstitutionStatus(
        bytes32 institutionId,
        InstitutionStorage.InstitutionStatus status
    ) external nonReentrant {
        _requireGlobalAdmin();

        InstitutionStorage.Institution storage institution = _getInstitutionOrRevert(
            institutionId
        );

        institution.status = status;
        institution.updatedAt = block.timestamp;

        emit InstitutionStorage.InstitutionStatusChanged(
            institutionId,
            status,
            msg.sender
        );
    }

    function rotateInstitutionAdmin(
        bytes32 institutionId,
        address newAdmin
    ) external nonReentrant {
        _requireGlobalAdmin();

        if (newAdmin == address(0)) {
            revert InstitutionStorage.ZeroAddressNotAllowed();
        }

        InstitutionStorage.Institution storage institution = _getInstitutionOrRevert(
            institutionId
        );

        address oldAdmin = institution.adminAddress;
        institution.adminAddress = newAdmin;
        institution.updatedAt = block.timestamp;

        emit InstitutionStorage.InstitutionAdminRotated(
            institutionId,
            oldAdmin,
            newAdmin,
            msg.sender
        );
    }

    function linkWalletToInstitution(
        address wallet,
        bytes32 institutionId
    ) external nonReentrant {
        if (wallet == address(0)) {
            revert InstitutionStorage.ZeroAddressNotAllowed();
        }

        InstitutionStorage.Institution storage institution = _getInstitutionOrRevert(
            institutionId
        );
        if (institution.status != InstitutionStorage.InstitutionStatus.Active) {
            revert InstitutionStorage.InstitutionNotActive(institutionId);
        }

        {
            address bankAddr = InstitutionLifecycleStorage.layout().institutionIdToBank[institutionId];
            if (bankAddr != address(0)) {
                InstitutionLifecycleStorage.InstitutionMode mode =
                    InstitutionLifecycleStorage.layout().institutionMode[bankAddr];
                if (mode == InstitutionLifecycleStorage.InstitutionMode.DEFAULTED ||
                    mode == InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
                    revert InstitutionModeBlocksWalletLinking(institutionId, mode);
                }
            }
        }

        _requireInstitutionAdminOrGlobalAdmin(institutionId);

        InstitutionStorage.WalletAffiliation storage affiliation = InstitutionStorage
            .layout()
            .walletAffiliations[wallet];

        // A wallet can have at most one active affiliation record at a time.
        if (affiliation.institutionId != bytes32(0)) {
            revert InstitutionStorage.WalletAlreadyAffiliated(
                wallet,
                affiliation.institutionId
            );
        }

        affiliation.institutionId = institutionId;
        affiliation.status = InstitutionStorage.WalletAffiliationStatus.Active;
        affiliation.affiliatedAt = block.timestamp;
        affiliation.updatedAt = block.timestamp;
        affiliation.updatedBy = msg.sender;

        emit InstitutionStorage.WalletLinked(wallet, institutionId, msg.sender);
    }

    function unlinkWalletFromInstitution(address wallet) external nonReentrant {
        if (wallet == address(0)) {
            revert InstitutionStorage.ZeroAddressNotAllowed();
        }

        InstitutionStorage.WalletAffiliation storage affiliation = InstitutionStorage
            .layout()
            .walletAffiliations[wallet];

        bytes32 institutionId = affiliation.institutionId;
        if (institutionId == bytes32(0)) {
            revert InstitutionStorage.WalletNotAffiliated(wallet);
        }

        _requireInstitutionAdminOrGlobalAdmin(institutionId);

        // Full delete resets institutionId + status + timestamps.
        delete InstitutionStorage.layout().walletAffiliations[wallet];

        emit InstitutionStorage.WalletUnlinked(wallet, institutionId, msg.sender);
    }

    function setWalletAffiliationStatus(
        address wallet,
        InstitutionStorage.WalletAffiliationStatus status
    ) external nonReentrant {
        if (wallet == address(0)) {
            revert InstitutionStorage.ZeroAddressNotAllowed();
        }

        InstitutionStorage.WalletAffiliation storage affiliation = InstitutionStorage
            .layout()
            .walletAffiliations[wallet];

        bytes32 institutionId = affiliation.institutionId;
        if (institutionId == bytes32(0)) {
            revert InstitutionStorage.WalletNotAffiliated(wallet);
        }

        _requireInstitutionAdminOrGlobalAdmin(institutionId);

        affiliation.status = status;
        affiliation.updatedAt = block.timestamp;
        affiliation.updatedBy = msg.sender;

        emit InstitutionStorage.WalletAffiliationStatusChanged(
            wallet,
            status,
            msg.sender
        );
    }

    function getInstitution(
        bytes32 institutionId
    ) external view returns (InstitutionStorage.Institution memory) {
        return _getInstitutionOrRevert(institutionId);
    }

    function getInstitutionCount() external view returns (uint256) {
        return InstitutionStorage.layout().institutionIds.length;
    }

    function getInstitutionAtIndex(
        uint256 index
    ) external view returns (bytes32 institutionId) {
        return InstitutionStorage.layout().institutionIds[index];
    }

    function getWalletAffiliation(
        address wallet
    ) external view returns (InstitutionStorage.WalletAffiliation memory) {
        return InstitutionStorage.layout().walletAffiliations[wallet];
    }

    /// @notice Task 5.4 (K-F7): affiliation of the recovery-RESOLVED payee.
    /// @dev Mid-recovery the affiliation record lives on the successor; the raw
    ///      view above reads the literal address. This variant mirrors the
    ///      enforcement path's payee resolution and returns the resolved subject.
    function getResolvedWalletAffiliation(
        address wallet
    )
        external
        view
        returns (address resolvedWallet, InstitutionStorage.WalletAffiliation memory affiliation)
    {
        resolvedWallet = WalletRecoveryStorage._resolveRecoveryPayee(wallet);
        affiliation = InstitutionStorage.layout().walletAffiliations[resolvedWallet];
    }

    function isInstitutionActive(
        bytes32 institutionId
    ) external view returns (bool) {
        InstitutionStorage.Institution storage institution = InstitutionStorage
            .layout()
            .institutions[institutionId];
        return
            institution.id != bytes32(0) &&
            institution.status == InstitutionStorage.InstitutionStatus.Active;
    }

    function _isGlobalAdmin(address account) internal view returns (bool) {
        // Cross-facet role lookup through the diamond.
        IAccessControl ac = IAccessControl(address(this));
        return
            ac.hasRole(RoleConstants.DEFAULT_ADMIN_ROLE, account) ||
            ac.hasRole(RoleConstants.ADMIN_ROLE, account);
    }

    function _requireGlobalAdmin() internal view {
        if (_isGlobalAdmin(msg.sender)) {
            return;
        }
        revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.ADMIN_ROLE);
    }

    function _requireInstitutionAdminOrGlobalAdmin(
        bytes32 institutionId
    ) internal view {
        InstitutionStorage.Institution storage institution = _getInstitutionOrRevert(
            institutionId
        );

        if (_isGlobalAdmin(msg.sender)) {
            return;
        }

        IAccessControl ac = IAccessControl(address(this));
        // Scoped institution admins must both:
        // 1) hold INSTITUTION_ADMIN_ROLE, and
        // 2) be the currently assigned adminAddress for this institution.
        if (
            ac.hasRole(RoleConstants.INSTITUTION_ADMIN_ROLE, msg.sender) &&
            institution.adminAddress == msg.sender
        ) {
            return;
        }

        revert StorageLib.UnauthorizedRole(
            msg.sender,
            RoleConstants.INSTITUTION_ADMIN_ROLE
        );
    }

    function _getInstitutionOrRevert(
        bytes32 institutionId
    ) internal view returns (InstitutionStorage.Institution storage institution) {
        institution = InstitutionStorage.layout().institutions[institutionId];
        if (institution.id == bytes32(0)) {
            revert InstitutionStorage.InstitutionNotFound(institutionId);
        }
    }
}
