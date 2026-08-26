# Wave G — Indexer Legacy Event Archive Strategy (Draft)

**Date:** 2026-06-06  
**Branch:** `feature/envelope-besu`  
**Status:** DRAFT — Decision points outstanding; BA approval required before implementation  
**Author:** AI Agent  
**Depends on:** Phase-1C envelope event cutover (completed), Wave E′ (Besu live indexing)  
**Scope:** SPEC ONLY — no code changes, no schema edits, no handler removal

---

## 1. Context & Problem Statement

### 1.1 What is being deprecated

The Ponder indexer (`indexer/`) maintains two deprecated event tables that pre-date the envelope-mode cutover:

| SQL Table | Ponder Schema Name | Legacy Events Bound | Successor Table |
|---|---|---|---|
| `locked_transfer_event` | `lockedTransferEvent` | `LockedTransferCreated`, `LockedTransferReleased`, `LockedTransferCancelled` | `direct_transfer_event` |
| `cambio_event` | `cambioEvent` | `CambioNoteCreated`, `CambioNoteRedeemed`, `CambioNoteCancelled`, `CambioConfigUpdated` | `cambio_envelope_note_event`, `cambio_commit_event`, `cambio_issuer_event` |

Both tables carry the schema annotation:

> `@deprecated — superseded by direct_transfer_event / cambio_envelope_note_event respectively. Table preserved for historical data integrity. Do not write new handlers to it.`

### 1.2 The Ponder re-derivation model

Ponder is a **deterministic projection** engine. On every (re)index it rebuilds all tables from on-chain logs using the registered ABI and handlers. This means:

- **Data that IS re-derivable:** Any row whose source chain is still online, whose contract is still deployed, and whose event signature remains in the indexed ABI.
- **Data that is NOT re-derivable:** Rows whose source chain has been decommissioned, whose events were removed from the ABI, or whose contract was self-destructed.

Consequence for archive planning: a "physical" archive (data moved outside Ponder’s control) survives reindex. An in-Ponder table does **not** survive reindex unless its source events and handlers are still present.

### 1.3 The core nuance

**The legacy stack was never deployed in production.** There are no production wallets, no production state, and no production historical data in the pre-envelope (Avalanche-era) stack. On the current Besu deployment (`chainId 1337`), the deprecated tables are expected to be **empty** unless the envelope contracts happen to emit the old legacy event signatures.

Therefore the real question is **not** "how do we rescue at-risk historical data?" It is:

> **Should we retire the deprecated tables/handlers entirely, or preserve them as a forward-looking archival mechanism in case a legacy chain is ever indexed or decommissioned?**

---

## 2. Archive Schema Design

If legacy rows ever needed to be preserved (e.g., a pre-Besu chain is indexed and later decommissioned), the following patterns are available.

### 2.1 Option A — Dedicated archive table(s) inside Ponder schema

Add new Ponder schema table(s) such as `legacyLockedTransferEvent` / `legacyCambioEvent` (or a unified `legacyEventArchive` with a discriminator column).

| Aspect | Detail |
|---|---|
| **Population** | One-time copy from deprecated table, or dual-write via handler |
| **Survives reindex?** | **No** — unless the source events + handlers remain registered. If the source chain is decommissioned, the table would empty on next reindex. |
| **Pros** | Simple querying via Ponder GraphQL; same connection pool; no external infra. |
| **Cons** | False safety — appears persistent but is destroyed on reindex if source events disappear; adds schema clutter. |

### 2.2 Option B — Read-only VIEW over existing deprecated tables

Create a Postgres VIEW (e.g., `legacy_locked_transfer_event_v`) that selects from the current deprecated table with no data movement.

| Aspect | Detail |
|---|---|
| **Population** | Zero-copy; view definition only |
| **Survives reindex?** | No — the underlying table is still managed by Ponder. If the table is removed from `ponder.schema.ts`, Ponder drops it on next migration. |
| **Pros** | Zero storage overhead; no migration script; explicit naming convention signals archive intent. |
| **Cons** | Provides no actual durability beyond the underlying table; if the underlying table is dropped, the view breaks. |

### 2.3 Option C — Leave deprecated tables in place as-is (frozen)

Retain `lockedTransferEvent` and `cambioEvent` in `ponder.schema.ts`, remove (or no-op) their handlers, and treat the tables as frozen.

| Aspect | Detail |
|---|---|
| **Population** | Whatever was written before handler removal; no new writes |
| **Survives reindex?** | **No** — if handlers are removed and events are dropped from the ABI, Ponder will recreate the tables as empty on reindex. |
| **Pros** | Minimal change; no new objects; preserves exact current schema. |
| **Cons** | Gives the illusion of persistence; empty tables after reindex; stale schema definitions linger. |

### 2.4 Option D — External archival schema (outside Ponder)

Create a separate Postgres schema (e.g., `archive`) or an entirely separate database instance. Populate it via a one-time `pg_dump` / `INSERT ... SELECT` / `COPY` from the deprecated tables, then remove the tables from Ponder.

