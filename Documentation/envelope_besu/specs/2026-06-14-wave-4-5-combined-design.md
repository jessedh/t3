# Wave 4 + Wave 5 Combined Design Plan — Attributed Issuance & Settlement Cycle

- **Status:** DRAFT for product-owner review (2026-06-14). Build approved after this review; production deployment gated on ADR-003 counsel sign-off.
- **Basis:** ADR-003 (ACCEPTED 2026-06-14 w/ council amendments), `2026-06-10-...-settlement-design.md`, multi-agent council review 2026-06-14.
- **Decision:** build Waves 4 and 5 together; spend the single `/ultrareview` on the combined PR.

## Goal

Promote the issuance + settlement path from "claim-attribution wired" (G.0.a/b/c, done) to
a full single-bank attributed-issuance capacity model (Wave 4) and a three-bank multilateral
settlement cycle (Wave 5), with the council's amendments folded in — most importantly the
**atomic triple-write** that perfects the receiving issuer's secured position at transfer time.

## What already exists (grounded 2026-06-14)

- `ClaimAttributionLib` + `IssuanceAccountingLib` wired into `mintForConsortiumBank` (G.0.a) and
  `TransferEnvelopeFacet._settleAmount` (G.0.b); factor collateral on mint (G.0.c).
- `ReserveControlLib.encumberForReimbursement(outgoingIssuer, amount)` and
  `releaseReimbursementEncumbrance(...)` **exist as primitives** — not yet called from settlement.
- `IssuanceControlFacet`: `initializeClaimAttribution` + attribution getters + legacy gate. No
  quote/reserve/execute yet.
- `SettlementCycleStorage` skeleton + `ISettlementCycle` interface exist (Wave 1 ABI freeze).
  `SettlementCycleFacet`, `SettlementCycleLib`, `SettlementFundingLib` do NOT exist.

---

## Wave 4 — Single-bank attributed issuance capacity

**New libs/facets:**
- `IssuanceCapacityLib` — per-bank issuance capacity = factor-adjusted pledged reserves −
  outstanding attributed liability; per-bank daily caps; standing-limit checks.
- `IssuanceRoutingLib` — quote → reserve → execute state machine (reservation has a TTL; expiry
  releases the hold; execute consumes the reservation and calls `mintAttributed`).
- Extend `IssuanceControlFacet` with `quoteIssuance(bank, amount)`,
  `reserveIssuance(bank, amount) → reservationId`, `executeIssuance(reservationId)`,
  `cancelReservation(reservationId)`, plus capacity views.

**Behavior:**
- `execute` is the only production mint path once capacity model is active; legacy
  `mintForConsortiumBank` becomes shadow-gated (allowed only while a `capacityModelActive` flag
  is false, mirroring the existing `legacyMintUnlocked` pattern).
- Reservations encumber capacity (not reserves) so concurrent quotes can't oversubscribe — closes
  the council's "stale headroom in same block" gap at the issuance layer.

**Storage:** `IssuanceControlStorage` gains reservation records (id → {bank, amount, expiry,
state}), per-bank daily-cap counters (with day-bucket reset), and `capacityModelActive`.

---

## Wave 5 — Three-bank settlement cycle

**New libs/facet:**
- `SettlementCycleLib` — cycle lifecycle (OPEN → NETTED → FUNDED → FINALIZED / FAILED), multilateral
  netting of interbank obligations.
- `SettlementFundingLib` — funding leg (DvP): match reserve funding against net obligations before
  finalization; Fedwire/reference replay protection via a consumed-reference set.
- `SettlementCycleFacet` — admin/keeper surface: openCycle, recordObligation, computeNet, fund,
  finalize, markFailed; plus views.

### The atomic triple-write (ADR-003 Decision 1 amendment — binding)

On a cross-institution transfer settlement, these three writes commit all-or-nothing in one tx:
1. `IssuanceAccountingLib.substituteLiability` — shift `issuerAttributedOutstanding` (already wired)
2. `ReserveControlLib.encumberForReimbursement(outgoingIssuer, amount)` — perfect the secured lien
   (primitive exists; **wire it into `_settleAmount`'s cross-institution branch**)
3. `SettlementCycleLib.recordObligation(cycleId, outgoingIssuer, receivingIssuer, amount)` — create
   the interbank obligation in the open cycle

If any reverts, all revert. This removes the window where the customer is attributed to the
receiving issuer but no enforceable lien exists.

### Finality & failure (ADR-003 Decisions 1–2)

- Customer substitution final at transfer/finalization (Wave 5 does not change this).
- Reimbursement final only after `fund` + `finalize`.
- `markFailed` preserves customer attribution + the secured reimbursement obligation; routes the
  item to an exception queue. **Partial-cycle failure:** obligations are confirmed atomically at
  `finalize`, never per-obligation, so there is no mixed CONFIRMED/FAILED state (council item).

### Default permissions (ADR-003 Decision 3, amended)

- `SettlementCycleFacet` checks `InstitutionLifecycle` mode. A DEFAULT bank: blocked from
  issuance/sponsorship/reserve-release/new-repo; `settlement completion` for a DEFAULT bank is
  limited to discharging *others'* receiving-issuer claims against its collateral (not self reserve
  release). `collateral enforcement` requires `LIFECYCLE_ADMIN_ROLE` / `EMERGENCY_SETTLEMENT_ROLE`.
- Redemption during DEFAULT remains subject to sanctions/AML holds + resolution stay (enforced by
  the existing compliance/rules surface; settlement layer must not bypass it).
- "valid burns" = `burnAttributed` only.

---

## Test plan (the bar for the combined ultrareview PR)

- Conservation invariants hold across quote/reserve/execute and full settlement cycle
  (totalAttributed == totalSupply; sum of issuer outstanding == total).
