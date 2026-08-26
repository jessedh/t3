// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { AccessControlFacet } from "./AccessControlFacet.sol"; // Still needed for ROLE constants
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
// NOTE: Interface support moved to ERC165Facet - no longer needed here
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol"; // <<< ADD THIS IMPORT
import { RoleConstants } from "../lib/RoleConstants.sol";
//moved grantRole and revokeRole to library so it can be used by other facets
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { ViewACLLib } from "../lib/ViewACLLib.sol";
import { InstitutionLifecycleStorage } from "../lib/InstitutionLifecycleStorage.sol";
import { ComplianceStatusLib } from "../lib/ComplianceStatusLib.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";

contract CustodianRegistryFacet is ReentrancyGuardBase {
    error InstitutionModeBlocksCustodianRegistration(
        address custodian,
        InstitutionLifecycleStorage.InstitutionMode mode
    );
    error CustodianAlreadyAssigned(address userAddress, address existingCustodian);
    using StorageLib for StorageLib.AppStorage;
    using EnumerableSet for EnumerableSet.AddressSet;

    event WalletRegistered(address indexed userAddress, address indexed custodian, uint256 kycValidatedTimestamp, uint256 kycExpiresTimestamp);
    event WalletUnregistered(address indexed userAddress, address indexed custodian);
    event KYCStatusUpdated(address indexed userAddress, address indexed custodian, uint256 kycValidatedTimestamp, uint256 kycExpiresTimestamp);
    event KYCRevoked(address indexed userAddress, address indexed custodian, uint256 reasonCode);
    event CIPRecorded(address indexed wallet, bytes32 cipRecordHash, address indexed custodian, uint256 timestamp);
    event CIPRevoked(address indexed wallet, address indexed custodian, uint256 timestamp);

    error CIPRecordHashRequired();
    error CIPNotFound(address wallet);
    error InstitutionModeBlocksAttestation(
        address custodian,
        InstitutionLifecycleStorage.InstitutionMode mode
    );

    /**
     * @dev Task 7.2 (K-F8): a DEFAULTED/RESOLVED institution's operator keys are no
     *      longer trusted for ANY attestation mutation — including revocations, which
     *      a compromised key could use to grief customers (mass KYC/CIP revoke freezes
     *      their transfers). Matches the registerCustodiedWallet mode guard;
     *      ISSUANCE_PAUSED/ORDERLY_EXIT institutions still service existing customers.
     */
    function _requireAttestingInstitutionActive() private view {
        InstitutionLifecycleStorage.InstitutionMode mode =
            InstitutionLifecycleStorage.layout().institutionMode[msg.sender];
        if (mode == InstitutionLifecycleStorage.InstitutionMode.DEFAULTED ||
            mode == InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
            revert InstitutionModeBlocksAttestation(msg.sender, mode);
        }
    }


    // NOTE: Interface support moved to ERC165Facet

function grantCustodianRole(address fiAddress) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        // K-F10: grant and revoke are symmetric — both require DEFAULT_ADMIN_ROLE.
        // This is a deliberate tightening: ADMIN_ROLE holders can no longer grant.
        IAccessControl ac = IAccessControl(address(this));
        if (!ac.hasRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.DEFAULT_ADMIN_ROLE);
        }

        if (fiAddress == address(0)) { revert StorageLib.CustodianZeroAddress(); }

        // Replace internal_grantRole with public interface call
        AccessControlLib.grantRole(ds, RoleConstants.CUSTODIAN_ROLE, fiAddress);
        
        if (!ds._custodians.contains(fiAddress)){
             ds._custodians.add(fiAddress);
        }
        else {
            revert StorageLib.UserAlreadyRegistered(fiAddress);
        }
    }

    function revokeCustodianRole(address fiAddress) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        // --- MODIFIED ROLE CHECK ---
        IAccessControl ac = IAccessControl(address(this));
        if (!ac.hasRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.DEFAULT_ADMIN_ROLE);
        }
        // --- END MODIFIED ROLE CHECK ---

        if (fiAddress == address(0)) { revert StorageLib.CustodianZeroAddress(); }

        // Use the internal function directly
        AccessControlLib.revokeRole(ds, RoleConstants.CUSTODIAN_ROLE, fiAddress);
        
        if (ds._custodians.contains(fiAddress)){
            ds._custodians.remove(fiAddress);
        }
        else {
            revert StorageLib.UserAlreadyRegistered(fiAddress);
        }
    }


    function registerCustodiedWallet(
        address userAddress,
        uint256 kycValidatedTimestamp,
        uint256 kycExpiresTimestamp
    ) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        // --- MODIFIED ROLE CHECK ---
        IAccessControl ac = IAccessControl(address(this));
        if (!ac.hasRole(RoleConstants.CUSTODIAN_ROLE, msg.sender)) { // Caller must be a Custodian
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.CUSTODIAN_ROLE);
        }
        // --- END MODIFIED ROLE CHECK ---

        {
            InstitutionLifecycleStorage.InstitutionMode mode =
                InstitutionLifecycleStorage.layout().institutionMode[msg.sender];
            if (mode == InstitutionLifecycleStorage.InstitutionMode.DEFAULTED ||
                mode == InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
                revert InstitutionModeBlocksCustodianRegistration(msg.sender, mode);
            }
        }

        if (userAddress == address(0)) { revert StorageLib.UserAddressZero(); }
        if (kycExpiresTimestamp != 0 && kycExpiresTimestamp <= kycValidatedTimestamp) {
            revert StorageLib.KYCExpiryBeforeValidation();
        }

        address existingCustodian = ds._custodyInfo[userAddress].custodian;
        if (existingCustodian != address(0)) {
            revert CustodianAlreadyAssigned(userAddress, existingCustodian);
        }

        ds._custodyInfo[userAddress] = StorageLib.CustodyData({
            custodian: msg.sender,
            kycValidatedTimestamp: kycValidatedTimestamp,
            kycExpiresTimestamp: kycExpiresTimestamp,
            cipCompletedAt: 0,
            cipRecordHash: bytes32(0)
        });
        delete StorageLib.diamondStorage().kycStatusCache[userAddress];
        emit WalletRegistered(userAddress, msg.sender, kycValidatedTimestamp, kycExpiresTimestamp);
    }

    function updateKYCStatus(
        address userAddress,
        uint256 kycValidatedTimestamp,
        uint256 kycExpiresTimestamp
    ) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        // --- MODIFIED ROLE CHECK ---
        IAccessControl ac = IAccessControl(address(this));
        if (!ac.hasRole(RoleConstants.CUSTODIAN_ROLE, msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.CUSTODIAN_ROLE);
        }
        // --- END MODIFIED ROLE CHECK ---
        _requireAttestingInstitutionActive();

        if (userAddress == address(0)) { revert StorageLib.UserAddressZero(); }
        StorageLib.CustodyData storage data = ds._custodyInfo[userAddress];
        if (data.custodian != msg.sender) {
            revert StorageLib.CallerNotRegisteredCustodian();
        }
        if (kycExpiresTimestamp != 0 && kycExpiresTimestamp <= kycValidatedTimestamp) {
            revert StorageLib.KYCExpiryBeforeValidation();
        }

        data.kycValidatedTimestamp = kycValidatedTimestamp;
        data.kycExpiresTimestamp = kycExpiresTimestamp;
        delete StorageLib.diamondStorage().kycStatusCache[userAddress];
        emit KYCStatusUpdated(userAddress, msg.sender, kycValidatedTimestamp, kycExpiresTimestamp);

        // Sprint 5 exit LOW-1: zeroing the validation timestamp is a revocation in
        // all but name, so it cascades to CIP exactly like revokeKYC (K-F8). A
        // future expiry is a time-based lapse, not a revocation — no cascade.
        if (kycValidatedTimestamp == 0 && data.cipCompletedAt != 0) {
            data.cipCompletedAt = 0;
            data.cipRecordHash = bytes32(0);
            emit CIPRevoked(userAddress, msg.sender, block.timestamp);
        }
    }

    function unregisterCustodiedWallet(address userAddress) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        // --- MODIFIED ROLE CHECK ---
        IAccessControl ac = IAccessControl(address(this));
        if (!ac.hasRole(RoleConstants.CUSTODIAN_ROLE, msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.CUSTODIAN_ROLE);
        }
        // --- END MODIFIED ROLE CHECK ---
        // Sprint 5 exit LOW-2: a DEFAULTED/RESOLVED institution must not erase
        // customer records, matching the other attestation mutations (K-F8).
        _requireAttestingInstitutionActive();

        if (userAddress == address(0)) { revert StorageLib.UserAddressZero(); }
        StorageLib.CustodyData storage data = ds._custodyInfo[userAddress];
        if (data.custodian != msg.sender) {
            revert StorageLib.CallerNotRegisteredCustodian();
        }
        if (data.cipCompletedAt != 0) {
            emit CIPRevoked(userAddress, msg.sender, block.timestamp);
        }
        delete ds._custodyInfo[userAddress];
        emit WalletUnregistered(userAddress, msg.sender);
    }

    // View functions remain the same
    function getCustodian(address userAddress) external view returns (address) {
        ViewACLLib.requireWalletAccess(userAddress);
        return StorageLib.diamondStorage()._custodyInfo[userAddress].custodian;
    }

    function getKYCTimestamps(address userAddress) external view returns (uint256 validatedTimestamp, uint256 expiresTimestamp) {
        ViewACLLib.requireWalletAccess(userAddress);
        StorageLib.CustodyData storage data = StorageLib.diamondStorage()._custodyInfo[userAddress];
        return (data.kycValidatedTimestamp, data.kycExpiresTimestamp);
    }

    // Task 7.2 (K-F8): CIP presupposes KYC (identity program verification builds on
    // the customer relationship), so revoking KYC cascades to CIP. This reverses the
    // earlier "independent attestations" stance after the cross-facet review.
    function revokeKYC(address userAddress, uint256 reasonCode) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        IAccessControl ac = IAccessControl(address(this));
        if (!ac.hasRole(RoleConstants.CUSTODIAN_ROLE, msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.CUSTODIAN_ROLE);
        }
        _requireAttestingInstitutionActive();

        if (userAddress == address(0)) { revert StorageLib.UserAddressZero(); }

        StorageLib.CustodyData storage data = ds._custodyInfo[userAddress];
        // Only the wallet's custodian-of-record may revoke, matching updateKYCStatus /
        // unregisterCustodiedWallet (a CUSTODIAN_ROLE holder cannot revoke another bank's wallet).
        if (data.custodian != msg.sender) {
            revert StorageLib.CallerNotRegisteredCustodian();
        }

        data.kycValidatedTimestamp = 0;
        data.kycExpiresTimestamp = 0;
        delete ds.kycStatusCache[userAddress];
        emit KYCRevoked(userAddress, msg.sender, reasonCode);

        if (data.cipCompletedAt != 0) {
            data.cipCompletedAt = 0;
            data.cipRecordHash = bytes32(0);
            emit CIPRevoked(userAddress, msg.sender, block.timestamp);
        }
    }

    function isKYCValid(address userAddress) external view returns (bool) {
        return ComplianceStatusLib.kycStatusOf(StorageLib.diamondStorage(), userAddress);
    }

    function recordCIP(address wallet, bytes32 cipRecordHash) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        IAccessControl ac = IAccessControl(address(this));
        if (!ac.hasRole(RoleConstants.CUSTODIAN_ROLE, msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.CUSTODIAN_ROLE);
        }
        _requireAttestingInstitutionActive();

        if (wallet == address(0)) { revert StorageLib.UserAddressZero(); }
        if (cipRecordHash == bytes32(0)) { revert CIPRecordHashRequired(); }

        StorageLib.CustodyData storage data = ds._custodyInfo[wallet];
        if (data.custodian != msg.sender) {
            revert StorageLib.CallerNotRegisteredCustodian();
        }

        data.cipCompletedAt = block.timestamp;
        data.cipRecordHash = cipRecordHash;
        emit CIPRecorded(wallet, cipRecordHash, msg.sender, block.timestamp);
    }

    function revokeCIP(address wallet) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        IAccessControl ac = IAccessControl(address(this));
        if (!ac.hasRole(RoleConstants.CUSTODIAN_ROLE, msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.CUSTODIAN_ROLE);
        }
        _requireAttestingInstitutionActive();

        if (wallet == address(0)) { revert StorageLib.UserAddressZero(); }

        StorageLib.CustodyData storage data = ds._custodyInfo[wallet];
        if (data.custodian != msg.sender) {
            revert StorageLib.CallerNotRegisteredCustodian();
        }
        if (data.cipCompletedAt == 0) {
            revert CIPNotFound(wallet);
        }

        data.cipCompletedAt = 0;
        data.cipRecordHash = bytes32(0);
        emit CIPRevoked(wallet, msg.sender, block.timestamp);
    }

    function getCIP(address wallet) external view returns (uint256 cipCompletedAt, bytes32 cipRecordHash) {
        ViewACLLib.requireWalletAccess(wallet);
        StorageLib.CustodyData storage data = StorageLib.diamondStorage()._custodyInfo[wallet];
        return (data.cipCompletedAt, data.cipRecordHash);
    }

    function hasCIP(address wallet) external view returns (bool) {
        ViewACLLib.requireWalletAccess(wallet);
        return StorageLib.diamondStorage()._custodyInfo[wallet].cipCompletedAt != 0;
    }

    /// @notice Recovery-resolved CIP view (K-F7 pattern, wave-panel LOW-1).
    /// @dev Enforcement (_requireCIP) judges the recovery-RESOLVED payee while
    ///      getCIP/hasCIP read the literal address — mid-recovery those diverge.
    ///      Mirrors getResolvedScreening: the resolved payee may read its own
    ///      record; raw views are kept for ops/audit reads.
    function getResolvedCIP(address wallet)
        external
        view
        returns (address resolvedWallet, uint256 cipCompletedAt, bytes32 cipRecordHash)
    {
        resolvedWallet = WalletRecoveryStorage._resolveRecoveryPayee(wallet);
        if (msg.sender != resolvedWallet) {
            ViewACLLib.requireWalletAccess(wallet);
        }
        StorageLib.CustodyData storage data =
            StorageLib.diamondStorage()._custodyInfo[resolvedWallet];
        return (resolvedWallet, data.cipCompletedAt, data.cipRecordHash);
    }

    function custodianCount() external view returns (uint256) {
        return StorageLib.diamondStorage()._custodians.length();
    }

    function custodianAtIndex(uint256 index) external view returns (address) {
        return StorageLib.diamondStorage()._custodians.at(index);
    }

    function isCustodian(address account) external view returns (bool) {
        return StorageLib.diamondStorage()._custodians.contains(account);
    }
}