| Aspect | Detail |
|---|---|
| **Population** | One-time physical export |
| **Survives reindex?** | **Yes** — Ponder never touches this schema. |
| **Pros** | True persistence independent of Ponder’s rebuild cycle; can survive ABI changes, handler removal, and chain decommissioning. |
| **Cons** | Extra operational surface (backups, access control, connection string); queries require separate connection or schema-qualified names; not exposed via Ponder GraphQL. |

### 2.5 Recommended framing (for decision)

Because Ponder’s rebuild semantics make in-Ponder archiving an illusion of safety, **any archive that must survive reindex or chain decommissioning must live outside Ponder’s control** (Option D). Options A–C are acceptable only if the archive is understood to be a convenience layer for data whose source is still fully re-derivable.

---

## 3. Migration Strategy

### 3.1 If the source chain + events still exist

**Prefer re-derivation over copying.** If the legacy chain is still online and the events are still in the ABI, the canonical archive strategy is to keep the handlers registered and let Ponder rebuild the tables on demand. No physical migration is necessary.

### 3.2 If the source chain is being decommissioned

**Physical export is required.** Before the chain goes offline:

1. Halt the indexer (or pause ingestion).
2. Export the deprecated tables to the external archive target:
   ```sql
   -- Illustrative only
   CREATE SCHEMA IF NOT EXISTS archive;
   CREATE TABLE archive.legacy_locked_transfer_event AS
     SELECT * FROM public.locked_transfer_event;
   CREATE TABLE archive.legacy_cambio_event AS
     SELECT * FROM public.cambio_event;
   ```
3. Verify row counts and checksums.
4. Optionally dump to durable storage (S3-compatible object store, tape, etc.).
5. Only then remove the deprecated tables/handlers from Ponder.

### 3.3 If legacy was never deployed (current state)

**No-op freeze is sufficient today.** Because there is no legacy production data to preserve, any migration script would operate on empty tables. The migration step can be deferred until there is actual data to archive.

---

## 4. Retention Policy & Access Controls

### 4.1 Regulatory / audit basis

The T3 framework operates on a permissioned Hyperledger Besu QBFT consortium. Member banks are regulated entities. Potential retention drivers:

| Driver | Implication |
|---|---|
| AML/KYC audit trail | Transfer records may need to be retained for 5–7 years (jurisdiction-dependent). |
| Interbank settlement records | Finalized envelope and Cambio note records may need multi-year retention for dispute resolution. |
| Smart contract upgrade history | On-chain events themselves are immutable; the indexer is merely a convenience view. |

**Key point:** The blockchain is the source of truth. The indexer is a secondary projection. Regulatory retention is ultimately satisfied by the chain’s own immutability plus any node-level archiving, not solely by the indexer database.

### 4.2 Access controls

| Layer | Control |
|---|---|
| Ponder GraphQL | Exposes whatever tables are in the schema. Removing deprecated tables from the schema removes them from the GraphQL surface. |
| Postgres direct | Role-based access; `archive` schema can be restricted to `readonly_archive` role. |
| Application layer | API gateways / admin UI should gate archive queries behind `ADMIN_ROLE` or compliance-officer roles. |

### 4.3 Permissioned-chain implications

Because Besu is a consortium chain, not a public permissionless network:
- There is no "public" that needs read access to legacy events.
- Archive access should be limited to the operator node, member bank audit terminals, and compliance tooling.
- If a member bank exits the consortium, their historical data access may be governed by the consortium operating agreement, not by on-chain permissions.

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Data loss during archive export** | Low | Medium | Validate row counts + checksums; test restore procedure on a staging copy. |
| **Re-derivation safety net unavailable** | Low (only if chain decommissioned) | High | The Besu chain is currently local/devnet; if promoted to production, node-level backups + chain data replication are the true safety net. |
| **Legacy never deployed → nothing to archive** | **Confirmed fact** | N/A | Lowers urgency to zero for the current deployment. Archive strategy can be a forward-looking placeholder. |
| **Stale handlers silently populate deprecated tables** | Unknown | Low | If the envelope contracts still emit `LockedTransferCreated` etc., the deprecated handlers will write rows. This creates confusion ("why is a deprecated table growing?"). Monitor or remove handlers. |
| **Operational complexity of removing handlers** | Low | Low | Requires a schema + handler PR, CI validation, and a full reindex test to ensure no downstream query breaks. |
| **Regulatory examiner asks for legacy data** | Low (no legacy prod data exists) | Medium | Document the "never deployed" fact in the compliance runbook; point examiner to envelope-mode tables for all production activity. |

---

## 6. Open Decision Points for Jesse

> **Do NOT implement any of these decisions autonomously.** Each requires explicit product-owner sign-off.

