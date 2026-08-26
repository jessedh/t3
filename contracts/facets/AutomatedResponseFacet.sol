// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { SponsorBankStorage } from "../lib/SponsorBankStorage.sol";
import { InvestmentStorage } from "../lib/InvestmentStorage.sol";
import { EmergencyCoordinationLib } from "../lib/EmergencyCoordinationLib.sol";
import { ERC20PausableFacet } from "./ERC20PausableFacet.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title AutomatedResponseFacet
 * @dev Provides automated emergency response coordination across all storage systems
 * @notice Provides automated emergency response coordination across operational facets
 * @dev Enables synchronized emergency states across all storage systems
 */
contract AutomatedResponseFacet is ERC20PausableFacet {
    using EnumerableSet for EnumerableSet.AddressSet;

    // Events for automated response tracking
    event AutomatedEmergencyModeActivated(
        uint8 indexed threatLevel,
        address indexed activator,
        string reason,
        uint256 timestamp,
        bool[] systemsPaused
    );
    
    event AutomatedEmergencyModeDeactivated(
        address indexed deactivator,
        string reason,
        uint256 timestamp,
        bool[] systemsResumed
    );
    
    event CrossStorageEmergencySync(
        bool appStorageState,
        bool sponsorBankState,
        bool investmentState,
        uint256 timestamp
    );
    
    event EmergencyActionExecuted(
        string indexed actionType,
        address indexed executor,
        bool success,
        string details
    );
    
    event SystemRecoveryValidated(
        bool allSystemsOperational,
        uint256 validationTimestamp,
        string[] failedChecks
    );

    /**
     * @notice Activate coordinated emergency mode across all storage systems
     * @param _threatLevel Threat level (0-10), supplied by the caller
     * @param _reason Reason for emergency activation
     * @dev Threat detection is EXTERNAL to this repository. No facet in the manifest monitors
     *      or scores threats; an authorized operator supplies the level based on off-chain
     *      assessment. This function is the on-chain actuator, not the detector.
     */
    function activateCoordinatedEmergencyMode(
        uint8 _threatLevel,
        string calldata _reason
    ) external {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[RoleConstants.ADMIN_ROLE].contains(msg.sender) &&
            !ds._roles[RoleConstants.PAUSER_ROLE].contains(msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.PAUSER_ROLE);
        }
        _activateCoordinatedEmergencyModeInternal(_threatLevel, _reason);
    }

    function _activateCoordinatedEmergencyModeInternal(
        uint8 _threatLevel,
        string memory _reason
    ) internal {
        EmergencyCoordinationLib.activateAtomicEmergency(_reason, _threatLevel);

        bool[] memory systemsPaused = new bool[](3);
        systemsPaused[0] = _threatLevel >= 9;
        systemsPaused[1] = true;
        systemsPaused[2] = true;

        emit AutomatedEmergencyModeActivated(
            _threatLevel,
            msg.sender,
            _reason,
            block.timestamp,
            systemsPaused
        );

        emit CrossStorageEmergencySync(
            _threatLevel >= 9,
            true,
            true,
            block.timestamp
        );
    }

    /**
     * @notice Deactivate coordinated emergency mode and resume operations
     * @param _reason Reason for emergency deactivation
     * @dev Provides the missing integration for emergency recovery procedures
     */
    function deactivateCoordinatedEmergencyMode(string calldata _reason) external {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[RoleConstants.ADMIN_ROLE].contains(msg.sender) &&
            !ds._roles[RoleConstants.PAUSER_ROLE].contains(msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.PAUSER_ROLE);
        }
        EmergencyCoordinationLib.deactivateAtomicEmergency(_reason);
        
        // Emit legacy event for backward compatibility
        bool[] memory systemsResumed = new bool[](3);
        systemsResumed[0] = true; // AppStorage resumed
        systemsResumed[1] = true; // SponsorBank resumed
        systemsResumed[2] = true; // Investment resumed

        emit AutomatedEmergencyModeDeactivated(
            msg.sender,
            _reason,
            block.timestamp,
            systemsResumed
        );

        emit CrossStorageEmergencySync(
            false,
            false,
            false,
            block.timestamp
        );
    }

    /**
     * @notice Operator-triggered emergency response, escalating by threat level.
     * @param _threatLevel New threat level (0-10). >=9 activates coordinated emergency mode,
     *        >=7 activates enhanced monitoring, 0 clears emergency measures.
     * @param _reason Reason for the threat level change, recorded in the emitted event.
     * @dev MANUALLY TRIGGERED. Callable only by ADMIN_ROLE or CUSTODIAN_ROLE. Despite the
     *      "automated" in this facet's name, nothing in this repository calls it — there is no
     *      threat-monitoring facet in the manifest. The escalation LOGIC is automated once
     *      invoked; the DECISION to invoke it is a human one, informed by off-chain assessment.
     *      Integrators wiring an external monitor must grant it one of those roles deliberately.
     */
    function respondToQuantumThreatLevel(
        uint8 _threatLevel,
        string calldata _reason
    ) external {
        require(_threatLevel <= 10, "Invalid threat level");
        
        // ADMIN or CUSTODIAN only. An external monitor must be granted one of these roles.
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        bool isAuthorized = ds._roles[RoleConstants.ADMIN_ROLE].contains(msg.sender) ||
                           ds._roles[RoleConstants.CUSTODIAN_ROLE].contains(msg.sender);
        require(isAuthorized, "Not authorized for automated response");

        if (_threatLevel >= 9) {
            // Critical threat level - activate full emergency mode
            _activateCoordinatedEmergencyModeInternal(_threatLevel, _reason);
            
            emit EmergencyActionExecuted(
                "full_emergency_activation",
                msg.sender,
                true,
                string(abi.encodePacked("Automated response to threat level ", _toString(_threatLevel)))
            );
        } else if (_threatLevel >= 7) {
            // High threat level - enhanced monitoring
            _activateEnhancedMonitoring(_threatLevel, _reason);
            
            emit EmergencyActionExecuted(
                "enhanced_monitoring",
                msg.sender,
                true,
                "Automated enhanced monitoring activation"
            );
        } else if (_threatLevel == 0) {
            // Threat cleared - deactivate emergency measures
            _deactivateEmergencyMeasures(_reason);
            
            emit EmergencyActionExecuted(
                "emergency_deactivation",
                msg.sender,
                true,
                "Automated emergency deactivation"
            );
        }
    }

    /**
     * @notice Validate system recovery after emergency deactivation
     * @return allSystemsOperational Whether all systems are operational
     * @return operationalStatus Status of each storage system
     */
    function validateSystemRecovery() 
        external 
        view 
        returns (
            bool allSystemsOperational,
            bool[3] memory operationalStatus
        ) 
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        SponsorBankStorage.Storage storage sbStorage = SponsorBankStorage.layout();
        InvestmentStorage.Storage storage invStorage = InvestmentStorage.layout();

        operationalStatus[0] = !ds._paused && !ds.quantumEmergencyMode; // AppStorage operational
        operationalStatus[1] = !sbStorage.emergencyPaused; // SponsorBank operational
        operationalStatus[2] = !invStorage.emergencyPaused; // Investment operational

        allSystemsOperational = operationalStatus[0] && operationalStatus[1] && operationalStatus[2];
    }

    /**
     * @notice Get comprehensive emergency status across all systems
     * @return emergencyStatus Emergency state of each storage system
     * @return threatLevel Current global threat level
     * @return lastUpdate Last emergency state update timestamp
     */
    function getComprehensiveEmergencyStatus()
        external
        view
        returns (
            bool[3] memory emergencyStatus,
            uint8 threatLevel,
            uint256 lastUpdate
        )
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        SponsorBankStorage.Storage storage sbStorage = SponsorBankStorage.layout();
        InvestmentStorage.Storage storage invStorage = InvestmentStorage.layout();

        emergencyStatus[0] = ds._paused || ds.quantumEmergencyMode; // AppStorage emergency state
        emergencyStatus[1] = sbStorage.emergencyPaused; // SponsorBank emergency state
        emergencyStatus[2] = invStorage.emergencyPaused; // Investment emergency state

        threatLevel = ds.globalQuantumThreatLevel;
        lastUpdate = block.timestamp;
    }

    /**
     * @notice Emergency pause specific storage system
     * @param _storageSystem Storage system to pause (0=App, 1=SponsorBank, 2=Investment)
     * @param _reason Reason for pause
     */
    function emergencyPauseStorageSystem(
        uint8 _storageSystem,
        string calldata _reason
    ) external {
        require(_storageSystem <= 2, "Invalid storage system");
        _checkRole(RoleConstants.ADMIN_ROLE, msg.sender);

        if (_storageSystem == 0) {
            // AppStorage
            StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
            ds._paused = true;
            ds.quantumEmergencyMode = true;
        } else if (_storageSystem == 1) {
            // SponsorBankStorage
            SponsorBankStorage.Storage storage sbStorage = SponsorBankStorage.layout();
            sbStorage.emergencyPaused = true;
        } else if (_storageSystem == 2) {
            // InvestmentStorage
            InvestmentStorage.Storage storage invStorage = InvestmentStorage.layout();
            invStorage.emergencyPaused = true;
        }

        emit EmergencyActionExecuted(
            "storage_system_pause",
            msg.sender,
            true,
            string(abi.encodePacked("Paused storage system ", _toString(_storageSystem), ": ", _reason))
        );
    }

    /**
     * @notice Emergency resume specific storage system
     * @param _storageSystem Storage system to resume (0=App, 1=SponsorBank, 2=Investment)
     * @param _reason Reason for resume
     */
    function emergencyResumeStorageSystem(
        uint8 _storageSystem,
        string calldata _reason
    ) external {
        require(_storageSystem <= 2, "Invalid storage system");
        _checkRole(RoleConstants.ADMIN_ROLE, msg.sender);

        if (_storageSystem == 0) {
            // AppStorage
            StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
            ds._paused = false;
            ds.quantumEmergencyMode = false;
            ds.globalQuantumThreatLevel = 0;
        } else if (_storageSystem == 1) {
            // SponsorBankStorage
            SponsorBankStorage.Storage storage sbStorage = SponsorBankStorage.layout();
            sbStorage.emergencyPaused = false;
        } else if (_storageSystem == 2) {
            // InvestmentStorage
            InvestmentStorage.Storage storage invStorage = InvestmentStorage.layout();
            invStorage.emergencyPaused = false;
        }

        emit EmergencyActionExecuted(
            "storage_system_resume",
            msg.sender,
            true,
            string(abi.encodePacked("Resumed storage system ", _toString(_storageSystem), ": ", _reason))
        );
    }

    /**
     * @notice Perform comprehensive system health check
     * @return isHealthy Results of system health validation
     */
    function performSystemHealthCheck()
        external
        returns (
            bool isHealthy,
            string[] memory failedChecks,
            uint256 checkTimestamp
        )
    {
        string[] memory tempFailedChecks = new string[](10);
        uint256 failedCount = 0;

        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        SponsorBankStorage.Storage storage sbStorage = SponsorBankStorage.layout();
        InvestmentStorage.Storage storage invStorage = InvestmentStorage.layout();

        // Check AppStorage health
        if (ds.quantumEmergencyMode && ds.globalQuantumThreatLevel == 0) {
            tempFailedChecks[failedCount] = "AppStorage: Emergency mode active with zero threat level";
            failedCount++;
        }

        // Check storage consistency
        bool appPaused = ds._paused || ds.quantumEmergencyMode;
        bool sbPaused = sbStorage.emergencyPaused;
        bool invPaused = invStorage.emergencyPaused;

        if (appPaused != sbPaused || appPaused != invPaused) {
            tempFailedChecks[failedCount] = "Storage systems not synchronized";
            failedCount++;
        }

        // Check for orphaned emergency states
        if (!appPaused && (sbPaused || invPaused)) {
            tempFailedChecks[failedCount] = "Orphaned emergency states detected";
            failedCount++;
        }

        // Resize failed checks array
        failedChecks = new string[](failedCount);
        for (uint256 i = 0; i < failedCount; i++) {
            failedChecks[i] = tempFailedChecks[i];
        }

        isHealthy = failedCount == 0;
        checkTimestamp = block.timestamp;

        // Emit health check results
        emit SystemRecoveryValidated(isHealthy, checkTimestamp, failedChecks);
    }

    // Internal helper functions

    function _activateEnhancedMonitoring(uint8 _threatLevel, string calldata _reason) internal {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ds.globalQuantumThreatLevel = _threatLevel;
        
        // Enhanced monitoring doesn't pause operations but increases threat level
        emit EmergencyActionExecuted(
            "enhanced_monitoring",
            msg.sender,
            true,
            string(abi.encodePacked("Enhanced monitoring for threat level ", _toString(_threatLevel)))
        );
    }

    function _deactivateEmergencyMeasures(string calldata _reason) internal {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        SponsorBankStorage.Storage storage sbStorage = SponsorBankStorage.layout();
        InvestmentStorage.Storage storage invStorage = InvestmentStorage.layout();

        // Only deactivate if currently in emergency mode
        if (ds.quantumEmergencyMode || sbStorage.emergencyPaused || invStorage.emergencyPaused) {
            ds.quantumEmergencyMode = false;
            ds.globalQuantumThreatLevel = 0;
            ds._paused = false;
            sbStorage.emergencyPaused = false;
            invStorage.emergencyPaused = false;

            bool[] memory systemsResumed = new bool[](3);
            systemsResumed[0] = true;
            systemsResumed[1] = true;
            systemsResumed[2] = true;
            
            emit AutomatedEmergencyModeDeactivated(
                msg.sender,
                _reason,
                block.timestamp,
                systemsResumed // All systems resumed
            );
        }
    }

    /**
     * @notice Check emergency state consistency across all storage systems
     * @return isConsistent Whether all storage systems have consistent emergency states
     * @return states Array of emergency states [AppStorage, SponsorBank, Investment]
     */
    function checkEmergencyStateConsistency() 
        external 
        view 
        returns (bool isConsistent, bool[3] memory states) 
    {
        return EmergencyCoordinationLib.checkEmergencyStateConsistency();
    }

    /**
     * @notice Get current emergency status across all storage systems
     * @return appStatus AppStorage emergency status
     * @return sponsorStatus SponsorBankStorage emergency status  
     * @return investmentStatus InvestmentStorage emergency status
     * @return threatLevel Current quantum threat level
     */
    function getEmergencyStatus() 
        external 
        view 
        returns (
            bool appStatus,
            bool sponsorStatus,
            bool investmentStatus,
            uint8 threatLevel
        ) 
    {
        return EmergencyCoordinationLib.getEmergencyStatus();
    }

    /**
     * @notice Force emergency state synchronization (admin only)
     * @param targetState Target emergency state for all systems
     * @param reason Reason for forced synchronization
     * @dev This is a recovery function for inconsistent states
     */
    function forceEmergencyStateSynchronization(
        bool targetState,
        string calldata reason
    ) external {
        EmergencyCoordinationLib.forceEmergencyStateSynchronization(targetState, reason);
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}