// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { EnvelopeStorage } from "../lib/EnvelopeStorage.sol";
import { SmartLockEnvelopeStorage } from "../lib/SmartLockEnvelopeStorage.sol";
import { ISmartLockEnvelope } from "../interfaces/ISmartLockEnvelope.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { EscrowLib } from "../lib/EscrowLib.sol";
import { ClaimAttributionLib } from "../lib/ClaimAttributionLib.sol";
import { ViewACLLib } from "../lib/ViewACLLib.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { SmartLockEnvelopeLib } from "../lib/SmartLockEnvelopeLib.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";
import { ComplianceTravelRuleLib } from "../lib/ComplianceTravelRuleLib.sol";

/**
 * @title SmartLockEnvelopeFacet
 * @notice SmartLock Adapter — maps the hash-commitment locked-transfer flow into the
 *         envelope model using HOLD_UNTIL_MANUAL expiration behavior (FR-1403).
 *
 * @dev Fragment-commitment security:
 *      - At creation: sender provides hashCommitment = keccak256(fragment || nonce).
 *        The nonce is stored on-chain; the fragment is kept off-chain.
 *      - At release: caller provides the fragment; the facet validates
 *        keccak256(fragment || nonce) == hashCommitment before releasing escrow.
 *
 *      Authorization model:
 *      - Any caller with the valid fragment can release (fragment knowledge = authority).
 *      - If the caller is the designated releaseAuthorizedAddress, CUSTODIAN_ROLE is
 *        additionally required (that address holds elevated authority, so it must be
 *        a custodian to exercise it).
 *      - Only sender or admin can cancel.
 *
 *      Escrow model (identical to TransferEnvelopeFacet):
 *      - Tokens held in the diamond's own ERC-20 balance (address(this)).
 *      - Release moves tokens from diamond escrow to recipient or sender.
 *      - Total supply invariant preserved throughout.
 *
 *      Storage isolation:
 *      - EnvelopeStorage.layout()            — per-envelope lifecycle state
 *      - SmartLockEnvelopeStorage.layout()   — SmartLock conditions (commitment, nonce, authorizedAddress)
 *      - StorageLib.diamondStorage()          — ERC-20 balances (escrow token movement)
 *
 *      ERC-2771 posture (K-F12): raw msg.sender by design (same rationale as
 *      TransferEnvelopeFacet — escrow pulls from the caller's balance and
 *      cancel/release authority matches stored parties or the fragment).
 *      Relayed calls fail safe; alignment deferred to its own design pass.
 */
