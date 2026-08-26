// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title IInstitutionLifecycle
 * @notice Stable interface for institution lifecycle and wallet reassignment.
 * @dev Wave 1 freezes events, types, errors, and roles. Mutating facet selectors
 *      are added in later implementation waves after economics/state transitions
 *      are specified. InstitutionMode uses uint8 in events to avoid enum coupling.
 *      [Certain]
 */
interface IInstitutionLifecycle {
    // ==================== ENUMS ====================

    enum InstitutionMode {
        ACTIVE,           // 0 — matches InstitutionLifecycleStorage; storage default(0) = ACTIVE
        ISSUANCE_PAUSED,  // 1
        ORDERLY_EXIT,     // 2
        DEFAULTED,        // 3
        RESOLVED          // 4
    }

    // ==================== EVENTS ====================

    event InstitutionModeUpdated(
        address indexed institution,
        uint8 previousMode,
        uint8 newMode,
        bytes32 evidenceHash
    );

    event WalletInstitutionReassigned(
        address indexed wallet,
        address indexed previousInstitution,
        address indexed newInstitution
    );

    // ==================== STABLE READS ====================

    /**
     * @notice Return the current lifecycle mode of an institution.
     * @param institution The institution address.
     * @return mode The institution mode as uint8 to avoid enum coupling.
     */
    function getInstitutionMode(address institution)
        external
        view
        returns (uint8 mode);
}
