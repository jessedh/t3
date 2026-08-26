# T3 Bank Deposit Issuance, Three-Layer Reserve, and Settlement Design

**Date:** 2026-06-10
**Status:** REVISED AFTER ADVERSARIAL IMPLEMENTATION REVIEW
**Scope:** Architecture, migration, UI, indexer, testing, and documentation plan
**Instrument:** One non-yielding T3 bank deposit token
**Review:** Repository audit plus six adversarial Kimi Code challenge cycles and primary-source regulatory review

---

## 1. Executive Decision

T3 remains one fungible, non-yielding bank deposit token. A holder sees one balance and does not select a yielding or non-yielding class. A hidden claim-attribution subledger identifies the bank deposit liability represented by that balance. [Certain]

Every T3 unit must be issued against a settled, eligible reserve asset controlled through a segregated consortium or custodian vault for the beneficial account of the legal issuer. For the normal tokenized-asset path, the on-chain movement and encumbrance of the reserve asset into the issuer's segregated vault is itself the funding proof: the contract observes the settled quantity directly, so no separate funding signature is required. The deposit-origin / customer-deposit characterization — the one fact the token movement cannot prove — is recorded as non-blocking audit metadata on the issuance event and does not gate the mint; making it a blocking precondition remains subject to banking counsel. A regulatory ceiling authorizes issuance but never funds it. [Decided 2026-06-10]

The design uses three distinct reserve-control layers:

1. **Floor:** the minimum funded reserve that must remain unencumbered, calculated from the legal issuer's outstanding T3 plus a configured liquidity buffer. [Certain]
2. **Target:** the bank's desired funded reserve level above the floor, used to drive periodic rebalancing and pre-fund future issuance. [Certain]
3. **Ceiling:** the maximum issuer-attributed T3 authorized by current regulatory attestations, call-report inputs, consortium risk limits, and bank-specific controls. [Certain]

Banks may issue directly or opt out and nominate an approved sponsor issuer. Sponsorship changes the legal issuer, but not the servicing institution or the customer relationship. [Certain]

Sponsored issuance requires a corresponding funding leg that places eligible reserve value under the sponsor issuer's beneficial ownership or legally enforceable control. Otherwise, the sponsor would assume the liability while the servicing bank retained the asset. [Certain]

Ordinary unlocked cross-bank transfers immediately substitute the receiving issuer for the transferred customer liability, but only when the receiving issuer has pre-authorized assumption limits and enough funded reserve and ceiling headroom. A programmable envelope preserves originating issuer liability while value remains in escrow and substitutes only when a terminal outcome releases value to a cross-bank recipient. Each substitution creates a secured interbank reserve-rebalancing or reimbursement position. [Likely]

The weakest part of the model is not token minting. It is ensuring that immediate customer finality does not convert delayed interbank reserve reimbursement into unbounded receiving-bank credit exposure. The outgoing issuer's controlled reserve must remain encumbered for the reimbursement obligation until settlement or resolution. [Certain]

---

## 2. Scope and Non-Goals

### 2.1 In Scope

- One bank-deposit T3 instrument with closed, permissioned circulation. [Certain]
- Direct and sponsored issuance. [Certain]
- Reserve floor, target, ceiling, and capacity calculations. [Certain]
- Segregated reserve custody and haircut-adjusted valuation. [Certain]
- Multiple intraday settlement cycles, mandatory end-of-day processing, and exposure-triggered cycles. [Certain]
- Tokenized reserve-asset settlement with Fedwire fallback. [Certain]
- Standing receiving-issuer authorization limits and real-time funded headroom checks before transfer-time liability substitution. [Certain]
- Custodian and servicing-institution reassignment. [Certain]
- Institution default and orderly-exit controls. [Certain]
- Shadow-ledger migration from the existing bilateral interbank liability model. [Certain]
- Contracts, indexer, APIs, UI, scripts, documentation, and testing. [Certain]

### 2.2 Deferred

- Repo or secured financing against funded surplus is deferred until the core issuance and settlement system is operating and reconciled. [Certain]
- Partial settlement of a failed cycle is deferred from the first release. [Certain]
- A public secondary market for issuance-capacity rights is not included. [Certain]
- Yield distribution to T3 holders is not included. [Certain]
- Automatic treatment of any reserve asset as HQLA or as regulatory capital is not assumed. [Certain]
- Final legal characterization of transfer-time liability substitution, deposit insurance, depositor preference, and secured interbank reimbursement remains subject to banking and securities counsel. [Certain]

---

## 3. Core Invariants

The implementation must enforce these invariants on-chain wherever the required facts are available on-chain. Off-chain attestations must be signed, versioned, time-bounded, and auditable. [Certain]

### INV-1: One-to-One Funded Issuance

An issuance execution must not increase issuer-attributed T3 unless the issuer has settled eligible reserve value sufficient to preserve its floor after minting. [Certain]

```text
postMintEffectiveReserve(issuer) >= postMintDynamicFloor(issuer)
```

### INV-2: Ceiling Is Authorization, Not Collateral

Unused ceiling headroom does not create issuance capacity. [Certain]

```text
executableCapacity =
  min(
    fundedCapacity,
    regulatoryHeadroom,
    concentrationHeadroom,
    growthHeadroom,
    consortiumRiskHeadroom
  )
```

### INV-3: Recipient Claim Follows the Receiving Issuer

An ordinary cross-institution transfer atomically reduces the outgoing issuer's customer liability, increases the receiving issuer's customer liability, and credits the recipient with a claim against the receiving issuer. For programmable envelopes, that substitution occurs at recipient-directed finalization rather than creation. The substitution reverts or enters the approved reroute path unless the receiving issuer remains within its reserve, ceiling, and standing assumption controls. [Likely]

### INV-4: Wallet Balance Is Not Legal Claim Attribution

The ERC-20 wallet balance records ownership of T3 but does not by itself identify the debtor bank. A separate holder-by-issuer claim allocation remains required for sponsored issuance, institutional wallets, migration exceptions, and any wallet permitted to hold claims against more than one issuer. [Certain]

### INV-5: Closed Eligibility

Value-moving T3 operations require the wallet to be an active consortium-bank wallet or a valid KYC/AML wallet linked to an active institution or custodian. [Certain]

### INV-6: Floor Assets Are Unavailable for Repo

Reserve value committed to the dynamic floor cannot be pledged, released, or rehypothecated except through an atomic substitution that preserves eligible value. [Certain]

### INV-7: Failed Reimbursement Does Not Reverse Customer Finality

If interbank reserve reimbursement fails after a valid cross-bank transfer, the receiving issuer remains liable to its customer. The outgoing issuer remains obligated to reimburse the receiving issuer, and the secured item enters an exception or resolution queue. Customer claim attribution must not reverse merely because interbank settlement failed. [Likely]

### INV-8: Stale Regulatory Data Blocks New Risk

Expired or stale capacity attestations reduce new issuance capacity to zero. They must not block redemption, settlement completion, or risk-reducing operations. [Certain]

### INV-9: Default Freezes Risk Expansion

Institution default or exit status blocks new issuance, new sponsored routing, collateral release, and new repo exposure while preserving redemption, settlement, audit, and resolution capabilities. [Certain]

### INV-10: Consortium Is an Agent, Not an Unstated Principal

The consortium coordinates custody, routing, attestations, and settlement. The protocol must not imply that the consortium guarantees bank obligations or becomes a central counterparty unless that role is separately approved and documented. [Certain]

### INV-11: Claim Attribution Conserves Supply

For every wallet, the sum of its issuer claim buckets must equal its ERC-20 balance. Across all issuers, attributed outstanding must equal total supply. [Certain]

```text
sum(holderIssuerClaims[wallet][issuer]) == walletBalance(wallet)

sum(issuerAttributedOutstanding[issuer]) == totalSupply
```

This subledger may aggregate claims by issuer; it does not require a unique on-chain token identifier for every unit. [Certain]

### INV-12: Pending Reimbursement Remains Secured

At the liability-substitution event, the outgoing issuer's eligible reserve value equal to the reimbursement obligation, including applicable haircut or buffer, must either transfer beneficial entitlement to the receiving issuer in an approved omnibus custody ledger or become perfected and encumbered for that issuer. Ordinary cross-bank transfers substitute at transfer time; programmable envelopes substitute only on recipient-directed finalization. [Likely]

### INV-13: Envelope Finalization Controls Liability Substitution

Creating a transfer envelope moves T3 into escrow but preserves the exact originating-issuer claim composition and reserve attribution. Cross-bank liability substitution occurs only when an envelope outcome releases value to the recipient. Reversal, cancellation, clawback, or sender-directed dispute value returns the original claim composition without substitution. [Certain]

For a partial split, only the recipient portion substitutes to the receiving issuer. The sender portion retains its originating-issuer composition. [Certain]

---

## 4. Three-Layer Reserve Design

### 4.1 Layer 1: Dynamic Floor

The floor is computed, not manually stored as an authoritative value. [Certain]

```text
dynamicFloor(issuer) =
  issuerAttributedOutstandingT3(issuer)
  + minimumLiquidityBuffer(issuer)
```

