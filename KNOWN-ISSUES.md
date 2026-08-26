# Known Issues & Design Limitations

> **Last reviewed: 2026-08-25** — every claim below was re-verified against the code
> at that date, including the contract-size figures and the dependency audit.
>
> This is a **technical preview** that will need additional legal and compliance
> vetting before production use. The items below are known and disclosed
> deliberately: this document exists so an evaluator can see the real state rather
> than infer it. Open legal and compliance questions are catalogued separately in
> [REGULATORY-STATUS.md](REGULATORY-STATUS.md) and
> [Documentation/envelope_besu/COUNSEL-GATES.md](Documentation/envelope_besu/COUNSEL-GATES.md).
>
> Both banking feature gates (`capacityModelActive`, `settlementModelActive`) ship
> **OFF** by default — they are set only through explicit admin setters and are never
> enabled at initialization — so several issues below manifest only if an operator
> turns them on.

## Smart contracts

### Pre-audit contract hardening items (adversarial council, 2026-06-18)
These are known auditor-flag items, disclosed deliberately. They are not exploitable
in the shipped posture (permissioned network; both banking gates OFF) but **must be
resolved before any production activation** and before a formal audit:
- **No real `ARBITER_ROLE`** — `TransferEnvelopeFacet._requireAdminOrArbiter` checks only admin while NatSpec/`CallerNotArbiter` imply a distinct arbiter actor. Naming/role gap to reconcile.
- **`grantRole`/`revokeRole` accept ERC-2771 meta-tx** (`AccessControlFacet`) while `DiamondCutFacet` rejects them — a compromised trusted relayer is a role-escalation vector. Add a `msg.sender == _msgSender()` guard on role admin before production.
- **ETH sent to the diamond is trapped** — `Diamond.sol` `receive()` accepts ETH with no withdrawal path in any facet. Add a rescue path or revert `receive()`.
- **`DiamondCutFacet._initializeDiamondCut` lacks the `_init.code.length > 0` guard** that `Diamond.sol` has — a `delegatecall` to an EOA returns success. Add the guard before any upgrade is performed in production.
- **No lower bound on dispute/clawback windows** (`TransferEnvelopeFacet`) — admin can set a 1-second window. Add a minimum before activation.
- **`SponsorBankCoreFacet (RETAINED — still in the active manifest; Cambio storage reads it)Facet.getAllSponsorBanks()` returns an empty array** (TODO) while in the active manifest — callers get silently wrong data.
- A design spec proposes a bearer-note deep-link carrying the **secret redemption phrase in the URL query string** — must not be implemented as written (leaks via history/logs/referrer).

### KYC: functional attestation vs. inactive scaffolding
**Functional & default-on:** the on-chain KYC *attestation* (`CustodianRegistryFacet`
KYC timestamps → `isKYCValid`/`getKycStatusCached`) is live and feeds the half-life
(reversibility) calc and the rules/risk engine; network `requireKyc` is seeded ON by
default (scores/records; hard deny stays a separate admin dial). It is an on-chain
*record* extending the traditional off-chain bank KYC model — **not** the KYC process
itself, and makes no AML/CIP/FDIC representation. See REGULATORY-STATUS.md.
**Genuinely inactive scaffolding** (distinct): symbols that only *name*
compliance/FDIC concepts and aren't in the manifest — `DistributionManagementBase.isKYCVerified`
(now reverts instead of returning `true`). No compliance control should be inferred from those names.
*(Note: as of Wave 8E-2 `DepositorIdentityFacet` is **promoted into the active manifest** as a
recording-only TIN-hash registry — it is no longer inactive scaffolding, but it is **not** wired into
enforcement; see the shared-salt correlation item below.)*

