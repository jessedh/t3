# Besu Envelope Feature Request Inventory

**Date:** 2026-03-24 (last updated 2026-06-15)
**Context:** This inventory is written natively for the Besu permissioned consortium architecture (ADR-004). It replaces the Avalanche-era FR set, which included cryptographic privacy layers that are no longer required.

> **Note (2026-06-13):** The legacy transfer stack (`T3TokenTransferFacet`, `TransferManagementFacet`, `LockedTransferManagerFacet`, `CambioEscrowFacet`, `CambioRedemptionFacet`) was never deployed to production. FR-CUTOVER executed as a source-level archive (no data migration needed). See the "Legacy Transfer Stack Cutover" section below.

---

## Contract Surface (Build-and-Migrate in Progress)

### FR-0004: Corrected Contract Surface
**Status:** COMPLETE — contracts compiled, wired into deployment, integration-tested
- Corrected `createEnvelope` signature carrying `amount`, `expirationBehavior`, `conditionData`
- `ITransferEnvelope.sol` interface defined with all lifecycle, dispute, and oracle functions
- `EnvelopeStorage.sol` with plaintext `uint256 amount` (no commitment fields)
- `TransferEnvelopeFacet.sol` implementing full lifecycle
- `EnvelopeInheritanceFacet.sol` — fully implemented (2026-06-13): parent-child creation, depth limit 1, 7 unit tests
- `WalletRecoveryFacet.sol` — fully implemented (FR-1402 complete)
- Events emit plaintext amounts per ADR-004

**Note (2026-06-15, updated 2026-06-25):** The legacy transfer stack has been archived. The active diamond surface spans token, envelope/recovery, Cambio, banking/consortium, and rules/compliance facets — **41 facets** per `scripts/lib/facet-manifest.js` (single source of truth; verify the count there rather than trusting this note).

### FR-0005: Security & Invariant Baseline
**Status:** COMPLETE — all structural invariant tests passing (90/90 envelope tests)
- `INV-SLOT-01`: Storage slot uniqueness across all diamond facets
- `INV-IFACE-01`: Interface completeness (all ITransferEnvelope functions present)
- `INV-ENUM-01`: Enum value ranges match storage definitions
- `INV-VIS-01`: Events emit plaintext `uint256 amount` (Besu visibility model)
- `INV-COMP-01`: Compilation verification

---

## Core Lifecycle (Next Priority)

### FR-1001: Envelope Lifecycle Implementation
**Status:** COMPLETE — full behavioral test suite passing (create/finalize/reverse for all 6 expiration behaviors)
**Scope:** Full behavioral test suite for create → finalize → reverse flows. The facet implementation exists on the old branch; once FR-0004 contracts compile and pass structural tests on this branch, this FR adds the behavioral test coverage proving correctness.
- Happy-path tests for all 6 expiration behaviors
- Edge cases: zero-amount reversal, double-finalize, expired envelope operations
- Escrow balance accounting invariants (total supply preserved)
- Gas benchmarks via Hardhat Gas Reporter

### FR-1002: Expiration Behavior Engine
**Status:** COMPLETE (2026-04-25) — all 6 behaviors tested including all edge cases. ORACLE_CONDITIONAL: late callback rejection, exact boundary, already-received no-op, keeper-triggered custom timeout with non-default window (added 2026-04-25)
**Scope:** Behavioral tests for all 6 expiration modes.
- `IMMEDIATE_FINALIZE`: auto-finalize at commitWindowEnd
- `HALFLIFE_DECAY`: reversibility decay curve (per-envelope, NOT per-recipient)
- `HOLD_UNTIL_MANUAL`: only admin/arbiter can release
- `ORACLE_CONDITIONAL`: oracle callback determines outcome
- `AUTO_REVERSE`: auto-reverse at commitWindowEnd if not finalized
- `DISPUTE_HOLD`: frozen during dispute, resolution determines outcome
- Time-manipulation tests using `hardhat-network-helpers`

### FR-1003: Settlement Pathing
**Status:** COMPLETE — implemented and tested (2026-04-08)
**Scope:** Two settlement paths with Besu-specific trigger mechanisms.
- `CRYPTO_DIRECT`: On-chain token transfer (unchanged from original design). Tokens move escrow → recipient on finalization. Total supply preserved.
- `FIAT_INSTITUTIONAL`: Provisional settlement with clawback window (ACH model — **decision recorded 2026-04-07**).

