// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { InstitutionLifecycleStorage } from "../lib/InstitutionLifecycleStorage.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";

/**
 * @title InstitutionLifecycleFacet
 * @notice Manages the 5-state lifecycle mode of consortium banks and maintains
 *         a bidirectional cross-reference between InstitutionStorage IDs and
 *         bank addresses.
 */
contract InstitutionLifecycleFacet is ReentrancyGuardBase {

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event InstitutionModeChanged(
        address indexed institution,
        InstitutionLifecycleStorage.InstitutionMode oldMode,
        InstitutionLifecycleStorage.InstitutionMode newMode
    );

    event BankInstitutionLinked(
        address indexed bank,
        bytes32 indexed institutionId
    );

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error InvalidModeTransition(
        address institution,
        InstitutionLifecycleStorage.InstitutionMode current,
        InstitutionLifecycleStorage.InstitutionMode proposed
    );

    error LifecycleDeactivationBlocked(
        address bank,
        InstitutionLifecycleStorage.InstitutionMode mode
    );

    error BankAlreadyLinked(address bank, bytes32 existingId);

    error InstitutionIdAlreadyLinked(bytes32 institutionId, address existingBank);

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyAdmin() {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        _;
    }

    // -----------------------------------------------------------------------
    // State-machine helpers
    // -----------------------------------------------------------------------

    /**
     * @dev Returns true iff the transition from `current` to `next` is valid.
     *
     * Valid transition table:
     *   ACTIVE (0)          → ISSUANCE_PAUSED (1)
     *   ACTIVE (0)          → ORDERLY_EXIT (2)
     *   ACTIVE (0)          → DEFAULT (3)
     *   ISSUANCE_PAUSED (1) → ACTIVE (0)
     *   ORDERLY_EXIT (2)    → RESOLVED (4)
     *   DEFAULT (3)         → RESOLVED (4)
     *   RESOLVED (4)        → (terminal — no outbound transitions)
     */
    function _isValidTransition(
        InstitutionLifecycleStorage.InstitutionMode current,
        InstitutionLifecycleStorage.InstitutionMode next
    ) internal pure returns (bool) {
        if (current == InstitutionLifecycleStorage.InstitutionMode.ACTIVE) {
            return next == InstitutionLifecycleStorage.InstitutionMode.ISSUANCE_PAUSED
                || next == InstitutionLifecycleStorage.InstitutionMode.ORDERLY_EXIT
                || next == InstitutionLifecycleStorage.InstitutionMode.DEFAULTED;
        }
        if (current == InstitutionLifecycleStorage.InstitutionMode.ISSUANCE_PAUSED) {
            return next == InstitutionLifecycleStorage.InstitutionMode.ACTIVE;
        }
        if (current == InstitutionLifecycleStorage.InstitutionMode.ORDERLY_EXIT) {
            return next == InstitutionLifecycleStorage.InstitutionMode.RESOLVED;
        }
        if (current == InstitutionLifecycleStorage.InstitutionMode.DEFAULTED) {
            return next == InstitutionLifecycleStorage.InstitutionMode.RESOLVED;
        }
        // RESOLVED is terminal
        return false;
    }

    // -----------------------------------------------------------------------
    // Mutating functions
    // -----------------------------------------------------------------------

    /**
     * @notice Advance an institution's lifecycle mode according to the
     *         state machine.  Only valid transitions are allowed.
     * @param institution  The bank/institution address whose mode to change.
     * @param newMode      The target mode.
     */
    function setInstitutionMode(
        address institution,
        InstitutionLifecycleStorage.InstitutionMode newMode
    ) external onlyAdmin {
        InstitutionLifecycleStorage.Layout storage l = InstitutionLifecycleStorage.layout();
        InstitutionLifecycleStorage.InstitutionMode current = l.institutionMode[institution];

        if (!_isValidTransition(current, newMode)) {
            revert InvalidModeTransition(institution, current, newMode);
        }

        l.institutionMode[institution] = newMode;
        emit InstitutionModeChanged(institution, current, newMode);
    }

    /**
     * @notice Create a bidirectional cross-reference between a bank address
     *         and an InstitutionStorage ID.
     *
     *         - Idempotent if called again with the exact same (bank, institutionId) pair.
     *         - Reverts with BankAlreadyLinked if the bank is already linked to a
     *           *different* institutionId.
     *         - Reverts with InstitutionIdAlreadyLinked if the institutionId is already
     *           linked to a *different* bank.
     *
     * @param bank           The consortium bank address.
     * @param institutionId  The InstitutionStorage bytes32 ID.
     */
    function linkBankToInstitution(
        address bank,
        bytes32 institutionId
    ) external onlyAdmin {
        InstitutionLifecycleStorage.Layout storage l = InstitutionLifecycleStorage.layout();

        bytes32 existingId = l.bankToInstitutionId[bank];
        address existingBank = l.institutionIdToBank[institutionId];

        // Idempotent: same pair already linked — nothing to do
        if (existingId == institutionId && existingBank == bank) {
            return;
        }

        // Bank already linked to a different institutionId
        if (existingId != bytes32(0) && existingId != institutionId) {
            revert BankAlreadyLinked(bank, existingId);
        }

        // InstitutionId already linked to a different bank
        if (existingBank != address(0) && existingBank != bank) {
            revert InstitutionIdAlreadyLinked(institutionId, existingBank);
        }

        l.bankToInstitutionId[bank] = institutionId;
        l.institutionIdToBank[institutionId] = bank;

        emit BankInstitutionLinked(bank, institutionId);
    }

    // -----------------------------------------------------------------------
    // View functions
    // -----------------------------------------------------------------------

    /**
     * @notice Returns the current lifecycle mode for an institution.
     *         Defaults to ACTIVE (0) for any address not explicitly set.
     */
    function getInstitutionMode(
        address institution
    ) external view returns (InstitutionLifecycleStorage.InstitutionMode) {
        return InstitutionLifecycleStorage.layout().institutionMode[institution];
    }

    /**
     * @notice Resolve an InstitutionStorage ID to the linked bank address.
     *         Returns address(0) if no cross-reference exists.
     */
    function resolveInstitutionBank(
        bytes32 institutionId
    ) external view returns (address) {
        return InstitutionLifecycleStorage.layout().institutionIdToBank[institutionId];
    }

    /**
     * @notice Resolve a bank address to the linked InstitutionStorage ID.
     *         Returns bytes32(0) if no cross-reference exists.
     */
    function resolveBankInstitution(
        address bank
    ) external view returns (bytes32) {
        return InstitutionLifecycleStorage.layout().bankToInstitutionId[bank];
    }
}