`issuerAttributedOutstandingT3` increases through finalized issuance, sponsored issuance, and transfer-time inbound substitution. It decreases through finalized redemption, burn, and transfer-time outbound substitution. [Certain]

The minimum liquidity buffer is the greater of a fixed per-issuer amount and a basis-points fraction of outstanding T3: `max(fixedLiquidityBuffer, attributedOutstanding * variableLiquidityBufferBps / 10_000)`. This gives new or small issuers an absolute safety floor while scaling proportionally for large issuers, and uses the `fixedLiquidityBuffer` and `variableLiquidityBufferBps` fields already defined on `IssuerPosition`. Both parameters are set per issuer by `RISK_ADMIN_ROLE`. [Decided 2026-06-10]

### 4.2 Layer 2: Funded Target

The target is the bank's desired effective reserve balance or desired surplus above the floor. It is an operating objective, not a hard authorization limit. [Certain]

```text
targetReserve(issuer) =
  dynamicFloor(issuer)
  + configuredTargetSurplus(issuer)
```

Rebalancing should normally move reserve balances toward the target, subject to settlement deadlines, withdrawal constraints, asset eligibility, and bank approvals. [Certain]

Multiple intraday cycles should run on configurable schedules, with additional cycles triggered when exposure or reserve deviation crosses a threshold. A mandatory end-of-day cycle remains required. [Certain]

### 4.3 Layer 3: Regulatory Ceiling

The ceiling limits total issuer-attributed outstanding T3. [Certain]

```text
ceiling(issuer) =
  min(
    attestedCallReportLimit,
    attestedCapitalLimit,
    attestedLiquidityLimit,
    consortiumLimit,
    bankConfiguredLimit
  )
```

The exact call-report formula is a policy input, not Solidity code. It should be calculated by an approved off-chain risk process and submitted as a signed attestation with source period, formula version, effective time, and expiration. [Certain]

A diluted percentage such as five percent may be a conservative initial policy parameter, but it must not be hard-coded into the protocol. [Certain]

### 4.4 Effective Reserve

Reserve capacity uses haircut-adjusted eligible value and subtracts encumbered or operationally unavailable assets. [Certain]

```text
eligibleValue(assetPosition) =
  settledQuantity
  * currentPrice
  * collateralFactorBps
  * (10_000 - haircutBps)
  / 10_000^2

effectiveReserve(issuer) =
  sum(eligibleValue)
  - encumberedValue
  - pendingWithdrawalValue
  - disputedValue
```

The current `MultiAssetVaultFacet` normalizes token decimals but does not provide the full valuation, freshness, settlement-state, and encumbrance model required by this formula. [Certain]

### 4.5 Capacity

```text
fundedCapacity(issuer) =
  max(0, effectiveReserve(issuer) - dynamicFloor(issuer))

regulatoryHeadroom(issuer) =
  max(0, ceiling(issuer) - issuerAttributedOutstandingT3(issuer))

executableCapacity(issuer) =
  min(
    fundedCapacity,
    regulatoryHeadroom,
    concentrationHeadroom,
    growthHeadroom,
    consortiumRiskHeadroom
  )
```

A quote may show indicative capacity. A reservation must lock capacity for a short expiry. Mint execution must recompute all hard limits before committing. [Certain]

---

## 5. Legal and Operating Roles

### 5.1 Servicing Institution

The servicing institution owns the wallet relationship, customer servicing, KYC/AML process, and operational interface. `InstitutionStorage.walletAffiliations` is the authoritative on-chain affiliation. [Certain]

### 5.2 Requesting Bank

The requesting bank asks for issuance for itself or for an affiliated wallet. It may be the servicing institution without being the legal issuer. [Certain]

### 5.3 Legal Issuer

The legal issuer carries the issuer-attributed T3 obligation and must provide eligible reserve backing. It may issue directly or act as a sponsor. [Certain]

### 5.4 Sponsor Issuer

An opted-out bank may nominate an approved sponsor. Routing is valid only while the sponsor relationship, limits, eligibility, and capacity remain active. [Certain]

The existing `SponsorBankCoreFacet` and `SponsorBankStorage` concern distribution and revenue sponsorship. They must not become the canonical source for deposit-issuance sponsorship. [Certain]

Before sponsored issuance executes, the reserve funding leg must identify the servicing bank, sponsor issuer, reserve beneficial owner, custody account, and any indemnity or reimbursement obligation. The sponsor's issuer position and reserve ledger must receive the asset and liability effects together. [Certain]

### 5.5 Consortium and Custodian

The consortium or approved custodian controls segregated reserve wallets and administers settlement. Beneficial ownership remains attributable to the relevant bank unless legal documentation specifies otherwise. [Certain]

---

## 6. Issuance Flow

### 6.1 Request

`requestIssuance(servicingInstitution, beneficiary, amount, preferredIssuer)` records intent and validates wallet affiliation, KYC status, institution status, and request authority. [Likely]

### 6.2 Quote and Route

The routing engine evaluates:

- direct issuer capacity; [Certain]
- sponsor nomination and sponsor consent; [Certain]
- reserve and ceiling headroom; [Certain]
- institution and issuer status; [Certain]
- concentration and growth limits; [Certain]
- quote expiry and routing priority. [Certain]

The quote must identify the servicing institution, requesting bank, selected legal issuer, amount, expiration, and formula or attestation versions used. [Certain]

### 6.3 Reserve

`reserveIssuance(quoteId)` temporarily encumbers executable capacity. Reservations must expire automatically and be releasable by an authorized keeper. [Likely]

Reservations must not count as outstanding T3, but they must reduce available capacity to prevent concurrent over-allocation. [Certain]

### 6.4 Execute

`executeIssuance(reservationId, beneficiary)` must:

1. revalidate eligibility and status; [Certain]
2. verify the deposit-origin or funding attestation; [Certain]
3. revalue the reserve using current permitted data; [Certain]
4. confirm the backing asset is settled and controlled for the legal issuer; [Certain]
5. recompute floor and ceiling headroom; [Certain]
6. increment issuer-attributed outstanding T3; [Certain]
7. credit the beneficiary's claim bucket for the legal issuer; [Certain]
8. mint T3 to the beneficiary; [Certain]
9. consume the reservation; [Certain]
10. emit one canonical issuance event with all relevant identities. [Certain]

All accounting and mint state changes must be atomic. [Certain]

### 6.5 Burn and Redemption

Burning for redemption reduces token supply and therefore lowers the dynamic floor. The burn must identify and decrement the holder's issuer claim buckets and the corresponding issuer-attributed outstanding amounts. [Certain]

Administrative burns must not independently mutate issuer accounting. A canonical internal accounting function must update supply, holder claim attribution, and issuer attribution together. Valid redemptions and other risk-reducing burns remain available during default or stale-ceiling conditions, subject to resolution controls and payout evidence. [Certain]

---

## 7. Transfer and Obligation Attribution

### 7.1 Same-Institution Transfer

If sender and recipient have the same servicing institution, the transfer moves the selected issuer claim buckets with the T3 balance without creating a cross-bank settlement obligation. [Certain]

### 7.2 Ordinary Cross-Institution Transfer

A cross-institution transfer:

1. moves fungible T3 between eligible wallets; [Certain]
2. identifies the outgoing issuer composition and the recipient's approved receiving issuer; [Certain]
3. verifies standing assumption authorization, concentration limits, ceiling headroom, and post-transfer funded reserve coverage for the receiving issuer; [Certain]
4. debits the sender's outgoing-issuer claim composition and credits the recipient with receiving-issuer claims; [Certain]
5. decreases outgoing issuer-attributed outstanding and increases receiving issuer-attributed outstanding in the same transaction; [Certain]
6. encumbers outgoing-issuer reserve value for the receiving issuer; [Certain]
7. creates or aggregates a secured reserve-reimbursement obligation. [Certain]

The protocol should aggregate reimbursement obligations by cycle, outgoing issuer, receiving issuer, and settlement asset. It does not need a unique identifier for every token unit because customer claim substitution is complete at transfer time. [Certain]

### 7.3 Attribution Ledger

The authoritative claim and liability model should maintain:

- claim buckets by wallet and issuer; [Certain]
- total T3 attributed to each legal issuer; [Certain]
- pending outbound reserve reimbursement by issuer; [Certain]
- pending inbound reserve reimbursement by issuer; [Certain]
- finalized cycle movements; [Certain]
- exception reimbursements still owed by the outgoing issuer. [Certain]

Wallet balances remain the customer-facing ownership ledger. Holder claim allocation, aggregate issuer attribution, reserves, settlement obligations, and regulatory capacity remain separate authoritative domains. [Certain]