#### FIAT_INSTITUTIONAL State Machine
```
Created → PENDING_FIAT_CONFIRMATION  (tokens: escrow → recipient, provisional credit)
              ↓ confirmFiatDelivery()      ↓ clawbackSettlement() before clawbackDeadline
          Finalized                    Reversed
          (tokens burned from          (tokens: recipient → sender)
           recipient balance)
```

#### Implementation Requirements
- `EnvelopeState` enum: add `PENDING_FIAT_CONFIRMATION` (6th state, index 6)
- `EnvelopeData` struct: add `clawbackDeadline` (uint40) field
- `_settleAmount` for `FIAT_INSTITUTIONAL`: transfer tokens escrow → recipient (not burn); set state to `PENDING_FIAT_CONFIRMATION`; emit `FiatSettlementTriggered(envelopeId, amount, clawbackDeadline)`
- New entry point `confirmFiatDelivery(envelopeId)`: callable by admin/relayer after confirmed fiat delivery; burns tokens from recipient balance; transitions to `Finalized`
- New entry point `clawbackSettlement(envelopeId)`: callable by admin before `clawbackDeadline`; pulls tokens from recipient back to sender; transitions to `Reversed`
- Default `clawbackDeadline`: configurable per envelope at creation, with a global default (suggest 2 business days)

#### Known Hard Problem: Recipient Spends Before Clawback
If Bank B's end-user spends provisional tokens before a clawback fires, `clawbackSettlement` cannot pull them back from an empty balance. Mitigations (to be enforced via bank agreement and custodian registry, not pure on-chain):
1. **Custodian settlement buffer**: Bank B's custodian is required to maintain a buffer ≥ max single-envelope exposure; clawback draws from buffer
2. **Threshold eligibility**: Provisional settlement only for amounts ≤ configured per-bank threshold; above threshold requires prefunded model
3. **Netting offset**: If Bank B owes Bank A within the same settlement window, clawback becomes a net position adjustment

#### Trigger Mechanism
The Ponder indexer watches `FiatSettlementTriggered` events and drives the off-chain fiat wire. On confirmed delivery, it calls `confirmFiatDelivery` via the relayer. On failure, it calls `clawbackSettlement` before the deadline. This replaces the previously proposed narrowed compliance delivery service (ADR-002 is superseded).

### FR-1004: Dispute & Oracle Surface
**Status:** COMPLETE (2026-04-25) — full dispute lifecycle tested. Added: custom dispute timeout configuration via setDefaultDisputeTimeout, including reset-to-default (0) behavior and timeout boundary enforcement at custom values (added 2026-04-25)
**Scope:** Behavioral tests for dispute and oracle flows.
- `raiseDispute()` → `DISPUTE_HOLD` state transition
- `resolveDispute()` with three outcomes: finalize, reverse, partial split
- Oracle registration and callback flow
- Default timeout behavior (7-day default, configurable)
- Authorization checks (arbiter role for resolution)

### FR-1006: EscrowLib Consolidation & Transfer Event Audit
**Status:** COMPLETE — implemented and tested (2026-04-23)
**Scope:** Extract a shared `EscrowLib` library for all envelope-model token escrow operations and audit existing facets for missing Transfer events.

#### Motivation
Code review of FR-1403 revealed that `_escrowFrom` / `_releaseEscrow` / `_burnEscrow` are duplicated across TransferEnvelopeFacet and SmartLockEnvelopeFacet (byte-for-byte identical). FR-1404 would introduce a third copy. Beyond duplication, audit of non-envelope escrow paths revealed a **real accounting bug**: `RewardsEscrowCoreFacet` and `RewardsEscrowAdminFacet` move tokens into/out of `address(this)` without emitting ERC-20 `Transfer` events, causing the Ponder indexer to see balance discrepancies with no corresponding event trail.

