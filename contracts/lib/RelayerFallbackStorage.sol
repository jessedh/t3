// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title RelayerFallbackStorage
 * @notice Isolated storage for the relayer fallback declaration system (FR-ADR003-BESU).
 * @dev Storage slot: keccak256("t3.storage.relayerfallback.v1")
 *
 *      Banks declare temporary Tier 2 direct-RPC access when the T3 relayer is
 *      unavailable. Declarations auto-expire after maxFallbackDuration seconds.
 *      The Besu JSON-RPC plugin calls isFallbackActive() via eth_call to enforce
 *      per-bank access at the RPC layer.
 */
library RelayerFallbackStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.relayerfallback.v1");

    uint256 internal constant DEFAULT_MAX_FALLBACK_DURATION = 4 hours;

    struct FallbackDeclaration {
        uint40 activatedAt;
        uint40 expiresAt;
    }

    struct Layout {
        mapping(address => FallbackDeclaration) declarations;
        uint40 defaultFallbackWindow;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }
}
