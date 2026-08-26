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
 * @title CambioEscrowFacet
 * @notice Handles creation and cancellation of QR-backed Cambio notes by licensed issuers.
 */
contract CambioEscrowFacet is ReentrancyGuardBase {
    using EnumerableSet for EnumerableSet.AddressSet;
    uint256 private constant MIN_PHRASE_LENGTH = 8;
    uint256 private constant MAX_PHRASE_LENGTH = 160;
    uint256 private constant CHECKSUM_CODE_LENGTH = 5;
    uint128 private constant CHECKSUM_CODE_SPACE = 60_466_176; // 36^5 combinations

    event CambioNoteCreated(
        bytes32 indexed noteId,
        address indexed issuer,
        uint256 amount,
        uint48 deadline,
        bytes32 phraseHash,
        bytes16 checksumEntropy,
        string checksumCode,
        uint16 phraseLength,
        uint48 createdAt
    );
    event CambioNoteCancelled(bytes32 indexed noteId, address indexed issuer, uint256 remainingAmount);

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

    function _requireCambioIssuer(StorageLib.AppStorage storage ds, address account) internal view {
        if (!ds._roles[RoleConstants.CAMBIO_ISSUER_ROLE].contains(account)) {
            revert StorageLib.UnauthorizedRole(account, RoleConstants.CAMBIO_ISSUER_ROLE);
        }
    }

    function _defaultMaxNoteValue(StorageLib.AppStorage storage ds) internal view returns (uint256) {
        // Fallback to $1,000 cap if governance has not configured one yet
        uint256 configured = ds.cambioConfig.maxNoteValue;
        return configured == 0 ? 1_000_000_000 : configured;
    }

    function _minDeadlineBuffer(StorageLib.AppStorage storage ds) internal view returns (uint48) {
        // Enforce minimum lead time so paper cannot expire moments after printing
        uint48 configured = ds.cambioConfig.minDeadlineBuffer;
        return configured == 0 ? uint48(1 days) : configured;
    }

    function _checksumCode(bytes16 entropy) internal pure returns (string memory) {
        uint128 value = uint128(entropy) % CHECKSUM_CODE_SPACE;
        bytes memory buffer = new bytes(CHECKSUM_CODE_LENGTH);
        unchecked {
            for (uint256 i = CHECKSUM_CODE_LENGTH; i > 0; i--) {
                uint128 remainder = value % 36;
                value /= 36;
                buffer[i - 1] = bytes1(uint8(remainder < 10 ? 48 + remainder : 55 + remainder));
            }
        }
        return string(buffer);
    }

    function previewChecksum(bytes16 checksumEntropy, uint48 /* createdAt */, uint16 /* baseLength */)
        external
        pure
        returns (string memory)
    {
        return _checksumCode(checksumEntropy);
    }

    function _generateChecksum(
        StorageLib.AppStorage storage ds,
        bytes32 basePhraseHash,
        address issuer,
        uint256 amount,
        uint48 deadline,
        uint48 createdAt,
        uint16 baseLength
    ) internal returns (bytes16) {
        uint256 counter = ds.cambioNoteCounter + 1;
        ds.cambioNoteCounter = counter;

        bytes32 previousBlockHash = block.number > 0 ? blockhash(block.number - 1) : bytes32(0);

        bytes32 entropy = keccak256(
            abi.encodePacked(
                basePhraseHash,
                issuer,
                amount,
                deadline,
                createdAt,
                baseLength,
                counter,
                previousBlockHash
            )
        );

        return bytes16(entropy);
    }

    function _validatePhrase(string memory phrase) internal pure returns (bytes32 phraseHash) {
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

    function _createCambioNote(
        StorageLib.AppStorage storage ds,
        address issuer,
        bytes32 noteId,
        uint256 amount,
        uint48 deadline,
        bytes32 phraseHash,
        uint16 phraseLength,
        bytes16 phraseChecksum,
        string memory checksumCode
    ) internal returns (uint48 createdAt) {
        if (amount == 0) {
            revert StorageLib.AmountMustBePositive();
        }
        uint256 maxValue = _defaultMaxNoteValue(ds);
        if (maxValue > 0 && amount > maxValue) {
            revert StorageLib.CambioMaxNoteValueExceeded(amount, maxValue);
        }

        StorageLib.CambioNote storage existing = ds.cambioNotes[noteId];
        if (existing.issuer != address(0)) {
            revert StorageLib.CambioNoteExists(noteId);
        }

        uint48 currentTime = uint48(block.timestamp);
        uint48 minLead = _minDeadlineBuffer(ds);
        if (deadline <= currentTime + minLead) {
            revert StorageLib.CambioDeadlineOutOfRange();
        }
        uint48 maxWindow = ds.cambioConfig.maxDeadlineWindow;
        if (maxWindow != 0 && deadline > currentTime + maxWindow) {
            revert StorageLib.CambioDeadlineOutOfRange();
        }

        T3CommonLib.ensureProfileExistsForWrite(ds, issuer);
        // Deposit backing funds into the diamond-held escrow balance (claim-attributed)
        EscrowLib.escrowFrom(issuer, ClaimAttributionLib.CAMBIO_ESCROW_DOMAIN, noteId, amount);

        ds.cambioNotes[noteId] = StorageLib.CambioNote({
            issuer: issuer,
            cambio: issuer,
            escrowedAmount: amount,
            spent: 0,
            createdAt: currentTime,
            deadline: deadline,
            active: true,
            phraseHash: phraseHash,
            phraseLength: phraseLength,
            phraseChecksum: phraseChecksum
        });

        emit CambioNoteCreated(
            noteId,
            issuer,
            amount,
            deadline,
            phraseHash,
            phraseChecksum,
            checksumCode,
            phraseLength,
            currentTime
        );

        return currentTime;
    }

    function createCambioNote(bytes32 noteId, uint256 amount, uint48 deadline)
        external
        nonReentrant
        whenNotPaused
        whenCambioActive
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        address issuer = _msgSenderCambio();
        _requireCambioIssuer(ds, issuer);

        _createCambioNote(ds, issuer, noteId, amount, deadline, bytes32(0), 0, bytes16(0), "");
    }

    function createCambioNoteWithPhrase(string calldata phrase, uint256 amount, uint48 deadline)
        external
        nonReentrant
        whenNotPaused
        whenCambioActive
        returns (bytes32 noteId, string memory checksumCode)
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        address issuer = _msgSenderCambio();
        _requireCambioIssuer(ds, issuer);

        bytes memory basePhraseBytes = bytes(phrase);
        uint16 baseLength = uint16(basePhraseBytes.length);

        if (baseLength < MIN_PHRASE_LENGTH) {
            revert StorageLib.CambioPhraseTooShort(baseLength, MIN_PHRASE_LENGTH);
        }

        uint256 maxBaseLength = MAX_PHRASE_LENGTH > (2 + CHECKSUM_CODE_LENGTH)
            ? MAX_PHRASE_LENGTH - (2 + CHECKSUM_CODE_LENGTH)
            : 0;
        if (baseLength > maxBaseLength) {
            revert StorageLib.CambioPhraseTooLong(baseLength, maxBaseLength);
        }

        uint48 createdAt = uint48(block.timestamp);
        bytes32 basePhraseHash = keccak256(basePhraseBytes);
        bytes16 phraseChecksum = _generateChecksum(ds, basePhraseHash, issuer, amount, deadline, createdAt, baseLength);
        checksumCode = _checksumCode(phraseChecksum);
        string memory finalizedPhrase = string.concat(phrase, " #", checksumCode);

        bytes32 phraseHash = _validatePhrase(finalizedPhrase);
        noteId = phraseHash;
        uint16 finalLength = uint16(bytes(finalizedPhrase).length);

        _createCambioNote(ds, issuer, noteId, amount, deadline, phraseHash, finalLength, phraseChecksum, checksumCode);
    }

    function deriveCambioNoteId(string calldata phrase) external pure returns (bytes32) {
        return _validatePhrase(phrase);
    }

    function cancelCambioNote(bytes32 noteId)
        external
        nonReentrant
        whenNotPaused
        whenCambioActive
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        address caller = _msgSenderCambio();
        StorageLib.CambioNote storage note = ds.cambioNotes[noteId];
        if (note.issuer == address(0)) {
            revert StorageLib.CambioNoteNotFound(noteId);
        }
        if (note.issuer != caller) {
            revert StorageLib.UnauthorizedRole(caller, RoleConstants.CAMBIO_ISSUER_ROLE);
        }
        if (!note.active) {
            revert StorageLib.CambioNoteInactive(noteId);
        }

        uint256 remaining = note.escrowedAmount - note.spent;
        note.active = false;
        if (remaining > 0) {
            EscrowLib.releaseEscrow(caller, ClaimAttributionLib.CAMBIO_ESCROW_DOMAIN, noteId, remaining);
        }

        emit CambioNoteCancelled(noteId, caller, remaining);
    }

    /**
     * @dev Exposes stored Cambio note metadata for off-chain validation and testing.
     */
    function getCambioNote(bytes32 noteId)
        external
        view
        returns (
            address issuer,
            address cambio,
            uint256 escrowedAmount,
            uint256 spent,
            uint48 createdAt,
            uint48 deadline,
            bool active,
            bytes32 phraseHash,
            uint16 phraseLength,
            bytes16 phraseChecksum
        )
    {
        StorageLib.CambioNote storage note = StorageLib.diamondStorage().cambioNotes[noteId];
        return (
            note.issuer,
            note.cambio,
            note.escrowedAmount,
            note.spent,
            note.createdAt,
            note.deadline,
            note.active,
            note.phraseHash,
            note.phraseLength,
            note.phraseChecksum
        );
    }
}
