// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title ICustodianRegistry
 * @notice Interface for custodian registry and KYC/CIP attestation management.
 */
interface ICustodianRegistry {
    // ==================== ERRORS ====================

    error CIPRecordHashRequired();
    error CIPNotFound(address wallet);

    // ==================== EVENTS ====================

    event WalletRegistered(address indexed userAddress, address indexed custodian, uint256 kycValidatedTimestamp, uint256 kycExpiresTimestamp);
    event WalletUnregistered(address indexed userAddress, address indexed custodian);
    event KYCStatusUpdated(address indexed userAddress, address indexed custodian, uint256 kycValidatedTimestamp, uint256 kycExpiresTimestamp);
    event KYCRevoked(address indexed userAddress, address indexed custodian, uint256 reasonCode);
    event CIPRecorded(address indexed wallet, bytes32 cipRecordHash, address indexed custodian, uint256 timestamp);
    event CIPRevoked(address indexed wallet, address indexed custodian, uint256 timestamp);

    // ==================== ROLE MANAGEMENT ====================

    function grantCustodianRole(address fiAddress) external;
    function revokeCustodianRole(address fiAddress) external;

    // ==================== WALLET REGISTRATION ====================

    function registerCustodiedWallet(
        address userAddress,
        uint256 kycValidatedTimestamp,
        uint256 kycExpiresTimestamp
    ) external;

    function updateKYCStatus(
        address userAddress,
        uint256 kycValidatedTimestamp,
        uint256 kycExpiresTimestamp
    ) external;

    function unregisterCustodiedWallet(address userAddress) external;

    function revokeKYC(address userAddress, uint256 reasonCode) external;

    // ==================== CIP ATTESTATION ====================

    function recordCIP(address wallet, bytes32 cipRecordHash) external;
    function revokeCIP(address wallet) external;
    function getCIP(address wallet) external view returns (uint256 cipCompletedAt, bytes32 cipRecordHash);
    function hasCIP(address wallet) external view returns (bool);

    // ==================== VIEW FUNCTIONS ====================

    function getCustodian(address userAddress) external view returns (address);
    function getKYCTimestamps(address userAddress) external view returns (uint256 validatedTimestamp, uint256 expiresTimestamp);
    function isKYCValid(address userAddress) external view returns (bool);
    function custodianCount() external view returns (uint256);
    function custodianAtIndex(uint256 index) external view returns (address);
    function isCustodian(address account) external view returns (bool);
}
