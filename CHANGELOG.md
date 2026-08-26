# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-08-25 — MVP foundation

Initial public foundation of the T3 programmable fiat framework: an EIP-2535
Diamond ERC-20 deposit token with programmable transfer envelopes and per-bank
claim attribution, targeting a permissioned Hyperledger Besu consortium.

> Note: this is a foundation release, not a production-audited deployment. It has
> no production history. See the README for current scope and the planned waves.

### Added
- **Diamond core (EIP-2535):** proxy + DiamondCut/DiamondLoupe, manifest-driven
  facet registration (`scripts/lib/facet-manifest.js`) as the single source of
  truth for deploys, ABI generation, and the selector-collision / ABI-parity gates.
- **ERC-20 deposit token:** base, pausable, direct transfer, mint/burn, fee logic,
  admin facets with isolated diamond storage per module.
- **Programmable envelopes:** create / finalize / reverse / dispute lifecycle with
  configurable settlement type (CRYPTO_DIRECT, FIAT_INSTITUTIONAL) and expiration
  behavior (immediate, half-life decay, hold-until-manual, oracle-conditional,
  auto-reverse, dispute-hold). Includes SmartLock and envelope-inheritance facets.
- **Per-bank claim attribution:** consortium mints route through
  `IssuanceAccountingLib.mintAttributed`; envelope finalization routes through
  `ClaimAttributionLib.finalizeEnvelopeClaims` + `substituteLiability` for
  cross-institution settlement. Activated via `initializeClaimAttribution`
  (requires zero supply at init).
- **Consortium / banking:** multi-asset vault with factor-based collateral check
  (default 100% = 1:1; per-bank factors configurable), institution lifecycle /
  policy / registry, custodian registry, membership.
- **Rules / compliance:** rules engine + config, automated emergency response
  (role-gated, fail-closed).
- **Wallet recovery** state machine and **relayer fallback** (4-hour
  self-declaration) for ERC-2771 meta-transactions.
- **Services:** Ponder event indexer, ERC-2771 meta-transaction relayer, and the
  settlement keeper (ships DISABLED and triple-gated).

### Changed
- **Compliance arming observability (CF-R Obs-1):** the single `activeScopeCount`
  was split into per-control counters (`sanctionsScopeCount`, `kycScopeCount`,
  `cipScopeCount`, `travelRuleScopeCount`); `activeScopeCount()` remains as their
  sum and `complianceArmed()` reports any-armed. The legacy getters changed
  meaning: `isKycEnforceActive()` / `isCipEnforceActive()` /
  `isTravelRuleEnforceActive()` now report only the **network-scope** policy
  baseline, and `isScreeningEnforceActive()` reports whether any institution has
  per-institution sanctions enforcement enabled. Off-chain consumers that need
  "any scope armed" should migrate to the per-control `*ScopeCount()` views or
  `complianceArmed()`.
- **Policy relax guard (CF-R Obs-2):** lowering an enforcement-class policy
  below its effective parent — including via `setNetworkPolicy` and via
  `clearInstitutionPolicy` / `clearWalletPolicy` of a tighter override — now
  requires `COMPLIANCE_EXEMPTION_ROLE` and emits `ComplianceExemptionGranted`.
- **Escrow-creation recipient screening (K-F1):** `ESCROW_IN` compliance checks
  now screen the named recipient (payee-resolved through recovery) in addition
  to the sender. Cambio bearer notes (`to == address(0)`) remain exempt.
- **Bulk recovery release gating (CF-2 core):** `applyBulkPolicy` ConfirmFiat
  and `resolveCambioNotesBulk` cancel/expire releases now run the
  `ESCROW_RELEASE` compliance gate against the resolved payee before value
  moves. Envelope reverse/clawback refund legs are deliberately not gated yet —
  they route to admin hold in the compliance-hold work (D2).
- **Screening freshness enforcement (C-F9):** when sanctions are armed
  (`sanctionsScopeCount > 0`) and an admin has set `screeningStaleAfter > 0`,
  the sanctions precheck fails closed (`ComplianceScreeningStale`) for any
  checked party whose network screening is stale — including never-screened
  wallets (`lastScreenedAt == 0`), which is deliberately stricter than the
  informational `isScreeningStale()` view. The default window of 0 preserves
  prior behavior exactly.

### Security & hygiene
- Tier-0 remediations: restricted permissionless metric updates, role-gated
  emergency deactivation, custody-takeover guard, recovery paths routed through
  the issuer-domain escrow release overload, fail-closed emergency tests.
- Apache-2.0 license; Solidity SPDX headers retained pending owner decision;
  gitleaks configuration.

### Implemented but not production-activated
- Wave 4: single-bank attributed issuance capacity (quote / reserve / execute) —
  `IssuanceControlFacet`, behind the `capacityModelActive` admin gate.
- Wave 5: bilateral-net settlement cycle (open / propose / confirm / fund /
  finalize / fail) with replay-protected funding attestation —
  `SettlementCycleFacet`, behind the `settlementModelActive` admin gate.

### Not yet implemented
- Multilateral-net CCP settlement — the documented scale endgame, gated on a
  future ADR and counsel review. ADR-003 covers the bilateral-net design that
  shipped; multilateral is explicitly out of scope for this release.