#### Implementation Plan
1. **Create `contracts/lib/EscrowLib.sol`** — three `internal` functions:
   - `escrowFrom(address from, uint256 amount)` — debit from, credit `address(this)`, emit Transfer
   - `releaseEscrow(address to, uint256 amount)` — debit `address(this)`, credit to, emit Transfer
   - `burnEscrow(uint256 amount)` — debit `address(this)`, reduce `_totalSupply`, emit Transfer to `address(0)`
   - All use `unchecked` after explicit balance check + custom errors consistent with `StorageLib.ERC20InsufficientBalance`
2. **Adopt in envelope facets**: Replace inline `_escrowFrom` / `_releaseEscrow` / `_burnEscrow` in TransferEnvelopeFacet and SmartLockEnvelopeFacet with `EscrowLib` calls
3. **Fix RewardsEscrow Transfer events**: Retrofit `RewardsEscrowCoreFacet.addReward` and `claimRewards`, and `RewardsEscrowAdminFacet` reclaim/emergency paths, to use `EscrowLib` (adds missing Transfer events + explicit balance checks)
4. **FR-1404 uses EscrowLib from the start** — no third copy

#### Out of Scope (intentionally not consolidated)
- **LockedTransferManagerFacet** — legacy, slated for deprecation under FR-CUTOVER. Creating new dependencies on it is counterproductive.
- **CambioEscrowFacet / CambioRedemptionFacet** — use `T3CommonLib.internalTransfer` + `ensureProfileExistsForWrite`, which is a general peer-to-peer transfer pattern, not escrow-specific. Leave on `T3CommonLib`.
- **Legacy transfer facets** (T3TokenTransferFacet, TransferManagementFacet, etc.) — direct peer-to-peer, different domain.

#### Design Note: Why a Library, Not a Base Contract
Solidity `internal` library functions are inlined at compile time — each facet gets the code baked into its own bytecode with no runtime coupling. This preserves diamond-pattern independence (each facet is independently deployable) while guaranteeing a single source of truth for escrow invariants. A base contract would introduce inheritance and potential selector collision risk.

#### Key Invariant Enforced
Any token movement through `address(this)` escrow **must** emit a Transfer event. This is required for Ponder indexer balance reconciliation and compliance audit trails. The current RewardsEscrow gap violates this invariant.

- Depends on: None (can be done independently)
- Blocks: FR-1404 (should be completed before Cambio adapter work begins)

### FR-1005: On-Chain View ACLs (App-Layer Privacy Layer 1)
**Status:** COMPLETE — ViewACLLib wired into facets, 43 unit tests passing (2026-04-25)
**Scope:** Implement `onlyCustodianOrOperator` access controls to protect all sensitive view functions from cross-bank enumeration.
- Define `isCustodianOf(msg.sender, wallet)` and `hasRole(OPERATOR_ROLE)` checks.
- Apply to `getEnvelope()`, `getKYCTimestamps()`, `getCustodian()`, and other globally exposing views.
- Prevents cross-bank visibility leakage during Tier 2/3 direct RPC fallback.

---

## Banking Issuance & Settlement (Waves 4–5)

These FRs implement the bank-deposit-issuance MVP on top of the claim-attribution
subledger wired by Phase G.0.a/b/c. Both ship behind admin activation gates that
default OFF, so the diamond preserves prior behavior until explicitly switched on.

### FR-2001: Attributed Issuance Capacity (Wave 4)
**Status:** COMPLETE (2026-06-15) — implemented, 10 unit tests passing (`test/unit/IssuanceCapacityModel.test.js`), merged via PR #134.
**Scope:** Per-bank issuance capacity bounded by factor-adjusted reserves and daily caps, with a quote → reserve → execute state machine.
- `IssuanceCapacityLib.sol` — capacity = `availableReserve − outstanding`, bounded by reservations + daily cap (`issuanceCapacity`, `dailyRemaining`, `availableToReserve`, `consumeDaily`).
- `IssuanceRoutingLib.sol` — reserve/execute/cancel/expire reservation state machine with TTL (default 1h) and replay protection. `reserve(bank, amount, creator)` records the reservation owner.
- `IssuanceControlFacet.sol` — `quoteIssuance`, `reserveIssuance`, `executeIssuance`, `cancelReservation`, `expireReservation`, `setCapacityModelActive`, `setBankDailyCap`. `executeIssuance` mints attributed supply (`mintAttributed` + Transfer + ConsortiumTokensMinted) and updates the ledger. Reservation owner gate: `msg.sender == creator || DEFAULT_ADMIN` (`NotReservationOwner`).
- `_requireBankIssuable` enforces active-bank status, zero active recovery count, and OP_MINT emergency gate.
- **Gate:** `capacityModelActive` (off by default). When ON, legacy `mint()` and `mintForConsortiumBank()` revert `CapacityModelActive`.
- **Reserve sizing:** uses `availableReserve` (= effectiveReserve − reimbursementEncumbered) at the bank's collateral factor (100% default = 1:1; fractional supported via `collateralFactorBps`).

