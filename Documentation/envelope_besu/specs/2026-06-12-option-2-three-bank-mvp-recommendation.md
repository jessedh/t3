# Option 2 Three-Bank MVP Recommendation

**Date:** 2026-06-12  
**Status:** Recommendation for implementation planning  
**Scope:** Three-bank consortium MVP using the Option 2 boundary conditions

## Recommendation

Use Option 2 as the MVP boundary, but treat it as a narrow execution model rather than a full product slice. [Certain]

Keep a single non-yielding T3 instrument, preserve bank-attributed issuance and redemption, preserve originating-issuer liability while value remains locked in envelopes, and perform liability substitution only at recipient-directed finalization or ordinary cross-bank transfer finality. [Certain]

Do not expose a separate direct bank-minting surface as a user-facing product feature. [Likely] Banks should authorize issuance requests, while one consortium-controlled execution path performs issuance, attribution, reserve checks, settlement logging, and reconciliation. [Likely]

The current repository is not MVP-ready for this boundary yet. [Certain] The reusable primitives exist, but the active code paths still need integration work for attributed issuance, cross-bank substitution, cycle settlement, durable reconciliation, and production-safe gateway/indexer/UI support. [Certain]

## Boundary Conditions

- Three-bank consortium only. [Certain]
- No yield-bearing split between “yielding” and “non-yielding” instruments. [Certain]
- No dynamic call-report ingestion or public issuance-capacity market. [Certain]
- No repo/yield optimization path in the MVP. [Certain]
- No automated Treasury/Fedwire settlement or full default waterfall. [Certain]
- No autonomous keeper dependency for the first release. [Certain]
- Locked envelopes preserve originating issuer until finalization. [Certain]
- Finalization is the liability-transfer boundary between banks. [Certain]

## What Remains

1. Wire attributed issuance and redemption into the production mint/burn path. [Certain]
2. Replace balance-only transfer and envelope settlement paths that bypass issuer substitution. [Certain]
3. Implement cross-bank liability substitution with funded headroom and reimbursement obligations. [Certain]
4. Add the settlement-cycle state machine for three-bank multilateral netting, confirmations, replay protection, and operator-confirmed physical-settlement evidence. [Certain]
5. Initialize and reconcile the claim-attribution, reserve, and settlement storage in production initialization. [Certain]
6. Add durable Gateway persistence, indexer projections, and operator UI for issuance, cycle status, and reconciliation. [Certain]
7. Add end-to-end tests for same-bank, cross-bank, locked-envelope, reserve-floor, and settlement-cycle behavior. [Certain]

## What Can Be Deferred

- Public market infrastructure for issuance capacity. [Certain]
- Dynamic call-report-based capacity attestations. [Certain]
- Sponsored issuance outside the consortium execution path. [Certain]
- Repo or secured-financing optimization. [Certain]
- Broader settlement automation beyond the three-bank MVP cycle. [Certain]

## Decision Tree

```text
Is the target only a three-bank consortium MVP?
  └─ No → Do not use Option 2 as the implementation boundary.
  └─ Yes → Continue.

Does the MVP require only a single non-yielding T3 instrument?
  └─ No → Split the product into a separate design track.
  └─ Yes → Continue.

Do we need to preserve originating issuer while value is locked?
  └─ Yes → Keep envelope composition until finalization.
  └─ No → Option 2 is the wrong boundary.

Do we need bank-attributed issuance/redemption and cross-bank substitution?
  └─ No → The existing product is already over-scoped for the MVP.
  └─ Yes → Implement the remaining P0 workstreams.

Can the release tolerate missing durable settlement cycles or reconciliation?
  └─ Yes → This is only a prototype, not an MVP.
  └─ No → Settlement-cycle, Gateway, and indexer work remain blocking.
```

## Supporting Material

Use these as the source-of-truth references for the recommendation:

- `Documentation/envelope_besu/specs/2026-06-10-t3-bank-deposit-issuance-development-plan.md`
- `Documentation/envelope_besu/specs/2026-06-10-t3-bank-deposit-issuance-settlement-design.md`
- `Documentation/envelope_besu/decisions/ADR-001-holder-issuer-claim-model.md`
- `Documentation/envelope_besu/decisions/ADR-002-reserve-funding-evidence.md`
- `Documentation/envelope_besu/decisions/ADR-003-settlement-finality-default.md`
- `Documentation/envelope_besu/specs/2026-06-11-wave-n-payments-gateway-design.md`
- `Documentation/technical/reports/2026-06-12-core-project-cleanup-public-repo-readiness-assessment.md`

## Practical Reading Order

1. Read the development plan to see the wave dependency graph and current execution state. [Certain]
2. Read the settlement design to understand the core claim, reserve, and envelope invariants. [Certain]
3. Read ADR-001 through ADR-003 for the legal and finality decisions that bound the MVP. [Certain]
4. Read the Wave N Gateway design for the current API and UI gaps. [Certain]
5. Read the cleanup/readiness assessment for the current repository-state risks and remaining work. [Certain]

