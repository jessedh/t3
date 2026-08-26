# Compliance Controls Matrix

> **Counsel-pending preview.** This maps regulatory concepts to the code that records or enforces them.
> "Enforcement scaffolding" means plumbing that gates flows on *recorded attestations* — it is **not**
> the screening/identity *process* (banks do that off-chain) and is **not** a validated compliance
> program. Every enforcement gate ships **OFF** by default. Status legend:
> **ATTESTATION** (on-chain record exists) · **ENFORCED-GATED** (a default-OFF gate can turn the record
> into a flow block) · **REPORTING** (indexer-derived exam surface) · **NOT-BUILT**.

| Regulation / control | On-chain record | Enforcement | Reporting | Status |
|---|---|---|---|---|
| KYC attestation (validity, expiry, revoke) | `CustodianRegistryFacet` → `CustodyData` timestamps; `ComplianceStatusLib.kycStatusOf`/`effectiveKycStatus` | `kycEnforceActive` gate → `ComplianceLib.precheck` at forward entrypoints; rules-engine `requireKyc`/`enforceDenyAt` | indexer KYC events | ATTESTATION + ENFORCED-GATED (8A/8B) |
| Institution lifecycle (suspend/default) affecting members | `InstitutionLifecycleStorage.institutionMode`; consumed by `kycStatusOf` (custodian→mode) | rides `kycEnforceActive` (DEFAULTED/RESOLVED → KYC-invalid) | indexer `InstitutionModeChanged` | ATTESTATION + ENFORCED-GATED |
| Wallet affiliation (suspend/revoke) | `InstitutionStorage.walletAffiliations` | rides `kycEnforceActive` | indexer `WalletAffiliationStatusChanged` | ATTESTATION + ENFORCED-GATED |
| Bank/issuer mint eligibility | `ConsortiumStorage.activeBanks` + `institutionMode` via `ComplianceLib._bankEligible` | `BANK_MINT` context under `kycEnforceActive` | — | ENFORCED-GATED (8B) |
| AML / sanctions screening | `ScreeningStorage` two-tier: **scoped** (per-institution, `recordScopedScreening`, scoped `SCREENING_ATTESTOR_ROLE`) and **network** (`recordNetworkScreening`/`recordScreening`, `NETWORK_SCREENING_AUTHORITY_ROLE`); each CLEAR/FLAGGED/BLOCKED + `listVersionHash` + attestor; per-institution `institutionSanctionsEnabled` bit (DP-A) | Escalation ladder FLAGGED → institution-scoped block → network-binding block → network-clearance, via `ComplianceSanctionsLib` (union / **most-restrictive / non-exemptable**), armed when `activeScopeCount > 0`. Only **BLOCKED** denies; FLAGGED never blocks. A **network** block bites every checked leg regardless of affiliation; an **institution-scoped** block bites *only* when the counterparty is actively affiliated to the enforcing institution **and** that institution is enforcing. | indexer `ScopedWalletScreened`/`NetworkBlockPlaced`/`NetworkCleared` + `/compliance/screening` | ATTESTATION + ENFORCED-GATED (8E-1) |
| FinCEN Travel Rule | `TravelRuleStorage` (per-envelope high-entropy `ref` + `satisfied`, originator-supplied) via `ComplianceTravelRuleFacet`; arming + threshold are now **scoped policy keys** (`travel_rule_enforce_active`, `travel_rule_threshold_usd`, most-specific-wins network→institution→wallet) | `ComplianceTravelRuleLib.bindOnCreate` at every escrow-in create: amount ≥ effective threshold reverts `TravelRuleRequired` unless a ref is bound (atomic at create; no release re-check; in-flight grandfathered). Raising a scoped threshold **above** the network baseline (screens fewer transfers) requires `COMPLIANCE_EXEMPTION_ROLE` and emits `ComplianceExemptionGranted`; lowering (stricter) is ungated. | indexer `TravelRuleAttached` + `/compliance/travel-rule` | ATTESTATION + ENFORCED-GATED (8D/8E-1) |
| BSA / CIP customer identification | `CustodianRegistryFacet` → `CustodyData.cipCompletedAt`/`cipRecordHash` (one-time presence, no PII; `recordCIP`/`revokeCIP`/`getCIP`/`hasCIP`, ViewACL-gated) | `cip_enforce_active` scoped key → `ComplianceRequirementLib._requireCIP` (flat presence check) at WALLET_TRANSFER (from+to) / ESCROW_IN (from) / ESCROW_RELEASE (to) / RECOVERY_MIGRATE (to); exemptable/relaxable via `getEffectivePolicy`; **not** BANK_MINT (customer-facing mint rides ESCROW_RELEASE) | indexer `CIPRecorded`/`CIPRevoked` + `/compliance/cip` | ATTESTATION + ENFORCED-GATED (8E-2; gate default-OFF, counsel-pending G9) |
| FDIC 12 CFR 370 pass-through recordkeeping | DepositorIdentity TIN-hash registry (`DepositorIdentityFacet`, **now in active manifest** as recording-only); shared network salt per epoch enables cross-bank conflict check (counsel-pending correlation tradeoff, G9) | **recording-only — not wired into enforcement** | Wave 8F indexer `GET /compliance/fdic-370` (officer-gated, `formatVersion: DRAFT`): per-bank net hash counts, cross-bank conflicts, salt-epoch lineage (overlap-aware supersession), CIP coverage per custodian; metadata/hash only — no per-owner/per-category/dollar data | ATTESTATION (recording-only); REPORTING DRAFT (8F, counsel-pending G9) |

