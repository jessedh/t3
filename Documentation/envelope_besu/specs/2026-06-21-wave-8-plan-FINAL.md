# Wave 8 — KYC Lifecycle + Compliance Build-out (FINAL Plan)

**Date:** 2026-06-21 · **Basis:** `main` (post 6A/6B/6C/7) · **Status:** FINAL — validated through 3
adversarial challenge-revision cycles (kimi C1 → codex C2 → kimi C3). Overall verdict **GO-WITH-FIXES**;
all C3 fixes folded in below. **Decisions APPROVED by Jesse 2026-06-21** (§Decisions) — ready to build.

> **Counsel-gated.** This builds the *engineering scaffolding* for a real compliance program; it does
> **not** activate one and does **not** substitute for counsel. Every control ships behind a
> **per-control, default-OFF** gate. **No PII on chain** (ADR-004: permissioned Besu, plaintext-for-
> members, no cryptographic privacy layer). No claim of an operating compliance program.

## Execution status (live)
| Sub-wave | Status | Merge / SHAs |
|---|---|---|
| 8A — canonical resolver + KYC lifecycle | ✅ MERGED | (prior waves) |
| 8B — enforcement surface + hard-deny + per-control gates | ✅ MERGED | (prior waves) |
| 8C — sanctions/AML screening attestation | ✅ MERGED | (prior waves) |
| 8D — Travel Rule (single global threshold) | ✅ MERGED | (prior waves) |
| **8E-1 — scopable compliance controls + sanctions escalation ladder** | ✅ **MERGED 2026-06-24** | merge `0b19b522` on `main`; fixes `708c7155`/`6b88d16a`/`0a985139`/`792700d9`/`ddaeff4b`; docs `793ced16`/`39b39c24`. Branch `wave/8e-1-scoping-sanctions` deleted. Gate green: 1267 passing / 21 pending, ABI parity 361/40 facets, no collisions, storage 21 libs, clean deploy. Design spec: `Documentation/envelope_besu/specs/2026-06-23-wave-8e-scoping-sanctions-design.md`. |
| **8E-2 — BSA/CIP attestation + DepositorIdentity promotion** | ✅ **MERGED 2026-06-24** | merge `c02dfe58` on `main`; build `ac28535d`/`ec95e86f`/`455b884d`/`b9616cf5`/`9b231f5c`; fixes `06f50861`/`29fdb0e7`/`effd33e1`/`c1640b28`; docs `725754eb`/`4a1ed4c1`. Branch `wave/8e-2-cip-depositor-identity` deleted. Gate green: 1346 passing / 21 pending, ABI parity 381/41 facets, no collisions, storage 21 libs, clean deploy. DepositorIdentityFacet promoted from the former optional tree to active manifest (recording-only). CIP wired via `ComplianceRequirementLib._requireCIP` behind `cip_enforce_active` (default-OFF). Counsel gate G9 blocks activation (production), not build. Design spec: `Documentation/envelope_besu/specs/2026-06-24-wave-8e2-cip-depositor-identity-design.md`. |
| **8F — FDIC 12 CFR 370 (reporting; indexer-derived exam-support endpoint)** | ✅ **MERGED 2026-06-25** | merge `d644b268` on `main`; build `815a1646` (spec)/`718f9a23` (caller-role request context)/`2f536f99` (`GET /compliance/fdic-370` endpoint); fixes `7eda7710` (overlap-aware saltEpoch supersededBy + codex spec-verify findings)/`d42626f2` (deterministic CIP tie-break + panel tests); docs `6d1cecca`/`52d18b00` (doc-staleness gate). Branch `wave/8f-fdic-370` deleted. Gate green: 1365 passing / 21 pending, ABI parity 382/41 facets, no collisions, clean deploy. Reporting-only (no new facet, no enforcement); indexer-derived from 8A–8E events. Counsel gate G9 covers the report's exam-support framing (blocks reliance for production, not build). Design spec: `Documentation/envelope_besu/specs/2026-06-24-wave-8f-fdic-370-reporting-design.md`. |

> **8E-1 scope note:** 8E was split — 8E-1 delivered the scoping model (network/institution/wallet
> policy keys, most-specific-wins) + the sanctions escalation ladder (scoped vs network screening,
> union/most-restrictive/non-exemptable, DP-A per-institution opt-in bit, DP-B atomic successor
> migration). CIP/DepositorIdentity (original 8E §152) carries forward as **8E-2**. All gates ship OFF.

## Provenance
- C1 (kimi): caught the stale-cache bug, the 4-consumer/scope-blind reads, and the rules-engine bypass
  surface. → v2.