The first implementation adopts a deterministic FIFO debit rule by issuer-bucket insertion order when a sender holds claims against multiple issuers, because FIFO avoids proportional rounding and can be reproduced by the indexer. The recipient receives a consolidated claim against its approved receiving issuer. `maxIssuerBucketsPerWallet` (initially 16) bounds per-wallet gas. A credit that would exceed this cap MUST revert with a dedicated `TooManyIssuerBuckets` error rather than silently merging buckets, so attribution is never lost without an explicit action. The holder or its servicing bank can call an explicit consolidation function that collapses buckets and creates the corresponding reimbursement obligations. Auto-consolidation is deferred (any future automation must wrap that same consolidation function). In practice multi-bucket wallets are a rare tail because every cross-institution receipt already consolidates to a single receiving-issuer claim; multiple buckets accumulate only from repeated same-institution-preserving inflows from distinct issuers. [Decided 2026-06-10]

### 7.4 Economic Effect Before Reimbursement

The receiving issuer backs the new customer liability from its pre-funded reserve surplus at transfer time. The outgoing issuer's reserve remains encumbered for reimbursement, creating temporary system-level overcollateralization rather than an underfunded customer claim. [Likely]

If the outgoing issuer defaults before reimbursement, the receiving issuer remains the customer debtor and enforces its secured reimbursement claim through the consortium custody and resolution process. This credit and collateral risk must be capped by bilateral, issuer, and consortium exposure limits. For the first release all of these limits live on-chain in `IssuanceCapacityStorage` and are set by `RISK_ADMIN_ROLE`: the per-issuer standing assumption plus concentration and growth headroom are `IssuerPosition` fields, and the bilateral cap is a `bilateralLimit[outgoingIssuer][receivingIssuer]` mapping. Capacity checks read these through internal getters so the call sites are agnostic to the source. The relevant structs reserve trailing storage slots so a later migration to a signed, versioned `CapacityAttestation` (off-chain risk engine) can replace the on-chain values without a storage-layout break. [Decided 2026-06-10]

### 7.5 Locked and Programmable Envelopes

`HALFLIFE_DECAY`, `HOLD_UNTIL_MANUAL`, SmartLock, oracle-conditional, dispute-held, and provisional envelope value does not use ordinary transfer-time substitution while it remains escrowed. The originating issuer remains liable because the outcome can still reverse, cancel, claw back, or split. [Certain]

Envelope creation must:

1. move the sender's exact issuer claim composition into Diamond escrow; [Certain]
2. record that composition by `envelopeId`, because the aggregate `address(this)` balance cannot identify claims belonging to one envelope; [Certain]
3. preserve aggregate issuer-attributed outstanding; [Certain]
4. reserve contingent receiving-issuer transfer headroom for any cross-bank recipient-directed maximum; [Likely]
5. preserve originating reserve attribution until a terminal outcome. [Certain]

Envelope finalization to a recipient in another institution must atomically:

1. consume the envelope's contingent receiving-issuer headroom; [Certain]
2. debit the envelope-specific originating-issuer composition; [Certain]
3. credit the recipient with a claim against the receiving issuer; [Certain]
4. decrease outgoing issuer-attributed outstanding and increase receiving issuer-attributed outstanding without changing total supply; [Certain]
5. transfer an equal beneficial reserve entitlement inside the consortium or custodian ledger; [Likely]
6. record the resulting interbank physical reserve-rebalancing position for an intraday cycle. [Likely]

The beneficial reserve-entitlement transfer is the atomic backing step. The tokenized reserve asset does not need to move between custody wallets for every envelope; multiple finalizations may be netted and physically rebalanced during intraday settlement. [Likely]

For same-institution finalization, the exact envelope composition moves to the recipient without issuer substitution or interbank reimbursement. [Certain]

For reversal, cancellation, clawback, or sender-directed dispute resolution, the exact envelope composition returns to the sender or recovery successor and any contingent receiving-issuer headroom is released. [Certain]

For partial reversal or dispute split, the implementation must allocate from the envelope-specific composition deterministically. Only the amount released to a cross-bank recipient substitutes; the sender portion preserves originating issuer attribution. [Certain]

`FIAT_INSTITUTIONAL` confirmation burns the envelope's exact originating-issuer composition and decreases those issuers' attributed outstanding. It does not create a receiving-issuer T3 liability because no T3 is released to the recipient. Clawback preserves and returns the originating composition. [Certain]

SmartLock and `HOLD_UNTIL_MANUAL` can remain open beyond the commit window. Cross-bank creation therefore requires a maximum reservation horizon, renewal policy, or an approved receiving-bank committed line. An expired capacity reservation must not silently invalidate fragment-based release; the envelope must enter an explicit renewal, reroute, or resolution state. [Likely]

Receiving-issuer default or exit before finalization blocks substitution to that issuer. An authorized resolution path must allow renewal with a qualified issuer, rerouting to an approved sponsor or successor, or reversal to the sender according to the envelope's legal terms. It must not destroy a valid SmartLock fragment or silently redirect value. [Likely]

Outgoing-issuer default before finalization leaves the original customer liability and envelope composition in place. Protected reserve value supporting the envelope remains unavailable for release to general creditors, subject to the approved custody and resolution agreement. A resolution authority may finalize to a qualified receiving issuer only if matching beneficial reserve entitlement can transfer. [Likely]

The preferred custody design is an approved consortium or custodian omnibus wallet with a legally operative per-bank beneficial-ownership subledger. Under that model, envelope finalization can transfer reserve entitlement atomically while physical token movements are netted intraday. If legal ownership cannot move by subledger entry, the receiving issuer must instead pre-fund the liability or use DvP at finalization; aggregate settlement alone is not sufficient. [Likely]

### 7.6 Institution Identity as the Reconciliation Primitive

Wallet affiliation is the primary routing primitive because every eligible customer wallet should resolve to one active `institutionId`. The protocol must snapshot the sender institution, recipient institution, outgoing issuer composition, and receiving issuer at the economic event. Later wallet recovery, unlinking, or reassignment must not rewrite that history. [Certain]

Aggregate intraday reserve positions should be keyed by stable institution and issuer identities, not by wallet address:

```text
rebalancingKey =
  (cycleId, outgoingIssuerId, receivingIssuerId, settlementAsset)

netPosition[institutionId][settlementAsset] =
  inboundBeneficialEntitlement
  - outboundBeneficialEntitlement
```

Wallet-level events provide the auditable source transactions. Institution-level totals provide the settlement primitive. Claim attribution proves that the institution aggregate is legally and mathematically supported. [Certain]

The institution relationship alone cannot replace claim attribution in these cases:

- sponsored issuance, where the servicing institution differs from the legal issuer; [Certain]
- wallets with migrated, inherited, or exception claim composition; [Certain]
- institutional or omnibus wallets that may hold claims against multiple issuers; [Certain]
- open escrow, where the Diamond wallet is not the originating institution; [Certain]
- wallet recovery or reassignment after the economic event. [Certain]

For normal customer wallets after finalized ordinary transfers, the target operating invariant should be that the wallet's claim issuer equals the approved issuer for its active institution. Exceptions must be explicit, indexed, aged, and resolved rather than inferred from current wallet affiliation. [Likely]

---

## 8. Settlement Cycles

### 8.1 Cycle Types

- scheduled intraday; [Certain]
- exposure-triggered; [Certain]
- mandatory end-of-day; [Certain]
- administrative recovery cycle. [Likely]

### 8.2 State Machine

```text
OPEN
  -> PROPOSED
  -> CONFIRMED
  -> FUNDING
  -> FINALIZED

Any non-final state
  -> FAILED
  -> EXCEPTION
```

`OPEN` collects eligible obligations until cutoff. [Certain]

`PROPOSED` freezes the obligation set and publishes net positions plus a commitment root for verification. [Certain]

`CONFIRMED` records each bank's confirmation of its deterministic reimbursement position and settlement instructions. Customer liability was already assumed under standing limits at transfer time. [Certain]

`FUNDING` locks the required tokenized settlement asset or records an approved Fedwire fallback. [Certain]

`FINALIZED` atomically transfers or releases settlement assets, clears reserve encumbrances, and discharges the interbank reimbursement amount. It does not change customer claim attribution. [Certain]

`FAILED` leaves customer claim attribution intact, preserves the receiving issuer's claim against the outgoing issuer and its collateral, and moves affected reimbursements to the exception queue. [Certain]

Banking cutoffs and confirmation windows should use Unix timestamps because they correspond to real operating times and Fedwire windows. Every transition must also record the execution block number and transaction hash for deterministic audit and reorg analysis. [Certain]

The first release must bound each cycle to at most 64 reimbursement obligations and each wallet to at most 16 active issuer buckets. A cycle proposal that exceeds either executable bound must be split before confirmation. The cycle bound keeps obligation verification, settlement-asset delivery, reserve release, and finalization in one transaction. [Likely]

Partial interbank reimbursement finality is prohibited in the first release. If the complete confirmed cycle cannot finalize atomically, the transaction reverts and the cycle remains in `FUNDING` or moves through the authorized failure path without changing customer claim attribution. [Certain]

Scaling beyond the bounded cycle requires a separately approved proof-based or staged reimbursement design. It must not be introduced by merely increasing the configured limits. [Certain]

### 8.3 Netting