## Enforcement architecture (Wave 8B → 8E-2)
- Controls are scoped at **network / institution / wallet** via policy keys (`kyc_enforce_active`,
  `travel_rule_enforce_active`, `travel_rule_threshold_usd`, `cip_enforce_active`), resolved
  most-specific-wins through `InstitutionPolicyFacet.getEffectivePolicy`. The four legacy
  `ComplianceConfigStorage` booleans are **retired** (authoritative for nothing); the legacy
  `ComplianceConfigFacet` bool setters revert `Deprecated()`; the KYC/Travel-Rule/CIP
  `is*EnforceActive()` views now read the scoped network policy keys, while
  `isScreeningEnforceActive()` reads the DP-A `sanctionsEnabledCount`.
- Enforcement is armed by a single monotonic counter, **`activeScopeCount`** in `ComplianceConfigStorage`,
  maintained by scoped-policy writes plus the DP-A sanctions enable bit (Solidity-0.8 underflow-revert makes
  any desync fail-loud). `complianceArmed()` is the derived `count > 0` view.
- `ComplianceLib.precheckGated` (tiny, inlined at each forward entrypoint) reads `activeScopeCount` and, only
  when `> 0`, calls `IComplianceGate(address(this)).enforceCompliance(...)` → `ComplianceLib.precheck`
  (the heavy logic lives once in `ComplianceGateFacet`, keeping hooked facets small / under EIP-170).
- The library was split: **sanctions** run via `ComplianceSanctionsLib.assertNotSanctioned` (union /
  most-restrictive / **non-exemptable**; never routed through the relaxable resolver and never reads
  `getEffectivePolicy`); **requirements** (`requireKyc`/`requireCIP`/Travel-Rule arming) run via
  `ComplianceRequirementLib` (most-specific-wins, relaxable, exemption-gated). Sanctions writes are split by
  authority: scoped `SCREENING_ATTESTOR_ROLE` (institution-scoped only) vs `NETWORK_SCREENING_AUTHORITY_ROLE`
  (network-binding block + clearance).
- Forward value-movement legs are hooked; **refund/reverse/cancel/sender-return legs are exempt** to
  preserve the Customer Made-Whole invariant.

### Sanctions enforcement caveats (8E-1, disclosed)
- **Institution-scoped blocks are not network containment.** A scoped block bites only when the counterparty
  is actively affiliated to the enforcing institution. A true OFAC hit MUST be escalated to a **network**
  block to contain a party network-wide; that escalation is a manual human decision with no on-chain forcing
  function. (See counsel gate G7.)
- **Scoped blocks auto-inert on institution death.** When an institution's lifecycle mode is `DEFAULTED` or
  `RESOLVED`, `ComplianceSanctionsLib` stops enforcing its scoped blocks at read time (no event); the bounded
  `clearDefunctInstitutionBlocks` janitor later removes the stale rows. Network blocks (the catch-all) are
  unaffected. Scoped blocks are therefore not durable across institution death.
- **Per-institution opt-in.** Each institution toggles its own sanctions enforcement (`institutionSanctionsEnabled`,
  DP-A, audited via `InstitutionSanctionsEnabledSet`). Consortium sanctions coverage = the network authority's
  blocklist + each institution's opt-in.

## Residual / out-of-scope (disclosed)
- Removed optional facets (RevenueDistribution, SponsorBankCoreFacet (RETAINED in the active manifest), ConsortiumYield, etc.) moved value and
  were **not** hooked — they are not in the active manifest. If ever reintroduced, they must be added to
  the hook surface.
- The screening/Travel-Rule/CIP enforcement is plumbing only; the actual screening, identity verification,
  and IVMS101 transport are off-chain / counsel- and vendor-driven (Waves 8C–8F).
