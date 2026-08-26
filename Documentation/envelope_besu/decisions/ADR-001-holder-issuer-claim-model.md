# ADR-001: Holder–Issuer Claim Model

- **Status:** PRODUCT-DECIDED; COUNSEL-PENDING — Option 1 confirmed by the product owner on 2026-06-11 for *implementation*. External banking-counsel approval remains a **pre-production activation gate** (see [COUNSEL-GATES.md](../COUNSEL-GATES.md) G1) and may force revision. This is not a legal determination.
- **Date:** 2026-06-11
- **Wave:** 0 (Legal, Accounting, and Product Gate)
- **Deciders:** Jesse (product owner) + banking counsel
- **References:**
  - `Documentation/envelope_besu/specs/2026-06-10-t3-bank-deposit-issuance-settlement-design.md` (§7 transfer-time substitution, §7.3 FIFO/bucket overflow)
  - Phase 0 product-owner decision sheet (Decision 5, 2026-06-10; private artifact not included in this release)

## Context

T3 is a fungible, non-yielding bearer balance from the holder's perspective, but each
unit carries a hidden attribution to the issuing (debtor) bank. We must fix, in a
signed record, **whose** customer liability a holder's balance represents and how that
attribution changes on transfer — before any accounting code (Wave 2 onward) is written.

## Decision

**Legal model.** Cross-institution transfer immediately substitutes the approved
receiving issuer for the transferred customer liability. The receiving issuer must have
funded floor headroom, ceiling headroom, standing-assumption authority, and
concentration capacity before the transfer executes.

This is the controlling product decision for Wave 2 implementation. The protocol must
not silently fall back to originating-bank liability until periodic settlement. The
receiving issuer's assumption must be preauthorized and must succeed atomically with the
claim-attribution change, or the transfer reverts.

Programmable envelope creation is **not** recipient settlement. While T3 remains in
Diamond escrow, originating-issuer liability and claim composition remain unchanged.
Recipient-directed envelope finalization is the substitution event.

## Technical Consequences

- The protocol maintains bounded wallet-by-issuer claim buckets.
- Same-institution transfers move claim composition unchanged.
- Ordinary cross-institution transfers debit outgoing-issuer claims and credit one
  receiving-issuer claim bucket in the same transaction.
- Settlement cycles move reserve value and **do not** rebucket customer claims.
- Envelope creation records exact issuer composition by envelope ID; reversal returns
  that composition; finalization substitutes only the recipient-directed amount.

## Initial Bucket Rule

- Transfer allocation: **FIFO** by issuer-bucket insertion order.
- Initial maximum active issuer buckets per wallet: **16** (`maxIssuerBucketsPerWallet`).
- Administrative maximum: **32**.
- Zero-value buckets are removed immediately.
- A credit that would exceed the active maximum **reverts** (`TooManyIssuerBuckets`);
  consolidation is an explicit holder/servicing-bank action (see settlement design §7.3).

## Secured Reimbursement

The outgoing issuer's controlled reserve is encumbered at transfer time for the
receiving issuer. Failed reimbursement does **not** reverse the customer's claim against
the receiving issuer.

## Open Approval Gate (BLOCKING for production activation)

- [ ] **Banking counsel approval** must address: transfer-time liability substitution,
  deposit status, depositor preference, deposit-insurance recordkeeping, secured
  reimbursement, default, and disclosures.

Wave 2 implementation may proceed under the product decision above. No production
activation, external pilot, or representation of insured-deposit treatment may rely on
this model until the counsel gate is signed.