### Wave 8B compliance enforcement surface — gated OFF, plumbing only
Wave 8B added a context-typed pre-check (`ComplianceLib.precheck` via the `ComplianceGateFacet`)
hooked at forward value-movement entrypoints. As of **Wave 8E-1** the controls are **scoped policy
keys** (`kyc_enforce_active` / `travel_rule_enforce_active` / `travel_rule_threshold_usd` /
`cip_enforce_active`), resolved most-specific-wins (network→institution→wallet); the four legacy
`ComplianceConfigStorage` bools (`kycEnforceActive` / `screeningEnforceActive` /
`travelRuleEnforceActive` / `cipEnforceActive`) are **retired** (authoritative for nothing; legacy
bool setters revert `Deprecated()`; the KYC/Travel-Rule/CIP `is*EnforceActive()` views now read the
scoped network policy keys, while `isScreeningEnforceActive()` reads the DP-A `sanctionsEnabledCount`).
Enforcement is armed by a single monotonic counter, **`activeScopeCount`** (sanctions arm via the
DP-A `institutionSanctionsEnabled` opt-in + network blocks, not a flat bool); the pre-check is a
no-op when `activeScopeCount == 0`. It **enforces recorded attestations**, it is **not** the
screening/identity *process*, and **every control ships OFF**. Known limits, disclosed deliberately:
- Sanctions hard-deny is **live as of Wave 8C and scopable as of Wave 8E-1**: `ComplianceSanctionsLib`
  (split out of `ComplianceLib`; union / most-restrictive / **non-exemptable**) reads `ScreeningStorage`
  and hard-denies a BLOCKED party (both legs, context-aware) when armed (`activeScopeCount > 0`; ships
  OFF). The legacy flat `screeningEnforceActive` / `ComplianceLib.assertNotBlocked` model is **removed**.
  Records are two-tier — **scoped** (per-institution, scoped `SCREENING_ATTESTOR_ROLE`) and **network**
  (`NETWORK_SCREENING_AUTHORITY_ROLE`) — escalating FLAGGED → institution block → network block →
  network clearance. Only **BLOCKED** denies; FLAGGED is recorded but never blocks. Status is
  attestation-based (**no automated OFAC/list ingestion**).
- Travel Rule is **live as of Wave 8D and scopable as of Wave 8E-1** (origination binding at escrow-in
  creates ≥ threshold; ships OFF). The IVMS101 transport remains off-chain (documented integration point),
  and enforcement applies to NEW creates only — in-flight envelopes are grandfathered. Operational notes:
  (a) **`threshold == 0` + armed = enforce-all (fail-closed)** — set a threshold before activation;
  (b) arming + threshold are now **scoped policy keys** (`travel_rule_enforce_active`,
  `travel_rule_threshold_usd`, most-specific-wins network→institution→wallet); raising a scoped threshold
  **above** the network baseline requires `COMPLIANCE_EXEMPTION_ROLE` and emits `ComplianceExemptionGranted`;
  (c) staged refs are full commitments `(ref, recipient, amount, objectType, deadline)` — the create
  must match recipient/amount/objectType exactly (else `TravelRuleCommitmentMismatch`), a bind after
  `deadline` fails closed (`TravelRuleRefExpired`), each commitment is single-use, and an expired or
  stale commitment can be overwritten by a new `setPendingTravelRule` or dropped via
  `clearPendingTravelRule`.
- `cip_enforce_active` is **live as of Wave 8E-2** (`ComplianceRequirementLib._requireCIP`, a flat
  one-time presence check on `CustodyData.cipCompletedAt`, hooked at WALLET_TRANSFER / ESCROW_IN /
  ESCROW_RELEASE / RECOVERY_MIGRATE — **not** BANK_MINT, since customer-facing mint rides ESCROW_RELEASE).
  CIP is exemptable/relaxable via `getEffectivePolicy` (most-specific-wins). It records identity
  *presence*, not the identity-verification *process* (off-chain, bank responsibility). Ships **OFF**;
  flipping it on with no CIP records would block hooked flows — counsel gate G9.
