import { describe, it, expect, vi, beforeAll } from "vitest";

const registeredHandlers: Record<string, Function> = {};

vi.mock("ponder:registry", () => ({
  ponder: {
    on: vi.fn((eventName: string, handler: Function) => {
      registeredHandlers[eventName] = handler;
    }),
  },
}));

vi.mock("ponder:schema", async () => {
  const actual = await vi.importActual<typeof import("../ponder.schema")>("../ponder.schema");
  return actual;
});

beforeAll(async () => {
  await import("../src/index");
});

function mockContext(inserted: any[] = []) {
  return {
    db: {
      insert: vi.fn(() => ({
        values: vi.fn((row: any) => {
          inserted.push(row);
          return {
            onConflictDoUpdate: vi.fn(async (update: any) => {
              Object.assign(row, update);
              return row;
            }),
          };
        }),
      })),
      find: vi.fn(async (_table: any, _keys: any) => undefined),
      update: vi.fn(() => ({
        set: vi.fn(async (_values: any) => {}),
      })),
    },
  };
}

function mockEvent(args: any, overrides?: any) {
  return {
    args,
    block: { timestamp: 1700000000n },
    transaction: { hash: "0xtxhash" },
    log: { logIndex: 42 },
    ...overrides,
  };
}

describe("Handler registration", () => {
  it("registers all envelope-mode event handlers", () => {
    const expected = [
      "T3Diamond:DirectTransferExecuted",
      "T3Diamond:EnvelopeCreated",
      "T3Diamond:EnvelopeFinalized",
      "T3Diamond:EnvelopeReversed",
      "T3Diamond:SmartLockEnvelopeCreated",
      "T3Diamond:SmartLockEnvelopeReleased",
      "T3Diamond:SmartLockEnvelopeCancelled",
      "T3Diamond:CambioEnvelopeNoteCreated",
      "T3Diamond:CambioEnvelopeNoteRedeemed",
      "T3Diamond:CambioEnvelopeNoteCancelled",
      "T3Diamond:CommitCleared",
      "T3Diamond:CommitCancelled",
      "T3Diamond:IssuerOpenRedemptionUpdated",
      "T3Diamond:SponsorBankEndorsed",
      "T3Diamond:IssuerPauseStateChanged",
      "T3Diamond:IssuanceReserved",
      "T3Diamond:IssuanceExecuted",
      "T3Diamond:IssuanceReservationReleased",
      "T3Diamond:SettlementObligationRecorded",
      "T3Diamond:WalletScreened",
      "T3Diamond:ScreeningBlocked",
      "T3Diamond:TravelRuleAttached",
    ];
    for (const name of expected) {
      expect(registeredHandlers[name]).toBeDefined();
    }
  });
});

describe("IssuanceReservationReleased handler", () => {
  it("maps newState 3 to Cancelled", async () => {
    const inserted: any[] = [];
    const handler = registeredHandlers["T3Diamond:IssuanceReservationReleased"]!;
    const event = mockEvent({ id: "0xres1", bank: "0xbank", amount: 1000n, newState: 3 });
    await handler({ event, context: mockContext(inserted) });
    const row = inserted.find((r) => r.issuanceId === "0xres1");
    expect(row).toBeDefined();
    expect(row.eventType).toBe("Cancelled");
    expect(row.amount).toBe("1000");
    expect(row.newState).toBe(3);
  });

  it("maps newState 4 to Expired", async () => {
    const inserted: any[] = [];
    const handler = registeredHandlers["T3Diamond:IssuanceReservationReleased"]!;
    const event = mockEvent({ id: "0xres2", bank: "0xbank", amount: 2000n, newState: 4 });
    await handler({ event, context: mockContext(inserted) });
    const row = inserted.find((r) => r.issuanceId === "0xres2");
    expect(row).toBeDefined();
    expect(row.eventType).toBe("Expired");
    expect(row.newState).toBe(4);
  });
});

describe("DirectTransferExecuted handler", () => {
  it("inserts direct transfer event and updates wallets", async () => {
    const inserted: any[] = [];
    const handler = registeredHandlers["T3Diamond:DirectTransferExecuted"]!;
    const event = mockEvent({
      operator: "0xop",
      from: "0xfrom",
      to: "0xto",
      amount: 1000n,
      feeAmount: 10n,
      transferKind: 1,
      correlationId: "0xcorr",
    });
    const context = mockContext(inserted);

    await handler({ event, context });

    const transferRow = inserted.find(
      (r) => r.operator === "0xop" && r.from === "0xfrom"
    );
    expect(transferRow).toBeDefined();
    expect(transferRow.amount).toBe("1000");
    expect(transferRow.feeAmount).toBe("10");
    expect(transferRow.transferKind).toBe(1);
  });
});