- C2 (codex): caught the **fragmented source of truth** (4 unsynced wallet↔institution stores;
  `getInstitutionMode` defaults unknown→ACTIVE), the OR-engine inability to express most-restrictive
  precedence, forward-vs-return placement, recovery-awareness, and indexer telemetry gaps. → v3.
- C3 (kimi): confirmed the canonical-resolver + hard-deny designs are **buildable**; left 4 table/doc
  fixes (folded here). The raw private review artifacts are not included in this release.

## Design philosophy (invariant)
Attestation on-chain / process off-chain · reuse the rules engine for *soft* signals (after the
precedence fix) · no PII · indexer = exam surface · manifest + storage-isolation discipline · every
sub-wave passes selector-collision + ABI-parity + storage-layout + clean-deploy + review.

---

## Three architectural decisions (APPROVED by Jesse 2026-06-21)
Both deep reviews converged here: the hard part is the **source-of-truth and enforcement-placement
model**, not syntax. All three are approved as the recommended resolutions below (and in §Decisions).

### A. Canonical compliance-status resolver  (fixes the fragmented source of truth)
Four un-synced wallet/institution stores exist today:
| Store | Written by | Read by | Hazard |
|---|---|---|---|
| `RulesStorageLib.walletInstitution` | `RulesConfigFacet` | `RulesEngineFacet` (sender scope only) | recipient side never resolved |
| `InstitutionStorage.walletAffiliations` (+`setWalletAffiliationStatus`) | `InstitutionRegistryFacet` | — | can suspend/revoke a wallet; unused by KYC |
| `InstitutionLifecycleStorage.bankToInstitutionId`+`institutionMode` | `InstitutionLifecycleFacet` | lifecycle | `getInstitutionMode` defaults unset → **ACTIVE** (unlinked = silently valid) |
| `StorageLib.CustodyData.custodian` | `CustodianRegistryFacet` | KYC reads | the custodian *is* the bank/institution |

**Recommendation:** one internal `ComplianceStatusLib.resolveAffiliation(user)` as the single resolver,
that is **affiliation-status-aware** (honor `walletAffiliations` suspend/revoke), **lifecycle-aware but
fail-closed on unknown** (do NOT inherit the ACTIVE default for compliance), **recovery-aware** (resolve
through `WalletRecoveryStorage._resolveRecoveryPayee` so a wallet in recovery is judged on its successor
— protects Made-Whole), and **custody-anchored** (`CustodyData.custodian → institutionMode[custodian]`;
`linkWalletToInstitution` has zero callers and is not relied on). `effectiveKycStatus(ds,user)` =
time-checked `CustodyData` validity AND `resolveAffiliation` not-suspended/defaulted. All four KYC
consumers call it. **Internal library** (no external diamond self-call) for gas/reentrancy safety.

### B. Hard-deny layer, separate from the OR-scoring engine
`_effectiveBool` is `w‖i‖n`, `_effectiveUint` is first-nonzero, and `beforeTransferCheck` resolves only
the **sender-side** institution scope (RulesEngineFacet:81/452/471). So most-restrictive (sanctions /
affiliation-block, recipient-side) **cannot** be expressed in the OR engine, and `observationMode` won't
help because `T3TokenDirectTransferFacet:121` reverts on `DENY`.
**Recommendation:** `ComplianceLib.assertNotBlocked(from,to,context)` — a hard-deny check **outside** the
score/action helper, evaluating most-restrictive status across wallet/institution/network for **both**
parties, reverting when the relevant gate is ON. It MUST run **before** the existing `try/catch` around
the rules engine in DirectTransfer so it reverts directly (not swallowed by `failClosed`). The OR engine
keeps `requireKyc`/`requireCIP` (correctly permissive-OR *requirements*) and soft scoring.

