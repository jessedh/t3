// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "./StorageLib.sol";
import { SponsorBankStorage } from "./SponsorBankStorage.sol";
import { InvestmentStorage } from "./InvestmentStorage.sol";
import { AccessControlLib } from "./AccessControlLib.sol";
import { RoleConstants } from "./RoleConstants.sol";

/**
 * @title EmergencyCoordinationLib
 * @dev Atomic cross-storage emergency synchronization library
 * @notice Provides transaction-level atomicity for emergency state changes across
 *         AppStorage, SponsorBankStorage, and InvestmentStorage systems
 * 
 * Key Features:
 * - Atomic emergency state transitions (all succeed or all fail)
 * - Race condition prevention through single-transaction updates
 * - Comprehensive emergency state validation
 * - Gas-optimized emergency operations
 * - Audit trail with detailed event logging
 */
library EmergencyCoordinationLib {
    
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    
    event AtomicEmergencyActivated(
        address indexed activator,
        string reason,
        uint256 timestamp,
        bool[3] systemsAffected // [AppStorage, SponsorBank, Investment]
    );
    
    event AtomicEmergencyDeactivated(
        address indexed deactivator,
        string reason,
        uint256 timestamp,
        bool[3] systemsResumed // [AppStorage, SponsorBank, Investment]
    );
    
    event EmergencyStateValidated(
        bool appStorageState,
        bool sponsorBankState,
        bool investmentState,
        bool isConsistent
    );
    
    event EmergencyCoordinationFailed(
        string reason,
        uint256 failedAtStep,
        address caller
    );

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // CUSTOM ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    
    error AtomicEmergencyFailed(string reason);
    error InconsistentEmergencyState(bool app, bool sponsor, bool investment);
    error EmergencyAlreadyActive();
    error EmergencyNotActive();
    error InvalidEmergencyLevel(uint8 level);
    error EmergencyOperationUnauthorized(address caller);

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // EMERGENCY STATE COORDINATION
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @dev Atomically activate emergency mode across all storage systems
     * @param reason Human-readable reason for emergency activation
     * @param threatLevel Quantum threat level (0-10)
     * @notice This function either succeeds completely or reverts entirely
     */
    function activateAtomicEmergency(
        string memory reason,
        uint8 threatLevel
    ) internal {
        // Validate access control
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.requireSenderRole(ds, RoleConstants.PAUSER_ROLE);
        
        // Validate threat level
        if (threatLevel > 10) {
            revert InvalidEmergencyLevel(threatLevel);
        }
        
        // Get all storage references
        SponsorBankStorage.Storage storage sbStorage = SponsorBankStorage.layout();
        InvestmentStorage.Storage storage invStorage = InvestmentStorage.layout();
        
        // Check if already in emergency mode
        if (ds._paused || sbStorage.emergencyPaused || invStorage.emergencyPaused) {
            revert EmergencyAlreadyActive();
        }
        
        // ATOMIC OPERATION: All storage updates in single transaction
        // If any of these fail, the entire transaction reverts
        _atomicActivateEmergencyStates(ds, sbStorage, invStorage, threatLevel);
        
        // Success - emit coordination event
        bool[3] memory systemsAffected = [true, true, true];
        emit AtomicEmergencyActivated(
            msg.sender,
            reason,
            block.timestamp,
            systemsAffected
        );
        
        // Validate final state consistency
        _validateEmergencyStateConsistency(ds, sbStorage, invStorage, true);
    }

    /**
     * @dev Atomically deactivate emergency mode across all storage systems
     * @param reason Human-readable reason for emergency deactivation
     * @notice This function either succeeds completely or reverts entirely
     */
    function deactivateAtomicEmergency(
        string memory reason
    ) internal {
        // Validate access control
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.requireSenderRole(ds, RoleConstants.PAUSER_ROLE);
        
        // Get all storage references
        SponsorBankStorage.Storage storage sbStorage = SponsorBankStorage.layout();
        InvestmentStorage.Storage storage invStorage = InvestmentStorage.layout();
        
        // M-7: Check if ALL emergency modes are active (require full emergency state)
        // Previously used OR logic which allowed partial deactivation
        if (!ds._paused || !sbStorage.emergencyPaused || !invStorage.emergencyPaused) {
            revert EmergencyNotActive();
        }
        
        // ATOMIC OPERATION: All storage updates in single transaction
        // If any of these fail, the entire transaction reverts
        _atomicDeactivateEmergencyStates(ds, sbStorage, invStorage);
        
        // Success - emit coordination event
        bool[3] memory systemsResumed = [true, true, true];
        emit AtomicEmergencyDeactivated(
            msg.sender,
            reason,
            block.timestamp,
            systemsResumed
        );
        
        // Validate final state consistency
        _validateEmergencyStateConsistency(ds, sbStorage, invStorage, false);
    }

    /**
     * @dev Check emergency state consistency across all storage systems
     * @return isConsistent Whether all storage systems have consistent emergency states
     * @return states Array of emergency states [AppStorage, SponsorBank, Investment]
     */
    function checkEmergencyStateConsistency() 
        internal 
        view 
        returns (bool isConsistent, bool[3] memory states) 
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        SponsorBankStorage.Storage storage sbStorage = SponsorBankStorage.layout();
        InvestmentStorage.Storage storage invStorage = InvestmentStorage.layout();
        
        bool appEmergency = ds._paused || ds.quantumEmergencyMode;
        bool sponsorEmergency = sbStorage.emergencyPaused;
        bool investmentEmergency = invStorage.emergencyPaused;
        
        states = [appEmergency, sponsorEmergency, investmentEmergency];
        
        // All should be the same for consistency
        isConsistent = (appEmergency == sponsorEmergency) && 
                      (sponsorEmergency == investmentEmergency);
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // INTERNAL ATOMIC OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @dev Internal function to atomically activate emergency states
     * @notice This function updates all storage systems atomically within a single transaction
     */
    function _atomicActivateEmergencyStates(
        StorageLib.AppStorage storage ds,
        SponsorBankStorage.Storage storage sbStorage,
        InvestmentStorage.Storage storage invStorage,
        uint8 threatLevel
    ) internal {
        // Update AppStorage emergency states
        ds._paused = true;
        ds.quantumEmergencyMode = true;
        ds.globalQuantumThreatLevel = threatLevel;
        
        // Update SponsorBankStorage emergency state
        sbStorage.emergencyPaused = true;
        
        // Update InvestmentStorage emergency state
        invStorage.emergencyPaused = true;
        
        // If we reach here, all updates succeeded atomically
        // Any failure above would cause transaction revert
    }

    /**
     * @dev Internal function to atomically deactivate emergency states
     * @notice This function updates all storage systems atomically within a single transaction
     */
    function _atomicDeactivateEmergencyStates(
        StorageLib.AppStorage storage ds,
        SponsorBankStorage.Storage storage sbStorage,
        InvestmentStorage.Storage storage invStorage
    ) internal {
        // Update AppStorage emergency states
        ds._paused = false;
        ds.quantumEmergencyMode = false;
        ds.globalQuantumThreatLevel = 0;
        
        // Update SponsorBankStorage emergency state
        sbStorage.emergencyPaused = false;
        
        // Update InvestmentStorage emergency state
        invStorage.emergencyPaused = false;
        
        // If we reach here, all updates succeeded atomically
        // Any failure above would cause transaction revert
    }

    /**
     * @dev Validate emergency state consistency and emit events
     * @param ds AppStorage reference
     * @param sbStorage SponsorBankStorage reference
     * @param invStorage InvestmentStorage reference
     * @param expectedState Expected emergency state (true = emergency active)
     */
    function _validateEmergencyStateConsistency(
        StorageLib.AppStorage storage ds,
        SponsorBankStorage.Storage storage sbStorage,
        InvestmentStorage.Storage storage invStorage,
        bool expectedState
    ) internal {
        bool appEmergency = ds._paused || ds.quantumEmergencyMode;
        bool sponsorEmergency = sbStorage.emergencyPaused;
        bool investmentEmergency = invStorage.emergencyPaused;
        
        bool isConsistent = (appEmergency == expectedState) &&
                           (sponsorEmergency == expectedState) &&
                           (investmentEmergency == expectedState);
        
        emit EmergencyStateValidated(
            appEmergency,
            sponsorEmergency,
            investmentEmergency,
            isConsistent
        );
        
        if (!isConsistent) {
            revert InconsistentEmergencyState(
                appEmergency,
                sponsorEmergency,
                investmentEmergency
            );
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // EMERGENCY STATE UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /**
     * @dev Get current emergency status across all storage systems
     * @return appStatus AppStorage emergency status
     * @return sponsorStatus SponsorBankStorage emergency status  
     * @return investmentStatus InvestmentStorage emergency status
     * @return threatLevel Current quantum threat level
     */
    function getEmergencyStatus() 
        internal 
        view 
        returns (
            bool appStatus,
            bool sponsorStatus,
            bool investmentStatus,
            uint8 threatLevel
        ) 
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        SponsorBankStorage.Storage storage sbStorage = SponsorBankStorage.layout();
        InvestmentStorage.Storage storage invStorage = InvestmentStorage.layout();
        
        appStatus = ds._paused || ds.quantumEmergencyMode;
        sponsorStatus = sbStorage.emergencyPaused;
        investmentStatus = invStorage.emergencyPaused;
        threatLevel = ds.globalQuantumThreatLevel;
    }

    /**
     * @dev Force emergency state synchronization (admin only)
     * @param targetState Target emergency state for all systems
     * @param reason Reason for forced synchronization
     * @notice This is a recovery function for inconsistent states
     */
    function forceEmergencyStateSynchronization(
        bool targetState,
        string memory reason
    ) internal {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.requireSenderRole(ds, RoleConstants.DEFAULT_ADMIN_ROLE);
        
        SponsorBankStorage.Storage storage sbStorage = SponsorBankStorage.layout();
        InvestmentStorage.Storage storage invStorage = InvestmentStorage.layout();
        
        // Force all systems to target state
        if (targetState) {
            _atomicActivateEmergencyStates(ds, sbStorage, invStorage, 1);
        } else {
            _atomicDeactivateEmergencyStates(ds, sbStorage, invStorage);
        }
        
        // Validate consistency
        _validateEmergencyStateConsistency(ds, sbStorage, invStorage, targetState);
        
        // Emit appropriate event
        bool[3] memory systems = [true, true, true];
        if (targetState) {
            emit AtomicEmergencyActivated(msg.sender, reason, block.timestamp, systems);
        } else {
            emit AtomicEmergencyDeactivated(msg.sender, reason, block.timestamp, systems);
        }
    }
}