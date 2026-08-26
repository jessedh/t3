// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import { StorageLib } from "../lib/StorageLib.sol";
import { AccessControlFacet } from "./AccessControlFacet.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol"; // For nonReentrant modifier
import { RoleConstants } from "../lib/RoleConstants.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
contract ERC20PausableFacet is ReentrancyGuardBase { // Inherit for modifier
    using StorageLib for StorageLib.AppStorage;
    using EnumerableSet for EnumerableSet.AddressSet;
    
    event Paused(address account);
    event Unpaused(address account);
    modifier whenNotPaused() {
        if (StorageLib.diamondStorage()._paused) {
            revert("Pausable: paused");
        }
        _;
    }
    // Note: ERC165 interface support moved to unified ERC165Facet
    function paused() public view returns (bool) {
        return StorageLib.diamondStorage()._paused;
    }
    
    // Internal function to check role that doesn't rely on static call
    function _checkRole(bytes32 role, address account) internal view virtual {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[role].contains(account)) {
            revert StorageLib.UnauthorizedRole(account, role);
        }
    }
    
    function pause() external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _checkRole(RoleConstants.PAUSER_ROLE, msg.sender);
        if (ds._paused) {
            revert("Pausable: already paused");
        }
        ds._paused = true;
        emit Paused(msg.sender);
    }
    
    function unpause() external nonReentrant {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _checkRole(RoleConstants.PAUSER_ROLE, msg.sender);
        if (!ds._paused) {
            revert("Pausable: not paused");
        }
        ds._paused = false;
        emit Unpaused(msg.sender);
    }
}
