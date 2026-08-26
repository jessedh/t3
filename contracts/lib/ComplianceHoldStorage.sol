// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title ComplianceHoldStorage
 * @notice Isolated diamond storage for compliance payout holds (Sprint 4, D2).
 * @dev When an escrow-release leg fails an armed compliance check, the funds
 *      stay in diamond escrow and a HoldRecord is written here instead of the
 *      leg reverting. An admin later disposes of the hold via
 *      TransferEnvelopeAdminFacet.resolveComplianceHold.
 *
 *      Hold records are keyed by keccak256(abi.encode(domain, objectId)) so a
 *      single central mapping serves every escrow domain (transfer envelopes,
 *      Cambio notes) without touching the domain object structs.
 */
library ComplianceHoldStorage {
    bytes32 internal constant STORAGE_SLOT = keccak256("t3.storage.compliancehold.v1");

    // ---- HoldRecord.status ----
    uint8 internal constant HOLD_NONE     = 0;
    uint8 internal constant HOLD_HELD     = 1;
    uint8 internal constant HOLD_RESOLVED = 2;

    // ---- HoldRecord.disposition ----
    uint8 internal constant DISP_NONE           = 0;
    uint8 internal constant DISP_PAID_ORIGINAL  = 1;
    uint8 internal constant DISP_PAID_ALTERNATE = 2;
    uint8 internal constant DISP_BURNED         = 3;

    // ---- resolveComplianceHold outcome codes (calldata) ----
    uint8 internal constant OUTCOME_PAY_ORIGINAL  = 1;
    uint8 internal constant OUTCOME_PAY_ALTERNATE = 2;
    uint8 internal constant OUTCOME_BURN          = 3;

    /**
     * @dev Field encoding (see 2026-07-04 design note, Q5):
     *      - domain: ClaimAttributionLib.ENVELOPE_DOMAIN or CAMBIO_NOTE_DOMAIN
     *      - objectId: envelopeId / noteId within the domain
     *      - originalPayee: the RAW payee of the blocked leg (pre recovery resolution)
     *      - resolvedPayee: recovery-resolved payee snapshot at hold time
     *      - failingParty / reasonCode: from the failed compliance predicate
     *      - recoveryId: bytes32(0) unless held out of a recovery bulk resolution
     *      - priorState: envelope domain = EnvelopeState uint8 at hold time;
     *        note domain = 1 (active) / 0 (inactive)
     *      - requestedAction: leg code — envelope legs 10-15, note legs 20-21,
     *        raw bulk choice/action codes for recovery-originated holds
     */
    struct HoldRecord {
        bytes32 domain;
        bytes32 objectId;
        address originalPayee;
        address resolvedPayee;
        address failingParty;
        uint256 amount;
        bytes32 reasonCode;
        bytes32 recoveryId;
        uint8 priorState;
        uint8 requestedAction;
        uint8 status;
        uint8 disposition;
        address resolvedBy;
        uint40 heldAt;
        uint40 resolvedAt;
    }

    struct Layout {
        /// @dev holdKey = keccak256(abi.encode(domain, objectId))
        mapping(bytes32 => HoldRecord) holds;
        /// @dev active (unresolved) hold keys, for admin work-queue paging
        EnumerableSet.Bytes32Set activeHolds;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }

    function holdKey(bytes32 domain, bytes32 objectId) internal pure returns (bytes32) {
        return keccak256(abi.encode(domain, objectId));
    }
}
