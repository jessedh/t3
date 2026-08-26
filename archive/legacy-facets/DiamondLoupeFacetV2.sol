// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { IDiamondLoupe } from "../interfaces/IDiamondLoupe.sol";

/**
 * @title DiamondLoupeFacetV2
 * @dev Same selector set as EIP-2535 Loupe, but filters out facet addresses
 *      that currently have 0 function selectors to avoid placeholder entries.
 */
contract DiamondLoupeFacetV2 is IDiamondLoupe {
    using StorageLib for StorageLib.AppStorage;

    function facets() external view override returns (Facet[] memory facets_) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        address[] storage addrs = ds._facetAddresses;

        // Count non-empty facets first
        uint256 count = 0;
        for (uint256 i = 0; i < addrs.length; i++) {
            if (ds._facetFunctionSelectors[addrs[i]].length > 0) {
                count++;
            }
        }

        facets_ = new Facet[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < addrs.length; i++) {
            address a = addrs[i];
            bytes4[] storage sels = ds._facetFunctionSelectors[a];
            if (sels.length == 0) continue;
            facets_[j].facetAddress = a;
            facets_[j].functionSelectors = sels;
            j++;
        }
    }

    function facetFunctionSelectors(address _facet) external view override returns (bytes4[] memory facetFunctionSelectors_) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        facetFunctionSelectors_ = ds._facetFunctionSelectors[_facet];
    }

    function facetAddress(bytes4 _functionSelector) external view override returns (address facetAddress_) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        facetAddress_ = ds._selectors[_functionSelector];
    }

    function facetAddresses() external view override returns (address[] memory facetAddresses_) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        address[] storage addrs = ds._facetAddresses;

        // Count non-empty facets first
        uint256 count = 0;
        for (uint256 i = 0; i < addrs.length; i++) {
            if (ds._facetFunctionSelectors[addrs[i]].length > 0) {
                count++;
            }
        }

        facetAddresses_ = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < addrs.length; i++) {
            address a = addrs[i];
            if (ds._facetFunctionSelectors[a].length == 0) continue;
            facetAddresses_[j++] = a;
        }
    }
}

