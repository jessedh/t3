import { ponder } from "ponder:registry";
import { keccak256, encodePacked } from "viem";
import {
    wallet,
    bank,
    transferEvent,
    cambioEvent,
    recoveryRecord,
    recoveryStateTransition,
    recoveryEnvelopeResolution,
    recoveryCambioNoteResolution,
    directTransferEvent,
    envelopeEvent,
    smartLockEnvelopeEvent,
    cambioEnvelopeNoteEvent,
    cambioCommitEvent,
    cambioIssuerEvent,
    issuanceEvent,
    settlementCycleEvent,
    settlementObligation,
    screeningEvent,
    travelRuleEvent,
    complianceExemptionEvent,
    cipEvent,
    depositorIdentityEvent,
} from "ponder:schema";

// Helper to create unique event ID
const createEventId = (txHash: string, logIndex: string | number) =>
    `${txHash}-${logIndex}`;

// Helper to upsert recovery record with idempotency guard
const upsertRecoveryRecord = async (
    db: any,
    recoveryId: string,
    values: Partial<typeof recoveryRecord.$inferInsert>
) => {
    await db
        .insert(recoveryRecord)
        .values({
            id: recoveryId,
            oldWallet: "0x0000000000000000000000000000000000000000",
            recoveryType: "LOST_KEY",
            state: "NONE",
            initiatedAt: 0,
            initiatedBy: "0x0000000000000000000000000000000000000000",
            envelopesResolved: 0,
            cambioNotesResolved: 0,
            lastUpdatedAt: 0,
            txHash: "0x",
            ...values,
        })
        .onConflictDoUpdate(values);
};

// ============================================================================
// Transfer Events
// ============================================================================

ponder.on("T3Diamond:Transfer", async ({ event, context }) => {
    const { db } = context;

    await db.insert(transferEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        from: event.args.from,
        to: event.args.to,
        amount: event.args.value.toString(),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });

    // Update wallet tracking
    for (const address of [event.args.from, event.args.to]) {
        await db
            .insert(wallet)
            .values({
                id: address,
                type: "OTHER",
                lastActive: Number(event.block.timestamp),
            })
            .onConflictDoUpdate({
                lastActive: Number(event.block.timestamp),
            });
    }
});

// ============================================================================
// Cambio Events
// ============================================================================