describe("EnvelopeCreated handler", () => {
  it("inserts envelope created event", async () => {
    const inserted: any[] = [];
    const handler = registeredHandlers["T3Diamond:EnvelopeCreated"]!;
    const event = mockEvent({
      envelopeId: "0xenv1",
      sender: "0xsend",
      recipient: "0xrecip",
      amount: 5000n,
      commitWindowEnd: 1700003600,
      settlementType: 2,
      expirationBehavior: 1,
    });
    const context = mockContext(inserted);

    await handler({ event, context });

    const row = inserted.find((r) => r.envelopeId === "0xenv1");
    expect(row).toBeDefined();
    expect(row.eventType).toBe("Created");
    expect(row.amount).toBe("5000");
    expect(row.commitWindowEnd).toBe(1700003600);
    expect(row.settlementType).toBe(2);
  });
});

describe("EnvelopeFinalized handler", () => {
  it("inserts envelope finalized event", async () => {
    const inserted: any[] = [];
    const handler = registeredHandlers["T3Diamond:EnvelopeFinalized"]!;
    const event = mockEvent({
      envelopeId: "0xenv1",
      finalizedAt: 1700003600,
    });
    const context = mockContext(inserted);

    await handler({ event, context });

    const row = inserted.find((r) => r.envelopeId === "0xenv1");
    expect(row).toBeDefined();
    expect(row.eventType).toBe("Finalized");
    expect(row.finalizedAt).toBe(1700003600);
  });
});

describe("SmartLockEnvelopeReleased handler", () => {
  it("inserts smart lock released event", async () => {
    const inserted: any[] = [];
    const handler = registeredHandlers["T3Diamond:SmartLockEnvelopeReleased"]!;
    const event = mockEvent({
      envelopeId: "0xenv2",
      releasedBy: "0xreleaser",
    });
    const context = mockContext(inserted);

    await handler({ event, context });

    const row = inserted.find((r) => r.envelopeId === "0xenv2");
    expect(row).toBeDefined();
    expect(row.eventType).toBe("Released");
    expect(row.releasedBy).toBe("0xreleaser");
  });
});

describe("CambioEnvelopeNoteRedeemed handler", () => {
  it("inserts note redeemed event", async () => {
    const inserted: any[] = [];
    const handler = registeredHandlers["T3Diamond:CambioEnvelopeNoteRedeemed"]!;
    const event = mockEvent({
      noteId: "0xnote1",
      redeemer: "0xredeem",
      amount: 2500n,
      remaining: 0n,
      receiptId: "0xreceipt",
    });
    const context = mockContext(inserted);

    await handler({ event, context });

    const row = inserted.find((r) => r.noteId === "0xnote1");
    expect(row).toBeDefined();
    expect(row.eventType).toBe("Redeemed");
    expect(row.redeemer).toBe("0xredeem");
    expect(row.amount).toBe("2500");
    expect(row.remaining).toBe("0");
    expect(row.receiptId).toBe("0xreceipt");
  });
});

describe("CommitCleared handler", () => {
  it("inserts commit cleared event", async () => {
    const inserted: any[] = [];
    const handler = registeredHandlers["T3Diamond:CommitCleared"]!;
    const event = mockEvent({
      commitmentHash: "0xcommit1",
      redeemer: "0xredeem",
      noteId: "0xnote1",
      amount: 1000n,
    });
    const context = mockContext(inserted);

    await handler({ event, context });

    const row = inserted.find((r) => r.commitmentHash === "0xcommit1");
    expect(row).toBeDefined();
    expect(row.eventType).toBe("Cleared");
    expect(row.redeemer).toBe("0xredeem");
    expect(row.amount).toBe("1000");
  });
});

