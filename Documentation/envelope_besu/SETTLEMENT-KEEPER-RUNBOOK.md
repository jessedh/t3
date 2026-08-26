# Settlement Keeper Runbook

> Operational guide for the off-chain keeper that drives the interbank settlement
> cycle. Applies only when `settlementModelActive` is enabled (OFF by default; gated
> behind the ADR-003 counsel gates — see [COUNSEL-GATES.md](COUNSEL-GATES.md)).

## Roles

- `SETTLEMENT_KEEPER_ROLE` — opens/proposes/rolls-over/finalizes cycles.
- `SETTLEMENT_ATTESTOR_ROLE` — attests bilateral funding; **must not** be a funding party.
- `CONSORTIUM_MEMBER_ROLE` — member banks confirm their net position.
- `EMERGENCY_SETTLEMENT_ROLE` — fails a cycle (preserves liens per ADR-003).

## Cycle lifecycle

`OPEN → PROPOSED → CONFIRMED → FUNDING → FINALIZED` (or `→ FAILED`).

Cross-bank envelope finalizes record obligations into the **current open** cycle
(`getCurrentCycleId()`). A cycle must always be open during operating hours or those
finalizes revert `NoOpenSettlementCycle` (fail-closed; no fund movement, no lost data).

## Liveness: always use atomic roll-over (E1)

**Steady state:** roll cycles with `proposeAndRolloverSettlementCycle(cycleId,
obligationRoot, confirmationDeadline)`. It proposes the current cycle **and** opens the
next routing cycle in the **same transaction**, so `currentCycleId` is never null
between cycles — there is no blackout window.

```
loop every CYCLE_WINDOW:
  cid  = getCurrentCycleId()
  root = computeObligationRoot(cid)
  nextId = proposeAndRolloverSettlementCycle(cid, root, now + CONFIRM_WINDOW)
  # routing immediately continues on nextId
  drive cid through confirm -> recordFunding -> finalize out-of-band
```

**Do NOT** use the plain `proposeSettlementCycle` in steady state — it clears
`currentCycleId` and opens a blackout window until the next `openSettlementCycle`.
Reserve `proposeSettlementCycle` (no roll-over) for the **final** cycle at planned
shutdown, when no further cross-bank traffic is expected.

**Constraints of roll-over:**
- The next cycle **inherits the proposed cycle's `cycleType`**. To change cycle type
  (e.g. daytime → overnight at EOD), you must use plain `proposeSettlementCycle` +
  `openSettlementCycle(newType)` at a planned boundary, accepting the brief window.
- `proposeAndRolloverSettlementCycle` reverts `CycleNotCurrentRoutingCycle` unless
  `cycleId == getCurrentCycleId()` — you can only roll over the live routing cycle.
- **Same-block ordering:** within one block, an envelope `_settleAmount` that executes
  *before* the rollover tx records into the old cycle; one *after* records into the new
  cycle. Besu QBFT single-proposer ordering is deterministic, but keepers should not
  assume cross-tx atomicity beyond this.

**Bootstrap:** call `openSettlementCycle(cycleType)` once to open the first cycle.
`openSettlementCycle` reverts `CycleAlreadyActive` if one is already open (guard
against orphaning an in-flight cycle).

## Confirm / fund / finalize

1. Members call `confirmSettlementCycle(cycleId)`; at full per-institution quorum the
   cycle flips `PROPOSED → CONFIRMED`.
2. Attestor calls `recordFunding(cycleId, debtor, creditor, asset, amount, paymentRef,
   challengeWindow)` per non-zero bilateral pair. `paymentRef` must be unique
   (replay-protected) and non-zero; attestor ≠ debtor/creditor.
3. After the challenge window with no challenge, keeper calls
   `finalizeSettlementCycle(cycleId)` — releases the bilateral-net liens.
4. Zero-net cycles short-circuit `CONFIRMED → FINALIZED`.

## Failure handling

- A challenge (`challengeSettlementCycle`) within the FUNDING window blocks finalize.
- `EMERGENCY_SETTLEMENT_ROLE` calls `failSettlementCycle(cycleId, exceptionRoot)`:
  the cycle FAILS and **liens are preserved** (the gap becomes the outgoing issuer's
  secured reimbursement obligation — ADR-003). Clearing/reconciling a FAILED cycle is
  a separate reconciliation procedure (Wave 6C).
- **No auto-reopen after a failure.** The keeper daemon HALTS when it observes
  `currentCycleId == 0` following a cycle it last drove that is now `FAILED`; it must
  **not** open the next cycle automatically. A human (`EMERGENCY_SETTLEMENT_ROLE`) must
  acknowledge the failed cycle's lien disposition, then run `npm run cli open` to resume.
  (`failSettlementCycle` is a human-only action and can interrupt a cycle mid-confirmation;
  treat it as a two-person authorization in a regulated context.)

## Implemented keeper (Wave 6B/6C)

Reference implementation: `keeper/` (Node + ethers v6). **Ships DISABLED.** Triple startup gate:
`KEEPER_ENABLED=true`, on-chain `isSettlementModelActive()==true`, and the keeper key holding
`SETTLEMENT_KEEPER_ROLE`. Command surface:

```
npm start                         # rollover daemon (reconcile -> proposeAndRollover; halts on drift/fail)
npm run cli status                # current cycle + settlementModelActive
npm run cli reconcile [cycleId]   # Wave 6C reconciliation (exit 0 ok / non-zero drift) — see RECONCILIATION-SPEC.md
npm run cli open                  # bootstrap / resume after an acknowledged failure
npm run cli confirm|finalize|fail <cycleId>
```

The daemon runs reconciliation **before every rollover** and aborts (does not commit the obligation
root) if drift is detected. Obligation root = deterministic keccak over the cycle's sorted
`obligationId`s (opaque to the contract). Obligation data comes from the Wave 6A indexer
(`/banking/settlement-obligations`), not a second chain scan.

## Finality

Besu QBFT gives deterministic finality at block commit. **Confirmation rule: N = 1**
(one committed block). The keeper MUST treat a committed block as final and MUST NOT
add confirmation depth or reorg delay (ADR-003 Decision 4).

## High availability (production)

- Run the keeper with leader election (single active writer) to avoid double-proposing.
- Monitor: `getCurrentCycleId() != 0` during operating hours; alert on
  `NoOpenSettlementCycle` reverts, stuck FUNDING cycles, and unreleased liens.
- Devnet is N=4 validators (tolerates 1 fault); production targets ≥7 (ADR-003).
