import { describe, it, expect } from "vitest";
import {
  directTransferEvent,
  envelopeEvent,
  smartLockEnvelopeEvent,
  cambioEnvelopeNoteEvent,
  cambioCommitEvent,
  cambioIssuerEvent,
  lockedTransferEvent,
  cambioEvent,
  screeningEvent,
  travelRuleEvent,
} from "../ponder.schema";

describe("Envelope-mode schema tables", () => {
  it("exports directTransferEvent table", () => {
    expect(directTransferEvent).toBeDefined();
    expect(typeof directTransferEvent).toBe("object");
    expect(directTransferEvent).toHaveProperty("operator");
    expect(directTransferEvent).toHaveProperty("from");
    expect(directTransferEvent).toHaveProperty("to");
    expect(directTransferEvent).toHaveProperty("amount");
    expect(directTransferEvent).toHaveProperty("feeAmount");
    expect(directTransferEvent).toHaveProperty("transferKind");
    expect(directTransferEvent).toHaveProperty("correlationId");
  });

  it("exports envelopeEvent table", () => {
    expect(envelopeEvent).toBeDefined();
    expect(typeof envelopeEvent).toBe("object");
    expect(envelopeEvent).toHaveProperty("eventType");
    expect(envelopeEvent).toHaveProperty("envelopeId");
    expect(envelopeEvent).toHaveProperty("sender");
    expect(envelopeEvent).toHaveProperty("recipient");
    expect(envelopeEvent).toHaveProperty("amount");
    expect(envelopeEvent).toHaveProperty("commitWindowEnd");
    expect(envelopeEvent).toHaveProperty("settlementType");
    expect(envelopeEvent).toHaveProperty("expirationBehavior");
    expect(envelopeEvent).toHaveProperty("finalizedAt");
    expect(envelopeEvent).toHaveProperty("reversedAmount");
    expect(envelopeEvent).toHaveProperty("reversedAt");
  });

  it("exports smartLockEnvelopeEvent table", () => {
    expect(smartLockEnvelopeEvent).toBeDefined();
    expect(typeof smartLockEnvelopeEvent).toBe("object");
    expect(smartLockEnvelopeEvent).toHaveProperty("eventType");
    expect(smartLockEnvelopeEvent).toHaveProperty("envelopeId");
    expect(smartLockEnvelopeEvent).toHaveProperty("sender");
    expect(smartLockEnvelopeEvent).toHaveProperty("recipient");
    expect(smartLockEnvelopeEvent).toHaveProperty("amount");
    expect(smartLockEnvelopeEvent).toHaveProperty("releaseAuthorizedAddress");
    expect(smartLockEnvelopeEvent).toHaveProperty("releasedBy");
    expect(smartLockEnvelopeEvent).toHaveProperty("cancelledBy");
  });

  it("exports cambioEnvelopeNoteEvent table", () => {
    expect(cambioEnvelopeNoteEvent).toBeDefined();
    expect(typeof cambioEnvelopeNoteEvent).toBe("object");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("eventType");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("noteId");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("issuer");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("redeemer");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("amount");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("deadline");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("phraseCommitment");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("openRedemptionSnapshot");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("requiresCommitReveal");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("remaining");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("receiptId");
    expect(cambioEnvelopeNoteEvent).toHaveProperty("remainingAmount");
  });

  it("exports cambioCommitEvent table", () => {
    expect(cambioCommitEvent).toBeDefined();
    expect(typeof cambioCommitEvent).toBe("object");
    expect(cambioCommitEvent).toHaveProperty("eventType");
    expect(cambioCommitEvent).toHaveProperty("commitmentHash");
    expect(cambioCommitEvent).toHaveProperty("redeemer");
    expect(cambioCommitEvent).toHaveProperty("noteId");
    expect(cambioCommitEvent).toHaveProperty("amount");
  });

  it("exports cambioIssuerEvent table", () => {
    expect(cambioIssuerEvent).toBeDefined();
    expect(typeof cambioIssuerEvent).toBe("object");
    expect(cambioIssuerEvent).toHaveProperty("eventType");
    expect(cambioIssuerEvent).toHaveProperty("issuer");
    expect(cambioIssuerEvent).toHaveProperty("open");
    expect(cambioIssuerEvent).toHaveProperty("sponsorBank");
    expect(cambioIssuerEvent).toHaveProperty("newState");
  });
});

describe("Screening and Travel Rule schema tables", () => {
  it("exports screeningEvent table", () => {
    expect(screeningEvent).toBeDefined();
    expect(typeof screeningEvent).toBe("object");
    expect(screeningEvent).toHaveProperty("wallet");
    expect(screeningEvent).toHaveProperty("status");
    expect(screeningEvent).toHaveProperty("attestor");
  });

  it("exports travelRuleEvent table", () => {
    expect(travelRuleEvent).toBeDefined();
    expect(typeof travelRuleEvent).toBe("object");
    expect(travelRuleEvent).toHaveProperty("envelopeId");
    expect(travelRuleEvent).toHaveProperty("sender");
    expect(travelRuleEvent).toHaveProperty("ref");
    expect(travelRuleEvent).toHaveProperty("timestamp");
    expect(travelRuleEvent).toHaveProperty("txHash");
  });
});

describe("Legacy schema deprecation", () => {
  it("preserves lockedTransferEvent table", () => {
    expect(lockedTransferEvent).toBeDefined();
    expect(typeof lockedTransferEvent).toBe("object");
  });

  it("preserves cambioEvent table", () => {
    expect(cambioEvent).toBeDefined();
    expect(typeof cambioEvent).toBe("object");
  });
});
