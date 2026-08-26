# Regulatory & Operational Status — Areas Requiring Additional Clarity

> **NOT FOR PRODUCTION USE. COUNSEL REVIEW PENDING.**
> This software is a research and reference implementation. It has **not**
> undergone regulatory, legal, or financial-services counsel review for
> production deployment. **NOTHING HERE IS LEGAL, REGULATORY, FINANCIAL, OR
> ACCOUNTING ADVICE.** This code does not create a bank deposit, an insured
> deposit, a deposit relationship, or any insurance, custody, or payment
> obligation. No representation of FDIC insurance, deposit treatment, or
> settlement finality is made or implied. Use at your own risk.

This document exists so the project can be published openly **with transparent
disclosure** of what is and is not settled. Disclosure here is **not** a
substitute for legal counsel and does not create any regulatory safe harbor.

## 1. What this is / is not

**It is:** an open-source reference implementation of an envelope-mode tokenized
deposit token (EIP-2535 diamond, Solidity 0.8.24) designed for a *permissioned*
Hyperledger Besu bank consortium (ADR-004). It runs locally against a throwaway
development blockchain.

**It is not:** a deployed product, a live financial system, a custodial service,
or a regulated deposit/payment offering. Running it locally creates no
real-world financial or regulated relationship. Both banking feature gates
(`capacityModelActive`, `settlementModelActive`) ship **OFF** by default.

## 2. Counsel-gate status

The settlement and claim-attribution models carry open legal questions that were
**deliberately not cleared** before this open-source release. They are tracked in
[`Documentation/envelope_besu/COUNSEL-GATES.md`](Documentation/envelope_besu/COUNSEL-GATES.md).
These gates block **production activation**, not local experimentation.

## 3. Scope of counsel sign-off actually obtained

The only counsel sign-off on record is **ADR-002 (reserve / deposit-origin
funding evidence)**, and it covers **funding-evidence accounting only**. It
explicitly does **not** cover deposit-insurance treatment or CIP/customer
characterization, and it defers deposit-origin characterization as non-blocking
audit metadata. ADR-002 must **not** be cited as broader legal cover.

## 4. Known regulatory gaps (program NOT IMPLEMENTED; enforcement scaffolding gated OFF)

Wave 8 added an **engineering enforcement surface** (a context-typed compliance
pre-check hooked at forward value-movement entrypoints). As of **Wave 8E-1** the
controls are **scoped policy keys** (`kyc_enforce_active` /
`travel_rule_enforce_active` / `travel_rule_threshold_usd` / `cip_enforce_active`),
resolved most-specific-wins (network→institution→wallet); the four legacy
`ComplianceConfigStorage` bools are **retired** (legacy bool setters revert
`Deprecated()`). Enforcement is armed by a single monotonic counter
(`activeScopeCount`); sanctions arm separately via the per-institution
`institutionSanctionsEnabled` opt-in + network blocks. **Every control ships OFF by
default and the pre-check is a no-op when `activeScopeCount == 0`.** This is
*plumbing to enforce recorded attestations*, NOT a validated compliance program,
NOT the screening/identity *process* itself, and it is not counsel-cleared. With
these caveats:

- **AML / sanctions screening** — *program* NOT IMPLEMENTED (the actual screening
  is the bank's off-chain responsibility; there is **no automated OFAC/list
  ingestion** — status is attestation-based). Wave 8C added the on-chain *screening
  attestation* and Wave 8E-1 made it **scopable** and added an **escalation ladder**:
  records are CLEAR/FLAGGED/BLOCKED + a sanctions-list version hash at two tiers —
  **scoped** (per-institution, scoped `SCREENING_ATTESTOR_ROLE`) and **network**
  (`NETWORK_SCREENING_AUTHORITY_ROLE`). `ComplianceSanctionsLib` hard-denies a BLOCKED
  party on forward transfers (union / most-restrictive / **non-exemptable**) when
  enforcement is armed (`activeScopeCount > 0`; ships OFF). Only BLOCKED denies; FLAGGED
  is recorded but never blocks. A **network** block is the catch-all (bites every checked
  leg); an **institution-scoped** block bites only an affiliated counterparty, so a true
  OFAC hit must be escalated to a network block. Each institution opts its own sanctions
  enforcement in/out (`institutionSanctionsEnabled`), so coverage = the network authority's
  blocklist + each institution's opt-in. This is attestation-enforcement plumbing, not a
  validated screening program, and makes no representation of list completeness or quality.
  **Centralization note:** `NETWORK_SCREENING_AUTHORITY_ROLE` is a single key that can
  block or clear any address with no quorum/timelock/bond — multi-attestor quorum +
  multisig/timelock is the recommended production path (counsel gate G7).
- **BSA / CIP customer identification** — *program* NOT IMPLEMENTED; *enforcement
  plumbing* added in **Wave 8E-2** and gated **OFF** (counsel gate G9). The on-chain layer
  records CIP *presence* (`CustodianRegistryFacet` writes `CustodyData.cipCompletedAt` /
  `cipRecordHash`, no PII) and, when the `cip_enforce_active` scoped key is armed,
  `ComplianceRequirementLib._requireCIP` enforces that presence at forward value-movement
  legs (WALLET_TRANSFER / ESCROW_IN / ESCROW_RELEASE / RECOVERY_MIGRATE). The actual
  customer identity *verification* is the bank's off-chain responsibility — the on-chain
  control is attestation-presence plumbing, not a validated CIP program, and ships OFF.
  `DepositorIdentityFacet` (FDIC 12 CFR 370 TIN-hash registry) was promoted into the active
  manifest as a recording-only registry (not wired into enforcement; shared-salt cross-bank
  correlation tradeoff disclosed under G9).
