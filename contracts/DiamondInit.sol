// contracts/DiamondInit.sol
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "./lib/StorageLib.sol";
import { RoleConstants } from "./lib/RoleConstants.sol";
import { RulesStorageLib } from "./lib/RulesStorageLib.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";


contract DiamondInit {
    using EnumerableSet for EnumerableSet.AddressSet;
    // Add this event at the top of your contract if not already present
    event RoleAssignmentSuccess(bytes32 indexed role, address indexed account, string message);
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    
    event InitialParametersSet(
        string tokenName,
        string tokenSymbol,
        address treasuryAddress,
        uint256 halfLifeDuration,
        uint256 minHalfLifeDuration,
        uint256 maxHalfLifeDuration,
        uint256 inactivityResetPeriod,
        uint256 minFeeWei,
        uint256 baseRiskScalerBpsScaled,
        uint256 maxRiskScalerBpsScaled
    );
    event FeeTiersSet(uint256[] thresholdsWei, uint256[] ratesBpsScaled);

    struct InitParams {
        string tokenName;
        string tokenSymbol;
        address treasuryAddress;
        address ownerAddress;  // Add owner address
        uint256 halfLifeDurationSeconds;
        uint256 minHalfLifeDurationSeconds;
        uint256 maxHalfLifeDurationSeconds;
        uint256 inactivityResetPeriodSeconds;
        uint256 minFeeWei;
        uint256 maxFeePercentBps; // Max fee percentage in basis points
        uint256 baseRiskScalerBpsScaled;
        uint256 maxRiskScalerBpsScaled;
        uint256[] feeTierThresholdsWei;
        uint256[] feeTierRatesBpsScaled;
    }
    
    function init(InitParams calldata params) external {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        require(ds.treasuryAddress == address(0), "DiamondInit: Already initialized");

        address deployerAddress = params.ownerAddress;  // Use owner from params instead of msg.sender
        
        require(deployerAddress != address(0), "DiamondInit: Owner cannot be zero address");
        require(params.treasuryAddress != address(0), "DiamondInit: Treasury address cannot be zero");
        require(bytes(params.tokenName).length > 0, "DiamondInit: Token name cannot be empty");
        require(bytes(params.tokenSymbol).length > 0, "DiamondInit: Token symbol cannot be empty");
        require(params.feeTierThresholdsWei.length == params.feeTierRatesBpsScaled.length, "DiamondInit: Fee tiers length mismatch");

        // List all roles you want to assign to the deployer
        bytes32[6] memory roles = [
            RoleConstants.DEFAULT_ADMIN_ROLE,
            RoleConstants.ADMIN_ROLE,
            RoleConstants.MINTER_ROLE,
            RoleConstants.BURNER_ROLE,
            RoleConstants.CUSTODIAN_ROLE,
            RoleConstants.PAUSER_ROLE
            // Add more roles here if needed 
            //update array size accordingly
        ];

        for (uint256 i = 0; i < roles.length; i++) {
            bytes32 role = roles[i];
            if (!ds._roles[role].contains(deployerAddress)) {
                ds._roles[role].add(deployerAddress);
                emit RoleGranted(role, deployerAddress, deployerAddress);
                emit RoleAssignmentSuccess(role, deployerAddress, "Role successfully assigned to deployer");
            }
        }


        // This will be the deployer if called from your script
        //address sender = msg.sender; 
        //
        // // Grant DEFAULT_ADMIN_ROLE directly through storage
        // bytes32 DEFAULT_ADMIN_ROLE = 0x00;
        // // Grant DEFAULT_ADMIN_ROLE to deployer if not already present
        // if (!ds._roles[DEFAULT_ADMIN_ROLE].contains(sender)) {
        //     ds._roles[DEFAULT_ADMIN_ROLE].add(sender);
        // }
        // // this is probably redundant but ensures the deployer has the admin role
        // if (!ds._roles[adminRole].contains(deployerAddress)) {
        //         ds._roles[adminRole].add(deployerAddress);
        //         emit RoleGranted(adminRole, deployerAddress, deployerAddress);
        //     }



        
    
    
        ds._name = params.tokenName;
        ds._symbol = params.tokenSymbol;
        ds.treasuryAddress = params.treasuryAddress;
        ds.halfLifeDuration = params.halfLifeDurationSeconds;
        ds.minHalfLifeDuration = params.minHalfLifeDurationSeconds;
        ds.maxHalfLifeDuration = params.maxHalfLifeDurationSeconds;
        ds.inactivityResetPeriod = params.inactivityResetPeriodSeconds;
        ds.minFeeWei = params.minFeeWei;
        ds.maxFeePercentBps = params.maxFeePercentBps;
        ds.baseRiskScalerBps = params.baseRiskScalerBpsScaled;
        ds.maxRiskScalerBps = params.maxRiskScalerBpsScaled;
        ds.feeTierThresholds = params.feeTierThresholdsWei;
        ds.feeTierRatesBps = params.feeTierRatesBpsScaled;

        // Initialize reentrancy guard to _NOT_ENTERED state (1)
        // This prevents the first transaction from bypassing reentrancy protection
        ds._reentrancyMutex = 1;

        // Initialize multi-signature storage structures
        ds.proposalCounter = 0;
        ds.operationCounter = 0;
        ds.multiSigConfig.threshold = 0; // No threshold until multi-sig is activated
        ds.multiSigConfig.proposalTimeout = 7 days; // Default 7-day timeout
        ds.multiSigConfig.maxSigners = 10; // Maximum 10 signers for gas efficiency
        ds.multiSigConfig.emergencyMode = false;
        ds.multiSigConfig.emergencyThreshold = 0;
        
        // Initialize emergency controls
        ds.emergencyControls.emergencyPaused = false;
        ds.emergencyControls.emergencyPauser = address(0);
        ds.emergencyControls.pausedAt = 0;
        ds.emergencyControls.maxPauseDuration = 72 hours; // Max 72-hour emergency pause

        // KYC default-ON: seed the NETWORK-scope rules so KYC status is evaluated/recorded
        // for transfers out of the box (traditional bank model — KYC is implicit/required).
        // This only SCORES by default; hard enforcement (deny) remains a separate admin dial
        // (enforceDenyAt / observationMode). Disable network-wide by setting this false via
        // RulesConfig. kycAmountThreshold = 0 => evaluated for all amounts.
        RulesStorageLib.rulesStorage()
            .ruleSets[keccak256(abi.encodePacked("NETWORK", bytes32(0)))]
            .requireKyc = true;

        emit InitialParametersSet(
            params.tokenName,
            params.tokenSymbol,
            params.treasuryAddress,
            params.halfLifeDurationSeconds,
            params.minHalfLifeDurationSeconds,
            params.maxHalfLifeDurationSeconds,
            params.inactivityResetPeriodSeconds,
            params.minFeeWei,
            params.baseRiskScalerBpsScaled,
            params.maxRiskScalerBpsScaled
        );
        emit FeeTiersSet(params.feeTierThresholdsWei, params.feeTierRatesBpsScaled);
    }
}