- **`activeScopeCount` is not decremented when an institution becomes `DEFAULTED`/`RESOLVED`** while its
  DP-A sanctions bit is still set. This does **not** cause over-enforcement: `ComplianceSanctionsLib._institutionEnforcing`
  returns `false` for a non-Active / DEFAULTED / RESOLVED institution, so its scoped blocks stop biting at
  read time regardless of the counter. The only effect is that `complianceArmed()` can stay `true` (the
  no-op fast path stays off) after the last live institution dies, costing a little gas until the bit is
  explicitly cleared. Reconciling the counter on lifecycle transitions is backlog (Wave 8E-1 review Finding #7).
- **Residual unhooked value paths:** removed optional facets (e.g. RevenueDistribution, SponsorBankCoreFacet (RETAINED — still in the active manifest; Cambio storage reads it),
  ConsortiumYield) moved value and were **not** hooked; they are not in the active manifest and must be
  added to the hook surface if ever reintroduced.
- Refund/reverse/cancel/sender-return legs are intentionally **not** hooked (Customer Made-Whole).
See `Documentation/envelope_besu/COMPLIANCE-MATRIX.md`.

### Upgrade governance is minimal (by design for a consortium)
`DiamondCutFacet` upgrades are gated by a single `DEFAULT_ADMIN_ROLE` with **no
on-chain timelock or multisig**. For a permissioned consortium the network
boundary is the control; adopters on public or semi-public networks **must** wrap
upgrades in timelock/multisig governance before production.

### Flat role hierarchy
`DEFAULT_ADMIN_ROLE` administers all roles (including `MINTER_ROLE`,
`PAUSER_ROLE`, settlement keeper/attestor roles). A single compromised admin key
can grant any role. A tiered admin model (e.g. a consortium-admin that cannot
grant `DEFAULT_ADMIN_ROLE`) is recommended future work.

### Single settlement attestor
Settlement funding attestation (`recordFunding`) is gated on a single
`SETTLEMENT_ATTESTOR_ROLE` with no economic bond, slashing, or multi-attestor
quorum. A self-dealing guard prevents the attestor from being the funding party,
but key compromise/collusion is not addressed on-chain. Only relevant when
`settlementModelActive` is enabled. A bond/quorum model is future work.

### Settlement-cycle liveness window
`proposeSettlementCycle` clears the active `currentCycleId`, and a new cycle must
be opened before the next cross-bank finalize. While `settlementModelActive` is
ON and no cycle is open, cross-bank finalizes **revert** `NoOpenSettlementCycle`
(fail-closed — no fund movement, no lost obligations). A keeper (or atomic cycle
roll-over) is required to keep a cycle open in production. Off by default.
> *Status: see CHANGELOG / settlement-cycle PRs for whether an atomic-rollover
> fix has landed; if not yet, this window is mitigated operationally by a keeper.*

### Settlement reconciliation — deferred invariant
The Wave 6C reconciler (`keeper/src/reconcile.js`, see
[RECONCILIATION-SPEC.md](Documentation/envelope_besu/RECONCILIATION-SPEC.md)) checks pair-net,
cycle-lien, lien↔encumbrance, solvency, indexer↔chain consistency, and failed-cycle lien
preservation. It does **not** yet check **conservation-of-obligations across substitution** — that
every recorded obligation resolves to a finalized cross-institution envelope with none stranded in
escrow. The `EncumbranceExceedsReserve` revert path (`ReserveControlLib.sol:111`) can revert a
cross-institution finalize and strand a customer envelope; detecting the stranded envelope needs an
envelope-by-`sourceTransferId` index (the on-chain `SettlementObligationRecorded` event is thin).
Only relevant when `settlementModelActive` is ON. Deferred.

### Storage-layout discipline
Module state uses the keccak256-isolated diamond-storage pattern, so cross-module
slot collision is structurally impossible; the upgrade hazard is reordering or
inserting fields within a `struct Layout`. This is guarded by
`scripts/check-storage-layout.js` (a committed field-order snapshot, enforced in
CI). Note: traditional `__gap` reserves are intentionally **not** added to these
keccak-isolated structs — they address sequential/inheritance layouts and would be
churn here; the field-order gate is the correct control for this model.

### Contract size (EIP-170)
**One facet currently exceeds the standard EIP-170 24 KiB limit.**
`WalletRecoveryFacet` is 25.623 KiB, so that facet is **not** mainnet-portable
under EIP-170 today. `TransferEnvelopeFacet` was temporarily over (25.9 KiB)
after the Wave 8 compliance hooks; the facet-split wave resolved that by moving
the lifecycle/admin/view surface to `TransferEnvelopeAdminFacet` (now
`TransferEnvelopeFacet` ≈ 20.5 KiB, the new facet ≈ 11.5 KiB). The CI gate
(`scripts/check-contract-size.js`) hard-fails any facet over the consortium
limit and reports EIP-170 overages as tracked warnings. The free-gas consortium
genesis sets `contractSizeLimit = 49152` (`scripts/besu-genesis-local.sh`), so
`WalletRecoveryFacet` is deployable on the consortium devnet but not under the
standard EIP-170 limit. Regenerate the full report (`hardhat-contract-sizer`)
before adding facet code.

### Single network screening authority (Wave 8E-1) — HIGH
`NETWORK_SCREENING_AUTHORITY_ROLE` is a **single global key** that can place a
network-binding sanctions block on **any** address and clear **any** block
(`recordNetworkScreening`/`recordScreening`, `clearNetworkBlock`), with no quorum,
timelock, or bond. For a bank-issued deposit token, one key that can freeze any
customer network-wide is a real availability/consumer-protection concern. The scoped
attestor tier (`SCREENING_ATTESTOR_ROLE`, per-institution, can place only an
institution-scoped block) is weaker and cannot place a network block. A compromised
authority could freeze (grief) or clear (bypass) anyone. **Recommended production path:
multisig + timelock on network block/clearance, and a multi-attestor quorum.** Only
relevant when sanctions enforcement is armed (`activeScopeCount > 0`; ships OFF; counsel
gate G7).

### Institution-scoped blocks are not network containment, and auto-inert on institution death (Wave 8E-1)
By design (institution sovereignty), an **institution-scoped** sanctions block bites only
when the counterparty is *actively affiliated* to the enforcing institution; a true OFAC
hit must be **escalated to a network block** to contain a party network-wide, and that
escalation is a manual human decision with no on-chain forcing function or SLA. Separately,
a scoped block silently **stops enforcing** (no event) once the enforcing institution's
lifecycle mode is `DEFAULTED`/`RESOLVED`; the bounded `clearDefunctInstitutionBlocks`
janitor later removes the rows. Network blocks (the catch-all) are unaffected. Each
institution also opts its own sanctions enforcement in/out (`institutionSanctionsEnabled`,
audited via `InstitutionSanctionsEnabledSet`), so consortium coverage = the network
authority's blocklist + each institution's opt-in. Disclosed; tied to counsel gate G7.

### DepositorIdentity shared-salt cross-bank correlation (Wave 8E-2) — counsel gate G9
`DepositorIdentityFacet` (FDIC 12 CFR 370 pass-through TIN-hash registry, promoted to the active
manifest in 8E-2, **recording-only**) hashes TINs with a **shared network salt per epoch** so that
two banks can detect that the *same* depositor is registered at both (the reciprocal-deposit conflict
check). The tradeoff: within an epoch, colluding consortium members can **correlate the same customer
across banks** by comparing hashes — the registry is privacy-reducing by construction. Per-bank salts
would restore unlinkability but would **break** the cross-bank conflict check that is the feature's
entire purpose. Salt rotation (`rotateSalt`, with a transition window) bounds the correlation window
to an epoch but does not eliminate it. On-chain data is boolean/hash only (no PII, no amounts;
capacity allocation stays off-chain to prevent inference attacks). This is a **disclosed counsel
tradeoff** (gate G9): counsel must sign off on the cross-bank correlation posture before
`cip_enforce_active` / any DepositorIdentity-driven enforcement is activated. Recording-only today;
not wired into any enforcement gate. *Both conflict-probe views (`checkDepositorConflict` and
`batchCheckDepositorConflicts`) are gated behind `CUSTODIAN_ROLE` (8E remediation), which raises the
bar against casual probing but does not eliminate the residual correlation — an off-chain `eth_call`
can still spoof `from`, and colluding custodian members can correlate within an epoch. The shared-salt
posture remains the load-bearing G9 item.*

### FDIC 12 CFR 370 reporting endpoint is metadata-only by design (Wave 8F) — counsel gate G9
`GET /compliance/fdic-370` (indexer-derived, officer-gated, `formatVersion: DRAFT`) is an
**exam-support metadata surface, not a 12 CFR 370 determination**. It returns per-bank net active
hash counts, cross-bank conflict rows (correlation-sensitive `tinHash`, behind the
`COMPLIANCE_OFFICER_ROLE` gate), salt-epoch lineage, and CIP coverage per custodian. It deliberately
exposes **no per-owner, per-category, or dollar/balance data** — the actual per-depositor,
per-ownership-category insurance calculation is the bank's off-chain responsibility, by design (the
on-chain registry is boolean/hash-only to avoid inference attacks). Notably, **dollar-denominated
institution-liability totals are intentionally NOT built**: there is no on-chain per-depositor balance
to aggregate, and emitting one would manufacture an insurance-coverage representation the framework
explicitly disclaims. `activeHashCount` is an all-time net of add/remove events with a clamp-at-zero
and an `underflowDetected` flag (it is a recordkeeping count, not a live registry size). Salt-epoch
`supersededBy` is overlap-aware (an `emergencySaltCompromise` supersedes *every* epoch active at its
moment, earliest emergency wins) to match contract semantics. Tied to counsel gate G9: no 12 CFR 370
compliance or insurance-completeness is represented.

