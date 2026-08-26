// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library TravelRuleStorage {
    error InvalidRef();

    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.compliance-travel-rule.v1");

    struct TravelRule {
        bytes32 ref;
        /// @notice True when an origination ref was bound at create (NOT off-chain transport/beneficiary confirmation, which is out of scope)
        bool satisfied;
        uint40 attachedAt;
    }

    /// @notice C-F3: a staged ref carries the commitment of the exact transfer it
    ///         attests. bindOnCreate matches every field or reverts — a ref staged
    ///         for transfer A can never satisfy transfer B.
    struct PendingTravelRule {
        bytes32 ref;
        address recipient;   // address(0) for bearer instruments (Cambio notes)
        uint256 amount;
        uint8 objectType;    // ComplianceTravelRuleLib.OBJ_* — envelope / smartlock / cambio note
        uint40 deadline;     // staging expires after this timestamp (fail-closed at bind)
    }

    struct Layout {
        mapping(bytes32 => TravelRule) byEnvelope;   // envelopeId -> record
        // C-F3: replaced `mapping(address => bytes32) pendingRef` — the bare-ref
        // schema had nothing to match against at bind (replay/mis-binding class).
        // Legacy never deployed, so the in-place type change is safe.
        mapping(address => PendingTravelRule) pending; // sender -> staged commitment (consumed at bind)
        // C-F4: trailing `uint256 threshold` removed — dead storage; the live
        // threshold is the travel_rule_threshold policy key. Trailing-field
        // removal is diamond-storage layout-safe.
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly { l.slot := slot }
    }
}
