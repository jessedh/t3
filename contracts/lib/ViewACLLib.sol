// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { EnvelopeStorage } from "./EnvelopeStorage.sol";
import { StorageLib } from "./StorageLib.sol";
import { RoleConstants } from "./RoleConstants.sol";
import "@openzeppelin/contracts/access/IAccessControl.sol";

/**
 * @title ViewACLLib
 * @notice On-chain view access control library (FR-1005 — App-Layer Privacy Layer 1).
 * @dev Provides caller authorization checks for sensitive view functions across
 *      envelope facets. Prevents cross-bank enumeration when banks have direct
 *      RPC access (Tier 2/3 degraded operation).
 *
 *      TWO CHECK TYPES
 *      ===============
 *      requireEnvelopeAccess(id) — for envelope-scoped views (getEnvelope, getDispute, etc.)
 *        Authorized: env.sender, env.recipient, their custodians, or operator
 *
 *      requireWalletAccess(wallet) — for wallet-scoped views (getEnvelopesBySender, etc.)
 *        Authorized: wallet itself, its custodian, or operator
 *
 *      OPERATOR DEFINITION
 *      ===================
 *      ADMIN_ROLE | DEFAULT_ADMIN_ROLE | COMPLIANCE_ROLE
 *
 *      DESIGN NOTE
 *      ===========
 *      All functions are `internal` — inlined at compile time into each consuming
 *      facet. No runtime library coupling. Diamond-delegatecall-safe because
 *      `address(this)` resolves to the proxy at runtime.
 *
 *      For non-existent envelopes, the existence check is embedded in
 *      requireEnvelopeAccess — callers should NOT add a separate existence check
 *      before calling this function.
 */
library ViewACLLib {

    error UnauthorizedViewer(address caller);

    /**
     * @notice Revert if msg.sender is not authorized to view envelope data.
     * @dev Checks: env.sender, env.recipient, their custodians, or operator.
     *      If the envelope does not exist, reverts with EnvelopeStorage.EnvelopeNotFound
     *      before the ACL check — callers cannot probe envelope existence by
     *      catching UnauthorizedViewer.
     * @param envelopeId The envelope ID to check access for.
     */
    function requireEnvelopeAccess(bytes32 envelopeId) internal view {
        EnvelopeStorage.EnvelopeData storage env =
            EnvelopeStorage.layout().envelopes[envelopeId];

        // Existence check: EnvelopeNotFound fires before ACL — no existence probing
        if (env.sender == address(0)) {
            revert EnvelopeStorage.EnvelopeNotFound(envelopeId);
        }

        address caller = msg.sender;

        if (_isOperator(caller)) return;
        if (caller == env.sender) return;
        if (caller == env.recipient) return;
        if (_isCustodianOf(caller, env.sender)) return;
        if (_isCustodianOf(caller, env.recipient)) return;

        revert UnauthorizedViewer(caller);
    }

    /**
     * @notice Revert if msg.sender is not authorized to view wallet-scoped data.
     * @dev Checks: wallet itself, its custodian, or operator.
     * @param wallet The wallet address to check access for.
     */
    function requireWalletAccess(address wallet) internal view {
        address caller = msg.sender;

        if (_isOperator(caller)) return;
        if (caller == wallet) return;
        if (_isCustodianOf(caller, wallet)) return;

        revert UnauthorizedViewer(caller);
    }

    /**
     * @notice Revert if msg.sender is not an operator (admin/compliance).
     * @dev For operator-only work-queue views (e.g. compliance hold records)
     *      that are not scoped to a single envelope or wallet, so the
     *      party/custodian carve-outs of the other checks do not apply.
     */
    function requireOperatorAccess() internal view {
        if (!_isOperator(msg.sender)) {
            revert UnauthorizedViewer(msg.sender);
        }
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * @dev Returns true if `caller` is the registered custodian of `wallet`.
     *      Zero-address wallet never matches (no valid custodian entry possible).
     */
    function _isCustodianOf(address caller, address wallet) private view returns (bool) {
        if (wallet == address(0)) return false;
        return StorageLib.diamondStorage()._custodyInfo[wallet].custodian == caller;
    }

    /**
     * @dev Returns true if `caller` holds ADMIN_ROLE, DEFAULT_ADMIN_ROLE, or COMPLIANCE_ROLE.
     *      Uses IAccessControl(address(this)) — routes through diamond proxy to AccessControlFacet.
     */
    function _isOperator(address caller) private view returns (bool) {
        IAccessControl ac = IAccessControl(address(this));
        return ac.hasRole(RoleConstants.DEFAULT_ADMIN_ROLE, caller)
            || ac.hasRole(RoleConstants.ADMIN_ROLE, caller)
            || ac.hasRole(RoleConstants.COMPLIANCE_ROLE, caller);
    }
}