The first release calculates net positions off-chain from indexed canonical obligations, then finalizes on-chain by enumerating the full bounded set (at most 64 obligations) directly in calldata. The contract recomputes the result from that calldata rather than trusting an off-chain number: it verifies each obligation exists, is unsettled, and is not duplicated, that confirmed amounts equal proposed amounts, that the set nets to zero, and that it stays within the configured bound. The canonical `obligationRoot` is `keccak256` over the canonically-sorted obligation set and is stored for audit. No Merkle inclusion proofs are used in the first release; a proof-based or staged scheme is deferred to the separately approved scaling design (see §8.2) and must not be introduced by merely raising the bound. [Decided 2026-06-10]

On-chain validation must prove that:

- every included obligation exists and is unsettled; [Certain]
- no obligation is included twice; [Certain]
- the obligation count remains within the configured bound; [Certain]
- net positions balance to zero; [Certain]
- confirmed amounts match proposed amounts; [Certain]
- the cycle uses an approved settlement asset and valuation snapshot. [Certain]

Cycle, obligation, and payment-reference identifiers must use domain-separated monotonic nonces. `block.timestamp` and array length may be included as metadata but must not be the uniqueness mechanism. [Certain]

### 8.4 Keeper

An off-chain keeper may open, propose, and advance cycles. On-chain deadlines, state transitions, signatures, and role checks remain authoritative. [Certain]

Keeper failure must not strand risk indefinitely. Authorized banks or an emergency settlement administrator must be able to advance or fail an expired cycle. [Certain]

---

## 9. Settlement Funding

### 9.1 Tokenized Asset Path

The normal path uses an approved, high-liquidity tokenized asset that is structurally eligible for pledge and transfer. Eligibility is an explicit consortium policy and must not be inferred from the token name. [Certain]

Funding must use delivery-versus-payment or an equivalent atomic escrow sequence:

1. lock settlement asset; [Certain]
2. verify amount and finality; [Certain]
3. release the settlement asset to the entitled receiving issuer; [Certain]
4. clear the corresponding outgoing-issuer reserve encumbrance and reimbursement positions; [Certain]
5. finalize the cycle without changing customer claim attribution. [Certain]

### 9.2 Fedwire Fallback

Fedwire fallback must store references and attestations, not sensitive wire instructions. [Certain]

Required controls:

- unique payment reference bound to cycle and obligation set; [Certain]
- sender-bank attestation; [Certain]
- receiver-bank attestation; [Certain]
- consortium quorum confirmation; [Certain]
- replay-protection registry; [Certain]
- configurable challenge period; [Certain]
- dispute path; [Certain]
- finality only after challenge expiry or authorized resolution. [Certain]

The reference should derive from stable identifiers and a protocol nonce. It should not depend on `block.timestamp` as its uniqueness mechanism. [Certain]

The existing `SecureSettleFacet` and `T3MultiSigSettlementFacet` represent different high-value transfer workflows and are not foundations for issuer novation. Their write selectors must be isolated from the new cycle model and later deprecated or explicitly retained for a separately documented use case. [Certain]

---

## 10. Custodian and Institution Reassignment

### 10.1 Single Wallet

A single-wallet reassignment must atomically update:

- custodian registry record; [Certain]
- `InstitutionStorage.walletAffiliations`; [Certain]
- pending operational permissions; [Certain]
- future servicing-institution attribution; [Certain]
- any explicitly identified unresolved obligations requiring reassignment. [Certain]

Historical finalized obligations remain immutable. [Certain]

### 10.2 Bulk Migration

Mapping-backed wallet populations cannot be discovered safely on-chain without an enumerable registry. Bulk bank migration must therefore use paginated wallet lists, checkpointing, and idempotent processing. [Certain]

Each wallet update is atomic. The entire bank migration is not one transaction and must expose progress, failures, retries, and completion criteria. [Certain]

### 10.3 Wallet Recovery

Wallet-key recovery and institution default are separate states. `WalletRecoveryFacet` handles wallet control; the institution lifecycle component handles bank solvency, membership, and collateral-preservation rules. [Certain]

Recovery completion must not silently leave stale affiliation, custody, sponsor, or settlement authority records. [Certain]

---

## 11. Default and Exit

### 11.1 Modes

- `ACTIVE`; [Certain]
- `ISSUANCE_PAUSED`; [Likely]
- `ORDERLY_EXIT`; [Certain]
- `DEFAULT`; [Certain]
- `RESOLVED`. [Certain]

### 11.2 Freeze Effects

`ORDERLY_EXIT` and `DEFAULT` must:

- block direct and sponsored issuance; [Certain]
- remove the bank from routing; [Certain]
- block reserve release below all protected claims; [Certain]
- block new repo exposure; [Certain]
- preserve existing reserve positions; [Certain]
- preserve redemption and risk-reducing settlement paths; [Certain]
- expose balances, obligations, attestations, and audit records. [Certain]

### 11.3 Resolution

Successor assumption must require explicit legal authorization, successor acceptance, collateral disposition, and settlement of any funding difference. A wallet-address migration alone is insufficient. [Certain]

---

## 12. Repo Phase

Repo is not required for the first release and must not be mixed into the initial issuance safety case. [Certain]

When introduced:

```text
maximumRepoPrincipal(issuer) =
  min(
    configuredRepoProgramLimit,
    max(0, effectiveReserve - dynamicFloor),
    counterpartyLimit,
    liquidityLimit
  )
```

The consortium may cap repo use, including a policy such as 25 percent of funded surplus, but the percentage must be configurable and apply to surplus rather than total reserve. [Certain]

Repo controls must include counterparty eligibility, term, haircut, margin calls, substitution, unwind, default, concentration, and independent valuation. [Certain]

Repo may improve earnings when the financing spread remains positive after capital, liquidity, operational, custody, and risk costs. Positive return on assets or equity is not guaranteed by the structure itself. [Certain]

Repo does not make T3 off balance sheet by itself. Accounting and Durbin treatment depend on legal control, rights, obligations, consolidation, and regulatory interpretation. [Certain]

---

## 13. Contract Architecture

### 13.1 New Isolated Storage Namespaces

Do not insert fields before or between deployed fields in existing Diamond storage. New business state should use unique isolated storage slots with a namespace version and trailing reserved space. [Certain]

#### `IssuanceCapacityStorage.sol`

```solidity
struct CapacityAttestation {
    uint256 ceiling;
    uint256 capitalHeadroom;
    uint256 liquidityHeadroom;
    uint256 concentrationHeadroom;
    uint256 growthHeadroom;
    uint40 effectiveAt;
    uint40 expiresAt;
    bytes32 sourcePeriod;
    bytes32 formulaVersion;
    bytes32 evidenceHash;
}

struct IssuerPosition {
    uint256 attributedOutstanding;
    uint256 pendingInboundReserveReimbursement;
    uint256 pendingOutboundReserveReimbursement;
    uint256 reservedIssuanceCapacity;
    uint256 reservedEnvelopeAssumptionCapacity;
    uint256 fixedLiquidityBuffer;
    uint16 variableLiquidityBufferBps;
    uint256 targetSurplus;
}
```

#### `IssuanceSponsorshipStorage.sol`

```solidity
struct Sponsorship {
    address sponsorIssuer;
    uint256 sponsorLimit;
    uint40 effectiveAt;
    uint40 expiresAt;
    bool bankOptedOut;
    bool sponsorAccepted;
}
```

#### `ClaimAttributionStorage.sol`

```solidity
struct WalletClaims {
    address[] issuers;
    mapping(address => uint256) amountByIssuer;
    mapping(address => uint256) issuerIndexPlusOne;
}

struct EscrowClaims {
    address[] issuers;
    mapping(address => uint256) amountByIssuer;
    mapping(address => uint256) issuerIndexPlusOne;
    uint256 remainingAmount;
    uint8 escrowType;
    address receivingIssuer;
    uint256 reservedReceivingHeadroom;
    uint40 reservationExpiresAt;
    uint8 status;
}

struct Layout {
    mapping(address => WalletClaims) walletClaims;
    mapping(bytes32 => EscrowClaims) escrowClaims;
    mapping(address => uint256) issuerAttributedOutstanding;
    uint256 totalAttributedOutstanding;
    uint16 maxIssuerBucketsPerWallet;
    uint64 nextClaimMovementNonce;
}
```

The holder claim matrix is required because aggregate issuer totals cannot determine the debtor bank for a holder with mixed-origin T3. The domain-separated escrow claim matrix is required because envelopes, SmartLocks, Cambio, and other escrow mechanisms share the Diamond's ERC-20 balance but must preserve independent issuer compositions. Envelope escrow keys also carry contingent receiving-bank reservations. Active issuer arrays must be bounded and maintained without leaving zero-value entries. [Certain]

```text
escrowKey = keccak256(abi.encode(domainSeparator, businessObjectId))

sum(activeEscrowClaims) == walletClaims[address(this)]

sum(activeEscrowClaimAmounts) == balanceOf(address(this))
```

#### `SettlementCycleStorage.sol`

```solidity
struct Obligation {
    address outgoingIssuer;
    address receivingIssuer;
    address senderInstitution;
    address recipientInstitution;
    uint256 amount;
    bytes32 cycleId;
    bytes32 sourceTransferId;
    uint8 status;
}

struct Cycle {
    uint8 status;
    uint8 cycleType;
    uint40 openedAt;
    uint40 proposalDeadline;
    uint40 confirmationDeadline;
    uint40 fundingDeadline;
    uint40 challengeDeadline;
    bytes32 obligationRoot;
    bytes32 exceptionRoot;
}
```

