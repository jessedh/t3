# Wave 8F — FDIC 12 CFR 370 Reporting Endpoint (indexer-derived) — Design Spec

**Status:** DRAFT (panel-revised 2026-06-25 — folds correctness + regulatory GO-WITH-FIXES findings)
**Date:** 2026-06-24 (revised 2026-06-25)
**Depends on:** Wave 8E-2 (DepositorIdentity promotion + CIP attestation) — MERGED `c02dfe58`
**Counsel gate:** G9 (BSA/CIP + DepositorIdentity model) — PENDING; this endpoint is exam-support
metadata only, makes no representation of insurance-calculation completeness, and is **format DRAFT**.

---

## 0. Panel revisions folded (2026-06-25)

Two Claude sub-agent panels (correctness + regulatory) returned GO-WITH-FIXES. A third-pass codex
spec-verification also returned GO-WITH-FIXES and surfaced four additional fixes, folded here:

- **HIGH (codex #3):** `supersededBy` was under-modeled as one-predecessor. `emergencySaltCompromise`
  expires EVERY active epoch and `rotateSalt`+window leaves predecessors active, so the override must
  attribute every concurrently-active epoch to the emergency's `newEpochId` (see §5 derivation rule).
- **MEDIUM (codex #6):** empty-state was self-contradictory — a per-bank `lastUpdated: null` row is
  unrealizable because a bank row is only emitted when it has hash events. Clarified in §5: per-bank
  `lastUpdated` is **always present** for emitted rows; the realizable empty state is "no row," and
  scalar `currentSaltEpoch` is the only top-level field that can be `null`.
- **LOW (codex #1):** `institutionLiabilityTotals` cut rationale corrected — partial institution-linked
  data does exist (`screeningEvent.wallet`+`institutionId` on SCOPED events; an unused `customer.bankId`);
  what is genuinely missing is any indexed balance/holding/outstanding-supply source (see §3).
- **LOW (codex #5):** `?bank=` scope clarified — it narrows only `depositorPopulation` +
  `crossBankConflicts`; `saltEpochLineage` is global and `cipCoverage` is keyed by custodian (see §4).

The two Claude panels' original folds:

- **BLOCKER-1 (correctness):** CUT `institutionLiabilityTotals` — the genuinely missing piece is any
  indexed **balance / holding / outstanding-supply** source; there is no such table and no SUM in
  `banking.ts`. (Partial institution-linked data does exist — `screeningEvent.wallet`+`institutionId`
  on SCOPED events and an unused `customer.bankId` — so the blocker is the absent dollar/quantity source,
  not a total absence of wallet→institution linkage.) Building it would break the "no schema change /
  indexer-derived only" guarantee. It was only "denominator context," not load-bearing. **Removed from
  scope** (see §3).
- **BLOCKER-2 + HIGH (correctness):** `activeHashCount` is NOT epoch-attributable — the four hash
  events carry no `epochId` (`indexer/src/index.ts:988-1030`). Redefined as **all-time net per bank**;
  removed the "current epoch" framing and the `?epochId` filter for hash counts.
- **HIGH (correctness):** `ConflictDetected` carries no `epochId` (`index.ts:1032-1042`). Removed
  `epochId` from the `crossBankConflicts` row shape. Added `underflowDetected` flag so clamp-at-0 does
  not silently mask a remove>submit accounting anomaly during an exam.
- **MEDIUM (correctness):** `supersededBy` cannot come from `SaltEpochExpired` (no `newEpochId` there;
  only `EmergencySaltCompromise` carries it, `index.ts:1073`). Lineage is stitched by ordering
  `SaltEpochCreated.epochId`. Empty-state semantics for scalar fields defined in §5.
- **HIGH-1 (regulatory):** added a second top-level `regulatoryNotice` field; both it and `disclaimer`
  are required by acceptance.
- **MEDIUM-1 (regulatory):** `crossBankConflicts[].tinHash` is the exact correlation artifact
  inference-avoidance suppresses → the endpoint must not be callable by ordinary consortium members.
  **Verified mechanism (no contract change):** `compliance.ts` already gates every `/compliance/*` route
  via `authMiddleware` (`compliance.ts:27-116`) — signed request + on-chain `hasRole(COMPLIANCE_ROLE ||
  COMPLIANCE_OFFICER_ROLE)`. `/compliance/fdic-370` inherits this gate automatically. Because the
  `tinHash` rows are correlation-sensitive, the handler additionally **requires the more privileged
  `COMPLIANCE_OFFICER_ROLE`** (an indexer-only check, no new on-chain role). The panel's `FDIC_EXAM_ROLE`
  was a placeholder — provisioning a new on-chain role would violate 8F's no-contract-change guarantee.
- **MEDIUM-2 (regulatory):** `saltEpochLineage.saltHash` is **hash-of-salt**, never raw salt
  (raw salt would enable full inference-attack bypass). Pre-build verification checkpoint added (§6).
- **LOW-1 (regulatory):** G9 amended to explicitly cover read-only reporting endpoints that surface
  DepositorIdentity cross-bank conflict (`tinHash`) data (§6 doc remediation).

---

## 1. What 12 CFR 370 actually requires (and why ~90% is off-chain)

FDIC 12 CFR 370 obliges a covered insured depository institution (≥2M deposit accounts) to be able to
**calculate deposit-insurance coverage per depositor, per ownership-rights-and-capacity category, within
24 hours** of failure, and to maintain the recordkeeping to support it. For a reciprocal/pass-through
deposit network the hard part is **cross-bank beneficial-owner de-duplication** so the same beneficial
owner is not double-insured across member banks.

**Why the chain cannot produce the insurance calculation.** The T3 on-chain DepositorIdentity layer is
**boolean/hash-only by deliberate design** (ADR-004 + inference-attack avoidance):
- The TIN hash bakes in the 7 FDIC ownership categories (to prevent cross-category false positives) but
  **never emits the category separately** — you cannot read "how much is in the joint-account category."
- **Capacity / per-owner insurable balances are kept off-chain entirely.** Putting per-owner per-category
  dollar amounts on a shared permissioned ledger would let colluding members infer customer wealth.
- On-chain wallet balances are **not linkable to TIN hashes** on-chain (a wallet is not a TIN).

Therefore the actual 370 insurance determination is the **bank's off-chain responsibility**. What the chain
*does* provide, and what 8F surfaces, is the **recordkeeping metadata + cross-bank conflict evidence** that
supports and audits that off-chain process.

## 2. Scope — what 8F builds

A single read-only indexer endpoint `GET /compliance/fdic-370`, **indexer-derived only**, no new contract
code, no manifest change, no schema change. It aggregates already-indexed 8E-2 events into an exam-support
view. **The endpoint is access-restricted** (see §4) because it surfaces the `tinHash` correlation artifact.

1. **Depositor population per bank** — **all-time net** count of active depositor hashes per bank (from
   `depositorIdentityEvent` Hash{Submitted,Removed,BatchSubmitted,BatchRemoved}). NOT per-epoch (the hash
   events carry no `epochId`).
2. **Cross-bank conflict evidence** — `ConflictDetected` rows (beneficial-owner overlaps across member
   banks) — the de-duplication audit trail. No `epochId` (the event does not carry one).
3. **Salt-epoch lineage** — epoch create/expire/emergency-compromise events stitched into a supersession
   chain, so an examiner can confirm which salt regime was in force over time (reproducibility context).
4. **CIP coverage summary** (cross-link to 8E-2) — count of wallets with a recorded CIP attestation per
   custodian, since CIP completeness is an exam-adjacent recordkeeping signal.

Every numeric field is a **count** — never a per-owner, per-category, or dollar breakdown. The response
carries top-level `disclaimer` + `regulatoryNotice` + `formatVersion: "DRAFT"` + `counselGate: "G9"`.

## 3. Out of scope (explicit)

- **`institutionLiabilityTotals` / per-institution token totals — CUT** (BLOCKER-1: no indexed
  balance/holding/outstanding-supply source exists; building it would violate the no-schema-change
  guarantee and is not load-bearing for exam support).
- Per-beneficial-owner or per-category insurable-balance calculation (off-chain, bank responsibility).
- Any representation that the network is 370-compliant or that coverage is correctly computed.
- New on-chain events, new facets, manifest changes, or any category/capacity exposure on chain.
- Per-epoch `activeHashCount` and any `?epochId` filter on hash counts (BLOCKER-2: hash events carry no
  epoch dimension).
- The alternate-recordkeeping file format / DIF submission format (the FDIC's prescribed output) — 8F is
  internal exam-support, format DRAFT.

## 4. Endpoint contract

`GET /compliance/fdic-370` — **access-restricted**. Inherits the existing `/compliance/*` `authMiddleware`
(signed request + on-chain `hasRole`, `compliance.ts:27-116`) and additionally requires the more
privileged `COMPLIANCE_OFFICER_ROLE` (not merely `COMPLIANCE_ROLE`) because it surfaces the
correlation-sensitive `tinHash` rows. No new on-chain role — indexer-only tightening. Optional
`?bank=<address>` filter (lowercased) — **scoped to `depositorPopulation` + `crossBankConflicts` only**;
`saltEpochLineage` is network-global (salt epochs are not per-bank) and `cipCoverage` is keyed by
`custodian` (not bank), so both are unaffected by `?bank=`. **No `?epochId` filter** (hash counts are not
epoch-attributable).

```jsonc
{
  "formatVersion": "DRAFT",
  "counselGate": "G9",
  "disclaimer": "Exam-support metadata only. Per-depositor/per-category insurance determination is the bank's off-chain responsibility. On-chain DepositorIdentity is boolean/hash-only by design (inference-attack avoidance); this endpoint makes NO representation of 12 CFR 370 compliance or insurance-calculation completeness.",
  "regulatoryNotice": "THIS OUTPUT IS NOT A 12 CFR 370 DETERMINATION. It contains recordkeeping metadata and cross-bank de-duplication evidence only. It does not compute, assert, or imply deposit-insurance coverage for any depositor. Cross-bank conflict (tinHash) rows are correlation-sensitive and access-restricted.",
  "generatedAt": 1750000000,
  "currentSaltEpoch": 3,
  "depositorPopulation": [ { "bank": "0x..", "activeHashCount": 1234, "underflowDetected": false, "lastUpdated": 1749 } ],
  "crossBankConflicts": [ { "bank": "0x..", "counterpartyBank": "0x..", "tinHash": "0x..", "detectedAt": 1749 } ],
  "saltEpochLineage": [ { "epochId": 3, "saltHash": "0x..", "activatedAt": 1749, "expiredAt": null, "supersededBy": null } ],
  "cipCoverage": [ { "custodian": "0x..", "walletsWithCip": 42 } ]
}
```

Notes:
- `saltEpochLineage[].saltHash` is the **hash-of-salt** emitted by `SaltEpochCreated` — never the raw salt.
- All amounts/counts that could exceed JS safe-int are strings (bigint-safe), mirroring existing
  `compliance.ts` conventions. Counts here are small integers; keep them numeric unless a parity test shows
  otherwise.

## 5. Implementation surface

- `indexer/src/api/compliance.ts` — add the `fdic-370` handler (follow the existing `/compliance/cip`,
  `/compliance/screening`, `/compliance/travel-rule` patterns; same router, same response helpers). The
  shared `authMiddleware` (line 116, `app.use("/compliance/*", ...)`) already gates the route; inside the
  handler additionally reject callers lacking `COMPLIANCE_OFFICER_ROLE` (403) before returning any
  `tinHash` data.
- Reads existing tables only: `depositorIdentityEvent`, `cipEvent`. **No `ponder.schema.ts` change.**
- Derivation rules:
  - **activeHashCount** = (Submitted + Σ BatchSubmitted.count) − (Removed + Σ BatchRemoved.count) per
    `bank`, **all-time** (no epoch dimension — the events carry none). Clamp at 0; if the pre-clamp value
    is negative, set `underflowDetected: true` for that bank (exam-support signal; do not hide the anomaly).
  - **depositorPopulation[].lastUpdated** = MAX(`timestamp`) across that bank's four hash event types.
    Always present on an emitted row: a bank row is produced ONLY when the bank has at least one hash
    event, so the "no hash events" case yields no row at all (not a row with `lastUpdated: null`).
  - **crossBankConflicts** = `ConflictDetected` rows (`bank` = checkingBank, `counterpartyBank` =
    conflictBank, `tinHash`, `detectedAt` = `timestamp`). No `epochId`.
  - **saltEpochLineage** = one row per `SaltEpochCreated` (`epochId`, `saltHash`, `activatedAt`).
    `expiredAt` = matching `SaltEpochExpired.expiredAt` for that `epochId` (else `null`). `supersededBy`
    is stitched by ordering epochs by `epochId`. **Default rule:** the next-higher `epochId` that exists.
    **Emergency override (overlap-aware):** `emergencySaltCompromise` expires EVERY epoch that is active at
    the compromise moment — not one singular predecessor — and replaces them all with a single new epoch
    (`DepositorIdentityFacet.sol:289-318` loops `for i in 1..currentEpoch` emitting `SaltEpochExpired(i)`
    for each active epoch, then emits one `EmergencySaltCompromise(newEpoch)` + `SaltEpochCreated(newEpoch)`).
    Because `rotateSalt` with a non-zero transition window leaves the predecessor ACTIVE during the window
    (`DepositorIdentityFacet.sol:243-263` — sets a future `expiresAt`, emits NO `SaltEpochExpired`), multiple
    epochs can be concurrently active when an emergency fires. Therefore: for each `EmergencySaltCompromise`
    (processed earliest-first; earliest emergency wins), set `supersededBy = newEpochId` for EVERY epoch with
    `epochId < newEpochId` that was active at `emergency.timestamp` (i.e. `activatedAt <= ts` and
    `expiredAt == null || expiredAt >= ts`). Do NOT read `supersededBy`/`newEpochId` off `SaltEpochExpired`
    (it carries neither).
  - **currentSaltEpoch** = MAX(`SaltEpochCreated.epochId`); `null` if no epoch has ever been created.
  - **cipCoverage** = per `custodian`, count of distinct `wallet` whose latest `cipEvent` is `Recorded`
    (a later `Revoked` removes the wallet from the count).
- **Empty-state:** every array returns `[]` (never `null`); `currentSaltEpoch` is the only top-level
  scalar that returns `null` (when no epoch has ever been created). Per-bank `lastUpdated` is NOT a
  nullable empty-state field — it is always present on the rows that exist, because zero-event banks
  produce no row. `generatedAt` is always present.
- Tests: `indexer/` test file mirroring the existing compliance-endpoint tests — assert `disclaimer` +
  `regulatoryNotice` + `formatVersion` present; access-gate rejects an unauthorized caller; counts derive
  correctly from a seeded event set (including a `underflowDetected` case and a `Revoked`-after-`Recorded`
  CIP case); empty-state returns empty arrays + null scalars (not nulls inside arrays).

## 6. Verification / gate

Standing Wave 8 workflow:
1. Design panel (this spec): regulatory + correctness Claude sub-agents (NO codex). **DONE — both
   GO-WITH-FIXES; all BLOCKER/HIGH folded above.**
2. **Pre-build verification checkpoint (MEDIUM-2):** confirm `SaltEpochCreated.saltHash` is a hash of the
   salt, not the raw salt, before surfacing it (`contracts/interfaces/IDepositorIdentity.sol` +
   `index.ts:1044-1055`). If raw salt is ever emitted, do NOT surface it.
3. kimi-code build (`--yolo --afk`), TDD per-task-commit on branch `wave/8f-fdic-370`.
4. Multi-SME panel (security/regulatory/correctness Claude sub-agents). FIX-FIRST BLOCKER/HIGH.
5. doc-staleness-audit (verify-against-code) + remediation: COMPLIANCE-MATRIX (FDIC 370 row → endpoint
   wired, DRAFT), REGULATORY-STATUS (§4 FDIC bullet → reporting endpoint present, DRAFT, G9),
   KNOWN-ISSUES (370 endpoint is metadata-only, not an insurance calc; `institutionLiabilityTotals`
   deliberately not built), COUNSEL-GATES (G9 amended to explicitly cover read-only reporting endpoints
   that surface DepositorIdentity cross-bank `tinHash` data — LOW-1).
6. 6-checkpoint Phase Transition Gate (compile clean — indexer typecheck; npm test 0-fail; selector +
   ABI parity unchanged since no contract change; clean deploy; written review; plan + memory update).
7. Merge to main, delete branch.

**Acceptance:** endpoint returns the documented shape with BOTH `disclaimer` and `regulatoryNotice`; the
access gate rejects unauthorized callers; counts derive correctly (incl. `underflowDetected` and CIP
revoke); empty-state returns empty arrays + null scalars; indexer typecheck + tests green; no
contract/manifest/ABI change; FDIC 370 row in COMPLIANCE-MATRIX moves from NOT-BUILT(reporting) →
REPORTING (DRAFT, G9). On-chain remains boolean/hash-only (no category or capacity exposure introduced);
`institutionLiabilityTotals` is NOT built.
