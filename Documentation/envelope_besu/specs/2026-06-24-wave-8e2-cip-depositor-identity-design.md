# Wave 8E-2 — BSA/CIP Attestation + DepositorIdentity Promotion (Design Spec)

**Date:** 2026-06-24 · **Basis:** `main` post-8E-1 (`14e47796`) · **Status:** DRAFT — authored
autonomously under the standing autonomy grant; decision points resolved below and flagged for Jesse's
later review (he is unattended). Builds on the 8E-1 scoping/sanctions wave.

> **Counsel-gated, default-OFF.** This builds the *engineering scaffolding* for BSA/CIP (31 CFR
> 1020.220, USA PATRIOT Act §326) customer-identification recordkeeping and FDIC 12 CFR 370 pass-through
> recordkeeping. It does **not** run a CIP program and does **not** substitute for counsel. The CIP
> enforcement gate (`cip_enforce_active`) ships **OFF**; DepositorIdentity is recording-only (no
> enforcement). **No PII on chain** (ADR-004): only completion timestamps + opaque hash pointers.

---

## 0. Scope of this wave

8E was split at 8E-1. 8E-2 completes the original 8E §168 of the Wave 8 FINAL plan:

1. **CIP attestation** — record that a wallet's customer identity was verified (hash pointer + completion
   timestamp, no PII), under the existing custody authority.
2. **`requireCIP` enforcement** — a new REQUIREMENT control (relaxable, exemption-gated, most-specific-
   wins), wired into `ComplianceRequirementLib.assertRequirements` behind the already-reserved
   `cip_enforce_active` policy key. Ships OFF.
3. **DepositorIdentity promotion** — move `DepositorIdentityFacet.sol` from the former optional tree into the active manifest
   (FDIC 12 CFR 370 pass-through TIN-hash registry), remove INACTIVE/DESIGN-STAGE markers, reconcile, and
   wire the integrity gates.

**Explicitly NOT in 8E-2:** the FDIC `/compliance/fdic-370` exam endpoint and per-beneficial-owner
balance reporting (that is **8F**, which depends on the hashes this wave lands). No PII transport. No
re-verification scheduler (CIP is one-time; re-verification is event-driven and out of scope).

---

## 1. Fixed constraints (treat as given)

1. **No PII on chain.** CIP record = `bytes32 cipRecordHash` (opaque off-chain-document pointer) +
   `uint256 cipCompletedAt`. DepositorIdentity = salted TIN *hashes* only (already its model).
2. **Default-OFF.** `cip_enforce_active` network policy key defaults `0` → `requireCIP` is a no-op until
   armed. Arming participates in the same `activeScopeCount` monotonic counter as the other REQUIREMENT
   controls (so the `ComplianceLib.precheck` fast path stays a single `count > 0` short-circuit).
3. **CIP is one-time** (BSA §326). No expiry field; `requireCIP` is a *presence* check
   (`cipCompletedAt != 0`), not a freshness check. Revocation is explicit (custodian-initiated), mirroring
   how KYC can be revoked.
4. **Two-library split preserved (8E-1 P1).** CIP is a REQUIREMENT control → lives entirely in
   `ComplianceRequirementLib` (relaxable, may route through `getEffectivePolicy`). It never touches
   `ComplianceSanctionsLib`.
5. **Storage discipline (8E-1 P5).** Additive only; tail-append; no field reorder; storage-layout gate
   must stay green.

---

## 2. CIP attestation storage (D1 — DECIDED: co-locate in CustodyData)

**Decision D1:** tail-append two fields to `StorageLib.CustodyData`:

```solidity
struct CustodyData {
    address custodian;
    uint256 kycValidatedTimestamp;
    uint256 kycExpiresTimestamp;
    uint256 cipCompletedAt;   // 8E-2 tail-append — 0 = no CIP record
    bytes32 cipRecordHash;    // 8E-2 tail-append — opaque off-chain pointer, no PII
}
```