#### `ReserveControlStorage.sol`

Track per issuer and asset:

- settled quantity; [Certain]
- pending deposit and withdrawal; [Certain]
- encumbered quantity; [Certain]
- valuation source and timestamp; [Certain]
- eligibility status; [Certain]
- custodian or vault; [Certain]
- beneficial owner; [Certain]
- settlement finality. [Certain]

#### `InstitutionLifecycleStorage.sol`

Track institution mode, effective time, resolution authority, successor, and evidence hash. [Certain]

### 13.2 New Internal Libraries

- `BankingEligibilityLib.sol`: institution, KYC/AML, membership, recovery, default, and exit checks. [Certain]
- `ClaimAttributionLib.sol`: issuer-bucket credit, debit, same-institution movement, domain-separated escrow and release, cross-bank receiving-issuer substitution, and conservation checks. [Certain]
- `ReserveValuationLib.sol`: decimal normalization, prices, staleness, collateral factors, haircuts, encumbrance, and effective reserve. [Certain]
- `IssuanceAccountingLib.sol`: issuer attribution, floor, target, ceiling, reservations, mint, burn, transfer-time liability substitution, and reimbursement positions. [Certain]
- `IssuanceRoutingLib.sol`: direct versus sponsor selection and limit checks. [Certain]
- `SettlementCycleLib.sol`: secured reimbursement recording, cycle transitions, position confirmation, funding, finality, failure, and replay prevention. [Certain]

Libraries should be imported and invoked internally. Critical eligibility and accounting controls must not depend on external self-calls through `address(this)`. [Certain]

`IssuanceAccountingLib` must be the only writer of total supply and aggregate issuer attribution for production operations, including transfer-time substitution that does not change supply. `ClaimAttributionLib` must be the only writer of holder issuer buckets. Ordinary balance transfers continue through `T3CommonLib`, which must invoke both libraries atomically when the servicing institution changes. [Certain]

### 13.3 New Facets

Keep the initial facet count small:

1. `IssuanceControlFacet.sol`
   Capacity attestations, sponsorship, quotes, reservations, issuance execution, and issuer-position views. [Certain]
2. `SettlementCycleFacet.sol`
   Obligation commitments, cycle proposal, position confirmation, funding, Fedwire attestations, challenge, finalization, and exceptions. [Certain]
3. `InstitutionLifecycleFacet.sol`
   Pause, orderly exit, default, resolution, and custodian or institution reassignment. [Certain]

Reserve deposits, releases, encumbrance, and substitution should be added by refactoring `MultiAssetVaultFacet` around `ReserveControlStorage` and `ReserveValuationLib`, rather than creating a second unrelated vault authority. [Likely]

### 13.4 Existing Facets to Modify

#### `T3TokenMintBurnFacet.sol`

- route production minting through `IssuanceAccountingLib`; [Certain]
- restrict or remove generic `mint(address,uint256)` after cutover; [Certain]
- prevent supply changes without issuer-attribution changes; [Certain]
- update consortium-bank burns to support legal issuer attribution rather than assuming `account == bank`. [Certain]

#### `BankDepositTokenFacet.sol`

- remove independent production authority from `adjustDepositBalance` and `recordMintBurn`; [Certain]
- retain read views if useful; [Likely]
- migrate accounting writes to canonical internal libraries. [Certain]

#### `MultiAssetVaultFacet.sol`

- add settlement-state validation; [Certain]
- apply approved valuation, haircut, factor, and staleness rules; [Certain]
- track encumbrance; [Certain]
- block floor-breaching release; [Certain]
- support atomic asset substitution. [Certain]

#### `T3TokenDirectTransferFacet.sol` and Envelope Transfer Paths

- enforce `BankingEligibilityLib`; [Certain]
- resolve sender and recipient institutions; [Certain]
- move claim composition unchanged for same-institution transfers and substitute to the approved receiving issuer for cross-institution transfers; [Certain]
- verify receiving-issuer transfer headroom and standing assumption limits; [Certain]
- encumber outgoing reserve and record canonical reimbursement obligations; [Certain]
- preserve wallet-recovery restrictions. [Certain]

#### `TransferEnvelopeFacet.sol`, `SmartLockEnvelopeFacet.sol`, and `SmartLockEnvelopeLib.sol`

- escrow the exact sender issuer composition under `envelopeId` without changing aggregate issuer attribution; [Certain]
- reserve contingent receiving-issuer headroom for cross-bank recipient outcomes; [Likely]
- perform liability substitution and beneficial reserve-entitlement transfer only on recipient-directed finalization or recipient dispute share; [Certain]
- preserve originating issuer attribution on reversal, cancellation, clawback, sender dispute share, and unresolved escrow; [Certain]
- release or renew contingent headroom on every terminal and long-running SmartLock path; [Certain]
- keep current fragment validation, half-life reversal math, oracle, dispute, recovery-successor, and fiat-clawback behavior intact. [Certain]

#### `T3TokenInterbankLiabilityFacet.sol`

- freeze new `recordInterbankLiability` calls at cutover; [Certain]
- keep `clearInterbankLiability` available until every legacy balance is zero; [Certain]
- preserve read methods and historical events indefinitely. [Certain]

#### `ConsortiumMembershipFacet.sol`

- integrate activation and deactivation with lifecycle state; [Certain]
- prevent simple deactivation from bypassing orderly exit or default controls. [Certain]

#### `WalletRecoveryFacet.sol`

- call shared affiliation and reassignment logic; [Certain]
- reconcile sponsor, settlement, custody, and lifecycle authorities; [Certain]
- avoid duplicating institution-resolution state. [Certain]

#### `DiamondCutFacet.sol`

- replace the `AccessControlFacet(address(this)).hasRole(...)` authorization dependency with an internal `AccessControlLib` storage read before installing any new facets; [Certain]
- add a regression test proving that replacing or removing the public `hasRole` selector cannot change `diamondCut` authorization. [Certain]

#### `T3CommonLib.sol` and `EscrowLib.sol`

- route every balance movement through claim-attribution movement; [Certain]
- require every T3 escrow create, release, cancellation, redemption, and burn to identify a domain separator and business-object ID; [Certain]
- make every escrow burn decrement the exact object-level issuer claim composition and aggregate issuer attribution before reducing supply; [Certain]
- retain risk-reducing burns during default while blocking unauthorized reserve release. [Certain]

#### `SecureSettleFacet.sol` and `T3MultiSigSettlementFacet.sol`

- do not reuse their storage or events as the canonical settlement-cycle model; [Certain]
- freeze new write use at cutover unless a separate retained use case is approved; [Certain]
- preserve historical read and indexer data. [Certain]

### 13.5 Components Not to Repurpose

- Do not reuse distribution-oriented `SponsorBankStorage` as issuance sponsorship. [Certain]
- Do not treat wallet token balances as bank-level obligations. [Certain]
- Do not rely on `RulesEngineFacet` as the only eligibility enforcement point. [Certain]
- Do not deprecate Cambio, LockedTransfer, or AutomatedResponse components merely because this feature changes bank issuance. [Certain]
- Do not delete or reorder deployed yield-related storage fields. Disable yield selectors and UI claims for T3 reserves, and treat the legacy fields as inert compatibility state. [Certain]

---

## 14. Events and Errors

Canonical events should include:

```solidity
event CapacityAttested(address indexed issuer, uint256 ceiling, uint40 expiresAt, bytes32 evidenceHash);
event SponsorshipUpdated(address indexed requestingBank, address indexed sponsorIssuer, bool active);
event IssuanceQuoted(bytes32 indexed quoteId, address indexed servicingInstitution, address indexed legalIssuer, uint256 amount);
event IssuanceReserved(bytes32 indexed reservationId, bytes32 indexed quoteId, uint256 amount, uint40 expiresAt);
event IssuanceExecuted(bytes32 indexed reservationId, address indexed beneficiary, address indexed legalIssuer, uint256 amount);

event IssuerLiabilitySubstituted(bytes32 indexed transferId, address indexed outgoingIssuer, address indexed receivingIssuer, uint256 amount);
event EnvelopeClaimEscrowed(bytes32 indexed envelopeId, bytes32 compositionHash, uint256 amount);
event EnvelopeLiabilitySubstituted(bytes32 indexed envelopeId, address indexed receivingIssuer, uint256 amount);
event EnvelopeCapacityReserved(bytes32 indexed envelopeId, address indexed receivingIssuer, uint256 amount, uint40 expiresAt);
event EnvelopeCapacityReleased(bytes32 indexed envelopeId, address indexed receivingIssuer, uint256 amount);
event SettlementObligationRecorded(bytes32 indexed obligationId, address indexed outgoingIssuer, address indexed receivingIssuer, uint256 amount);
event SettlementCycleProposed(bytes32 indexed cycleId, bytes32 obligationRoot, uint40 confirmationDeadline);
event SettlementCycleConfirmed(bytes32 indexed cycleId, address indexed institution, uint256 netAmount);
event SettlementCycleFunded(bytes32 indexed cycleId, address indexed fundingIssuer, address settlementAsset, uint256 amount);
event SettlementCycleFinalized(bytes32 indexed cycleId, uint40 finalizedAt);
event SettlementCycleFailed(bytes32 indexed cycleId, bytes32 exceptionRoot);

event FedwireFallbackInitiated(bytes32 indexed cycleId, bytes32 indexed paymentRef, uint40 challengeDeadline);
event FedwireAttested(bytes32 indexed cycleId, address indexed institution, bytes32 indexed paymentRef);
event FedwireChallenged(bytes32 indexed cycleId, address indexed challenger);
event FedwireFinalized(bytes32 indexed cycleId, bytes32 indexed paymentRef);

event InstitutionModeUpdated(address indexed institution, uint8 previousMode, uint8 newMode, bytes32 evidenceHash);
event WalletInstitutionReassigned(address indexed wallet, address indexed previousInstitution, address indexed newInstitution);
```

