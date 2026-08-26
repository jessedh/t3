// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { InstitutionStorage } from "../lib/InstitutionStorage.sol";

interface IInstitutionRegistry {
    function registerInstitution(
        string calldata name,
        bytes32 metadataHash,
        string calldata metadataURI,
        address adminAddress
    ) external returns (bytes32 institutionId);

    function updateInstitution(
        bytes32 institutionId,
        string calldata name,
        bytes32 metadataHash,
        string calldata metadataURI
    ) external;

    function setInstitutionStatus(
        bytes32 institutionId,
        InstitutionStorage.InstitutionStatus status
    ) external;

    function rotateInstitutionAdmin(
        bytes32 institutionId,
        address newAdmin
    ) external;

    function linkWalletToInstitution(
        address wallet,
        bytes32 institutionId
    ) external;

    function unlinkWalletFromInstitution(address wallet) external;

    function setWalletAffiliationStatus(
        address wallet,
        InstitutionStorage.WalletAffiliationStatus status
    ) external;

    function getInstitution(bytes32 institutionId)
        external
        view
        returns (InstitutionStorage.Institution memory);

    function getInstitutionCount() external view returns (uint256);

    function getInstitutionAtIndex(uint256 index)
        external
        view
        returns (bytes32 institutionId);

    function getWalletAffiliation(address wallet)
        external
        view
        returns (InstitutionStorage.WalletAffiliation memory);

    function isInstitutionActive(bytes32 institutionId)
        external
        view
        returns (bool);
}

interface IInstitutionPolicy {
    function setNetworkPolicy(bytes32 key, uint256 value) external;

    function setInstitutionPolicy(
        bytes32 institutionId,
        bytes32 key,
        uint256 value
    ) external;

    function clearInstitutionPolicy(bytes32 institutionId, bytes32 key) external;

    function setWalletPolicy(address wallet, bytes32 key, uint256 value) external;

    function clearWalletPolicy(address wallet, bytes32 key) external;

    function getEffectivePolicy(address wallet, bytes32 key)
        external
        view
        returns (uint256 value, string memory source);
    // `source` is expected to be: "wallet" | "institution" | "network".

    function getNetworkPolicy(bytes32 key) external view returns (uint256);

    function getInstitutionPolicyValue(bytes32 institutionId, bytes32 key)
        external
        view
        returns (uint256 value, bool isExplicitlySet);
    // isExplicitlySet preserves the distinction between "value = 0" and "not set".

    function getWalletPolicyValue(address wallet, bytes32 key)
        external
        view
        returns (uint256 value, bool isExplicitlySet);

    function hasScopedRole(
        bytes32 role,
        address account,
        bytes32 institutionId
    ) external view returns (bool);

    function grantScopedRole(
        bytes32 role,
        address account,
        bytes32 institutionId
    ) external;

    function revokeScopedRole(
        bytes32 role,
        address account,
        bytes32 institutionId
    ) external;

    function initializeDefaultPolicies() external;
}

interface IInstitutionManager is IInstitutionRegistry, IInstitutionPolicy {}
