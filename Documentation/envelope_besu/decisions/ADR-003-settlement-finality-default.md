# ADR-003: Settlement Finality and Default Authority

- **Status:** ACCEPTED (product-owner gate signed 2026-06-14, with multi-agent council review and amendments) — **counsel gate PENDING.** Production *deployment* of the Wave 5 settlement engine is blocked until counsel sign-off; *building/testing* Wave 5 against this design is approved.
- **Date:** 2026-06-10 (decisions) · 2026-06-14 (sign-off + amendments)
- **Wave:** 0 (Legal, Accounting, and Product Gate)
- **Deciders:** Jesse (product owner) + counsel (pending)
- **References:**
  - `Documentation/envelope_besu/specs/2026-06-10-t3-bank-deposit-issuance-settlement-design.md` (§7.4, §8)
  - Multi-agent council review 2026-06-14 (settlement-risk, compliance, consensus/runbook lenses)

## Context

We must record when customer-liability substitution and interbank reserve reimbursement
each become final, what happens on failure, and which actions a defaulted institution may
still take — before the settlement engine (Wave 5) is written.

## Decision 1: Finality

Customer liability substitution becomes final in the cross-bank transfer transaction after
receiving-issuer headroom and standing limits pass. Interbank reserve reimbursement becomes
final only after settlement funding and protocol finalization.

**Amendments (2026-06-14):**
- **Atomicity (binding on Wave 5):** the reserve **encumbrance write must be committed
  atomically with `substituteLiability`** — liability shift, reserve encumbrance, and
  settlement-obligation record are an all-or-nothing triple-write. Today only the accounting
  shift fires (`_settleAmount`); the secured obligation is not yet a perfected on-chain lien.
  This is the model's #1 risk and Wave 5 must close it.
- **Finality moment for envelopes:** for direct transfers, finality is in the transfer
  transaction; for programmable envelopes, finality is at recipient-directed **finalization**,
  not at envelope creation/escrow. Envelope escrow (ADR-001) is explicitly *not* final
  substitution.
- **Legal hook (counsel):** record which settlement-finality regime (UCC 4A / netting-act
  analog) the consortium asserts for "becomes final."

## Decision 2: Failure Behavior

Failure preserves the receiving issuer's customer liability and the outgoing issuer's secured
reimbursement obligation. Failure does not reverse customer claim attribution.

**Amendment 2 (2026-06-15, product-owner + council on the gross-vs-net fork):**
Failure unwinds to **bilateral net per counterparty pair**, NOT gross bilateral. The
reimbursement lien is sized to each bank's **bilateral net debit** to each counterparty (offset
of the two directions between a pair), and the funding/DvP leg settles **bilateral net** as well
(multilateral netting is deliberately NOT used — it would require novation to a central
counterparty + a mutualized default fund, which are out of MVP scope). Rationale: gross liens
amplify locked collateral with gross turnover (a $100-each-way A↔B exchange nets to zero
economically but froze $200 under gross), creating a false liquidity event at scale. Bilateral
close-out netting between two financial institutions is understood to be well-established and
intended to be safe-harbored (FDICIA §403 / Bankruptcy-Code netting safe harbors) and to need
no CCP or default fund — **(counsel-unconfirmed; see [COUNSEL-GATES.md](../COUNSEL-GATES.md) G2/G4)**.
**Multilateral-net CCP remains the documented scale endgame** (N≳10+), gated on a future
ADR revision + counsel qualification of the consortium as a netting/clearing arrangement.
Cycle windows are configurable and kept short (locked collateral is proportional to window
length).

**Amendments (2026-06-14):**
- **Partial-cycle failure:** if a cycle fails after some obligations are individually
  confirmed on-chain, the reconciliation path from that mixed (some CONFIRMED / cycle FAILED)
  state must be specified in the Wave 5 design; per-obligation confirmation must not leave an
  unrecoverable state.
- **Counsel:** confirm the secured reimbursement is **perfected and bankruptcy-remote** against
  the outgoing issuer's FDIC receivership and is not an avoidable preference.