Required custom errors should distinguish stale attestations, insufficient funded capacity, transfer-headroom violations, standing-assumption-limit violations, ceiling violations, ineligible wallets, invalid sponsors, invalid cycle states, missing position confirmation, duplicate obligations, reused payment references, floor breaches, and lifecycle freezes. [Certain]

---

## 15. Indexer and API

### 15.1 New Tables

- `issuer_capacity_attestation`; [Certain]
- `issuer_position`; [Certain]
- `issuance_sponsorship`; [Certain]
- `issuance_quote`; [Certain]
- `issuance_reservation`; [Certain]
- `issuance_execution`; [Certain]
- `settlement_obligation`; [Certain]
- `settlement_cycle`; [Certain]
- `settlement_cycle_confirmation`; [Certain]
- `settlement_funding`; [Certain]
- `settlement_exception`; [Certain]
- `fedwire_fallback`; [Certain]
- `institution_lifecycle`; [Certain]
- `wallet_institution_reassignment`. [Certain]

The existing `interbank_liability_event` table remains a frozen historical projection after cutover. [Certain]

### 15.2 Read Models

The indexer should derive:

- effective reserve, floor, target, ceiling, and capacity by issuer; [Certain]
- transfer-time issuer-attribution movements; [Certain]
- cycles approaching deadlines; [Certain]
- unconfirmed reimbursement positions; [Certain]
- failed reimbursements and aging; [Certain]
- stale capacity or valuation attestations; [Certain]
- lifecycle and collateral freezes; [Certain]
- shadow-versus-legacy reconciliation differences. [Certain]

### 15.3 APIs

Representative endpoints:

```text
GET  /banking/issuers/:issuer/capacity
GET  /banking/issuers/:issuer/reserves
GET  /banking/issuers/:issuer/transfer-headroom
POST /banking/issuance/quote
POST /banking/issuance/reserve
POST /banking/issuance/execute

GET  /financial/settlement/cycles
GET  /financial/settlement/cycles/:cycleId
POST /financial/settlement/cycles/:cycleId/confirm
POST /financial/settlement/cycles/:cycleId/fund
POST /financial/settlement/cycles/:cycleId/attest
POST /financial/settlement/cycles/:cycleId/challenge

GET  /compliance/settlement/exceptions
GET  /compliance/reconciliation/legacy-shadow
GET  /compliance/institutions/:institution/lifecycle
```

Write APIs must build transactions but cannot replace on-chain authorization or validation. [Certain]

---

## 16. UI Plan

### 16.1 Replace `/banking/mint`

The current generic mint interface should become an issuance workflow:

- servicing institution and beneficiary; [Certain]
- requested amount; [Certain]
- direct or sponsored route; [Certain]
- legal issuer disclosure; [Certain]
- floor, target, ceiling, and funded-capacity visualization; [Certain]
- quote expiration; [Certain]
- reservation status; [Certain]
- execution receipt. [Certain]

### 16.2 Replace `/financial/liability`

Remove simulated counterparties and show indexed:

- current issuer-attributed outstanding T3; [Certain]
- pending inbound and outbound reserve reimbursements; [Certain]
- net cycle positions; [Certain]
- outgoing issuer versus receiving issuer; [Certain]
- exception aging; [Certain]
- legacy bilateral balances during migration. [Certain]

### 16.3 Refocus `/financial/settlements`

The page should support:

- open, proposed, confirmed, funding, finalized, and failed cycles; [Certain]
- obligation-root verification; [Likely]
- reimbursement-position confirmation; [Certain]
- tokenized-asset funding; [Certain]
- Fedwire attestations and challenge status; [Certain]
- deadlines and keeper health; [Certain]
- exception handling. [Certain]

### 16.4 Deprecate the Current `/financial/sweep` Concept

The existing yield-vault, Aave, Compound, and simulated APY presentation conflicts with the approved non-yielding T3 reserve model. It should be replaced with reserve rebalancing and, in a later release, controlled repo-surplus management. [Certain]

### 16.5 New Administration Views

- issuer capacity attestations and expiry; [Certain]
- sponsorship and opt-out configuration; [Certain]
- reserve asset eligibility and valuation policy; [Certain]
- institution default and exit; [Certain]
- custodian and wallet reassignment progress; [Certain]
- legacy cutover reconciliation. [Certain]

### 16.6 Customer Experience

Customer-facing screens should continue to show a single T3 balance. Legal and transaction disclosures must identify the servicing institution and explain the issuer framework without exposing internal settlement complexity as separate token classes. [Certain]

---

## 17. Roles and Permissions

New or clarified roles:

- `ISSUER_OPERATOR_ROLE`: request, reserve, and execute authorized issuance. [Certain]
- `SETTLEMENT_KEEPER_ROLE`: open and advance cycles without controlling bank position confirmation. [Certain]
- `SETTLEMENT_ATTESTOR_ROLE`: submit approved off-chain settlement attestations. [Certain]
- `RISK_ADMIN_ROLE`: update policy limits and accept signed capacity attestations. [Certain]
- `LIFECYCLE_ADMIN_ROLE`: initiate pause, exit, default, and resolution. [Certain]
- `CONSORTIUM_AUDITOR_ROLE`: read complete reserve, capacity, and settlement records. [Certain]
- `EMERGENCY_SETTLEMENT_ROLE`: fail expired cycles or perform narrowly defined recovery actions. [Certain]

No single routine role should be able to raise a ceiling, deposit unverified collateral, mint T3, raise standing assumption limits, and finalize reimbursement settlement. [Certain]

---

## 18. Migration and Cutover

### Phase 0: Specification and Legal Gate

- approve transfer-time substitution so the recipient holds a claim against the receiving issuer; [Certain]
- approve standing assumption limits and secured reimbursement terms; [Certain]
- approve reserve custody and beneficial-ownership model; [Certain]
- approve capacity attestation formula and expiry; [Certain]
- approve tokenized settlement assets and Fedwire evidence process; [Certain]
- approve default and resolution authority. [Certain]

### Phase 1: Foundation

- harden `DiamondCutFacet` authorization before installing new facets; [Certain]
- add isolated storage libraries, including holder claim attribution; [Certain]
- add internal eligibility, valuation, accounting, routing, and settlement libraries; [Certain]
- add new facets in disabled mode; [Certain]
- regenerate selector analysis and storage-layout reports. [Certain]

### Phase 2: Shadow Recording

- record new canonical obligations alongside the existing interbank liability process; [Certain]
- do not change legal attribution or settlement behavior; [Certain]
- index both models; [Certain]
- produce deterministic reconciliation reports. [Certain]

Opening issuer attribution cannot be inferred solely from legacy interbank liabilities. Generic mints and independent ledger mutations mean the migration requires a signed opening allocation whose issuer totals sum to total supply and whose holder claim buckets sum to wallet balances. [Certain]

Open envelopes, SmartLocks, Cambio notes, and Cambio escrows created before object-level claim accounting must either reach a terminal state before activation or receive a signed object-level issuer-composition allocation. An unresolved object without that allocation remains blocked from value movement after activation. [Certain]

Shadow reconciliation must compare like-for-like events and balances:

```text
sum(openingIssuerAllocation) == totalSupply

sum(holderIssuerClaims[wallet]) == walletBalance(wallet)

shadowObligationDelta(economicEvent) == legacyLiabilityDelta(economicEvent)
  only for events intentionally dual-recorded

sum(netSettlementPositionsWithinCycle) == 0
```

Legacy bilateral liabilities are not equal to total issuer-attributed supply and must not be used as a substitute for the opening allocation. [Certain]

### Phase 3: Reconciliation Gate

Activation requires:

- no unexplained obligation differences; [Certain]
- verified issuer-attributed opening balances; [Certain]
- verified reserve opening balances and custody; [Certain]
- successful capacity-attestation expiry tests; [Certain]
- successful failed-cycle and default drills; [Certain]
- approved rollback procedure. [Certain]

### Phase 4: Activate Issuance and Settlement

