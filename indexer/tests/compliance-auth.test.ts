import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../src/api/compliance";

// ---------------------------------------------------------------------------
// vi.hoisted — run before any imports so factories can reference these spies
// ---------------------------------------------------------------------------

const { mockReadContract, mockVerifyMessage, mockHasNonce, mockConsumeNonce } = vi.hoisted(() => ({
    mockReadContract:  vi.fn(),
    mockVerifyMessage: vi.fn(),
    mockHasNonce:      vi.fn(),
    mockConsumeNonce:  vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("viem", () => ({
    verifyMessage:        mockVerifyMessage,
    createPublicClient:   vi.fn(() => ({ readContract: mockReadContract })),
    http:                 vi.fn(),
    keccak256:            vi.fn(() => "0xmockhash"),
    encodePacked:         vi.fn(() => new Uint8Array()),
    defineChain:          vi.fn((c: any) => c),
}));

vi.mock("drizzle-orm", () => ({
    eq:    vi.fn((_col: any, val: any) => ({ _tag: "eq", val })),
    and:   vi.fn((...args: any[]) => args),
    gte:   vi.fn(),
    lte:   vi.fn(),
    desc:  vi.fn(),
    sql:   vi.fn(),
    count: vi.fn(() => ({ _tag: "count" })),
}));

// Flat named-export mock — matches `import * as schema from "ponder:schema"`
vi.mock("ponder:schema", () => ({
    directTransferEvent:    { timestamp: "ts", from: "from", to: "to" },
    envelopeEvent:          { timestamp: "ts", envelopeId: "eid" },
    cambioCommitEvent:      { timestamp: "ts" },
    cambioIssuerEvent:      { timestamp: "ts", issuer: "issuer" },
    smartLockEnvelopeEvent: { timestamp: "ts" },
    cambioEnvelopeNoteEvent:{ timestamp: "ts", issuer: "issuer" },
    wallet:                 { id: "id" },
}));

vi.mock("ponder:api", () => ({
    db: {
        select: vi.fn(),
    },
}));

vi.mock("../src/lib/nonce-store", () => ({
    hasNonce:     mockHasNonce,
    consumeNonce: mockConsumeNonce,
}));

// ---------------------------------------------------------------------------
// Thenable chain mock
//
// Every method returns `this`, which is also a Promise resolving to `data`.
// Satisfies:
//   await db.select().from().where().orderBy().limit().offset()
// ---------------------------------------------------------------------------

function makeChain(data: any[]): any {
    const p = Promise.resolve(data);
    const chain: any = {
        then:    p.then.bind(p),
        catch:   p.catch.bind(p),
        finally: p.finally.bind(p),
        from:    vi.fn(() => chain),
        where:   vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit:   vi.fn(() => chain),
        offset:  vi.fn(() => Promise.resolve(data)),
    };
    return chain;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const SIGNER = "0x1234567890123456789012345678901234567890";
const SIG    = "0xvalidsignature";
const NONCE  = "unique-nonce-abc123";
const validTs = () => Math.floor(Date.now() / 1000).toString();

function validHeaders(overrides: Record<string, string> = {}) {
    return {
        "x-signer-address":       SIGNER,
        "x-signature":            SIG,
        "x-signature-timestamp":  validTs(),
        "x-signature-nonce":      NONCE,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// beforeEach — reset every spy to "happy path" before each test
// ---------------------------------------------------------------------------

beforeEach(async () => {
    vi.clearAllMocks();

    mockVerifyMessage.mockResolvedValue(true);     // valid signature
    mockReadContract.mockResolvedValue(true);      // has role
    mockHasNonce.mockReturnValue(false);           // nonce not consumed
    mockConsumeNonce.mockReturnValue(undefined);   // insert succeeds

    const { db } = await import("ponder:api");
    (db.select as any).mockImplementation(() => makeChain([]));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("requireComplianceAuth middleware", () => {

    // ── Missing headers ─────────────────────────────────────────────────────

    describe("Missing headers", () => {
        it("returns 401 when x-signer-address is absent", async () => {
            const res = await app.request("/compliance/direct-transfers", {
                headers: { "x-signature": SIG, "x-signature-timestamp": validTs(), "x-signature-nonce": NONCE },
            });
            expect(res.status).toBe(401);
            expect((await res.json() as any).error).toBe("Missing authentication headers");
        });

        it("returns 401 when x-signature is absent", async () => {
            const res = await app.request("/compliance/direct-transfers", {
                headers: { "x-signer-address": SIGNER, "x-signature-timestamp": validTs(), "x-signature-nonce": NONCE },
            });
            expect(res.status).toBe(401);
            expect((await res.json() as any).error).toBe("Missing authentication headers");
        });

        it("returns 401 when x-signature-timestamp is absent", async () => {
            const res = await app.request("/compliance/direct-transfers", {
                headers: { "x-signer-address": SIGNER, "x-signature": SIG, "x-signature-nonce": NONCE },
            });
            expect(res.status).toBe(401);
            expect((await res.json() as any).error).toBe("Missing authentication headers");
        });

        it("returns 401 when x-signature-nonce is absent", async () => {
            const res = await app.request("/compliance/direct-transfers", {
                headers: { "x-signer-address": SIGNER, "x-signature": SIG, "x-signature-timestamp": validTs() },
            });
            expect(res.status).toBe(401);
            expect((await res.json() as any).error).toBe("Missing authentication headers");
        });
    });

    // ── TTL validation ──────────────────────────────────────────────────────

    describe("TTL validation", () => {
        it("returns 401 when timestamp is more than 300 seconds in the past", async () => {
            const oldTs = (Math.floor(Date.now() / 1000) - 400).toString();
            const res = await app.request("/compliance/direct-transfers", {
                headers: validHeaders({ "x-signature-timestamp": oldTs }),
            });
            expect(res.status).toBe(401);
            expect((await res.json() as any).error).toBe("Signature expired or timestamp invalid");
        });

        it("returns 401 when timestamp is more than 300 seconds in the future", async () => {
            const futureTs = (Math.floor(Date.now() / 1000) + 400).toString();
            const res = await app.request("/compliance/direct-transfers", {
                headers: validHeaders({ "x-signature-timestamp": futureTs }),
            });
            expect(res.status).toBe(401);
            expect((await res.json() as any).error).toBe("Signature expired or timestamp invalid");
        });

        it("does not reject a timestamp within 300 seconds of now", async () => {
            const res = await app.request("/compliance/direct-transfers", {
                headers: validHeaders(),
            });
            expect((await res.json() as any).error ?? "").not.toMatch(/timestamp/i);
        });
    });

    // ── Replay protection ───────────────────────────────────────────────────

    describe("Replay protection", () => {
        it("returns 401 when nonce has already been consumed", async () => {
            mockHasNonce.mockReturnValue(true);

            const res = await app.request("/compliance/direct-transfers", {
                headers: validHeaders(),
            });
            expect(res.status).toBe(401);
            expect((await res.json() as any).error).toBe("Nonce already used");
        });

        it("persists nonce via consumeNonce when nonce is fresh", async () => {
            await app.request("/compliance/direct-transfers", {
                headers: validHeaders(),
            });

            expect(mockConsumeNonce).toHaveBeenCalledWith(
                NONCE,
                SIGNER,
                expect.any(Number)
            );
        });
    });

    // ── Signature verification ──────────────────────────────────────────────

    describe("Signature verification", () => {
        it("returns 401 when signature does not match signer address", async () => {
            mockVerifyMessage.mockResolvedValue(false);

            const res = await app.request("/compliance/direct-transfers", {
                headers: validHeaders(),
            });
            expect(res.status).toBe(401);
            expect((await res.json() as any).error).toBe("Invalid signature");
        });

        it("passes when signature is valid", async () => {
            const res = await app.request("/compliance/direct-transfers", {
                headers: validHeaders(),
            });
            expect(res.status).not.toBe(401);
        });

        it("constructs message as METHOD:path:bodyHash:timestamp:nonce", async () => {
            const ts    = validTs();
            const nonce = "msg-format-test-nonce";
            const zeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

            await app.request("/compliance/direct-transfers", {
                headers: validHeaders({ "x-signature-timestamp": ts, "x-signature-nonce": nonce }),
            });

            expect(mockVerifyMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: `GET:/compliance/direct-transfers:${zeroHash}:${ts}:${nonce}`,
                })
            );
        });

        it("uses bytes32(0) as bodyHash when request body is empty", async () => {
            await app.request("/compliance/direct-transfers", {
                method: "GET",
                headers: validHeaders(),
            });

            expect(mockVerifyMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining(
                        "0x0000000000000000000000000000000000000000000000000000000000000000"
                    ),
                })
            );
        });
    });

    // ── Role authorization ──────────────────────────────────────────────────

    describe("Role authorization", () => {
        it("returns 403 when signer holds neither COMPLIANCE_ROLE nor COMPLIANCE_OFFICER_ROLE", async () => {
            mockReadContract.mockResolvedValue(false);

            const res = await app.request("/compliance/direct-transfers", {
                headers: validHeaders(),
            });
            expect(res.status).toBe(403);
            expect((await res.json() as any).error).toMatch(/Insufficient roles/i);
        });

        it("passes (200) when signer holds COMPLIANCE_ROLE", async () => {
            mockReadContract
                .mockResolvedValueOnce(true)   // COMPLIANCE_ROLE → true
                .mockResolvedValueOnce(false);  // COMPLIANCE_OFFICER_ROLE → false

            const res = await app.request("/compliance/direct-transfers", {
                headers: validHeaders(),
            });
            expect(res.status).toBe(200);
        });

        it("passes (200) when signer holds COMPLIANCE_OFFICER_ROLE only", async () => {
            mockReadContract
                .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
                .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

            const res = await app.request("/compliance/direct-transfers", {
                headers: validHeaders(),
            });
            expect(res.status).toBe(200);
        });
    });
});