### C. Forward-vs-return enforcement placement  (don't strand escrow / break Made-Whole)
Gate **forward value movement only**; return/refund/reverse legs are exempt (routed to origin);
non-movement legs are not checked. Context-typed `ComplianceLib.precheck(from,to,amount,context)`,
`context ∈ {WALLET_TRANSFER, ESCROW_IN, ESCROW_RELEASE, BANK_MINT, RECOVERY_MIGRATE}` (bank-mint =
institution eligibility, not wallet KYC; recovery = successor). **Classification (C3-corrected; re-verify
line #s at build):**
| Entrypoint | Class | Check? / context |
|---|---|---|
| `T3TokenDirectTransferFacet` transfer | forward | yes — WALLET_TRANSFER (already hooked) |
| `TransferEnvelopeFacet` create | forward | yes — ESCROW_IN (sender) |
| `TransferEnvelopeFacet` finalize / `_settleAmount` recipient leg | forward | yes — ESCROW_RELEASE |
| `TransferEnvelopeFacet._settleAmount` **partial-split sender-return leg** (`resolveDispute(DO_PARTIAL_SPLIT)`) | **return/refund** | **no** (C3 fix #3) |
| `TransferEnvelopeFacet.processExpiration` — `EB_IMMEDIATE_FINALIZE` release / `ES_PENDING_FIAT` auto-confirm burn | **forward** | **yes** — ESCROW_RELEASE/burn (C3 fix #1) |
| `TransferEnvelopeFacet.receiveOracleCallback(true)` | **forward** | **yes** — ESCROW_RELEASE (C3 fix #2) |
| `TransferEnvelopeFacet.receiveOracleCallback(false)` / `reverseEnvelope` / `clawbackSettlement` | return/refund | no (route to origin) |
| `TransferEnvelopeFacet.confirmFiatDelivery` (admin fiat finalize, burns escrow) | forward | yes — ESCROW_RELEASE/burn |
| `EnvelopeInheritanceFacet.createChildEnvelope` | forward | yes — ESCROW_IN |
| `SmartLockEnvelopeFacet` lock / release | forward | yes — ESCROW_IN / ESCROW_RELEASE |
| `SmartLockEnvelopeFacet` cancel | return/refund | no |
| `CambioEnvelopeFacet` note create / redeem | forward | yes — ESCROW_IN / ESCROW_RELEASE |
| `CambioEnvelopeFacet` cancelEnvelopeNote | return/refund | no |
| `CambioEnvelopeFacet` commitRedemption / clearExpiredCommit | non-movement | no |
| `T3TokenMintBurnFacet.mintForConsortiumBank` / `IssuanceControlFacet.executeIssuance` | forward (mint) | yes — BANK_MINT (institution eligibility) |
| `WalletRecoveryFacet.migrateBalance` / `applyBulkPolicy` finalize-choices | forward (to successor) | yes — RECOVERY_MIGRATE (check successor) |

---

## Sub-waves (verdicts: 8A/8B/8E GO-WITH-FIXES, 8C/8D/8F GO)

### 8A — Canonical resolver + KYC lifecycle correctness (lands first; no new enforcement)
- `ComplianceStatusLib` per Decision A; refactor all 4 consumers to it.
- Deterministic cache fix: every `CustodyData` writer + new `revokeKYC` + custody delete must
  `delete kycStatusCache[user]`; **enforcement reads bypass the cache** (live `effectiveKycStatus`).
  **Cache removal is migrate-then-remove (verified, kimi C4):** `getKycStatusCached` is currently live
  in `RulesEngineFacet` (4 sites) — so first migrate those + the dormant
  `calculateEnhancedHalfLife → calculateKycMinimumHalfLife` chain to `effectiveKycStatus`, THEN delete
  `getKycStatusCached` + the `kycStatusCache` field. Until that migration lands, keep the cache with the
  patch (delete-on-write + `cacheExpiry ≤ kycExpiresTimestamp`); do not delete the AppStorage field early.
- `revokeKYC(user,reasonCode)` (CUSTODIAN_ROLE) + `KYCRevoked` event; expiry-propagation test.
- Tests: revoke, expiry, institution suspend/default, **recovery-in-progress routes to successor**, all
  four consumers agree.

### 8B — Enforcement surface + hard-deny + per-control gates
- `ComplianceConfigStorage` (own keccak slot): `kycEnforceActive`, `screeningEnforceActive`,
  `travelRuleEnforceActive`, `cipEnforceActive` — all default OFF ("exactly as today when OFF").
- `ComplianceLib.precheck` (context-typed, Decision C) + `assertNotBlocked` (Decision B) hooked at every
  **forward** entrypoint in the table; returns/refunds exempt; hard-deny runs before the engine try/catch.
- Activation runbook + ordering guard (a gate ON only after its data source ships; fail-closed w/ clear
  error). Made-Whole non-regression tests on refund/reversal/recovery while a gate is ON.

### 8C — Sanctions / AML screening attestation  (GO)
`ScreeningStorage` + `ComplianceScreeningFacet` (`CLEAR|FLAGGED|BLOCKED, lastScreenedAt, listVersionHash,
attestor`; `SCREENING_ATTESTOR_ROLE`). BLOCKED enforced via the hard-deny layer (most-restrictive, both
parties); stale screen = soft WARN weight. Redemption + settlement-default hooks. Indexer
`WalletScreened`/`ScreeningBlocked`.

### 8D — Travel Rule (FinCEN/FATF R.16)  (GO)
**Design DECIDED (kimi + Claude options panel, 2026-06-22): Option B — atomic create-time binding, no
release re-check.** Travel Rule is an *origination* obligation (info must travel WITH the transfer), and
the facet split put `createEnvelope` in the small `TransferEnvelopeAdminFacet` (headroom), so binding the
ref at create is both correct and cheap.
- New `ComplianceTravelRuleFacet` + `TravelRuleStorage` (own keccak slot `t3.storage.compliance-travel-rule.v1`:
  `mapping(bytes32 envelopeId => {bytes32 ref; bool satisfied; uint40 attachedAt})` + `mapping(address => bytes32)
  pendingRef` + threshold). The **originator (sender) supplies** the ref via `setPendingTravelRule(ref)` before
  create (it's their R.16 obligation — no special role; admin sets only the threshold). On-chain holds only a
  **high-entropy** `travelRuleRef` (random UUID or `keccak256(payload‖secret)`; validate `ref != 0`, no PII) +
  the boolean. Off-chain IVMS101 transport is a **documented integration point, not built**.
- Mechanism: each create entrypoint calls `ComplianceTravelRuleLib.bindOnCreate(ds, sender, envelopeId, amount)`
  which, when the gate is ON and `amount ≥ threshold`, consumes the sender's `pendingRef` and binds it to the
  new `envelopeId` (or reverts `TravelRuleRequired` if none) — binding is atomic with create; no ABI signature
  churn on the create functions.
- **Enforcement = create-time, all forward escrow-in entrypoints.** Behind `travelRuleEnforceActive`
  (default OFF), when `amount ≥ threshold` and no ref is supplied, the create reverts `TravelRuleRequired`,
  at EVERY escrow-in leg: `createEnvelope`, `EnvelopeInheritanceFacet.createChildEnvelope`,
  `SmartLockEnvelopeFacet` lock, `CambioEnvelopeFacet` note create. Ref is bound + emitted at create
  (immutable thereafter).
- **NO release re-check** — the ref is immutable once bound, so re-checking at finalize/release is
  redundant for Travel Rule AND would retroactively strand in-flight envelopes (Made-Whole violation).
  Refund/reverse/cancel legs are exempt. Coverage is achieved by checking all *create* entrypoints, not
  the release leg.
- **Gate activation = new creates only.** Turning `travelRuleEnforceActive` ON applies to subsequent
  creates; in-flight envelopes are grandfathered (documented).
- **Threshold (8D scope = a single global threshold).** `threshold == 0` with the gate ON is
  **fail-closed (enforce-all)** — the admin must set a threshold before activation or every create
  requires a ref. Per-institution/network threshold precedence (most-restrictive/lowest-wins) is
  **deferred** (not in 8D). FinCEN R.16 reference: USD 3,000 (FATF: USD 1,000-equiv).
- Indexer: `TravelRuleAttached`. (No `TravelRuleMissing` — the "no ref required" case is the normal
  allowed path, not a violation, so it is not an event; a required-but-missing ref reverts.)
- **Graceful degrade = Option C** (storage + facet + threshold + ref recording + indexer, enforcement
  deferred) — a strict subset of the above — if schedule tightens.

### 8E — BSA/CIP + DepositorIdentity promotion  (GO-WITH-FIXES; splittable — see §Cut candidates)
**Prerequisite cleanup:** remove the INACTIVE/DESIGN-STAGE markers in `IDepositorIdentity.sol` +
`DepositorIdentityStorage.sol`, reconcile with the resolver/affiliation story, then register in
`facet-manifest.js` + fixture + ABI + collision/parity. `cipCompletedAt` + `cipRecordHash` (hash
pointer, no PII); `requireCIP` as its own rule bool (D1, recommended). **Privacy caveat:** salt-epoch
prevents raw-TIN disclosure + supports rotation but does **not** prevent cross-bank correlation (shared
network salt per epoch) — document in KNOWN-ISSUES + NatSpec; per-bank salts are a counsel tradeoff
(breaks the FDIC cross-bank conflict check).

### 8F — FDIC 12 CFR 370 (reporting; ~90% off-chain)  (GO)
Indexer-derived per-beneficial-owner/per-category balances from 8E hashes + balances; on-chain stays
boolean/hash (inference-attack avoidance). `/compliance/fdic-370` endpoint, **format ships DRAFT**.

---

## Indexer telemetry (C2 fix)
Enrich `RuleEvaluated` to emit the **driving scope** (wallet/institution/network), not just network;
index `InstitutionModeChanged`, `WalletAffiliationStatusChanged`, `WalletInstitutionSet`, and all new
compliance events, so the exam surface can reconstruct effective status over time.

## Precedence matrix (decided)
| Signal | Resolver | Precedence |
|---|---|---|
| `requireKyc` / `requireCIP` | existing `_effectiveBool` | permissive OR (any scope may *require*) |
| KYC validity / affiliation | `ComplianceStatusLib` + hard-deny | most-restrictive, both parties |
| sanctions BLOCKED | `assertNotBlocked` | most-restrictive, both parties, recipient-side included |
| Travel-Rule threshold | hard-deny | lowest (strictest) threshold wins *(deferred — 8D ships a single global threshold)* |
| soft signals (stale screen, velocity) | scoring engine | additive weights → `enforceWarnAt`/`enforceDenyAt` |

## Cross-cutting deliverables
`Documentation/envelope_besu/COMPLIANCE-MATRIX.md` (regulation → facet/lib/indexer → attestation/
enforced/reporting) · per-control rows in `COUNSEL-GATES.md` · `KNOWN-ISSUES.md` (attestation-not-
process, salt correlation, any residual unhooked paths) · indexer `/compliance/*` + telemetry ·
`REGULATORY-STATUS.md` honest re-status (NOT-IMPLEMENTED → attestation-present/process-off-chain/
enforcement-gated, without overstating).

## Storage-layout / alignment (C3 confirmed)
`ComplianceConfigStorage` + `ScreeningStorage` as new keccak-isolated slots — safe, no `AppStorage`
regression, follows the established pattern. ADR-004 honored (hashes/booleans only). Manifest discipline:
new facets + DepositorIdentity promotion all go through manifest + fixture + ABI + gates.

## Sequencing
**8A → 8B → (8C ‖ 8E) → 8D → 8F.** A gate turns ON only after its data source ships. Each sub-wave:
branch → kimi review → Phase Transition Gate → PR → merge. Reserve the one `/ultrareview` for **8B** (most
enforcement-critical) or **8A** (shared resolver touches everything).

## Decisions — APPROVED (Jesse, 2026-06-21)
- **D-canon** ✅ — single `ComplianceStatusLib` resolver, **fail-closed on unknown affiliation**,
  recovery-aware, custody-anchored.
- **D-deny** ✅ — **separate hard-deny layer** (`assertNotBlocked`), engine left intact.
- **D-ctx** ✅ — **C3-corrected forward/return table + 5 contexts** approved.
- **D-cache** ✅ (verified-corrected, kimi C4) — the cache is **NOT currently dormant**:
  `getKycStatusCached` is live in `RulesEngineFacet.beforeTransferCheck`/preview (4 sites). So the
  **interim safe default is PATCH** — delete-on-write on every `CustodyData` writer + cap
  `cacheExpiry ≤ kycExpiresTimestamp` + route enforcement reads through the live `effectiveKycStatus`.
  Full **removal of `getKycStatusCached` + the `kycStatusCache` field is allowed only AFTER 8A migrates
  the live RulesEngine callers** (and the already-dormant `calculateEnhancedHalfLife → calculateKycMinimumHalfLife`
  chain) to the resolver. Sequence: migrate-then-remove, not remove-because-dormant.
- **D1** ✅ — CIP as its own `requireCIP` bool.
- **D2** ✅ — KYC/CIP missing → DENY; sanctions BLOCKED → quarantine + DENY; stale screen → WARN.
- **D3** ✅ — Travel-Rule on-chain ref + boolean now; transport is a documented integration point.
- **D4** ⏸ — **keep the network salt** for now (preserves the FDIC cross-bank duplicate check),
  document the cross-bank correlation caveat; per-bank salt deferred to **counsel**. No code change now.

## Cut / de-scope candidates
- **8E (CIP + DepositorIdentity) is the cleanest split** — a distinct identity-recordation stream from
  the KYC-lifecycle/enforcement core; defer first if schedule pressure rises (8F depends on it).
- Removing the KYC cache (rather than patching) is a simplification, not added scope.

## Already-solid (do NOT regress)
Cache-bypass-for-enforcement (or cache removal) · high-entropy `travelRuleRef` · salt-epoch correlation
caveat · per-control default-OFF gates · reuse rules engine for soft signals (post precedence fix) ·
indexer-as-reporting · FDIC-370 as off-chain reporting.

## Explicitly NOT in Wave 8
Screening-provider integration, the Travel-Rule transport network, FDIC-370 format sign-off, per-bank
salt redesign, any claim of an operating compliance program. Production activation stays counsel-blocked.
