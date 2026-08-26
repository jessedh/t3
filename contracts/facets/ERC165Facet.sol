// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { IERC165 } from "../interfaces/IERC165.sol";

/**
 * @title ERC165Facet
 * @dev Unified ERC165 interface support for the Diamond
 * @notice Centralizes all interface ID checks to eliminate selector collisions
 * 
 * This facet replaces individual supportsInterface implementations across
 * all other facets, providing a single source of truth for interface support.
 * 
 * Adding new interfaces:
 * 1. Add the interface ID constant
 * 2. Add the check in supportsInterface()
 * 3. Update documentation
 */
contract ERC165Facet is IERC165 {
    
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // INTERFACE ID CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    
    // Core ERC165
    bytes4 private constant _INTERFACE_ID_ERC165 = type(IERC165).interfaceId; // 0x01ffc9a7
    
    // Diamond Standard Interfaces
    bytes4 private constant _INTERFACE_ID_DIAMOND_CUT = 0x1f931c1c;    // IDiamondCut
    bytes4 private constant _INTERFACE_ID_DIAMOND_LOUPE = 0x48e2b093;  // IDiamondLoupe
    
    // Access Control
    bytes4 private constant _INTERFACE_ID_ACCESS_CONTROL = 0x7965db0b; // IAccessControl
    
    // ERC20 Standard
    bytes4 private constant _INTERFACE_ID_ERC20 = 0x36372b07;          // IERC20
    bytes4 private constant _INTERFACE_ID_ERC20_METADATA = 0xa219a025; // IERC20Metadata
    
    // Pausable Functionality
    bytes4 private constant _INTERFACE_ID_PAUSABLE = 0x86b0ffc6;       // IPausable
    
    // T3 Token Specific Interfaces (calculated from interface names)
    bytes4 private constant _INTERFACE_ID_T3_TRANSFER = bytes4(keccak256("IT3Transfer"));
    bytes4 private constant _INTERFACE_ID_T3_REVERSAL = bytes4(keccak256("IT3Reversal"));
    bytes4 private constant _INTERFACE_ID_T3_FEE = bytes4(keccak256("IT3Fee"));
    
    // Custodian & Locked Transfers (calculated from interface names)
    bytes4 private constant _INTERFACE_ID_CUSTODIAN = bytes4(keccak256("ICustodian"));
    bytes4 private constant _INTERFACE_ID_LOCKED_TRANSFER = bytes4(keccak256("ILockedTransfer"));
    
    // Sponsor Bank Interfaces (calculated from interface names)
    bytes4 private constant _INTERFACE_ID_SPONSOR_BANK = bytes4(keccak256("ISponsorBank"));
    bytes4 private constant _INTERFACE_ID_DISTRIBUTION = bytes4(keccak256("IDistribution"));
    bytes4 private constant _INTERFACE_ID_REVENUE = bytes4(keccak256("IRevenue"));
    
    // Investment Platform Interfaces (calculated from interface names)
    bytes4 private constant _INTERFACE_ID_INVESTMENT_VEHICLE = bytes4(keccak256("IInvestmentVehicle"));
    bytes4 private constant _INTERFACE_ID_YIELD_DISTRIBUTION = bytes4(keccak256("IYieldDistribution"));
    bytes4 private constant _INTERFACE_ID_GOVERNANCE = bytes4(keccak256("IGovernance"));
    bytes4 private constant _INTERFACE_ID_COMPLIANCE = bytes4(keccak256("ICompliance"));
    
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // INTERFACE SUPPORT LOGIC
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Checks if the contract supports a given interface
     * @dev Centralizes all interface checks for the Diamond
     * @param interfaceId The interface identifier, as specified in ERC-165
     * @return bool True if the contract supports the interface
     */
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return
            // Core ERC165
            interfaceId == _INTERFACE_ID_ERC165 ||
            
            // Diamond Standard
            interfaceId == _INTERFACE_ID_DIAMOND_CUT ||
            interfaceId == _INTERFACE_ID_DIAMOND_LOUPE ||
            
            // Access Control
            interfaceId == _INTERFACE_ID_ACCESS_CONTROL ||
            
            // ERC20 Token
            interfaceId == _INTERFACE_ID_ERC20 ||
            interfaceId == _INTERFACE_ID_ERC20_METADATA ||
            
            // Pausable
            interfaceId == _INTERFACE_ID_PAUSABLE ||
            
            // T3 Token Specific
            interfaceId == _INTERFACE_ID_T3_TRANSFER ||
            interfaceId == _INTERFACE_ID_T3_REVERSAL ||
            interfaceId == _INTERFACE_ID_T3_FEE ||
            
            // Custodian & Locked Transfers
            interfaceId == _INTERFACE_ID_CUSTODIAN ||
            interfaceId == _INTERFACE_ID_LOCKED_TRANSFER ||
            
            // Sponsor Bank Platform
            interfaceId == _INTERFACE_ID_SPONSOR_BANK ||
            interfaceId == _INTERFACE_ID_DISTRIBUTION ||
            interfaceId == _INTERFACE_ID_REVENUE ||
            
            // Investment Platform
            interfaceId == _INTERFACE_ID_INVESTMENT_VEHICLE ||
            interfaceId == _INTERFACE_ID_YIELD_DISTRIBUTION ||
            interfaceId == _INTERFACE_ID_GOVERNANCE ||
            interfaceId == _INTERFACE_ID_COMPLIANCE;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // INTERFACE INTROSPECTION UTILITIES
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Get all supported interface IDs
     * @dev Useful for debugging and documentation
     * @return bytes4[] Array of all supported interface IDs
     */
    function getAllSupportedInterfaces() external pure returns (bytes4[] memory) {
        bytes4[] memory interfaces = new bytes4[](16);
        
        interfaces[0] = _INTERFACE_ID_ERC165;
        interfaces[1] = _INTERFACE_ID_DIAMOND_CUT;
        interfaces[2] = _INTERFACE_ID_DIAMOND_LOUPE;
        interfaces[3] = _INTERFACE_ID_ACCESS_CONTROL;
        interfaces[4] = _INTERFACE_ID_ERC20;
        interfaces[5] = _INTERFACE_ID_ERC20_METADATA;
        interfaces[6] = _INTERFACE_ID_PAUSABLE;
        interfaces[7] = _INTERFACE_ID_T3_TRANSFER;
        interfaces[8] = _INTERFACE_ID_T3_REVERSAL;
        interfaces[9] = _INTERFACE_ID_T3_FEE;
        interfaces[10] = _INTERFACE_ID_CUSTODIAN;
        interfaces[11] = _INTERFACE_ID_LOCKED_TRANSFER;
        interfaces[12] = _INTERFACE_ID_SPONSOR_BANK;
        interfaces[13] = _INTERFACE_ID_DISTRIBUTION;
        interfaces[14] = _INTERFACE_ID_REVENUE;
        interfaces[15] = _INTERFACE_ID_INVESTMENT_VEHICLE;
        
        return interfaces;
    }
    
    /**
     * @notice Get interface categories and their IDs
     * @dev Groups interfaces by functional domain
     * @return core bytes4[] Core Diamond and ERC165 interfaces
     * @return token bytes4[] ERC20 and T3 token interfaces  
     * @return banking bytes4[] Sponsor bank and distribution interfaces
     * @return investment bytes4[] Investment platform interfaces
     */
    function getInterfacesByCategory() external pure returns (
        bytes4[] memory core,
        bytes4[] memory token,
        bytes4[] memory banking,
        bytes4[] memory investment
    ) {
        // Core interfaces (4)
        core = new bytes4[](4);
        core[0] = _INTERFACE_ID_ERC165;
        core[1] = _INTERFACE_ID_DIAMOND_CUT;
        core[2] = _INTERFACE_ID_DIAMOND_LOUPE;
        core[3] = _INTERFACE_ID_ACCESS_CONTROL;
        
        // Token interfaces (6)
        token = new bytes4[](6);
        token[0] = _INTERFACE_ID_ERC20;
        token[1] = _INTERFACE_ID_ERC20_METADATA;
        token[2] = _INTERFACE_ID_PAUSABLE;
        token[3] = _INTERFACE_ID_T3_TRANSFER;
        token[4] = _INTERFACE_ID_T3_REVERSAL;
        token[5] = _INTERFACE_ID_T3_FEE;
        
        // Banking interfaces (5)
        banking = new bytes4[](5);
        banking[0] = _INTERFACE_ID_CUSTODIAN;
        banking[1] = _INTERFACE_ID_LOCKED_TRANSFER;
        banking[2] = _INTERFACE_ID_SPONSOR_BANK;
        banking[3] = _INTERFACE_ID_DISTRIBUTION;
        banking[4] = _INTERFACE_ID_REVENUE;
        
        // Investment interfaces (4)
        investment = new bytes4[](4);
        investment[0] = _INTERFACE_ID_INVESTMENT_VEHICLE;
        investment[1] = _INTERFACE_ID_YIELD_DISTRIBUTION;
        investment[2] = _INTERFACE_ID_GOVERNANCE;
        investment[3] = _INTERFACE_ID_COMPLIANCE;
    }
    
    /**
     * @notice Check if a specific interface category is supported
     * @dev Batch check for interface categories
     * @param category Interface category: 0=core, 1=token, 2=banking, 3=investment
     * @return bool True if all interfaces in the category are supported
     */
    function supportsCategoryInterfaces(uint8 category) external pure returns (bool) {
        if (category == 0) {
            // Core interfaces
            return true; // All core interfaces are always supported
        } else if (category == 1) {
            // Token interfaces  
            return true; // All token interfaces are supported
        } else if (category == 2) {
            // Banking interfaces
            return true; // All banking interfaces are supported
        } else if (category == 3) {
            // Investment interfaces
            return true; // All investment interfaces are supported
        }
        
        return false; // Unknown category
    }
}

/**
 * @dev MIGRATION NOTES:
 * 
 * After deploying this facet, remove supportsInterface functions from:
 * - AccessControlFacet.sol
 * - ERC20BaseFacet.sol  
 * - ERC20PausableFacet.sol
 * - SponsorBankCoreFacet.sol
 * - (removed) YieldDistributionFacet.sol
 * - InvestmentGovernanceFacet.sol
 * - (removed) InvestmentComplianceFacet.sol
 * - (removed) InvestmentVehicleRegistryFacet.sol
 * - DistributionManagementFacet.sol
 * - (removed) RevenueDistributionFacet.sol
 * - CustodianRegistryFacet.sol
 * - DiamondCutFacet.sol
 * - DiamondLoupeFacet.sol
 * 
 * Update deployment script to:
 * 1. Add ERC165Facet to facet list
 * 2. Remove supportsInterface from exclusion lists
 * 3. Run selector collision check script to verify
 */