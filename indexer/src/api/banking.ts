import { Hono } from "hono";
import { db } from "ponder:api";
import * as schema from "ponder:schema";
import { eq, and, gte, lte, desc, count } from "drizzle-orm";

const app = new Hono();

// Helper to parse pagination params
const parsePagination = (c: any) => ({
    limit: Math.min(parseInt(c.req.query("limit") || "50", 10), 200),
    offset: Math.max(parseInt(c.req.query("offset") || "0", 10), 0),
});

// ============================================================================
// Issuance Events
// ============================================================================

app.get("/banking/issuance", async (c) => {
    const { issuanceId, bank, eventType, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (issuanceId) conditions.push(eq(schema.issuanceEvent.issuanceId, issuanceId.toLowerCase()));
    if (bank) conditions.push(eq(schema.issuanceEvent.bank, bank.toLowerCase()));
    if (eventType) conditions.push(eq(schema.issuanceEvent.eventType, eventType));
    if (from) conditions.push(gte(schema.issuanceEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.issuanceEvent.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.issuanceEvent)
            .where(where)
            .orderBy(desc(schema.issuanceEvent.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.issuanceEvent)
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

app.get("/banking/issuance/:issuanceId/timeline", async (c) => {
    const issuanceId = c.req.param("issuanceId").toLowerCase();
    const { limit, offset } = parsePagination(c);

    const items = await db
        .select()
        .from(schema.issuanceEvent)
        .where(eq(schema.issuanceEvent.issuanceId, issuanceId))
        .orderBy(schema.issuanceEvent.timestamp)
        .limit(limit)
        .offset(offset);

    return c.json({ issuanceId, timeline: items });
});

// ============================================================================
// Settlement Cycle Events
// ============================================================================

app.get("/banking/settlement-cycles", async (c) => {
    const { cycleId, institution, fundingIssuer, eventType, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (cycleId) conditions.push(eq(schema.settlementCycleEvent.cycleId, cycleId.toLowerCase()));
    if (institution) conditions.push(eq(schema.settlementCycleEvent.institution, institution.toLowerCase()));
    if (fundingIssuer) conditions.push(eq(schema.settlementCycleEvent.fundingIssuer, fundingIssuer.toLowerCase()));
    if (eventType) conditions.push(eq(schema.settlementCycleEvent.eventType, eventType));
    if (from) conditions.push(gte(schema.settlementCycleEvent.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.settlementCycleEvent.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.settlementCycleEvent)
            .where(where)
            .orderBy(desc(schema.settlementCycleEvent.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.settlementCycleEvent)
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

app.get("/banking/settlement-cycles/:cycleId/timeline", async (c) => {
    const cycleId = c.req.param("cycleId").toLowerCase();
    const { limit, offset } = parsePagination(c);

    const items = await db
        .select()
        .from(schema.settlementCycleEvent)
        .where(eq(schema.settlementCycleEvent.cycleId, cycleId))
        .orderBy(schema.settlementCycleEvent.timestamp)
        .limit(limit)
        .offset(offset);

    return c.json({ cycleId, timeline: items });
});

// ============================================================================
// Settlement Obligations (system of record for keeper root + 6C reconciliation)
// ============================================================================

app.get("/banking/settlement-obligations", async (c) => {
    const { obligationId, outgoingIssuer, receivingIssuer, from, to } = c.req.query();
    const { limit, offset } = parsePagination(c);

    const conditions = [];
    if (obligationId) conditions.push(eq(schema.settlementObligation.obligationId, obligationId.toLowerCase()));
    if (outgoingIssuer) conditions.push(eq(schema.settlementObligation.outgoingIssuer, outgoingIssuer.toLowerCase()));
    if (receivingIssuer) conditions.push(eq(schema.settlementObligation.receivingIssuer, receivingIssuer.toLowerCase()));
    if (from) conditions.push(gte(schema.settlementObligation.timestamp, parseInt(from, 10)));
    if (to) conditions.push(lte(schema.settlementObligation.timestamp, parseInt(to, 10)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [items, totalResult] = await Promise.all([
        db
            .select()
            .from(schema.settlementObligation)
            .where(where)
            .orderBy(desc(schema.settlementObligation.timestamp))
            .limit(limit)
            .offset(offset),
        db
            .select({ count: count() })
            .from(schema.settlementObligation)
            .where(where),
    ]);

    return c.json({
        data: items,
        pagination: { limit, offset, total: totalResult[0]?.count ?? 0 },
    });
});

export default app;
