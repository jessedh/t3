// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";
import { IComplianceGate } from "../interfaces/IComplianceGate.sol";

/**
 * @title ComplianceGateFacet
 * @notice External compliance gate used by Wave 8B+ hooked facets.
 * @dev Heavy branching in ComplianceLib.precheck lives in this single facet so
 *      it is not inlined into every forward entrypoint. Other facets call the
 *      lightweight ComplianceLib.precheckGated wrapper, which delegates here
 *      only when a compliance gate is active.
 */
contract ComplianceGateFacet is IComplianceGate {
    function enforceCompliance(address from, address to, uint256 amount, uint8 ctx) external view {
        ComplianceLib.precheck(StorageLib.diamondStorage(), from, to, amount, ComplianceLib.Context(ctx));
    }

    /**
     * @notice Non-reverting form of the compliance funnel (Task 4.1).
     * @dev Same predicate as enforceCompliance, but returns the failure instead
     *      of reverting. Used by ComplianceHoldLib.checkOrHold so a blocked
     *      escrow-release leg can park funds in an admin hold rather than
     *      reverting the whole operation.
     */
    function complianceCheck(
        address from,
        address to,
        uint256 amount,
        uint8 ctx
    ) external view returns (bool ok, address failingParty, bytes32 reasonCode) {
        return ComplianceLib.check(
            StorageLib.diamondStorage(), from, to, amount, ComplianceLib.Context(ctx)
        );
    }
}
