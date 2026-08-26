// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ComplianceHoldLib } from "../lib/ComplianceHoldLib.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";

/**
 * @title ComplianceHoldHarnessFacet
 * @notice Test-only facet exposing ComplianceHoldLib.checkOrHold so unit tests
 *         can drive the hold path before the Sprint 4.2–4.4 call sites land.
 * @dev Cut into the diamond per-test (never in the manifest). Links
 *      ComplianceHoldLib — tests must deploy the library and pass it in the
 *      factory `libraries` option.
 */
contract ComplianceHoldHarnessFacet {
    function harnessCheckOrHold(
        bytes32 domain,
        bytes32 objectId,
        address from,
        address to,
        uint256 amount,
        uint8 ctx,
        bytes32 recoveryId,
        uint8 priorState,
        uint8 requestedAction
    ) external returns (bool held) {
        return ComplianceHoldLib.checkOrHold(
            domain,
            objectId,
            from,
            to,
            amount,
            ComplianceLib.Context(ctx),
            recoveryId,
            priorState,
            requestedAction
        );
    }

    function harnessIsHeld(bytes32 domain, bytes32 objectId) external view returns (bool) {
        return ComplianceHoldLib.isHeld(domain, objectId);
    }
}
