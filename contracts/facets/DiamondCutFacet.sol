// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { IDiamondCut } from "../interfaces/IDiamondCut.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
contract DiamondCutFacet is IDiamondCut {
    using StorageLib for StorageLib.AppStorage;

    // SECURITY: diamondCut intentionally does NOT support ERC-2771 meta-transactions.
    // Upgrade operations must be authorized by the directly-signing admin EOA/multisig,
    // never a relayed (forwarder-supplied) sender, so it uses bare msg.sender.

    // Note: ERC165 interface support moved to unified ERC165Facet

    function diamondCut(
        FacetCut[] calldata _diamondCut,
        address _init,
        bytes calldata _calldata
    ) external virtual override {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Authorize every cut through internal storage-backed roles.
        // Selector presence/absence MUST NOT influence authorization.
        if (!AccessControlLib.hasRole(ds, RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.DEFAULT_ADMIN_ROLE);
        }

        for (uint256 i = 0; i < _diamondCut.length; i++) {
            FacetCutAction action = _diamondCut[i].action;
            address currentfacetAddress = _diamondCut[i].facetAddress;
            bytes4[] calldata functionSelectors = _diamondCut[i].functionSelectors;

            if (action == FacetCutAction.Add) {
                _addFunctions(ds, currentfacetAddress, functionSelectors);
            } else if (action == FacetCutAction.Replace) {
                _replaceFunctions(ds, currentfacetAddress, functionSelectors);
            } else if (action == FacetCutAction.Remove) {
                _removeFunctions(ds, functionSelectors); // Facet address is ignored for remove per EIP-2535
            } else {
                revert("DiamondCut: Invalid FacetCutAction");
            }
        }

        _initializeDiamondCut(ds, _init, _calldata);
        emit DiamondCut(_diamondCut, _init, _calldata);
    }

    function _addFunctions(StorageLib.AppStorage storage ds, address _facetAddress, bytes4[] calldata _functionSelectors) internal {
        require(_facetAddress != address(0), "DiamondCut: Add facet address cannot be zero");
        for (uint256 i = 0; i < _functionSelectors.length; i++) {
            bytes4 selector = _functionSelectors[i];
            require(ds._selectors[selector] == address(0), "DiamondCut: Function selector already exists");
            ds._selectors[selector] = _facetAddress;
        }
        // Add to facetAddresses list if not already there (for Loupe)
        bool found = false;
        for(uint j=0; j < ds._facetAddresses.length; j++){
            if(ds._facetAddresses[j] == _facetAddress){
                found = true;
                break;
            }
        }
        if(!found){
            ds._facetAddresses.push(_facetAddress);
        }
        // Add selectors to facet's list (for Loupe)
        for (uint256 i = 0; i < _functionSelectors.length; i++) {
            ds._facetFunctionSelectors[_facetAddress].push(_functionSelectors[i]);
        }
    }

    function _replaceFunctions(StorageLib.AppStorage storage ds, address _facetAddress, bytes4[] calldata _functionSelectors) internal {
        require(_facetAddress != address(0), "DiamondCut: Replace facet address cannot be zero");
        for (uint256 i = 0; i < _functionSelectors.length; i++) {
            bytes4 selector = _functionSelectors[i];
            address oldFacetAddress = ds._selectors[selector];
            require(oldFacetAddress != address(0), "DiamondCut: Function selector does not exist");
            require(oldFacetAddress != _facetAddress, "DiamondCut: Cannot replace with the same facet address");

            // Remove selector from old facet's list (for Loupe)
            _removeSelectorFromFacetList(ds._facetFunctionSelectors[oldFacetAddress], selector);

            ds._selectors[selector] = _facetAddress;

            // Add selector to new facet's list (for Loupe)
            ds._facetFunctionSelectors[_facetAddress].push(selector);
        }
         // Add to facetAddresses list if not already there (for Loupe)
        bool found = false;
        for(uint j=0; j < ds._facetAddresses.length; j++){
            if(ds._facetAddresses[j] == _facetAddress){
                found = true;
                break;
            }
        }
        if(!found){
            ds._facetAddresses.push(_facetAddress);
        }
    }

    function _removeFunctions(StorageLib.AppStorage storage ds, bytes4[] calldata _functionSelectors) internal {
        // L-2: Prevent removal of the diamondCut selector itself (would brick upgrades)
        bytes4 diamondCutSelector = bytes4(keccak256("diamondCut((address,uint8,bytes4[])[],address,bytes)"));
        for (uint256 i = 0; i < _functionSelectors.length; i++) {
            bytes4 selector = _functionSelectors[i];
            require(selector != diamondCutSelector, "DiamondCut: Cannot remove diamondCut selector");
            address oldFacetAddress = ds._selectors[selector];
            require(oldFacetAddress != address(0), "DiamondCut: Function selector does not exist");

            // Remove selector from old facet's list (for Loupe)
            _removeSelectorFromFacetList(ds._facetFunctionSelectors[oldFacetAddress], selector);
            // If facet has no more selectors, remove it from _facetAddresses (for Loupe)
            if (ds._facetFunctionSelectors[oldFacetAddress].length == 0) {
                _removeAddressFromFacetAddressList(ds, oldFacetAddress);
            }
            delete ds._selectors[selector];
        }
    }

    function _removeSelectorFromFacetList(bytes4[] storage _selectorsList, bytes4 _selector) private {
        uint256 length = _selectorsList.length;
        for (uint256 i = 0; i < length; i++) {
            if (_selectorsList[i] == _selector) {
                _selectorsList[i] = _selectorsList[length - 1];
                _selectorsList.pop();
                return;
            }
        }
    }

    function _removeAddressFromFacetAddressList(StorageLib.AppStorage storage ds, address _facetAddress) private {
        uint256 length = ds._facetAddresses.length;
        for (uint256 i = 0; i < length; i++) {
            if (ds._facetAddresses[i] == _facetAddress) {
                ds._facetAddresses[i] = ds._facetAddresses[length - 1];
                ds._facetAddresses.pop();
                return;
            }
        }
    }

    function _initializeDiamondCut(StorageLib.AppStorage storage ds, address _init, bytes calldata _calldata) internal {
        if (_init != address(0)) {
            // ds pointer is not used here as _init is an external call via delegatecall
            (bool success, bytes memory returnData) = _init.delegatecall(_calldata);
            if (!success) {
                if (returnData.length > 0) {
                    assembly {
                        revert(add(returnData, 32), mload(returnData))
                    }
                } else {
                    revert("DiamondCut: Initialization failed");
                }
            }
        }
    }
}