// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { T3CommonLib } from "../lib/T3CommonLib.sol";
import { EnvelopeStorage } from "../lib/EnvelopeStorage.sol";
import { EscrowLib } from "../lib/EscrowLib.sol";
import { ClaimAttributionLib } from "../lib/ClaimAttributionLib.sol";
import { SmartLockEnvelopeLib } from "../lib/SmartLockEnvelopeLib.sol";
import { SmartLockEnvelopeStorage } from "../lib/SmartLockEnvelopeStorage.sol";
import { CambioEnvelopeStorage } from "../lib/CambioEnvelopeStorage.sol";
import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";
import { SponsorBankStorage } from "../lib/SponsorBankStorage.sol";
import { InstitutionStorage } from "../lib/InstitutionStorage.sol";
import { ScreeningStorage } from "../lib/ScreeningStorage.sol";
import { WalletRecoveryDepositorIdentityLib } from "../lib/WalletRecoveryDepositorIdentityLib.sol";
import { WalletRecoverySanctionsLib } from "../lib/WalletRecoverySanctionsLib.sol";
import { WalletRecoverySnapshotLib } from "../lib/WalletRecoverySnapshotLib.sol";
import { ComplianceStatusLib } from "../lib/ComplianceStatusLib.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";
import { ComplianceHoldLib } from "../lib/ComplianceHoldLib.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title WalletRecoveryFacet
 * @author T3 Protocol
 * @notice Full implementation of the T3 wallet recovery system (FR-1402).
 * @dev Diamond facet that manages the lifecycle of bank wallet recovery,
 *      including envelope resolution, Cambio note migration, balance transfer,
 *      role transfer, and predecessor chain compaction.
 *
 *      State machine: None(0) → RecoveryPending(1) → RecoveryActive(2)
 *                     → RecoveryComplete(3) | RecoveryCancelled(4)
 *
 *      Authorization model:
 *        - Self-initiated (KeyRotation, type 3): wallet itself must have CUSTODIAN_ROLE
 *          and msg.sender == wallet. ADMIN/DEFAULT_ADMIN can cancel.
 *        - Admin-initiated (types 0–2): ADMIN_ROLE or DEFAULT_ADMIN_ROLE.
 *
 *      Security:
 *        - Raw `msg.sender` everywhere (no ERC-2771 _msgSender).
 *        - ReentrancyGuardBase on all state-changing functions.
 *        - CEI pattern followed in all fund movements.
 */