**Rationale.** CIP is a sibling per-wallet identity attestation to KYC, written by the same custody
authority. Co-locating keeps the wallet's compliance attestations in one place and reuses the custody
write path. `CustodyData` lives in `mapping(address => CustodyData) _custodyInfo` — tail-appending to a
struct stored in a mapping is storage-safe (each entry's fields are sequential from `keccak(key, slot)`
with nothing following). **Alternative considered (B):** a dedicated `CIPStorage` lib with its own slot —
rejected as over-isolation for two fields that share the custody lifecycle. *(Flag for Jesse: if you want
CIP fully decoupled from custody — e.g. a different attestor than the KYC custodian — switch to B.)*

The storage-layout snapshot in `scripts/check-storage-layout.js` must be refreshed and the gate must pass.

**MUST-FIX (panel HIGH):** `CustodianRegistryFacet.registerCustodiedWallet` (`:114-118`) assigns
`CustodyData` via a **named struct literal** with exactly the 3 current fields. Adding the two CIP fields
makes that literal fail to compile. The build agent MUST update the literal to include
`cipCompletedAt: 0, cipRecordHash: bytes32(0)` (named syntax — do **not** switch to positional, which
risks misassignment). This is the correct initial state and is re-applied safely on any re-registration
(unregister `delete`s the whole slot).

---

## 3. CIP recording surface (D2 — DECIDED: CustodianRegistryFacet)

