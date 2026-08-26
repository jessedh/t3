// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @dev Interface of the ERC165 standard, as defined in the [cite: 231]
 * https://eips.ethereum.org/EIPS/eip-165[EIP]. [cite: 231]
 *
 * Implementers of this interface must also implement `supportsInterface` [cite: 232]
 * (see the [IERC165](https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.x/contracts/utils/introspection/IERC165.sol) [cite: 232]
 * contract for the actual interface signature). [cite: 233]
 */
interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by [cite: 233]
     * `interfaceId`. See the corresponding [cite: 234]
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[EIP section] [cite: 234]
     * to learn more about how these ids are created. [cite: 235]
     *
     * This function calls `_supportsInterface` with the given `interfaceId`. [cite: 236]
     * `_supportsInterface` is a virtual function in `ERC165` that must be [cite: 236]
     * overridden by inheriting contracts. [cite: 237]
     *
     * @param interfaceId The interface identifier, as specified in ERC-165. [cite: 238]
     * @return True if the contract implements the interface, false otherwise. [cite: 239]
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool); // [cite: 240]
}