1. activate direct issuance for one pilot bank with same-institution transfers and canonical redemption; [Certain]
2. prove holder-claim, issuer-attribution, supply, and reserve invariants under live operating procedures; [Certain]
3. activate cross-bank transfer-time substitution, reimbursement-position confirmation, funding, and finality for a bounded pilot group; [Certain]
4. activate sponsored issuance only after the sponsor funding and default-resolution legs are proven; [Certain]
5. retain legacy recording temporarily as a monitored shadow if operationally required. [Likely]

### Phase 5: Restrict Bypasses

- restrict generic mint; [Certain]
- restrict independent deposit and mint/burn accounting mutations; [Certain]
- freeze new legacy interbank-liability recording; [Certain]
- keep legacy clearing and reads. [Certain]

### Phase 6: UI and Operations Cutover

- replace generic mint, simulated liability, and yield-sweep screens; [Certain]
- enable deadline alerting, attestation expiry, exception queues, and reconciliation dashboards; [Certain]
- run multiple intraday cycles plus mandatory end-of-day cycle. [Certain]

### Phase 7: Repo Pilot

- proceed only after reserve and settlement reconciliations meet an agreed operating-history threshold; [Certain]
- limit repo to funded surplus; [Certain]
- start with narrow counterparties, assets, terms, and limits. [Certain]

---

## 19. Deployment and ABI Changes

Update:

- `scripts/lib/facet-manifest.js`; [Certain]
- deployment and upgrade scripts; [Certain]
- selector ownership and collision reports; [Certain]
- `indexer/abis/T3DiamondAbi.ts`; [Certain]
- `indexer/abis/T3Diamond.json`; [Certain]
- UI Diamond ABIs and generated contract types; [Certain]
- role-grant and environment-seeding scripts; [Certain]
- local deployment fixtures. [Certain]

Facet cuts must use `Replace` for selectors already owned by deployed facets and `Add` only for genuinely new selectors. [Certain]

---

## 20. Testing Strategy

### 20.1 Unit Tests

- reserve normalization, valuation, haircut, staleness, encumbrance, and substitution; [Certain]
- dynamic floor, target, ceiling, and capacity; [Certain]
- direct and sponsored routing; [Certain]
- quote expiry and reservation races; [Certain]
- mint and issuer-attribution atomicity; [Certain]
- same-institution and cross-institution transfers; [Certain]
- transfer-time receiving-issuer floor, ceiling, standing-limit, and concentration checks; [Certain]
- SmartLock, `HALFLIFE_DECAY`, oracle, dispute, and fiat envelopes preserve originating issuer attribution while open; [Certain]
- envelope finalization substitutes only recipient-directed cross-bank value; [Certain]
- partial reversal and dispute split preserve exact issuer composition for the sender portion; [Certain]
- contingent receiving-issuer capacity reserves, renews, consumes, and releases correctly; [Certain]
- every settlement state transition and deadline; [Certain]
- reimbursement-position confirmation; [Certain]
- Fedwire replay, quorum, challenge, and finality; [Certain]
- lifecycle freezes and permitted risk-reducing actions; [Certain]
- wallet reassignment and paginated checkpoints. [Certain]

### 20.2 Integration Tests

- net-new reserve deposit through issuance and customer transfer; [Certain]
- sponsored issuance for an opted-out servicing bank; [Certain]
- multiple intraday cycles followed by mandatory end-of-day cycle; [Certain]
- chained cross-bank transfers with immediate receiving-issuer claim substitution; [Certain]
- cross-bank SmartLock creation, fragment release, cancellation, and expired-reservation resolution; [Certain]
- cross-bank half-life partial reversal followed by recipient finalization; [Certain]
- cross-bank dispute partial split with issuer attribution divided by outcome; [Certain]
- tokenized-asset reimbursement settlement and reserve release; [Certain]
- failed funding with receiving-issuer customer liability and outgoing-issuer reimbursement preserved; [Certain]
- Fedwire fallback through finality; [Certain]
- default during each cycle state; [Certain]
- wallet recovery during pending settlement; [Certain]
- legacy and shadow obligation reconciliation; [Certain]
- cutover with legacy clearing retained. [Certain]

### 20.3 Security and Adversarial Tests

- generic mint and accounting bypass attempts; [Certain]
- stale or forged capacity attestations; [Certain]
- reserve oracle manipulation and decimal mismatch; [Certain]
- double reservation and concurrent execution; [Certain]
- duplicate obligation inclusion; [Certain]
- cycle-root substitution; [Certain]
- position-confirmation replay; [Certain]
- Fedwire reference replay; [Certain]
- premature finalization; [Certain]
- custodian reassignment race; [Certain]
- collateral release during default; [Certain]
- reentrancy across mint, reserve, funding, and finality; [Certain]
- unauthorized Diamond selector replacement. [Certain]

### 20.4 Property and Invariant Tests

At all times:

```text
sum(walletBalances) == totalSupply

for each wallet:
  sum(holderIssuerClaims[wallet]) == walletBalance(wallet)

sum(issuerAttributedOutstanding) == totalSupply

totalAttributedOutstanding == totalSupply

effectiveReserve(issuer) >= dynamicFloor(issuer)
  after every risk-increasing operation

no finalized obligation is finalized twice

no failed reimbursement reverses customer claim attribution

pendingOutboundReserveReimbursement(issuer)
  <= settlementEncumberedReserve(issuer)

for each open envelope:
  sum(escrowClaims[envelopeEscrowKey(envelopeId)]) == remainingEscrow(envelopeId)

open envelope escrow does not change issuerAttributedOutstanding

recipient-directed envelope finalization substitutes exactly the released amount

no reservation can be consumed twice

sum(netSettlementPositionsWithinCycle) == 0
```

Redemption or authorized risk-reducing operations may temporarily move an already deficient issuer toward compliance without being blocked by a stale ceiling attestation. [Certain]

### 20.5 Coverage Gates

- 100 percent transition coverage for settlement and lifecycle state machines; [Certain]
- at least 95 percent branch coverage for eligibility, capacity, and issuance accounting libraries; [Likely]
- at least 90 percent branch coverage for new facets and Fedwire fallback; [Likely]
- explicit tests for every custom error and privileged role boundary. [Certain]

Coverage percentages are release gates, not substitutes for invariant and adversarial testing. [Certain]

---

## 21. Required Documentation

- legal issuer and depositor disclosure model; [Certain]
- reserve asset eligibility and custody standard; [Certain]
- capacity-attestation methodology and call-report mapping; [Certain]
- floor, target, ceiling, and rebalancing operations; [Certain]
- settlement-cycle runbook; [Certain]
- Fedwire fallback evidence and challenge runbook; [Certain]
- default, exit, and resolution runbook; [Certain]
- custodian reassignment runbook; [Certain]
- cutover and rollback plan; [Certain]
- repo policy before any repo release; [Certain]
- accounting and regulatory analysis, including balance-sheet and Durbin treatment, prepared by qualified advisers. [Certain]

---

## 22. Implementation Work Breakdown

### Workstream A: Storage and Core Libraries

1. Add the six isolated storage namespaces. [Certain]
2. Add banking eligibility and lifecycle checks. [Certain]
3. Add holder claim attribution and bounded issuer-bucket movement. [Certain]
4. Add reserve valuation and encumbrance accounting. [Certain]
5. Add issuer attribution and capacity calculations. [Certain]
6. Add settlement-cycle state and obligation accounting. [Certain]

### Workstream B: Issuance

1. Implement direct and sponsor configuration. [Certain]
2. Implement capacity attestations. [Certain]
3. Implement quote, reserve, expire, cancel, and execute. [Certain]
4. Refactor mint, burn, escrow burn, and redemption accounting. [Certain]
5. Add events, views, and role grants. [Certain]

### Workstream C: Transfers and Settlement

1. Integrate wallet eligibility into every value-moving path. [Certain]
2. Move claim buckets unchanged for same-institution transfers and substitute them to the receiving issuer for cross-institution transfers. [Certain]
3. Preserve envelope-specific originating issuer composition while value remains escrowed. [Certain]
4. Reserve contingent receiving-issuer capacity at cross-bank envelope creation. [Likely]
5. Substitute liability and reserve entitlement only for recipient-directed envelope outcomes. [Certain]
6. Enforce receiving-issuer funded headroom, ceiling, standing assumption, and concentration limits. [Certain]
7. Encumber or transfer beneficial reserve entitlement and record canonical reimbursement obligations. [Certain]
8. Implement cycle proposal and commitment verification. [Certain]
9. Implement bank position confirmation. [Certain]
10. Implement tokenized reimbursement funding and atomic reserve release. [Certain]
11. Implement exception handling. [Certain]
12. Implement Fedwire fallback. [Certain]

### Workstream D: Lifecycle and Reassignment

1. Implement issuance pause, orderly exit, default, and resolution. [Certain]
2. Block reserve release and routing in protected states. [Certain]
3. Implement atomic single-wallet reassignment. [Certain]
4. Implement paginated bulk migration. [Certain]
5. Integrate WalletRecovery and ConsortiumMembership behavior. [Certain]

### Workstream E: Indexer and Operations

