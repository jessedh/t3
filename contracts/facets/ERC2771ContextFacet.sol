// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title ERC2771ContextFacet
 * @notice Provides ERC-2771 meta-transaction context for the T3Token Diamond
 * @dev This facet enables gasless transactions by extracting the original sender
 * from trusted forwarder calls.
 *
 * Sender-derivation posture across facets (K-F12): NOT every facet should use
 * _msgSender(). The tiered rule is:
 *   - User-initiated value/consent actions (transfers, approve, envelope-note
 *     redeem, travel-rule staging, role grant/revoke) — use _msgSender() so
 *     relayed calls bind to the original signer.
 *   - Role-gated institutional mutations (screening, issuance, mint/burn,
 *     envelope admin) — raw msg.sender by design; the forwarder holds no
 *     roles, so relayed calls fail closed at the role gate.
 *   - Envelope-family lifecycle (TransferEnvelope, SmartLockEnvelope,
 *     EnvelopeInheritance) — raw msg.sender; escrow pulls from the caller's
 *     balance, so alignment is a semantic change deferred to its own design.
 *   - WalletRecoveryFacet — raw msg.sender as a deliberate security posture;
 *     recovery must never be reachable through a forwarder.
 * Full audit completed 2026-07-05 under finding K-F12.
 */
contract ERC2771ContextFacet {
    using EnumerableSet for EnumerableSet.AddressSet;
    
    /**
     * @notice Sets the trusted forwarder address
     * @dev Only callable by admin during initialization or upgrades
     * @param forwarder Address of the trusted forwarder contract
     */
    function setTrustedForwarder(address forwarder) external {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        // Check admin role - use direct storage access since this might be called during init
        require(ds._roles[bytes32(0)].contains(msg.sender), "ERC2771: Only admin can set forwarder");
        ds.trustedForwarder = forwarder;
    }
    
    /**
     * @notice Gets the current trusted forwarder address
     * @return The address of the trusted forwarder
     */
    function getTrustedForwarder() external view returns (address) {
        return StorageLib.diamondStorage().trustedForwarder;
    }
    
    /**
     * @notice Checks if an address is the trusted forwarder
     * @param forwarder Address to check
     * @return True if the address is the trusted forwarder
     */
    function isTrustedForwarder(address forwarder) public view returns (bool) {
        return StorageLib.diamondStorage().trustedForwarder == forwarder;
    }
    
    /**
     * @notice Extracts the original sender from meta-transaction or returns msg.sender
     * @dev This is the core ERC-2771 functionality. When called via trusted forwarder,
     * the original sender is extracted from the last 20 bytes of calldata.
     * @return sender The original transaction sender
     */
    function _msgSender() internal view returns (address sender) {
        if (isTrustedForwarder(msg.sender) && msg.data.length >= 20) {
            // Extract sender from the last 20 bytes of calldata (ERC-2771 standard)
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }
    
    /**
     * @notice Returns the msg.data for the current call, adjusted for meta-transactions
     * @dev When called via trusted forwarder, removes the appended sender address
     * @return The original calldata without the appended sender
     */
    function _msgData() internal view returns (bytes calldata) {
        if (isTrustedForwarder(msg.sender) && msg.data.length >= 20) {
            return msg.data[:msg.data.length - 20];
        } else {
            return msg.data;
        }
    }
    
    /**
     * @notice Public accessor for _msgSender() for use by other facets
     * @dev Other facets can call this via delegatecall to get the correct sender
     * @return The original transaction sender
     */
    function msgSender() external view returns (address) {
        return _msgSender();
    }
}