### CIP enforcement labeled default-OFF / counsel-pending (Wave 8E-2) — counsel gate G9
The 8E-2 CIP layer (`cip_enforce_active` + `ComplianceRequirementLib._requireCIP`) is **enforcement-capable
plumbing, gated OFF by default**, not an operating customer-identification program. It enforces the
*presence* of a recorded CIP attestation; the underlying identity verification is the bank's off-chain
responsibility. Do not read a shipped CIP/BSA program from the presence of the gate. Activation is
blocked by counsel gate G9.

## Dependencies (DEP-1 — originally triaged 2026-06-18, re-audited 2026-08-25)

The deployed smart contracts have **no** npm runtime dependency. All non-breaking
(`npm audit fix`, no `--force`) fixes have been applied across every tree; the
**residual findings all require breaking major upgrades** and are deferred to a
dedicated dependency-upgrade pass.

Post-fix `npm audit` snapshot:

Re-audited 2026-08-25 after a dependency pass. Two numbers matter, and they differ
a lot — `npm audit` counts the whole dev/build chain, while `npm audit --omit=dev`
counts what a consumer of the running software is actually exposed to.

| Tree | production-only (`--omit=dev`) | full tree | notes |
|---|---|---|---|
| root | **clean** | 22 low / 13 mod / 7 high | Every root advisory is Hardhat build tooling. 5 of the 7 highs are fixable only by Hardhat 3.x, a breaking migration. |
| indexer | 2 mod / 4 high | 2 mod / 10 high | All pinned by `ponder@0.15`: `@hono/node-server`, `vite`, `esbuild`, `kysely`. |
| relayer | 1 low | 1 low | |
| keeper | 1 low | 1 low | Ships DISABLED and triple-gated. |