### FR-2002: Bilateral-Net Interbank Settlement Cycle (Wave 5)
**Status:** COMPLETE (2026-06-15) — implemented, 15 unit tests passing (`test/unit/SettlementCycle.test.js`), merged via PR #134. Settlement-finality model recorded in **ADR-003** (product-owner gate signed; counsel gate pending — blocks production activation, not build).
**Scope:** Cross-bank transfers record interbank obligations into a settlement cycle that nets **per counterparty pair** (not gross, not multilateral-CCP) and encumbers a **bilateral-net** reimbursement lien on the outgoing bank.
- `SettlementCycleLib.sol` — `openCycle`, `recordObligation` (maintains `pairNet` + lien via encumbrance deltas through `ReserveControlLib`), `propose`, `confirm` (per-institution quorum), `markFailed`. `MAX_CYCLE_ISSUERS = 25`; self-obligation guard.
- `SettlementFundingLib.sol` — `recordFunding` (bilateral; replay key = hash(cycleId, debtor, creditor, netOwed, asset, paymentRef)), `finalize` (releases liens). CONFIRMED→FINALIZED short-circuit when all pairs net to zero.
- `SettlementCycleFacet.sol` — open/recordObligation/propose/confirm/recordFunding/challenge/finalize/fail + `setSettlementModelActive`. Keeper/attestor/emergency/member role surface. Guards: `paymentRef != 0`, debtor != creditor (`SelfFunding`), attestor != funding party, challenge requires FUNDING state + window.
- Wired into `TransferEnvelopeFacet._settleAmount`: when `settlementModelActive`, the cross-institution branch double-writes (`substituteLiability` + `recordObligation` per outgoing issuer). S1 guard: receiving issuer must be an ACTIVE registered bank. C2 guard: cross-bank FIAT settlement blocked (`CrossInstitutionFiatNotSupported`).
- **Gate:** `settlementModelActive` (off by default). When OFF, the Phase G.0.b cross-institution finalize behavior is preserved.
- **Netting property:** a $100-each-way A↔B exchange nets to zero locked collateral. Multilateral-net CCP is the documented scale endgame (future ADR + counsel), not this build.
- **Carried:** S4 collateral-release role guards (separate reimbursement-path review); ADR-003 counsel gate before production activation.

---

## Infrastructure & Compliance

### FR-ADR003-BESU: Relayer Fallback Policy (Besu Revision)
**Status:** COMPLETE — RelayerFallbackFacet implemented, wired, 24/24 tests passing (2026-04-26)

**Decisions made:**
- **Tier 3 eliminated** — attack surface reduction; compromised node cannot bypass relayer security
- **Two-tier architecture**: Tier 1 (normal via relayer) + Tier 2 (bank self-declared emergency fallback)
- **Tier 2 activation**: Bank calls `declareRelayerFallback(bytes32 reasonHash)` directly on diamond; 4-hour auto-expiry; no T3 approval required
- **Tier 2 revocation**: Bank calls `revokeOwnFallback()` when relayer recovers; T3 admin can also extend or force-revoke
- **Read access unchanged in Tier 2** — Tier 2 is a write-only path; `eth_getLogs` and `eth_getStorageAt` blocked at node for all bank credentials
- **Enforcement**: Besu JSON-RPC plugin intercepts `eth_sendRawTransaction`, extracts sender, calls `isFallbackActive(bank)` on diamond via `eth_call` (live storage, not cache), rejects if no active declaration
- **Audit trail**: `RelayerFallbackDeclared / Extended / Revoked` events indexed by Ponder; `revokedBy` field distinguishes self-revocation from T3 action

