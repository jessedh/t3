// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { EnvelopeStorage } from "../lib/EnvelopeStorage.sol";
import { EnvelopeInheritanceStorage } from "../lib/EnvelopeInheritanceStorage.sol";
import { EscrowLib } from "../lib/EscrowLib.sol";
import { ClaimAttributionLib } from "../lib/ClaimAttributionLib.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";
import { ComplianceTravelRuleLib } from "../lib/ComplianceTravelRuleLib.sol";

/**
 * @title EnvelopeInheritanceFacet
 * @dev ERC-2771 posture (K-F12): raw msg.sender by design (same rationale as
 *      TransferEnvelopeFacet — child-envelope escrow pulls from the caller's
 *      balance and commit/claim authority matches stored parties). Relayed
 *      calls fail safe; alignment deferred to its own design pass.
 */
contract EnvelopeInheritanceFacet is ReentrancyGuardBase {
    uint8 internal constant ES_NONE    = 0;
    uint8 internal constant ES_CREATED = 1;

    event ChildEnvelopeCreated(
        bytes32 indexed parentEnvelopeId,
        bytes32 indexed childEnvelopeId,
        address indexed sender,
        address recipient,
        uint256 amount,
        uint40 commitWindowEnd
    );

    function createChildEnvelope(
        bytes32 parentEnvelopeId,
        address recipient,
        uint256 amount,
        uint40 commitWindowEnd
    ) external nonReentrant returns (bytes32 childEnvelopeId) {
        if (recipient == address(0)) revert EnvelopeStorage.InvalidRecipient();
        if (amount == 0) revert EnvelopeStorage.InvalidAmount();
        if (commitWindowEnd <= uint40(block.timestamp)) revert EnvelopeStorage.InvalidCommitWindowEnd();

        if (WalletRecoveryStorage.layout().activeRecoveryCount[msg.sender] > 0) {
            revert IWalletRecovery.WalletInRecovery(msg.sender);
        }

        EnvelopeStorage.Layout storage el = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage parent = el.envelopes[parentEnvelopeId];

        if (parent.state == ES_NONE) {
            revert EnvelopeInheritanceStorage.ParentEnvelopeNotFound(parentEnvelopeId);
        }
        if (parent.state != ES_CREATED) {
            revert EnvelopeInheritanceStorage.ParentNotInCreatedState(parentEnvelopeId, parent.state);
        }
        if (msg.sender != parent.sender) {
            revert EnvelopeInheritanceStorage.CallerNotParentSender(msg.sender, parent.sender);
        }
        if (commitWindowEnd > parent.commitWindowEnd) {
            revert EnvelopeInheritanceStorage.CommitWindowExceedsParent(commitWindowEnd, parent.commitWindowEnd);
        }

        EnvelopeInheritanceStorage.Layout storage il = EnvelopeInheritanceStorage.layout();
        // Depth constraint: only one level of nesting (parent cannot itself be a child)
        if (il.parentOf[parentEnvelopeId] != bytes32(0)) {
            revert EnvelopeInheritanceStorage.MaxInheritanceDepthExceeded(parentEnvelopeId);
        }

        el.envelopeNonce++;
        childEnvelopeId = keccak256(
            abi.encodePacked(
                msg.sender,
                recipient,
                amount,
                commitWindowEnd,
                parentEnvelopeId,
                el.envelopeNonce,
                block.chainid,
                block.timestamp
            )
        );

        if (el.envelopes[childEnvelopeId].state != ES_NONE) {
            revert EnvelopeStorage.EnvelopeAlreadyExists(childEnvelopeId);
        }

        // Wave 8B: forward escrow in
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ComplianceLib.precheckGated(ds, msg.sender, recipient, amount, ComplianceLib.Context.ESCROW_IN);

        // Wave 8D: atomic travel-rule binding at create time
        ComplianceTravelRuleLib.bindOnCreate(
            ds, msg.sender, recipient, childEnvelopeId, amount, ComplianceTravelRuleLib.OBJ_ENVELOPE
        );

        EscrowLib.escrowFrom(msg.sender, ClaimAttributionLib.ENVELOPE_DOMAIN, childEnvelopeId, amount);

        EnvelopeStorage.EnvelopeData storage child = el.envelopes[childEnvelopeId];
        child.id                 = childEnvelopeId;
        child.sender             = msg.sender;
        child.recipient          = recipient;
        child.amount             = amount;
        child.commitWindowEnd    = commitWindowEnd;
        child.settlementType     = parent.settlementType;
        child.expirationBehavior = parent.expirationBehavior;
        child.state              = ES_CREATED;
        child.createdAt          = uint40(block.timestamp);

        el.senderEnvelopeIds[msg.sender].push(childEnvelopeId);
        el.recipientEnvelopeIds[recipient].push(childEnvelopeId);

        il.parentOf[childEnvelopeId] = parentEnvelopeId;
        il.childrenOf[parentEnvelopeId].push(childEnvelopeId);

        emit ChildEnvelopeCreated(parentEnvelopeId, childEnvelopeId, msg.sender, recipient, amount, commitWindowEnd);
        emit EnvelopeStorage.EnvelopeCreated(
            childEnvelopeId,
            msg.sender,
            recipient,
            amount,
            commitWindowEnd,
            parent.settlementType,
            parent.expirationBehavior
        );
    }

    function getChildEnvelopes(bytes32 parentEnvelopeId)
        external
        view
        returns (bytes32[] memory)
    {
        return EnvelopeInheritanceStorage.layout().childrenOf[parentEnvelopeId];
    }

    function getParentEnvelope(bytes32 childEnvelopeId)
        external
        view
        returns (bytes32)
    {
        return EnvelopeInheritanceStorage.layout().parentOf[childEnvelopeId];
    }
}