**No production-reachable critical anywhere.** What the pass fixed:
- `drizzle-orm` upgraded to 0.45.2 via an npm override, closing an SQL-injection
  advisory (improperly escaped SQL identifiers) that `ponder@0.15` had pinned.
- A **peer-dependency conflict** was resolved: `package.json` declared
  `hardhat ^2.26.1` while pulling `hardhat-verify ^3.0.2` and `hardhat-ignition
  ^3.0.3`, both of which require `hardhat ^3.8.0`. `npm ci` reported an
  unsatisfiable peer on a fresh clone. Pinned to the Hardhat-2 lines
  (`hardhat-verify ^2.1.3`, `hardhat-ignition ^0.15.16`); zero invalid peers now.

**Deliberately NOT done, and why:**
- **`kysely` was NOT upgraded**, despite a published SQL-injection advisory.
  `kysely@0.29.x` removes the `Migrator` export that `ponder@0.15` imports, so the
  override breaks the indexer at startup. Typecheck and all 53 indexer tests still
  passed with it applied — only running `ponder --version` revealed the failure.
  Fixing this requires moving off `ponder@0.15`, not an override.
- **`ponder` was NOT upgraded** to 0.17.x. It was tried and reverted: it resolved
  zero advisories (the pins carry forward) and hit the same `kysely` breakage.