**New facet required:** `RelayerFallbackFacet` with isolated storage slot `keccak256("t3.storage.relayerfallback.v1")`

**Implementation sequence:** RelayerFallbackFacet → storage → deployment wiring → unit tests → Besu plugin → Ponder indexing

### FR-COMPLIANCE-BESU: Compliance Integration
**Status:** COMPLETE ✓ (Wave 6A) — the indexer compliance/banking APIs run on the Besu consortium RPC (`indexer/ponder.config.ts` chain `besu-local`, id 1337; `indexer/src/api/compliance.ts` id 1337). The earlier Fuji mis-wiring is resolved.
**Scope:** Ponder indexer configuration and permission-gated API.
- Compliance/banking endpoints served from the Besu consortium RPC
- Index all plaintext envelope events
- Index abstracted KYC tier assignments
- Permission-gate Explorer API by authenticated bank user role
- Compliance dashboards for custodian-scoped monitoring
- **Banking council note:** AML/sanctions screening on redemption, BSA/CIP identity, and the FDIC 12 CFR 370 depositor-record path are regulatory prerequisites before real-deposit operation — tracked as roadmap items, see the plan.

---

## Legacy Transfer Stack Cutover

### FR-CUTOVER: Legacy Transfer Stack Wrap/Deprecate/Freeze Plan
**Status:** COMPLETE (2026-06-13) — source-level cutover executed. Legacy stack was never deployed to production; no data migration was needed.
- **Outcome**: 15 legacy facets moved to `archive/legacy-facets/` with READMEs naming replacements. Selectors removed from `scripts/lib/facet-manifest.js`. The active diamond surface has since grown beyond the envelope core to include banking/consortium and rules/compliance facets (41 total).
- **Archived facets**: `T3TokenTransferFacet`, `T3TokenReversalExpiryFacet`, `T3BatchHalfLifeFacet`, `T3TokenPrefundedFeesFacet`, `T3TokenInterbankLiabilityFacet`, `T3MultiSigSettlementFacet`, `T3ComplianceMonitoringFacet`, `T3TokenEnhancedFeeFacet`, `SecureSettleFacet`, `T3AuditTrailsFacet`, `LockedTransferManagerFacet`, `TransferManagementFacet`, `CambioEscrowFacet`, `CambioRedemptionFacet`, `DiamondLoupeFacetV2`
- **No migration needed**: Legacy contracts had no production deployments or live user state.

---

## Adapters & Recovery

### FR-1402: Wallet Recovery Redesign
**Status:** COMPLETE (2026-05-21) — fully implemented, tested, and integrated with Core facets.
**Scope:** Redesign wallet recovery for Besu permissioned consortium architecture.
- **State Machine**: Simplified 5-state recovery machine (`None`, `RecoveryPending`, `RecoveryActive`, `RecoveryComplete`, `RecoveryCancelled`) with strict state transitions.
- **Access Control**: Enforces raw `msg.sender` authorization to bypass ERC-2771 meta-transaction vulnerabilities on privileged admin actions. Compromised wallets are blocked from self-cancelling self-initiated recoveries (`KeyRotation`).
- **Storage Layout**: Uses isolated Diamond storage namespace (`keccak256("t3.storage.wallet.recovery.v1")`). Implements bounded multi-hop successor resolution (up to 3 levels) with self-loop guards.
- **Balance Migration**: Support migration of liquid balances, prefunded fee balances, and incentive credits. Blocked if the old wallet has active legacy pending transfers or outstanding interbank liabilities.
- **Integration & Hooks**: Employs quarantine flags (`activeRecoveryCount[wallet] > 0`) checking in `TransferEnvelopeFacet`, `SmartLockEnvelopeFacet`, and `CambioEnvelopeFacet` to freeze compromised wallets.
- **Indexer Integration**: COMPLETE — Ponder handlers and replay-idempotency tests cover the recovery lifecycle, envelope resolution, Cambio-note resolution, and legacy/effective issuer attribution.
- **Maintenance Note (2026-06-11)**: Residual integrity hardening validates that bulk envelope and Cambio-note inputs belong to the recovery lineage before processing. This is narrow maintenance on the implemented design, not a redesign.