- Atomic triple-write: inject a revert in each of the 3 writes → assert all-or-nothing.
- Default matrix: each blocked action reverts for a DEFAULT bank; each permitted action succeeds
  with the correct role; redemption respects an active AML/sanctions hold.
- Partial-failure: a cycle that fails after funding leaves customer attribution intact, secured
  obligation intact, no mixed obligation state.
- Replay protection: a duplicate funding reference is rejected.
- Capacity: oversubscription via concurrent reservations is impossible; reservation TTL expiry
  releases capacity.

## Build sequence

1. Wave 4 (capacity model + routing) on `phase/wave4-5-issuance-settlement`.
2. Wave 5 storage + libs (SettlementCycleLib, SettlementFundingLib), then `SettlementCycleFacet`.
3. Wire the atomic triple-write into the cross-institution settlement branch.
4. Full test suite (target: existing 1120 + new Wave 4/5 tests, 0 failing).
5. Manifest + ABI parity + selector-collision gates green.
6. One PR → **`/ultrareview`** → fix findings → merge. Production deploy still gated on ADR-003
   counsel sign-off.

## Council review (2026-06-14) — required amendments before build

Three kimi-code reviewers (correctness, security, sequencing) returned **SOUND WITH GAPS**
(unanimous). The following are binding additions to this plan; the combined PR must satisfy
them before the `/ultrareview`.

**Correctness (accounting):**
- **C1 — effective reserve must net encumbrances.** `effectiveReserve` does NOT currently
  subtract `reimbursementEncumbered`. `IssuanceCapacityLib` must compute capacity from
  reserves **minus** reimbursement encumbrances, or a bank can issue against reserves already
  pledged to a pending reimbursement (double-count). Also add a sufficiency check inside
  `encumberForReimbursement` (it currently increments unconditionally).
- **C2 — fiat path must not bypass the triple-write.** Cross-institution `FIAT_INSTITUTIONAL`
  finalization (`confirmFiatDelivery` → `burnEscrow`) currently skips `substituteLiability`/
  `encumberForReimbursement`. Either route cross-bank fiat through the triple-write, or add an
  explicit guard that blocks cross-issuer fiat envelopes until handled. Do not ship the silent
  conservation break.
- **C3 — netting invariant.** Define how encumbrances move gross→net at cycle netting, and
  assert an invariant tying net obligations to total encumbered reserves (so "secured
  reimbursement" is quantitatively closed).

**Security:**
- **S1 — DEFAULT self-dealing.** Settlement completion / reserve release / self-funded paths
  must reject calls by the defaulted bank's own operators.
- **S2 — replay key + attestation.** Consumed-reference key = `hash(cycleId, institution,
  netOwed, asset, reference)`; require `SETTLEMENT_ATTESTOR_ROLE` attestation and a challenge
  window before `finalize`.
- **S3 — reentrancy.** The three writes go in one internal wrapper with NO external calls
  between them; `fund`/`finalize` are `nonReentrant` and follow checks-effects-interactions
  (external DvP transfers happen last).
- **S4 — role guards.** `releaseCollateral` requires a non-default operator role; DEFAULT-mode
  collateral enforcement / forced settlement completion restricted to `LIFECYCLE_ADMIN_ROLE` /
  `EMERGENCY_SETTLEMENT_ROLE` only.

**Sequencing / tests (supersedes the Build sequence above):**
- Staged integration order: **Wave 4 → minimal Wave 5 (cycle + netting) → wire the triple-write
  last.** Watch diamond facet contract-size budget; profile the triple-write gas (hottest path).
- Add tests: reservation-TTL expiry + daily-cap rollover; **concurrent multi-sender reservation
  races**; mid-cycle DEFAULT entry/exit; malicious cancellation (another bank's reservation /
  after execute); netting edge cases (zero-net pairs, obligation state after `markFailed`).
  Make selector-collision + ABI-parity explicit test criteria, not just build steps.

## Lien & netting model (revised 2026-06-15 — product-owner + council)

**Decision: BILATERAL-net, not gross and not multilateral-CCP.**
- The reimbursement lien on a bank is its **bilateral net debit per counterparty pair** (the two
  directions between a pair offset). A $100-each-way A↔B exchange nets to 0 → zero collateral
  locked (fixes the gross amplification / false-liquidity concern).
- **Funding/DvP also settles bilateral net** per pair. Multilateral netting is NOT used — it
  needs a CCP (novation) + mutualized default fund, which are out of MVP scope.
- **Failure unwinds to bilateral net per pair** (ADR-003 Amendment 2). Bilateral close-out
  netting is safe-harbored (FDICIA §403) — no CCP/default fund required.
- **Cycle window is configurable + short** (locked collateral ∝ window length — cheapest
  efficiency win, no risk-model change).
- **Multilateral-net CCP is the documented scale endgame** (N≳10+): novation + default fund
  (Cover-1/2) + loss waterfall + counsel safe-harbor qualification. A future ADR + Wave 5.1.

**Implementation impact (reworks the committed cycle/funding libs):**
- Track signed **pair net** per ordered counterparty pair instead of per-issuer gross.
- The triple-write adjusts BOTH banks' encumbrances by the lien delta on each obligation
  (a reverse-direction flow can RELEASE a counterparty's lien), keeping liens = current
  bilateral net debit.
- Funding records bilateral-net settlement per pair; finalize releases each bank's remaining
  bilateral-net liens once all pairs are funded and the (short, configurable) window elapses.

## Carried counsel items (do not block build; block prod deploy)

The 4 ADR-003 counsel questions (FDIC-receivership survival, DEFAULT redemption override,
settlement-finality legal regime, Made-Whole invariant legal support).
