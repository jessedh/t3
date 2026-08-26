# Wave 6A / 6B / 6C / 7 — FINAL Plan (council-validated)

**Date:** 2026-06-18 · **Basis:** `main` @ `f66543e6` · **Status:** ✅ COMPLETE — all waves merged to `main`.

> **Completion (2026-06-18):** 6A `4344e6fe`, 6B/6C `3793b4d7`, 7 `8497174c`. Gates green at each
> step (contracts 1152 passing/0 failing, ABI 323/35, selector + storage-layout clean; indexer 37
> tests; keeper 10 node:tests; UI tsc + build clean). Both feature gates remain OFF (preview).

Council: Claude orchestrator (draft) + `diamond-banking-code-reviewer` (settlement-risk) + kimi-code
(adversarial, independent code-tree pass). Both reviews converged; the raw private review artifacts
are not included in this release.

> Standing constraints: both gates ship OFF (`capacityModelActive`, `settlementModelActive`);
> counsel-pending preview; Phase Transition Gate per wave (test 0-fail, compile,
> selector-collision + ABI-parity + storage-layout + clean deploy, review, docs).

## Council verdicts
| Wave | Verdict | Net |
|---|---|---|
| 6A | GO-WITH-FIXES | **DONE** (commit `4344e6fe`): IssuanceReservationReleased + SettlementObligationRecorded indexed, obligations endpoint, +3 tests (37 pass), parity 321/35 |
| 6B keeper | GO-WITH-FIXES | build `keeper/` service with the safety fixes below |
| 6C reconcile | REWORK → corrected spec below | needs 1 read-only contract getter + reconciler |
| 7 UI | GO-WITH-FIXES | settlement ABI + read-first monitor page |

## Key code facts established (verified, not assumed)
- `obligationRoot` is **operator-opaque**: stored on propose, never recomputed/validated on-chain;
  `finalize` checks `pairFunded`, not the root (`SettlementFundingLib`). Keeper needs only a
  deterministic ordered hash; members confirm off-chain against it.
- `CycleAlreadyActive` (`SettlementCycleFacet.sol:56`) enforces **one cycle in flight** — a
  load-bearing precondition for failed-cycle lien reconciliation.
- Lien encumbrance is wired to `ReserveControlStorage.reimbursementEncumbered`, NOT to
  `getEffectiveReserve`. `encumberForReimbursement` reverts `EncumbranceExceedsReserve` if
  `reimbursementEncumbered + amount > effectiveReserve` (`ReserveControlLib.sol:106-114`) — a
  cross-institution finalize can therefore REVERT, leaving the customer envelope in escrow.
- `availableReserve = max(0, effectiveReserve - reimbursementEncumbered)` exists
  (`ReserveControlLib.sol:49-53`) but is **not exposed** on any facet.
- `SettlementObligationRecorded(obligationId, outgoingIssuer, receivingIssuer, amount)` is **thin**
  (no cycleId/sourceTransferId) → reconciler enriches via `getSettlementObligation(obligationId)`.

---

## Wave 6C — reconciliation (corrected; do first because of the contract getter)

### 6C.1 contract: expose the solvency inputs (read-only views → full gate + diamond-banking review)
Add to `MultiAssetVaultFacet` + `IMultiAssetVault`:
- `getReimbursementEncumbered(address issuer) returns (uint256)`
- `getAvailableReserve(address issuer) returns (uint256)` (wraps `ReserveControlLib.availableReserve`)

Read-only, no storage change → storage-layout gate unaffected; regenerate indexer + UI ABI; parity.

### 6C.2 reconciler (`keeper/src/reconcile.ts`, shared package with 6B)
Invariants per cycle (pairs/banks enumerated from indexer obligations; cycle assoc via on-chain
`getSettlementObligation`):
1. `getPairNet(cycleId,a,b)` == indexer-derived signed bilateral net for the pair.
2. `getCycleLien(cycleId,bank)` == max bilateral net debit for bank derived from indexer.
3. `getCurrentCycleId() != 0` while `isSettlementModelActive()` (liveness).
4. **(a)** `Σ getCycleLien(activeCycle,bank) == getReimbursementEncumbered(bank)` (lien↔encumbrance consistency);
   **(b)** `getReimbursementEncumbered(bank) <= effectiveReserve(bank)` i.e. `getAvailableReserve(bank) >= 0` not saturated to mask a breach (solvency).
