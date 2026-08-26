# Wave 8E — Scopable Compliance Controls + Sanctions Escalation Ladder (Design Spec)

> **Status: APPROVED — pressure-tested, decisions locked (2026-06-23).** Counsel-pending technical
> preview. Every control in this spec ships **OFF by default** and is counsel-gated. The
> on-chain layer is attestation/enforcement plumbing, **not** the off-chain screening/identity
> *process*. Verified against code at `feature/envelope-besu` (2026-06-23): manifest = 40 facets;
> `ScreeningStorage`, `ComplianceConfigStorage`, `ComplianceLib`, `ComplianceScreeningFacet`,
> `InstitutionPolicyFacet`, `ComplianceStatusLib`, `RoleConstants`, `InstitutionStorage` read fresh.
>
> **Adversarial pressure-test (2026-06-23):** independently reviewed by kimi-code
> and codex. Both verdicts:
> **proceed-with-changes.** This revision folds in the reconciled findings. **Two decision
> points (DP-A sanctions-enablement mechanism, DP-B recovery-timing fix) are called out in
> §12 and require your selection before implementation.**

## 0. Scope of this wave

This wave splits into **two sequenced pieces** (per product-owner Q3, 2026-06-23):

- **8E-1 (this spec, build first): Scoping + Sanctions escalation.** Make the four compliance
  controls scopable (network / institution / wallet) and replace the flat global sanctions
  block with the FLAGGED → institution-block → network-block → network-clearance ladder.
- **8E-2 (next wave, separate spec): CIP attestation + customer-identity subject layer**
  (DepositorIdentity promotion). 8E-1 is *shaped for* the customer subject but does not build it.

The CIP gate (`cipEnforceActive`) stays **reserved** through 8E-1; no CIP check is wired.

## 1. Fixed constraints (product-owner, treat as given)

1. The four controls (KYC / screening-sanctions / Travel Rule / CIP) become **scopable**
   (network / institution / wallet). **Requirement controls (KYC / Travel Rule / CIP)** reuse the
   existing `InstitutionStorage` three-tier precedence + `getEffectivePolicy`. **Sanctions
   enablement does NOT** — its enable-state lives off the policy stack entirely (see §3.4 / DP-A),
   because routing it through `getEffectivePolicy` would make it relaxable/exemptable, which P1
   forbids. "Ships OFF by default" preserved: every enablement default unset/0 = off.
   > *Pressure-test fix (both reviewers, PT2): the earlier draft said all four controls route
   > through `getEffectivePolicy`, directly contradicting P1. Resolved here — only requirement
   > controls use the resolver; sanctions never do.*
2. **Requirement controls** (KYC, CIP, Travel Rule): tighten freely at any scope; **relaxing
   below the network setting requires `COMPLIANCE_EXEMPTION_ROLE`** and emits a per-exemption
   audit event (scope, control, reason, grantedBy). Network stays strict; carve-outs are
   individually auditable. (Exemption = logged "sanctioned-style relaxation" — NOT a sanctions clear.)
