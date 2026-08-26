// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

// Diamond interfaces are implemented by facets, not by the proxy itself
import { StorageLib } from "./lib/StorageLib.sol";
import { AccessControlLib } from "./lib/AccessControlLib.sol";
import { RoleConstants } from "./lib/RoleConstants.sol";

/**
 * @title Diamond
 * @dev The core Diamond proxy contract.
 * It forwards all calls to the appropriate facet
 * based on the function selector.
 * It does not contain any business logic itself.
 */
contract Diamond {
    // Note: Function selectors and facet mappings are now stored in StorageLib.AppStorage
    // to ensure consistency with DiamondCutFacet operations
    /**
     * @dev Constructor initializes the diamond with DiamondCut facet
     * @param _contractOwner The owner of the diamond contract
     * @param _diamondCutFacet The address of the DiamondCut facet
     */
    constructor(address _contractOwner, address _diamondCutFacet) {
        require(_contractOwner != address(0), "Diamond: owner cannot be zero address");
        require(_diamondCutFacet != address(0), "Diamond: diamondCut facet cannot be zero address");

        // Store contract owner for bootstrap authorization
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ds.contractOwner = _contractOwner;

        // Grant DEFAULT_ADMIN_ROLE to contract owner to ensure access when AccessControlFacet is added
        AccessControlLib.grantRole(ds, RoleConstants.DEFAULT_ADMIN_ROLE, _contractOwner);
        
        // Add DiamondCut facet selectors
        bytes4[] memory diamondCutSelectors = new bytes4[](1);
        diamondCutSelectors[0] = 0x1f931c1c; // diamondCut(FacetCut[],address,bytes)
        
        // Add DiamondCut facet to the diamond
        _addFunctions(_diamondCutFacet, diamondCutSelectors);
    }

    // The fallback function is executed when a call is made to the Diamond
    // and no other function matches the given selector.
    // It handles the delegatecall to the appropriate facet.
    fallback() external payable {
        _delegate();
    }

    // The receive function is executed when the Diamond receives plain Ether
    // without any data.
    // It's required to accept ETH transfers.
    receive() external payable {}

    /**
     * @dev Internal function to delegate the current call to the appropriate facet.
     * This is the core of the Diamond pattern's delegation mechanism.
     */
    function _delegate() internal {
        // Get the function selector from the calldata
        bytes4 selector = bytes4(msg.data[:4]);
        // Get the facet address for this selector from shared storage
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        address facet = ds._selectors[selector];
        // If no facet is found for this selector, revert
        if (facet == address(0)) {
            revert StorageLib.FunctionDoesNotExist(selector);
        }
        
        // Delegate the call to the facet
        assembly {
            // Copy calldata to memory
            calldatacopy(0, 0, calldatasize())
            
            // Delegate call to the facet
            let result := delegatecall(gas(), facet, 0, calldatasize(), 0, 0)
            
            // Copy the returned data
            returndatacopy(0, 0, returndatasize())
            
            // If the delegatecall failed, revert with the returned error message
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    // Note: diamondCut functionality is implemented in DiamondCutFacet
    // This Diamond contract only provides the proxy delegation mechanism
    // The diamondCut function is added to this diamond via the DiamondCutFacet
    
    /**
     * @dev Internal function to add functions to the diamond.
     * @param _newFacetAddress The address of the facet to add functions from.
     * @param _functionSelectors The function selectors to add.
     */
    function _addFunctions(address _newFacetAddress, bytes4[] memory _functionSelectors) internal {
        require(_newFacetAddress != address(0), "Diamond: facet address cannot be 0");
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Add the facet address to _facetAddresses if it's not already there
        if (!ds._isFacet[_newFacetAddress]) {
            ds._facetAddresses.push(_newFacetAddress);
            ds._isFacet[_newFacetAddress] = true;
        }
        
        for (uint256 i = 0; i < _functionSelectors.length; i++) {
            bytes4 selector = _functionSelectors[i];
            // Check that the selector doesn't already exist
            require(ds._selectors[selector] == address(0), "Diamond: function already exists");
            // Add the selector to the facet
            ds._selectors[selector] = _newFacetAddress;
            ds._facetFunctionSelectors[_newFacetAddress].push(selector);
        }
    }
    
    /**
     * @dev Internal function to replace functions in the diamond.
     * @param _newFacetAddress The address of the facet to replace functions with.
     * @param _functionSelectors The function selectors to replace.
     */
    function _replaceFunctions(address _newFacetAddress, bytes4[] memory _functionSelectors) internal {
        require(_newFacetAddress != address(0), "Diamond: facet address cannot be 0");
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Add the facet address to _facetAddresses if it's not already there
        if (!ds._isFacet[_newFacetAddress]) {
            ds._facetAddresses.push(_newFacetAddress);
            ds._isFacet[_newFacetAddress] = true;
        }
        
        for (uint256 i = 0; i < _functionSelectors.length; i++) {
            bytes4 selector = _functionSelectors[i];
            // Check that the selector exists
            address oldFacetAddress = ds._selectors[selector];
            require(oldFacetAddress != address(0), "Diamond: function doesn't exist");
            
            // Check that the selector is not being replaced with the same facet
            require(oldFacetAddress != _newFacetAddress, "Diamond: cannot replace function with same facet");
            // Remove the selector from the old facet
            _removeSelectorFromFacet(oldFacetAddress, selector);
            // Add the selector to the new facet
            ds._selectors[selector] = _newFacetAddress;
            ds._facetFunctionSelectors[_newFacetAddress].push(selector);
        }
    }
    
    /**
     * @dev Internal function to remove functions from the diamond.
     * @param _functionSelectors The function selectors to remove.
     */
    function _removeFunctions(address /*_facetAddressContext*/, bytes4[] memory _functionSelectors) internal {
        // _facetAddressContext is not used here directly for deleting from _selectors,
        // but passed from diamondCut. The actual facet owning the selector is looked up.
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        for (uint256 i = 0; i < _functionSelectors.length; i++) {
            bytes4 selector = _functionSelectors[i];
            address owningFacetAddr = ds._selectors[selector]; // Changed variable name
            require(owningFacetAddr != address(0), "Diamond: function doesn't exist"); 
            
            _removeSelectorFromFacet(owningFacetAddr, selector); 
            delete ds._selectors[selector];
        }
    }
    
    /**
     * @dev Internal function to remove a selector from a facet's list of selectors.
     * @param _facetAddr The address of the facet to remove the selector from.
     * @param _selector The selector to remove.
     */
    function _removeSelectorFromFacet(address _facetAddr, bytes4 _selector) internal {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        bytes4[] storage selectorsList = ds._facetFunctionSelectors[_facetAddr];
        uint256 selectorIndex = type(uint256).max; // Sentinel value

        for (uint256 i = 0; i < selectorsList.length; i++) {
            if (selectorsList[i] == _selector) {
                selectorIndex = i;
                break;
            }
        }
        
        if (selectorIndex != type(uint256).max) { // If found
            selectorsList[selectorIndex] = selectorsList[selectorsList.length - 1];
            selectorsList.pop();
            
            // If this facet no longer has any selectors, remove it from _facetAddresses
            if (selectorsList.length == 0) {
                ds._isFacet[_facetAddr] = false;
                uint256 facetIdxToRemove = type(uint256).max; // Sentinel value
                for (uint256 i = 0; i < ds._facetAddresses.length; i++) {
                    if (ds._facetAddresses[i] == _facetAddr) {
                        facetIdxToRemove = i;
                        break;
                    }
                }
                if (facetIdxToRemove != type(uint256).max) { // If found
                    ds._facetAddresses[facetIdxToRemove] = ds._facetAddresses[ds._facetAddresses.length - 1];
                    ds._facetAddresses.pop();
                }
            }
        }
    }
    
    /**
     * @dev Internal function to initialize the diamond cut.
     * @param _init The address of the contract or facet to run an initialization function on.
     * @param _calldata The calldata to send to the _init contract/facet.
     */
    function _initializeDiamondCut(address _init, bytes calldata _calldata) internal {
        // According to EIP-2535, _init can be address(0) if no init function is called.
        // The EIP also states: "_init The address of the contract that has the init function to call. 
        // Set to address(0) if no init function is called."
        // So, we only proceed if _init is not address(0).
        if (_init != address(0)) {
            // The original code had a check for _calldata.length > 0 which is not strictly necessary
            // as an init function might not require calldata.
            // The EIP implies that if _init is set, a call should be attempted.
            // We still need to ensure _init has code if we are to call it.
            require(_init.code.length > 0, "Diamond: _init address has no code");

            (bool success, bytes memory error) = _init.delegatecall(_calldata);
            if (!success) {
                if (error.length > 0) {
                    assembly {
                        revert(add(32, error), mload(error))
                    }
                } else {
                    revert("Diamond: initialization function reverted");
                }
            }
        }
    }

    // Note: IDiamondLoupe functionality is implemented in DiamondLoupeFacet
    // This Diamond contract only provides the proxy delegation mechanism
}
