// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";

/**
 * @title WalletRecoveryStorage
 * @notice Dedicated storage library for the T3 wallet recovery system (FR-1402).
 * @dev Isolated from other storage via diamond storage pattern.
 *      Storage slot: keccak256("t3.storage.wallet.recovery.v1")
 */
library WalletRecoveryStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.wallet.recovery.v1");

    struct RecoveryRecord {
        bytes32 recoveryId;
        address oldWallet;
        address newWallet;
        uint8 recoveryType; // IWalletRecovery.RecoveryType
        uint8 state;        // IWalletRecovery.RecoveryState
        uint40 initiatedAt;
        uint40 electionWindowEndsAt;
        address initiatedBy;
        IWalletRecovery.RecoveryPolicy policy;
        uint256 envelopesResolved;
        mapping(bytes32 => uint8) resolvedEnvelopes;  // 0=unresolved, choice+1 when resolved
        mapping(bytes32 => uint8) envelopeOverrides; // 0 = use policy, non-zero = choice + 1
        uint256 cambioNotesResolved;
        mapping(bytes32 => uint8) resolvedNotes;       // 0=unresolved, action+1 when resolved
        uint40 timelockEndsAt;
        bool balanceMigrated;
        // Task 5.3 tail-append (DP-5.0-B): set by any manual migrate helper
        // (consortium / institution / depositor-identity); makes the recovery
        // irreversible — cancelRecovery will no longer restore state.
        bool stateMigrated;
    }

    struct Layout {
        mapping(bytes32 => RecoveryRecord) recoveries;
        mapping(address => bytes32) walletRecoveryId;
        mapping(address => uint256) activeRecoveryCount;
        mapping(address => address) recoverySuccessor;
        mapping(address => address) recoveryStandby;
        uint256 recoveryCounter;
        uint40 defaultElectionWindow;
        IWalletRecovery.RecoveryPolicy defaultPolicy;
    }

    /**
     * @notice Get storage layout pointer.
     */
    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }

    /**
     * @notice Resolve effective payee with a bounded 3-hop lookup loop to handle chained recoveries.
     * @param payee The original payee address.
     * @return The effective payee address after traversing recovery mapping up to 3 hops.
     */
    function _resolveRecoveryPayee(address payee) internal view returns (address) {
        address current = payee;
        Layout storage s = layout();
        for (uint256 i = 0; i < 3; i++) {
            address next = s.recoverySuccessor[current];
            if (next == address(0) || next == current) {
                break;
            }
            current = next;
        }
        return current;
    }
}