| ID | Decision | Options | Default / Recommendation |
|---|---|---|---|
| **G-1** | **Is an archive needed NOW, or is this a forward-looking placeholder?** | (a) Archive now (even though legacy was never deployed).<br>(b) Defer archive until a legacy chain with real data is indexed or decommissioned.<br>(c) Close this wave with no action and reopen if the need arises. | **(b) or (c)** — the absence of legacy production data makes immediate archiving unnecessary. |
| **G-2** | **Should stale deprecated handlers in `src/index.ts` be removed or left as no-ops?** | (a) **Remove handlers + drop legacy events from ABI** — cleanest; deprecated tables will empty on next reindex.<br>(b) **Leave handlers as-is** — harmless if legacy events are never emitted; confusing if they are.<br>(c) **Comment out / guard with feature flag** — preserves code for reference without active execution. | **(a)** if we accept empty tables on reindex;<br>**(b)** if there is any chance legacy events are still emitted by envelope contracts. |
| **G-3** | **Physical copy vs. read-only view vs. frozen-in-place?** | (a) **External archival schema** (Option D) — true persistence.<br>(b) **In-Ponder frozen tables** (Option C) — simplest, but illusory durability.<br>(c) **Postgres VIEW** (Option B) — zero copy, but breaks if underlying table is dropped.<br>(d) **No schema object at all** — rely on chain re-derivation exclusively. | **(a)** if we ever have real legacy data on a decommissioned chain;<br>**(d)** if we never index a legacy chain. |
| **G-4** | **Retention duration and regulatory basis?** | (a) Align with bank consortium agreement (e.g., 7 years).<br>(b) Align with specific jurisdictional AML rule (e.g., 5 years).<br>(c) No fixed retention; retain until chain is decommissioned + 1 year.<br>(d) N/A — no legacy data exists. | **Requires BA / compliance input.** |
| **G-5** | **Where should archived data physically live?** | (a) **Same Postgres, separate `archive` schema** — easiest to query; co-located with indexer.<br>(b) **Separate Postgres instance / read replica** — isolates archive from indexer performance.<br>(c) **Object storage (S3)** — cheapest long-term; requires export to Parquet/CSV/JSON.<br>(d) **In-Ponder only** — acceptable only if source chain is forever online. | **(a)** for operational simplicity;<br>**(c)** if cost-optimized cold storage is preferred. |

### 6.1 Cross-decision dependency map

```
G-1 (Need now?)
  ├─ YES → G-3 must be resolved (how to archive)
  │         └─ G-3 = external copy → G-5 must be resolved (where)
  │         └─ G-3 = in-Ponder → G-2 must be resolved (keep handlers?)
  └─ NO  → G-2 can still be resolved independently (cleanup vs. status quo)
            └─ If handlers removed → G-4 may still be needed for compliance runbook language
```

---

## 7. BA Approval Checklist

Before **any** implementation PR is opened for Wave G, the Business Analyst must sign off on **all** of the following:

- [ ] **G-1 Resolved:** Confirmed whether immediate archiving is required or deferred.
- [ ] **G-2 Resolved:** Confirmed whether deprecated handlers are removed, retained, or feature-flagged.
- [ ] **G-3 Resolved:** Archive pattern selected (external schema, in-Ponder, view, or none).
- [ ] **G-4 Resolved:** Retention duration specified with regulatory citation (or explicit "N/A" acknowledged).
- [ ] **G-5 Resolved:** Physical archive location specified (Postgres schema, separate DB, object storage, etc.).
- [ ] **Compliance review:** If retention > 0 years, confirm that the archive location meets audit-trail requirements (immutability, access logging, chain-of-custody).
- [ ] **Ops review:** If external archive selected, confirm backup/restore procedure and connection string / credential rotation plan.
- [ ] **Engineering review:** Confirm that the chosen option does not break the Ponder reindex flow or downstream GraphQL consumers.
- [ ] **Dependency check:** Confirm whether the envelope-mode contracts emit any of the legacy event signatures (`LockedTransferCreated`, `CambioNoteCreated`, etc.). If yes, assess whether those events represent "legacy" or "reused" semantics before removing handlers.

---

## Appendix A — Current Handler Inventory (for reference)

The following handlers in `indexer/src/index.ts` write to deprecated tables as of 2026-06-06:

**`lockedTransferEvent`**
- `T3Diamond:LockedTransferCreated`
- `T3Diamond:LockedTransferReleased`
- `T3Diamond:LockedTransferCancelled`

**`cambioEvent`**
- `T3Diamond:CambioNoteCreated`
- `T3Diamond:CambioNoteRedeemed`
- `T3Diamond:CambioNoteCancelled`
- `T3Diamond:CambioConfigUpdated`

Their envelope-mode successors (`DirectTransferExecuted`, `CambioEnvelopeNoteCreated/Redeemed/Cancelled`, `CommitCleared/CommitCancelled`, `IssuerRegistered`, etc.) write to the new tables and are **not** affected by this archive design.

---

## Appendix B — Ponder Reindex Behavior Reference

Ponder’s `onchainTable` definitions are converted to SQL migrations. When Ponder starts (or restarts with a schema change), it:

1. Reads `ponder.schema.ts`.
2. Compares against the current database schema.
3. Creates missing tables, alters columns where safe, and **drops tables that are no longer defined** (configurable via migration settings, but default behavior is destructive).
4. Replays all registered event handlers from `startBlock` to chain head.

Therefore, removing `lockedTransferEvent` and `cambioEvent` from `ponder.schema.ts` without a physical export will cause the data in those tables to be lost on the next reindex. The only protection is an external archive.
