// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { T3CommonLib } from "../lib/T3CommonLib.sol";
import { EscrowLib } from "../lib/EscrowLib.sol";
import { ClaimAttributionLib } from "../lib/ClaimAttributionLib.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
/**
 * @title CambioRedemptionFacet
 * @notice Allows licensed redeemers to burn QR-backed notes and release escrowed funds.
 */
contract CambioRedemptionFacet is ReentrancyGuardBase {
    using EnumerableSet for EnumerableSet.AddressSet;
    uint256 private constant MIN_PHRASE_LENGTH = 8;
    uint256 private constant MAX_PHRASE_LENGTH = 160;
    event CambioNoteRedeemed(
        bytes32 indexed noteId,
        address indexed redeemer,
        uint256 amount,
        uint256 remaining,
        bytes32 receiptId
    );

    modifier whenNotPaused() {
        if (StorageLib.diamondStorage()._paused) {
            revert("Pausable: paused");
        }
        _;
    }

    modifier whenCambioActive() {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (ds.cambioConfig.cambioPaused) {
            revert StorageLib.CambioPaused();
        }
        _;
    }

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

    function _requireRedeemer(StorageLib.AppStorage storage ds, address account) internal view {
        if (
            !ds._roles[RoleConstants.CAMBIO_REDEEMER_ROLE].contains(account) &&
            !ds._roles[RoleConstants.CAMBIO_ISSUER_ROLE].contains(account)
        ) {
            revert StorageLib.UnauthorizedRole(account, RoleConstants.CAMBIO_REDEEMER_ROLE);
        }
    }

    function _derivePhraseHash(string calldata phrase) internal pure returns (bytes32) {
        bytes memory phraseBytes = bytes(phrase);
        uint256 length = phraseBytes.length;
        if (length < MIN_PHRASE_LENGTH) {
            revert StorageLib.CambioPhraseTooShort(length, MIN_PHRASE_LENGTH);
        }
        if (length > MAX_PHRASE_LENGTH) {
            revert StorageLib.CambioPhraseTooLong(length, MAX_PHRASE_LENGTH);
        }
        return keccak256(phraseBytes);
    }

    function _redeemCambioNote(
        StorageLib.AppStorage storage ds,
        bytes32 noteId,
        uint256 amount,
        uint256 nonce,
        string calldata metadata,
        bytes32 providedPhraseHash,
        address redeemer
    ) internal {
        if (amount == 0) {
            revert StorageLib.AmountMustBePositive();
        }
        StorageLib.CambioNote storage note = ds.cambioNotes[noteId];
        if (note.issuer == address(0)) {
            revert StorageLib.CambioNoteNotFound(noteId);
        }
        if (!note.active) {
            revert StorageLib.CambioNoteInactive(noteId);
        }
        if (note.deadline < block.timestamp) {
            note.active = false;
            revert StorageLib.CambioNoteExpired(noteId);
        }

        if (note.phraseHash != bytes32(0)) {
            if (providedPhraseHash == bytes32(0)) {
                revert StorageLib.CambioPhraseRequired(noteId);
            }
            if (note.phraseHash != providedPhraseHash) {
                revert StorageLib.CambioPhraseMismatch(noteId);
            }
        }

        if (nonce != 0) {
            if (ds.cambioSpentNonces[redeemer][nonce]) {
                revert StorageLib.CambioNonceAlreadyUsed(redeemer, nonce);
            }
            ds.cambioSpentNonces[redeemer][nonce] = true;
        }

        uint256 remaining = note.escrowedAmount - note.spent;
        if (amount > remaining) {
            revert StorageLib.CambioRedemptionAmountExceeds(noteId, remaining, amount);
        }

        uint32 maxMetadata = ds.cambioConfig.maxMetadataLength;
        if (maxMetadata != 0 && bytes(metadata).length > maxMetadata) {
            revert StorageLib.CambioMetadataTooLarge(bytes(metadata).length, maxMetadata);
        }

        // Release digital backing to the redeemer while leaving an on-chain audit trail
        T3CommonLib.ensureProfileExistsForWrite(ds, redeemer);
        EscrowLib.releaseEscrow(redeemer, ClaimAttributionLib.CAMBIO_ESCROW_DOMAIN, noteId, amount);

        note.spent += amount;
        remaining -= amount;
        if (note.spent == note.escrowedAmount) {
            note.active = false;
        }

        bytes32 metadataHash = keccak256(bytes(metadata));
        bytes32 receiptId = keccak256(
            abi.encodePacked(noteId, redeemer, amount, metadataHash, ds.cambioReceiptCounter, block.timestamp)
        );
        ds.cambioReceipts[receiptId] = StorageLib.CambioReceipt({
            noteId: noteId,
            issuer: note.issuer,
            redeemer: redeemer,
            amount: amount,
            timestamp: uint48(block.timestamp),
            metadataHash: metadataHash
        });
        ds.cambioReceiptsByNote[noteId].push(receiptId);
        ds.cambioReceiptCounter += 1;

        emit CambioNoteRedeemed(noteId, redeemer, amount, remaining, receiptId);
    }

    function redeemCambioNote(
        bytes32 noteId,
        uint256 amount,
        uint256 nonce,
        string calldata metadata
    ) external nonReentrant whenNotPaused whenCambioActive {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        address redeemer = _msgSenderCambio();
        _requireRedeemer(ds, redeemer);
        _redeemCambioNote(ds, noteId, amount, nonce, metadata, bytes32(0), redeemer);
    }

    function redeemCambioNoteWithPhrase(
        string calldata phrase,
        uint256 amount,
        uint256 nonce,
        string calldata metadata
    ) external nonReentrant whenNotPaused whenCambioActive {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        address redeemer = _msgSenderCambio();
        _requireRedeemer(ds, redeemer);

        bytes32 phraseHash = _derivePhraseHash(phrase);
        bytes32 noteId = phraseHash;
        _redeemCambioNote(ds, noteId, amount, nonce, metadata, phraseHash, redeemer);
    }

    /**
     * @dev Returns stored receipt metadata so wallets can audit redemption history.
     */
    function getCambioReceipt(bytes32 receiptId)
        external
        view
        returns (bytes32 noteId, address issuer, address redeemer, uint256 amount, uint48 timestamp, bytes32 metadataHash)
    {
        StorageLib.CambioReceipt storage receipt = StorageLib.diamondStorage().cambioReceipts[receiptId];
        return (receipt.noteId, receipt.issuer, receipt.redeemer, receipt.amount, receipt.timestamp, receipt.metadataHash);
    }

    function getCambioReceiptsForNote(bytes32 noteId) external view returns (bytes32[] memory) {
        return StorageLib.diamondStorage().cambioReceiptsByNote[noteId];
    }
}
