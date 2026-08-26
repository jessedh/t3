// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library InstitutionStorage {
    // Dedicated diamond storage slot for institution + wallet management state.
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.institution.v1");

    enum InstitutionStatus {
        Inactive,
        Active,
        Suspended
    }

    enum WalletAffiliationStatus {
        None,
        Active,
        Suspended,
        Revoked
    }

    struct Institution {
        bytes32 id;
        string name;
        bytes32 metadataHash;
        string metadataURI;
        InstitutionStatus status;
        address adminAddress;
        uint256 registeredAt;
        uint256 updatedAt;
        address registeredBy;
    }

    struct WalletAffiliation {
        bytes32 institutionId;
        WalletAffiliationStatus status;
        uint256 affiliatedAt;
        uint256 updatedAt;
        address updatedBy;
    }

    struct Layout {
        // Institution registry state.
        mapping(bytes32 => Institution) institutions;
        bytes32[] institutionIds;
        uint256 institutionCount;

        // Wallet => institution affiliation state.
        mapping(address => WalletAffiliation) walletAffiliations;

        // institutionId => role => account => hasRole.
        mapping(bytes32 => mapping(bytes32 => mapping(address => bool))) scopedRoles;

        // Policy layers: network defaults, institution overrides, wallet overrides.
        // *Set flags are required so explicit "0" values are distinguishable from unset.
        mapping(bytes32 => uint256) networkPolicies;
        mapping(bytes32 => mapping(bytes32 => uint256)) institutionPolicies;
        mapping(bytes32 => mapping(bytes32 => bool)) institutionPolicySet;
        mapping(address => mapping(bytes32 => uint256)) walletPolicies;
        mapping(address => mapping(bytes32 => bool)) walletPolicySet;
    }

    event InstitutionRegistered(bytes32 indexed id, string name, address adminAddress, address registeredBy);
    event InstitutionUpdated(bytes32 indexed id, string name, address updatedBy);
    event InstitutionStatusChanged(bytes32 indexed id, InstitutionStatus newStatus, address changedBy);
    event InstitutionAdminRotated(bytes32 indexed id, address oldAdmin, address newAdmin, address rotatedBy);

    event WalletLinked(address indexed wallet, bytes32 indexed institutionId, address linkedBy);
    event WalletUnlinked(address indexed wallet, bytes32 indexed institutionId, address unlinkedBy);
    event WalletAffiliationStatusChanged(address indexed wallet, WalletAffiliationStatus newStatus, address changedBy);

    event NetworkPolicySet(bytes32 indexed key, uint256 value, address setBy);
    event InstitutionPolicySet(bytes32 indexed institutionId, bytes32 indexed key, uint256 value, address setBy);
    event InstitutionPolicyCleared(bytes32 indexed institutionId, bytes32 indexed key, address clearedBy);
    event WalletPolicySet(address indexed wallet, bytes32 indexed key, uint256 value, address setBy);
    event WalletPolicyCleared(address indexed wallet, bytes32 indexed key, address clearedBy);

    event ScopedRoleGranted(bytes32 indexed role, address indexed account, bytes32 indexed institutionId, address grantedBy);
    event ScopedRoleRevoked(bytes32 indexed role, address indexed account, bytes32 indexed institutionId, address revokedBy);

    event ComplianceExemptionGranted(bytes32 indexed scopeId, bytes32 indexed controlKey, bytes32 reasonHash, address grantedBy);
    error ComplianceExemptionRequired(bytes32 scopeId, bytes32 controlKey);

    error InstitutionNotFound(bytes32 id);
    error InstitutionNotActive(bytes32 id);
    error InstitutionAlreadyExists(bytes32 id);
    error WalletAlreadyAffiliated(address wallet, bytes32 currentInstitutionId);
    error WalletNotAffiliated(address wallet);
    error NotInstitutionAdmin(address caller, bytes32 institutionId);
    error InvalidInstitutionName();
    error ZeroAddressNotAllowed();
    error InvalidPolicyKey();

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            // slither-disable-next-line assembly
            l.slot := slot
        }
    }
}
