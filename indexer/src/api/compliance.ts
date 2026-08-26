import { Hono } from "hono";
import { db } from "ponder:api";
import * as schema from "ponder:schema";
import { eq, and, gte, lte, desc, sql, count } from "drizzle-orm";
import { verifyMessage, createPublicClient, http, keccak256, encodePacked, defineChain } from "viem";
import { hasNonce, consumeNonce } from "../lib/nonce-store";

const COMPLIANCE_ROLE = keccak256(encodePacked(["string"], ["COMPLIANCE_ROLE"]));
const COMPLIANCE_OFFICER_ROLE = keccak256(encodePacked(["string"], ["COMPLIANCE_OFFICER_ROLE"]));
const DIAMOND_ADDRESS = (process.env.PONDER_DIAMOND_ADDRESS || "0xCD8a1C3ba11CF5ECfa6267617243239504a98d90") as `0x${string}`;
const RPC_URL = process.env.PONDER_RPC_URL || "http://127.0.0.1:8545";

const chain = defineChain({
    id: 1337,
    name: "T3 Local",
    nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    rpcUrls: { default: { http: [RPC_URL] } },
});

const client = createPublicClient({
    chain,
    transport: http(RPC_URL),
});

const app = new Hono();

export const authMiddleware = async (c: any, next: any) => {
    const signerAddress = c.req.header("x-signer-address");
    const signature = c.req.header("x-signature");
    const timestamp = c.req.header("x-signature-timestamp");
    const nonce = c.req.header("x-signature-nonce");

    if (!signerAddress || !signature || !timestamp || !nonce) {
        return c.json({ error: "Missing authentication headers" }, 401);
    }

    // 1. TTL Check (300s)
    const now = Math.floor(Date.now() / 1000);
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(now - ts) > 300) {
        return c.json({ error: "Signature expired or timestamp invalid" }, 401);
    }

    // 2. Replay Protection — persisted in SQLite file so protection survives process restarts
    if (hasNonce(nonce)) {
        return c.json({ error: "Nonce already used" }, 401);
    }

    // 3. Signature Verification
    const bodyText = await c.req.text();
    const bodyHash = bodyText.length > 0
        ? keccak256(encodePacked(["string"], [bodyText]))
        : "0x0000000000000000000000000000000000000000000000000000000000000000";

    const message = [
        c.req.method,
        new URL(c.req.url).pathname,
        bodyHash,
        timestamp,
        nonce,
    ].join(":");

    const isValid = await verifyMessage({
        address: signerAddress as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
    });

    if (!isValid) {
        return c.json({ error: "Invalid signature" }, 401);
    }

    // Persist nonce before role check — blocks concurrent requests with the same nonce
    consumeNonce(nonce, signerAddress, now);

    // 4. On-chain Role Verification
    try {
        const [isCompliance, isOfficer] = await Promise.all([
            client.readContract({
                address: DIAMOND_ADDRESS,
                abi: [{
                    name: "hasRole",
                    type: "function",
                    inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }],
                    outputs: [{ name: "", type: "bool" }],
                    stateMutability: "view",
                }],
                functionName: "hasRole",
                args: [COMPLIANCE_ROLE as `0x${string}`, signerAddress as `0x${string}`],
            }),
            client.readContract({
                address: DIAMOND_ADDRESS,
                abi: [{
                    name: "hasRole",
                    type: "function",
                    inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }],
                    outputs: [{ name: "", type: "bool" }],
                    stateMutability: "view",
                }],
                functionName: "hasRole",
                args: [COMPLIANCE_OFFICER_ROLE as `0x${string}`, signerAddress as `0x${string}`],
            }),
        ]);

        if (!isCompliance && !isOfficer) {
            return c.json({ error: "Unauthorized: Insufficient roles" }, 403);
        }

        c.set("isComplianceOfficer", isOfficer);
        c.set("isCompliance", isCompliance);
    } catch (e) {
        console.error("Role verification failed:", e);
        return c.json({ error: "Internal server error during authorization" }, 500);
    }

    await next();
};

app.use("/compliance/*", authMiddleware);

// Helper to parse pagination params
const parsePagination = (c: any) => ({
    limit: Math.min(parseInt(c.req.query("limit") || "50", 10), 200),
    offset: Math.max(parseInt(c.req.query("offset") || "0", 10), 0),
});

