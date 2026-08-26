// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title SmartLockEnvelopeStorage
 * @notice Isolated storage for the SmartLock envelope adapter (FR-1403).
 * @dev Storage slot: keccak256("t3.storage.smartlock.envelope.v1")
 *
 *      Maps locked-transfer fragment-commitment security into the envelope model.
 *      Per-envelope SmartLockCondition is keyed by envelopeId (set in EnvelopeStorage).
 *      No cross-storage dependencies — completely isolated from EnvelopeStorage.
 */
library SmartLockEnvelopeStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.smartlock.envelope.v1");

    /**
     * @notice Fragment-commitment conditions for a SmartLock envelope.
     * @dev Release validation: keccak256(fragment || nonce) == hashCommitment.
     *      Only the fragment is revealed on-chain at release time; nonce is the anchor
     *      stored here to prevent commitment pre-image attacks.
     */
    struct SmartLockCondition {
        bytes32 hashCommitment;             // keccak256(fragment || nonce)
        bytes32 nonce;                      // Stored anchor — never revealed; paired with fragment at release
        address releaseAuthorizedAddress;   // Address that can release; requires CUSTODIAN_ROLE when used
    }

    struct Layout {
        mapping(bytes32 => SmartLockCondition) conditions;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }
}