ponder.on("T3Diamond:CambioConfigUpdated", async ({ event, context }) => {
    await context.db.insert(cambioEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "ConfigUpdated",
        maxNoteValue: event.args.maxNoteValue.toString(),
        minDeadlineBuffer: Number(event.args.minDeadlineBuffer),
        maxDeadlineWindow: Number(event.args.maxDeadlineWindow),
        maxMetadataLength: Number(event.args.maxMetadataLength),
        caller: event.transaction.from,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// Bank/Customer Events
// ============================================================================

ponder.on("T3Diamond:BankRegistered", async ({ event, context }) => {
    await context.db.insert(bank).values({
        id: event.args.bank,
        name: event.args.name || "Unknown Bank",
        isActive: true,
        primarySigner: event.args.primarySigner,
        registeredAt: Number(event.block.timestamp),
    });

    await context.db
        .insert(wallet)
        .values({
            id: event.args.bank,
            type: "BANK",
            lastActive: Number(event.block.timestamp),
        })
        .onConflictDoUpdate({
            type: "BANK",
            lastActive: Number(event.block.timestamp),
        });
});

ponder.on("T3Diamond:BankActivationChanged", async ({ event, context }) => {
    await context.db
        .insert(bank)
        .values({
            id: event.args.bank,
            name: "Unknown Bank",
            isActive: event.args.isActive,
            registeredAt: Number(event.block.timestamp),
        })
        .onConflictDoUpdate({
            isActive: event.args.isActive,
        });
});

// ============================================================================
// Wallet Recovery Events (FR-1402)
// ============================================================================

const recoveryTypeMap: Record<number, string> = {
    0: "LOST_KEY",
    1: "COMPROMISED",
    2: "BANK_EXIT",
    3: "KEY_ROTATION",
};

const recoveryStateMap: Record<number, string> = {
    0: "NONE",
    1: "RECOVERY_PENDING",
    2: "RECOVERY_ACTIVE",
    3: "RECOVERY_COMPLETE",
    4: "RECOVERY_CANCELLED",
};

ponder.on("T3Diamond:RecoveryInitiated", async ({ event, context }) => {
    const { db } = context;
    const recoveryId = event.args.recoveryId;
    const state = recoveryStateMap[1] ?? "RECOVERY_PENDING";
    const recoveryType = recoveryTypeMap[Number(event.args.recoveryType)] ?? "LOST_KEY";

    await db.insert(recoveryRecord).values({
        id: recoveryId,
        oldWallet: event.args.oldWallet,
        recoveryType: recoveryType as any,
        state: state as any,
        initiatedAt: Number(event.args.initiatedAt),
        initiatedBy: event.transaction.from,
        electionWindowEndsAt: null,
        timelockEndsAt: null,
        envelopesResolved: 0,
        cambioNotesResolved: 0,
        lastUpdatedAt: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId,
        eventType: "INITIATED",
        oldWallet: event.args.oldWallet,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:RecoveryTimelockStarted", async ({ event, context }) => {
    const { db } = context;
    const recoveryId = event.args.recoveryId;

    await db
        .insert(recoveryRecord)
        .values({
            id: recoveryId,
            oldWallet: "0x0000000000000000000000000000000000000000",
            recoveryType: "LOST_KEY" as any,
            state: "RECOVERY_PENDING" as any,
            initiatedAt: 0,
            initiatedBy: "0x0000000000000000000000000000000000000000",
            timelockEndsAt: Number(event.args.timelockEndsAt),
            lastUpdatedAt: Number(event.block.timestamp),
            txHash: event.transaction.hash,
        })
        .onConflictDoUpdate({
            timelockEndsAt: Number(event.args.timelockEndsAt),
            lastUpdatedAt: Number(event.block.timestamp),
        });

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId,
        eventType: "TIMELOCK_STARTED",
        timelockEndsAt: Number(event.args.timelockEndsAt),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:RecoverySuccessorDesignated", async ({ event, context }) => {
    const { db } = context;
    const recoveryId = event.args.recoveryId;

    await db
        .insert(recoveryRecord)
        .values({
            id: recoveryId,
            oldWallet: "0x0000000000000000000000000000000000000000",
            recoveryType: "LOST_KEY" as any,
            state: "RECOVERY_ACTIVE" as any,
            initiatedAt: 0,
            initiatedBy: "0x0000000000000000000000000000000000000000",
            newWallet: event.args.newWallet,
            lastUpdatedAt: Number(event.block.timestamp),
            txHash: event.transaction.hash,
        })
        .onConflictDoUpdate({
            newWallet: event.args.newWallet,
            state: "RECOVERY_ACTIVE" as any,
            lastUpdatedAt: Number(event.block.timestamp),
        });

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId,
        eventType: "SUCCESSOR_DESIGNATED",
        newWallet: event.args.newWallet,
        designatedBy: event.args.designatedBy,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:RecoverySuccessorRedirected", async ({ event, context }) => {
    const { db } = context;
    const recoveryId = event.args.recoveryId;

    await db
        .insert(recoveryRecord)
        .values({
            id: recoveryId,
            oldWallet: "0x0000000000000000000000000000000000000000",
            recoveryType: "LOST_KEY" as any,
            state: "RECOVERY_ACTIVE" as any,
            initiatedAt: 0,
            initiatedBy: "0x0000000000000000000000000000000000000000",
            newWallet: event.args.newNewWallet,
            lastUpdatedAt: Number(event.block.timestamp),
            txHash: event.transaction.hash,
        })
        .onConflictDoUpdate({
            newWallet: event.args.newNewWallet,
            lastUpdatedAt: Number(event.block.timestamp),
        });

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId,
        eventType: "SUCCESSOR_REDIRECTED",
        oldNewWallet: event.args.oldNewWallet,
        newWallet: event.args.newNewWallet,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:RecoveryElectionWindowExpired", async ({ event, context }) => {
    const { db } = context;
    const recoveryId = event.args.recoveryId;

    await db
        .insert(recoveryRecord)
        .values({
            id: recoveryId,
            oldWallet: "0x0000000000000000000000000000000000000000",
            recoveryType: "LOST_KEY" as any,
            state: "RECOVERY_PENDING" as any,
            initiatedAt: 0,
            initiatedBy: "0x0000000000000000000000000000000000000000",
            electionWindowEndsAt: Number(event.args.electionWindowEndsAt),
            lastUpdatedAt: Number(event.block.timestamp),
            txHash: event.transaction.hash,
        })
        .onConflictDoUpdate({
            electionWindowEndsAt: Number(event.args.electionWindowEndsAt),
            lastUpdatedAt: Number(event.block.timestamp),
        });

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId,
        eventType: "ELECTION_WINDOW_EXPIRED",
        electionWindowEndsAt: Number(event.args.electionWindowEndsAt),
        triggerer: event.args.emittedBy,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:RecoveryEnvelopeResolved", async ({ event, context }) => {
    const { db } = context;
    const recoveryId = event.args.recoveryId;
    const envelopeId = event.args.envelopeId;
    const choice = Number(event.args.choice);
    const amountMoved = event.args.amountMoved.toString();
    const replayed = event.args.replayed;

    // Only increment counter on first resolution, not on replay
    if (!replayed) {
        const existing = await db.find(recoveryRecord, { id: recoveryId });
        if (existing) {
            await db.update(recoveryRecord, { id: recoveryId }).set({
                envelopesResolved: existing.envelopesResolved + 1,
                lastUpdatedAt: Number(event.block.timestamp),
            });
        }
    }

    // Upsert: safe to re-process on replay
    await db.insert(recoveryEnvelopeResolution)
        .values({
            id: `${recoveryId}-${envelopeId}`,
            recoveryId,
            envelopeId,
            choice: choice as any,
            amountMoved,
            replayed,
            timestamp: Number(event.block.timestamp),
            txHash: event.transaction.hash,
        })
        .onConflictDoUpdate({
            choice: choice as any,
            amountMoved,
            replayed,
            timestamp: Number(event.block.timestamp),
            txHash: event.transaction.hash,
        });

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId,
        eventType: "ENVELOPE_RESOLVED",
        choice,
        amountMoved,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:EnvelopeChoiceOverridden", async ({ event, context }) => {
    const { db } = context;
    const recoveryId = event.args.recoveryId;

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId,
        eventType: "CHOICE_OVERRIDDEN",
        choice: Number(event.args.choice),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:RecoveryCambioNoteResolved", async ({ event, context }) => {
    const { db } = context;
    const recoveryId = event.args.recoveryId;
    const noteId = event.args.noteId;
    const action = Number(event.args.action);
    const amountReturned = event.args.amountReturned.toString();
    const replayed = event.args.replayed;

    // Only increment counter on first resolution, not on replay
    if (!replayed) {
        const existing = await db.find(recoveryRecord, { id: recoveryId });
        if (existing) {
            await db.update(recoveryRecord, { id: recoveryId }).set({
                cambioNotesResolved: existing.cambioNotesResolved + 1,
                lastUpdatedAt: Number(event.block.timestamp),
            });
        }
    }

    // Upsert: safe to re-process on replay
    await db.insert(recoveryCambioNoteResolution)
        .values({
            id: `${recoveryId}-${noteId}`,
            recoveryId,
            noteId,
            action,
            amountReturned,
            replayed,
            timestamp: Number(event.block.timestamp),
            txHash: event.transaction.hash,
        })
        .onConflictDoUpdate({
            action,
            amountReturned,
            replayed,
            timestamp: Number(event.block.timestamp),
            txHash: event.transaction.hash,
        });

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId,
        eventType: "CAMBIO_NOTE_RESOLVED",
        action,
        amountReturned,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:NoteRedeemed", async ({ event, context }) => {
    const { db } = context;

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId: "", // NoteRedeemed does not carry recoveryId; indexed as standalone
        eventType: "NOTE_REDEEMED",
        oldWallet: event.args.legacyIssuer,
        newWallet: event.args.effectiveIssuer,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:RecoveryBalanceMigrated", async ({ event, context }) => {
    const { db } = context;
    const recoveryId = event.args.recoveryId;

    await db
        .insert(recoveryRecord)
        .values({
            id: recoveryId,
            oldWallet: event.args.oldWallet,
            recoveryType: "LOST_KEY" as any,
            state: "RECOVERY_ACTIVE" as any,
            initiatedAt: 0,
            initiatedBy: "0x0000000000000000000000000000000000000000",
            newWallet: event.args.newWallet,
            lastUpdatedAt: Number(event.block.timestamp),
            txHash: event.transaction.hash,
        })
        .onConflictDoUpdate({
            lastUpdatedAt: Number(event.block.timestamp),
        });

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId,
        eventType: "BALANCE_MIGRATED",
        oldWallet: event.args.oldWallet,
        newWallet: event.args.newWallet,
        balanceMigrated: event.args.amount.toString(),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:RecoveryComplete", async ({ event, context }) => {
    const { db } = context;
    const recoveryId = event.args.recoveryId;

    await db
        .insert(recoveryRecord)
        .values({
            id: recoveryId,
            oldWallet: event.args.oldWallet,
            recoveryType: "LOST_KEY" as any,
            state: "RECOVERY_COMPLETE" as any,
            initiatedAt: 0,
            initiatedBy: "0x0000000000000000000000000000000000000000",
            newWallet: event.args.newWallet,
            completedAt: Number(event.args.completedAt),
            lastUpdatedAt: Number(event.block.timestamp),
            txHash: event.transaction.hash,
        })
        .onConflictDoUpdate({
            state: "RECOVERY_COMPLETE" as any,
            newWallet: event.args.newWallet,
            completedAt: Number(event.args.completedAt),
            lastUpdatedAt: Number(event.block.timestamp),
        });

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId,
        eventType: "COMPLETED",
        oldWallet: event.args.oldWallet,
        newWallet: event.args.newWallet,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:RecoveryCancelled", async ({ event, context }) => {
    const { db } = context;
    const recoveryId = event.args.recoveryId;

    await db
        .insert(recoveryRecord)
        .values({
            id: recoveryId,
            oldWallet: event.args.oldWallet,
            recoveryType: "LOST_KEY" as any,
            state: "RECOVERY_CANCELLED" as any,
            initiatedAt: 0,
            initiatedBy: "0x0000000000000000000000000000000000000000",
            cancelledAt: Number(event.block.timestamp),
            cancelledBy: event.args.cancelledBy,
            irreversible: event.args.irreversible,
            lastUpdatedAt: Number(event.block.timestamp),
            txHash: event.transaction.hash,
        })
        .onConflictDoUpdate({
            state: "RECOVERY_CANCELLED" as any,
            cancelledAt: Number(event.block.timestamp),
            cancelledBy: event.args.cancelledBy,
            irreversible: event.args.irreversible,
            lastUpdatedAt: Number(event.block.timestamp),
        });

    await db.insert(recoveryStateTransition).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        recoveryId,
        eventType: "CANCELLED",
        oldWallet: event.args.oldWallet,
        cancelledBy: event.args.cancelledBy,
        irreversible: event.args.irreversible,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// Direct Transfer Events (Phase 1C — envelope-mode)
// ============================================================================

ponder.on("T3Diamond:DirectTransferExecuted", async ({ event, context }) => {
    const { db } = context;

    let correlationId = event.args.correlationId;
    if (correlationId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
        const chainId = (event as any).network?.chainId ?? 43113;
        correlationId = keccak256(
            encodePacked(
                ["uint256", "address", "bytes32", "uint256"],
                [
                    BigInt(chainId),
                    context.contracts.T3Diamond.address,
                    event.transaction.hash,
                    BigInt(event.log.logIndex),
                ]
            )
        );
    }

    await db.insert(directTransferEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        operator: event.args.operator,
        from: event.args.from,
        to: event.args.to,
        amount: event.args.amount.toString(),
        feeAmount: event.args.feeAmount.toString(),
        transferKind: Number(event.args.transferKind),
        correlationId: correlationId,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });

    // Update wallet tracking for both parties
    for (const address of [event.args.from, event.args.to]) {
        await db
            .insert(wallet)
            .values({
                id: address,
                type: "OTHER",
                lastActive: Number(event.block.timestamp),
            })
            .onConflictDoUpdate({
                lastActive: Number(event.block.timestamp),
            });
    }
});

// ============================================================================
// Envelope Lifecycle Events
// ============================================================================

ponder.on("T3Diamond:EnvelopeCreated", async ({ event, context }) => {
    await context.db.insert(envelopeEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Created",
        envelopeId: event.args.envelopeId,
        sender: event.args.sender,
        recipient: event.args.recipient,
        amount: event.args.amount.toString(),
        commitWindowEnd: Number(event.args.commitWindowEnd),
        settlementType: Number(event.args.settlementType),
        expirationBehavior: Number(event.args.expirationBehavior),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:EnvelopeFinalized", async ({ event, context }) => {
    await context.db.insert(envelopeEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Finalized",
        envelopeId: event.args.envelopeId,
        finalizedAt: Number(event.args.finalizedAt),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:EnvelopeReversed", async ({ event, context }) => {
    await context.db.insert(envelopeEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Reversed",
        envelopeId: event.args.envelopeId,
        reversedAmount: event.args.reversedAmount.toString(),
        reversedAt: Number(event.args.reversedAt),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// Smart Lock Envelope Events
// ============================================================================

ponder.on("T3Diamond:SmartLockEnvelopeCreated", async ({ event, context }) => {
    await context.db.insert(smartLockEnvelopeEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Created",
        envelopeId: event.args.envelopeId,
        sender: event.args.sender,
        recipient: event.args.recipient,
        amount: event.args.amount.toString(),
        releaseAuthorizedAddress: event.args.releaseAuthorizedAddress,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:SmartLockEnvelopeReleased", async ({ event, context }) => {
    await context.db.insert(smartLockEnvelopeEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Released",
        envelopeId: event.args.envelopeId,
        releasedBy: event.args.releasedBy,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:SmartLockEnvelopeCancelled", async ({ event, context }) => {
    await context.db.insert(smartLockEnvelopeEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Cancelled",
        envelopeId: event.args.envelopeId,
        cancelledBy: event.args.cancelledBy,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// Cambio Envelope Note Events
// ============================================================================

ponder.on("T3Diamond:CambioEnvelopeNoteCreated", async ({ event, context }) => {
    await context.db.insert(cambioEnvelopeNoteEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Created",
        noteId: event.args.noteId,
        issuer: event.args.issuer,
        amount: event.args.amount.toString(),
        deadline: Number(event.args.deadline),
        phraseCommitment: event.args.phraseCommitment,
        openRedemptionSnapshot: event.args.openRedemptionSnapshot,
        requiresCommitReveal: event.args.requiresCommitReveal,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:CambioEnvelopeNoteRedeemed", async ({ event, context }) => {
    await context.db.insert(cambioEnvelopeNoteEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Redeemed",
        noteId: event.args.noteId,
        redeemer: event.args.redeemer,
        amount: event.args.amount.toString(),
        remaining: event.args.remaining.toString(),
        receiptId: event.args.receiptId,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:CambioEnvelopeNoteCancelled", async ({ event, context }) => {
    await context.db.insert(cambioEnvelopeNoteEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Cancelled",
        noteId: event.args.noteId,
        issuer: event.args.issuer,
        remainingAmount: event.args.remainingAmount.toString(),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// Cambio Commit Events (commit-reveal system)
// ============================================================================

ponder.on("T3Diamond:CommitCleared", async ({ event, context }) => {
    await context.db.insert(cambioCommitEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Cleared",
        commitmentHash: event.args.commitmentHash,
        redeemer: event.args.redeemer,
        noteId: event.args.noteId,
        amount: event.args.amount.toString(),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:CommitCancelled", async ({ event, context }) => {
    await context.db.insert(cambioCommitEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Cancelled",
        commitmentHash: event.args.commitmentHash,
        redeemer: event.args.redeemer,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// Cambio Issuer Events
// ============================================================================

ponder.on("T3Diamond:IssuerOpenRedemptionUpdated", async ({ event, context }) => {
    await context.db.insert(cambioIssuerEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "OpenRedemptionUpdated",
        issuer: event.args.issuer,
        open: event.args.open,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:SponsorBankEndorsed", async ({ event, context }) => {
    await context.db.insert(cambioIssuerEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "SponsorBankEndorsed",
        issuer: event.args.issuer,
        sponsorBank: event.args.sponsorBank,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:IssuerPauseStateChanged", async ({ event, context }) => {
    await context.db.insert(cambioIssuerEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "PauseStateChanged",
        issuer: event.args.issuer,
        newState: Number(event.args.newState),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// @ts-ignore
ponder.on("T3Diamond:IssuerRegistered(address indexed issuer, uint256 timestamp)", async ({ event, context }) => {
    const args = event.args as any;
    await context.db.insert(cambioIssuerEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Registered",
        issuer: args.issuer,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// @ts-ignore
ponder.on("T3Diamond:IssuerRegistered(address indexed issuer, address indexed sponsorBank, uint256 timestamp)", async ({ event, context }) => {
    const args = event.args as any;
    await context.db.insert(cambioIssuerEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Registered",
        issuer: args.issuer,
        sponsorBank: args.sponsorBank,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// Screening Attestation Events (Wave 8C + 8E-1)
// ============================================================================

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

ponder.on("T3Diamond:WalletScreened", async ({ event, context }) => {
    await context.db.insert(screeningEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "WALLET_SCREENED",
        wallet: event.args.wallet,
        status: Number(event.args.status),
        listVersionHash: event.args.listVersionHash,
        attestor: event.args.attestor,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:ScreeningBlocked", async ({ event, context }) => {
    await context.db.insert(screeningEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "SCREENING_BLOCKED",
        wallet: event.args.wallet,
        status: 3, // BLOCKED
        listVersionHash: ZERO_HASH,
        attestor: event.args.attestor,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// Wave 8E-1 — scoped/network screening + clearance + sanctions enablement

ponder.on("T3Diamond:ScopedWalletScreened", async ({ event, context }) => {
    await context.db.insert(screeningEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "SCOPED",
        wallet: event.args.wallet,
        institutionId: event.args.institutionId,
        status: Number(event.args.status),
        listVersionHash: event.args.listVersionHash,
        attestor: event.args.attestor,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:NetworkBlockPlaced", async ({ event, context }) => {
    await context.db.insert(screeningEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "NETWORK_BLOCK",
        wallet: event.args.wallet,
        status: 3, // BLOCKED
        listVersionHash: event.args.listVersionHash,
        attestor: event.args.authority,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:NetworkCleared", async ({ event, context }) => {
    await context.db.insert(screeningEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "NETWORK_CLEARED",
        wallet: event.args.wallet,
        status: 1, // CLEAR
        previousStatus: Number(event.args.previousStatus),
        listVersionHash: ZERO_HASH,
        reasonHash: event.args.reasonHash,
        attestor: event.args.authority,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:DefunctInstitutionBlocksCleared", async ({ event, context }) => {
    await context.db.insert(screeningEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "DEFUNCT_CLEARED",
        wallet: ZERO_ADDRESS,
        institutionId: event.args.institutionId,
        status: 0,
        listVersionHash: ZERO_HASH,
        count: Number(event.args.count),
        attestor: event.args.authority,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:InstitutionSanctionsEnabledSet", async ({ event, context }) => {
    await context.db.insert(screeningEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "SANCTIONS_ENABLED",
        wallet: ZERO_ADDRESS,
        institutionId: event.args.institutionId,
        status: 0,
        listVersionHash: ZERO_HASH,
        enabled: event.args.enabled,
        attestor: event.args.setBy,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// Wave 8E-1 — compliance exemption events

ponder.on("T3Diamond:ComplianceExemptionGranted", async ({ event, context }) => {
    await context.db.insert(complianceExemptionEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        scopeId: event.args.scopeId,
        controlKey: event.args.controlKey,
        reasonHash: event.args.reasonHash,
        grantedBy: event.args.grantedBy,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// CIP Attestation Events (Wave 8E-2)
// ============================================================================

const CIP_ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

ponder.on("T3Diamond:CIPRecorded", async ({ event, context }) => {
    await context.db.insert(cipEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Recorded",
        wallet: event.args.wallet,
        custodian: event.args.custodian,
        cipRecordHash: event.args.cipRecordHash,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:CIPRevoked", async ({ event, context }) => {
    await context.db.insert(cipEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Revoked",
        wallet: event.args.wallet,
        custodian: event.args.custodian,
        cipRecordHash: CIP_ZERO_HASH,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// Depositor Identity Events (Wave 8E-2)
// ============================================================================

ponder.on("T3Diamond:DepositorHashSubmitted", async ({ event, context }) => {
    await context.db.insert(depositorIdentityEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "HashSubmitted",
        bank: event.args.bank,
        tinHash: event.args.tinHash,
        timestamp: Number(event.args.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:DepositorHashRemoved", async ({ event, context }) => {
    await context.db.insert(depositorIdentityEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "HashRemoved",
        bank: event.args.bank,
        tinHash: event.args.tinHash,
        timestamp: Number(event.args.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:DepositorHashBatchSubmitted", async ({ event, context }) => {
    await context.db.insert(depositorIdentityEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "HashBatchSubmitted",
        bank: event.args.bank,
        count: Number(event.args.count),
        timestamp: Number(event.args.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:DepositorHashBatchRemoved", async ({ event, context }) => {
    await context.db.insert(depositorIdentityEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "HashBatchRemoved",
        bank: event.args.bank,
        count: Number(event.args.count),
        timestamp: Number(event.args.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:ConflictDetected", async ({ event, context }) => {
    await context.db.insert(depositorIdentityEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "ConflictDetected",
        bank: event.args.checkingBank,
        counterpartyBank: event.args.conflictBank,
        tinHash: event.args.tinHash,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:SaltEpochCreated", async ({ event, context }) => {
    await context.db.insert(depositorIdentityEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "SaltEpochCreated",
        epochId: Number(event.args.epochId),
        saltHash: event.args.saltHash,
        activatedAt: Number(event.args.activatedAt),
        transitionWindow: Number(event.args.transitionWindow),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:SaltEpochExpired", async ({ event, context }) => {
    await context.db.insert(depositorIdentityEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "SaltEpochExpired",
        epochId: Number(event.args.epochId),
        expiredAt: Number(event.args.expiredAt),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:EmergencySaltCompromise", async ({ event, context }) => {
    await context.db.insert(depositorIdentityEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "EmergencySaltCompromise",
        admin: event.args.admin,
        newEpochId: Number(event.args.newEpochId),
        timestamp: Number(event.args.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// Travel Rule Events (Wave 8D)
// ============================================================================

ponder.on("T3Diamond:TravelRuleAttached", async ({ event, context }) => {
    await context.db.insert(travelRuleEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        envelopeId: event.args.envelopeId,
        sender: event.args.sender,
        ref: event.args.ref,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// Issuance Events (Wave 6A)
// ============================================================================

ponder.on("T3Diamond:IssuanceReserved", async ({ event, context }) => {
    await context.db.insert(issuanceEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Reserved",
        issuanceId: event.args.id,
        bank: event.args.bank,
        amount: event.args.amount.toString(),
        expiry: Number(event.args.expiry),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:IssuanceExecuted", async ({ event, context }) => {
    await context.db.insert(issuanceEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Executed",
        issuanceId: event.args.id,
        bank: event.args.bank,
        amount: event.args.amount.toString(),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// Reservation released back to free capacity (cancel/expire). newState: 3=Cancelled, 4=Expired.
ponder.on("T3Diamond:IssuanceReservationReleased", async ({ event, context }) => {
    const newState = Number(event.args.newState);
    await context.db.insert(issuanceEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: newState === 3 ? "Cancelled" : newState === 4 ? "Expired" : "Released",
        issuanceId: event.args.id,
        bank: event.args.bank,
        amount: event.args.amount.toString(),
        newState,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

// ============================================================================
// Settlement Cycle Events (Wave 6A)
// ============================================================================

ponder.on("T3Diamond:SettlementObligationRecorded", async ({ event, context }) => {
    await context.db.insert(settlementObligation).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        obligationId: event.args.obligationId,
        outgoingIssuer: event.args.outgoingIssuer,
        receivingIssuer: event.args.receivingIssuer,
        amount: event.args.amount.toString(),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:SettlementCycleOpened", async ({ event, context }) => {
    await context.db.insert(settlementCycleEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Opened",
        cycleId: event.args.cycleId,
        cycleType: Number(event.args.cycleType),
        openedAt: Number(event.args.openedAt),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:SettlementCycleProposed", async ({ event, context }) => {
    await context.db.insert(settlementCycleEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Proposed",
        cycleId: event.args.cycleId,
        obligationRoot: event.args.obligationRoot,
        confirmationDeadline: Number(event.args.confirmationDeadline),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:SettlementCycleConfirmed", async ({ event, context }) => {
    await context.db.insert(settlementCycleEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Confirmed",
        cycleId: event.args.cycleId,
        institution: event.args.institution,
        netAmount: event.args.netAmount.toString(),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:SettlementCycleFunded", async ({ event, context }) => {
    await context.db.insert(settlementCycleEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Funded",
        cycleId: event.args.cycleId,
        fundingIssuer: event.args.fundingIssuer,
        settlementAsset: event.args.settlementAsset,
        amount: event.args.amount.toString(),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:SettlementCycleFinalized", async ({ event, context }) => {
    await context.db.insert(settlementCycleEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Finalized",
        cycleId: event.args.cycleId,
        finalizedAt: Number(event.args.finalizedAt),
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});

ponder.on("T3Diamond:SettlementCycleFailed", async ({ event, context }) => {
    await context.db.insert(settlementCycleEvent).values({
        id: createEventId(event.transaction.hash, event.log.logIndex),
        eventType: "Failed",
        cycleId: event.args.cycleId,
        exceptionRoot: event.args.exceptionRoot,
        timestamp: Number(event.block.timestamp),
        txHash: event.transaction.hash,
    });
});