contract SmartLockEnvelopeFacet is ISmartLockEnvelope, ReentrancyGuardBase {

    // =========================================================================
    // ERRORS
    // =========================================================================

    error InvalidRecipient();
    error InvalidAmount();
    error InvalidCommitWindowEnd();
    error InvalidHashCommitment();
    error EnvelopeNotFound(bytes32 envelopeId);
    error EnvelopeNotInState(bytes32 envelopeId, uint8 current, uint8 required);
    error InvalidFragment(bytes32 envelopeId);
    error UnauthorizedCaller();
    error CustodianRoleRequired(bytes32 envelopeId, address caller);
    // =========================================================================
    // CONSTANTS — mirrors TransferEnvelopeFacet values
    // =========================================================================

    uint8 internal constant ES_NONE         = 0;
    uint8 internal constant ES_CREATED      = 1;
    uint8 internal constant ES_FINALIZED    = 2;
    uint8 internal constant ES_REVERSED     = 3;

    uint8 internal constant EB_HOLD_UNTIL_MANUAL = 2;
    uint8 internal constant ST_CRYPTO_DIRECT     = 0;

    // =========================================================================
    // FR-1403: SMARTLOCK LIFECYCLE
    // =========================================================================

    /// @inheritdoc ISmartLockEnvelope
    function createSmartLockEnvelope(
        address recipient,
        uint256 amount,
        bytes32 hashCommitment,
        bytes32 nonce,
        uint40 commitWindowEnd,
        address releaseAuthorizedAddress
    ) external nonReentrant returns (bytes32 envelopeId) {
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (commitWindowEnd <= uint40(block.timestamp)) revert InvalidCommitWindowEnd();
        if (hashCommitment == bytes32(0)) revert InvalidHashCommitment();

        // Quarantine check: sender cannot be in recovery
        if (WalletRecoveryStorage.layout().activeRecoveryCount[msg.sender] > 0) {
            revert IWalletRecovery.WalletInRecovery(msg.sender);
        }

        // Generate unique envelope ID via EnvelopeStorage nonce
        EnvelopeStorage.Layout storage el = EnvelopeStorage.layout();
        el.envelopeNonce++;
        envelopeId = keccak256(
            abi.encodePacked(
                msg.sender,
                recipient,
                amount,
                commitWindowEnd,
                el.envelopeNonce,
                block.chainid,
                block.timestamp
            )
        );

        // Collision guard (defense-in-depth)
        if (el.envelopes[envelopeId].state != ES_NONE) {
            revert EnvelopeStorage.EnvelopeAlreadyExists(envelopeId);
        }

        // Wave 8B: forward escrow in
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ComplianceLib.precheckGated(ds, msg.sender, recipient, amount, ComplianceLib.Context.ESCROW_IN);

        // Wave 8D: atomic travel-rule binding at create time
        ComplianceTravelRuleLib.bindOnCreate(
            ds, msg.sender, recipient, envelopeId, amount, ComplianceTravelRuleLib.OBJ_SMARTLOCK
        );

        // Escrow tokens from sender into diamond
        EscrowLib.escrowFrom(msg.sender, ClaimAttributionLib.SMARTLOCK_DOMAIN, envelopeId, amount);

        // Persist envelope lifecycle state
        EnvelopeStorage.EnvelopeData storage env = el.envelopes[envelopeId];
        env.id                 = envelopeId;
        env.sender             = msg.sender;
        env.recipient          = recipient;
        env.amount             = amount;
        env.commitWindowEnd    = commitWindowEnd;
        env.settlementType     = ST_CRYPTO_DIRECT;
        env.expirationBehavior = EB_HOLD_UNTIL_MANUAL;
        env.state              = ES_CREATED;
        env.createdAt          = uint40(block.timestamp);
        env.reversedAmount     = 0;

        // Index by sender and recipient (for getEnvelopesBySender / getEnvelopesByRecipient)
        el.senderEnvelopeIds[msg.sender].push(envelopeId);
        el.recipientEnvelopeIds[recipient].push(envelopeId);

        // Persist SmartLock-specific conditions
        SmartLockEnvelopeStorage.SmartLockCondition storage cond =
            SmartLockEnvelopeStorage.layout().conditions[envelopeId];
        cond.hashCommitment          = hashCommitment;
        cond.nonce                   = nonce;
        cond.releaseAuthorizedAddress = releaseAuthorizedAddress;

        // Emit canonical envelope event (plaintext per ADR-004)
        emit EnvelopeStorage.EnvelopeCreated(
            envelopeId,
            msg.sender,
            recipient,
            amount,
            commitWindowEnd,
            ST_CRYPTO_DIRECT,
            EB_HOLD_UNTIL_MANUAL
        );

        emit SmartLockEnvelopeCreated(envelopeId, msg.sender, recipient, amount, releaseAuthorizedAddress);
    }

    /// @inheritdoc ISmartLockEnvelope
    function releaseSmartLockEnvelope(bytes32 envelopeId, bytes32 fragment) external nonReentrant {
        EnvelopeStorage.Layout storage el = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = el.envelopes[envelopeId];

        _requireExists(env, envelopeId);
        _requireState(env, envelopeId, ES_CREATED);

        SmartLockEnvelopeStorage.SmartLockCondition storage cond =
            SmartLockEnvelopeStorage.layout().conditions[envelopeId];

        // Validate fragment: keccak256(fragment || nonce) must equal stored hashCommitment
        if (keccak256(abi.encodePacked(fragment, cond.nonce)) != cond.hashCommitment) {
            revert InvalidFragment(envelopeId);
        }

        // If caller is the designated releaseAuthorizedAddress, require CUSTODIAN_ROLE
        if (cond.releaseAuthorizedAddress != address(0) && msg.sender == cond.releaseAuthorizedAddress) {
            if (!IAccessControl(address(this)).hasRole(RoleConstants.CUSTODIAN_ROLE, msg.sender)) {
                revert CustodianRoleRequired(envelopeId, msg.sender);
            }
        }

        uint256 escrowed = env.amount - env.reversedAmount;

        // Wave 8B: forward escrow release to recipient
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ComplianceLib.precheckGated(ds, env.sender, env.recipient, escrowed, ComplianceLib.Context.ESCROW_RELEASE);

        env.state = ES_FINALIZED;
        address payee = WalletRecoveryStorage._resolveRecoveryPayee(env.recipient);

        EscrowLib.releaseEscrow(payee, ClaimAttributionLib.SMARTLOCK_DOMAIN, envelopeId, escrowed);

        emit EnvelopeStorage.EnvelopeFinalized(envelopeId, uint40(block.timestamp));
        emit SmartLockEnvelopeReleased(envelopeId, msg.sender);
    }

    /// @inheritdoc ISmartLockEnvelope
    function cancelSmartLockEnvelope(bytes32 envelopeId) external nonReentrant {
        EnvelopeStorage.Layout storage el = EnvelopeStorage.layout();
        EnvelopeStorage.EnvelopeData storage env = el.envelopes[envelopeId];

        _requireExists(env, envelopeId);
        _requireState(env, envelopeId, ES_CREATED);

        // Only sender or admin can cancel
        if (msg.sender != env.sender && !_isAdmin(msg.sender)) {
            revert UnauthorizedCaller();
        }

        // Task 4.2 (D2): a screened-out sender parks the refund in an admin hold
        // instead of paying out; the cancel is a no-op until disposition.
        SmartLockEnvelopeLib._cancelSmartLockEnvelopeOrHold(envelopeId, msg.sender);
    }

    /// @inheritdoc ISmartLockEnvelope
    function getSmartLockCondition(bytes32 envelopeId)
        external
        view
        returns (
            bytes32 hashCommitment,
            bytes32 nonce,
            address releaseAuthorizedAddress
        )
    {
        ViewACLLib.requireEnvelopeAccess(envelopeId);
        SmartLockEnvelopeStorage.SmartLockCondition storage cond =
            SmartLockEnvelopeStorage.layout().conditions[envelopeId];
        return (cond.hashCommitment, cond.nonce, cond.releaseAuthorizedAddress);
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    function _requireExists(EnvelopeStorage.EnvelopeData storage env, bytes32 envelopeId) internal view {
        if (env.state == ES_NONE && env.sender == address(0)) {
            revert EnvelopeNotFound(envelopeId);
        }
    }

    function _requireState(
        EnvelopeStorage.EnvelopeData storage env,
        bytes32 envelopeId,
        uint8 required
    ) internal view {
        if (env.state != required) {
            revert EnvelopeNotInState(envelopeId, env.state, required);
        }
    }

    function _isAdmin(address caller) internal view returns (bool) {
        return IAccessControl(address(this)).hasRole(RoleConstants.DEFAULT_ADMIN_ROLE, caller) ||
               IAccessControl(address(this)).hasRole(RoleConstants.ADMIN_ROLE, caller);
    }

}
