// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title CambioEnvelopeStorage
 * @notice Isolated storage namespace for envelope-mode Cambio.
 * @dev Uses a dedicated storage slot to avoid collisions with legacy Cambio fields
 *      in StorageLib.AppStorage. All envelope Cambio facets MUST use this library.
 */
library CambioEnvelopeStorage {
    bytes32 internal constant STORAGE_SLOT = keccak256("t3.storage.cambio.envelope.v1");

    enum CambioEnvelopePhase { DISABLED, ENABLED, LEGACY_REMOVED }
    enum PauseState { ACTIVE, ISSUANCE_PAUSED, FULLY_PAUSED }

    struct CambioEnvelopeNote {
        address issuer;
        uint256 escrowedAmount;
        uint256 spent;
        uint48 createdAt;
        uint48 deadline;
        bool active;
        bytes32 phraseCommitment;
        bytes32 noteSalt;
        bool openRedemptionSnapshot;
        bool requiresCommitReveal;
    }

    struct CambioEnvelopeReceipt {
        bytes32 noteId;
        address issuer;
        address redeemer;
        uint256 amount;
        uint48 timestamp;
        bytes32 metadataHash;
    }

    struct IssuerEnvelopeProfile {
        address sponsorBank;
        bool isActive;
        bool openRedemption;
        uint256 registeredAt;
        uint256 maxOutstandingNoteCount;
        uint256 maxOutstandingNoteValue;
        uint256 dailyRedemptionCeiling;
        PauseState pauseState;
        // audit counters
        uint256 notesIssued;
        uint256 notesOutstanding;
        uint256 t3usdEscrowed;
        uint256 t3usdRedeemed;
        uint256 t3usdCancelled;
        // running outstanding value for cap checks
        uint256 valueOutstanding;
    }

    /**
     * @notice CommitRecord stores the expiry and redeemer for a commitment.
     * @dev The amount is NOT stored here — it is implicitly bound via the commitmentHash.
     * At reveal time, the caller-supplied amount is validated by recomputing
     * keccak256(abi.encode(chainid, address(this), noteId, phrase, redeemer, amount, nonce))
     * and matching it against the stored commitmentHash. This binds amount without
     * requiring an on-chain amount field.
     */
    struct CommitRecord {
        address redeemer;
        uint256 expiresAt;
        bool exists;
    }

    struct RollingCeilingBuckets {
        uint256[24] buckets;
        uint256 lastUpdatedHour;
    }

    struct CambioEnvelopeConfig {
        uint256 maxNoteValue;
        uint48 minDeadlineBuffer;
        uint48 maxDeadlineWindow;
        uint32 maxMetadataLength;
        uint256 commitRevealThreshold;
        uint48 maxCommitLifetime;
        bool cambioPaused;
        uint256 globalMaxOutstandingNoteCount;
        uint256 globalMaxOutstandingNoteValue;
    }

    struct Layout {
        mapping(bytes32 => CambioEnvelopeNote) envelopeNotes;
        mapping(bytes32 => CambioEnvelopeReceipt) envelopeReceipts;
        mapping(bytes32 => bytes32[]) envelopeReceiptsByNote;
        mapping(address => mapping(uint256 => bool)) envelopeSpentNonces;
        mapping(address => IssuerEnvelopeProfile) issuerProfiles;
        mapping(address => mapping(address => bool)) pendingEndorsements; // sponsorBank => issuer => bool
        mapping(bytes32 => CommitRecord) commitments;
        mapping(address => RollingCeilingBuckets) issuerCeilingBuckets;
        CambioEnvelopePhase phase;
        CambioEnvelopeConfig config;
        uint256 envelopeReceiptCounter;
        uint256 envelopeNoteCounter;
    }

    // --- Custom Errors ---
    error CambioEnvelopeDisabled();
    error CambioInvalidPhaseTransition();
    error CambioMaxOutstandingNotesExceeded(address issuer, uint256 current, uint256 max);
    error CambioMaxOutstandingValueExceeded(address issuer, uint256 current, uint256 max);
    error CambioDailyRedemptionCeilingExceeded(address issuer, uint256 attempted, uint256 ceiling);
    error NoPendingEndorsement(address sponsorBank, address issuer);
    error IssuerAlreadyRegistered(address issuer);
    error IssuerNotRegistered(address issuer);

    // Note lifecycle errors
    error CambioNoteExpired(bytes32 noteId);
    error InvalidPhrase(bytes32 noteId);
    error NoteNotActive(bytes32 noteId);
    error InvalidRedemptionAmount(bytes32 noteId, uint256 requested, uint256 remaining);
    error OpenRedemptionRequired(bytes32 noteId);
    error NotNoteIssuer(bytes32 noteId, address caller);
    error IssuerFullyPaused(address issuer);
    error MaxNoteValueExceeded(uint256 amount, uint256 max);
    error NonceAlreadySpent(address redeemer, uint256 nonce);
    error MetadataTooLong(uint256 length, uint256 maxLength);

    // Commit-reveal errors
    error RelayerRequired(bytes32 noteId);
    error CommitRevealRequired(bytes32 noteId);
    error InvalidCommit(bytes32 commitmentHash);
    error CommitExpired(bytes32 commitmentHash);
    error CommitRedeemerMismatch(bytes32 commitmentHash, address expected, address actual);
    error CommitAlreadyExists(bytes32 commitmentHash);
    error MaxCommitLifetimeExceeded(uint256 requested, uint256 max);

    // --- Events ---
    event CambioPhaseAdvanced(CambioEnvelopePhase newPhase);
    event SponsorBankEndorsed(address indexed sponsorBank, address indexed issuer, uint256 timestamp);
    event IssuerRegistered(address indexed issuer, address indexed sponsorBank, uint256 timestamp);
    event IssuerPauseStateChanged(address indexed issuer, PauseState newState);
    event IssuerOpenRedemptionUpdated(address indexed issuer, bool open);

    // Note lifecycle events
    event CambioEnvelopeNoteCreated(
        bytes32 indexed noteId,
        address indexed issuer,
        uint256 amount,
        uint48 deadline,
        bytes32 phraseCommitment,
        bool openRedemptionSnapshot,
        bool requiresCommitReveal
    );
    event CambioEnvelopeNoteRedeemed(
        bytes32 indexed noteId,
        address indexed redeemer,
        uint256 amount,
        uint256 remaining,
        bytes32 receiptId
    );
    event CambioEnvelopeNoteCancelled(
        bytes32 indexed noteId,
        address indexed issuer,
        uint256 remainingAmount
    );

    // Commit-reveal events
    event CommitRedemption(bytes32 indexed commitmentHash, address indexed redeemer, uint256 expiresAt);
    event CommitCleared(
        bytes32 indexed commitmentHash,
        address indexed redeemer,
        bytes32 indexed noteId,
        uint256 amount
    );
    event CommitCancelled(bytes32 indexed commitmentHash, address indexed redeemer);

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly { l.slot := slot }
    }
}
