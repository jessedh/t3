// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { EnvelopeStorage } from "./EnvelopeStorage.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol";
import { RoleConstants } from "./RoleConstants.sol";

/**
 * @title EnvelopeGuardLib
 * @notice Shared validation and authorization helpers for the envelope system.
 * @dev All functions are `internal` and inlined at the consuming facet — no
 *      runtime coupling, no extra storage, and no new selectors. Keeps the
 *      envelope facets behavior-identical after the EIP-170 split.
 */
library EnvelopeGuardLib {

    /// @dev Revert when a caller lacks the required admin authorization.
    error UnauthorizedCaller();

    /// @dev Revert when a caller is not the envelope sender, recipient, or arbiter.
    error CallerNotSenderOrArbiter(bytes32 envelopeId);

    /// @dev Revert when a caller is not an authorized arbiter/admin for an envelope.
    error CallerNotArbiter(bytes32 envelopeId);

    /// @dev EnvelopeState.None value (state default / non-existent envelope).
    uint8 internal constant ES_NONE = 0;

    /**
     * @notice Revert if the envelope has never been created.
     * @dev EnvelopeData state and sender both default to zero for unknown IDs.
     */
    function requireExists(
        EnvelopeStorage.EnvelopeData storage env,
        bytes32 envelopeId
    ) internal view {
        if (env.state == ES_NONE && env.sender == address(0)) {
            revert EnvelopeStorage.EnvelopeNotFound(envelopeId);
        }
    }

    /**
     * @notice Revert if the envelope is not in the required state.
     */
    function requireState(
        EnvelopeStorage.EnvelopeData storage env,
        bytes32 envelopeId,
        uint8 required
    ) internal view {
        if (env.state != required) {
            revert EnvelopeStorage.EnvelopeNotInState(envelopeId, env.state, required);
        }
    }

    /**
     * @notice Return true if `caller` holds DEFAULT_ADMIN_ROLE or ADMIN_ROLE.
     */
    function isAdmin(address caller) internal view returns (bool) {
        return IAccessControl(address(this)).hasRole(RoleConstants.DEFAULT_ADMIN_ROLE, caller) ||
               IAccessControl(address(this)).hasRole(RoleConstants.ADMIN_ROLE, caller);
    }

    /**
     * @notice Return true if `caller` holds ORACLE_ROLE.
     */
    function hasOracleRole(address caller) internal view returns (bool) {
        return IAccessControl(address(this)).hasRole(RoleConstants.ORACLE_ROLE, caller);
    }

    /**
     * @notice Revert if `msg.sender` is not an admin.
     */
    function requireAdmin() internal view {
        if (!isAdmin(msg.sender)) {
            revert UnauthorizedCaller();
        }
    }

    /**
     * @notice Revert if `msg.sender` is not an admin (arbiter) for this envelope.
     */
    function requireAdminOrArbiter(bytes32 envelopeId) internal view {
        if (!isAdmin(msg.sender)) {
            revert CallerNotArbiter(envelopeId);
        }
    }

    /**
     * @notice Revert if `msg.sender` is not the sender, recipient, or an admin.
     */
    function requireSenderRecipientOrAdmin(
        EnvelopeStorage.EnvelopeData storage env,
        bytes32 envelopeId
    ) internal view {
        if (msg.sender != env.sender && msg.sender != env.recipient && !isAdmin(msg.sender)) {
            revert CallerNotSenderOrArbiter(envelopeId);
        }
    }
}
