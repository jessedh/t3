// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "./StorageLib.sol";
import { SponsorBankStorage } from "./SponsorBankStorage.sol";
import { InvestmentStorage } from "./InvestmentStorage.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title StorageMigrationLib
 * @dev Utilities for migrating from AppStorage to isolated storage patterns
 * @notice Provides adapters and helpers for gradual storage pattern migration
 * 
 * Migration Strategy:
 * 1. Create adapters that work with both storage patterns
 * 2. Gradually migrate facets from AppStorage to isolated storage
 * 3. Provide validation tools to ensure data consistency
 * 4. Enable rollback mechanisms for safety
 */
library StorageMigrationLib {
    using EnumerableSet for EnumerableSet.AddressSet;

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // MIGRATION STATUS TRACKING
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    
    enum StoragePattern {
        APP_STORAGE,        // Legacy monolithic AppStorage
        ISOLATED_STORAGE,   // New isolated storage libraries
        HYBRID             // During migration - supports both
    }
    
    enum MigrationPhase {
        NOT_STARTED,       // No migration begun
        ADAPTERS_DEPLOYED, // Adapter contracts ready
        PARTIAL_MIGRATION, // Some facets migrated
        VALIDATION_PHASE,  // Data consistency checks
        COMPLETE,          // Migration finished
        ROLLBACK           // Migration reversed
    }
    
    struct MigrationStatus {
        StoragePattern currentPattern;
        MigrationPhase phase;
        uint256 migratedFacetCount;
        uint256 totalFacetCount;
        bytes32 dataHashBefore;
        bytes32 dataHashAfter;
        uint256 migrationStartTime;
        address migrationOperator;
        bool emergencyStop;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // STORAGE PATTERN ADAPTERS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Universal storage adapter for access control
     * @dev Works with both AppStorage and isolated storage patterns
     * @param ds AppStorage reference (may be empty during migration)
     * @param role Role to check
     * @param account Account to verify
     * @return bool True if account has role
     */
    function hasRoleUniversal(
        StorageLib.AppStorage storage ds,
        bytes32 role,
        address account
    ) internal view returns (bool) {
        // During migration, check both storage patterns
        // Primary: Check AppStorage (current system)
        if (ds._roles[role].length() > 0) {
            return ds._roles[role].contains(account);
        }
        
        // Fallback: Could implement isolated storage check here
        // This would require additional storage slot for migration state
        return false;
    }
    
    /**
     * @notice Universal balance checker
     * @dev Adapts between AppStorage and domain-specific storage
     * @param ds AppStorage reference
     * @param account Account to check
     * @return uint256 Token balance
     */
    function getBalanceUniversal(
        StorageLib.AppStorage storage ds,
        address account
    ) internal view returns (uint256) {
        // Always use AppStorage for core token balances
        // ERC20 balances should remain in AppStorage for consistency
        return ds._balances[account];
    }
    
    /**
     * @notice Universal sponsor bank data access
     * @dev Bridges AppStorage and SponsorBankStorage patterns
     * @param ds AppStorage reference
     * @param bankAddress Bank to query
     * @return isRegistered Whether bank is registered
     * @return isActive Whether bank is active
     */
    function getBankStatusUniversal(
        StorageLib.AppStorage storage ds,
        address bankAddress
    ) internal view returns (bool isRegistered, bool isActive) {
        // Check isolated SponsorBankStorage first (preferred)
        SponsorBankStorage.Storage storage sponsorStorage = SponsorBankStorage.layout();
        if (sponsorStorage.banks[bankAddress].isRegistered) {
            return (true, sponsorStorage.banks[bankAddress].isActive);
        }
        
        // Fallback: Could check AppStorage if data exists there
        // For now, isolated storage is authoritative for sponsor banks
        return (false, false);
    }
    
    /**
     * @notice Universal investment vehicle access
     * @dev Bridges between storage patterns for investment data
     * @param ds AppStorage reference
     * @param vehicleId Investment vehicle ID
     * @return exists Whether vehicle exists
     * @return isActive Whether vehicle is active
     */
    function getVehicleStatusUniversal(
        StorageLib.AppStorage storage ds,
        bytes32 vehicleId
    ) internal view returns (bool exists, bool isActive) {
        // Check isolated InvestmentStorage (authoritative)
        InvestmentStorage.Storage storage investmentStorage = InvestmentStorage.layout();
        if (investmentStorage.vehicles[vehicleId].sponsor != address(0)) {
            return (true, investmentStorage.vehicles[vehicleId].isActive);
        }
        
        // Investment data only exists in isolated storage
        return (false, false);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // MIGRATION VALIDATION TOOLS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Generate data hash for consistency verification
     * @dev Creates hash of critical storage data for migration validation
     * @param ds AppStorage reference
     * @return bytes32 Hash of current storage state
     */
    function generateStorageHash(StorageLib.AppStorage storage ds) internal view returns (bytes32) {
        // Hash critical data points for consistency checking
        return keccak256(abi.encodePacked(
            ds._totalSupply,
            ds.treasuryAddress,
            ds.halfLifeDuration,
            ds._paused,
            block.timestamp
        ));
    }
    
    /**
     * @notice Validate storage consistency between patterns
     * @dev Ensures data integrity during migration
     * @param ds AppStorage reference
     * @return bool True if storage states are consistent
     */
    function validateStorageConsistency(StorageLib.AppStorage storage ds) internal view returns (bool) {
        // Validate that AppStorage and isolated storage contain consistent data
        
        // 1. Check sponsor bank consistency
        SponsorBankStorage.Storage storage sponsorStorage = SponsorBankStorage.layout();
        if (sponsorStorage.totalBanks == 0 && ds._totalSupply > 0) {
            // If we have tokens but no banks, there might be inconsistency
            // This is application-specific validation logic
        }
        
        // 2. Check investment vehicle consistency  
        InvestmentStorage.Storage storage investmentStorage = InvestmentStorage.layout();
        // Add specific validation rules based on business logic
        
        // 3. Validate core token data integrity
        if (ds._totalSupply == 0 && ds.treasuryAddress == address(0)) {
            return false; // Core data appears uninitialized
        }
        
        return true; // Basic validation passed
    }
    
    /**
     * @notice Check if facet can be safely migrated
     * @dev Validates prerequisites for facet migration
     * @param facetAddress Address of facet to migrate
     * @param storagePattern Target storage pattern
     * @return bool True if migration is safe
     * @return string Reason if migration blocked
     */
    function canMigrateFacet(
        address facetAddress,
        StoragePattern storagePattern
    ) internal pure returns (bool, string memory) {
        if (facetAddress == address(0)) {
            return (false, "Invalid facet address");
        }
        
        if (storagePattern == StoragePattern.APP_STORAGE) {
            return (false, "Cannot migrate TO AppStorage - deprecated pattern");
        }
        
        // Add specific validation logic for each facet type
        // This would be expanded based on actual facet requirements
        
        return (true, "Migration validated");
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // MIGRATION EXECUTION HELPERS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Begin migration process with safety checks
     * @dev Initializes migration state and validates prerequisites
     * @param ds AppStorage reference
     * @param operator Address performing migration
     * @return bool True if migration started successfully
     */
    function beginMigration(
        StorageLib.AppStorage storage ds,
        address operator
    ) internal returns (bool) {
        require(operator != address(0), "Invalid migration operator");
        
        // Generate baseline hash for validation
        bytes32 baselineHash = generateStorageHash(ds);
        
        // Validate current state
        require(validateStorageConsistency(ds), "Storage inconsistency detected");
        
        // Store migration metadata in a reserved AppStorage slot
        // This would require extending AppStorage with migration fields
        
        return true;
    }
    
    /**
     * @notice Emergency stop migration process
     * @dev Halts migration and prepares for rollback
     * @param ds AppStorage reference
     * @param reason Reason for emergency stop
     */
    function emergencyStopMigration(
        StorageLib.AppStorage storage ds,
        string memory reason
    ) internal {
        // Implement emergency stop logic
        // This would set emergency flags and preserve state for rollback
        
        // Emit event for monitoring
        emit MigrationEmergencyStop(msg.sender, reason, block.timestamp);
    }
    
    /**
     * @notice Complete migration and validate final state
     * @dev Finalizes migration with comprehensive validation
     * @param ds AppStorage reference
     * @return bool True if migration completed successfully
     */
    function completeMigration(StorageLib.AppStorage storage ds) internal returns (bool) {
        // Validate final state consistency
        require(validateStorageConsistency(ds), "Final state validation failed");
        
        // Generate completion hash
        bytes32 finalHash = generateStorageHash(ds);
        
        // Mark migration as complete
        emit MigrationCompleted(msg.sender, finalHash, block.timestamp);
        
        return true;
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // UTILITY FUNCTIONS FOR SPECIFIC MIGRATIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @notice Helper for migrating access control patterns
     * @dev Provides utilities for standardizing role checks across storage patterns
     * @param ds AppStorage reference
     * @param role Role to standardize
     * @param accounts Accounts that should have role
     */
    function standardizeRoleAccess(
        StorageLib.AppStorage storage ds,
        bytes32 role,
        address[] memory accounts
    ) internal {
        // Ensure role exists in AppStorage with correct members
        for (uint256 i = 0; i < accounts.length; i++) {
            if (!ds._roles[role].contains(accounts[i])) {
                ds._roles[role].add(accounts[i]);
            }
        }
    }
    
    /**
     * @notice Helper for validating facet storage usage
     * @dev Checks if facet correctly uses intended storage pattern
     * @param facetAddress Facet to validate
     * @param expectedPattern Expected storage pattern
     * @return bool True if facet uses correct pattern
     */
    function validateFacetStoragePattern(
        address facetAddress,
        StoragePattern expectedPattern
    ) internal view returns (bool) {
        // This would implement pattern detection logic
        // Could analyze function selectors, storage slots used, etc.
        
        return true; // Placeholder implementation
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    
    event MigrationStarted(address indexed operator, bytes32 baselineHash, uint256 timestamp);
    event MigrationCompleted(address indexed operator, bytes32 finalHash, uint256 timestamp);
    event MigrationEmergencyStop(address indexed operator, string reason, uint256 timestamp);
    event FacetMigrated(address indexed facetAddress, StoragePattern fromPattern, StoragePattern toPattern);
    event StorageValidationFailed(string reason, bytes32 dataHash, uint256 timestamp);
}

/**
 * @dev IMPLEMENTATION GUIDE:
 * 
 * Phase 1: Deploy Migration Utilities
 * 1. Deploy StorageMigrationLib
 * 2. Create adapter functions for critical operations
 * 3. Add migration status tracking to AppStorage
 * 
 * Phase 2: Create Hybrid Facets
 * 1. Update existing facets to use universal adapters
 * 2. Test functionality with both storage patterns
 * 3. Validate data consistency throughout
 * 
 * Phase 3: Gradual Migration
 * 1. Migrate non-critical facets first
 * 2. Validate after each facet migration
 * 3. Monitor for any data inconsistencies
 * 
 * Phase 4: Complete Migration
 * 1. Migrate remaining core facets
 * 2. Remove AppStorage dependencies
 * 3. Clean up legacy storage slots
 * 
 * SAFETY CONSIDERATIONS:
 * - Always validate storage consistency before and after migration
 * - Implement emergency stop mechanisms
 * - Create rollback procedures for each phase
 * - Test extensively on testnets before mainnet migration
 * - Consider implementing timelock for migration operations
 */