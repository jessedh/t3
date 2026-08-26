// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { SponsorBankStorage } from "../lib/SponsorBankStorage.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { AccessControlFacet } from "./AccessControlFacet.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
// NOTE: Interface support moved to ERC165Facet - no longer needed here
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title SponsorBankCoreFacet
 * @dev Core sponsor bank registration and management functionality
 * @notice Allows banks to register as sponsors and manage their status
 */
contract SponsorBankCoreFacet is ReentrancyGuardBase {
    // NOTE: Pausable functionality (pause/paused/unpause) is handled by ERC20PausableFacet to avoid selector collisions
    using SponsorBankStorage for SponsorBankStorage.Storage;
    using EnumerableSet for EnumerableSet.AddressSet;

    
    // Internal modifier to check if paused (same logic as ERC20PausableFacet)
    modifier whenNotPaused() {
        if (StorageLib.diamondStorage()._paused) {
            revert("Pausable: paused");
        }
        _;
    }
    
    // Internal function to check role (same logic as ERC20PausableFacet)
    function _checkRole(bytes32 role, address account) internal view virtual {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[role].contains(account)) {
            revert StorageLib.UnauthorizedRole(account, role);
        }
    }

    modifier onlySponsorBankAdmin() {
        _checkRole(RoleConstants.SPONSOR_BANK_ADMIN_ROLE, msg.sender);
        _;
    }

    modifier onlySponsorBankOperator() {
        _checkRole(RoleConstants.SPONSOR_BANK_OPERATOR_ROLE, msg.sender);
        _;
    }

    modifier validBankAddress(address bankAddress) {
        require(bankAddress != address(0), "Invalid bank address");
        require(bankAddress != address(this), "Cannot register contract as bank");
        _;
    }

    modifier bankExists(address bankAddress) {
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        require(s.banks[bankAddress].isRegistered, "Bank not registered");
        _;
    }

    // NOTE: Interface support moved to ERC165Facet

    /**
     * @notice Register a new sponsor bank with fee rate and identifier
     * @param bankAddress The address of the bank to register
     * @param identifier Unique identifier for the bank (e.g., "JPMORGAN_USD")
     * @param feeRate Fee rate in basis points (e.g., 100 = 1%)
     */
    function registerSponsorBank(
        address bankAddress,
        string memory identifier,
        uint256 feeRate
    ) external 
      onlySponsorBankAdmin
      whenNotPaused
      validBankAddress(bankAddress) {
        
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        
        require(bytes(identifier).length > 0, "Identifier required");
        require(feeRate <= 500, "Fee rate too high"); // Max 5%
        require(!s.banks[bankAddress].isRegistered, "Bank already registered");
        
        // Initialize bank data
        SponsorBankStorage.SponsorBank storage bank = s.banks[bankAddress];
        bank.bankAddress = bankAddress;
        bank.identifier = identifier;
        bank.feeRate = feeRate;
        bank.isActive = true;
        bank.isRegistered = true;
        bank.totalDistributions = 0;
        bank.totalVolume = 0;
        bank.registrationTime = block.timestamp;
        bank.totalFeeEarned = 0;
        
        s.totalBanks++;
        
        // Grant operator role to the bank address
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        EnumerableSet.add(ds._roles[RoleConstants.SPONSOR_BANK_OPERATOR_ROLE], bankAddress);
        
        emit SponsorBankStorage.SponsorBankRegistered(bankAddress, identifier, feeRate);
    }

    /**
     * @notice Update the active status of a sponsor bank
     * @param bankAddress The address of the bank to update
     * @param isActive New active status
     */
    function updateBankStatus(
        address bankAddress,
        bool isActive
    ) external 
      onlySponsorBankAdmin
      bankExists(bankAddress) {
        
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        
        s.banks[bankAddress].isActive = isActive;
        
        emit SponsorBankStorage.SponsorBankStatusUpdated(bankAddress, isActive);
    }

    /**
     * @notice Update the fee rate for a sponsor bank
     * @param bankAddress The address of the bank to update
     * @param newFeeRate New fee rate in basis points
     */
    function updateBankFeeRate(
        address bankAddress,
        uint256 newFeeRate
    ) external 
      onlySponsorBankAdmin
      bankExists(bankAddress) {
        
        require(newFeeRate <= 500, "Fee rate too high"); // Max 5%
        
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        s.banks[bankAddress].feeRate = newFeeRate;
    }

    /**
     * @notice Get complete information about a sponsor bank
     * @param bankAddress The address of the bank to query
     * @return bankAddr The bank's address
     * @return identifier The bank's identifier
     * @return feeRate The bank's fee rate
     * @return isActive Whether the bank is active
     * @return isRegistered Whether the bank is registered
     * @return totalDistributions Total number of distributions
     * @return totalVolume Total volume processed
     * @return registrationTime When the bank was registered
     */
    function getSponsorBankInfo(address bankAddress) 
        external view returns (
            address bankAddr,
            string memory identifier,
            uint256 feeRate,
            bool isActive,
            bool isRegistered,
            uint256 totalDistributions,
            uint256 totalVolume,
            uint256 registrationTime,
            uint256 totalFeeEarned
        ) {
        
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        SponsorBankStorage.SponsorBank storage bank = s.banks[bankAddress];
        
        return (
            bank.bankAddress,
            bank.identifier,
            bank.feeRate,
            bank.isActive,
            bank.isRegistered,
            bank.totalDistributions,
            bank.totalVolume,
            bank.registrationTime,
            bank.totalFeeEarned
        );
    }

    /**
     * @notice Get list of all registered sponsor banks
     * @return banks Array of registered bank addresses
     */
    function getAllSponsorBanks() external view returns (address[] memory banks) {
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        
        // First pass: count registered banks
        uint256 count = 0;
        for (uint256 i = 0; i < s.totalBanks; i++) {
            // Note: This is a simplified approach. In production, you'd maintain an array of bank addresses
            // For now, we'll return an empty array and suggest using events to track banks
        }
        
        banks = new address[](0);
        // TODO: Implement proper bank enumeration using an array in storage
        return banks;
    }

    /**
     * @notice Check if an address is a registered and active sponsor bank
     * @param bankAddress The address to check
     * @return isValid True if the address is a valid sponsor bank
     */
    function isValidSponsorBank(address bankAddress) external view returns (bool isValid) {
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        SponsorBankStorage.SponsorBank storage bank = s.banks[bankAddress];
        return bank.isRegistered && bank.isActive;
    }

    /**
     * @notice Get total number of registered banks
     * @return count Total number of banks registered
     */
    function getTotalBanksCount() external view returns (uint256 count) {
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        return s.totalBanks;
    }

    /**
     * @notice Set global configuration parameters
     * @param minDistributionAmount Minimum amount for distributions
     * @param maxBatchSize Maximum batch size for operations
     * @param globalKYCFeeRate Global KYC fee rate in basis points
     */
    function setGlobalParameters(
        uint256 minDistributionAmount,
        uint256 maxBatchSize,
        uint256 globalKYCFeeRate
    ) external onlySponsorBankAdmin {
        require(globalKYCFeeRate <= 100, "KYC fee rate too high"); // Max 1%
        require(maxBatchSize > 0 && maxBatchSize <= 1000, "Invalid batch size");
        
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        s.minDistributionAmount = minDistributionAmount;
        s.maxBatchSize = maxBatchSize;
        s.globalKYCFeeRate = globalKYCFeeRate;
    }

    // NOTE: Emergency pause functionality (setEmergencyPause) is handled by AutomatedResponseFacet.emergencyPauseStorageSystem / emergencyResumeStorageSystem to avoid selector collisions

    /**
     * @notice Get global configuration parameters
     * @return minDistributionAmount Minimum distribution amount
     * @return maxBatchSize Maximum batch size
     * @return globalKYCFeeRate Global KYC fee rate
     * @return emergencyPaused Emergency pause status
     */
    function getGlobalParameters() external view returns (
        uint256 minDistributionAmount,
        uint256 maxBatchSize,
        uint256 globalKYCFeeRate,
        bool emergencyPaused
    ) {
        SponsorBankStorage.Storage storage s = SponsorBankStorage.layout();
        return (
            s.minDistributionAmount,
            s.maxBatchSize,
            s.globalKYCFeeRate,
            s.emergencyPaused
        );
    }
}
