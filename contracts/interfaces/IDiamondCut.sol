// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IDiamondCut {
    enum FacetCutAction { Add, Replace, Remove } // [cite: 215]

    struct FacetCut { // [cite: 215]
        address facetAddress; // [cite: 215]
        FacetCutAction action; // [cite: 215]
        bytes4[] functionSelectors; // [cite: 215]
    }

    /**
     * @dev Add/replace/remove functions to/from a diamond. [cite: 216]
     * @param _diamondCut Contains the facet addresses and function selectors. [cite: 216]
     * @param _init The address of the contract or facet to run an `init` function on. [cite: 217]
     * @param _calldata The calldata to send to the `init` contract/facet. [cite: 218]
     */
    function diamondCut(
        FacetCut[] calldata _diamondCut,
        address _init,
        bytes calldata _calldata
    ) external; // [cite: 219]

    event DiamondCut(FacetCut[] _diamondCut, address _init, bytes _calldata); // [cite: 220]
}
