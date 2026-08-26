// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @dev Mock facet that replaces the public hasRole selector with an
 * always-false implementation. Used to prove that DiamondCutFacet
 * authorization does not depend on the external hasRole selector.
 */
contract MockAlwaysFalseHasRoleFacet {
    function hasRole(bytes32 /*role*/, address /*account*/) external pure returns (bool) {
        return false;
    }
}
