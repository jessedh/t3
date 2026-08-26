import { onchainTable, onchainEnum } from "ponder";

// Enums for event types
export const walletTypeEnum = onchainEnum("wallet_type", ["BANK", "CUSTOMER", "OTHER"]);
export const kycLevelEnum = onchainEnum("kyc_level", ["NONE", "BASIC", "ENHANCED", "INSTITUTIONAL"]);

// Recovery enums
export const recoveryStateEnum = onchainEnum("recovery_state", [
  "NONE",
  "RECOVERY_PENDING",
  "RECOVERY_ACTIVE",
  "RECOVERY_COMPLETE",
  "RECOVERY_CANCELLED",
]);

export const recoveryTypeEnum = onchainEnum("recovery_type", [
  "LOST_KEY",
  "COMPROMISED",
  "BANK_EXIT",
  "KEY_ROTATION",
]);

export const envelopeRecoveryChoiceEnum = onchainEnum("envelope_recovery_choice", [
  "FINALIZE",
  "REVERSE",
  "CLAWBACK",
  "CONFIRM_FIAT",
  "CARRY_DISPUTE",
]);

export const recoveryEventTypeEnum = onchainEnum("recovery_event_type", [
  "INITIATED",
  "TIMELOCK_STARTED",
  "SUCCESSOR_DESIGNATED",
  "SUCCESSOR_REDIRECTED",
  "ELECTION_WINDOW_EXPIRED",
  "ENVELOPE_RESOLVED",
  "CHOICE_OVERRIDDEN",
  "CAMBIO_NOTE_RESOLVED",
  "NOTE_REDEEMED",
  "BALANCE_MIGRATED",
  "COMPLETED",
  "CANCELLED",
]);

// Core Entities
export const wallet = onchainTable("wallet", (t) => ({
  id: t.text().primaryKey(), // Address
  type: walletTypeEnum("type").notNull(),
  lastActive: t.integer().notNull(),
}));

export const bank = onchainTable("bank", (t) => ({
  id: t.text().primaryKey(), // Address
  name: t.text().notNull(),
  isActive: t.boolean().notNull(),
  primarySigner: t.text(),
  registeredAt: t.integer().notNull(),
}));

export const customer = onchainTable("customer", (t) => ({
  id: t.text().primaryKey(), // Address
  bankId: t.text(), // Remove .references() as Ponder doesn't support FK
  kycLevel: kycLevelEnum("kycLevel"),
  joinedAt: t.integer(),
}));