- **FinCEN Travel Rule** — *program/transport* NOT IMPLEMENTED (IVMS101 exchange is the
  banks' off-chain responsibility, a documented integration point). Wave 8D added an
  on-chain *origination binding*; Wave 8E-1 made arming and threshold **scoped policy
  keys** (`travel_rule_enforce_active`, `travel_rule_threshold_usd`, most-specific-wins
  network→institution→wallet — no longer a single global threshold). When armed (ships
  OFF), an escrow-in create of `amount ≥ effective threshold` reverts unless the originator
  has supplied a high-entropy `travelRuleRef` (bound atomically to the envelope). Raising a
  scoped threshold above the network baseline (screening fewer transfers) requires
  `COMPLIANCE_EXEMPTION_ROLE` and emits `ComplianceExemptionGranted`; lowering is ungated.
  No PII on chain.
- **FDIC 12 CFR 370** pass-through deposit-insurance recordkeeping — *reporting program*
  NOT IMPLEMENTED. Wave 8E-2 promoted `DepositorIdentityFacet` (TIN-hash registry) into the
  active manifest as a **recording-only** primitive. Wave 8F adds an indexer-derived,
  officer-gated `GET /compliance/fdic-370` exam-support surface (`formatVersion: DRAFT`):
  per-bank net hash counts, cross-bank conflicts, salt-epoch lineage, and CIP coverage —
  **metadata/hash only, no per-owner/per-category/dollar data**. It is **not** a 12 CFR 370
  determination and computes no insurance coverage; the actual per-depositor/per-category
  insurance calculation remains the bank's off-chain responsibility (counsel gate G9). No
  deposit-insurance representation is made.
- **FDICIA §403 / Bankruptcy-Code netting safe-harbor** — *asserted* in ADR-003 as
  the basis for bilateral close-out netting, but **counsel-unconfirmed**.
- **UCC 4A / settlement-finality regime** characterization — unconfirmed.
- **Customer Made-Whole Invariant** — an *engineering* assertion (liability
  substitution is final at finalization; failure converts the gap into the
  outgoing issuer's secured reimbursement obligation). Its survival through an
  issuer insolvency is **legally unconfirmed**.

### KYC model and the status of compliance symbols

**KYC design (functional, on by default).** T3 follows the **traditional bank
payment model**: banks perform KYC/CIP **off-chain**, and it is implicit in the
payment rules and regulations governing each institution. T3 extends that model
with an **on-chain recordation mechanism** — a custodian attests a wallet's KYC
state on-chain (`CustodianRegistryFacet` writes `kycValidatedTimestamp` /
`kycExpiresTimestamp`; read via `isKYCValid` / `getKycStatusCached`). That
attestation is a real, live primitive: it is consumed by the reversibility
(half-life) calculation and by the rules/risk engine, and as of this build the
network-scope `requireKyc` flag is **seeded ON by default** so KYC status is
evaluated/recorded for transfers out of the box. This on-chain record can be
applied further by smart contracts (e.g. to gate or price flows).

**Important scope limits:**
- The on-chain layer is an **attestation/recordation record, not the KYC *process***
  (the actual identity verification is the bank's off-chain responsibility).
- Default-on means KYC is **scored/recorded**, not hard-enforced. Hard denial is a
  **separate admin dial** — the rules-engine `enforceDenyAt` / `observationMode`,
  and (Wave 8B) the `kycEnforceActive` gate that turns the forward-entrypoint
  pre-check into a revert. **All of these ship OFF**; with them off, behavior is
  exactly the scored/recorded default.
- It makes **no representation** of AML/sanctions screening, BSA/CIP completeness,
  or FDIC insurance.

**Genuinely non-functional scaffolding** (distinct from the above): some symbols
merely *name* compliance/FDIC concepts but are **not** in the active manifest and do
nothing — e.g. `DistributionManagementBase.isKYCVerified` (now reverts instead of
returning a misleading `true`). Do not infer a working compliance program from those
names. *(As of Wave 8E-2 `DepositorIdentityFacet` / `IDepositorIdentity` /
`DepositorIdentityStorage` are **no longer** in this bucket — the facet is in the active
manifest as a recording-only TIN-hash registry; it is still not wired into enforcement.)*

## 5. Settlement-engine maturity

Waves 4 (attributed issuance capacity) and 5 (bilateral-net interbank settlement
cycle) are **implemented but gated OFF**. ADR-003's leading open risk — the
atomicity/perfection of the reimbursement lien against the outgoing issuer's
receivership — is unresolved. A documented settlement-cycle **liveness window**
exists (see [KNOWN-ISSUES.md](KNOWN-ISSUES.md)).

## 6. Operational gaps

- The pinned local devnet runs **N=4 QBFT validators** (tolerates 1 fault; loses
  liveness at 2). Production must target ≥7 independent validators. This devnet
  topology is **not** a production topology.
- Settlement keeper, reconciliation jobs, and the compliance/banking indexer API
  on Besu are partial/in-progress (Waves 6–7).
- **Contract size:** `WalletRecoveryFacet` is 25.623 KiB and exceeds the
  standard EIP-170 24 KiB limit, so mainnet portability does **not** currently
  hold for that facet. The Wave 8 oversize of `TransferEnvelopeFacet` was
  resolved by the facet split. The CI contract-size gate enforces the 48 KiB
  consortium limit and reports EIP-170 overages as tracked warnings. See
  KNOWN-ISSUES.md.

## 7. No warranty

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. See LICENSE and
NOTICE. Nothing in this repository is legal, regulatory, financial, or accounting
advice.
