# Settlement Reconciliation Spec (Wave 6C)

**Status:** preview (gates OFF). Implementation: `keeper/src/reconcile.js` + `keeper/src/settlement-math.js`.
Tooling: `cd keeper && npm run cli reconcile [cycleId]` (exit 0 = ok, non-zero = drift/breach).

## Purpose
Cross-check the **indexer-derived** view of a settlement cycle against **on-chain** state, so drift
between the chain and the off-chain system of record is caught before it propagates (e.g. before the
keeper commits an obligation root, or before an operator trusts a dashboard). It doubles as an
indexer-correctness check and a reserve-solvency check.

## Data sources
- **Indexer (Wave 6A)** `/banking/settlement-obligations` — the obligation rows
  (`obligationId`, `outgoingIssuer`, `receivingIssuer`, `amount`). The on-chain
  `SettlementObligationRecorded` event is thin (no `cycleId`), so each obligation is enriched via
  `getSettlementObligation(obligationId)` to recover `cycleId` and to cross-check issuers/amount.
- **On-chain getters:** `getPairNet`, `getCycleLien`, `getCurrentCycleId`,
  `getReimbursementEncumbered` + `getAvailableReserve` (added in Wave 6C),
  `getEffectiveReserve`, `getSettlementCycle`.

> **Pair enumeration:** the facet has no `getCycleIssuers` / `getCyclePairs`. The reconciler
> discovers the participating issuers/pairs **from the indexer obligations**; if the indexer is
> missing an obligation the chain has, invariant 1/2 will surface it as drift.

## Load-bearing precondition
The contract enforces **one cycle in flight** (`CycleAlreadyActive`, `SettlementCycleFacet.sol:56`).
`reimbursementEncumbered[bank]` is therefore attributable to the single active (or failed-but-unacked)
cycle. **Invariant 4a is only valid under this precondition.**

## Invariants
1. **pair-net:** `getPairNet(cycleId,a,b)` == indexer-derived signed bilateral net (positive = `a` owes `b`).
2. **cycle-lien:** `getCycleLien(cycleId,bank)` == derived bilateral-net debit (`Σ max(0, bank's net per pair)`).
3. **liveness:** `getCurrentCycleId() != 0` while `isSettlementModelActive()`.
4. **(a) lien↔encumbrance:** `Σ getCycleLien(cycle,bank) == getReimbursementEncumbered(bank)` (single-cycle precondition).
   **(b) solvency:** `getReimbursementEncumbered(bank) <= getEffectiveReserve(bank)` (i.e. `getAvailableReserve(bank)` not masking a breach).
5. **indexer↔chain consistency:** each indexed obligation's issuers/amount match `getSettlementObligation`.
6. **failed-cycle lien preservation:** a `FAILED` cycle must retain its liens (ADR-003: failure
   preserves the secured bilateral-net reimbursement obligation; `markFailed` does NOT release liens).

`drift` (used by the keeper to abort a rollover) is raised by any failure of invariants 1, 2, or 5.

## Not yet covered (documented limitations)
- **Conservation-of-obligations across substitution** (every recorded obligation resolves to a
  finalized cross-institution envelope, none stuck in escrow past `confirmationDeadline`). The
  `EncumbranceExceedsReserve` revert path (`ReserveControlLib.sol:110`) means a finalize can revert
  and strand a customer envelope; detecting the stranded envelope requires joining
  `obligation.sourceTransferId` to envelope state. Deferred — needs an envelope-by-sourceTransferId
  index. Tracked in KNOWN-ISSUES.
- **Per-cycle encumbrance breakdown.** `reimbursementEncumbered` is a flat per-issuer counter; the
  single-cycle precondition is what makes 4a/6 checkable. Multi-cycle settlement (future) needs a
  per-cycle encumbrance tag.

## Validation
- Pure math unit tests: `keeper/test/settlement-math.test.js`.
- On-chain parity: `test/integration/SettlementReconciliation.test.js` proves
  `deriveNets`/`deriveLiens` reproduce `getPairNet`/`getCycleLien` and that
  `getReimbursementEncumbered`/`getAvailableReserve` satisfy 4a/4b against a seeded cycle.