5. **conservation-of-obligations**: every indexed `SettlementObligationRecorded` resolves (via
   `getSettlementObligation` + indexer envelope state) to a FINALIZED cross-institution envelope;
   none stuck in escrow past `confirmationDeadline` (catches the `EncumbranceExceedsReserve` revert path).
6. **failed-cycle lien conservation**: for a FAILED cycle, liens are NOT released
   (`markFailed` preserves them); assert `Σ getCycleLien(failedCycle,bank)` still matches
   `getReimbursementEncumbered`. **Precondition:** single cycle in flight (`CycleAlreadyActive`).
Outputs: exit code (0/nonzero), JSON + human summary. Document the pair-enumeration dependency
(no on-chain `getCycleIssuers`/`getCyclePairs`).
Tests: pure net/lien math against fixtures; integration vs hardhat deploy with a seeded cycle.
Artifact: `Documentation/envelope_besu/RECONCILIATION-SPEC.md`.

---

## Wave 6B — settlement keeper (`keeper/` Node service, ethers v6)
Implements the loop in `SETTLEMENT-KEEPER-RUNBOOK.md`. **Liveness only**; the trusted Fedwire
attestor (`recordFunding`) and finalize stay human/manual.

MUST-FIX (council):
- **Startup role gate** — refuse to start unless keeper address holds `SETTLEMENT_KEEPER_ROLE`.
- **Double activation gate** — refuse unless `KEEPER_ENABLED=true` AND `isSettlementModelActive()==true`.
- **`currentCycleId==0` handling** — open a new cycle; do NOT call rollover on a null cycle.
- **Loop safety** — every on-chain write in try/catch with exponential backoff + alert; a revert
  must never wedge the loop.
- **Abort-on-drift** — run `reconcile` before each rollover; if invariant 1/2 fails, HALT + alert
  rather than commit a wrong `obligationRoot`.
- **No auto-open after fail** — after `failSettlementCycle`, keeper must NOT open the next cycle;
  requires explicit human (`EMERGENCY_SETTLEMENT_ROLE`) acknowledgement of lien disposition.
- **Deterministic obligation root** — ordered keccak over the cycle's sorted `obligationId`s
  (documented; opaque to contract).
- **Obligation source** — read from the indexer (`/banking/settlement-obligations`), not a 2nd chain scan.
Components: `config.ts`, `chain.ts`, `obligations.ts`, `loop.ts`, `health.ts` (/health: cycle id,
last rollover, lag, recon status), `cli.ts` (manual open/propose/rollover/confirm/fund/finalize/fail/reconcile).
`keeper/package.json`, `.env.example`, `README.md`, vitest units (root + lock). Ships DISABLED.

---

## Wave 7 — settlement ops UI (read-first monitor)
- `ui-management/src/lib/contracts/abis.ts` — add `SETTLEMENT_CYCLE_FACET_ABI` with **exact** facet
  signatures (verified): `getSettlementCycle`→9-field tuple, `getSettlementObligation`→4-field
  struct, `getPairNet`→int256, `getCycleLien`→uint256, `getCurrentCycleId`→bytes32,
  `isSettlementModelActive`→bool; events Opened/Proposed/Confirmed/Funded/Finalized/Failed/
  ObligationRecorded; writes open/propose(AndRollover)/confirm/recordFunding/challenge/finalize/fail.
  `setSettlementModelActive` belongs in an **admin** section, not keeper actions.
- `ui-management/src/app/financial/settlement-cycle/page.tsx` — read monitor (current cycle, state,
  liens, pair nets, `isSettlementModelActive`); write actions present but disabled + NOT-FOR-PRODUCTION
  / "gate is OFF" banner when inactive; **"single attestor active" warning** in the funding panel.
- `domain-config.ts` + Sidebar — add `/financial/settlement-cycle` route + link.
- tsc + build clean. (Health/recon reads from keeper come after 6B/6C deliver endpoints.)

## Decisions (auto-mode defaults; redirectable)
D1 skip IssuanceQuoted (done) · D2 reconcile in `keeper/` pkg · D3 keeper single-writer+lock, HA deferred ·
D4 root + obligations from indexer · D5 keeper automates liveness only · D6 keeper ships DISABLED, double-gated ·
D7 UI write actions guarded when gate OFF · **D8 (new)** add 2 read-only reserve getters (6C.1).

## Out of scope: Wave 8 (KYC lifecycle, AML/CIP/Travel Rule/FDIC 370) — counsel-gated; multilateral-net CCP — future ADR.
