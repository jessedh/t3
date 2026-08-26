# Counsel-Gate Tracker

> **Transparency note:** This open-source release was published **without**
> clearing the legal/counsel gates below. They are recorded here so the pending
> legal status is visible, not hidden. Disclosure is not a substitute for
> counsel and creates no safe harbor. See [../../REGULATORY-STATUS.md](../../REGULATORY-STATUS.md).

Each gate blocks **production activation** of the named capability. None block
local development, testing, or open-source publication. Both banking feature
gates (`capacityModelActive`, `settlementModelActive`) ship OFF by default.

| Gate | Source | Question | Status | Blocks | Opened |
|------|--------|----------|--------|--------|--------|
| **G1** | ADR-001 | Does transfer-time customer-liability substitution survive the outgoing issuer's FDIC receivership, and what is the insured-deposit/claim-survival treatment? | PENDING | Production use; any insured-deposit representation | 2026-06-11 |
| **G2** | ADR-003 Q1 | Is the secured reimbursement obligation **perfected and bankruptcy-remote** against the outgoing issuer's receivership, and not an avoidable preference? | PENDING | `settlementModelActive` (interbank settlement) | 2026-06-14 |
| **G3** | ADR-003 Q2 | Who controls the sanctions/AML hold and resolution-authority **stay** that override the "redemption permitted during DEFAULT" rule? | PENDING | DEFAULT-path redemption activation | 2026-06-14 |
| **G4** | ADR-003 Q3 | Is the asserted settlement-finality regime (UCC 4A / netting-act safe harbor) correctly characterized for this consortium? | PENDING | Any settlement-finality representation | 2026-06-14 |
| **G5** | ADR-003 / Made-Whole | Does the Customer Made-Whole Invariant hold through issuer insolvency (claim survival + reserve perfection + FDIC-insurance recordkeeping)? | PENDING | Customer-protection / made-whole claims | 2026-06-14 |
| **G6** | Wave 8B | Is on-chain hard-gating of transfers on KYC/affiliation/institution status (blocking customer flows) consistent with the consortium's KYC obligations and consumer-protection/availability duties? | PENDING | `kycEnforceActive` activation | 2026-06-22 |
| **G7** | Wave 8C / 8E-1 | Sanctions/AML screening program + list provenance (`listVersionHash`); **single `NETWORK_SCREENING_AUTHORITY_ROLE`** centralization — one key blocks/clears any address with no quorum/bond/timelock (multi-attestor quorum + multisig/timelock is the recommended production path); the **escalation ladder** (FLAGGED→institution-scoped block→network-binding block→network clearance) and its **scoped-vs-network containment gap** — an institution-scoped block contains only an *affiliated* counterparty, so a true OFAC hit MUST be manually escalated to a network block (no on-chain forcing function); scoped blocks **auto-inert** when the institution is DEFAULTED/RESOLVED; **stale-screen risk treatment** (a transfer screened against an outdated list is recorded-not-denied; only BLOCKED denies, FLAGGED never blocks); and **mid-flight sanction handling** (freeze vs refund-to-sender when a party becomes BLOCKED after escrow-in) + block/hold authority. | PENDING | sanctions enforcement activation (`institutionSanctionsEnabled` / network blocks; `activeScopeCount > 0`) | 2026-06-22 |
| **G8** | Wave 8D / 8E-1 | FinCEN/FATF Travel Rule: IVMS101 transport, threshold, and what an on-chain `travelRuleSatisfied` attestation legally represents. **Sub-question (8E-1):** thresholds are now scoped policy keys (network→institution→wallet, most-specific-wins); is per-institution/per-wallet threshold **loosening above the network baseline** (screening *fewer* transfers — currently allowed with `COMPLIANCE_EXEMPTION_ROLE` + an emitted `ComplianceExemptionGranted` audit event) acceptable, or must thresholds be **tighten-only** relative to the network baseline? | PENDING | `travelRuleEnforceActive` activation | 2026-06-22 |
| **G9** | Wave 8E / 8E-2 / 8F | BSA/CIP recordation + **enforcement** model (8E-2 wired `cip_enforce_active` → `ComplianceRequirementLib._requireCIP`, a one-time identity-*presence* check at forward value-movement legs; ships **OFF**; identity *verification* stays off-chain) — is on-chain presence-gating consistent with CIP obligations and consumer-protection/availability duties? Plus **DepositorIdentity cross-bank correlation**: the shared network-salt TIN-hash registry (promoted to the active manifest in 8E-2, recording-only) lets colluding members correlate the same depositor across banks within an epoch — is that correlation posture acceptable, given per-bank salts would break the reciprocal-deposit conflict check? **Sub-question (8F):** the `GET /compliance/fdic-370` exam-support endpoint exposes cross-bank conflict `tinHash` rows and salt-epoch lineage to `COMPLIANCE_OFFICER_ROLE` holders (metadata/hash only, no PII/dollar data) — is that officer-scoped correlation surface and the `formatVersion: DRAFT` exam-support framing (which makes **no** 12 CFR 370 determination) acceptable as a recordkeeping aid? | PENDING | `cip_enforce_active` activation; any DepositorIdentity-driven enforcement; reliance on `/compliance/fdic-370` output as a 12 CFR 370 determination | 2026-06-22 |
| (closed) | ADR-002 | Reserve / deposit-origin funding evidence | **CLOSED 2026-06-11** | — | — |

> **ADR-002 scope caveat:** the closed sign-off covers **funding-evidence
> accounting only**. It does **not** cover deposit-insurance treatment or
> CIP/customer characterization (those are G1/G3). Do not cite ADR-002 as broader
> legal cover.

## Regulatory prerequisites tracked separately

These are not single "gates" but required compliance build-out before any
real-deposit operation; all currently **NOT IMPLEMENTED** (see
[../../REGULATORY-STATUS.md](../../REGULATORY-STATUS.md) §4): AML/sanctions
screening, BSA/CIP, FinCEN Travel Rule, FDIC 12 CFR 370 recordkeeping.