// Helper to build optional filter conditions
const buildAddressFilter = (table: any, sender?: string, recipient?: string) => {
    const conditions = [];
    if (sender) conditions.push(eq(table.sender, sender.toLowerCase()));
    if (recipient) conditions.push(eq(table.recipient, recipient.toLowerCase()));
    return conditions.length > 0 ? and(...conditions) : undefined;
};

// ============================================================================
// Direct Transfers
// ============================================================================

app.get("/compliance/direct-transfers", async (c) => {
    const { sender, recipient, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (sender) conditions.push(eq(schema.directTransferEvent.from, sender.toLowerCase()));
    if (recipient) conditions.push(eq(schema.directTransferEvent.to, recipient.toLowerCase()));
    if (from) conditions.push(gte(schema.directTransferEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.directTransferEvent.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.directTransferEvent)
            .where(where)
            .orderBy(desc(schema.directTransferEvent.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.directTransferEvent)
            .where(where),
    ]);

    return c.json({
        data: items,
        pagination: {
            limit,
            offset,
            total: totalResult[0]?.count ?? 0,
        },
    });
});

// ============================================================================
// Envelope Events
// ============================================================================

app.get("/compliance/envelopes", async (c) => {
    const { envelopeId, eventType, sender, recipient, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (envelopeId) conditions.push(eq(schema.envelopeEvent.envelopeId, envelopeId.toLowerCase()));
    if (eventType) conditions.push(eq(schema.envelopeEvent.eventType, eventType));
    if (sender) conditions.push(eq(schema.envelopeEvent.sender, sender.toLowerCase()));
    if (recipient) conditions.push(eq(schema.envelopeEvent.recipient, recipient.toLowerCase()));
    if (from) conditions.push(gte(schema.envelopeEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.envelopeEvent.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.envelopeEvent)
            .where(where)
            .orderBy(desc(schema.envelopeEvent.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.envelopeEvent)
            .where(where),
    ]);

    return c.json({
        data: items,
        pagination: {
            limit,
            offset,
            total: totalResult[0]?.count ?? 0,
        },
    });
});

app.get("/compliance/envelopes/:envelopeId/timeline", async (c) => {
    const envelopeId = c.req.param("envelopeId").toLowerCase();
    const { limit, offset } = parsePagination(c);

    const [envelopeEvents, smartLockEvents] = await Promise.all([
        db
            .select()
            .from(schema.envelopeEvent)
            .where(eq(schema.envelopeEvent.envelopeId, envelopeId))
            .orderBy(schema.envelopeEvent.timestamp)
            .limit(limit)
            .offset(offset),
        db
            .select()
            .from(schema.smartLockEnvelopeEvent)
            .where(eq(schema.smartLockEnvelopeEvent.envelopeId, envelopeId))
            .orderBy(schema.smartLockEnvelopeEvent.timestamp)
            .limit(limit)
            .offset(offset),
    ]);

    const timeline = [
        ...envelopeEvents.map((e) => ({ ...e, source: "envelope" })),
        ...smartLockEvents.map((e) => ({ ...e, source: "smartLock" })),
    ].sort((a, b) => a.timestamp - b.timestamp);

    return c.json({ envelopeId, timeline });
});

// ============================================================================
// Smart Lock Envelope Events
// ============================================================================

app.get("/compliance/smart-locks", async (c) => {
    const { envelopeId, eventType, sender, recipient, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (envelopeId) conditions.push(eq(schema.smartLockEnvelopeEvent.envelopeId, envelopeId.toLowerCase()));
    if (eventType) conditions.push(eq(schema.smartLockEnvelopeEvent.eventType, eventType));
    if (sender) conditions.push(eq(schema.smartLockEnvelopeEvent.sender, sender.toLowerCase()));
    if (recipient) conditions.push(eq(schema.smartLockEnvelopeEvent.recipient, recipient.toLowerCase()));
    if (from) conditions.push(gte(schema.smartLockEnvelopeEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.smartLockEnvelopeEvent.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.smartLockEnvelopeEvent)
            .where(where)
            .orderBy(desc(schema.smartLockEnvelopeEvent.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.smartLockEnvelopeEvent)
            .where(where),
    ]);

    return c.json({
        data: items,
        pagination: {
            limit,
            offset,
            total: totalResult[0]?.count ?? 0,
        },
    });
});

// ============================================================================
// Cambio Envelope Note Events
// ============================================================================

app.get("/compliance/cambio-notes", async (c) => {
    const { noteId, issuer, eventType, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (noteId) conditions.push(eq(schema.cambioEnvelopeNoteEvent.noteId, noteId.toLowerCase()));
    if (issuer) conditions.push(eq(schema.cambioEnvelopeNoteEvent.issuer, issuer.toLowerCase()));
    if (eventType) conditions.push(eq(schema.cambioEnvelopeNoteEvent.eventType, eventType));
    if (from) conditions.push(gte(schema.cambioEnvelopeNoteEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.cambioEnvelopeNoteEvent.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.cambioEnvelopeNoteEvent)
            .where(where)
            .orderBy(desc(schema.cambioEnvelopeNoteEvent.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.cambioEnvelopeNoteEvent)
            .where(where),
    ]);

    return c.json({
        data: items,
        pagination: {
            limit,
            offset,
            total: totalResult[0]?.count ?? 0,
        },
    });
});

// ============================================================================
// Cambio Commit Events
// ============================================================================

app.get("/compliance/commits", async (c) => {
    const { commitHash, redeemer, eventType, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (commitHash) conditions.push(eq(schema.cambioCommitEvent.commitmentHash, commitHash.toLowerCase()));
    if (redeemer) conditions.push(eq(schema.cambioCommitEvent.redeemer, redeemer.toLowerCase()));
    if (eventType) conditions.push(eq(schema.cambioCommitEvent.eventType, eventType));
    if (from) conditions.push(gte(schema.cambioCommitEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.cambioCommitEvent.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.cambioCommitEvent)
            .where(where)
            .orderBy(desc(schema.cambioCommitEvent.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.cambioCommitEvent)
            .where(where),
    ]);

    return c.json({
        data: items,
        pagination: {
            limit,
            offset,
            total: totalResult[0]?.count ?? 0,
        },
    });
});

// ============================================================================
// Cambio Issuer Events
// ============================================================================

app.get("/compliance/issuers", async (c) => {
    const { issuer, eventType, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (issuer) conditions.push(eq(schema.cambioIssuerEvent.issuer, issuer.toLowerCase()));
    if (eventType) conditions.push(eq(schema.cambioIssuerEvent.eventType, eventType));
    if (from) conditions.push(gte(schema.cambioIssuerEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.cambioIssuerEvent.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.cambioIssuerEvent)
            .where(where)
            .orderBy(desc(schema.cambioIssuerEvent.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.cambioIssuerEvent)
            .where(where),
    ]);

    return c.json({
        data: items,
        pagination: {
            limit,
            offset,
            total: totalResult[0]?.count ?? 0,
        },
    });
});

// ============================================================================
// Screening Attestation Events
// ============================================================================

app.get("/compliance/screening", async (c) => {
    const { wallet, status, attestor, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (wallet) conditions.push(eq(schema.screeningEvent.wallet, wallet.toLowerCase()));
    if (status) conditions.push(eq(schema.screeningEvent.status, parseInt(status, 10)));
    if (attestor) conditions.push(eq(schema.screeningEvent.attestor, attestor.toLowerCase()));
    if (from) conditions.push(gte(schema.screeningEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.screeningEvent.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.screeningEvent)
            .where(where)
            .orderBy(desc(schema.screeningEvent.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.screeningEvent)
            .where(where),
    ]);

    return c.json({
        data: items,
        pagination: {
            limit,
            offset,
            total: totalResult[0]?.count ?? 0,
        },
    });
});

// ============================================================================
// CIP Attestation Events
// ============================================================================

app.get("/compliance/cip", async (c) => {
    const { wallet, custodian, eventType, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (wallet) conditions.push(eq(schema.cipEvent.wallet, wallet.toLowerCase()));
    if (custodian) conditions.push(eq(schema.cipEvent.custodian, custodian.toLowerCase()));
    if (eventType) conditions.push(eq(schema.cipEvent.eventType, eventType));
    if (from) conditions.push(gte(schema.cipEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.cipEvent.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.cipEvent)
            .where(where)
            .orderBy(desc(schema.cipEvent.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.cipEvent)
            .where(where),
    ]);

    return c.json({
        data: items,
        pagination: {
            limit,
            offset,
            total: totalResult[0]?.count ?? 0,
        },
    });
});

// ============================================================================
// FDIC 12 CFR 370 Exam-Support Reporting (Wave 8F)
// ============================================================================

app.get("/compliance/fdic-370", async (c) => {
    const ctx = c as any;
    if (!ctx.get("isComplianceOfficer")) {
        return c.json({ error: "Unauthorized: FDIC-370 requires COMPLIANCE_OFFICER_ROLE" }, 403);
    }

    const bankFilter = c.req.query("bank")?.toLowerCase();

    const [identityRows, cipRows] = await Promise.all([
        db.select().from(schema.depositorIdentityEvent),
        db.select().from(schema.cipEvent),
    ]);

    // Depositor population: all-time net hash count per bank
    const hashEventTypes = new Set(["HashSubmitted", "HashRemoved", "HashBatchSubmitted", "HashBatchRemoved"]);
    const populationByBank = new Map<string, { net: number; lastUpdated: number }>();
    for (const row of identityRows) {
        if (!row.bank || !hashEventTypes.has(row.eventType)) continue;
        if (bankFilter && row.bank !== bankFilter) continue;
        const entry = populationByBank.get(row.bank) ?? { net: 0, lastUpdated: 0 };
        if (row.eventType === "HashSubmitted") entry.net += 1;
        else if (row.eventType === "HashRemoved") entry.net -= 1;
        else if (row.eventType === "HashBatchSubmitted") entry.net += row.count ?? 0;
        else if (row.eventType === "HashBatchRemoved") entry.net -= row.count ?? 0;
        entry.lastUpdated = Math.max(entry.lastUpdated, row.timestamp);
        populationByBank.set(row.bank, entry);
    }
    const depositorPopulation = Array.from(populationByBank.entries())
        .map(([bank, { net, lastUpdated }]) => ({
            bank,
            activeHashCount: Math.max(0, net),
            underflowDetected: net < 0,
            lastUpdated,
        }))
        .sort((a, b) => a.bank.localeCompare(b.bank));

    // Cross-bank conflicts
    const crossBankConflicts = identityRows
        .filter((r) => r.eventType === "ConflictDetected" && (!bankFilter || r.bank === bankFilter))
        .map((r) => ({
            bank: r.bank,
            counterpartyBank: r.counterpartyBank,
            tinHash: r.tinHash,
            detectedAt: r.timestamp,
        }))
        .sort((a, b) => a.detectedAt - b.detectedAt);

    // Salt epoch lineage
    const createdEpochs = identityRows
        .filter((r) => r.eventType === "SaltEpochCreated")
        .sort((a, b) => (a.epochId ?? 0) - (b.epochId ?? 0));
    const expiredByEpoch = new Map<number, number | null>();
    for (const row of identityRows) {
        if (row.eventType === "SaltEpochExpired" && row.epochId != null) {
            expiredByEpoch.set(row.epochId, row.expiredAt ?? null);
        }
    }
    // An emergencySaltCompromise expires EVERY epoch active at its timestamp and
    // replaces the whole active set with its newEpochId. Because rotateSalt can
    // leave a predecessor epoch active inside its transition window, multiple
    // epochs may be concurrently active when an emergency fires — each is
    // superseded by that emergency, not by the next sequential epoch. Attribute
    // each concurrently-active epoch to the EARLIEST emergency that superseded it.
    const sortedEmergencies = identityRows
        .filter((r) => r.eventType === "EmergencySaltCompromise" && r.newEpochId != null)
        .sort((a, b) => a.timestamp - b.timestamp);
    const emergencySupersession = new Map<number, number>();
    for (const emergency of sortedEmergencies) {
        const newEpochId = emergency.newEpochId as number;
        for (const e of createdEpochs) {
            const eId = e.epochId ?? null;
            if (eId == null || eId >= newEpochId) continue;
            if (emergencySupersession.has(eId)) continue;
            const activatedAt = e.activatedAt ?? 0;
            const expiredAt = expiredByEpoch.get(eId) ?? null;
            // Active at the emergency moment: activated on/before it, and not
            // hard-expired strictly before it (the emergency's own expiry events
            // carry expiredAt == emergency.timestamp, so >= keeps them in scope).
            const activeAtEmergency =
                activatedAt <= emergency.timestamp &&
                (expiredAt == null || expiredAt >= emergency.timestamp);
            if (activeAtEmergency) {
                emergencySupersession.set(eId, newEpochId);
            }
        }
    }

    const saltEpochLineage = createdEpochs.map((epoch, index) => {
        const epochId = epoch.epochId ?? null;
        const expiredAt = epochId != null ? expiredByEpoch.get(epochId) ?? null : null;

        // Emergency compromise takes precedence over default rotation
        const supersededBy = epochId != null ? emergencySupersession.get(epochId) ?? null : null;

        return {
            epochId: epochId,
            saltHash: epoch.saltHash,
            activatedAt: epoch.activatedAt,
            expiredAt,
            supersededBy,
        };
    });

    // Fill default successors after emergency overrides are applied
    for (let i = 0; i < saltEpochLineage.length - 1; i++) {
        const current = saltEpochLineage[i];
        const next = saltEpochLineage[i + 1];
        if (current && current.supersededBy == null) {
            current.supersededBy = next?.epochId ?? null;
        }
    }

    const currentSaltEpoch = createdEpochs.length > 0 ? createdEpochs[createdEpochs.length - 1]?.epochId ?? null : null;

    // CIP coverage: per custodian, distinct wallets whose latest event is Recorded.
    // Tie-break equal timestamps (e.g. a same-block revoke + re-record) by the
    // block-scoped logIndex parsed from the event id (`txHash-logIndex`), so the
    // result is deterministic and does not depend on DB row-return order.
    const cipLogIndex = (id: string) => Number(id.slice(id.lastIndexOf("-") + 1));
    const walletState = new Map<string, { custodian: string; timestamp: number; logIndex: number; eventType: string }>();
    for (const row of cipRows) {
        const current = walletState.get(row.wallet);
        const logIndex = cipLogIndex(row.id);
        const isLater =
            !current ||
            row.timestamp > current.timestamp ||
            (row.timestamp === current.timestamp && logIndex > current.logIndex);
        if (isLater) {
            walletState.set(row.wallet, {
                custodian: row.custodian,
                timestamp: row.timestamp,
                logIndex,
                eventType: row.eventType,
            });
        }
    }
    const coverageByCustodian = new Map<string, number>();
    for (const state of walletState.values()) {
        if (state.eventType === "Recorded") {
            coverageByCustodian.set(state.custodian, (coverageByCustodian.get(state.custodian) ?? 0) + 1);
        }
    }
    const cipCoverage = Array.from(coverageByCustodian.entries())
        .map(([custodian, walletsWithCip]) => ({ custodian, walletsWithCip }))
        .sort((a, b) => a.custodian.localeCompare(b.custodian));

    return c.json({
        formatVersion: "DRAFT",
        counselGate: "G9",
        disclaimer: "Exam-support metadata only. Per-depositor/per-category insurance determination is the bank's off-chain responsibility. On-chain DepositorIdentity is boolean/hash-only by design (inference-attack avoidance); this endpoint makes NO representation of 12 CFR 370 compliance or insurance-calculation completeness.",
        regulatoryNotice: "THIS OUTPUT IS NOT A 12 CFR 370 DETERMINATION. It contains recordkeeping metadata and cross-bank de-duplication evidence only. It does not compute, assert, or imply deposit-insurance coverage for any depositor. Cross-bank conflict (tinHash) rows are correlation-sensitive and access-restricted.",
        generatedAt: Math.floor(Date.now() / 1000),
        currentSaltEpoch,
        depositorPopulation,
        crossBankConflicts,
        saltEpochLineage,
        cipCoverage,
    });
});

// ============================================================================
// Travel Rule Events
// ============================================================================

app.get("/compliance/travel-rule", async (c) => {
    const { envelopeId, sender, ref, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (envelopeId) conditions.push(eq(schema.travelRuleEvent.envelopeId, envelopeId.toLowerCase()));
    if (sender) conditions.push(eq(schema.travelRuleEvent.sender, sender.toLowerCase()));
    if (ref) conditions.push(eq(schema.travelRuleEvent.ref, ref.toLowerCase()));
    if (from) conditions.push(gte(schema.travelRuleEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.travelRuleEvent.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.travelRuleEvent)
            .where(where)
            .orderBy(desc(schema.travelRuleEvent.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.travelRuleEvent)
            .where(where),
    ]);

    return c.json({
        data: items,
        pagination: {
            limit,
            offset,
            total: totalResult[0]?.count ?? 0,
        },
    });
});

// ============================================================================
// Wallet Activity Aggregation
// ============================================================================

app.get("/compliance/wallet/:address/activity", async (c) => {
    const address = c.req.param("address").toLowerCase();
    const { from, to } = c.req.query();

    const timeConditions = [];
    if (from) timeConditions.push(gte(schema.directTransferEvent.timestamp, parseInt(from, 10)));
    if (to) timeConditions.push(lte(schema.directTransferEvent.timestamp, parseInt(to, 10)));
    const timeWhere = timeConditions.length > 0 ? and(...timeConditions) : undefined;

    const sentCondition = and(
        eq(schema.directTransferEvent.from, address),
        timeWhere
    );
    const receivedCondition = and(
        eq(schema.directTransferEvent.to, address),
        timeWhere
    );

    const [sentAgg, receivedAgg, envelopeAgg, noteAgg] = await Promise.all([
        db
            .select({
                count: count(),
                total: sql<string>`COALESCE(SUM(CAST(${schema.directTransferEvent.amount} AS NUMERIC)), 0)`,
            })
            .from(schema.directTransferEvent)
            .where(sentCondition),
        db
            .select({
                count: count(),
                total: sql<string>`COALESCE(SUM(CAST(${schema.directTransferEvent.amount} AS NUMERIC)), 0)`,
            })
            .from(schema.directTransferEvent)
            .where(receivedCondition),
        db
            .select({
                sent: count(),
            })
            .from(schema.envelopeEvent)
            .where(
                and(
                    eq(schema.envelopeEvent.sender, address),
                    eq(schema.envelopeEvent.eventType, "Created")
                )
            ),
        db
            .select({
                issued: count(),
            })
            .from(schema.cambioEnvelopeNoteEvent)
            .where(
                and(
                    eq(schema.cambioEnvelopeNoteEvent.issuer, address),
                    eq(schema.cambioEnvelopeNoteEvent.eventType, "Created")
                )
            ),
    ]);

    return c.json({
        address,
        directTransfers: {
            sent: { count: sentAgg[0]?.count ?? 0, total: sentAgg[0]?.total ?? "0" },
            received: { count: receivedAgg[0]?.count ?? 0, total: receivedAgg[0]?.total ?? "0" },
        },
        envelopesCreated: envelopeAgg[0]?.sent ?? 0,
        cambioNotesIssued: noteAgg[0]?.issued ?? 0,
    });
});

// ============================================================================
// Daily Summary
// ============================================================================

app.get("/compliance/summary", async (c) => {
    const { from, to } = c.req.query();

    const conditions = [];
    if (from) conditions.push(gte(schema.directTransferEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.directTransferEvent.timestamp, parseInt(to, 10)));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [transferStats, envelopeStats, noteStats] = await Promise.all([
        db
            .select({
                count: count(),
                volume: sql<string>`COALESCE(SUM(CAST(${schema.directTransferEvent.amount} AS NUMERIC)), 0)`,
            })
            .from(schema.directTransferEvent)
            .where(where),
        db
            .select({
                created: sql<number>`COUNT(CASE WHEN ${schema.envelopeEvent.eventType} = 'Created' THEN 1 END)`,
                finalized: sql<number>`COUNT(CASE WHEN ${schema.envelopeEvent.eventType} = 'Finalized' THEN 1 END)`,
                reversed: sql<number>`COUNT(CASE WHEN ${schema.envelopeEvent.eventType} = 'Reversed' THEN 1 END)`,
                disputed: sql<number>`COUNT(CASE WHEN ${schema.envelopeEvent.eventType} = 'Disputed' THEN 1 END)`,
            })
            .from(schema.envelopeEvent)
            .where(
                from && to
                    ? and(
                          gte(schema.envelopeEvent.timestamp, parseInt(from, 10)),
                          lte(schema.envelopeEvent.timestamp, parseInt(to, 10))
                      )
                    : undefined
            ),
        db
            .select({
                created: sql<number>`COUNT(CASE WHEN ${schema.cambioEnvelopeNoteEvent.eventType} = 'Created' THEN 1 END)`,
                redeemed: sql<number>`COUNT(CASE WHEN ${schema.cambioEnvelopeNoteEvent.eventType} = 'Redeemed' THEN 1 END)`,
                cancelled: sql<number>`COUNT(CASE WHEN ${schema.cambioEnvelopeNoteEvent.eventType} = 'Cancelled' THEN 1 END)`,
            })
            .from(schema.cambioEnvelopeNoteEvent)
            .where(
                from && to
                    ? and(
                          gte(schema.cambioEnvelopeNoteEvent.timestamp, parseInt(from, 10)),
                          lte(schema.cambioEnvelopeNoteEvent.timestamp, parseInt(to, 10))
                      )
                    : undefined
            ),
    ]);

    return c.json({
        directTransfers: transferStats[0],
        envelopes: envelopeStats[0],
        cambioNotes: noteStats[0],
    });
});

export default app;
