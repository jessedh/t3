# ADR-002: Reserve and Deposit-Origin Funding Evidence

- **Status:** ACCEPTED — 2026-06-11, counsel sign-off received
- **Date:** 2026-06-10 (accepted 2026-06-11)
- **Wave:** 0 (Legal, Accounting, and Product Gate)
- **Deciders:** Jesse (product owner) + accounting/regulatory counsel
- **References:**
  - `Documentation/envelope_besu/specs/2026-06-10-t3-bank-deposit-issuance-settlement-design.md` (§1 funding proof, §9.1 tokenized path)
  - Phase 0 product-owner decision sheet (Decision 2, 2026-06-10; private artifact not included in this release)

## Context

Issuing T3 requires settled, eligible reserve value in a segregated vault. We must record
which funding events are accepted, what evidence proves them, and which accounting moves
are prohibited (to prevent liability duplication).

## Decision: Accepted Funding Events

```text
NET_NEW_DEPOSIT:
  customer funds received; bank asset and deposit liability increase.

EXISTING_DEPOSIT_CONVERSION:
  existing deposit liability is extinguished or converted into T3;
  total bank liabilities do not increase from the conversion alone.

SPONSOR_FUNDING_TRANSFER:
  eligible reserve value and the related economic benefit move to the
  sponsor issuer before sponsored T3 is minted.
```

## Funding Proof (Phase 0 Decision 2)

For the standard **tokenized reserve-asset path**, the on-chain movement and encumbrance
of the reserve asset into the issuer's segregated vault **is** the funding proof — no
separate funding signature is required. The deposit-origin / customer-deposit
characterization is recorded as **non-blocking audit metadata**. Whether it should later
become a blocking precondition is deferred to banking counsel (see Open Gate).

## Attestation Payload (audit metadata)

```solidity
struct FundingAttestation {
    bytes32 fundingId;
    address servicingInstitution;
    address legalIssuer;
    address reserveAsset;
    uint256 reserveAmount;
    uint256 t3Amount;
    uint8 fundingType;
    uint40 settledAt;
    uint40 expiresAt;
    bytes32 evidenceHash;
}
```

## Prohibited Accounting

```text
Pledging an existing bank asset without a deposit-origin event does not
create a new customer deposit liability.

Issuing T3 against an existing deposit without extinguishing or converting
the original deposit would duplicate liabilities and is prohibited.
```

## Approval Gates — CLOSED 2026-06-11

- [x] **Accounting & regulatory approval** — received 2026-06-11. Five items confirmed:
  1. **Balance-sheet recognition**: reserve asset pledge recorded as restricted asset; corresponding T3 liability booked at issuance.
  2. **Reserve encumbrance**: on-chain vault movement and encumbrance is sufficient evidence of encumbrance for call-report purposes.
  3. **Call-report presentation**: T3 outstanding appears as other deposit liabilities until further regulatory guidance.
  4. **Durbin treatment**: T3 qualifies as a prepaid-card equivalent; Durbin interchange caps apply where applicable.
  5. **Sponsor accounting**: sponsor funding transfer extinguishes the sponsor's intrabank liability; receiving issuer records the incoming reserve asset and the corresponding T3 liability.

- [x] **Banking counsel decision** — received 2026-06-11. **Deposit-origin characterization remains non-blocking audit metadata.** The `FundingAttestation.fundingType` field records the origin classification for audit purposes; it is not a precondition for mint execution. Blocking enforcement is deferred to a future regulatory clarification gate.