3. **Sanctions/OFAC BLOCKED is NON-EXEMPTABLE.** But one institution's false-positive must not
   block a party network-wide with no recourse. Graduated ladder:
   - **FLAGGED** — informational, NO deny. Visible as a signal.
   - **INSTITUTION-SCOPED BLOCK** — an institution hard-blocks a party within its OWN
     enforcement scope. Does NOT propagate network-wide. Institution decides whether to escalate.
   - **NETWORK-BINDING BLOCK** — global hard-deny, non-exemptable; requires a network-level
     compliance authority (higher bar than a single institution attestor; quorum-ready future work).
   - **NETWORK CLEARANCE** — corrects a false positive at network level. This is a DATA
     CORRECTION ("not the sanctioned entity"), explicitly distinct from an EXEMPTION ("is
     sanctioned, let them through" — forbidden). Institutions retain discretion to keep their
     own scoped block even after a network clearance.

## 2. Load-bearing design principles (the spine — do not violate)

### P1 — Two winner-rules, two libraries, never crossed
- **Requirement controls → most-specific-wins** (relaxes): network → institution → [customer*] →
  wallet, resolved by `getEffectivePolicy`. A narrower scope may relax (gated by exemption role).
- **Sanctions → union / most-restrictive** (only adds): a party is denied if blocked at ANY
  applicable scope. A narrower scope may only ADD a block, never clear one. **Sanctions MUST
  NEVER route through `getEffectivePolicy`.**
- Enforced structurally by splitting the monolithic `ComplianceLib` into
  **`ComplianceRequirementLib`** (precedence, exemption-gated) and **`ComplianceSanctionsLib`**
  (union, escalation ladder). No unifying abstraction — unification is the documented path to
  accidentally exempting sanctions, which is forbidden.

### P2 — Bilateral institution sovereignty
An institution-scoped block by institution `I` bites **only within I's enforcement scope**, i.e.
only when `I` is the *active affiliation of the counterparty*. One institution can never reach
into another's flows. (Already the locked rule for institution blocks; extends to the customer layer.)

### P3 — Customer identity is institution-relative, not global (subject axis, deferred)
The customer subject (8E-2) is namespaced per institution: each institution owns its own
`customerId → {wallets}` graph and its own rules; customer-level enforcement propagates **only
within that institution's scope**. Overlapping wallets across institutions do NOT merge and do
NOT inherit each other's rules (corporate-owner example: a flagged owner at Bank X must not force
Bank X's flag onto Business B whose relationship Bank Y owns). 8E-1 is **address-keyed**; the
deny predicate and storage are shaped so the customer subject is a pure additive retrofit
(one resolver step + two namespaced mappings + one union term), no migration.

### P4 — Default-off is sacred
With no scoped gate enabled and network defaults unset, behavior is **byte-for-byte** today's
gated-OFF behavior. A cheap master short-circuit preserves the no-op fast path.

### P5 — Storage discipline
keccak-isolated slots; **tail-append only**; no reorder. Field-order snapshot enforced by
`scripts/check-storage-layout.js`. Every new mapping/field appended after current tails.

## 3. Gate architecture — policy keys authoritative (Q2 locked)

The four `ComplianceConfigStorage` bools are **retired as the authoritative read**. Authority
moves to scoped policy keys resolved through the three-tier model.

### 3.1 Compliance policy keys (new canonical keys — REQUIREMENT controls only)
```
kyc_enforce_active          = keccak256("kyc_enforce_active")
travel_rule_enforce_active  = keccak256("travel_rule_enforce_active")
cip_enforce_active          = keccak256("cip_enforce_active")         // reserved (8E-2)
travel_rule_threshold_usd   = keccak256("travel_rule_threshold_usd")  // replaces 8D single global threshold
```
- Add ALL of these to `InstitutionPolicyFacet._requireValidPolicyKey` allowlist (currently 4
  hardcoded keys). **Hazard flagged:** this is the single edit that turns scoping on; missing a
  key = silent `InvalidPolicyKey` revert at config time (fail-loud, acceptable).
- Value semantics for boolean controls: `0` = off, nonzero = on. Network default unset = `0` = off (P4).
- **`screening_enforce_active` is deliberately NOT in this allowlist.** Sanctions enablement is
  handled by §3.4, off the policy stack. *(Pressure-test fix, codex PT4: had `screening_enforce_active`
  been added to `_requireValidPolicyKey`, the generic `setWalletPolicy` would have accepted a
  wallet-scope screening relaxation — exactly the §8 hard-revert case. Keeping it out of the
  allowlist makes any such call hard-revert with `InvalidPolicyKey`, fail-loud.)*

### 3.2 Performance short-circuit (preserves P4 fast path) — COUNTER, not a bool
Reading effective policy for both parties on the hot path is heavier than 4 bool reads. We need a
cheap master short-circuit so the default-off path stays a single SLOAD. **A plain `bool
complianceArmed` is rejected** (both reviewers, PT3): a bool is a second source of truth that can
desync from the policy keys (set the bool on, clear the last key, bool stuck on = phantom
enforcement attempt; or worse, bool off + keys set = silent under-enforcement).

**Use a monotonic activation counter instead:**
```solidity
uint256 activeScopeCount;   // tail-append in ComplianceConfigStorage
```
- Incremented on the **first** arming write of any compliance scope; decremented on the write that
  **clears the last** activation of a scope. Intermediate arm/clear churn cannot desync it.
- `complianceArmed` becomes a derived view: `activeScopeCount > 0`. It is a **performance gate,
  NOT an authority** — it can only be > 0 if some scope actually armed a control, and the
  authoritative read is still the per-scope state. A counter that is wrong fails *loud* in the
  default-off regression suite (§9), not silently in production.
- (A per-control `uint256` bitmap is an acceptable alternative if we later want per-control
  short-circuit granularity; the counter is the minimal correct form for 8E-1.)
- Migration note: today `precheckGated` fires the external call on `kyc||screening`. After this
  wave it fires on `activeScopeCount > 0`. With nothing armed, count `== 0` ⇒ identical no-op.

### 3.3 Requirement-control exemption (constraint #2)
When a `setInstitutionPolicy` / `setWalletPolicy` write for a requirement-control key would make
the effective value **less strict than the network setting** (e.g. network `kyc_enforce_active=1`,
wallet override `=0`), the write path:
1. requires `COMPLIANCE_EXEMPTION_ROLE` (new), AND
2. emits `ComplianceExemptionGranted(scopeId, controlKey, reasonHash, grantedBy)`.
Tightening (override ≥ network) needs only the normal policy admin. This keeps the network strict
with individually-auditable carve-outs. **Screening/sanctions keys are excluded from this path** —
sanctions are non-exemptable and never relaxed via policy keys (P1).

### 3.4 Sanctions enablement — off the policy stack entirely (DP-A — DECIDED: dedicated bit)
> **Decision (2026-06-23): DP-A option 1 — dedicated per-institution bit.** Locked.
Sanctions enforcement must be enable/disable-able per institution **without** any path that could
relax or exempt it. The keystone recommendation from the pressure-test (codex PT8, kimi-aligned)
is to keep the sanctions enable-bit **out of `InstitutionPolicyFacet`/`getEffectivePolicy`
completely**, so `ComplianceSanctionsLib` never imports or calls the requirement resolver.

**Recommended (DP-A option 1): dedicated per-institution sanctions-enable bit in `ScreeningStorage`.**
```solidity
mapping(bytes32 => bool) institutionSanctionsEnabled;   // institutionId -> on/off, tail-append
```
Read ONLY by `ComplianceSanctionsLib._institutionEnforcing`. Set by `NETWORK_SCREENING_AUTHORITY_ROLE`
or the institution admin (scoped to its own id). This **structurally** dissolves PT2 (no relaxable
path can exist because the resolver is never on the sanctions code path) and removes the §3.1
allowlist hazard for screening.

**Alternative (DP-A option 2): a fenced `screening_enforce_active` policy key** that lives in the
policy stack but is hard-coded non-relaxable (union/most-restrictive, wallet-scope writes
hard-revert). This reuses existing config UX but keeps a *latent* adjacency between the sanctions
state and the relaxable resolver — one future refactor away from a cross. Both reviewers preferred
option 1 for exactly this reason; **option 1 was selected.**

### 3.5 Legacy `ComplianceConfigFacet` setters — explicit retirement (codex PT5, must be in spec)
The four legacy bool setters on `ComplianceConfigFacet` (`contracts/facets/ComplianceConfigFacet.sol`)
that write `ComplianceConfigStorage`'s flat bools **must be retired or redirected** in this wave —
not left to discipline. If they remain live while the keys become authoritative, an operator can
flip a legacy bool that the new read path ignores (or, worse, that a half-migrated path still
honors), producing a config that looks armed but isn't (or vice-versa). Action: each legacy setter
either reverts with a `Deprecated()` custom error or redirects to the scoped policy write path.
The legacy bools remain in storage (tail-safe) but are authoritative for nothing.

## 4. Sanctions storage model (additive, tier-agnostic)

`ScreeningStorage.Layout` today (verified):
```solidity
struct Layout {
    mapping(address => Screening) screenings;   // <-- becomes the NETWORK scope
    uint40 screeningStaleAfter;
}
```
Tail-append (no reorder):
```solidity
struct Layout {
    mapping(address => Screening) screenings;            // network scope (unchanged)
    uint40 screeningStaleAfter;                          // unchanged
    // --- 8E-1 additive tail ---
    // scopeId-keyed institution-scope screenings. scopeId == institutionId today;
    // group scopeIds reserved (future tier, see §8). Tier-agnostic for free (bytes32 either way).
    mapping(bytes32 => mapping(address => Screening)) scopedScreenings;
    // network clearance records (false-positive correction; distinct from exemption).
    mapping(address => NetworkClearance) networkClearances;
    // per-institution sanctions enablement (DP-A option 1; off the policy stack — §3.4).
    mapping(bytes32 => bool) institutionSanctionsEnabled;
}

struct NetworkClearance {
    uint40  clearedAt;
    address clearedBy;
    bytes32 reasonHash;
    uint8   previousStatus;   // audit: what it was before clearance
}
```
- **No global `wallet → customer` map in 8E-1.** When the customer subject lands (8E-2) it is
  namespaced `walletToCustomer[institutionId][wallet]` + `customerScreenings[institutionId][customerId]`
  (P3). Reserved, not built now.
- `NONE/CLEAR/FLAGGED/BLOCKED` enum unchanged.
- **Snapshot-gap note (codex PT4):** `scripts/check-storage-layout.js:33` parses only the first
  `struct Layout` and does not descend into value structs, so the field order *inside*
  `NetworkClearance` is **not** snapshot-protected. The reviewers split: kimi treats this as benign
  (a new struct's internal order can't break an existing slot), codex flags it as a latent footgun
  if `NetworkClearance` is ever reordered. Mitigation (cheap): add an explicit field-order comment
  + a dedicated unit test asserting `NetworkClearance` decoding, since the CI gate won't catch a
  reorder. No reorder is planned; this is a guard against future edits.

## 5. The deny predicate (sanctions, union, bilateral)

**The predicate MUST be context-aware** (both reviewers, PT1). The earlier draft screened both
parties unconditionally, which over-denies escrow/mint legs: `ComplianceLib.assertNotBlocked`
(`contracts/lib/ComplianceLib.sol:90-116`) already selects parties by context, and the sanctions
predicate must mirror that selection exactly or it changes today's enforcement surface.

**Party-selection matrix (mirrors live `assertNotBlocked`):**
| Context | check `from`? | check `to`? |
|---|---|---|
| `WALLET_TRANSFER` | yes | yes |
| `ESCROW_IN` (funds entering escrow) | yes | no (escrow sentinel) |
| `ESCROW_RELEASE` (escrow → payee) | no (escrow sentinel) | yes |
| `RECOVERY_MIGRATE` | no | yes (successor only) |
| `BANK_MINT` | **no** | **no** (live code does NO sanctions screening on mint) |

> *Reconciliation note: codex's corrected predicate included `BANK_MINT` in `checkTo`; that is
> wrong against the live code, which screens neither leg on mint. kimi's matrix (no mint screening)
> is the one adopted here. Confirmed against `ComplianceLib.sol:90-116`.*

```solidity
function assertNotSanctioned(address from, address to, Context ctx) internal view {
    (bool checkFrom, bool checkTo) = _partySelection(ctx);
    // checkFrom = WALLET_TRANSFER || ESCROW_IN
    // checkTo   = WALLET_TRANSFER || ESCROW_RELEASE || RECOVERY_MIGRATE
    // BANK_MINT => (false, false): no sanctions screening, matches live behavior

    address sFrom = checkFrom ? WalletRecoveryStorage._resolveRecoveryPayee(from) : address(0);
    address sTo   = checkTo   ? WalletRecoveryStorage._resolveRecoveryPayee(to)   : address(0);

    // 1. Network-binding block: non-exemptable, applies to each CHECKED party.
    //    A network CLEARANCE suppresses a network block (false-positive correction) but
    //    leaves institution-scoped blocks intact (institution discretion, §1.3).
    if (checkFrom) _requireNoNetworkBlock(sFrom);
    if (checkTo)   _requireNoNetworkBlock(sTo);

    // 2. Institution-scope block: bites only when the OTHER party is actively affiliated to
    //    an active, sanctions-enforcing institution that has blocked this party (P2 sovereignty).
    bytes32 fromInst = checkFrom ? _activeAffiliation(sFrom) : bytes32(0);
    bytes32 toInst   = checkTo   ? _activeAffiliation(sTo)   : bytes32(0);
    if (checkFrom && toInst != bytes32(0) && _institutionEnforcing(toInst)) {
        if (_scopedBlocked(toInst, sFrom) || _customerBlocked(toInst, sFrom))
            revert ComplianceSanctioned(sFrom);
    }
    if (checkTo && fromInst != bytes32(0) && _institutionEnforcing(fromInst)) {
        if (_scopedBlocked(fromInst, sTo) || _customerBlocked(fromInst, sTo))
            revert ComplianceSanctioned(sTo);
    }
}
```
Helper semantics:
- `_partySelection(ctx)`: returns the (checkFrom, checkTo) pair per the matrix above. Single source
  of truth for which legs are screened; must stay in lock-step with `ComplianceLib.assertNotBlocked`.
- `_requireNoNetworkBlock(p)`: revert iff `screenings[p].status == BLOCKED` AND not suppressed by a
  `networkClearances[p]` that post-dates the block. (Clearance is the *only* thing that lifts a
  network block; no exemption path exists — P1.)
- `_activeAffiliation(p)`: `walletAffiliations[p].institutionId` iff status == `Active`, else `bytes32(0)`.
- `_institutionEnforcing(inst)` (kimi PT7 — checks BOTH lifecycle enums): institution exists,
  `InstitutionStorage.InstitutionStatus == Active`, **AND** `InstitutionLifecycleStorage.InstitutionMode`
  is NOT in `{DEFAULTED, RESOLVED, FROZEN, SUSPENDED}`, **AND** `institutionSanctionsEnabled[inst]`
  (§3.4). The two enums are distinct (`{Inactive,Active,Suspended}` vs
  `{ACTIVE,SUSPENDED,FROZEN,DEFAULTED,RESOLVED}`) — both must be checked, mirroring
  `ComplianceStatusLib.sol:19-39`, not just registry `InstitutionStatus.Active`. This auto-inerts a
  stale block held by a defunct institution at read time (closes the stale-block-with-no-owner hazard).
- `_scopedBlocked(inst, p)`: `scopedScreenings[inst][p].status == BLOCKED`.
- `_customerBlocked(inst, p)`: **returns `false` in 8E-1** (kimi PT6). Present now so the predicate
  shape is byte-identical between 8E-1 and 8E-2 — the customer subject lands as a pure body change
  to this one helper (`walletToCustomer[inst][p] → customerScreenings[inst][customerId]`), with zero
  edits to the predicate. This is the additive-retrofit guarantee made concrete.

### 5.1 Edge cases (resolved)
| Case | Behavior |
|---|---|
| `address(0)` (mint/escrow sentinel) | not screened — `_partySelection` returns false for that leg (escrow/mint contexts) |
| `BANK_MINT` | neither leg screened (matches live `assertNotBlocked`); sanctions on mint is out of scope |
| `ESCROW_IN` / `ESCROW_RELEASE` asymmetry | only the real party leg screened (from-only / to-only), never the escrow sentinel |
| party with no affiliation | institution branch no-ops (only network block can bite) |
| both parties same institution | both branches evaluate against that one institution (intra-institution block works) |
| blocked party that *is* the institution admin | network block still applies to the address; institution-branch uses affiliation, not adminship |
| recovery in flight | checked legs resolved via `_resolveRecoveryPayee` before any status read |
| DEFAULTED/RESOLVED/FROZEN/Suspended institution holds a stale block | `_institutionEnforcing` returns false ⇒ block auto-inert |

### 5.2 Recovery-timing hole (DP-B — DECIDED: atomic migration)
> **Decision (2026-06-23): DP-B option 1 — atomic migration.** Successor screening/affiliation
> migrates in the same call that sets `recoverySuccessor`; the bypass window is eliminated at the
> source. A recovery-flow regression test must prove a BLOCKED source wallet's block survives the
> activation→completion boundary. Locked.
codex PT1 surfaced a real ordering hazard the predicate alone can't close. `recoverySuccessor` is
written at recovery **activation** (`WalletRecoveryFacet.sol:278`), but the new wallet's affiliation
and scoped-screening state migrate **later** in the flow (`:838`, `:871`).
`_resolveRecoveryPayee` (`WalletRecoveryStorage.sol:61`) redirects screening to the successor as soon
as the successor is set — so during the window between activation and state-migration, a transfer can
resolve a **blocked old wallet** to a **clean (not-yet-screened) successor**, briefly bypassing the
block. Options:
- **DP-B option 1 (recommended): migrate atomically** — move the successor's screening/affiliation
  migration into the same call that sets `recoverySuccessor`, eliminating the window. Cleanest, but
  touches the recovery flow ordering (needs a recovery-flow regression test).
- **DP-B option 2: union raw + successor during the window** — while recovery is in flight, screen
  BOTH the old wallet and the successor (most-restrictive), so a blocked old wallet still bites until
  migration completes. Predicate-local, but adds a hot-path read during recovery.
- **DP-B option 3: block recovery completion for a blocked wallet** — refuse to complete recovery
  while the source wallet carries an active BLOCKED status; forces the block to be cleared (or the
  successor explicitly re-screened) first. Strongest invariant, changes recovery UX.

**Option 1 (atomic migration) was selected** — see the DECIDED banner at the top of this section.

## 6. Roles

| Role | Constant | Scope | Purpose |
|---|---|---|---|
| Institution screening attestor | `SCREENING_ATTESTOR_ROLE` (exists) via `scopedRoles[institutionId][SCREENING_ATTESTOR_ROLE][acct]` | per-institution | record FLAGGED / institution-scoped BLOCK within own scope |
| Network screening authority | **`NETWORK_SCREENING_AUTHORITY_ROLE`** (new) | global | network-binding BLOCK + network CLEARANCE (higher bar) |
| Compliance exemption granter | **`COMPLIANCE_EXEMPTION_ROLE`** (new) | global | authorize requirement-control relaxations (constraint #2) |

- `scopedRoles[institutionId][SCREENING_ATTESTOR_ROLE][account]` is the right primitive for
  institution-scoped attestation (already exists, already used for institution-local roles).
- **`recordScreening` network-write must be restricted (kimi PT1).** Today
  `ComplianceScreeningFacet.recordScreening` (`contracts/facets/ComplianceScreeningFacet.sol:25-50`)
  writes the network `screenings` mapping with a single global attestor role. If an *institution*
  attestor can still write the network mapping, the "network block = higher bar" guarantee collapses
  — a single institution could place a network-wide block. Fix: institution attestors write ONLY
  `scopedScreenings[theirInstId][...]`; writes to the network `screenings` map (and
  `networkClearances`) require `NETWORK_SCREENING_AUTHORITY_ROLE`. This is the structural enforcement
  of the §1.3 "higher bar" promise.
- **Network authority is a single key today (both reviewers, PT8 banking risk).** A single
  `NETWORK_SCREENING_AUTHORITY_ROLE` holder can place/lift network-binding blocks unilaterally —
  acceptable for the counsel-pending preview but a real centralization risk for production. Documented
  path: multisig holder + timelock on network block/clearance, and eventually a multi-attestor quorum.
  Tracked in KNOWN-ISSUES; does not block 8E-1 build, gates production activation (counsel gate).
- **Single-attestor known-issue (KNOWN-ISSUES.md):** this design *improves* it — institution
  blocks are now scope-limited (a rogue institution attestor can only grief/bypass within its own
  flows, not network-wide), and the network-binding block requires a *distinct, higher-bar* role.
  It does not fully solve it (still single-key per scope; multi-attestor quorum remains future work).
- `grantScopedRole` should additionally let an **institution admin manage its own institution's
  attestors** (today it requires global admin). Bounded: an institution admin may only grant
  `SCREENING_ATTESTOR_ROLE` scoped to *its own* institutionId. (kimi recommendation.)

## 7. Clearance & lifecycle semantics

- **Network clearance** clears the network block only; institutions keep their own scoped blocks
  until each clears its own (legal de-risking discretion — §1.3). Correct autonomy boundary.
- **Inconsistent-state guards:**
  - A party network-cleared but still institution-blocked is *intended*, not a bug (institution
    discretion). It is never "globally stuck" — clearance always lifts the network block.
  - **Stale institution block with no owner** (institution lifecycle DEFAULTED/RESOLVED): handled
    two ways — (a) `_institutionEnforcing` auto-inerts non-Active institutions at read time, AND
    (b) a bounded janitor `clearDefunctInstitutionBlocks(bytes32 institutionId, address[] wallets)`
    (network authority) for explicit cleanup. No unbounded loops on the hot path (P-gas).

## 8. Deferred / reserved (YAGNI, "don't box us in")

- **Cross-institution group tier** (a `groupId` spanning multiple institutions): NOT built.
  Reserved via tier-agnostic `scopedScreenings[scopeId]` (group scopeIds are valid keys later) and
  a future precedence insertion network → group → institution → wallet (default-unset-safe).
  Decision recorded: **group-object beats peer "honor-edges"** (honor-edges = unbounded hot-path
  loop; group-object = bounded single lookup). Build only when a real shared-blocklist customer appears.
- **Customer subject layer (8E-2)**: shaped-for per §4/§5 retrofit points; built in the CIP wave.
- **Multi-attestor / quorum / bond / slashing** for screening: future work (tracked in KNOWN-ISSUES).
- **Per-wallet *sanctions* scope** (vs per-wallet *requirement* scope): deliberately not built;
  storage/resolver kept subject-agnostic so OFAC specific/general-license style per-party carve-outs
  could be added later under strict union semantics. Any future per-wallet sanctions scope must be
  union/most-restrictive and hard-revert (never silently relax). Wallet-scope screening gate config
  hard-reverts today rather than silently no-op.

## 9. Default-off verification (P4 acceptance)
A regression suite proving: with no scoped gate armed and network defaults unset,
`activeScopeCount == 0` (so the derived `complianceArmed` view is false), `precheckGated` is a
no-op, and every existing 8A–8D test passes unchanged. Plus: arming a control at one scope must not
change any other scope's behavior.

## 10. Facets / files touched (anticipated)
- `contracts/lib/ScreeningStorage.sol` — tail-append `scopedScreenings`, `networkClearances`,
  `NetworkClearance`, `institutionSanctionsEnabled` (DP-A opt 1); `NetworkClearance` field-order comment + decode test.
- `contracts/lib/ComplianceConfigStorage.sol` — add `activeScopeCount` (tail-append, §3.2); bools retained but authoritative for nothing.
- `contracts/facets/ComplianceConfigFacet.sol` — **retire/redirect the 4 legacy bool setters** (§3.5): revert `Deprecated()` or redirect to scoped writes.
- `contracts/lib/ComplianceLib.sol` → split into `ComplianceRequirementLib` + `ComplianceSanctionsLib` (keep `ComplianceLib` as thin facade for the inline `precheckGated` to protect EIP-170). **`ComplianceSanctionsLib` must NOT import `InstitutionPolicyFacet` or call `getEffectivePolicy` (P1/PT2).**
- `contracts/facets/ComplianceScreeningFacet.sol` — institution-scoped `recordScreening` (scoped writes only); **network `screenings`/`networkClearances` writes gated to `NETWORK_SCREENING_AUTHORITY_ROLE`**; clearance entrypoints; bounded janitor.
- `contracts/facets/InstitutionPolicyFacet.sol` — extend `_requireValidPolicyKey` with the **requirement** keys only (NOT `screening_enforce_active`); exemption-gated relaxation write path + event; institution-admin scoped-attestor grant.
- `contracts/lib/RoleConstants.sol` — `NETWORK_SCREENING_AUTHORITY_ROLE`, `COMPLIANCE_EXEMPTION_ROLE`.
- `contracts/facets/ComplianceGateFacet.sol` — route requirement vs sanctions to the split libs; pass `Context` through to the sanctions predicate.
- Travel Rule: migrate 8D single global threshold to the `travel_rule_threshold_usd` policy key (scoped).
- Manifest unchanged in count unless a new facet is needed for the split (prefer libraries to stay at 40).
- Indexer: new events (`ScopedWalletScreened`, `NetworkBlockPlaced`, `NetworkCleared`, `ComplianceExemptionGranted`, `DefunctInstitutionBlocksCleared`); ABI parity gate.
- Tests: deny-predicate **context matrix** (all 5 contexts × both legs), exemption path, clearance/stale-block (two-enum auto-inert), recovery-timing (per DP-B), default-off suite, `activeScopeCount` no-desync, `NetworkClearance` decode.
- Docs gate: COMPLIANCE-MATRIX, KNOWN-ISSUES, REGULATORY-STATUS + doc-staleness-audit before merge.

## 11. Confirmations carried into approval (resolved by pressure-test)
1. 8E-1 / 8E-2 split (sanctions+scoping now, CIP+customer subject next) — confirmed by product-owner Q3.
2. Master short-circuit is a **counter** (`activeScopeCount`), not a bool — both reviewers required this (§3.2).
3. Institution admins may grant their own institution's `SCREENING_ATTESTOR_ROLE` (bounded to own id) — kept (§6).
4. Travel Rule threshold migrates to a scoped policy key in this wave — kept (§3.1).
5. Sanctions never route through `getEffectivePolicy`; `ComplianceSanctionsLib` never imports the resolver — locked (§1, §3.4, P1).
6. Deny predicate is context-aware, mirrors live `assertNotBlocked`, excludes `BANK_MINT` — locked (§5).

## 12. Decision points — RESOLVED (2026-06-23)

- **DP-A — Sanctions enablement mechanism → Option 1: dedicated per-institution bit**
  (`institutionSanctionsEnabled` in `ScreeningStorage`, read only by `ComplianceSanctionsLib`).
  Structurally fences sanctions off the relaxable resolver. See §3.4.
- **DP-B — Recovery-timing fix → Option 1: atomic migration** (migrate successor screening/affiliation
  in the same call that sets `recoverySuccessor`). See §5.2.

Both decided. **Spec is implementation-ready.** Next: writing-plans → kimi build → multi-SME panel →
doc-staleness-audit → Phase Transition Gate.