### FR-1403: SmartLock Adapter
**Status:** COMPLETE — implemented and tested (2026-04-20)
**Scope:** Migrate locked-transfer flow into envelope model using `HOLD_UNTIL_MANUAL`.
- Fragment-based release security preserved: `keccak256(fragment || nonce) == hashCommitment`
- Identity continuity: timestamp-based envelopeId (no epoch dependency — resolved by EnvelopeStorage nonce)
- `SmartLockEnvelopeStorage.sol` — isolated storage slot `keccak256("t3.storage.smartlock.envelope.v1")`
- `SmartLockEnvelopeFacet.sol` — create/release/cancel lifecycle with HOLD_UNTIL_MANUAL + CRYPTO_DIRECT
- `ISmartLockEnvelope.sol` — full interface with events
- Authorization: releaseAuthorizedAddress requires CUSTODIAN_ROLE; any other fragment-holder can release freely
- 43 unit tests covering all state transitions, escrow accounting, role checks, and error paths
- Wired into deployment: `test/helpers/deployment.js` (phase1Facets) and `scripts/deploy-diamond-complete.js`
- Depends on: FR-1001, FR-1002 ✓

### FR-1404: Cambio Adapter
**Status:** COMPLETE — envelope-mode Cambio is implemented, deployed by the current facet manifest, indexed by Ponder, and covered by unit tests.
**Scope:** Map QR-backed note issuance/redemption into envelope settlement.
- `CambioEnvelopeFacet` implements note creation, redemption, cancellation, commit-reveal, receipts, and recovery-aware effective issuer resolution.
- `CambioIssuerFacet` retains the active envelope-mode issuer and sponsor-bank registry surface.
- Ponder handlers cover envelope note creation, redemption, cancellation, and commit lifecycle events.
- Product documentation for QR payload conventions and redeemer UX remains separate follow-on work; it does not block the implemented contract adapter.
- Depends on: FR-1001, FR-1002, FR-1006, FR-1402 ✓

---

## Canceled (Avalanche Privacy — No Longer Required)

| FR | Original Scope | Reason |
|---|---|---|
| FR-1100 | Layer 0 Privacy (storage blinding) | Permissioned network provides visibility boundary |
| FR-1101 | Commitment & Blinding Primitives | No calldata obfuscation needed on Besu |
| FR-1102 | Layer 2 Privacy (event masking) | Events emit plaintext per ADR-004 |
| FR-1103 | Epoch Integration (salt rotation) | No identity rotation needed on permissioned network |
| FR-1302 | Commitment-Only Events | Superseded by plaintext events |

---

## Dependency Graph

```
FR-0004 (COMPLETE) ──┬── FR-1001 (COMPLETE ✓ 2026-04-08)
                      ├── FR-1002 (COMPLETE ✓ 2026-04-25)
                      ├── FR-1003 (COMPLETE ✓ 2026-04-08)
                      ├── FR-1004 (COMPLETE ✓ 2026-04-25)
                      ├── FR-1005 (COMPLETE ✓ 2026-04-25)
                      └── FR-1006 (COMPLETE ✓ 2026-04-23)
                            │
                            ├── FR-1402 (COMPLETE ✓ 2026-05-21)
                            ├── FR-1403 (COMPLETE ✓ 2026-04-20)
                            └── FR-1404 (COMPLETE ✓ 2026-05-25)

FR-ADR003-BESU (COMPLETE ✓ 2026-04-26) ── FR-COMPLIANCE-BESU (COMPLETE ✓ Wave 6A — indexer on Besu-local id 1337)

BANKING ISSUANCE & SETTLEMENT (Waves 4–5):
  G.0.a/b/c (claim-attribution wiring, COMPLETE) ──┬── FR-2001 Attributed Issuance Capacity (COMPLETE ✓ 2026-06-15, gate off)
                                                    └── FR-2002 Bilateral-Net Settlement Cycle (COMPLETE ✓ 2026-06-15, gate off; ADR-003 counsel gate pending)

LEGACY CUTOVER:
  FR-CUTOVER (COMPLETE ✓ 2026-06-13) — source archived, never deployed, no migration needed
  Legacy facets (15 total) → archive/legacy-facets/ with READMEs
```
