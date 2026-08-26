// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { CambioEnvelopeStorage } from "../lib/CambioEnvelopeStorage.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { EscrowLib } from "../lib/EscrowLib.sol";
import { ClaimAttributionLib } from "../lib/ClaimAttributionLib.sol";
import { ICambioIssuer } from "../interfaces/ICambioIssuer.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { ComplianceLib } from "../lib/ComplianceLib.sol";
import { ComplianceTravelRuleLib } from "../lib/ComplianceTravelRuleLib.sol";
import { ComplianceHoldLib } from "../lib/ComplianceHoldLib.sol";
import { ViewACLLib } from "../lib/ViewACLLib.sol";

/**
 * @title CambioEnvelopeFacet
 * @notice Phase management, note lifecycle, and risk-control helpers for envelope-mode Cambio.
 * @dev All storage access goes through CambioEnvelopeStorage.layout().
 *      Does NOT read or write legacy Cambio fields in AppStorage.
 */
contract CambioEnvelopeFacet is ReentrancyGuardBase {
    using EnumerableSet for EnumerableSet.AddressSet;

    // --- Events ---
    event CambioPhaseAdvanced(CambioEnvelopeStorage.CambioEnvelopePhase newPhase);

    // --- Modifiers ---
    modifier onlyCambioAdmin() {
        if (!IAccessControl(address(this)).hasRole(RoleConstants.CAMBIO_ADMIN_ROLE, msg.sender) &&
            !IAccessControl(address(this)).hasRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.CAMBIO_ADMIN_ROLE);
        }
        _;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      PHASE MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Advance the Cambio envelope phase forward by one step.
     * @dev DISABLED → ENABLED → LEGACY_REMOVED. No reverse transitions.
     */
    function advanceCambioPhase() external onlyCambioAdmin {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        CambioEnvelopeStorage.CambioEnvelopePhase current = es.phase;
        CambioEnvelopeStorage.CambioEnvelopePhase next;

        if (current == CambioEnvelopeStorage.CambioEnvelopePhase.DISABLED) {
            next = CambioEnvelopeStorage.CambioEnvelopePhase.ENABLED;
        } else if (current == CambioEnvelopeStorage.CambioEnvelopePhase.ENABLED) {
            next = CambioEnvelopeStorage.CambioEnvelopePhase.LEGACY_REMOVED;
        } else {
            revert CambioEnvelopeStorage.CambioInvalidPhaseTransition();
        }

        es.phase = next;
        emit CambioPhaseAdvanced(next);
    }

    /**
     * @notice Returns the current envelope phase.
     */
    function getCambioEnvelopePhase()
        external
        view
        returns (CambioEnvelopeStorage.CambioEnvelopePhase)
    {
        return CambioEnvelopeStorage.layout().phase;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      NOTE CREATION
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Create an envelope-mode Cambio note.
     * @param amount The amount of T3USD to escrow.
     * @param phraseCommitment keccak256(abi.encode(phrase, noteSalt)) computed off-chain.
     * @param noteSalt Per-note domain separator. Public and not secret, but MUST be unique
     * per note — reuse across notes with the same phrase enables cross-note replay attacks.
     * @param deadline Timestamp after which the note expires.
     * @param metadata Optional metadata string (hashed for receipt, not stored raw).
     * @return noteId The unique identifier for the created note.
     */
    function createCambioNote(
        uint256 amount,
        bytes32 phraseCommitment,
        bytes32 noteSalt,
        uint48 deadline,
        string calldata metadata
    ) external returns (bytes32 noteId) {
        _requireEnvelopePhaseEnabled();

        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        if (es.config.cambioPaused) {
            revert StorageLib.CambioPaused();
        }

        address issuer = _msgSenderCambio();

        // Quarantine check: issuer cannot be in recovery
        if (WalletRecoveryStorage.layout().activeRecoveryCount[issuer] > 0) {
            revert IWalletRecovery.WalletInRecovery(issuer);
        }

        // Role check
        if (!IAccessControl(address(this)).hasRole(RoleConstants.CAMBIO_ISSUER_ROLE, issuer)) {
            revert StorageLib.UnauthorizedRole(issuer, RoleConstants.CAMBIO_ISSUER_ROLE);
        }

        // Issuer effective state check (ACTIVE only; ISSUANCE_PAUSED and FULLY_PAUSED blocked)
        CambioEnvelopeStorage.PauseState effective = ICambioIssuer(address(this)).issuerEffectiveState(issuer);
        if (effective != CambioEnvelopeStorage.PauseState.ACTIVE) {
            revert CambioEnvelopeStorage.IssuerFullyPaused(issuer);
        }

        // Max note value check
        uint256 maxNoteValue = es.config.maxNoteValue;
        if (maxNoteValue > 0 && amount > maxNoteValue) {
            revert CambioEnvelopeStorage.MaxNoteValueExceeded(amount, maxNoteValue);
        }

        // Max outstanding checks
        _checkMaxOutstanding(issuer);

        // Wave 8B: forward escrow in (bearer note has no predetermined recipient)
        ComplianceLib.precheckGated(ds, issuer, address(0), amount, ComplianceLib.Context.ESCROW_IN);

        // Metadata length check
        uint256 metadataLength = bytes(metadata).length;
        uint256 maxMetadataLength = es.config.maxMetadataLength;
        if (maxMetadataLength > 0 && metadataLength > maxMetadataLength) {
            revert CambioEnvelopeStorage.MetadataTooLong(metadataLength, maxMetadataLength);
        }

        // Generate noteId
        noteId = keccak256(abi.encode(block.chainid, address(this), issuer, ++es.envelopeNoteCounter));

        // Wave 8D: atomic travel-rule binding at create time
        // Bearer note: commitment recipient is address(0), matching precheckGated above.
        ComplianceTravelRuleLib.bindOnCreate(
            ds, issuer, address(0), noteId, amount, ComplianceTravelRuleLib.OBJ_CAMBIO_NOTE
        );

        // Capture issuer profile snapshot at creation time
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile = es.issuerProfiles[issuer];
        bool openRedemptionSnapshot = profile.openRedemption;
        bool requiresCommitReveal = amount >= es.config.commitRevealThreshold;

        // Create note
        es.envelopeNotes[noteId] = CambioEnvelopeStorage.CambioEnvelopeNote({
            issuer: issuer,
            escrowedAmount: amount,
            spent: 0,
            createdAt: uint48(block.timestamp),
            deadline: deadline,
            active: true,
            phraseCommitment: phraseCommitment,
            noteSalt: noteSalt,
            openRedemptionSnapshot: openRedemptionSnapshot,
            requiresCommitReveal: requiresCommitReveal
        });

        // Update issuer audit counters
        profile.notesOutstanding++;
        profile.valueOutstanding += amount;
        profile.notesIssued++;

        // Escrow T3USD in the diamond (claim-attributed)
        EscrowLib.escrowFrom(issuer, ClaimAttributionLib.CAMBIO_NOTE_DOMAIN, noteId, amount);
        profile.t3usdEscrowed += amount;

        emit CambioEnvelopeStorage.CambioEnvelopeNoteCreated(
            noteId,
            issuer,
            amount,
            deadline,
            phraseCommitment,
            openRedemptionSnapshot,
            requiresCommitReveal
        );

        return noteId;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      REDEMPTION
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Redeem an envelope note by presenting the secret phrase.
     * @param noteId The note to redeem.
     * @param phrase The secret phrase (revealed at redemption time).
     * @param amount The amount to redeem.
     * @param nonce Per-redeemer single-use nonce.
     * @param metadata Optional metadata for the receipt.
     */
    function redeemByPhrase(
        bytes32 noteId,
        string calldata phrase,
        uint256 amount,
        uint256 nonce,
        string calldata metadata
    ) external {
        _requireEnvelopePhaseEnabled();

        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        if (es.config.cambioPaused) {
            revert StorageLib.CambioPaused();
        }

        CambioEnvelopeStorage.CambioEnvelopeNote storage note = es.envelopeNotes[noteId];

        address effectiveIssuer = resolveEffectiveIssuer(note.issuer);
        CambioEnvelopeStorage.PauseState effectiveState = ICambioIssuer(address(this)).issuerEffectiveState(effectiveIssuer);
        if (effectiveState == CambioEnvelopeStorage.PauseState.FULLY_PAUSED) {
            revert CambioEnvelopeStorage.IssuerFullyPaused(effectiveIssuer);
        }

        // For open bearer notes, redeemByPhrase MUST come through the trusted forwarder.
        // Notes with requiresCommitReveal == true revert immediately with CommitRevealRequired,
        // so the forwarder gate is not reached for that path.
        if (note.openRedemptionSnapshot && !note.requiresCommitReveal) {
            // CRITICAL: use msg.sender, NOT _msgSender()
            // In ERC-2771, msg.sender is the forwarder contract; _msgSender() is the extracted redeemer
            if (msg.sender != ds.trustedForwarder) {
                revert CambioEnvelopeStorage.RelayerRequired(noteId);
            }
        }

        // High-value notes MUST use commit-reveal path
        if (note.requiresCommitReveal) {
            revert CambioEnvelopeStorage.CommitRevealRequired(noteId);
        }

        address redeemer = _msgSenderCambio();

        // Verify phrase FIRST
        if (keccak256(abi.encode(phrase, note.noteSalt)) != note.phraseCommitment) {
            revert CambioEnvelopeStorage.InvalidPhrase(noteId);
        }

        _redeemCommon(es, ds, noteId, note, redeemer, amount, nonce, metadata, true);
        _executeRedemption(es, ds, noteId, note, redeemer, amount, nonce, metadata);
    }

    /**
     * @notice Redeem an envelope note by noteId (role-gated or issuer self-recovery).
     * @dev CRITICAL SECURITY GATE: reverts for open bearer notes (openRedemptionSnapshot == true),
     *      except issuer self-recovery post-deadline.
     * @param noteId The note to redeem.
     * @param amount The amount to redeem.
     * @param nonce Per-redeemer single-use nonce.
     * @param metadata Optional metadata for the receipt.
     */
    function redeemByNoteId(
        bytes32 noteId,
        uint256 amount,
        uint256 nonce,
        string calldata metadata
    ) external {
        _requireEnvelopePhaseEnabled();

        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        if (es.config.cambioPaused) {
            revert StorageLib.CambioPaused();
        }

        address redeemer = _msgSenderCambio();
        CambioEnvelopeStorage.CambioEnvelopeNote storage note = es.envelopeNotes[noteId];

        if (note.requiresCommitReveal) {
            revert CambioEnvelopeStorage.CommitRevealRequired(noteId);
        }

        address effectiveIssuer = resolveEffectiveIssuer(note.issuer);
        CambioEnvelopeStorage.PauseState effectiveState = ICambioIssuer(address(this)).issuerEffectiveState(effectiveIssuer);
        if (effectiveState == CambioEnvelopeStorage.PauseState.FULLY_PAUSED) {
            revert CambioEnvelopeStorage.IssuerFullyPaused(effectiveIssuer);
        }

        // Open bearer notes MUST use redeemByPhrase
        if (note.openRedemptionSnapshot) {
            revert CambioEnvelopeStorage.OpenRedemptionRequired(noteId);
        }

        // Issuer self-recovery: own note, post-deadline, active — no role required
        bool isIssuerRecovery = ((redeemer == note.issuer || redeemer == effectiveIssuer) && block.timestamp > note.deadline && note.active);

        if (!isIssuerRecovery) {
            // Role-gated: requires CAMBIO_REDEEMER_ROLE or CAMBIO_ISSUER_ROLE
            if (!IAccessControl(address(this)).hasRole(RoleConstants.CAMBIO_REDEEMER_ROLE, redeemer) &&
                !IAccessControl(address(this)).hasRole(RoleConstants.CAMBIO_ISSUER_ROLE, redeemer)) {
                revert StorageLib.UnauthorizedRole(redeemer, RoleConstants.CAMBIO_REDEEMER_ROLE);
            }
        }

        _redeemCommon(es, ds, noteId, note, redeemer, amount, nonce, metadata, !isIssuerRecovery);
        _executeRedemption(es, ds, noteId, note, redeemer, amount, nonce, metadata);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      CANCELLATION
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Cancel an active envelope note and return remaining escrow to the issuer.
     * @param noteId The note to cancel.
     */
    function cancelEnvelopeNote(bytes32 noteId) external {
        _requireEnvelopePhaseEnabled();

        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        if (es.config.cambioPaused) {
            revert StorageLib.CambioPaused();
        }

        address issuer = _msgSenderCambio();
        CambioEnvelopeStorage.CambioEnvelopeNote storage note = es.envelopeNotes[noteId];

        address effectiveIssuer = resolveEffectiveIssuer(note.issuer);
        if (effectiveIssuer != issuer && note.issuer != issuer) {
            revert CambioEnvelopeStorage.NotNoteIssuer(noteId, issuer);
        }

        if (!note.active) {
            revert CambioEnvelopeStorage.NoteNotActive(noteId);
        }
        if (ComplianceHoldLib.isHeld(ClaimAttributionLib.CAMBIO_NOTE_DOMAIN, noteId)) {
            revert ComplianceHoldLib.ComplianceHoldActive(noteId);
        }

        uint256 remaining = note.escrowedAmount - note.spent;

        // Task 4.3 (D2): a screened-out issuer parks the remaining escrow in
        // an admin hold; note state and issuer counters stay untouched until
        // disposition (from = address(0): bearer note has no specific
        // counterparty on the cancel leg). Pass the RAW issuer — the hold lib
        // resolves recovery/succession exactly once at disposition, and
        // compliance flags migrate to successors atomically (8E-1 DP-B), so
        // screening the raw party is equivalent.
        if (ComplianceHoldLib.checkOrHold(
            ClaimAttributionLib.CAMBIO_NOTE_DOMAIN,
            noteId,
            address(0),
            note.issuer,
            remaining,
            ComplianceLib.Context.ESCROW_RELEASE,
            bytes32(0),
            1, // priorState: note active
            ComplianceHoldLib.LEG_NOTE_CANCEL
        )) return;

        note.active = false;

        // Update issuer audit counters on effective issuer
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile = es.issuerProfiles[effectiveIssuer];
        profile.notesOutstanding--;
        profile.valueOutstanding -= remaining;
        profile.t3usdCancelled += remaining;

        // Return remaining T3USD to effective issuer (claim-attributed)
        EscrowLib.releaseEscrow(effectiveIssuer, ClaimAttributionLib.CAMBIO_NOTE_DOMAIN, noteId, remaining);

        emit CambioEnvelopeStorage.CambioEnvelopeNoteCancelled(noteId, effectiveIssuer, remaining);
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════

    function _msgSenderCambio() internal view returns (address sender) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (ds.trustedForwarder != address(0) && msg.sender == ds.trustedForwarder && msg.data.length >= 20) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    /**
     * @dev Shared redemption validation. If checkDeadline is true, reverts on expired notes.
     */
    function _redeemCommon(
        CambioEnvelopeStorage.Layout storage es,
        StorageLib.AppStorage storage ds,
        bytes32 noteId,
        CambioEnvelopeStorage.CambioEnvelopeNote storage note,
        address redeemer,
        uint256 amount,
        uint256 nonce,
        string memory metadata,
        bool checkDeadline
    ) internal view {
        if (!note.active) {
            revert CambioEnvelopeStorage.NoteNotActive(noteId);
        }

        if (checkDeadline && note.deadline < block.timestamp) {
            // note.active = false; // Cannot modify in view function; callers handle this in _executeRedemption
            revert CambioEnvelopeStorage.CambioNoteExpired(noteId);
        }

        uint256 remaining = note.escrowedAmount - note.spent;
        if (amount > remaining) {
            revert CambioEnvelopeStorage.InvalidRedemptionAmount(noteId, amount, remaining);
        }

        if (es.envelopeSpentNonces[redeemer][nonce]) {
            revert CambioEnvelopeStorage.NonceAlreadySpent(redeemer, nonce);
        }

        uint256 metadataLength = bytes(metadata).length;
        uint256 maxMetadataLength = es.config.maxMetadataLength;
        if (maxMetadataLength > 0 && metadataLength > maxMetadataLength) {
            revert CambioEnvelopeStorage.MetadataTooLong(metadataLength, maxMetadataLength);
        }
    }

    /**
     * @dev Execute the redemption: transfer funds, update state, generate receipt.
     */
    function _executeRedemption(
        CambioEnvelopeStorage.Layout storage es,
        StorageLib.AppStorage storage ds,
        bytes32 noteId,
        CambioEnvelopeStorage.CambioEnvelopeNote storage note,
        address redeemer,
        uint256 amount,
        uint256 nonce,
        string memory metadata
    ) internal {
        // Task 4.3: one guard covers every redemption entrypoint (phrase /
        // noteId incl. issuer self-recovery / commit-reveal) — a held note
        // cannot pay out until admin disposition.
        if (ComplianceHoldLib.isHeld(ClaimAttributionLib.CAMBIO_NOTE_DOMAIN, noteId)) {
            revert ComplianceHoldLib.ComplianceHoldActive(noteId);
        }

        // Mark nonce spent
        es.envelopeSpentNonces[redeemer][nonce] = true;

        address effectiveIssuer = resolveEffectiveIssuer(note.issuer);

        // Daily ceiling check
        _checkDailyCeiling(effectiveIssuer, amount);

        // Task 4.3 (D2, replaces the Wave 8B reverting precheck): a
        // screened-out redeemer parks the payout in an admin hold. The nonce
        // stays consumed and the ceiling stays charged — the redemption
        // request was accepted; only payment is deferred to disposition.
        if (ComplianceHoldLib.checkOrHold(
            ClaimAttributionLib.CAMBIO_NOTE_DOMAIN,
            noteId,
            effectiveIssuer,
            redeemer,
            amount,
            ComplianceLib.Context.ESCROW_RELEASE,
            bytes32(0),
            1, // priorState: note active
            ComplianceHoldLib.LEG_NOTE_REDEMPTION
        )) return;

        // Update note state
        note.spent += amount;
        uint256 remaining = note.escrowedAmount - note.spent;

        // Update issuer audit counters on effective issuer
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile = es.issuerProfiles[effectiveIssuer];
        profile.valueOutstanding -= amount;
        profile.t3usdRedeemed += amount;

        if (remaining == 0) {
            note.active = false;
            profile.notesOutstanding--;
        }

        // Transfer T3USD to redeemer (claim-attributed)
        EscrowLib.releaseEscrow(redeemer, ClaimAttributionLib.CAMBIO_NOTE_DOMAIN, noteId, amount);

        // Generate receipt
        bytes32 receiptId = _generateReceipt(noteId, effectiveIssuer, redeemer, amount, metadata);

        emit CambioEnvelopeStorage.CambioEnvelopeNoteRedeemed(noteId, redeemer, amount, remaining, receiptId);
        emit IWalletRecovery.NoteRedeemed(noteId, note.issuer, effectiveIssuer, redeemer, amount);
    }

    /**
     * @dev Generate and store a redemption receipt.
     */
    function _generateReceipt(
        bytes32 noteId,
        address issuer,
        address redeemer,
        uint256 amount,
        string memory metadata
    ) internal returns (bytes32 receiptId) {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        bytes32 metadataHash = keccak256(bytes(metadata));
        receiptId = keccak256(abi.encode(
            block.chainid,
            address(this),
            noteId,
            redeemer,
            amount,
            metadataHash,
            ++es.envelopeReceiptCounter,
            block.timestamp
        ));

        es.envelopeReceipts[receiptId] = CambioEnvelopeStorage.CambioEnvelopeReceipt({
            noteId: noteId,
            issuer: issuer,
            redeemer: redeemer,
            amount: amount,
            timestamp: uint48(block.timestamp),
            metadataHash: metadataHash
        });

        es.envelopeReceiptsByNote[noteId].push(receiptId);
        return receiptId;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      COMMIT-REVEAL SYSTEM
    // ═══════════════════════════════════════════════════════════════════

    /**
     * @notice Commit to a future redemption. Binds noteId, phrase, redeemer, amount, and nonce.
     * @param commitmentHash keccak256(abi.encode(chainid, address(this), noteId, phrase, redeemer, amount, nonce))
     * @param expiresAt Timestamp after which the commit is invalid. Must be <= block.timestamp + maxCommitLifetime.
     */
    function commitRedemption(
        bytes32 commitmentHash,
        uint256 expiresAt
    ) external {
        _requireEnvelopePhaseEnabled();

        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();

        if (es.config.cambioPaused) {
            revert StorageLib.CambioPaused();
        }

        if (es.commitments[commitmentHash].exists) {
            revert CambioEnvelopeStorage.CommitAlreadyExists(commitmentHash);
        }

        uint256 maxCommitLifetime = es.config.maxCommitLifetime;
        if (expiresAt > block.timestamp + maxCommitLifetime) {
            revert CambioEnvelopeStorage.MaxCommitLifetimeExceeded(expiresAt, block.timestamp + maxCommitLifetime);
        }
        if (expiresAt <= block.timestamp) {
            revert CambioEnvelopeStorage.InvalidCommit(commitmentHash);
        }

        address redeemer = _msgSenderCambio();

        es.commitments[commitmentHash] = CambioEnvelopeStorage.CommitRecord({
            redeemer: redeemer,
            expiresAt: expiresAt,
            exists: true
        });

        emit CambioEnvelopeStorage.CommitRedemption(commitmentHash, redeemer, expiresAt);
    }

    /**
     * @notice Reveal a committed redemption and claim the funds.
     * @param noteId The note to redeem.
     * @param phrase The secret phrase.
     * @param amount The committed amount to redeem.
     * @param nonce The committed nonce.
     */
    function revealRedemption(
        bytes32 noteId,
        string calldata phrase,
        uint256 amount,
        uint256 nonce
    ) external {
        _requireEnvelopePhaseEnabled();

        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        if (es.config.cambioPaused) {
            revert StorageLib.CambioPaused();
        }

        address redeemer = _msgSenderCambio();

        bytes32 commitmentHash = keccak256(abi.encode(
            block.chainid,
            address(this),
            noteId,
            phrase,
            redeemer,
            amount,
            nonce
        ));

        CambioEnvelopeStorage.CommitRecord storage commit = es.commitments[commitmentHash];
        if (!commit.exists) {
            revert CambioEnvelopeStorage.InvalidCommit(commitmentHash);
        }
        if (commit.expiresAt < block.timestamp) {
            revert CambioEnvelopeStorage.CommitExpired(commitmentHash);
        }
        if (commit.redeemer != redeemer) {
            revert CambioEnvelopeStorage.CommitRedeemerMismatch(commitmentHash, commit.redeemer, redeemer);
        }

        CambioEnvelopeStorage.CambioEnvelopeNote storage note = es.envelopeNotes[noteId];

        address effectiveIssuer = resolveEffectiveIssuer(note.issuer);
        CambioEnvelopeStorage.PauseState effectiveState = ICambioIssuer(address(this)).issuerEffectiveState(effectiveIssuer);
        if (effectiveState == CambioEnvelopeStorage.PauseState.FULLY_PAUSED) {
            revert CambioEnvelopeStorage.IssuerFullyPaused(effectiveIssuer);
        }

        // Verify phrase against commitment + salt
        if (keccak256(abi.encode(phrase, note.noteSalt)) != note.phraseCommitment) {
            revert CambioEnvelopeStorage.InvalidPhrase(noteId);
        }

        // Consume the commitment BEFORE external interaction
        delete es.commitments[commitmentHash];
        emit CambioEnvelopeStorage.CommitCleared(commitmentHash, redeemer, noteId, amount);

        _redeemCommon(es, ds, noteId, note, redeemer, amount, nonce, "", true);
        _executeRedemption(es, ds, noteId, note, redeemer, amount, nonce, "");
    }

    /**
     * @notice Clear an expired commitment. Callable by anyone.
     * @param commitmentHash The commitment to clear.
     */
    function clearExpiredCommit(bytes32 commitmentHash) external {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();

        CambioEnvelopeStorage.CommitRecord storage commit = es.commitments[commitmentHash];
        if (!commit.exists) {
            revert CambioEnvelopeStorage.InvalidCommit(commitmentHash);
        }
        if (commit.expiresAt >= block.timestamp) {
            revert CambioEnvelopeStorage.InvalidCommit(commitmentHash);
        }

        address redeemer = commit.redeemer;
        delete es.commitments[commitmentHash];
        emit CambioEnvelopeStorage.CommitCancelled(commitmentHash, redeemer);
    }

    /**
     * @notice Cancel a commitment before it expires. Callable only by the committer.
     * @param commitmentHash The commitment to cancel.
     */
    function cancelCommit(bytes32 commitmentHash) external {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();

        CambioEnvelopeStorage.CommitRecord storage commit = es.commitments[commitmentHash];
        if (!commit.exists) {
            revert CambioEnvelopeStorage.InvalidCommit(commitmentHash);
        }
        if (commit.expiresAt < block.timestamp) {
            revert CambioEnvelopeStorage.CommitExpired(commitmentHash);
        }

        address redeemer = _msgSenderCambio();
        if (commit.redeemer != redeemer) {
            revert CambioEnvelopeStorage.CommitRedeemerMismatch(commitmentHash, commit.redeemer, redeemer);
        }

        delete es.commitments[commitmentHash];
        emit CambioEnvelopeStorage.CommitCancelled(commitmentHash, redeemer);
    }

    /**
     * @notice Batch clear expired commitments. No-op on non-existent or non-expired commits.
     * @param commitmentHashes Array of commitments to clear.
     */
    function clearExpiredCommits(bytes32[] calldata commitmentHashes) external {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();

        for (uint256 i = 0; i < commitmentHashes.length; ) {
            bytes32 commitmentHash = commitmentHashes[i];
            CambioEnvelopeStorage.CommitRecord storage commit = es.commitments[commitmentHash];

            if (commit.exists && commit.expiresAt < block.timestamp) {
                address redeemer = commit.redeemer;
                delete es.commitments[commitmentHash];
                emit CambioEnvelopeStorage.CommitCancelled(commitmentHash, redeemer);
            }

            unchecked { ++i; }
        }
    }

    /**
     * @dev Reverts if the envelope phase is DISABLED.
     *      Envelope write functions (create note, redeem, cancel, etc.) MUST call this.
     */
    function _requireEnvelopePhaseEnabled() internal view {
        if (CambioEnvelopeStorage.layout().phase == CambioEnvelopeStorage.CambioEnvelopePhase.DISABLED) {
            revert CambioEnvelopeStorage.CambioEnvelopeDisabled();
        }
    }

    /**
     * @dev Checks issuer outstanding note count and total value against configured caps.
     *      Reverts if either cap would be exceeded.
     */
    function _checkMaxOutstanding(address issuer) internal view {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile = es.issuerProfiles[issuer];
        CambioEnvelopeStorage.CambioEnvelopeConfig storage cfg = es.config;

        // Use per-issuer cap if set; otherwise fall back to global config default.
        // A value of 0 means unlimited (permissive default during legacy cutover).
        uint256 maxCount = profile.maxOutstandingNoteCount;
        if (maxCount == 0) {
            maxCount = cfg.globalMaxOutstandingNoteCount;
        }
        if (maxCount > 0 && profile.notesOutstanding >= maxCount) {
            revert CambioEnvelopeStorage.CambioMaxOutstandingNotesExceeded(
                issuer,
                profile.notesOutstanding,
                maxCount
            );
        }

        uint256 maxValue = profile.maxOutstandingNoteValue;
        if (maxValue == 0) {
            maxValue = cfg.globalMaxOutstandingNoteValue;
        }
        if (maxValue > 0 && profile.valueOutstanding >= maxValue) {
            revert CambioEnvelopeStorage.CambioMaxOutstandingValueExceeded(
                issuer,
                profile.valueOutstanding,
                maxValue
            );
        }
    }

    /**
     * @notice Rolling 24-hour redemption ceiling check.
     * @dev Uses 24 hourly buckets. Bucket index: (block.timestamp / 3600) % 24.
     * The loop zeros out recycled bucket slots from lastUpdatedHour+1 through currentHour
     * inclusive. This includes the current hour's slot, which is being reset for reuse
     * in the current transaction. lastUpdatedHour defaults to 0 (Unix epoch), and since
     * currentHour is always >> 24, the first call correctly triggers the full-clear branch.
     */
    function _checkDailyCeiling(address issuer, uint256 amount) internal {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        CambioEnvelopeStorage.IssuerEnvelopeProfile storage profile = es.issuerProfiles[issuer];
        uint256 ceiling = profile.dailyRedemptionCeiling;
        if (ceiling == 0) return;

        CambioEnvelopeStorage.RollingCeilingBuckets storage buckets = es.issuerCeilingBuckets[issuer];
        uint256 currentHour = block.timestamp / 3600;
        uint256 bucketIndex = currentHour % 24;

        // Zero out buckets that have aged out since last update
        if (buckets.lastUpdatedHour < currentHour) {
            uint256 hoursPassed = currentHour - buckets.lastUpdatedHour;
            if (hoursPassed >= 24) {
                // All buckets are stale
                for (uint256 i = 0; i < 24; ) {
                    buckets.buckets[i] = 0;
                    unchecked { ++i; }
                }
            } else {
                for (uint256 i = 1; i <= hoursPassed; ) {
                    uint256 staleIndex = (buckets.lastUpdatedHour + i) % 24;
                    buckets.buckets[staleIndex] = 0;
                    unchecked { ++i; }
                }
            }
            buckets.lastUpdatedHour = currentHour;
        }

        // Compute rolling total over all 24 buckets
        uint256 rollingTotal = 0;
        for (uint256 i = 0; i < 24; ) {
            rollingTotal += buckets.buckets[i];
            unchecked { ++i; }
        }

        if (rollingTotal + amount > ceiling) {
            revert CambioEnvelopeStorage.CambioDailyRedemptionCeilingExceeded(
                issuer,
                amount,
                ceiling
            );
        }

        buckets.buckets[bucketIndex] += amount;
    }

    // ═══════════════════════════════════════════════════════════════════
    //                      VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════
    // C-F10: issuer- and note-scoped views are gated by ViewACLLib.
    // Deliberate exceptions kept public: getCambioEnvelopePhase and
    // getCambioEnvelopeConfig (network-level configuration, no per-party data)
    // and resolveEffectiveIssuer (recovery successor mapping is already
    // emitted in recovery events on the permissioned network).

    function getCambioEnvelopeConfig()
        external
        view
        returns (
            uint256 maxNoteValue,
            uint48 minDeadlineBuffer,
            uint48 maxDeadlineWindow,
            uint32 maxMetadataLength,
            uint256 commitRevealThreshold,
            uint48 maxCommitLifetime,
            bool cambioPaused
        )
    {
        CambioEnvelopeStorage.CambioEnvelopeConfig storage cfg = CambioEnvelopeStorage.layout().config;
        return (
            cfg.maxNoteValue,
            cfg.minDeadlineBuffer,
            cfg.maxDeadlineWindow,
            cfg.maxMetadataLength,
            cfg.commitRevealThreshold,
            cfg.maxCommitLifetime,
            cfg.cambioPaused
        );
    }

    function getIssuerEnvelopeProfile(address issuer)
        external
        view
        returns (CambioEnvelopeStorage.IssuerEnvelopeProfile memory)
    {
        ViewACLLib.requireWalletAccess(issuer);
        return CambioEnvelopeStorage.layout().issuerProfiles[issuer];
    }

    function getIssuerCeilingBuckets(address issuer)
        external
        view
        returns (uint256[24] memory buckets, uint256 lastUpdatedHour)
    {
        ViewACLLib.requireWalletAccess(issuer);
        CambioEnvelopeStorage.RollingCeilingBuckets storage b = CambioEnvelopeStorage.layout().issuerCeilingBuckets[issuer];
        return (b.buckets, b.lastUpdatedHour);
    }

    /// @dev Note-issuer-scoped: bearer holders redeem via phrase reveal and do
    ///      not need this view; a non-existent noteId resolves to
    ///      requireWalletAccess(address(0)) — operator-only — so strangers
    ///      cannot probe note existence.
    function getCambioEnvelopeNote(bytes32 noteId)
        external
        view
        returns (CambioEnvelopeStorage.CambioEnvelopeNote memory)
    {
        CambioEnvelopeStorage.CambioEnvelopeNote memory note =
            CambioEnvelopeStorage.layout().envelopeNotes[noteId];
        ViewACLLib.requireWalletAccess(note.issuer);
        return note;
    }

    /// @dev Redeemer may read their own receipt; otherwise issuer-scoped.
    function getCambioEnvelopeReceipt(bytes32 receiptId)
        external
        view
        returns (CambioEnvelopeStorage.CambioEnvelopeReceipt memory)
    {
        CambioEnvelopeStorage.CambioEnvelopeReceipt memory receipt =
            CambioEnvelopeStorage.layout().envelopeReceipts[receiptId];
        if (msg.sender != receipt.redeemer) {
            ViewACLLib.requireWalletAccess(receipt.issuer);
        }
        return receipt;
    }

    /// @dev Issuer-scoped audit list — deliberately NO redeemer carve-out. A note
    ///      can have many redeemers; the list would expose other redeemers' receipt
    ///      ids to any one of them. Redeemers read their own receipt via
    ///      getCambioEnvelopeReceipt.
    function getCambioEnvelopeReceiptsForNote(bytes32 noteId)
        external
        view
        returns (bytes32[] memory)
    {
        ViewACLLib.requireWalletAccess(
            CambioEnvelopeStorage.layout().envelopeNotes[noteId].issuer
        );
        return CambioEnvelopeStorage.layout().envelopeReceiptsByNote[noteId];
    }

    /**
     * @notice Resolve effective issuer with a bounded 3-hop lookup loop to handle chained recoveries.
     * @param issuer The original issuer address.
     * @return The effective issuer address after traversing recovery mapping up to 3 hops.
     */
    function resolveEffectiveIssuer(address issuer) public view returns (address) {
        address current = issuer;
        WalletRecoveryStorage.Layout storage s = WalletRecoveryStorage.layout();
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
