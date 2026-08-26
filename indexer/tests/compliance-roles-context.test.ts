import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { authMiddleware } from "../src/api/compliance";

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
    eq:    vi.fn(),
    and:   vi.fn((...args: any[]) => args),
    gte:   vi.fn(),
    lte:   vi.fn(),
    desc:  vi.fn(),
    sql:   vi.fn(),
    count: vi.fn(() => ({ _tag: "count" })),
}));

vi.mock("ponder:schema", () => ({
    directTransferEvent:    { timestamp: "ts" },
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

function buildApp() {
    const testApp = new Hono();
    testApp.use("/*", authMiddleware);
    testApp.get("/probe", (c) => {
        const ctx = c as any;
        return c.json({
            isCompliance:       ctx.get("isCompliance"),
            isComplianceOfficer: ctx.get("isComplianceOfficer"),
        });
    });
    return testApp;
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
    (db.select as any).mockImplementation(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
    }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("authMiddleware exposes caller roles to downstream handlers", () => {
    it("sets isCompliance=true and isComplianceOfficer=false for COMPLIANCE_ROLE only", async () => {
        mockReadContract
            .mockResolvedValueOnce(true)   // COMPLIANCE_ROLE → true
            .mockResolvedValueOnce(false); // COMPLIANCE_OFFICER_ROLE → false

        const testApp = buildApp();
        const res = await testApp.request("/probe", { headers: validHeaders() });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            isCompliance:        true,
            isComplianceOfficer: false,
        });
    });

    it("sets isCompliance=false and isComplianceOfficer=true for COMPLIANCE_OFFICER_ROLE only", async () => {
        mockReadContract
            .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
            .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

        const testApp = buildApp();
        const res = await testApp.request("/probe", { headers: validHeaders() });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            isCompliance:        false,
            isComplianceOfficer: true,
        });
    });
});