contract WalletRecoveryFacet is ReentrancyGuardBase, IWalletRecovery {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes32Set;
    // =========================================================================
    // CONSTANTS
    // =========================================================================

    /// @notice Maximum envelopes or Cambio notes per bulk batch.
    uint256 private constant MAX_BULK_BATCH = 50;

    /// @notice Maximum predecessors for chain compaction.
    uint256 private constant MAX_PREDECESSORS = 100;

    /// @notice Maximum counterparties for liability checks in migrateBalance.
    uint256 private constant MAX_LIABILITY_COUNTERPARTIES = 100;

    /// @notice Timelock duration for self-initiated (KeyRotation) recovery.
    uint40 private constant SELF_INITIATED_TIMELOCK = 48 hours;

    // =========================================================================
    // ENVELOPE STATE CONSTANTS
    // =========================================================================

    uint8 private constant ES_NONE = 0;
    uint8 private constant ES_CREATED = 1;
    uint8 private constant ES_FINALIZED = 2;
    uint8 private constant ES_REVERSED = 3;
    uint8 private constant ES_DISPUTED = 4;
    uint8 private constant ES_PENDING_FIAT = 6;

    // =========================================================================
    // RECOVERY STATE CONSTANTS
    // =========================================================================

    uint8 private constant RS_NONE = 0;
    uint8 private constant RS_PENDING = 1;
    uint8 private constant RS_ACTIVE = 2;
    uint8 private constant RS_COMPLETE = 3;
    uint8 private constant RS_CANCELLED = 4;

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    /**
     * @dev Reverts if the wallet is not an eligible successor/standby.
     *      Requires: registered custodian, CUSTODIAN_ROLE, valid KYC.
     */
    function _requireEligibleSuccessor(address wallet) private view {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        bool registered = ds._custodians.contains(wallet);
        bool hasCustodian = AccessControlLib.hasRole(ds, RoleConstants.CUSTODIAN_ROLE, wallet);
        bool kycValid = ComplianceStatusLib.kycStatusOf(ds, wallet);
        if (!registered || !hasCustodian || !kycValid) {
            revert IWalletRecovery.SuccessorNotCustodian(wallet);
        }
    }

    /**
     * @dev Reverts if the caller holds neither ADMIN_ROLE nor DEFAULT_ADMIN_ROLE.
     */
    function _requireAdminOrDefaultAdmin() private view {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (
            !AccessControlLib.hasRole(ds, RoleConstants.ADMIN_ROLE, msg.sender) &&
            !AccessControlLib.hasRole(ds, RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender)
        ) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.ADMIN_ROLE);
        }
    }

    /**
     * @dev Checks if an endpoint address belongs to the recovery lineage of oldWallet.
     *      Traverses recoverySuccessor from endpoint for at most 3 hops, checking
     *      the current address before following the next successor.
     */
    function _belongsToRecovery(address endpoint, address oldWallet) private view returns (bool) {
        if (endpoint == oldWallet) return true;
        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        address current = endpoint;
        for (uint256 i = 0; i < 3; i++) {
            address next = ws.recoverySuccessor[current];
            if (next == address(0) || next == current) {
                break;
            }
            current = next;
            if (current == oldWallet) return true;
        }
        return false;
    }

    /**
     * @dev Reverts if either the source or target wallet is network-BLOCKED.
     *      Sanctions win over recovery: a block must be explicitly cleared before
     *      any migration can proceed.
     */
    function _requireNotNetworkBlockedForMigration(address source, address target) private view {
        ScreeningStorage.Layout storage s = ScreeningStorage.layout();
        if (s.screenings[source].status == uint8(ScreeningStorage.ScreeningStatus.BLOCKED)) {
            revert IWalletRecovery.RecoveryBlockedBySanctions(source);
        }
        if (s.screenings[target].status == uint8(ScreeningStorage.ScreeningStatus.BLOCKED)) {
            revert IWalletRecovery.RecoveryBlockedBySanctions(target);
        }
    }

    // =========================================================================
    // STATE-CHANGING FUNCTIONS
    // =========================================================================

    /**
     * @notice Initiate a wallet recovery process for a bank wallet.
     * @dev Creates a RecoveryRecord in PENDING state, assigns default policy,
     *      increments activeRecoveryCount. For KeyRotation (type 3), starts
     *      a 48-hour timelock.
     * @param wallet The bank wallet to recover.
     * @param recoveryType 0=LostKey, 1=Compromised, 2=BankExit, 3=KeyRotation.
     * @return recoveryId The unique identifier for this recovery process.
     */
    function initiateRecovery(
        address wallet,
        uint8 recoveryType
    ) external nonReentrant returns (bytes32 recoveryId) {
        // --- Input validation ---
        if (wallet == address(0)) revert StorageLib.UserAddressZero();
        if (recoveryType > 3) {
            revert IWalletRecovery.InvalidRecoveryState(bytes32(0), recoveryType, 3);
        }

        // --- Authorization ---
        if (recoveryType == 3) {
            // Self-initiated KeyRotation: caller must be the wallet AND hold CUSTODIAN_ROLE
            if (msg.sender != wallet) {
                revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.CUSTODIAN_ROLE);
            }
            AccessControlLib.checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        } else {
            // Admin-initiated: caller must hold ADMIN_ROLE or DEFAULT_ADMIN_ROLE
            _requireAdminOrDefaultAdmin();
        }

        // The wallet must be a bank wallet (CUSTODIAN_ROLE)
        AccessControlLib.checkRole(RoleConstants.CUSTODIAN_ROLE, wallet);

        // --- State changes ---
        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();

        // Reject duplicate pending/active recovery
        if (ws.activeRecoveryCount[wallet] > 0) {
            revert IWalletRecovery.WalletInRecovery(wallet);
        }

        ws.recoveryCounter++;
        recoveryId = keccak256(
            abi.encodePacked(block.chainid, address(this), wallet, ws.recoveryCounter)
        );

        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];
        rec.recoveryId = recoveryId;
        rec.oldWallet = wallet;
        rec.recoveryType = recoveryType;
        rec.state = RS_PENDING;
        rec.initiatedAt = uint40(block.timestamp);
        rec.initiatedBy = msg.sender;
        rec.electionWindowEndsAt = uint40(block.timestamp) + ws.defaultElectionWindow;

        // Copy default policy
        rec.policy = ws.defaultPolicy;

        // Map wallet → active recovery
        ws.walletRecoveryId[wallet] = recoveryId;
        ws.activeRecoveryCount[wallet]++;

        // --- KeyRotation timelock ---
        if (recoveryType == 3) {
            rec.timelockEndsAt = uint40(block.timestamp + SELF_INITIATED_TIMELOCK);
            emit IWalletRecovery.RecoveryTimelockStarted(recoveryId, rec.timelockEndsAt);
        }

        emit IWalletRecovery.RecoveryInitiated(
            recoveryId,
            wallet,
            recoveryType,
            uint40(block.timestamp)
        );
    }

    /**
     * @notice Designate a successor wallet and activate recovery.
     * @dev Transitions state from RecoveryPending(1) → RecoveryActive(2).
     *      For KeyRotation, the successor must match the pre-registered standby.
     *      Copies the Cambio issuer profile from old to new wallet if one exists.
     * @param recoveryId The recovery process identifier.
     * @param newWallet The successor wallet address.
     */
    function designateSuccessor(
        bytes32 recoveryId,
        address newWallet
    ) external nonReentrant {
        _requireAdminOrDefaultAdmin();

        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];

        if (rec.state != RS_PENDING) {
            revert IWalletRecovery.InvalidRecoveryState(recoveryId, rec.state, RS_PENDING);
        }
        if (newWallet == address(0)) revert StorageLib.UserAddressZero();
        if (newWallet == rec.oldWallet) {
            revert IWalletRecovery.StandbyWalletInvalid(newWallet);
        }
        if (ws.activeRecoveryCount[newWallet] > 0) {
            revert IWalletRecovery.WalletInRecovery(newWallet);
        }

        _requireEligibleSuccessor(newWallet);

        // For KeyRotation: successor must be the pre-registered standby
        if (rec.recoveryType == 3) {
            address standby = ws.recoveryStandby[rec.oldWallet];
            if (standby == address(0) || newWallet != standby) {
                revert IWalletRecovery.StandbyWalletInvalid(newWallet);
            }
        }

        // --- Activate ---
        rec.newWallet = newWallet;
        rec.state = RS_ACTIVE;
        ws.recoverySuccessor[rec.oldWallet] = newWallet;

        // --- Atomic sanctions/affiliation/CIP/Cambio migration (DP-B), with
        // --- pre-move snapshot journaling for reversible cancel (Task 5.3) ---
        _requireNotNetworkBlockedForMigration(rec.oldWallet, newWallet);
        WalletRecoverySanctionsLib.migrateComplianceStateToSuccessor(recoveryId, rec.oldWallet, newWallet);

        emit IWalletRecovery.RecoverySuccessorDesignated(
            recoveryId,
            newWallet,
            msg.sender
        );
    }

    /**
     * @notice Redirect the successor wallet during an active recovery.
     * @dev Only callable during RecoveryActive(2). Moves the Cambio issuer
     *      profile from the previous successor to the new one.
     * @param recoveryId The recovery process identifier.
     * @param newWallet The replacement successor wallet address.
     */
    function redirectSuccessor(
        bytes32 recoveryId,
        address newWallet
    ) external nonReentrant {
        _requireAdminOrDefaultAdmin();

        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];

        if (rec.state != RS_ACTIVE) {
            revert IWalletRecovery.InvalidRecoveryState(recoveryId, rec.state, RS_ACTIVE);
        }
        if (newWallet == address(0)) revert StorageLib.UserAddressZero();
        if (newWallet == rec.oldWallet) {
            revert IWalletRecovery.StandbyWalletInvalid(newWallet);
        }
        if (ws.activeRecoveryCount[newWallet] > 0) {
            revert IWalletRecovery.WalletInRecovery(newWallet);
        }

        _requireEligibleSuccessor(newWallet);

        address oldNewWallet = rec.newWallet;
        rec.newWallet = newWallet;
        ws.recoverySuccessor[rec.oldWallet] = newWallet;

        // Migrate sanctions/affiliation/CIP/Cambio state from the previous successor
        // to the new successor, journaling both sides' pre-move records (Task 5.3).
        _requireNotNetworkBlockedForMigration(oldNewWallet, newWallet);
        WalletRecoverySanctionsLib.migrateComplianceStateToSuccessor(recoveryId, oldNewWallet, newWallet);

        emit IWalletRecovery.RecoverySuccessorRedirected(
            recoveryId,
            oldNewWallet,
            newWallet
        );
    }

    /**
     * @notice Override the default recovery choice for a specific envelope.
     * @dev Stored as choice + 1 (1-based) to distinguish from the "use policy" default of 0.
     * @param recoveryId The recovery process identifier.
     * @param envelopeId The target envelope identifier.
     * @param choice The EnvelopeRecoveryChoice value (0–4).
     */
    function overrideEnvelopeChoice(
        bytes32 recoveryId,
        bytes32 envelopeId,
        uint8 choice
    ) external nonReentrant {
        _requireAdminOrDefaultAdmin();

        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];

        if (rec.state != RS_ACTIVE) {
            revert IWalletRecovery.InvalidRecoveryState(recoveryId, rec.state, RS_ACTIVE);
        }
        if (choice > 4) {
            revert IWalletRecovery.InvalidEnvelopeRecoveryChoice(choice);
        }

        // Verify the envelope is actually related to the recovering wallet before storing
        // the override — prevents admins from accidentally overriding unrelated envelopes.
        EnvelopeStorage.EnvelopeData storage env = EnvelopeStorage.layout().envelopes[envelopeId];
        bool senderBelongs = _belongsToRecovery(env.sender, rec.oldWallet);
        bool recipientBelongs = _belongsToRecovery(env.recipient, rec.oldWallet);
        if (!senderBelongs && !recipientBelongs) {
            revert IWalletRecovery.EnvelopeNotInRecovery(envelopeId, recoveryId);
        }

        rec.envelopeOverrides[envelopeId] = choice + 1; // 1-based storage

        emit IWalletRecovery.EnvelopeChoiceOverridden(recoveryId, envelopeId, choice);
    }

    /**
     * @notice Resolve a batch of envelopes using recovery policy or per-envelope overrides.
     * @dev Processes up to MAX_BULK_BATCH envelopes per call. Each envelope is resolved
     *      based on the relationship of the recovering wallet (sender/recipient) and the
     *      envelope's current state. SmartLock envelopes use dedicated cancellation logic
     *      and cannot be auto-finalized.
     *
     *      Idempotent: already-resolved envelopes emit choice=255 and are skipped.
     *
     * @param recoveryId The recovery process identifier.
     * @param envelopeIds Array of envelope IDs to resolve.
     */
    function applyBulkPolicy(
        bytes32 recoveryId,
        bytes32[] calldata envelopeIds
    ) external nonReentrant {
        _requireAdminOrDefaultAdmin();

        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];

        if (rec.state != RS_ACTIVE) {
            revert IWalletRecovery.InvalidRecoveryState(recoveryId, rec.state, RS_ACTIVE);
        }
        if (envelopeIds.length > MAX_BULK_BATCH) {
            revert IWalletRecovery.BatchTooLarge(envelopeIds.length, MAX_BULK_BATCH);
        }

        EnvelopeStorage.Layout storage el = EnvelopeStorage.layout();
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        for (uint256 i = 0; i < envelopeIds.length; i++) {
            bytes32 envelopeId = envelopeIds[i];

            // SmartLock envelopes escrow (and hold) under SMARTLOCK_DOMAIN.
            bool isSmartLock = SmartLockEnvelopeStorage.layout()
                .conditions[envelopeId].hashCommitment != bytes32(0);
            bytes32 holdDomain = isSmartLock
                ? ClaimAttributionLib.SMARTLOCK_DOMAIN
                : ClaimAttributionLib.ENVELOPE_DOMAIN;

            uint8 _storedChoice = rec.resolvedEnvelopes[envelopeId];

            // Held guard (Task 4.4, kimi HIGH-1): a hold parked by a single-item
            // leg or a prior bulk pass must not be paid out (or, for SmartLock,
            // abort the batch) by this pass. Sentinel replays emit the dedicated
            // event rather than choice=254 from the generic skip (LOW-2).
            if (_storedChoice == ComplianceHoldLib.HELD_SENTINEL ||
                ComplianceHoldLib.isHeld(holdDomain, envelopeId)) {
                emit ComplianceHoldLib.RecoveryBulkItemHeld(recoveryId, holdDomain, envelopeId);
                continue;
            }

            // Idempotent skip
            if (_storedChoice != 0) {
                emit IWalletRecovery.RecoveryEnvelopeResolved(
                    recoveryId, envelopeId, _storedChoice - 1, 0, true
                );
                continue;
            }

            EnvelopeStorage.EnvelopeData storage env = el.envelopes[envelopeId];

            // --- Determine choice ---
            uint8 choice;
            {
                // Verify lineage before honoring overrides or policy
                bool senderBelongs = _belongsToRecovery(env.sender, rec.oldWallet);
                bool recipientBelongs = _belongsToRecovery(env.recipient, rec.oldWallet);
                if (!senderBelongs && !recipientBelongs) {
                    // Not related to recovering wallet — skip
                    continue;
                }

                uint8 overrideVal = rec.envelopeOverrides[envelopeId];
                if (overrideVal != 0) {
                    // Override present (1-based)
                    choice = overrideVal - 1;
                } else {
                    // Determine from policy based on relationship + envelope state
                    if (env.state == ES_DISPUTED) {
                        choice = uint8(rec.policy.disputedDefault);
                    } else if (env.state == ES_PENDING_FIAT) {
                        choice = uint8(rec.policy.pendingFiatDefault);
                    } else if (senderBelongs) {
                        choice = uint8(rec.policy.senderDefault);
                    } else {
                        choice = uint8(rec.policy.recipientDefault);
                    }
                }
            }

            // --- Apply choice ---
            uint256 amountMoved = 0;
            bool handled = false;

            if (choice > 4) {
                revert IWalletRecovery.InvalidEnvelopeRecoveryChoice(choice);
            }

            if (choice == 0) {
                // Finalize
                if (isSmartLock) {
                    // Cannot auto-finalize SmartLock — skip
                    continue;
                }
                if (env.state == ES_CREATED) {
                    amountMoved = env.amount - env.reversedAmount;

                    // Wave 8B: forward recovery finalize to resolved recipient
                    ComplianceLib.precheckGated(
                        ds, env.sender, env.recipient, amountMoved, ComplianceLib.Context.ESCROW_RELEASE
                    );

                    env.state = ES_FINALIZED;
                    address payee = WalletRecoveryStorage._resolveRecoveryPayee(env.recipient);
                    EscrowLib.releaseEscrow(payee, ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, amountMoved);
                    handled = true;
                }
            } else if (choice == 1) {
                // Reverse — return leg to the original sender (D2: screened-out
                // counterparties park an admin hold instead of reverting the batch).
                if (isSmartLock) {
                    if (_envelopeLegParked(
                        holdDomain, envelopeId, env, recoveryId,
                        ComplianceHoldLib.LEG_SMARTLOCK_CANCEL
                    )) continue;
                    SmartLockEnvelopeLib._cancelSmartLockEnvelope(envelopeId, msg.sender);
                    amountMoved = env.amount - env.reversedAmount;
                    handled = true;
                } else {
                    if (env.state == ES_CREATED) {
                        if (_envelopeLegParked(
                            holdDomain, envelopeId, env, recoveryId,
                            ComplianceHoldLib.LEG_REVERSE
                        )) continue;
                        env.state = ES_REVERSED;
                        amountMoved = env.amount - env.reversedAmount;
                        address payee = WalletRecoveryStorage._resolveRecoveryPayee(env.sender);
                        EscrowLib.releaseEscrow(payee, ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, amountMoved);
                        handled = true;
                    }
                }
            } else if (choice == 2) {
                // Clawback — same D2 park semantics as Reverse.
                if (env.state == ES_PENDING_FIAT) {
                    if (_envelopeLegParked(
                        holdDomain, envelopeId, env, recoveryId,
                        ComplianceHoldLib.LEG_CLAWBACK
                    )) continue;
                    env.state = ES_REVERSED;
                    amountMoved = env.amount - env.reversedAmount;
                    address payee = WalletRecoveryStorage._resolveRecoveryPayee(env.sender);
                    EscrowLib.releaseEscrow(payee, ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, amountMoved);
                    handled = true;
                } else if (env.state == ES_CREATED) {
                    // Treat as reverse for Created envelopes
                    if (isSmartLock) {
                        if (_envelopeLegParked(
                            holdDomain, envelopeId, env, recoveryId,
                            ComplianceHoldLib.LEG_SMARTLOCK_CANCEL
                        )) continue;
                        SmartLockEnvelopeLib._cancelSmartLockEnvelope(envelopeId, msg.sender);
                        amountMoved = env.amount - env.reversedAmount;
                        handled = true;
                    } else {
                        if (_envelopeLegParked(
                            holdDomain, envelopeId, env, recoveryId,
                            ComplianceHoldLib.LEG_CLAWBACK
                        )) continue;
                        env.state = ES_REVERSED;
                        amountMoved = env.amount - env.reversedAmount;
                        address payee = WalletRecoveryStorage._resolveRecoveryPayee(env.sender);
                        EscrowLib.releaseEscrow(payee, ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, amountMoved);
                        handled = true;
                    }
                }
            } else if (choice == 3) {
                // ConfirmFiat
                if (env.state == ES_PENDING_FIAT) {
                    amountMoved = env.amount - env.reversedAmount;
                    // Bulk fiat-confirm runs the same ESCROW_RELEASE gate as the
                    // normal path (TransferEnvelopeAdminFacet.confirmFiatReceived):
                    // the recipient took beneficial ownership of the fiat leg.
                    WalletRecoverySanctionsLib.precheckEscrowRelease(
                        env.sender, env.recipient, amountMoved
                    );
                    env.state = ES_FINALIZED;
                    EscrowLib.burnEscrow(ClaimAttributionLib.ENVELOPE_DOMAIN, envelopeId, amountMoved);
                    handled = true;
                }
            } else if (choice == 4) {
                // CarryDispute — no fund movement
                amountMoved = 0;
                handled = true;
            }

            if (!handled) {
                // No applicable (choice, state) transition — do not mark resolved, allow retry.
                continue;
            }

            rec.resolvedEnvelopes[envelopeId] = uint8(choice) + 1;
            rec.envelopesResolved++;

            emit IWalletRecovery.RecoveryEnvelopeResolved(
                recoveryId, envelopeId, choice, amountMoved, false
            );
        }
    }

    /**
     * @dev Single call-site wrapper for the bulk hold check (Task 4.4). Every
     *      envelope return leg screens from=recipient, to=sender (RAW — the lib
     *      resolves the recovery payee exactly once) for the remaining amount.
     *      Deduplicating the external-library call stub keeps the facet inside
     *      its size budget. Returns true when the leg parked a hold.
     */
    function _envelopeLegParked(
        bytes32 domain,
        bytes32 envelopeId,
        EnvelopeStorage.EnvelopeData storage env,
        bytes32 recoveryId,
        uint8 leg
    ) private returns (bool) {
        return ComplianceHoldLib.checkOrHoldBulk(
            domain,
            envelopeId,
            env.recipient,
            env.sender,
            env.amount - env.reversedAmount,
            recoveryId,
            env.state,
            leg
        );
    }

    /**
     * @notice Resolve a batch of Cambio notes during wallet recovery.
     * @dev Actions: 0=transferred (profile already migrated), 1=cancelled (release escrow),
     *      2=expired (same as cancelled). Idempotent: already-resolved notes emit action=255.
     * @param recoveryId The recovery process identifier.
     * @param noteIds Array of Cambio note IDs to resolve.
     * @param actions Array of action codes corresponding to each note.
     */
    function resolveCambioNotesBulk(
        bytes32 recoveryId,
        bytes32[] calldata noteIds,
        uint8[] calldata actions
    ) external nonReentrant {
        _requireAdminOrDefaultAdmin();

        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];

        if (rec.state != RS_ACTIVE) {
            revert IWalletRecovery.InvalidRecoveryState(recoveryId, rec.state, RS_ACTIVE);
        }
        if (noteIds.length > MAX_BULK_BATCH) {
            revert IWalletRecovery.BatchTooLarge(noteIds.length, MAX_BULK_BATCH);
        }
        if (noteIds.length != actions.length) {
            revert IWalletRecovery.BatchTooLarge(actions.length, noteIds.length);
        }

        CambioEnvelopeStorage.Layout storage cl = CambioEnvelopeStorage.layout();

        for (uint256 i = 0; i < noteIds.length; i++) {
            bytes32 noteId = noteIds[i];
            uint8 action = actions[i];

            if (action > 2) {
                revert IWalletRecovery.InvalidNoteAction(action);
            }

            uint8 _storedAction = rec.resolvedNotes[noteId];

            // Held guard (Task 4.4): held notes are admin-resolvable only; the
            // sentinel replay emits the dedicated event, not action=254 (LOW-2).
            if (_storedAction == ComplianceHoldLib.HELD_SENTINEL ||
                ComplianceHoldLib.isHeld(ClaimAttributionLib.CAMBIO_NOTE_DOMAIN, noteId)) {
                emit ComplianceHoldLib.RecoveryBulkItemHeld(
                    recoveryId, ClaimAttributionLib.CAMBIO_NOTE_DOMAIN, noteId
                );
                continue;
            }

            // Idempotent skip
            if (_storedAction != 0) {
                emit IWalletRecovery.RecoveryCambioNoteResolved(
                    recoveryId, noteId, _storedAction - 1, 0, true
                );
                continue;
            }

            CambioEnvelopeStorage.CambioEnvelopeNote storage note =
                cl.envelopeNotes[noteId];

            // Reject unrelated notes before action processing
            if (!_belongsToRecovery(note.issuer, rec.oldWallet)) {
                revert IWalletRecovery.CambioNoteNotInRecovery(noteId, recoveryId);
            }

            uint256 amountReturned = 0;

            if (action == 0) {
                // Transferred: note stays active, profile already migrated
                amountReturned = 0;
            } else if (action == 1 || action == 2) {
                // Cancelled or Expired: deactivate and release remaining escrow
                if (note.active) {
                    uint256 remaining = note.escrowedAmount - note.spent;
                    if (remaining > 0) {
                        // D2 park semantics (Task 4.4): pass the RAW payee — the lib
                        // resolves the recovery payee exactly once. Runs BEFORE
                        // note.active flips so no effect precedes a possible park.
                        if (ComplianceHoldLib.checkOrHoldBulk(
                            ClaimAttributionLib.CAMBIO_NOTE_DOMAIN, noteId,
                            note.issuer, rec.oldWallet, remaining,
                            recoveryId, 1, action
                        )) continue;
                        address payee = WalletRecoveryStorage._resolveRecoveryPayee(rec.oldWallet);
                        note.active = false;
                        // Cambio notes escrow under CAMBIO_NOTE_DOMAIN (CambioEnvelopeFacet
                        // escrowIn); releasing under ENVELOPE_DOMAIN here corrupted the
                        // claim-attribution subledger (C-F2).
                        EscrowLib.releaseEscrow(payee, ClaimAttributionLib.CAMBIO_NOTE_DOMAIN, noteId, remaining);
                    } else {
                        note.active = false;
                    }
                    amountReturned = note.escrowedAmount - note.spent;

                    // Update issuer profile counters
                    CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile =
                        cl.issuerProfiles[rec.newWallet];
                    if (profile.notesOutstanding > 0) {
                        profile.notesOutstanding--;
                    }
                    if (profile.valueOutstanding >= amountReturned) {
                        profile.valueOutstanding -= amountReturned;
                    }
                }
            }

            rec.resolvedNotes[noteId] = uint8(action) + 1;
            rec.cambioNotesResolved++;

            emit IWalletRecovery.RecoveryCambioNoteResolved(
                recoveryId, noteId, action, amountReturned, false
            );
        }
    }

    /**
     * @notice Migrate the liquid balance, prefunded fees, and incentive credits
     *         from the old wallet to the successor.
     * @dev Requires zero outstanding legacy pending transfers and zero bilateral
     *      interbank liabilities against all specified counterparties.
     * @param recoveryId The recovery process identifier.
     * @param liabilityCounterparties Counterparty addresses to check for liabilities.
     */
    function migrateBalance(
        bytes32 recoveryId,
        address[] calldata liabilityCounterparties
    ) external nonReentrant {
        _requireAdminOrDefaultAdmin();

        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];

        if (rec.state != RS_ACTIVE) {
            revert IWalletRecovery.InvalidRecoveryState(recoveryId, rec.state, RS_ACTIVE);
        }
        if (liabilityCounterparties.length > MAX_LIABILITY_COUNTERPARTIES) {
            revert IWalletRecovery.BatchTooLarge(
                liabilityCounterparties.length,
                MAX_LIABILITY_COUNTERPARTIES
            );
        }

        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        // --- Verify zero legacy pending transfers ---
        if (ds.pendingTransferIds[rec.oldWallet].length > 0) {
            revert IWalletRecovery.RecoveryBlockedOnLegacyTransfers(rec.oldWallet);
        }
        if (ds.outgoingPendingTransferIds[rec.oldWallet].length > 0) {
            revert IWalletRecovery.RecoveryBlockedOnLegacyTransfers(rec.oldWallet);
        }

        // --- Check bilateral interbank liabilities ---
        for (uint256 i = 0; i < liabilityCounterparties.length; i++) {
            address cp = liabilityCounterparties[i];
            if (
                ds.interbankLiabilities[rec.oldWallet][cp] > 0 ||
                ds.interbankLiabilities[cp][rec.oldWallet] > 0
            ) {
                revert IWalletRecovery.RecoveryBlockedOnInterbankLiabilities(
                    rec.oldWallet, cp
                );
            }
        }

        // --- Migrate liquid balance ---
        uint256 balance = ds._balances[rec.oldWallet];
        if (balance > 0) {
            // Wave 8B: forward recovery migration to successor
            ComplianceLib.precheckGated(ds, rec.oldWallet, rec.newWallet, balance, ComplianceLib.Context.RECOVERY_MIGRATE);

            T3CommonLib.internalTransfer(ds, rec.oldWallet, rec.newWallet, balance);
            emit ERC20BaseFacet.Transfer(rec.oldWallet, rec.newWallet, balance);
        }

        // --- Migrate prefunded fee balance ---
        uint256 prefunded = ds.prefundedFeeBalances[rec.oldWallet];
        if (prefunded > 0) {
            ds.prefundedFeeBalances[rec.newWallet] += prefunded;
            ds.prefundedFeeBalances[rec.oldWallet] = 0;
        }

        // --- Migrate incentive credits ---
        StorageLib.IncentiveCredits storage oldCredits =
            ds.incentiveCredits[rec.oldWallet];
        if (oldCredits.amount > 0) {
            ds.incentiveCredits[rec.newWallet].amount += oldCredits.amount;
            ds.incentiveCredits[rec.newWallet].lastUpdated = block.timestamp;
            oldCredits.amount = 0;
            oldCredits.lastUpdated = block.timestamp;
        }

        rec.balanceMigrated = true;

        emit IWalletRecovery.RecoveryBalanceMigrated(
            recoveryId, rec.oldWallet, rec.newWallet, balance
        );
    }

    /**
     * @notice Migrate consortium and sponsor-bank state from the old wallet to the successor.
     * @dev Bounded, caller-supplied admin helper. Does NOT gate completion.
     *      Transfers bank profiles, active status, registry index, wallets,
     *      collateral positions, deposit accounts, total collateral value,
     *      pending yield, sponsor bank scalars, and revenue mappings.
     *      Calling this makes the recovery IRREVERSIBLE (DP-5.0-B) —
     *      cancelRecovery will no longer restore state. This holds even for a
     *      no-op call (empty arrays / nothing to move): the flag records that a
     *      manual, un-journaled migration pass was initiated, not what it moved.
     * @param recoveryId The recovery process identifier.
     * @param assetTypes Asset type IDs for per-asset bankWallets / bankCollateralPositions.
     * @param tokens Token addresses for pendingYieldByToken / kycBankRevenue / sponsorBankRevenue.
     */
    function migrateConsortiumState(
        bytes32 recoveryId,
        uint256[] calldata assetTypes,
        address[] calldata tokens
    ) external nonReentrant {
        _requireAdminOrDefaultAdmin();

        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];

        if (rec.state != RS_ACTIVE) {
            revert IWalletRecovery.InvalidRecoveryState(recoveryId, rec.state, RS_ACTIVE);
        }
        if (assetTypes.length > MAX_LIABILITY_COUNTERPARTIES) {
            revert IWalletRecovery.BatchTooLarge(assetTypes.length, MAX_LIABILITY_COUNTERPARTIES);
        }
        if (tokens.length > MAX_LIABILITY_COUNTERPARTIES) {
            revert IWalletRecovery.BatchTooLarge(tokens.length, MAX_LIABILITY_COUNTERPARTIES);
        }

        address oldW = rec.oldWallet;
        address newW = rec.newWallet;
        if (newW == address(0)) {
            revert IWalletRecovery.StandbyWalletInvalid(newW);
        }

        // --- ConsortiumStorage ---
        ConsortiumStorage.Layout storage l = ConsortiumStorage.layout();

        // BankProfile (no nested mapping)
        l.bankProfiles[newW] = l.bankProfiles[oldW];
        delete l.bankProfiles[oldW];

        // activeBanks
        if (l.activeBanks[oldW]) {
            l.activeBanks[newW] = true;
            delete l.activeBanks[oldW];
        }

        // registeredBanks array + bankIndexPlusOne
        uint256 idxP1 = l.bankIndexPlusOne[oldW];
        if (idxP1 != 0) {
            l.registeredBanks[idxP1 - 1] = newW;
            l.bankIndexPlusOne[newW] = idxP1;
            delete l.bankIndexPlusOne[oldW];
        }

        // Per-assetType mappings
        for (uint256 i = 0; i < assetTypes.length; i++) {
            uint256 at = assetTypes[i];
            l.bankWallets[newW][at] = l.bankWallets[oldW][at];
            delete l.bankWallets[oldW][at];
            l.bankCollateralPositions[newW][at] = l.bankCollateralPositions[oldW][at];
            delete l.bankCollateralPositions[oldW][at];
        }

        // depositAccounts (no nested mapping)
        l.depositAccounts[newW] = l.depositAccounts[oldW];
        delete l.depositAccounts[oldW];

        // bankTotalCollateralValue
        l.bankTotalCollateralValue[newW] = l.bankTotalCollateralValue[oldW];
        delete l.bankTotalCollateralValue[oldW];

        // Per-token mappings
        for (uint256 i = 0; i < tokens.length; i++) {
            address tok = tokens[i];
            l.pendingYieldByToken[newW][tok] = l.pendingYieldByToken[oldW][tok];
            delete l.pendingYieldByToken[oldW][tok];
        }

        // --- SponsorBankStorage ---
        SponsorBankStorage.Storage storage sb = SponsorBankStorage.layout();

        SponsorBankStorage.SponsorBank storage ob = sb.banks[oldW];
        if (ob.isRegistered || ob.bankAddress != address(0)) {
            SponsorBankStorage.SponsorBank storage nb = sb.banks[newW];
            nb.bankAddress = newW;
            nb.identifier = ob.identifier;
            nb.feeRate = ob.feeRate;
            nb.isActive = ob.isActive;
            nb.isRegistered = ob.isRegistered;
            nb.totalDistributions = ob.totalDistributions;
            nb.totalVolume = ob.totalVolume;
            nb.registrationTime = ob.registrationTime;
            nb.totalFeeEarned = ob.totalFeeEarned;
            delete sb.banks[oldW];
        }

        for (uint256 i = 0; i < tokens.length; i++) {
            address tok = tokens[i];
            sb.kycBankRevenue[newW][tok] = sb.kycBankRevenue[oldW][tok];
            delete sb.kycBankRevenue[oldW][tok];
            sb.sponsorBankRevenue[newW][tok] = sb.sponsorBankRevenue[oldW][tok];
            delete sb.sponsorBankRevenue[oldW][tok];
        }

        WalletRecoverySnapshotLib.markStateMigrated(recoveryId, "Consortium");
        emit IWalletRecovery.ConsortiumStateMigrated(recoveryId, oldW, newW);
    }

    /**
     * @notice Migrate institution state from the old wallet to the successor.
     * @dev Bounded, caller-supplied admin helper. Does NOT gate completion.
     *      Transfers wallet affiliation, scoped roles, and wallet policies.
     *      Calling this makes the recovery IRREVERSIBLE (DP-5.0-B) —
     *      cancelRecovery will no longer restore state. This holds even for a
     *      no-op call (empty arrays / nothing to move): the flag records that a
     *      manual, un-journaled migration pass was initiated, not what it moved.
     * @param recoveryId The recovery process identifier.
     * @param institutionIds Institution IDs parallel to scopes[].
     * @param scopes Scope values parallel to institutionIds[].
     * @param policyIds Policy IDs for walletPolicies / walletPolicySet.
     */
    function migrateInstitutionState(
        bytes32 recoveryId,
        bytes32[] calldata institutionIds,
        bytes32[] calldata scopes,
        bytes32[] calldata policyIds
    ) external nonReentrant {
        _requireAdminOrDefaultAdmin();

        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];

        if (rec.state != RS_ACTIVE) {
            revert IWalletRecovery.InvalidRecoveryState(recoveryId, rec.state, RS_ACTIVE);
        }
        if (institutionIds.length != scopes.length) {
            revert IWalletRecovery.MigrationArrayLengthMismatch();
        }
        if (institutionIds.length > MAX_LIABILITY_COUNTERPARTIES) {
            revert IWalletRecovery.BatchTooLarge(institutionIds.length, MAX_LIABILITY_COUNTERPARTIES);
        }
        if (policyIds.length > MAX_LIABILITY_COUNTERPARTIES) {
            revert IWalletRecovery.BatchTooLarge(policyIds.length, MAX_LIABILITY_COUNTERPARTIES);
        }

        address oldW = rec.oldWallet;
        address newW = rec.newWallet;
        if (newW == address(0)) {
            revert IWalletRecovery.StandbyWalletInvalid(newW);
        }

        InstitutionStorage.Layout storage inst = InstitutionStorage.layout();

        // WalletAffiliation — merge-most-restrictive; never downgrade a pre-seeded successor.
        if (inst.walletAffiliations[oldW].status != InstitutionStorage.WalletAffiliationStatus.None) {
            if (
                inst.walletAffiliations[newW].status == InstitutionStorage.WalletAffiliationStatus.None ||
                uint8(inst.walletAffiliations[oldW].status) > uint8(inst.walletAffiliations[newW].status)
            ) {
                inst.walletAffiliations[newW] = inst.walletAffiliations[oldW];
            }
            delete inst.walletAffiliations[oldW];
        }

        // Bounded re-key of scopedRoles — skip when successor already holds the role.
        for (uint256 i = 0; i < institutionIds.length; i++) {
            if (inst.scopedRoles[institutionIds[i]][scopes[i]][oldW] &&
                !inst.scopedRoles[institutionIds[i]][scopes[i]][newW]) {
                inst.scopedRoles[institutionIds[i]][scopes[i]][newW] = true;
                delete inst.scopedRoles[institutionIds[i]][scopes[i]][oldW];
            }
        }

        // Wallet policies — Task 5.1 (CF-3a): merge-most-restrictive-or-revert,
        // replacing copy-only-if-unset (which let a looser pre-seeded successor
        // override survive). Lives in the external sanctions lib (EIP-170 freeze).
        WalletRecoverySanctionsLib.mergeWalletPolicies(oldW, newW, policyIds);

        WalletRecoverySnapshotLib.markStateMigrated(recoveryId, "Institution");
        emit IWalletRecovery.InstitutionStateMigrated(recoveryId, oldW, newW);
    }

    /**
     * @notice Migrate depositor identity (TIN-hash) registry state from the old wallet to the successor.
     * @dev Bounded, caller-supplied admin helper. Does NOT gate completion.
     *      Moves up to `maxHashes` entries from bankRegistries[oldWallet] to bankRegistries[newWallet],
     *      copying per-hash salt epochs. Idempotent and paginated: safe to call repeatedly; the
     *      final call when the old registry is empty is a clean no-op.
     *      Calling this makes the recovery IRREVERSIBLE (DP-5.0-B) —
     *      cancelRecovery will no longer restore state. This holds even for a
     *      no-op call (empty arrays / nothing to move): the flag records that a
     *      manual, un-journaled migration pass was initiated, not what it moved.
     * @param recoveryId The recovery process identifier.
     * @param maxHashes Maximum hashes to migrate this call (bounded by MAX_LIABILITY_COUNTERPARTIES).
     */
    function migrateDepositorIdentityState(
        bytes32 recoveryId,
        uint256 maxHashes
    ) external nonReentrant {
        WalletRecoveryDepositorIdentityLib.migrateDepositorIdentityState(recoveryId, maxHashes);
        WalletRecoverySnapshotLib.markStateMigrated(recoveryId, "DepositorIdentity");
    }

    /**
     * @notice Complete a recovery process. Transfers roles and compacts predecessor chains.
     * @dev Transitions state from RecoveryActive(2) → RecoveryComplete(3).
     *      For KeyRotation, enforces the 48-hour timelock. Revokes CUSTODIAN_ROLE and
     *      CAMBIO_ISSUER_ROLE from the old wallet, grants to the new wallet.
     * @param recoveryId The recovery process identifier.
     * @param predecessors Addresses whose successor chains should be compacted.
     */
    function completeRecovery(
        bytes32 recoveryId,
        address[] calldata predecessors
    ) external nonReentrant {
        _requireAdminOrDefaultAdmin();

        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];

        if (rec.state != RS_ACTIVE) {
            revert IWalletRecovery.InvalidRecoveryState(recoveryId, rec.state, RS_ACTIVE);
        }
        if (predecessors.length > MAX_PREDECESSORS) {
            revert IWalletRecovery.BatchTooLarge(predecessors.length, MAX_PREDECESSORS);
        }

        // KeyRotation timelock check
        if (rec.recoveryType == 3 && block.timestamp < rec.timelockEndsAt) {
            revert IWalletRecovery.TimelockActive(recoveryId, rec.timelockEndsAt);
        }

        // Re-verify successor eligibility AT COMPLETION (not just at activation): the
        // successor's custodian registration / CUSTODIAN_ROLE / KYC can lapse between
        // activate and complete. Without this, completion would (re)grant CUSTODIAN_ROLE
        // to a now-ineligible wallet — a role-escalation race.
        _requireEligibleSuccessor(rec.newWallet);

        // --- Zero-state invariants ---
        if (!rec.balanceMigrated) {
            revert IWalletRecovery.RecoveryNotMigrated(recoveryId);
        }

        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (
            ds._balances[rec.oldWallet] != 0 ||
            ds.prefundedFeeBalances[rec.oldWallet] != 0 ||
            ds.incentiveCredits[rec.oldWallet].amount != 0
        ) {
            revert IWalletRecovery.CompletionStateNotZero(rec.oldWallet);
        }

        // --- Complete ---
        rec.state = RS_COMPLETE;

        // State-idempotent decrement
        if (ws.activeRecoveryCount[rec.oldWallet] > 0) {
            ws.activeRecoveryCount[rec.oldWallet]--;
        }

        // --- Compact predecessor chains ---
        for (uint256 i = 0; i < predecessors.length; i++) {
            if (ws.recoverySuccessor[predecessors[i]] == rec.oldWallet) {
                ws.recoverySuccessor[predecessors[i]] = rec.newWallet;
            }
        }

        // --- Role transfer ---

        // CUSTODIAN_ROLE
        if (AccessControlLib.hasRole(ds, RoleConstants.CUSTODIAN_ROLE, rec.oldWallet)) {
            AccessControlLib.revokeRole(ds, RoleConstants.CUSTODIAN_ROLE, rec.oldWallet);
            if (ds._custodians.contains(rec.oldWallet)) {
                ds._custodians.remove(rec.oldWallet);
            }
        }
        if (!AccessControlLib.hasRole(ds, RoleConstants.CUSTODIAN_ROLE, rec.newWallet)) {
            AccessControlLib.grantRole(ds, RoleConstants.CUSTODIAN_ROLE, rec.newWallet);
            if (!ds._custodians.contains(rec.newWallet)) {
                ds._custodians.add(rec.newWallet);
            }
        }

        // CAMBIO_ISSUER_ROLE
        if (AccessControlLib.hasRole(ds, RoleConstants.CAMBIO_ISSUER_ROLE, rec.oldWallet)) {
            AccessControlLib.revokeRole(ds, RoleConstants.CAMBIO_ISSUER_ROLE, rec.oldWallet);
            if (!AccessControlLib.hasRole(ds, RoleConstants.CAMBIO_ISSUER_ROLE, rec.newWallet)) {
                AccessControlLib.grantRole(ds, RoleConstants.CAMBIO_ISSUER_ROLE, rec.newWallet);
            }
        }

        emit IWalletRecovery.RecoveryComplete(
            recoveryId,
            rec.oldWallet,
            rec.newWallet,
            uint40(block.timestamp)
        );
    }

    /**
     * @notice Cancel an in-progress recovery.
     * @dev Authorization depends on recovery type and state:
     *      - KeyRotation: only ADMIN/DEFAULT_ADMIN (compromised wallet cannot cancel).
     *      - State ACTIVE: only DEFAULT_ADMIN_ROLE.
     *      - State PENDING (non-KeyRotation): initiator, ADMIN, or DEFAULT_ADMIN.
     *
     *      If envelopes or Cambio notes have already been resolved, the cancellation
     *      is marked as irreversible and the recoverySuccessor mapping is preserved.
     *
     * @param recoveryId The recovery process identifier.
     */
    function cancelRecovery(bytes32 recoveryId) external nonReentrant {
        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        WalletRecoveryStorage.RecoveryRecord storage rec = ws.recoveries[recoveryId];

        if (rec.state != RS_PENDING && rec.state != RS_ACTIVE) {
            revert IWalletRecovery.InvalidRecoveryState(recoveryId, rec.state, RS_PENDING);
        }

        // --- Authorization ---
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        if (rec.recoveryType == 3) {
            // KeyRotation: only admin roles can cancel
            _requireAdminOrDefaultAdmin();
        } else if (rec.state == RS_ACTIVE) {
            // Active non-KeyRotation: only DEFAULT_ADMIN_ROLE
            AccessControlLib.checkRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender);
        } else {
            // Pending non-KeyRotation: initiator, ADMIN, or DEFAULT_ADMIN
            bool isInitiator = msg.sender == rec.initiatedBy;
            bool isAdmin = AccessControlLib.hasRole(ds, RoleConstants.ADMIN_ROLE, msg.sender);
            bool isDefaultAdmin = AccessControlLib.hasRole(
                ds, RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender
            );
            if (!isInitiator && !isAdmin && !isDefaultAdmin) {
                revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.ADMIN_ROLE);
            }
        }

        // --- Determine irreversibility ---
        // stateMigrated (Task 5.3, DP-5.0-B): any manual migrate helper moves
        // un-journaled families, so restore would be silently lossy — fail closed.
        bool irreversible = rec.envelopesResolved > 0 || rec.cambioNotesResolved > 0
            || rec.balanceMigrated || rec.stateMigrated;

        // --- Cancel ---
        rec.state = RS_CANCELLED;

        // State-idempotent decrement
        if (ws.activeRecoveryCount[rec.oldWallet] > 0) {
            ws.activeRecoveryCount[rec.oldWallet]--;
        }

        if (!irreversible && rec.newWallet != address(0)) {
            // Reversible cancel: replay the snapshot journal in reverse (Task 5.3),
            // restoring predecessor and every prior successor bit-identical to
            // their pre-designation state across all journaled families. This
            // intentionally discards admin edits (e.g. setWalletPolicy) made to
            // either wallet MID-recovery (DP-5.0-C: cancel means "as if the
            // designation never happened"); the counter fixup compares snapshot
            // vs current armed state, so per-control counters cannot drift.
            WalletRecoverySnapshotLib.restoreFromJournal(recoveryId);
            delete ws.recoverySuccessor[rec.oldWallet];
            rec.newWallet = address(0);
        }
        // If irreversible, recoverySuccessor is intentionally preserved
        // (resolved envelopes may have already re-routed funds).

        emit IWalletRecovery.RecoveryCancelled(
            recoveryId,
            rec.oldWallet,
            msg.sender,
            irreversible
        );
    }

    /**
     * @notice Register or update a standby recovery wallet for a bank.
     * @dev The standby wallet is required for KeyRotation (type 3) recovery.
     *      Must be set in advance of any self-initiated recovery.
     * @param bankWallet The bank wallet address.
     * @param standbyWallet The pre-approved standby successor address.
     */
    function setRecoveryStandby(
        address bankWallet,
        address standbyWallet
    ) external nonReentrant {
        _requireAdminOrDefaultAdmin();
        if (bankWallet == address(0)) revert StorageLib.UserAddressZero();
        if (standbyWallet == address(0)) revert StorageLib.UserAddressZero();
        if (standbyWallet == bankWallet) {
            revert IWalletRecovery.StandbyWalletInvalid(standbyWallet);
        }

        WalletRecoveryStorage.Layout storage ws = WalletRecoveryStorage.layout();
        if (ws.activeRecoveryCount[standbyWallet] > 0) {
            revert IWalletRecovery.WalletInRecovery(standbyWallet);
        }

        _requireEligibleSuccessor(standbyWallet);

        ws.recoveryStandby[bankWallet] = standbyWallet;

        emit IWalletRecovery.RecoveryStandbySet(bankWallet, standbyWallet, msg.sender);
    }

    // =========================================================================
    // VIEW FUNCTIONS
    // =========================================================================

    /**
     * @notice Get the pre-registered standby recovery wallet for a bank.
     * @param bankWallet The bank wallet address.
     * @return The standby wallet address (or address(0) if not set).
     */
    function getRecoveryStandby(address bankWallet) external view returns (address) {
        return WalletRecoveryStorage.layout().recoveryStandby[bankWallet];
    }

    /**
     * @notice Get full details of a recovery process.
     * @param recoveryId The recovery process identifier.
     * @return id The recovery ID.
     * @return oldWallet The wallet being recovered.
     * @return newWallet The designated successor.
     * @return recoveryType The type of recovery (0–3).
     * @return state The current recovery state (0–4).
     * @return initiatedAt Timestamp of initiation.
     * @return electionWindowEndsAt Timestamp when the election window expires.
     * @return timelockEndsAt Timestamp when the KeyRotation timelock ends (0 if N/A).
     * @return envelopesResolved Number of envelopes resolved.
     * @return cambioNotesResolved Number of Cambio notes resolved.
     */
    function getRecovery(bytes32 recoveryId)
        external
        view
        returns (
            bytes32 id,
            address oldWallet,
            address newWallet,
            uint8 recoveryType,
            uint8 state,
            uint40 initiatedAt,
            uint40 electionWindowEndsAt,
            uint40 timelockEndsAt,
            uint256 envelopesResolved,
            uint256 cambioNotesResolved
        )
    {
        WalletRecoveryStorage.RecoveryRecord storage rec =
            WalletRecoveryStorage.layout().recoveries[recoveryId];
        return (
            rec.recoveryId,
            rec.oldWallet,
            rec.newWallet,
            rec.recoveryType,
            rec.state,
            rec.initiatedAt,
            rec.electionWindowEndsAt,
            rec.timelockEndsAt,
            rec.envelopesResolved,
            rec.cambioNotesResolved
        );
    }

    /**
     * @notice Get the recovery policy for a given recovery process.
     * @param recoveryId The recovery process identifier.
     * @return The RecoveryPolicy struct with default choices for sender, recipient,
     *         disputed, and pending fiat envelopes.
     */
    function getRecoveryPolicy(
        bytes32 recoveryId
    ) external view returns (IWalletRecovery.RecoveryPolicy memory) {
        return WalletRecoveryStorage.layout().recoveries[recoveryId].policy;
    }

    /**
     * @notice Check whether a specific envelope has been resolved in a recovery.
     * @param recoveryId The recovery process identifier.
     * @param envelopeId The envelope identifier.
     * @return True if the envelope has been resolved.
     */
    function isEnvelopeResolved(
        bytes32 recoveryId,
        bytes32 envelopeId
    ) external view returns (bool) {
        return WalletRecoveryStorage.layout()
            .recoveries[recoveryId].resolvedEnvelopes[envelopeId] != 0;
    }

    /**
     * @notice Get the stored override for an envelope in a recovery.
     * @dev Returns the raw stored value: 0 = use default policy, non-zero = choice + 1.
     * @param recoveryId The recovery process identifier.
     * @param envelopeId The envelope identifier.
     * @return storedOverride The raw 1-based override value.
     */
    function getEnvelopeOverride(
        bytes32 recoveryId,
        bytes32 envelopeId
    ) external view returns (uint8 storedOverride) {
        return WalletRecoveryStorage.layout()
            .recoveries[recoveryId].envelopeOverrides[envelopeId];
    }

    /**
     * @notice Check whether the election window has expired for a recovery.
     * @param recoveryId The recovery process identifier.
     * @return True if the window has expired and the recovery is in a non-terminal state.
     */
    function isElectionWindowExpired(bytes32 recoveryId) public view returns (bool) {
        WalletRecoveryStorage.RecoveryRecord storage rec =
            WalletRecoveryStorage.layout().recoveries[recoveryId];
        if (rec.state != RS_PENDING && rec.state != RS_ACTIVE) {
            return false;
        }
        return block.timestamp > rec.electionWindowEndsAt;
    }

    /**
     * @notice Emit an event signaling that the election window has expired.
     * @dev Can be called by anyone to publish the on-chain signal. Reverts if the
     *      window has not yet expired.
     * @param recoveryId The recovery process identifier.
     */
    function emitElectionWindowExpired(bytes32 recoveryId) external {
        if (!isElectionWindowExpired(recoveryId)) {
            revert IWalletRecovery.ElectionWindowNotExpired(recoveryId);
        }

        WalletRecoveryStorage.RecoveryRecord storage rec =
            WalletRecoveryStorage.layout().recoveries[recoveryId];

        emit IWalletRecovery.RecoveryElectionWindowExpired(
            recoveryId,
            rec.electionWindowEndsAt,
            msg.sender
        );
    }
}
