// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title StorageLib
 * @dev Defines the unified storage layout for the Diamond Standard implementation.
 * All facets operate on this shared storage.
 * Crucially, the order of variables in AppStorage MUST NOT be changed after deployment.
 * New variables must ONLY be appended to the end to ensure upgrade safety.
 */
library StorageLib {
    // --- Custom Errors (Shared across facets) ---
    error AccessControlBadAdmin(address admin);
    error UnauthorizedRole(address caller, bytes32 role);
    error ERC20InsufficientBalance(address sender, uint256 currentBalance, uint256 requiredBalance);
    error TransferToZeroAddress();
    error TransferAmountZero();
    error ReversalSenderMismatch();
    error UnauthorizedReversal(); // Neither sender, recipient, nor admin
    error NoActiveTransfer();
    error HalfLifeExpired(); // Used when half-life period prevents reversal
    error TransferAlreadyReversed();
    error InsufficientRecipientBalanceForReversal();
    error ExcessiveReversalAmount(); // Reversal amount exceeds remaining locked amount
    error MintToZeroAddress();
    error MintAmountZero();
    error BurnAmountZero();
    error DebtorCannotBeZeroAddress();
    error CreditorCannotBeZeroAddress();
    error DebtorCannotBeCreditor();
    error AmountMustBePositive();
    error AmountToClearExceedsOutstandingLiability();
    error TreasuryAddressZero();
    error MinHalfLifePositive();
    error MinHalfLifeExceedsMax();
    error InitialHalfLifeOutOfBounds();
    error InactivityPeriodPositive();
    error UserAlreadyRegistered(address userAddress);
    error HalfLifeBelowMinimum();
    error HalfLifeAboveMaximum();
    error MaxHalfLifeBelowMinimum();
    error MaxHalfLifePositive();
    error PrefundAmountPositive();
    error WithdrawAmountPositive();
    error InsufficientPrefundedBalance();
    error CallerNotRegisteredCustodian();
    error KYCExpiryBeforeValidation();
    error CustodianZeroAddress();
    error UserAddressZero();
    error NoActiveTransferData(); // Used when checkHalfLifeExpiry finds no data
    error TransferWasReversed(); // Used when checkHalfLifeExpiry finds transfer already reversed
    error HalfLifeNotExpiredYet(); // Used when checkHalfLifeExpiry finds half-life not expired
    error TransferDuringHalfLife(); // Added for T3TokenTransferFacet
    error FunctionDoesNotExist(bytes4 selector); // Added for Diamond.sol
    error BankOrCounterpartyZeroAddress(); // Added for T3TokenInterbankLiabilityFacet
    error LiabilityAmountZero(); // Added for T3TokenInterbankLiabilityFacet
    error InsufficientLiability(address bank, address counterparty, uint256 available, uint256 requested); // Added for T3TokenInterbankLiabilityFacet

    // --- Escrow-specific Errors (from File A) ---
    error ErrorHashCommitmentMismatch(); // From patent [cite: 20]
    error ErrorTransferNotCancellable(); // From patent, for cancelLockedTransfer [cite: 21]
    error ErrorTransferAlreadyReleased(); // [cite: 22]
    error ErrorTransferAlreadyCancelled(); // [cite: 22]
    error ErrorOnlySenderOrAdminCanCancel(); // [cite: 22]
    error ErrorReleaseNotAuthorized(); // General error for release authority [cite: 22]
    error ErrorOnlyAuthorizedAddressCanRelease(); // [cite: 23]
    error ErrorLockedTransferNotFound(); // [cite: 23]
    error ErrorLockedTransferAmountZero(); // [cite: 23]
    error ErrorSelfLockedTransfer(); // Sender == recipient for locked transfer [cite: 23]

    // --- Quantum Resistance Errors ---
    error QuantumThreatLevelTooHigh();
    error QuantumEmergencyModeActive();
    error FragmentValidationFailed();
    error QuantumSecurityWindowExpired();
    error InvalidQuantumThreatLevel();
    error UnauthorizedQuantumThreatReporter();

    // --- Cambio Escrow Errors ---
    // Provide deterministic revert reasons for physical-note issuance and redemption path
    error CambioNoteExists(bytes32 noteId);
    error CambioNoteNotFound(bytes32 noteId);
    error CambioNoteInactive(bytes32 noteId);
    error CambioNoteExpired(bytes32 noteId);
    error CambioRedemptionAmountExceeds(bytes32 noteId, uint256 available, uint256 requested);
    error CambioMaxNoteValueExceeded(uint256 attempted, uint256 maxAllowed);
    error CambioDeadlineOutOfRange();
    error CambioPaused();
    error CambioNonceAlreadyUsed(address redeemer, uint256 nonce);
    error CambioMetadataTooLarge(uint256 length, uint256 maxLength);
    error CambioInvalidConfiguration();
    error CambioPhraseRequired(bytes32 noteId);
    error CambioPhraseMismatch(bytes32 noteId);
    error CambioPhraseTooShort(uint256 providedLength, uint256 minLength);
    error CambioPhraseTooLong(uint256 providedLength, uint256 maxLength);

    // --- Shared Data Structures ---
    struct CustodyData { // [cite: 179]
        address custodian; // [cite: 24, 179]
        uint256 kycValidatedTimestamp; // [cite: 25, 180]
        uint256 kycExpiresTimestamp; // [cite: 25, 180]
        uint256 cipCompletedAt; // 8E-2 tail-append — 0 = no CIP record
        bytes32 cipRecordHash; // 8E-2 tail-append — opaque off-chain pointer, no PII
    }
    struct TransferMetadata { // [cite: 180]
        uint256 commitWindowEnd; // [cite: 25, 180]
        uint256 halfLifeDuration; // [cite: 26, 181]
        address originator; // [cite: 26, 181]
        uint256 transferCount; // [cite: 26, 181]
        bytes32 reversalHash; // [cite: 26, 181]
        uint256 totalFeeAssessed; // [cite: 26, 181]
        bool isReversed; // [cite: 26, 181]
    }
    // New struct for Ledger-Based Locking
    struct PendingTransfer {
        bytes32 id;
        address originator;
        address recipient; // Added recipient to track who holds the funds
        uint256 amount;              // Current remaining locked amount
        uint256 originalAmount;      // Original transfer amount (immutable after creation)
        uint256 totalReversed;       // Running sum of all reversals
        uint8 reversalCount;         // Number of partial/full reversals (max 255)
        uint256 firstReversalTime;   // Timestamp of first reversal (0 if none)
        uint256 lastReversalTime;    // Timestamp of most recent reversal
        uint256 unlockTime;
        bool isReversed;            // True when fully reversed (amount == 0)
        bytes32 reversalHash;       // Keep track of hash for events
    }
    struct RollingAverage { // [cite: 182]
        uint256 totalAmount; // [cite: 27, 182]
        uint256 count; // [cite: 27, 182]
        uint256 lastUpdated; // [cite: 28, 183]
    }
    struct WalletRiskProfile { // [cite: 183]
        uint256 reversalCount; // [cite: 28, 183]
        uint256 lastReversal; // [cite: 29, 184]
        uint256 creationTime; // [cite: 29, 184]
        uint256 abnormalTxCount; // [cite: 29, 184]
        uint256 riskScore; // New: Cumulative risk score for compliance monitoring
        uint256 lastRiskUpdate; // New: Timestamp of last risk score update
        uint256 lastTransactionTime; // New: For velocity monitoring
    }
    struct IncentiveCredits { // [cite: 184]
        uint256 amount; // [cite: 29, 184]
        uint256 lastUpdated; // [cite: 30, 185]
    }

    // --- Cambio Escrow Structures ---
    struct CambioNote {
        address issuer;
        address cambio;
        uint256 escrowedAmount;
        uint256 spent;
        uint48 createdAt;
        uint48 deadline;
        bool active;
        bytes32 phraseHash;
        uint16 phraseLength;
        bytes16 phraseChecksum;
    }

    struct CambioReceipt {
        bytes32 noteId;
        address issuer;
        address redeemer;
        uint256 amount;
        uint48 timestamp;
        bytes32 metadataHash;
    }

    struct CambioConfig {
        bool cambioPaused;
        uint256 maxNoteValue;
        uint48 minDeadlineBuffer;
        uint48 maxDeadlineWindow;
        uint32 maxMetadataLength;
    }
    // NOTE: FeeDetails struct is a return type for view functions, not stored state. [cite: 185]
    struct FeeDetails { // [cite: 185]
        uint256 requestedAmount; // [cite: 31, 186]
        uint256 baseFeeAmount; // [cite: 32, 187]
        uint256 senderRiskScore; // [cite: 32, 187]
        uint256 recipientRiskScore; // [cite: 32, 187]
        uint256 applicableRiskScore; // [cite: 32, 187]
        uint256 amountRiskScaler; // [cite: 32, 187]
        uint256 scaledRiskImpactBps; // [cite: 32, 187]
        uint256 finalRiskFactorBps; // [cite: 32, 187]
        uint256 feeBeforeCreditsAndBounds; // [cite: 32, 187]
        uint256 availableCredits; // [cite: 32, 187]
        uint256 creditsToApply; // [cite: 32, 187]
        uint256 feeAfterCredits; // [cite: 33, 188]
        uint256 maxFeeBound; // [cite: 33, 188]
        uint256 minFeeBound; // [cite: 33, 188]
        bool maxFeeApplied; // [cite: 33, 188]
        bool minFeeApplied; // [cite: 33, 188]
        uint256 totalFeeAssessed; // [cite: 33, 188]
        uint256 netAmountToSendToRecipient; // [cite: 33, 188]
    }

    // --- Locked Transfer Struct (NEW from File A) ---
    struct LockedTransfer { // [cite: 34]
        address sender; // [cite: 34]
        address recipient; // [cite: 35]
        uint256 amount; // [cite: 35]
        bytes32 hashCommitment; // Quantum-resistant release condition [cite: 35]
        bytes32 nonce;          // Part of the quantum-resistant secret [cite: 35]
        address releaseAuthorizedAddress; // Custodian as arbiter [cite: 36]
        bool isReleased; // [cite: 37]
        bool isCancelled; // [cite: 37]
    }

    // --- Compliance Monitoring Structures ---
    struct TransactionRecord {
        address recipient;
        uint256 amount;
        uint256 timestamp;
        string transactionType; // "TRANSFER", "RECEIVE", "MINT", "BURN"
    }

    struct ComplianceAlert {
        address wallet;
        string alertType; // "HIGH_RISK_TRANSACTION", "VELOCITY_EXCEEDED", etc.
        uint256 severity; // 1-4 scale
        uint256 timestamp;
        bool isResolved;
    }

    struct ComplianceReport {
        uint256 custodianId;
        string reportType; // "DAILY", "SUSPICIOUS", "VELOCITY"
        uint256 timestamp;
        bytes32 dataHash;
        bool isSubmitted;
    }

    struct VelocityThresholds {
        uint256 daily; // Daily transaction limit in wei
        uint256 hourly; // Hourly transaction limit in wei
        uint256 transactionCount; // Max transactions per hour
    }

    struct CustodianInfo {
        address custodianAddress;
        string name;
        string licenseInfo;
        bool isActive;
        uint256 registrationTime;
    }

    // --- Multi-Signature Settlement Structures ---
    struct PendingSettlement {
        address fromCustodian;
        address toCustodian;
        uint256 amount;
        string description;
        address proposer;
        uint256 proposedAt;
        uint256 executedAt;
        bool isExecuted;
        bool isCancelled;
        uint256 approvalCount;
    }

    // --- Audit Trails Structures ---
    struct AuditLogEntry {
        address actor;
        string category;
        string action;
        string details;
        address relatedAddress;
        uint256 amount;
        uint256 timestamp;
        uint256 blockNumber;
        bytes32 transactionHash;
        bool isDeleted;
    }

    struct ComplianceEvent {
        address wallet;
        string eventType;
        uint256 severity;
        string description;
        bytes32 relatedTxHash;
        address reporter;
        uint256 timestamp;
        bool isResolved;
        string resolutionNotes;
    }

    struct RegulatoryReport {
        address requestor;
        string reportType;
        uint256 fromTimestamp;
        uint256 toTimestamp;
        uint256 generatedAt;
        bytes32 dataHash;
        bool includeDetails;
        bool isExported;
        uint256 exportCount;
    }

    struct AuditExport {
        address requestor;
        uint256 fromTimestamp;
        uint256 toTimestamp;
        string format;
        uint256 recordCount;
        uint256 exportedAt;
        bytes32 dataHash;
    }

    // --- Quantum Resistance Structures ---
    struct QuantumThreatAlert {
        bytes32 alertId;
        address reporter;
        uint8 threatLevel; // 0-10 scale
        string description;
        bytes32 relatedTransferId;
        uint256 reportedAt;
        bool isResolved;
        string resolutionNotes;
        address resolver;
        uint256 resolvedAt;
    }

    struct QuantumWalletProfile {
        address walletAddress;
        uint8 maxThreatLevelExposed; // Highest threat level this wallet has been exposed to
        uint256 fragmentsExposed; // Number of fragments exposed for this wallet
        uint256 lastQuantumActivity; // Last quantum-related activity timestamp
        bool isHighRisk; // Whether wallet is flagged as high quantum risk
        uint256 emergencyOverrideCount; // Number of emergency overrides used
        mapping(bytes32 => bool) exposedFragments; // Track which fragments have been exposed
    }

    struct QuantumTransferMetadata {
        bytes32 transferId;
        uint8 threatLevelAtCreation; // Threat level when transfer was created
        uint8 currentThreatLevel; // Current threat level affecting this transfer
        bool requiresQuantumSecureRelease; // Whether quantum-secure release is required
        uint256 quantumSecurityWindow; // Time window for quantum-secure operations
        address quantumThreatReporter; // Who reported threat affecting this transfer
        bool emergencyReleaseAuthorized; // Whether emergency release is authorized
        mapping(uint8 => uint256) threatLevelHistory; // History of threat level changes
    }

    struct QuantumSecurityConfig {
        uint8 maxThreatLevel; // Maximum allowed threat level (0-10)
        uint256 emergencyModeThreshold; // Threat level that triggers emergency mode
        uint256 fragmentExposureLimit; // Max fragments that can be exposed per wallet
        uint256 quantumSecurityWindow; // Default security window for operations
        bool autoEscalationEnabled; // Whether to auto-escalate high threats
        address emergencyResponder; // Default emergency response contact
        uint256 dataRetentionPeriod; // How long to keep quantum security data
        mapping(uint8 => uint256) threatLevelTimeouts; // Timeout periods for each threat level
    }

    // --- KYC Cache Structures ---
    struct KycCache {
        bool isValid;
        uint256 lastChecked;
        uint256 cacheExpiry;
    }

    // --- Reward Routing Configuration ---
    struct RewardRouting {
        uint256 rewardPercentageBps;     // Percentage of fee allocated as rewards (in basis points)
        uint256 maxRewardPerTransaction; // Maximum reward amount per transaction
        bool routingEnabled;             // Circuit breaker for reward routing system
        uint256 minTransactionForReward; // Minimum transaction amount to earn rewards
    }

    // --- Rewards Escrow Structures ---
    struct EpochRewards {
        uint256 totalRewards;
        uint256 startTime;
        uint256 endTime;
        mapping(address => uint256) userRewards;
        mapping(address => bool) claimed;
    }

    struct RewardsEscrowData {
        uint256 currentEpoch;
        uint256 epochStartTime;
        mapping(uint256 => EpochRewards) epochs;
        mapping(address => uint256[]) userEpochs;
        address rewardsToken;
        uint256 epochDuration;
        uint256 expiryDuration;
    }

    // --- SecureSettle Structures ---
    struct SettlementData {
        address initiator;
        address[] assets;
        uint256[] amounts;
        address[] recipients;
        uint256 totalUsdValue;
        uint256 proposedAt;
        uint256 executesAt;
        uint8 status; // 0=Pending, 1=Approved, 2=Executed, 3=Cancelled
        bytes32 hashCommitment;
        string description;
    }

    struct OracleConfig {
        mapping(address => address) priceFeeds; // asset => price feed
        uint256 priceValidityWindow;
        uint256 maxPriceDeviation;
        bool oracleActive;
    }

    struct SecureSettleConfig {
        mapping(bytes32 => SettlementData) settlements;
        mapping(address => uint256) assetThresholds;
        uint256 defaultThreshold;
        uint256 settlementDelay;
        uint256 maxSettlementDelay;
        bool secureSettleActive;
        address oracleManager;
    }

    // --- Multi-Signature Administrative Control Structures ---
    struct MultiSigProposal {
        bytes32 proposalId;
        uint8 proposalType; // Using uint8 instead of enum for storage efficiency
        uint8 status;
        address proposer;
        uint256 createdAt;
        uint256 expiresAt;
        uint256 requiredApprovals;
        uint256 currentApprovals;
        bytes proposalData;
        string description;
        address targetContract;
        bytes4 targetFunction;
        mapping(address => bool) approvals;
        address[] approvers;
    }

    struct MultiSigConfig {
        address[] signers;
        uint256 threshold;
        uint256 proposalTimeout;
        uint256 maxSigners;
        mapping(address => bool) isActiveSigner;
        mapping(uint8 => uint256) typeSpecificThresholds; // proposal type => threshold
        bool emergencyMode;
        uint256 emergencyThreshold;
    }

    struct SignerProfile {
        address signerAddress;
        string name;
        string role;
        string department;
        uint256 addedAt;
        uint256 lastActivity;
        bool isActive;
        uint256 rotationDue;
        address backupSigner;
    }

    struct TimeLockedOperation {
        bytes32 operationId;
        uint8 operationType;
        address proposer;
        uint256 proposedAt;
        uint256 readyAt;
        uint256 expiresAt;
        bytes operationData;
        bool executed;
        bool cancelled;
        string description;
    }

    struct EmergencyControls {
        bool emergencyPaused;
        address emergencyPauser;
        uint256 pausedAt;
        uint256 maxPauseDuration;
        mapping(address => bool) emergencyPausers;
        mapping(bytes4 => bool) emergencyExemptFunctions;
    }

    /**
     * @dev AppStorage struct defines all state variables for the entire Diamond. [cite: 38, 189]
     * The order of these variables MUST remain unchanged to preserve storage layout [cite: 39, 190]
     * across upgrades. New variables MUST ONLY be appended to the end. [cite: 40, 191]
     */
    struct AppStorage {
        // --- Storage Layout Versioning (CRITICAL: Never modify order) ---
        uint256 storageVersion; // Current storage layout version
        uint256 upgradeTimestamp; // Timestamp of last upgrade
        bytes32 storageLayoutHash; // Hash of storage layout for validation
        address contractOwner; // Contract owner for bootstrap authorization
        
        // --- OpenZeppelin Base Contract Emulations (storage from original contracts) ---
        mapping(bytes4 => address) _selectors;
        mapping(bytes32 => EnumerableSet.AddressSet) _roles; // Represents AccessControl's internal _roles [cite: 41, 192]
         address[] _facetAddresses; // <<< ADD THIS LINE
        mapping(address => bool) _isFacet; // New mapping for efficient facet lookup
        mapping(address => bytes4[]) _facetFunctionSelectors; // <<< ADD THIS LINE
        string _name; // [cite: 42, 193]
        string _symbol; // [cite: 43, 194]
        mapping(address => uint256) _balances; // [cite: 43, 194]
        mapping(address => mapping(address => uint256)) _allowances; // [cite: 43, 194]
        uint256 _totalSupply; // [cite: 43, 194]
        bool _paused; // Represents Pausable's internal _paused state [cite: 44, 195]
        uint256 _reentrancyMutex; // Represents ReentrancyGuard's internal _status/mutex [cite: 45, 196]

        // --- T3Token Specific State Variables ---
        address treasuryAddress; // [cite: 46, 197]
        uint256 halfLifeDuration; // [cite: 47, 198]
        uint256 minHalfLifeDuration; // [cite: 47, 198]
        uint256 maxHalfLifeDuration; // [cite: 47, 198]
        uint256 inactivityResetPeriod; // [cite: 47, 198]
        mapping(address => TransferMetadata) transferData; // [cite: 47, 198]
        mapping(address => TransferMetadata) outgoingTransferData; // New mapping for outgoing transfers
        mapping(address => RollingAverage) rollingAverages; // [cite: 48, 199]
        mapping(address => mapping(address => uint256)) transactionCountBetween; // [cite: 48, 199]
        mapping(address => WalletRiskProfile) walletRiskProfiles; // [cite: 48, 199]
        mapping(address => IncentiveCredits) incentiveCredits; // [cite: 48, 199]
        mapping(address => uint256) mintedByMinter; // Tracks mints per minter [cite: 49, 200]
        mapping(address => mapping(address => uint256)) interbankLiabilities; // [cite: 49, 200]
        mapping(address => uint256) prefundedFeeBalances; // [cite: 50, 201]

        // --- CustodianRegistry Specific State Variables ---
        mapping(address => CustodyData) _custodyInfo; // [cite: 50, 201]
        EnumerableSet.AddressSet _custodians; // Tracks FIs with CUSTODIAN_ROLE [cite: 51, 202]

        // --- Configurable Fee Parameters (Moved from T3TokenFeeLogicFacet) ---
        uint256 minFeeWei; // [cite: 51, 202]
        uint256 maxFeePercentBps; // Max fee percentage in basis points (e.g., 1000 for 10%) [cite: 52, 203]
        uint256 baseRiskScalerBps; // [cite: 52, 203]
        uint256 maxRiskScalerBps; // [cite: 53, 204]
        uint256[] feeTierThresholds; // [cite: 55, 206]
        uint256[] feeTierRatesBps; // [cite: 55, 206]

        // --- Locked Transfer Manager Specific State Variables (NEW from File A) ---
        mapping(bytes32 => LockedTransfer) lockedTransfers; // Stores locked transfer details [cite: 56]

        // --- Compliance Monitoring State Variables ---
        mapping(address => TransactionRecord[]) transactionHistory; // Transaction history per wallet
        mapping(bytes32 => ComplianceAlert) complianceAlerts; // Active compliance alerts
        mapping(bytes32 => ComplianceReport) complianceReports; // Generated compliance reports
        mapping(uint256 => CustodianInfo) custodians; // Custodian information by ID
        VelocityThresholds velocityThresholds; // Global velocity limits
        uint256 nextCustodianId; // Auto-incrementing custodian ID counter

        // --- Multi-Signature Settlement State Variables ---
        mapping(bytes32 => PendingSettlement) pendingSettlements; // Pending multi-sig settlements
        mapping(bytes32 => EnumerableSet.AddressSet) settlementApprovers; // Approvers per settlement
        EnumerableSet.Bytes32Set activeSettlements; // Active settlement IDs
        uint256 requiredApprovals; // Number of approvals required for execution
        uint256 largeSettlementThreshold; // Minimum amount requiring multi-sig approval

        // --- Audit Trails State Variables ---
        mapping(bytes32 => AuditLogEntry) auditLogs; // Audit log entries
        mapping(bytes32 => ComplianceEvent) complianceEvents; // Compliance events
        mapping(bytes32 => RegulatoryReport) regulatoryReports; // Regulatory reports
        mapping(bytes32 => AuditExport) auditExports; // Audit exports
        mapping(address => bytes32[]) auditLogsByActor; // Audit logs by actor
        mapping(string => bytes32[]) auditLogsByCategory; // Audit logs by category
        mapping(uint256 => bytes32[]) auditLogsByDate; // Audit logs by day
        mapping(address => bytes32[]) complianceEventsByWallet; // Compliance events by wallet
        mapping(uint256 => bytes32[]) complianceEventsBySeverity; // Compliance events by severity
        uint256 dataRetentionPeriod; // Data retention period in seconds
        uint256 auditLogCounter; // Total audit log count
        uint256 complianceEventCounter; // Total compliance event count
        uint256 reportCounter; // Total report count
        uint256 exportCounter; // Total export count

        // --- Quantum Resistance State Variables ---
        mapping(bytes32 => QuantumThreatAlert) quantumThreatAlerts; // Active quantum threat alerts
        mapping(address => QuantumWalletProfile) quantumWalletProfiles; // Wallet quantum security profiles
        mapping(bytes32 => QuantumTransferMetadata) quantumTransferMetadata; // Transfer quantum metadata
        QuantumSecurityConfig quantumSecurityConfig; // Global quantum security configuration
        uint8 globalQuantumThreatLevel; // Current global threat level (0-10)
        bool quantumEmergencyMode; // Whether system is in quantum emergency mode
        uint256 quantumDataRetentionPeriod; // How long to retain quantum security events
        uint256 quantumEventCounter; // Total quantum events logged
        mapping(address => bool) authorizedQuantumThreatReporters; // Authorized threat reporters
        mapping(bytes32 => uint256) quantumEventTimestamps; // Event timestamps for cleanup

        // --- Multi-Signature Administrative Control State Variables ---
        mapping(bytes32 => MultiSigProposal) multiSigProposals; // Multi-signature proposals
        MultiSigConfig multiSigConfig; // Multi-signature configuration
        mapping(address => SignerProfile) signerProfiles; // Signer profile information
        uint256 proposalCounter; // Proposal ID counter
        mapping(address => bytes32[]) signerProposalHistory; // Proposal history per signer
        mapping(bytes32 => uint256) proposalExecutionTime; // Execution timestamps
        
        // --- Time-Locked Operations State Variables ---
        mapping(bytes32 => TimeLockedOperation) timeLockedOperations; // Time-locked operations
        uint256 operationCounter; // Operation ID counter
        
        // --- Emergency Controls State Variables ---
        EmergencyControls emergencyControls; // Emergency control configuration
        
        // --- Enhanced T3 Integration State Variables (Phase 1) ---
        mapping(address => KycCache) kycStatusCache; // KYC status caching system
        RewardsEscrowData rewardsEscrow; // Escrow-until-KYC rewards system
        SecureSettleConfig secureSettle; // SecureSettle configuration
        OracleConfig oracleConfig; // Oracle price feed configuration
        address rewardsEscrowContract; // External rewards escrow contract address
        uint256 kycCacheDuration; // KYC cache validity duration (default: 1 hour)
        mapping(address => uint256) _incentiveCredits; // DEPRECATED: Do NOT use. Use incentiveCredits[user].amount instead. Kept to preserve storage layout.
        RewardRouting rewardRoutingConfig; // KYC-based reward routing configuration
        
        // --- ERC-2771 Meta-Transaction Support ---
        address trustedForwarder; // ERC-2771 trusted forwarder for gasless transactions

        // --- Cambio Escrow State Variables ---
        // Track lifecycle of QR-backed notes without disturbing legacy storage
        mapping(bytes32 => CambioNote) cambioNotes;
        mapping(bytes32 => CambioReceipt) cambioReceipts;
        mapping(bytes32 => bytes32[]) cambioReceiptsByNote;
        mapping(address => mapping(uint256 => bool)) cambioSpentNonces;
        uint256 cambioReceiptCounter;
        uint256 cambioNoteCounter;
        CambioConfig cambioConfig;
        
        // --- Ledger-Based Locking State Variables ---
        mapping(address => bytes32[]) pendingTransferIds; // List of active locks per user
        mapping(bytes32 => PendingTransfer) pendingTransfers; // Details by ID
        mapping(address => bytes32[]) outgoingPendingTransferIds; // List of active outgoing locks per user
        
        // Legacy gap retained for transitional storage padding
        uint256[1] __gap;
        // Additional gap for future expansion after Cambio integration
        uint256[48] __futureGap;
    }

    // This unique storage slot hash ensures that our AppStorage struct
    // is placed at a specific, non-colliding location in the Diamond's storage. [cite: 59, 209]
    // **IMPORTANT: GENERATE YOUR OWN UNIQUE HASH FOR A PRODUCTION SYSTEM!** [cite: 60, 210]
    // Example: keccak256("com.yourcompany.projectname.AppStorage.v1.someRandomString")
    bytes32 constant _STORAGE_POSITION = keccak256(
        "com.t3programmablefiat.diamond.AppStorage.v1.995ced7e2b6e426f836004bd3a63670d"
    ); // Generated project-specific slot anchor; regen if cloning for production [cite: 60, 210]

    /**
     * @dev Returns a reference to the AppStorage struct. All facets call this [cite: 61, 211]
     * to access and modify the Diamond's shared state. [cite: 62, 212]
     */
    function diamondStorage() internal pure returns (AppStorage storage ds) { // [cite: 63, 213]
        bytes32 position = _STORAGE_POSITION; // [cite: 63, 213]
        assembly { // [cite: 64, 214]
            ds.slot := position // [cite: 64, 214]
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
    // STORAGE LAYOUT SAFETY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

    /// @dev Current storage layout version
    uint256 constant CURRENT_STORAGE_VERSION = 4; // Incremented for Cambio checksum support
    
    /// @dev Storage layout hash for version 1
    bytes32 constant STORAGE_LAYOUT_HASH_V1 = keccak256("T3Token.StorageLayout.v1");
    
    /// @dev Storage layout hash for version 2 (Enhanced T3 Integration)
    bytes32 constant STORAGE_LAYOUT_HASH_V2 = keccak256("T3Token.StorageLayout.v2.KycEscrowSecureSettle");
    bytes32 constant STORAGE_LAYOUT_HASH_V3 = keccak256("T3Token.StorageLayout.v3.CambioEscrowIntegration");
    bytes32 constant STORAGE_LAYOUT_HASH_V4 = keccak256("T3Token.StorageLayout.v4.CambioChecksummedNotes");

    /**
     * @dev Initialize storage versioning system
     * @notice Should be called during diamond initialization
     */
    function initializeStorageVersion() internal {
        AppStorage storage ds = diamondStorage();
        ds.storageVersion = CURRENT_STORAGE_VERSION;
        ds.upgradeTimestamp = block.timestamp;
        ds.storageLayoutHash = STORAGE_LAYOUT_HASH_V4;
    }

    /**
     * @dev Validate storage layout before upgrade
     * @param expectedVersion The expected storage version before upgrade
     * @return isValid Whether the storage layout is valid for upgrade
     */
    function validateStorageLayoutForUpgrade(uint256 expectedVersion) internal view returns (bool isValid) {
        AppStorage storage ds = diamondStorage();
        
        // Check if storage version matches expected
        if (ds.storageVersion != expectedVersion) {
            return false;
        }
        
        // Validate storage layout hash for current version
        if (expectedVersion == 1 && ds.storageLayoutHash != STORAGE_LAYOUT_HASH_V1) {
            return false;
        }
        if (expectedVersion == 2 && ds.storageLayoutHash != STORAGE_LAYOUT_HASH_V2) {
            return false;
        }
        if (expectedVersion == 3 && ds.storageLayoutHash != STORAGE_LAYOUT_HASH_V3) {
            return false;
        }
        if (expectedVersion == 4 && ds.storageLayoutHash != STORAGE_LAYOUT_HASH_V4) {
            return false;
        }
        
        return true;
    }

    /**
     * @dev Update storage version after successful upgrade
     * @param newVersion The new storage version
     * @param newLayoutHash The new storage layout hash
     */
    function updateStorageVersion(uint256 newVersion, bytes32 newLayoutHash) internal {
        AppStorage storage ds = diamondStorage();
        ds.storageVersion = newVersion;
        ds.upgradeTimestamp = block.timestamp;
        ds.storageLayoutHash = newLayoutHash;
    }

    /**
     * @dev Get current storage version info
     * @return version Current storage version
     * @return timestamp Last upgrade timestamp
     * @return layoutHash Current layout hash
     */
    function getStorageVersionInfo() internal view returns (uint256 version, uint256 timestamp, bytes32 layoutHash) {
        AppStorage storage ds = diamondStorage();
        return (ds.storageVersion, ds.upgradeTimestamp, ds.storageLayoutHash);
    }
}