describe("IssuerPauseStateChanged handler", () => {
  it("inserts pause state changed event", async () => {
    const inserted: any[] = [];
    const handler = registeredHandlers["T3Diamond:IssuerPauseStateChanged"]!;
    const event = mockEvent({
      issuer: "0xissuer1",
      newState: 1,
    });
    const context = mockContext(inserted);

    await handler({ event, context });

    const row = inserted.find((r) => r.issuer === "0xissuer1");
    expect(row).toBeDefined();
    expect(row.eventType).toBe("PauseStateChanged");
    expect(row.newState).toBe(1);
  });
});

describe("TravelRuleAttached handler", () => {
  it("inserts travel rule event", async () => {
    const inserted: any[] = [];
    const handler = registeredHandlers["T3Diamond:TravelRuleAttached"]!;
    const event = mockEvent({
      envelopeId: "0xenvtravel1",
      sender: "0xsend",
      ref: "0xref",
    });
    const context = mockContext(inserted);

    await handler({ event, context });

    const row = inserted.find((r) => r.envelopeId === "0xenvtravel1");
    expect(row).toBeDefined();
    expect(row.sender).toBe("0xsend");
    expect(row.ref).toBe("0xref");
    expect(row.timestamp).toBe(1700000000);
  });
});

describe("SettlementObligationRecorded handler", () => {
  it("inserts obligation row", async () => {
    const inserted: any[] = [];
    const handler = registeredHandlers["T3Diamond:SettlementObligationRecorded"]!;
    const event = mockEvent({
      obligationId: "0xob1",
      outgoingIssuer: "0xout",
      receivingIssuer: "0xrecv",
      amount: 7000n,
    });
    await handler({ event, context: mockContext(inserted) });
    const row = inserted.find((r) => r.obligationId === "0xob1");
    expect(row).toBeDefined();
    expect(row.outgoingIssuer).toBe("0xout");
    expect(row.receivingIssuer).toBe("0xrecv");
    expect(row.amount).toBe("7000");
  });
});

describe("RecoveryEnvelopeResolved handler", () => {
    it("first event increments envelopesResolved; replay does not", async () => {
        const inserted: any[] = [];
        const ctx = mockContext(inserted);
        const recoveryId = "0xrecovery01";
        const envelopeId = "0xenvelope01";

        // Prime db.find to return an existing recovery record
        let envelopesResolved = 0;
        (ctx.db.find as any).mockResolvedValue({ id: recoveryId, envelopesResolved });
        (ctx.db.update as any).mockReturnValue({
            set: vi.fn(async (vals: any) => {
                envelopesResolved = vals.envelopesResolved;
            }),
        });

        const handler = registeredHandlers["T3Diamond:RecoveryEnvelopeResolved"]!;

        // First call: replayed=false — should increment
        await handler({
            event: mockEvent({ recoveryId, envelopeId, choice: 0n, amountMoved: 100n, replayed: false }),
            context: ctx,
        });
        expect(envelopesResolved).toBe(1);

        // Reset find to return updated record
        (ctx.db.find as any).mockResolvedValue({ id: recoveryId, envelopesResolved: 1 });

        // Second call: replayed=true — should NOT increment
        await handler({
            event: mockEvent({ recoveryId, envelopeId, choice: 0n, amountMoved: 100n, replayed: true }),
            context: ctx,
        });
        // Still 1, not 2
        expect(envelopesResolved).toBe(1);
    });
});

describe("RecoveryCambioNoteResolved handler", () => {
    it("first event increments cambioNotesResolved; replay does not", async () => {
        const inserted: any[] = [];
        const ctx = mockContext(inserted);
        const recoveryId = "0xrecovery02";
        const noteId = "0xnote01";

        let cambioNotesResolved = 0;
        (ctx.db.find as any).mockResolvedValue({ id: recoveryId, cambioNotesResolved });
        (ctx.db.update as any).mockReturnValue({
            set: vi.fn(async (vals: any) => {
                cambioNotesResolved = vals.cambioNotesResolved;
            }),
        });

        const handler = registeredHandlers["T3Diamond:RecoveryCambioNoteResolved"]!;

        await handler({
            event: mockEvent({ recoveryId, noteId, action: 1n, amountReturned: 50n, replayed: false }),
            context: ctx,
        });
        expect(cambioNotesResolved).toBe(1);

        (ctx.db.find as any).mockResolvedValue({ id: recoveryId, cambioNotesResolved: 1 });

        await handler({
            event: mockEvent({ recoveryId, noteId, action: 1n, amountReturned: 50n, replayed: true }),
            context: ctx,
        });
        expect(cambioNotesResolved).toBe(1);
    });
});