1. Add tables and event handlers. [Certain]
2. Add capacity, cycle, exception, and reconciliation APIs. [Certain]
3. Add keeper scheduling and alerts. [Certain]
4. Add shadow-ledger reconciliation tooling. [Certain]
5. Add attestation-signing and evidence-retention tooling. [Certain]

### Workstream F: UI

1. Replace generic mint with issuance request and execution. [Certain]
2. Replace simulated liabilities with issuer attribution and cycle positions. [Certain]
3. Refocus settlements on cycle operations. [Certain]
4. Replace yield sweep with reserve controls. [Certain]
5. Add sponsorship, lifecycle, reassignment, and reconciliation administration. [Certain]

### Workstream G: Cutover

1. Deploy disabled components. [Certain]
2. Initialize verified opening issuer and reserve positions. [Certain]
3. Run shadow recording and reconciliation. [Certain]
4. Activate issuance and settlement. [Certain]
5. Restrict legacy mutation selectors. [Certain]
6. retain legacy clear and read paths until balances are zero. [Certain]

---

## 23. Acceptance Gates

Implementation is not production-ready until:

- legal issuer identity is unambiguous for all outstanding T3; [Certain]
- every wallet balance reconciles to holder issuer claim buckets; [Certain]
- reserve custody and beneficial ownership are documented and reconciled; [Certain]
- sum of issuer attribution equals total supply; [Certain]
- every issuance path preserves the floor; [Certain]
- every open envelope preserves originating issuer attribution and exact escrow composition; [Certain]
- every recipient-directed cross-bank envelope finalization consumes reserved receiving capacity and substitutes exactly the released amount; [Certain]
- ceiling expiry blocks new issuance; [Certain]
- settlement failure preserves the receiving issuer's customer liability and the outgoing issuer's secured reimbursement obligation; [Certain]
- receiving issuers cannot be assigned liability outside approved standing limits or without funded floor and ceiling headroom; [Certain]
- Fedwire fallback resists replay and premature finality; [Certain]
- default freezes all risk-increasing paths; [Certain]
- legacy and shadow ledgers reconcile; [Certain]
- selector and storage-layout reports show no unintended collisions or field movement; [Certain]
- unit, integration, security, invariant, and UI tests pass. [Certain]

---

## 24. Challenge-Cycle Disposition

### Challenge Cycle 1: Contract and Storage Safety

Accepted:

- mapping populations require enumerable registries or paginated external inputs; [Certain]
- accounting needs one canonical source of truth; [Certain]
- external self-calls are unsafe for critical authorization semantics; [Certain]
- generic mint and independent accounting mutations are production bypasses; [Certain]
- deprecation scope must remain narrow. [Certain]

Rejected:

- inserting storage gaps before or between deployed fields; [Certain]
- reusing distribution sponsorship storage for deposit issuance; [Certain]
- bounding institution obligations by a wallet's token balance. [Certain]

### Challenge Cycle 2: Operations, Legal Finality, and Failure

Accepted:

- separate institution default and exit from wallet-key recovery; [Certain]
- require receiving-bank authorization before liability assumption; [Certain]
- use quorum, replay protection, and challenge periods for Fedwire evidence; [Certain]
- begin with shadow recording and reconciliation; [Certain]
- preserve legacy clearing after freezing new legacy recording; [Certain]
- defer repo and partial settlement. [Certain]

Clarified:

- the consortium is a settlement agent unless a separately approved legal structure makes it a principal or central counterparty; [Certain]
- this cycle initially assumed issuer substitution at settlement finality, but later review rejected that model for freely transferable bank deposits; [Certain]
- aggregate legal exposure is issuer-level, and holder claims require wallet-by-issuer attribution for sponsorship, institutional wallets, and migration exceptions. [Certain]

### Challenge Cycles 3 and 4: Business, Contract, and Operations Pressure Test

Accepted:

- the architecture has six authoritative domains: wallet ownership, holder claim attribution, aggregate issuer attribution and capacity, reserve custody, settlement obligations, and lifecycle or authorization state; [Certain]
- reserve pledge alone does not prove a legal deposit funding event; [Certain]
- sponsored issuance requires an asset and funding leg that follows the sponsor liability; [Certain]
- all supply-changing paths, including `EscrowLib.burnEscrow`, must update claim and issuer attribution; [Certain]
- old secure-settlement and multisig-settlement workflows must remain isolated from issuer novation; [Certain]
- direct single-bank issuance should precede cross-bank settlement and sponsored issuance. [Certain]

Corrected or rejected:

- valid burns reduce the floor and are risk-reducing; they should not be prohibited during default merely because the issuer is in default. [Certain]
- legacy interbank liabilities do not equal issuer-attributed supply and cannot seed the opening issuer allocation by themselves. [Certain]
- the `DiamondCutFacet` self-call is an upgrade-fragility problem, not an unauthenticated takeover without a prior authorized cut. [Certain]
- deployed yield-related storage fields must remain in place; disabling yield behavior and UI claims is sufficient for this migration. [Certain]
- Unix timestamps remain appropriate for banking deadlines; block numbers and transaction hashes supplement audit and reorg evidence. [Certain]

### Challenge Cycles 5 and 6: Onward Transfer and Deposit-Claim Semantics

The technical persona demonstrated that deferred issuer substitution plus unrestricted onward transfer is irreconcilable with wallet-by-issuer buckets. Transfer locks or hidden settlement lots would be required to preserve the former model. [Certain]

The business and legal persona rejected transfer locks as the primary model because the recipient would continue to hold a claim against an institution with which it may have no deposit relationship. Primary-source BIS analysis describes tokenized deposits as reducing the payer's deposit at its bank and increasing the payee's deposit at the payee's bank, while interbank settlement transfers reserve value. [Certain]

Accepted:

- cross-bank transfer substitutes the receiving issuer at transfer time, subject to standing authorization and funded headroom; [Likely]
- the outgoing issuer's controlled reserve is encumbered to secure periodic reimbursement; [Likely]
- failed reimbursement leaves the receiving issuer liable to the customer and creates a secured interbank exception; [Likely]
- transfer locks and settlement-lot identity are not part of the first release. [Certain]

Rejected:

- unrestricted onward transfer while original-issuer substitution is deferred to cycle finality; [Certain]
- treating aggregate issuer buckets alone as sufficient to locate claims for later rebucketing; [Certain]
- presenting transfer locks as equivalent to a normal immediately available bank deposit. [Certain]

Clarified after user review:

- the rejected transfer-lock model concerned ordinary settled T3 receipts; programmable envelope escrow remains intentionally locked under existing SmartLock and half-life semantics. [Certain]
- envelope finalization, not commit-window expiry, controls cross-bank liability substitution. [Certain]
- aggregate intraday settlement may net physical reserve movement, but envelope finalization must atomically update claim attribution and the matching beneficial reserve entitlement or secured reimbursement position. [Likely]
- institution identity resolved from a wallet is the aggregate settlement primitive, while issuer claim attribution remains the accounting proof and handles sponsorship, mixed claims, recovery, and shared escrow. [Certain]
- every Diamond escrow path, including Cambio and WalletRecovery bulk resolution, must use domain-separated object-level claim accounting. [Certain]

---

## 25. Recommendation

Implement the non-yielding, single-token model with six authoritative domains: wallet ownership, holder claim attribution, aggregate issuer attribution and capacity, funded reserves, settlement obligations, and institution lifecycle or authorization state. [Certain]

Do not start with repo, partial settlement, or a second token class. Those additions would make the legal and accounting proof harder before the base model has demonstrated reconciliation and operational finality. [Certain]

The first production-capable engineering milestone should be a direct single-bank vertical slice: verified funding attestation, settled reserve deposit, direct issuance, same-institution transfer, redemption, and invariant reconciliation across wallet balance, holder claim buckets, issuer attribution, total supply, and reserve floor. Cross-bank settlement and sponsored issuance follow only after this slice is stable. [Certain]

For the cross-bank milestone, use prefunded immediate receiving-issuer substitution plus secured periodic reserve reimbursement. Do not enable cross-bank transfer if the receiving issuer lacks funded floor headroom, ceiling headroom, standing assumption authority, or concentration capacity. [Likely]

---

## 26. Primary Design Basis

- [BIS Annual Economic Report 2023, Chapter III](https://www.bis.org/publ/arpdf/ar2023e3.htm) describes a tokenized deposit payment as reducing the payer's deposit at the payer's bank and increasing the payee's deposit at the payee's bank, with reserve settlement between banks. [Certain]
- [FDIC Understanding Deposit Insurance](https://www.fdic.gov/resources/deposit-insurance/understanding-deposit-insurance) states that deposit-insurance coverage is determined per depositor, ownership category, and FDIC-insured bank; the T3 legal and recordkeeping structure requires specific counsel and regulator confirmation before any insurance representation. [Certain]
- [Federal Reserve Financial Services, Fedwire Funds Service](https://www.frbservices.org/financial-services/wires) confirms that Fedwire supports settlement of commercial payments and positions with other financial institutions; it does not by itself validate T3's proposed evidence or fallback design. [Certain]