- **Hardhat 3.x** would clear 5 root highs but is a breaking migration of the whole
  build, out of scope for this release.

## Not part of this release

`gateway/`, `mcp-server/` and `ui-management/` are **not included in this public
release**. They exist in the development repository but were held back as not yet
release-caliber, so nothing in this repository depends on them and no issue below
applies to code you can read here.

All three are **planned for a fast-follow release**, each with a scoped
reinstatement effort. Their known issues are listed here for completeness, and
because they explain what "not yet release-caliber" actually meant:

| Component | Status at exclusion | Known issues |
|---|---|---|
| `gateway/` | builds and typechecks; zero test files; a large unwired pipeline | 1 dev critical (vitest/vite), 9 high — production-reachable: fastify 4→5, drizzle-orm, viem/ws. its cambio-bearer path (in the gateway's own tree, not this repository) is an incomplete preview whose bearer-redemption forward request is a stub (placeholder nonce/signature), never wired for production submission. Webhook auth is a plaintext shared secret (`ponder-listener.ts`, `// TODO: HMAC`). |
| `mcp-server/` | builds; zero tests | 1 high — `@modelcontextprotocol/sdk` needs an SDK major. Write path defaults to enabled with no allowlist or caps. |
| `ui-management/` | type-checks; `next build` passes; Playwright smoke 3/3 | 12 high — needs wagmi v2 + viem v2 + rainbowkit v2 (breaking API rewrite). Demo passwords are exposed through `NEXT_PUBLIC_*` vars. |

Do not read the sections below as applying to these components.

## Services (preview-grade)

The three services in this release — `indexer/`, `relayer/` and `keeper/` — are
preview-grade. They build and their tests pass, but none has production operating
history.

- **`keeper/`** ships **DISABLED** and triple-gated. It performs no settlement action
  unless an operator explicitly enables it, and the `settlementModelActive` gate is
  off by default besides.
- **`indexer/`** carries four production-reachable high advisories pinned by
  `ponder@0.15` (see Dependencies above), one of which — `kysely` — is knowingly
  unpatched because the patched version breaks `ponder` at startup.
- **`relayer/`** has one low advisory and no known functional gaps, but it holds a
  funded key in operation; review `relayer/README.md` before deploying it anywhere
  that matters.

Issues for `gateway/`, `mcp-server/` and `ui-management/` are under
"Not part of this release" above — those components are not in this repository.

## Operational

- Local devnet runs **N=4 QBFT validators** (tolerates 1 fault; halts at 2). Not
  a production topology — production targets ≥7 independent validators.
- Settlement keeper, reconciliation jobs, and the full compliance/banking indexer
  API are partial/in-progress (Waves 6–7).
