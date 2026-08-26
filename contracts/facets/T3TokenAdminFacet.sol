// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { AccessControlFacet } from "./AccessControlFacet.sol";
import { T3TokenCommonLogicFacet } from "./T3TokenCommonLogicFacet.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { T3CommonLib } from "../lib/T3CommonLib.sol";

contract T3TokenAdminFacet is ReentrancyGuardBase {
    using StorageLib for StorageLib.AppStorage;

    event TreasuryAddressUpdated(address indexed oldTreasury, address indexed newTreasury);
    event HalfLifeParametersUpdated(uint256 halfLifeDuration, uint256 minHalfLifeDuration, uint256 maxHalfLifeDuration);
    event InactivityResetPeriodUpdated(uint256 inactivityResetPeriod);
    event FeeParametersUpdated(uint256 minFeeWei, uint256 maxFeePercentBps, uint256 baseRiskScalerBps, uint256 maxRiskScalerBps);
    event FeeTiersUpdated(uint256[] feeTierThresholds, uint256[] feeTierRatesBps);
    event AbnormalTransactionFlagged(address indexed wallet, uint256 newAbnormalTxCount);


    using EnumerableSet for EnumerableSet.AddressSet;
    
    // Internal function to check role that doesn't rely on static call
    
    
    // Removed: _ensureProfileExistsForWrite - now using T3CommonLib.ensureProfileExistsForWrite
    
    function flagAbnormalTransaction(address wallet) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        if (wallet == address(0)) { revert StorageLib.UserAddressZero(); }
        T3CommonLib.ensureProfileExistsForWrite(ds, wallet);
        ds.walletRiskProfiles[wallet].abnormalTxCount++;
        emit AbnormalTransactionFlagged(wallet, ds.walletRiskProfiles[wallet].abnormalTxCount);
    }

    function setTreasuryAddress(address _treasuryAddress) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        if (_treasuryAddress == address(0)) { revert StorageLib.TreasuryAddressZero(); }
        address oldTreasury = ds.treasuryAddress;
        ds.treasuryAddress = _treasuryAddress;
        emit TreasuryAddressUpdated(oldTreasury, _treasuryAddress);
    }

    function setHalfLifeDuration(uint256 _halfLifeDuration) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        if (_halfLifeDuration < ds.minHalfLifeDuration) { revert StorageLib.HalfLifeBelowMinimum(); }
        if (_halfLifeDuration > ds.maxHalfLifeDuration) { revert StorageLib.HalfLifeAboveMaximum(); }
        ds.halfLifeDuration = _halfLifeDuration;
        emit HalfLifeParametersUpdated(ds.halfLifeDuration, ds.minHalfLifeDuration, ds.maxHalfLifeDuration);
    }

    function setMinHalfLifeDuration(uint256 _minHalfLifeDuration) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        if (_minHalfLifeDuration == 0) { revert StorageLib.MinHalfLifePositive(); }
        if (_minHalfLifeDuration > ds.maxHalfLifeDuration) { revert StorageLib.MinHalfLifeExceedsMax(); }
        ds.minHalfLifeDuration = _minHalfLifeDuration;
        if (ds.halfLifeDuration < ds.minHalfLifeDuration) {
            ds.halfLifeDuration = ds.minHalfLifeDuration; // Adjust current if it falls below new min
        }
        emit HalfLifeParametersUpdated(ds.halfLifeDuration, ds.minHalfLifeDuration, ds.maxHalfLifeDuration);
    }

    function setMaxHalfLifeDuration(uint256 _maxHalfLifeDuration) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        if (_maxHalfLifeDuration == 0) { revert StorageLib.MaxHalfLifePositive(); } // Max must be positive
        if (_maxHalfLifeDuration < ds.minHalfLifeDuration) { revert StorageLib.MaxHalfLifeBelowMinimum(); }
        ds.maxHalfLifeDuration = _maxHalfLifeDuration;
        if (ds.halfLifeDuration > ds.maxHalfLifeDuration) {
            ds.halfLifeDuration = ds.maxHalfLifeDuration; // Adjust current if it exceeds new max
        }
        emit HalfLifeParametersUpdated(ds.halfLifeDuration, ds.minHalfLifeDuration, ds.maxHalfLifeDuration);
    }

    function setInactivityResetPeriod(uint256 _inactivityResetPeriod) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        if (_inactivityResetPeriod == 0) { revert StorageLib.InactivityPeriodPositive(); }
        ds.inactivityResetPeriod = _inactivityResetPeriod;
        emit InactivityResetPeriodUpdated(_inactivityResetPeriod);
    }

    function setMinFeeWei(uint256 _minFeeWei) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        ds.minFeeWei = _minFeeWei;
        emit FeeParametersUpdated(ds.minFeeWei, ds.maxFeePercentBps, ds.baseRiskScalerBps, ds.maxRiskScalerBps);
    }

    function setMaxFeePercentBps(uint256 _maxFeePercentBps) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        // Add validation: e.g., maxFeePercentBps <= SOME_ABSOLUTE_MAX_BPS (like 10000 for 100%)
        ds.maxFeePercentBps = _maxFeePercentBps;
        emit FeeParametersUpdated(ds.minFeeWei, ds.maxFeePercentBps, ds.baseRiskScalerBps, ds.maxRiskScalerBps);
    }

    function setBaseRiskScalerBps(uint256 _baseRiskScalerBps) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        ds.baseRiskScalerBps = _baseRiskScalerBps;
        emit FeeParametersUpdated(ds.minFeeWei, ds.maxFeePercentBps, ds.baseRiskScalerBps, ds.maxRiskScalerBps);
    }

    function setMaxRiskScalerBps(uint256 _maxRiskScalerBps) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        ds.maxRiskScalerBps = _maxRiskScalerBps;
        emit FeeParametersUpdated(ds.minFeeWei, ds.maxFeePercentBps, ds.baseRiskScalerBps, ds.maxRiskScalerBps);
    }

    function setFeeTiers(
        uint256[] calldata _feeTierThresholds,
        uint256[] calldata _feeTierRatesBps
    ) external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        require(_feeTierThresholds.length == _feeTierRatesBps.length, "T3Admin: Fee tiers length mismatch");
        // Add validation: thresholds should be sorted, rates should be reasonable.
        ds.feeTierThresholds = _feeTierThresholds;
        ds.feeTierRatesBps = _feeTierRatesBps;
        emit FeeTiersUpdated(_feeTierThresholds, _feeTierRatesBps);
    }

    // View functions for admin to check parameters
    function getHalfLifeParameters() external view returns (uint256 current, uint256 min, uint256 max) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        return (ds.halfLifeDuration, ds.minHalfLifeDuration, ds.maxHalfLifeDuration);
    }

    function getFeeParameters() external view returns (uint256 minWei, uint256 maxBps, uint256 baseRiskBps, uint256 maxRiskBps) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        return (ds.minFeeWei, ds.maxFeePercentBps, ds.baseRiskScalerBps, ds.maxRiskScalerBps);
    }

    /**
     * @dev Get the current reentrancy mutex value for testing
     * @return The current mutex value (should be 1 when not entered)
     */
    function debugGetReentrancyMutex() external view returns (uint256) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        return ds._reentrancyMutex;
    }

     function getFeeTiers() external view returns (uint256[] memory thresholds, uint256[] memory ratesBps) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        return (ds.feeTierThresholds, ds.feeTierRatesBps);
    }

    function getTreasuryAddress() external view returns (address) {
         return StorageLib.diamondStorage().treasuryAddress; 
    }

}
