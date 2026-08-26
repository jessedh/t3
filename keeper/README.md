# T3 Settlement Keeper (Wave 6B/6C)

> **Counsel-pending preview component. Ships DISABLED.** Both feature gates are OFF by default in
> the contracts; this keeper refuses to run unless `KEEPER_ENABLED=true` **and** the on-chain
> `settlementModelActive` flag is true. Running it creates no deposit/regulated relationship. See
> `../REGULATORY-STATUS.md` and `../Documentation/envelope_besu/SETTLEMENT-KEEPER-RUNBOOK.md`.

A small Node service (CommonJS + ethers v6) that keeps a bilateral-net settlement cycle open for
liveness, plus a reconciliation CLI. **Liveness only** — it does not make settlement decisions:
member confirmation, Fedwire funding attestation (`recordFunding`), finalize, and fail are deliberately
human/manual (the keeper has no basis to attest that real-world money moved).

## What it does
- **Rollover loop** (`src/loop.js`): every `KEEPER_CYCLE_WINDOW_SEC`, runs reconciliation, then
  calls `proposeAndRolloverSettlementCycle` (atomic — no blackout window). Aborts (HALT) if
  reconciliation finds drift rather than committing a wrong obligation root.
- **Safety:**
  - 3 startup gates: `KEEPER_ENABLED`, on-chain `isSettlementModelActive()`, and the keeper key
    holding `SETTLEMENT_KEEPER_ROLE`.
  - On a failure (`failSettlementCycle`), the keeper **never auto-opens** the next cycle — a human
    (`EMERGENCY_SETTLEMENT_ROLE`) must acknowledge the failed cycle's lien disposition and run
    `npm run cli open` to resume.
  - Every on-chain write is wrapped with exponential backoff; a revert never wedges the loop.
- **Obligation root** (`src/settlement-math.js`): deterministic keccak over the cycle's
  ascending-sorted `obligationId`s. The contract treats the root as an opaque commitment.
- **Health** (`src/health.js`): `GET /health` → cycle id, last action, lag, reconciliation status.

## Setup
```
cp .env.example .env     # fill KEEPER_DIAMOND_ADDRESS, KEEPER_PRIVATE_KEY; set KEEPER_ENABLED only when ready
npm install
npm test                 # pure math + decision-function unit tests (node:test)
```

## Run
```
npm start                # the rollover daemon (refuses unless triple-gated)
npm run cli status       # current cycle + settlementModelActive
npm run cli reconcile [cycleId]   # Wave 6C reconciliation; exit 0 = ok, non-zero = drift/breach
npm run cli open                  # bootstrap / resume after an acknowledged failure
npm run cli confirm <cycleId>     # member confirmation (manual)
npm run cli finalize <cycleId>    # manual, after funding attested out-of-band
npm run cli fail <cycleId> [exceptionRoot]   # EMERGENCY role, human-only
```

## HA (future)
This ships as a single active writer (no leader election). Run exactly one instance. Production HA
(leader election, bond/quorum for the attestor) is documented as future work in
`../KNOWN-ISSUES.md` and the runbook.