## Decision 3: Default Permissions

DEFAULT blocks issuance, sponsorship, reserve release, and new repo. DEFAULT permits
redemption, valid burns, settlement completion, collateral enforcement, and resolution actions
that reduce risk.

**Amendments (2026-06-14):**
- **"settlement completion"** means only discharging verified receiving-issuer reimbursement
  claims against the defaulted outgoing issuer's collateral — NOT any action the defaulted
  institution initiates to release its own reserves to itself.
- **"collateral enforcement"** is restricted to `LIFECYCLE_ADMIN_ROLE` /
  `EMERGENCY_SETTLEMENT_ROLE`; the defaulted institution's own operator role cannot invoke it.
- **"valid burns"** means only burns routed through `IssuanceAccountingLib.burnAttributed`
  with full attribution-conservation checks (not legacy escrow burn paths).
- **Redemption during DEFAULT** is permitted **subject to** sanctions/AML holds and any
  resolution-authority stay, which outrank the permit rule. Define who controls that override
  (resolution authority / conservator step-in) — counsel item.

## Decision 4: Besu Finality Evidence

The consortium runs Hyperledger Besu with permissioned QBFT BFT consensus, which provides
immediate/deterministic finality at block commit — no probabilistic reorg window. A
transaction is final once its block is committed.

**Runbook confirmation rule (recorded):**
> Consensus: Hyperledger Besu **QBFT**. A transaction is FINAL once included in a committed
> block (block inclusion = finality; no reorgs). **Confirmation rule: N = 1 (one committed
> block).** The keeper and indexer MUST treat a committed block as final and MUST NOT apply any
> additional confirmation depth or reorg-handling delay.

**Pinned config (local devnet, verified 2026-06-14):** Besu `26.6.0`; QBFT; `blockperiodseconds: 2`;
`requesttimeoutseconds: 4`; `epochlength: 30000`; 4 validators, quorum 3 (⌈2N/3⌉), tolerates 1
fault; chain ID 1337; zero-gas.

**Caveat / production gap:** QBFT safety holds only while < ⅓ of validators are Byzantine/offline;
with N=4, losing 2 validators halts the chain (liveness, not safety, failure). Production must
target ≥ 7 validators across independent operators/hosts, add node+account permissioning, and
pin the validator-set change procedure. Add an explicit confirmation-depth = 1 marker in
keeper/indexer config so no one later introduces a confirmation delay.

## Customer Made-Whole Invariant (added 2026-06-14)

> **Status:** this is an **engineering design goal**, not a confirmed legal guarantee. Its
> survival through an issuer insolvency is counsel-pending (see [COUNSEL-GATES.md](../COUNSEL-GATES.md) G5).

The technical and legal controls are intended to jointly ensure that a customer's deposit claim is
never reversed and the customer is never the residual risk-bearer of an interbank failure or
default: customer-liability substitution is final at transfer/finalization, failure converts
the gap into the outgoing issuer's *secured* reimbursement obligation, and default isolates
risk at the interbank layer. Counsel must confirm this property survives the outgoing issuer's
insolvency (claim survival + reserve perfection + FDIC-insurance recordkeeping path).

## Open Approval Gate

- [x] Product owner signs off on finality, failure behavior, and default permissions
      (2026-06-14, with council amendments above).
- [x] Runbook finality-evidence detail recorded (Decision 4 above).
- [ ] **Counsel sign-off (PENDING)** — blocks production deployment, not Wave 5 build. Brief:
  1. Does transfer-time customer-liability substitution survive the outgoing issuer's FDIC
     receivership — is the receiving-issuer claim a true insured deposit, and is the secured
     reimbursement non-avoidable / bankruptcy-remote?
  2. During DEFAULT, what legally outranks the "redemption permitted" rule (sanctions freezes,
     resolution stays, pari-passu / anti-preference)?
  3. Which settlement-finality legal regime does the consortium assert (UCC 4A / netting-act)?
  4. Is the Customer Made-Whole Invariant legally supportable end-to-end through insolvency?
