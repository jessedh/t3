// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { RelayerFallbackStorage } from "../lib/RelayerFallbackStorage.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";

/**
 * @title RelayerFallbackFacet
 * @notice Relayer fallback declaration system for Besu consortium (FR-ADR003-BESU).
 *
 * @dev Two-tier access model:
 *      - Tier 1 (normal): Banks submit transactions via the T3 relayer API.
 *      - Tier 2 (fallback): Banks declare a temporary outage and submit directly
 *        to the Besu JSON-RPC node. The Besu plugin calls isFallbackActive() via
 *        eth_call before forwarding eth_sendRawTransaction.
 *
 *      Declarations auto-expire after defaultFallbackWindow (default 4 hours).
 *      Banks self-revoke when the relayer recovers. Admins can force-revoke.
 *
 *      Authorization:
 *      - declareRelayerFallback / revokeOwnFallback: requires CUSTODIAN_ROLE
 *      - extendFallbackDeclaration / revokeFallbackDeclaration /
 *        setDefaultFallbackWindow: requires ADMIN_ROLE
 */
contract RelayerFallbackFacet {
    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event RelayerFallbackDeclared(address indexed bank, bytes32 reasonHash, uint40 expiresAt);
    event RelayerFallbackExtended(address indexed bank, uint40 newExpiry, address indexed extendedBy);
    event RelayerFallbackRevoked(address indexed bank, address revokedBy);
    event DefaultFallbackWindowUpdated(uint40 newWindow);

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------

    error NotFallbackActive();
    error InvalidDuration();
    error NotCustodian();
    error NotAdmin();

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyCustodian() {
        if (!IAccessControl(address(this)).hasRole(RoleConstants.CUSTODIAN_ROLE, msg.sender)) {
            revert NotCustodian();
        }
        _;
    }

    modifier onlyAdmin() {
        if (!IAccessControl(address(this)).hasRole(RoleConstants.ADMIN_ROLE, msg.sender)) {
            revert NotAdmin();
        }
        _;
    }

    // -------------------------------------------------------------------------
    // Bank self-service
    // -------------------------------------------------------------------------

    function declareRelayerFallback(bytes32 reasonHash) external onlyCustodian {
        RelayerFallbackStorage.Layout storage s = RelayerFallbackStorage.layout();
        uint40 activatedAt = uint40(block.timestamp);
        uint40 expiresAt = activatedAt + _defaultFallbackWindow(s);
        s.declarations[msg.sender] = RelayerFallbackStorage.FallbackDeclaration({
            activatedAt: activatedAt,
            expiresAt: expiresAt
        });
        emit RelayerFallbackDeclared(msg.sender, reasonHash, expiresAt);
    }

    function revokeOwnFallback() external onlyCustodian {
        RelayerFallbackStorage.Layout storage s = RelayerFallbackStorage.layout();
        delete s.declarations[msg.sender];
        emit RelayerFallbackRevoked(msg.sender, msg.sender);
    }

    // -------------------------------------------------------------------------
    // Admin controls
    // -------------------------------------------------------------------------

    function setDefaultFallbackWindow(uint40 windowSeconds) external onlyAdmin {
        if (windowSeconds == 0 || windowSeconds > 7 days) revert InvalidDuration();
        RelayerFallbackStorage.layout().defaultFallbackWindow = windowSeconds;
        emit DefaultFallbackWindowUpdated(windowSeconds);
    }

    function revokeFallbackDeclaration(address bank) external onlyAdmin {
        delete RelayerFallbackStorage.layout().declarations[bank];
        emit RelayerFallbackRevoked(bank, msg.sender);
    }

    function extendFallbackDeclaration(address bank, uint40 newExpiry) external onlyAdmin {
        if (newExpiry <= block.timestamp) revert InvalidDuration();
        RelayerFallbackStorage.Layout storage s = RelayerFallbackStorage.layout();
        RelayerFallbackStorage.FallbackDeclaration storage declaration = s.declarations[bank];
        if (declaration.expiresAt <= block.timestamp) revert NotFallbackActive();
        declaration.expiresAt = newExpiry;
        emit RelayerFallbackExtended(bank, newExpiry, msg.sender);
    }

    // -------------------------------------------------------------------------
    // View — called by Besu plugin via eth_call
    // -------------------------------------------------------------------------

    function isFallbackActive(address bank) external view returns (bool) {
        return RelayerFallbackStorage.layout().declarations[bank].expiresAt > block.timestamp;
    }

    function getFallbackDeclaration(address bank)
        external
        view
        returns (uint40 activatedAt, uint40 expiresAt)
    {
        RelayerFallbackStorage.FallbackDeclaration storage declaration =
            RelayerFallbackStorage.layout().declarations[bank];
        return (declaration.activatedAt, declaration.expiresAt);
    }

    function getDefaultFallbackWindow() external view returns (uint40) {
        return _defaultFallbackWindow(RelayerFallbackStorage.layout());
    }

    function _defaultFallbackWindow(RelayerFallbackStorage.Layout storage s) internal view returns (uint40) {
        uint40 configured = s.defaultFallbackWindow;
        if (configured == 0) {
            return uint40(RelayerFallbackStorage.DEFAULT_MAX_FALLBACK_DURATION);
        }
        return configured;
    }
}
