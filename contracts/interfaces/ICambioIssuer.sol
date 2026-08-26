// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { CambioEnvelopeStorage } from "../lib/CambioEnvelopeStorage.sol";

/**
 * @title ICambioIssuer
 * @notice Interface for non-bank Cambio note issuers.
 */
interface ICambioIssuer {
    // --- Legacy Admin Functions (CAMBIO_ADMIN_ROLE) ---

    function registerIssuer(address issuer) external;
    function deactivateIssuer(address issuer) external;
    function setIssuerOpenRedemption(address issuer, bool open) external;

    // --- Envelope-Mode Admin Functions ---

    function endorseNonBankIssuer(address issuer) external;
    function registerIssuer(address issuer, address sponsorBank) external;
    function setIssuerPauseState(address issuer, CambioEnvelopeStorage.PauseState state) external;
    // --- Legacy View Functions ---

    function getIssuerProfile(address issuer)
        external
        view
        returns (
            bool isActive,
            bool openRedemption,
            uint256 registeredAt
        );

    // --- Envelope-Mode View Functions ---

    function getPendingEndorsement(address sponsorBank, address issuer) external view returns (bool);

    function issuerEffectiveState(address issuer) external view returns (CambioEnvelopeStorage.PauseState);
}