**Decision D2:** add CIP recording to `CustodianRegistryFacet` (the facet that already owns KYC custody),
authorized by `CUSTODIAN_ROLE` (same authority that records KYC), with the institution-scoped variant
deferred (YAGNI; CIP today is the custodian's responsibility for its own customers, mirroring KYC).

New functions:
- `recordCIP(address wallet, bytes32 cipRecordHash)` — sets `cipCompletedAt = block.timestamp`,
  `cipRecordHash = cipRecordHash`; emits `CIPRecorded(wallet, cipRecordHash, custodian, timestamp)`.
  Guards (mirror `updateKYCStatus` exactly): `CUSTODIAN_ROLE`; `wallet != address(0)`;
  `cipRecordHash != bytes32(0)` else `CIPRecordHashRequired()`; **and custodian-of-record**
  `if (data.custodian != msg.sender) revert StorageLib.CallerNotRegisteredCustodian();` — the wallet must
  already be registered to the calling custodian (a custodian cannot write CIP for another bank's
  customer, and CIP cannot exist without a custody record).
- `revokeCIP(address wallet)` — zeroes both CIP fields; emits `CIPRevoked(wallet, custodian, timestamp)`.
  Guards: `CUSTODIAN_ROLE`; `wallet != address(0)`; **custodian-of-record**
  `if (data.custodian != msg.sender) revert StorageLib.CallerNotRegisteredCustodian();`; `CIPNotFound` if
  `cipCompletedAt == 0`.
- View `getCIP(address wallet) returns (uint256 cipCompletedAt, bytes32 cipRecordHash)` — gated by the
  existing `ViewACLLib` wallet-access control used for `getKYCTimestamps`.
- View `hasCIP(address wallet) returns (bool)` → `cipCompletedAt != 0`.

Errors: `CIPRecordHashRequired()`, `CIPNotFound(address wallet)` (revoke on empty). Reuse the existing
`StorageLib.CallerNotRegisteredCustodian()` for the custody-boundary guard (same error `revokeKYC`/
`updateKYCStatus`/`unregisterCustodiedWallet` use at `CustodianRegistryFacet.sol:139/165`).

> **Panel HIGH (resolved here):** without the custodian-of-record guard, any `CUSTODIAN_ROLE` holder could
> revoke/overwrite another bank's customer CIP record — a custody-boundary violation with regulatory
> impact. The guard above closes it, matching the existing KYC mutators.

**Rationale.** Reuses the established custody authority and ViewACL pattern; no new role. *(Flag for Jesse:
if CIP attestation should be performed by a scoped attestor distinct from the KYC custodian — paralleling
`SCREENING_ATTESTOR_ROLE` — say so and we add an institution-scoped variant in a follow-up.)*

---

## 4. `requireCIP` enforcement (D3 — DECIDED: mirror `_requireKyc` placement, presence-check)

**Decision D3:** extend `ComplianceRequirementLib.assertRequirements` with a CIP arm that mirrors the KYC
arm exactly, gated independently by `cip_enforce_active` (most-specific-wins via `getEffectivePolicy`):

```solidity
function _cipRequired(address wallet) internal view returns (bool) {
    (uint256 value, ) = IInstitutionPolicy(address(this)).getEffectivePolicy(wallet, CIP_ENFORCE_ACTIVE);
    return value != 0;
}

function _requireCIP(StorageLib.AppStorage storage ds, address wallet, ComplianceLib.Context ctx) internal view {
    if (ds._custodyInfo[wallet].cipCompletedAt == 0) {
        revert ComplianceLib.ComplianceCIPRequired(wallet, uint8(ctx));
    }
}
```

Context placement mirrors KYC (consistency; one mental model for both REQUIREMENT controls):
- `WALLET_TRANSFER` → both `from` and `to`
- `ESCROW_IN` → `from`
- `ESCROW_RELEASE` → `to`
- `RECOVERY_MIGRATE` → `to`
- `BANK_MINT` → **skip** (CIP is a customer-account attestation; mint targets a bank credit leg already
  governed by `_bankEligible`, not a customer identity).

New error `ComplianceLib.ComplianceCIPRequired(address wallet, uint8 ctx)`.

> **Panel LOW (note for the build agent):** unlike KYC, the `RECOVERY_MIGRATE` arm does **not** need a
> `ComplianceStatusLib` wrapper. KYC routes `RECOVERY_MIGRATE` through `kycStatusOf` because KYC has a
> recovery-resolution/affiliation layer; CIP is a flat presence check (`cipCompletedAt != 0`) for every
> context. Use the same `_requireCIP` body for all four screened contexts — do not add an asymmetric
> recovery branch.

**Arming + counter.** `cip_enforce_active` writes go through `InstitutionPolicyFacet` exactly like
`kyc_enforce_active`/`travel_rule_enforce_active` — already enumerated as a recognized compliance key
(`InstitutionPolicyFacet.sol:427/475`), already incrementing/decrementing `activeScopeCount`. **No new
arming plumbing needed** — only the requirement-side read in `ComplianceRequirementLib`. Exemption
(raising/relaxing) reuses the 8E-1 `COMPLIANCE_EXEMPTION_ROLE` path already applied to requirement keys.

**`isCipEnforceActive()` view** (`ComplianceConfigFacet.sol:62`) already reads the network policy key —
no change; it becomes meaningful once the requirement is wired.

---

## 5. DepositorIdentity promotion (D4 — DECIDED: promote as-is, recording-only)

**Decision D4:** promote `DepositorIdentityFacet.sol` from the former optional tree into the active manifest unchanged in
behavior (it is functional — 39-line surface verified: submit/batch/remove/check-conflict/salt-epoch
rotation/views). Steps:

1. **Move** `DepositorIdentityFacet.sol` from the former optional tree → `contracts/facets/DepositorIdentityFacet.sol`. While
   moving, add the missing `nonReentrant` guard to `batchCheckDepositorConflicts` (panel LOW — it mutates
   state/emits + increments a counter but lacks the guard the sibling submit/remove functions carry).
2. **Remove INACTIVE/DESIGN-STAGE markers** in `contracts/interfaces/IDepositorIdentity.sol:8` and
   `contracts/lib/DepositorIdentityStorage.sol:31` (replace with an active-manifest NatSpec + the privacy
   caveat from §6).
3. **Register** in `scripts/lib/facet-manifest.js` (the single source of truth — manifest length goes
   40 → 41).
4. **Fixture** — add to `test/helpers/deployment.js`.
5. **ABI/gates** — `node scripts/regenerate-indexer-abi.js`; `selector-collision-check`;
   `check-manifest-abi-parity`; `check-storage-layout`; clean deploy.
6. **Reconcile** — DepositorIdentity is FDIC pass-through *recordkeeping* (boolean cross-bank TIN-conflict
   check), a **separate axis** from KYC/affiliation/CIP. It is **not** wired into `assertRequirements` and
   places **no** enforcement gate. NatSpec must state this explicitly to avoid future confusion with the
   compliance-requirement controls.

**Rationale.** The facet is complete and harness-tested; promotion is a manifest/registration exercise,
not new logic. Keeping it recording-only honors the "attestation on-chain / process off-chain" philosophy
and avoids coupling FDIC recordkeeping to the transfer-enforcement path. *(Flag for Jesse: promotion adds
a 41st facet and ~10 selectors; confirm you want it in the public-promotion snapshot now vs. holding for
8F when its exam endpoint lands.)*

---

## 6. Privacy caveat (D5 — DECIDED: disclose, do not re-engineer)

The DepositorIdentity registry uses a **shared network salt per epoch** so a given TIN hashes identically
across banks within an epoch — this is **required** for the cross-bank conflict check (FDIC 12 CFR 370
pass-through). The cost: two colluding consortium members could correlate a depositor across banks within
an epoch. **Per-bank salts** would close the correlation hole but **break** the cross-bank check.

**Decision D5:** disclose, don't re-engineer. Add to:
- `KNOWN-ISSUES.md` (new entry: "DepositorIdentity shared-salt cross-bank correlation — counsel tradeoff").
- NatSpec on `DepositorIdentityFacet` + `DepositorIdentityStorage`.
- `COMPLIANCE-MATRIX.md` row update (see §8).

Salt-epoch rotation (already built) limits the correlation *window* but does not eliminate it. Per-bank
salts remain a documented counsel-decision, not a code change.

---

## 7. Indexer (D6 — DECIDED: CIP + DepositorIdentity events; no FDIC endpoint yet)

**Decision D6:** add to `indexer/`:
- Schema tables + Ponder handlers for `CIPRecorded`/`CIPRevoked` and the DepositorIdentity events
  (`DepositorHashSubmitted`/`Removed`/`SaltEpochRotated`/etc. — enumerate from the promoted ABI).
- A read endpoint `/compliance/cip` (exam surface: which wallets have CIP, by custodian, over time)
  mirroring the existing `/compliance/screening` and `/compliance/travel-rule` shape.
- **No** `/compliance/fdic-370` endpoint — that is 8F.

ABI-parity gate must confirm the library-emitted events are present in the regenerated indexer ABI
(8E-1 lesson: verify emitted events are caught by parity, not just function selectors).

---

## 8. Docs touched (post-build, doc-staleness gate)

- `COMPLIANCE-MATRIX.md` row 18 (BSA/CIP): `NOT-BUILT (gate reserved)` →
  `ATTESTATION + ENFORCED-GATED (8E-2)`; on-chain = `CustodyData.cipCompletedAt`/`cipRecordHash`;
  enforcement = `cip_enforce_active` gate → `ComplianceRequirementLib._requireCIP`; reporting = indexer
  `/compliance/cip`.
- `COMPLIANCE-MATRIX.md` row 19 (FDIC 12 CFR 370): DepositorIdentity moves *out* of the former optional tree →
  `ATTESTATION` (registry live, recording-only); reporting still `8F (DRAFT) planned`.
- `KNOWN-ISSUES.md`: shared-salt correlation caveat (§6).
- `README.md`: facet count 40 → 41; add DepositorIdentityFacet under Banking/Consortium; note CIP under
  Rules/Compliance.
- Contributor-guidance facet-group list (private repo `CLAUDE.md`, not published): add DepositorIdentity to the active set; drop it from the former optional-tree note.
- Wave 8 FINAL plan execution-status table: mark 8E-2 MERGED.

---

## 9. Files / surfaces touched (anticipated)

**Contracts:**
- `contracts/lib/StorageLib.sol` — CustodyData tail-append (§2).
- `contracts/facets/CustodianRegistryFacet.sol` — recordCIP/revokeCIP/getCIP/hasCIP + errors + events (§3).
- `contracts/interfaces/ICustodianRegistry.sol` (or wherever custody iface lives) — new signatures/events.
- `contracts/lib/ComplianceLib.sol` — `ComplianceCIPRequired` error + (if needed) Context unchanged.
- `contracts/lib/ComplianceRequirementLib.sol` — `_cipRequired`/`_requireCIP` + arm in `assertRequirements` (§4).
- `contracts/facets/DepositorIdentityFacet.sol` — moved from the former optional tree (§5).
- `contracts/interfaces/IDepositorIdentity.sol`, `contracts/lib/DepositorIdentityStorage.sol` — remove
  INACTIVE markers; add privacy NatSpec (§5/§6).

**Config / gates:**
- `scripts/lib/facet-manifest.js` (40 → 41); `test/helpers/deployment.js`; regenerate indexer ABI;
  refresh storage-layout snapshot.

**Indexer:** `indexer/ponder.schema.ts`, `indexer/src/index.ts`, `indexer/src/api/` new `/compliance/cip`.

**Tests (TDD, per-task commits):**
- CIP recording: record/revoke/empty-hash-revert/view-ACL/event.
- `requireCIP` enforcement: OFF = no-op (P4 acceptance); ON = missing-CIP reverts per context; exemption
  relaxes; most-specific-wins (wallet over institution over network).
- DepositorIdentity promotion: existing harness tests run against the **production manifest** (not a test
  harness facet); manifest/parity/collision/storage gates green.

**Docs:** §8 list (handled in the doc-staleness gate step, post-build).

---

## 10. Default-OFF verification (P4 acceptance — MUST hold)

With a fresh deploy and **no** compliance keys armed:
- `activeScopeCount == 0` → `ComplianceLib.precheck` short-circuits; `requireCIP` never runs.
- A transfer between two wallets with **no** CIP record succeeds.
- Arming only `cip_enforce_active` at network scope: a non-CIP wallet's transfer now reverts
  `ComplianceCIPRequired`; recording CIP then unblocks it; relaxing via exemption unblocks it.
- DepositorIdentity placing/removing hashes never affects any transfer (recording-only).

**Panel MEDIUM — counter-vs-scoped-exemption test (MUST add).** `activeScopeCount` is decremented by
wallet/institution-scoped *relaxations* (`InstitutionPolicyFacet._applyScopeDelta`). Arm
`cip_enforce_active` at network scope, then grant a wallet-scoped exemption (override = 0): assert
`activeScopeCount > 0` (network arming still counts) **and** that a *different*, non-exempt wallet still
reverts `ComplianceCIPRequired`. This guards against a regression where enough scoped relaxations could
drive the counter to 0 and silently disable the fast-path for everyone. *(This is an inherited 8E-1 scope
artifact, not introduced by 8E-2 — but 8E-2 must not ship it untested.)*

---

## 11. Decision points — RESOLVED (flagged for Jesse's review)

| # | Decision | Resolution | Reversible? |
|---|---|---|---|
| D1 | CIP storage location | Co-locate in `CustodyData` (tail-append) | Yes (pre-arm) — switch to dedicated `CIPStorage` |
| D2 | CIP recording authority | `CustodianRegistryFacet` + `CUSTODIAN_ROLE` | Yes — add scoped attestor variant later |
| D3 | `requireCIP` semantics | Presence-check, mirror KYC contexts, skip BANK_MINT | Yes (gate OFF) |
| D4 | DepositorIdentity promotion | Promote as-is, recording-only, manifest 40→41 | Yes — revert to the former optional tree |
| D5 | Shared-salt privacy | Disclose (KNOWN-ISSUES + NatSpec); no code change | n/a |
| D6 | Indexer scope | CIP + DepositorIdentity events + `/compliance/cip`; no FDIC endpoint (8F) | n/a |

---

## 12. Build → review → gate sequence (standing Wave 8 directive)

1. **kimi-code build** (`--yolo --afk`, TDD per-task commits) against this spec, on branch
   `wave/8e-2-cip-depositor-identity`.
2. **Multi-SME Claude panel** (security / banking-regulatory / smart-contract-correctness — NOT codex):
   pressure-test the CIP enforcement wiring, the storage tail-append safety, the promotion gates, and the
   privacy disclosure. Fold findings (FIX-FIRST for any BLOCKER/HIGH).
3. **doc-staleness-audit** (REQUIRED gate) → remediate §8.
4. **Phase Transition Gate** (6 checkpoints) → merge to `main` → delete branch → update plan + memory.

All gates ship OFF. Counsel gates remain PENDING (block production, not build).
