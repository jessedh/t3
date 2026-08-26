// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { SponsorBankStorage } from "../lib/SponsorBankStorage.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { ReentrancyGuardBase } from "./ReentrancyGuardBase.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title DistributionManagementBase
 * @dev Shared modifiers and helpers for distribution management facets
 */
abstract contract DistributionManagementBase is ReentrancyGuardBase {
    using SponsorBankStorage for SponsorBankStorage.Storage;
    using EnumerableSet for EnumerableSet.AddressSet;

    modifier whenNotPaused() {
        if (StorageLib.diamondStorage()._paused) {
            revert("Pausable: paused");
        }
        _;
    }

    function _checkRole(bytes32 role, address account) internal view {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[role].contains(account)) {
            revert StorageLib.UnauthorizedRole(account, role);
        }
    }

    modifier onlySponsorBankOperator() {
        _checkRole(RoleConstants.SPONSOR_BANK_OPERATOR_ROLE, msg.sender);
        _;
    }

    modifier onlySponsorBankAdmin() {
        _checkRole(RoleConstants.SPONSOR_BANK_ADMIN_ROLE, msg.sender);
        _;
    }

    modifier validDistributionId(bytes32 distributionId) {
        require(distributionId != bytes32(0), "Invalid distribution ID");
        _;
    }

    modifier distributionExists(bytes32 distributionId) {
        require(_distributionStorage().distributions[distributionId].sponsor != address(0), "Distribution not found");
        _;
    }

    modifier onlyDistributionSponsor(bytes32 distributionId) {
        require(_distributionStorage().distributions[distributionId].sponsor == msg.sender, "Not distribution sponsor");
        _;
    }

    modifier emergencyNotPaused() {
        require(!_distributionStorage().emergencyPaused, "Emergency pause active");
        _;
    }

    // INACTIVE / NON-FUNCTIONAL: this base contract is not inherited by any facet in the
    // active manifest. The KYC check is intentionally NOT implemented and fails closed
    // (reverts) rather than returning a misleading `true`. A real implementation would
    // delegate to the custodian-attested KYC source of truth (CustodianRegistry /
    // StorageLib.CustodyData) behind a gate + counsel sign-off. See KNOWN-ISSUES.md.
    function isKYCVerified(address /*wallet*/ ) internal pure returns (bool) {
        revert("KYC verification not implemented");
    }

    function _distributionStorage() internal pure returns (SponsorBankStorage.Storage storage) {
        return SponsorBankStorage.layout();
    }
}

