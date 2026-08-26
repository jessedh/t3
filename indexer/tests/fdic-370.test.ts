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
    depositorIdentityEvent: { _tag: "depositorIdentityEvent" },
    cipEvent:               { _tag: "cipEvent" },
}));

const TABLES = new Map<any, any[]>();

vi.mock("ponder:api", () => ({
    db: {
        select: vi.fn(() => makeSelectChain()),
    },
}));

vi.mock("../src/lib/nonce-store", () => ({
    hasNonce:     mockHasNonce,
    consumeNonce: mockConsumeNonce,
}));

// ---------------------------------------------------------------------------
// Thenable chain mock that dispatches by table
// ---------------------------------------------------------------------------

function makeSelectChain(): any {
    return {
        from: vi.fn((table: any) => makeTableChain(TABLES.get(table) ?? [])),
    };
}

function makeTableChain(data: any[]): any {
    const p = Promise.resolve(data);
    const chain: any = {
        then:    p.then.bind(p),
        catch:   p.catch.bind(p),
        finally: p.finally.bind(p),
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
const BANK_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BANK_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BANK_C = "0xcccccccccccccccccccccccccccccccccccccccc";
const CUSTODIAN_X = "0xccccccccccccccccccccccccccccccccccccccc1";
const CUSTODIAN_Y = "0xccccccccccccccccccccccccccccccccccccccc2";
const WALLET_1 = "0xddddddddddddddddddddddddddddddddddddddd1";
const WALLET_2 = "0xddddddddddddddddddddddddddddddddddddddd2";
const WALLET_3 = "0xddddddddddddddddddddddddddddddddddddddd3";

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

async function seedTables(rows: { depositorIdentityEvent?: any[]; cipEvent?: any[] }) {
    const schema = await vi.importActual<typeof import("../ponder.schema")>("../ponder.schema");
    TABLES.clear();
    TABLES.set(schema.depositorIdentityEvent, rows.depositorIdentityEvent ?? []);
    TABLES.set(schema.cipEvent, rows.cipEvent ?? []);
}

// ---------------------------------------------------------------------------
// beforeEach — reset every spy to "happy path" before each test
// ---------------------------------------------------------------------------

beforeEach(async () => {
    vi.clearAllMocks();
    TABLES.clear();

    mockVerifyMessage.mockResolvedValue(true);     // valid signature
    mockReadContract.mockResolvedValue(true);      // has role
    mockHasNonce.mockReturnValue(false);           // nonce not consumed
    mockConsumeNonce.mockReturnValue(undefined);   // insert succeeds
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /compliance/fdic-370", () => {
    it("returns 403 when caller lacks COMPLIANCE_OFFICER_ROLE", async () => {
        mockReadContract
            .mockResolvedValueOnce(true)   // COMPLIANCE_ROLE → true
            .mockResolvedValueOnce(false); // COMPLIANCE_OFFICER_ROLE → false

        await seedTables({});

        const res = await app.request("/compliance/fdic-370", { headers: validHeaders() });
        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.error).toBe("Unauthorized: FDIC-370 requires COMPLIANCE_OFFICER_ROLE");

        // The 403 body must leak NO report data — the officer gate returns before
        // any table read, so none of the correlation-sensitive fields appear.
        expect(body.depositorPopulation).toBeUndefined();
        expect(body.crossBankConflicts).toBeUndefined();
        expect(body.saltEpochLineage).toBeUndefined();
        expect(body.cipCoverage).toBeUndefined();
        expect(body.currentSaltEpoch).toBeUndefined();
    });

    it("returns the documented shape with both disclaimers", async () => {
        mockReadContract
            .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
            .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

        await seedTables({});

        const res = await app.request("/compliance/fdic-370", { headers: validHeaders() });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.formatVersion).toBe("DRAFT");
        expect(body.counselGate).toBe("G9");
        expect(body.disclaimer).toContain("Exam-support metadata only");
        expect(body.regulatoryNotice).toContain("THIS OUTPUT IS NOT A 12 CFR 370 DETERMINATION");
        expect(body.generatedAt).toBeGreaterThan(0);
    });

    it("derives happy-path counts correctly", async () => {
        mockReadContract
            .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
            .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

        await seedTables({
            depositorIdentityEvent: [
                { id: "h1", eventType: "HashSubmitted", bank: BANK_A, tinHash: "0x01", count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1000, txHash: "0xtx1" },
                { id: "h2", eventType: "HashSubmitted", bank: BANK_A, tinHash: "0x02", count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1100, txHash: "0xtx2" },
                { id: "h3", eventType: "HashBatchSubmitted", bank: BANK_A, tinHash: null, count: 5, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1200, txHash: "0xtx3" },
                { id: "h4", eventType: "HashRemoved", bank: BANK_A, tinHash: "0x01", count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1300, txHash: "0xtx4" },
                { id: "h5", eventType: "HashBatchRemoved", bank: BANK_A, tinHash: null, count: 2, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1400, txHash: "0xtx5" },
                { id: "h6", eventType: "HashSubmitted", bank: BANK_B, tinHash: "0x03", count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1500, txHash: "0xtx6" },
                { id: "c1", eventType: "ConflictDetected", bank: BANK_A, counterpartyBank: BANK_B, tinHash: "0xconflict1", count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1600, txHash: "0xtx7" },
                { id: "s1", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 1, saltHash: "0xsalthash1", activatedAt: 1000, transitionWindow: 2000, expiredAt: null, newEpochId: null, admin: null, timestamp: 1000, txHash: "0xtxs1" },
                { id: "s2", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 2, saltHash: "0xsalthash2", activatedAt: 2000, transitionWindow: 3000, expiredAt: null, newEpochId: null, admin: null, timestamp: 2000, txHash: "0xtxs2" },
                { id: "s3", eventType: "SaltEpochExpired", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 1, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: 2500, newEpochId: null, admin: null, timestamp: 2500, txHash: "0xtxs3" },
            ],
            cipEvent: [
                { id: "r1", eventType: "Recorded", wallet: WALLET_1, custodian: CUSTODIAN_X, cipRecordHash: "0xcip1", timestamp: 1000, txHash: "0xtxc1" },
                { id: "r2", eventType: "Recorded", wallet: WALLET_2, custodian: CUSTODIAN_X, cipRecordHash: "0xcip2", timestamp: 1000, txHash: "0xtxc2" },
                { id: "r3", eventType: "Recorded", wallet: WALLET_3, custodian: CUSTODIAN_Y, cipRecordHash: "0xcip3", timestamp: 1000, txHash: "0xtxc3" },
            ],
        });

        const res = await app.request("/compliance/fdic-370", { headers: validHeaders() });
        expect(res.status).toBe(200);
        const body = await res.json() as any;

        // Bank A: 2 HashSubmitted + 5 batch − 1 HashRemoved − 2 batch = 4
        const bankA = body.depositorPopulation.find((r: any) => r.bank === BANK_A);
        expect(bankA).toBeDefined();
        expect(bankA.activeHashCount).toBe(4);
        expect(bankA.underflowDetected).toBe(false);
        expect(bankA.lastUpdated).toBe(1400);

        // Bank B: 1 HashSubmitted
        const bankB = body.depositorPopulation.find((r: any) => r.bank === BANK_B);
        expect(bankB).toBeDefined();
        expect(bankB.activeHashCount).toBe(1);
        expect(bankB.underflowDetected).toBe(false);
        expect(bankB.lastUpdated).toBe(1500);

        expect(body.crossBankConflicts).toEqual([{
            bank: BANK_A,
            counterpartyBank: BANK_B,
            tinHash: "0xconflict1",
            detectedAt: 1600,
        }]);

        expect(body.currentSaltEpoch).toBe(2);
        expect(body.saltEpochLineage).toEqual([
            { epochId: 1, saltHash: "0xsalthash1", activatedAt: 1000, expiredAt: 2500, supersededBy: 2 },
            { epochId: 2, saltHash: "0xsalthash2", activatedAt: 2000, expiredAt: null, supersededBy: null },
        ]);

        const cipX = body.cipCoverage.find((r: any) => r.custodian === CUSTODIAN_X);
        expect(cipX.walletsWithCip).toBe(2);
        const cipY = body.cipCoverage.find((r: any) => r.custodian === CUSTODIAN_Y);
        expect(cipY.walletsWithCip).toBe(1);
    });

    it("sets underflowDetected when removes exceed submits", async () => {
        mockReadContract
            .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
            .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

        await seedTables({
            depositorIdentityEvent: [
                { id: "u1", eventType: "HashSubmitted", bank: BANK_C, tinHash: "0x01", count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1000, txHash: "0xtx1" },
                { id: "u2", eventType: "HashBatchRemoved", bank: BANK_C, tinHash: null, count: 3, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1100, txHash: "0xtx2" },
            ],
        });

        const res = await app.request("/compliance/fdic-370", { headers: validHeaders() });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        const bankC = body.depositorPopulation.find((r: any) => r.bank === BANK_C);
        expect(bankC.activeHashCount).toBe(0);
        expect(bankC.underflowDetected).toBe(true);
        expect(bankC.lastUpdated).toBe(1100);
    });

    it("excludes wallets whose latest CIP event is Revoked", async () => {
        mockReadContract
            .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
            .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

        await seedTables({
            cipEvent: [
                { id: "cr1", eventType: "Recorded", wallet: WALLET_1, custodian: CUSTODIAN_X, cipRecordHash: "0xcip1", timestamp: 1000, txHash: "0xtx1" },
                { id: "cr2", eventType: "Revoked", wallet: WALLET_1, custodian: CUSTODIAN_X, cipRecordHash: null, timestamp: 2000, txHash: "0xtx2" },
                { id: "cr3", eventType: "Recorded", wallet: WALLET_2, custodian: CUSTODIAN_X, cipRecordHash: "0xcip2", timestamp: 1000, txHash: "0xtx3" },
            ],
        });

        const res = await app.request("/compliance/fdic-370", { headers: validHeaders() });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        const cipX = body.cipCoverage.find((r: any) => r.custodian === CUSTODIAN_X);
        expect(cipX.walletsWithCip).toBe(1);
    });

    it("stitches supersededBy for a normal sequential rotation", async () => {
        mockReadContract
            .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
            .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

        // Clean rotations: each epoch hard-expires before the next activates, so
        // there is never more than one active epoch at a time.
        await seedTables({
            depositorIdentityEvent: [
                { id: "n1", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 1, saltHash: "0xs1", activatedAt: 1000, transitionWindow: 0, expiredAt: null, newEpochId: null, admin: null, timestamp: 1000, txHash: "0xtx1" },
                { id: "x1", eventType: "SaltEpochExpired", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 1, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: 2000, newEpochId: null, admin: null, timestamp: 2000, txHash: "0xtxx1" },
                { id: "n2", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 2, saltHash: "0xs2", activatedAt: 2000, transitionWindow: 0, expiredAt: null, newEpochId: null, admin: null, timestamp: 2000, txHash: "0xtx2" },
                { id: "x2", eventType: "SaltEpochExpired", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 2, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: 3000, newEpochId: null, admin: null, timestamp: 3000, txHash: "0xtxx2" },
                { id: "n3", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 3, saltHash: "0xs3", activatedAt: 3000, transitionWindow: 0, expiredAt: null, newEpochId: null, admin: null, timestamp: 3000, txHash: "0xtx3" },
            ],
        });

        const res = await app.request("/compliance/fdic-370", { headers: validHeaders() });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.currentSaltEpoch).toBe(3);
        const lineage = body.saltEpochLineage;
        expect(lineage.find((r: any) => r.epochId === 1).supersededBy).toBe(2);
        expect(lineage.find((r: any) => r.epochId === 2).supersededBy).toBe(3);
        expect(lineage.find((r: any) => r.epochId === 3).supersededBy).toBeNull();
    });

    it("emergency compromise supersedes EVERY epoch active in an overlap window", async () => {
        mockReadContract
            .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
            .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

        // Epoch 2 is created @2000 with a 3000s transition window, so epoch 1
        // remains active (overlapping) past 2000. The emergency @2500 therefore
        // expires BOTH epoch 1 and epoch 2 — each is superseded by the emergency
        // epoch (3), not by the next sequential epoch. The contract emits one
        // SaltEpochExpired per active epoch plus the SaltEpochCreated for 3.
        await seedTables({
            depositorIdentityEvent: [
                { id: "n1", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 1, saltHash: "0xs1", activatedAt: 1000, transitionWindow: 0, expiredAt: null, newEpochId: null, admin: null, timestamp: 1000, txHash: "0xtx1" },
                { id: "n2", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 2, saltHash: "0xs2", activatedAt: 2000, transitionWindow: 3000, expiredAt: null, newEpochId: null, admin: null, timestamp: 2000, txHash: "0xtx2" },
                { id: "e1", eventType: "EmergencySaltCompromise", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: 3, admin: "0xadmin", timestamp: 2500, txHash: "0xtxe1" },
                { id: "x1", eventType: "SaltEpochExpired", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 1, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: 2500, newEpochId: null, admin: null, timestamp: 2500, txHash: "0xtxx1" },
                { id: "x2", eventType: "SaltEpochExpired", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 2, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: 2500, newEpochId: null, admin: null, timestamp: 2500, txHash: "0xtxx2" },
                { id: "n3", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 3, saltHash: "0xs3", activatedAt: 2500, transitionWindow: 0, expiredAt: null, newEpochId: null, admin: null, timestamp: 2500, txHash: "0xtx3" },
            ],
        });

        const res = await app.request("/compliance/fdic-370", { headers: validHeaders() });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.currentSaltEpoch).toBe(3);
        const lineage = body.saltEpochLineage;
        expect(lineage.find((r: any) => r.epochId === 1).supersededBy).toBe(3);
        expect(lineage.find((r: any) => r.epochId === 2).supersededBy).toBe(3);
        expect(lineage.find((r: any) => r.epochId === 3).supersededBy).toBeNull();
        expect(lineage.find((r: any) => r.epochId === 1).expiredAt).toBe(2500);
        expect(lineage.find((r: any) => r.epochId === 2).expiredAt).toBe(2500);
    });

    it("returns empty arrays and null scalars when no events exist", async () => {
        mockReadContract
            .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
            .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

        await seedTables({});

        const res = await app.request("/compliance/fdic-370", { headers: validHeaders() });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.depositorPopulation).toEqual([]);
        expect(body.crossBankConflicts).toEqual([]);
        expect(body.saltEpochLineage).toEqual([]);
        expect(body.cipCoverage).toEqual([]);
        expect(body.currentSaltEpoch).toBeNull();
        expect(body.disclaimer).toContain("Exam-support metadata only");
        expect(body.regulatoryNotice).toContain("THIS OUTPUT IS NOT A 12 CFR 370 DETERMINATION");
    });

    it("?bank= filter narrows depositorPopulation and crossBankConflicts", async () => {
        mockReadContract
            .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
            .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

        await seedTables({
            depositorIdentityEvent: [
                { id: "f1", eventType: "HashSubmitted", bank: BANK_A, tinHash: "0x01", count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1000, txHash: "0xtx1" },
                { id: "f2", eventType: "HashSubmitted", bank: BANK_B, tinHash: "0x02", count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1000, txHash: "0xtx2" },
                { id: "f3", eventType: "ConflictDetected", bank: BANK_A, counterpartyBank: BANK_B, tinHash: "0xc1", count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1000, txHash: "0xtx3" },
                { id: "f4", eventType: "ConflictDetected", bank: BANK_B, counterpartyBank: BANK_A, tinHash: "0xc2", count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: null, admin: null, timestamp: 1000, txHash: "0xtx4" },
                // Salt + CIP rows that the ?bank= filter must NOT touch.
                { id: "fs1", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 1, saltHash: "0xfs1", activatedAt: 1000, transitionWindow: 0, expiredAt: null, newEpochId: null, admin: null, timestamp: 1000, txHash: "0xtxfs1" },
            ],
            cipEvent: [
                { id: "0xtxfc1-0", eventType: "Recorded", wallet: WALLET_1, custodian: CUSTODIAN_X, cipRecordHash: "0xcipf1", timestamp: 1000, txHash: "0xtxfc1" },
            ],
        });

        const res = await app.request(`/compliance/fdic-370?bank=${BANK_A}`, { headers: validHeaders() });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.depositorPopulation).toHaveLength(1);
        expect(body.depositorPopulation[0].bank).toBe(BANK_A);
        expect(body.crossBankConflicts).toHaveLength(1);
        expect(body.crossBankConflicts[0].bank).toBe(BANK_A);

        // ?bank= scopes ONLY depositorPopulation + crossBankConflicts. Salt-epoch
        // lineage and CIP coverage are network-global and must be unaffected.
        expect(body.saltEpochLineage).toHaveLength(1);
        expect(body.saltEpochLineage[0].epochId).toBe(1);
        expect(body.currentSaltEpoch).toBe(1);
        expect(body.cipCoverage).toHaveLength(1);
        expect(body.cipCoverage[0].custodian).toBe(CUSTODIAN_X);
        expect(body.cipCoverage[0].walletsWithCip).toBe(1);
    });

    it("supersedes by the EARLIEST emergency when two compromises overlap", async () => {
        mockReadContract
            .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
            .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

        // Two emergencies fire. Epoch 1 is active at BOTH (it is created @1000 and
        // only hard-expires @2000, the first emergency's moment). The first
        // emergency @2000 creates epoch 2; the second @3000 creates epoch 3.
        // Epoch 1 must be attributed to the FIRST emergency (newEpochId 2), not the
        // later one — the `emergencySupersession.has(eId)` guard locks earliest-wins.
        await seedTables({
            depositorIdentityEvent: [
                { id: "n1", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 1, saltHash: "0xs1", activatedAt: 1000, transitionWindow: 5000, expiredAt: null, newEpochId: null, admin: null, timestamp: 1000, txHash: "0xtx1" },
                { id: "e1", eventType: "EmergencySaltCompromise", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: 2, admin: "0xadmin", timestamp: 2000, txHash: "0xtxe1" },
                { id: "x1", eventType: "SaltEpochExpired", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 1, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: 2000, newEpochId: null, admin: null, timestamp: 2000, txHash: "0xtxx1" },
                { id: "n2", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 2, saltHash: "0xs2", activatedAt: 2000, transitionWindow: 5000, expiredAt: null, newEpochId: null, admin: null, timestamp: 2000, txHash: "0xtx2" },
                { id: "e2", eventType: "EmergencySaltCompromise", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: null, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: null, newEpochId: 3, admin: "0xadmin", timestamp: 3000, txHash: "0xtxe2" },
                { id: "x2", eventType: "SaltEpochExpired", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 2, saltHash: null, activatedAt: null, transitionWindow: null, expiredAt: 3000, newEpochId: null, admin: null, timestamp: 3000, txHash: "0xtxx2" },
                { id: "n3", eventType: "SaltEpochCreated", bank: null, counterpartyBank: null, tinHash: null, count: null, epochId: 3, saltHash: "0xs3", activatedAt: 3000, transitionWindow: 0, expiredAt: null, newEpochId: null, admin: null, timestamp: 3000, txHash: "0xtx3" },
            ],
        });

        const res = await app.request("/compliance/fdic-370", { headers: validHeaders() });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        const lineage = body.saltEpochLineage;
        // Epoch 1 active at both emergencies → earliest wins (epoch 2), not 3.
        expect(lineage.find((r: any) => r.epochId === 1).supersededBy).toBe(2);
        // Epoch 2 active at the second emergency only → superseded by 3.
        expect(lineage.find((r: any) => r.epochId === 2).supersededBy).toBe(3);
        expect(lineage.find((r: any) => r.epochId === 3).supersededBy).toBeNull();
    });

    it("breaks equal-timestamp CIP events by block-scoped logIndex", async () => {
        mockReadContract
            .mockResolvedValueOnce(false) // COMPLIANCE_ROLE → false
            .mockResolvedValueOnce(true); // COMPLIANCE_OFFICER_ROLE → true

        // Same-block (same timestamp) revoke then re-record for WALLET_1. Ordering
        // must come from the logIndex embedded in the event id (`txHash-logIndex`),
        // NOT DB row-return order. logIndex 2 (Recorded) is the latest → covered.
        // WALLET_2 has the inverse (re-record then revoke) → NOT covered.
        await seedTables({
            cipEvent: [
                { id: "0xblk-0", eventType: "Recorded", wallet: WALLET_1, custodian: CUSTODIAN_X, cipRecordHash: "0xc1", timestamp: 5000, txHash: "0xblk" },
                { id: "0xblk-1", eventType: "Revoked", wallet: WALLET_1, custodian: CUSTODIAN_X, cipRecordHash: null, timestamp: 5000, txHash: "0xblk" },
                { id: "0xblk-2", eventType: "Recorded", wallet: WALLET_1, custodian: CUSTODIAN_X, cipRecordHash: "0xc1b", timestamp: 5000, txHash: "0xblk" },
                { id: "0xblk-3", eventType: "Revoked", wallet: WALLET_2, custodian: CUSTODIAN_X, cipRecordHash: null, timestamp: 5000, txHash: "0xblk" },
                { id: "0xblk-4", eventType: "Recorded", wallet: WALLET_2, custodian: CUSTODIAN_X, cipRecordHash: "0xc2", timestamp: 5000, txHash: "0xblk" },
                { id: "0xblk-5", eventType: "Revoked", wallet: WALLET_2, custodian: CUSTODIAN_X, cipRecordHash: null, timestamp: 5000, txHash: "0xblk" },
            ],
        });

        const res = await app.request("/compliance/fdic-370", { headers: validHeaders() });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        const cipX = body.cipCoverage.find((r: any) => r.custodian === CUSTODIAN_X);
        // WALLET_1 latest = Recorded (logIndex 2); WALLET_2 latest = Revoked (5).
        expect(cipX.walletsWithCip).toBe(1);
    });
});
