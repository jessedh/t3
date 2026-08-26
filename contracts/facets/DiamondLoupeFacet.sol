// contracts/facets/DiamondLoupeFacet.sol (Ensure it implements all 4 IDiamondLoupe functions)
// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { IDiamondLoupe } from "../interfaces/IDiamondLoupe.sol"; // This MUST be the standard 4-function version
contract DiamondLoupeFacet is IDiamondLoupe {
    using StorageLib for StorageLib.AppStorage;

    // Note: ERC165 interface support moved to unified ERC165Facet

    function facets() external view virtual override returns (Facet[] memory facets_) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        uint256 numFacets = ds._facetAddresses.length; // Assumes AppStorage._facetAddresses is populated correctly
        facets_ = new Facet[](numFacets);
        for (uint256 i = 0; i < numFacets; i++) {
            address currentFacetAddr = ds._facetAddresses[i];
            facets_[i].facetAddress = currentFacetAddr;
            facets_[i].functionSelectors = ds._facetFunctionSelectors[currentFacetAddr]; // Assumes AppStorage._facetFunctionSelectors is populated
        }
    }

    function facetFunctionSelectors(address _facet) external view virtual override returns (bytes4[] memory facetFunctionSelectors_) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        facetFunctionSelectors_ = ds._facetFunctionSelectors[_facet];
    }

    function facetAddress(bytes4 _functionSelector) external view virtual override returns (address facetAddress_) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        facetAddress_ = ds._selectors[_functionSelector]; // Assumes AppStorage._selectors is populated
    }

    // Implementation for the missing function
    function facetAddresses() external view virtual override returns (address[] memory facetAddresses_) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        facetAddresses_ = ds._facetAddresses; // Assumes AppStorage._facetAddresses holds the list of all facet addresses
    }
}