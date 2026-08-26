// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IAccessControl }  from "../interfaces/IAccessControl.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";

contract AccessControlFacet {
    
    /**
     * @notice Extracts the original sender from meta-transaction or returns msg.sender
     * @dev This is the core ERC-2771 functionality. When called via trusted forwarder,
     * the original sender is extracted from the last 20 bytes of calldata.
     * @return sender The original transaction sender
     */
    function _msgSender() internal view returns (address sender) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (ds.trustedForwarder != address(0) && msg.sender == ds.trustedForwarder && msg.data.length >= 20) {
            // Extract sender from the last 20 bytes of calldata (ERC-2771 standard)
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }
    using EnumerableSet for EnumerableSet.AddressSet;

        // --- Role Definitions ---
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 public constant CONSORTIUM_MEMBER_ROLE = keccak256("CONSORTIUM_MEMBER_ROLE");
    bytes32 public constant BANK_REPRESENTATIVE_ROLE = keccak256("BANK_REPRESENTATIVE_ROLE");
    bytes32 public constant EMERGENCY_COORDINATOR_ROLE = keccak256("EMERGENCY_COORDINATOR_ROLE");
    bytes32 public constant ORACLE_ATTESTOR_ROLE = keccak256("ORACLE_ATTESTOR_ROLE");
    bytes32 public constant CONSORTIUM_AUDITOR_ROLE = keccak256("CONSORTIUM_AUDITOR_ROLE");
    bytes32 public constant DEPOSIT_TOKEN_ISSUER_ROLE = keccak256("DEPOSIT_TOKEN_ISSUER_ROLE");
    bytes32 public constant FEE_EXEMPT_ROLE = keccak256("FEE_EXEMPT_ROLE");
    
    // --- Events ---
    // Events are defined in AccessControlLib to avoid duplicates across facets
    // event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    // event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole); // Optional: For OpenZeppelin compatibility if extending admin hierarchy

    // Note: ERC165 interface support moved to unified ERC165Facet

    // --- Role Inspection ---
    function hasRole(bytes32 role, address account) public view returns (bool) {
        return AccessControlLib.hasRole(StorageLib.diamondStorage(), role, account);
    }

    function getRoleAdmin(bytes32 role) public pure returns (bytes32) {
        // Simple flat hierarchy: DEFAULT_ADMIN_ROLE manages all other roles.
        // DEFAULT_ADMIN_ROLE is its own admin.
        if (role == DEFAULT_ADMIN_ROLE) {
             return DEFAULT_ADMIN_ROLE;
        }
        return DEFAULT_ADMIN_ROLE;
    }

    // --- Role Management ---
    function grantRole(bytes32 role, address account) external {
        AccessControlLib.requireRoleAdmin(StorageLib.diamondStorage(), role, _msgSender());
        AccessControlLib.grantRole(StorageLib.diamondStorage(), role, account);
    }

    function revokeRole(bytes32 role, address account) external {
        AccessControlLib.requireRoleAdmin(StorageLib.diamondStorage(), role, _msgSender());
        AccessControlLib.revokeRole(StorageLib.diamondStorage(), role, account);
    }

    function renounceRole(bytes32 role, address account) external {
        require(account == _msgSender(), "AccessControl: can only renounce roles for self");
        AccessControlLib.revokeRole(StorageLib.diamondStorage(), role, account);
    }

    // --- Static Internal Functions (Callable by other facets/DiamondInit) ---
    
    /**
     * @dev Legacy wrapper for backward compatibility - use AccessControlLib.grantRole directly
     */
    function internal_grantRole(StorageLib.AppStorage storage ds, bytes32 role, address account) internal {
        AccessControlLib.grantRole(ds, role, account);
    }

    /**
     * @dev Legacy wrapper for backward compatibility - use AccessControlLib.revokeRole directly
     */
    function internal_revokeRole(StorageLib.AppStorage storage ds, bytes32 role, address account) internal {
        AccessControlLib.revokeRole(ds, role, account);
    }

    /**
     * @dev Legacy wrapper for backward compatibility - use AccessControlLib.requireRole directly
     */
     function static_checkRole(StorageLib.AppStorage storage ds, bytes32 role, address account) internal view {
        AccessControlLib.requireRole(ds, role, account);
    }
}
