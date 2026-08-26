// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";

contract ComplianceLibHarnessFacet {
    function harnessPrecheck(
        address from,
        address to,
        uint256 amount,
        ComplianceLib.Context ctx
    ) external view {
        ComplianceLib.precheck(StorageLib.diamondStorage(), from, to, amount, ctx);
    }

    function harnessPrecheckGated(
        address from,
        address to,
        uint256 amount,
        ComplianceLib.Context ctx
    ) external view {
        ComplianceLib.precheckGated(StorageLib.diamondStorage(), from, to, amount, ctx);
    }
}