// Transfer Events
export const transferEvent = onchainTable("transfer_event", (t) => ({
  id: t.text().primaryKey(),
  from: t.text().notNull(),
  to: t.text().notNull(),
  amount: t.text().notNull(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// @deprecated — superseded by direct_transfer_event / cambio_envelope_note_event respectively.
// Table preserved for historical data integrity. Do not write new handlers to it.
export const lockedTransferEvent = onchainTable("locked_transfer_event", (t) => ({
  id: t.text().primaryKey(),
  eventType: t.text().notNull(), // "Locked", "Accepted", "Rejected", "Cancelled"
  transferId: t.text().notNull(),
  sender: t.text().notNull(),
  recipient: t.text().notNull(),
  amount: t.text(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Transfer Cancellation Events
export const transferCancellationEvent = onchainTable("transfer_cancellation_event", (t) => ({
  id: t.text().primaryKey(),
  transferId: t.text().notNull(),
  originator: t.text().notNull(),
  recipient: t.text().notNull(),
  amountCancelled: t.text().notNull(),
  remainingAmount: t.text().notNull(),
  reverseFees: t.boolean().notNull(),
  actualActor: t.text().notNull(),
  txExecutor: t.text().notNull(),
  actorRole: t.text().notNull(),
  reasonCode: t.integer().notNull(),
  reasonHash: t.text(),
  reasonNotesHash: t.text(),
  reasonNotes: t.text(),           // Full text captured from event for long-term reporting
  isPartial: t.boolean().notNull(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Cambio Events
// @deprecated — superseded by direct_transfer_event / cambio_envelope_note_event respectively.
// Table preserved for historical data integrity. Do not write new handlers to it.
export const cambioEvent = onchainTable("cambio_event", (t) => ({
  id: t.text().primaryKey(),
  eventType: t.text().notNull(), // "NoteIssued", "NoteRedeemed", "NoteCancelled", "ConfigUpdated"
  noteId: t.text(),
  issuer: t.text(),
  redeemer: t.text(),
  amount: t.text(),
  remainingAmount: t.text(),
  remaining: t.text(),
  deadline: t.integer(),
  checksumCode: t.text(),
  phraseLength: t.integer(),
  receiptId: t.text(),
  maxNoteValue: t.text(),
  minDeadlineBuffer: t.integer(),
  maxDeadlineWindow: t.integer(),
  maxMetadataLength: t.integer(),
  caller: t.text(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Secure Settlement Events
export const secureSettlementEvent = onchainTable("secure_settlement_event", (t) => ({
  id: t.text().primaryKey(),
  eventType: t.text().notNull(), // "Initiated", "Approved", "Executed", "Cancelled", "Expired"
  settlementId: t.text().notNull(),
  initiator: t.text(),
  approver: t.text(),
  totalUsdValue: t.text(),
  executesAt: t.integer(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Multi-Sig Settlement Events
export const multiSigSettlementEvent = onchainTable("multi_sig_settlement_event", (t) => ({
  id: t.text().primaryKey(),
  eventType: t.text().notNull(), // "Proposed", "Approved", "Executed", "Cancelled"
  settlementId: t.text().notNull(),
  proposer: t.text(),
  approver: t.text(),
  canceller: t.text(),
  amount: t.text(),
  currentApprovals: t.integer(),
  requiredApprovals: t.integer(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Batch HalfLife Events
export const batchHalfLifeEvent = onchainTable("batch_half_life_event", (t) => ({
  id: t.text().primaryKey(),
  eventType: t.text().notNull(), // "BatchHalfLifeExpired", "BatchHalfLifeReversed", "HalfLifeExpiredSingle", "HalfLifeReversedSingle"
  recipient: t.text(),
  originator: t.text(),
  amount: t.text(),
  totalProcessed: t.text(),
  totalAmount: t.text(),
  recipients: t.integer(),
  recipientsHash: t.text(),
  txHash: t.text().notNull(),
  timestamp: t.integer().notNull(),
}));

// Interbank Liability Events
export const interbankLiabilityEvent = onchainTable("interbank_liability_event", (t) => ({
  id: t.text().primaryKey(),
  eventType: t.text().notNull(), // "LiabilityRecorded", "LiabilityCleared"
  debtor: t.text().notNull(),
  creditor: t.text().notNull(),
  amount: t.text(),
  amountCleared: t.text(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Audit Trail Events
export const auditTrailEvent = onchainTable("audit_trail_event", (t) => ({
  id: t.text().primaryKey(),
  eventType: t.text().notNull(),
  logId: t.text().notNull(),
  actor: t.text().notNull(),
  category: t.text().notNull(),
  action: t.text().notNull(),
  severity: t.integer().notNull(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Automated Response Events
export const automatedResponseEvent = onchainTable("automated_response_event", (t) => ({
  id: t.text().primaryKey(),
  eventType: t.text().notNull(),
  threatLevel: t.integer(),
  actor: t.text(),
  actionType: t.text(),
  success: t.boolean(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Rules Config Events
export const rulesConfigEvent = onchainTable("rules_config_event", (t) => ({
  id: t.text().primaryKey(),
  eventType: t.text().notNull(),
  scopeKey: t.text().notNull(),
  version: t.integer(),
  observationMode: t.boolean(),
  warnAt: t.text(),
  denyAt: t.text(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Screening Attestation Events (Wave 8C + 8E-1)
export const screeningEvent = onchainTable("screening_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  eventType: t.text().notNull().default("WALLET_SCREENED"),
  wallet: t.text().notNull(),
  institutionId: t.text(), // populated for SCOPED / SANCTIONS_ENABLED / DEFUNCT_CLEARED
  status: t.integer().notNull(),
  previousStatus: t.integer(), // NETWORK_CLEARED audit field
  listVersionHash: t.text().notNull(),
  reasonHash: t.text(), // NETWORK_CLEARED / EXEMPTION_GRANTED audit field
  count: t.integer(), // DEFUNCT_INSTITUTION_BLOCKS_CLEARED count
  enabled: t.boolean(), // INSTITUTION_SANCTIONS_ENABLED_SET value
  attestor: t.text().notNull(), // attestor, authority, setBy, or grantedBy
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Compliance Exemption Events (Wave 8E-1)
export const complianceExemptionEvent = onchainTable("compliance_exemption_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  scopeId: t.text().notNull(),
  controlKey: t.text().notNull(),
  reasonHash: t.text().notNull(),
  grantedBy: t.text().notNull(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Travel Rule Events (Wave 8D)
export const travelRuleEvent = onchainTable("travel_rule_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  envelopeId: t.text().notNull(),
  sender: t.text().notNull(),
  ref: t.text().notNull(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// CIP Attestation Events (Wave 8E-2)
export const cipEvent = onchainTable("cip_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  eventType: t.text().notNull(), // "Recorded", "Revoked"
  wallet: t.text().notNull(),
  custodian: t.text().notNull(),
  cipRecordHash: t.text(), // populated for Recorded; empty for Revoked
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Depositor Identity Events (Wave 8E-2)
export const depositorIdentityEvent = onchainTable("depositor_identity_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  eventType: t.text().notNull(), // "HashSubmitted", "HashRemoved", "HashBatchSubmitted", "HashBatchRemoved", "ConflictDetected", "SaltEpochCreated", "SaltEpochExpired", "EmergencySaltCompromise"
  bank: t.text(),
  counterpartyBank: t.text(),
  tinHash: t.text(),
  count: t.integer(),
  epochId: t.integer(),
  saltHash: t.text(),
  activatedAt: t.integer(),
  transitionWindow: t.integer(),
  expiredAt: t.integer(),
  newEpochId: t.integer(),
  admin: t.text(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Recovery Records
export const recoveryRecord = onchainTable("recovery_record", (t) => ({
  id: t.text().primaryKey(), // recoveryId (bytes32)
  oldWallet: t.text().notNull(),
  newWallet: t.text(),
  recoveryType: recoveryTypeEnum("recovery_type").notNull(),
  state: recoveryStateEnum("state").notNull(),
  initiatedAt: t.integer().notNull(),
  initiatedBy: t.text().notNull(),
  electionWindowEndsAt: t.integer(),
  timelockEndsAt: t.integer(),
  envelopesResolved: t.integer().notNull().default(0),
  cambioNotesResolved: t.integer().notNull().default(0),
  completedAt: t.integer(),
  cancelledAt: t.integer(),
  cancelledBy: t.text(),
  irreversible: t.boolean(),
  lastUpdatedAt: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Recovery State Transitions (event log)
export const recoveryStateTransition = onchainTable("recovery_state_transition", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  recoveryId: t.text().notNull(),
  eventType: recoveryEventTypeEnum("event_type").notNull(),
  oldWallet: t.text(),
  newWallet: t.text(),
  designatedBy: t.text(),
  oldNewWallet: t.text(),
  choice: t.integer(),
  action: t.integer(),
  amountMoved: t.text(),
  amountReturned: t.text(),
  balanceMigrated: t.text(),
  irreversible: t.boolean(),
  timelockEndsAt: t.integer(),
  electionWindowEndsAt: t.integer(),
  triggerer: t.text(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Recovery Envelope Resolutions
export const recoveryEnvelopeResolution = onchainTable("recovery_envelope_resolution", (t) => ({
  id: t.text().primaryKey(), // recoveryId-envelopeId
  recoveryId: t.text().notNull(),
  envelopeId: t.text().notNull(),
  choice: envelopeRecoveryChoiceEnum("choice").notNull(),
  amountMoved: t.text().notNull(),
  replayed: t.boolean().notNull().default(false),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Recovery Cambio Note Resolutions
export const recoveryCambioNoteResolution = onchainTable("recovery_cambio_note_resolution", (t) => ({
  id: t.text().primaryKey(), // recoveryId-noteId
  recoveryId: t.text().notNull(),
  noteId: t.text().notNull(),
  action: t.integer().notNull(), // 0=transferred, 1=cancelled, 2=expired, 255=skip
  amountReturned: t.text().notNull(),
  replayed: t.boolean().notNull().default(false),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// ============================================================================
// Envelope-Mode Events (Phase 1C — T6.2)
// ============================================================================

// Direct Transfer Events
export const directTransferEvent = onchainTable("direct_transfer_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  operator: t.text().notNull(),
  from: t.text().notNull(),
  to: t.text().notNull(),
  amount: t.text().notNull(),
  feeAmount: t.text().notNull(),
  transferKind: t.integer().notNull(),
  correlationId: t.text().notNull(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Envelope Lifecycle Events
export const envelopeEvent = onchainTable("envelope_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  eventType: t.text().notNull(), // "Created", "Finalized", "Reversed"
  envelopeId: t.text().notNull(),
  sender: t.text(),
  recipient: t.text(),
  amount: t.text(),
  commitWindowEnd: t.integer(),
  settlementType: t.integer(),
  expirationBehavior: t.integer(),
  finalizedAt: t.integer(),
  reversedAmount: t.text(),
  reversedAt: t.integer(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Smart Lock Envelope Events
export const smartLockEnvelopeEvent = onchainTable("smart_lock_envelope_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  eventType: t.text().notNull(), // "Created", "Released", "Cancelled"
  envelopeId: t.text().notNull(),
  sender: t.text(),
  recipient: t.text(),
  amount: t.text(),
  releaseAuthorizedAddress: t.text(),
  releasedBy: t.text(),
  cancelledBy: t.text(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Cambio Envelope Note Events
export const cambioEnvelopeNoteEvent = onchainTable("cambio_envelope_note_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  eventType: t.text().notNull(), // "Created", "Redeemed", "Cancelled"
  noteId: t.text().notNull(),
  issuer: t.text(),
  redeemer: t.text(),
  amount: t.text(),
  deadline: t.integer(),
  phraseCommitment: t.text(),
  openRedemptionSnapshot: t.boolean(),
  requiresCommitReveal: t.boolean(),
  remaining: t.text(),
  receiptId: t.text(),
  remainingAmount: t.text(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Cambio Commit Events (commit-reveal system)
export const cambioCommitEvent = onchainTable("cambio_commit_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  eventType: t.text().notNull(), // "Cleared", "Cancelled"
  commitmentHash: t.text().notNull(),
  redeemer: t.text(),
  noteId: t.text(),
  amount: t.text(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// Cambio Issuer Events
export const cambioIssuerEvent = onchainTable("cambio_issuer_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  eventType: t.text().notNull(), // "OpenRedemptionUpdated", "SponsorBankEndorsed", "PauseStateChanged"
  issuer: t.text().notNull(),
  open: t.boolean(),
  sponsorBank: t.text(),
  newState: t.integer(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// ============================================================================
// Issuance Events (Wave 6A)
// ============================================================================

export const issuanceEvent = onchainTable("issuance_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  eventType: t.text().notNull(), // "Reserved", "Executed", "Cancelled", "Expired"
  issuanceId: t.text().notNull(),
  bank: t.text().notNull(),
  amount: t.text().notNull(),
  expiry: t.integer(),
  newState: t.integer(), // ReservationState ordinal on release (3=Cancelled, 4=Expired)
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

// ============================================================================
// Settlement Cycle Events (Wave 6A)
// ============================================================================

// Obligation-level rows (system of record for keeper obligation-root + 6C reconciliation).
// The on-chain event is thin (no cycleId/sourceTransferId); enrich via getSettlementObligation.
export const settlementObligation = onchainTable("settlement_obligation", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  obligationId: t.text().notNull(),
  outgoingIssuer: t.text().notNull(),
  receivingIssuer: t.text().notNull(),
  amount: t.text().notNull(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));

export const settlementCycleEvent = onchainTable("settlement_cycle_event", (t) => ({
  id: t.text().primaryKey(), // txHash-logIndex
  eventType: t.text().notNull(), // "Opened", "Proposed", "Confirmed", "Funded", "Finalized", "Failed"
  cycleId: t.text().notNull(),
  institution: t.text(),
  fundingIssuer: t.text(),
  settlementAsset: t.text(),
  amount: t.text(),
  netAmount: t.text(),
  cycleType: t.integer(),
  openedAt: t.integer(),
  obligationRoot: t.text(),
  confirmationDeadline: t.integer(),
  finalizedAt: t.integer(),
  exceptionRoot: t.text(),
  timestamp: t.integer().notNull(),
  txHash: t.text().notNull(),
}));
