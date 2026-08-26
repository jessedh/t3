# T3 Bank Deposit Issuance and Settlement Development Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or the equivalent Kimi Code multi-agent workflow to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-gated bank-deposit issuance system that preserves one visible T3 balance, substitutes the receiving bank's liability for ordinary cross-bank transfers, preserves originating-bank liability while programmable value remains escrowed, and periodically settles aggregate reserve rebalancing. [Likely]

**Architecture:** The implementation uses isolated Diamond storage namespaces and canonical internal libraries. Direct single-bank issuance is proven first. Ordinary cross-bank transfer substitutes immediately. SmartLock, half-life, oracle, dispute, and provisional envelopes preserve exact originating-issuer composition until recipient-directed finalization, when claim attribution and beneficial reserve entitlement move atomically. Periodic cycles net physical reserve rebalancing. Sponsored issuance follows only after those invariants pass. [Likely]

**Tech Stack:** Solidity 0.8.24, EIP-2535 Diamond, Hardhat, Mocha/Chai, Ponder, TypeScript, Next.js 14, Wagmi/Viem, Playwright, and Kimi Code agents. [Certain]

**Canonical Design:** `Documentation/envelope_besu/specs/2026-06-10-t3-bank-deposit-issuance-settlement-design.md`. [Certain]

## Current Execution State (2026-06-11)

| Wave | Status | Resume point |
|---|---|---|
| Wave 0 | PARTIAL | ADR-001 product decision accepted; ADR-002 accepted 2026-06-11 (Wave 3A unblocked); ADR-003 draft (blocks Wave 5 only). ADR-001 banking-counsel approval remains pre-production gate. [Certain] |
| Wave 1 | COMPLETE | No Wave 1 implementation should be repeated. [Certain] |
| Wave 2 | COMPLETE | All tasks 2.1-2.4 complete. Attribution hooks installed; 1401 tests passing. [Certain] |
| Wave 3A | COMPLETE | ReserveControlStorage, ReserveValuationLib, ReserveControlLib implemented; MultiAssetVaultFacet refactored (two-phase pledge + floor release); 33 new tests (17 + 11 + 5). [Certain] |
| Wave 3B.1 | COMPLETE | InstitutionLifecycleStorage (InstitutionMode enum), BankingEligibilityLib, BankingEligibilityHarness implemented; 20 new tests (1 pending Wave 3B.2 KYC). [Certain] |
| Wave 3B.2 | COMPLETE | InstitutionLifecycleFacet (5-state machine + cross-reference), lifecycle gates added to ConsortiumMembershipFacet/InstitutionRegistryFacet/CustodianRegistryFacet; 36 new tests. [Certain] |
| Waves 4-10 | NOT STARTED under this plan | Resume only after the predecessor wave and the wave-specific approval gates below are satisfied. [Certain] |

**Latest verification:** `npm test` completed with 1,491 passing and 12 pending;
`npm run compile`, `node scripts/selector-collision-check.js` (464 selectors, no collisions),
and `git diff --check` (no whitespace errors) completed successfully on 2026-06-11 after
Wave 3A + Wave 3B.1 + Wave 3B.2. [Certain]

**Continuation handoff:** Verify current state against the code tree (manifest +
tests) before dispatching another implementation agent. [Certain]

---

## 1. Delivery Rules

### 1.1 Agent Isolation

Each Kimi implementation agent works in a dedicated git worktree and branch. Agents must not edit the same file concurrently. [Certain]

```bash
git worktree add ../t3-wave-<wave>-<agent> -b feature/t3-wave-<wave>-<agent>
```

One integration agent owns shared files in each wave:

- `contracts/lib/RoleConstants.sol`; [Certain]
- `contracts/lib/IssuanceControlStorage.sol`; [Certain]
- `contracts/facets/IssuanceControlFacet.sol`; [Certain]
- `scripts/lib/facet-manifest.js`; [Certain]
- `scripts/deploy-diamond-complete.js`; [Certain]
- `test/helpers/deployment.js`; [Certain]
- generated ABIs; [Certain]
- `indexer/ponder.schema.ts`; [Certain]
- cross-wave migration scripts. [Certain]

This single-integration-owner rule is mandatory for every wave from Wave 2 through Wave 9, where multiple agents run in parallel and touch the shared files above. `IssuanceControlStorage`/`IssuanceControlFacet` were introduced by Wave 0.5 (the emergency mint-bypass kill switch) and Wave 1 extends them, so they are shared files from Wave 1 onward. [Decided 2026-06-10]

### 1.2 Three-Stage Review Per Work Packet

Every code packet uses three Kimi roles:

1. **Implementer:** follows the task and writes tests first. [Certain]
2. **Specification reviewer:** checks behavior against the canonical design and invariants. [Certain]
3. **Security and quality reviewer:** checks storage, selector, authorization, reentrancy, migration, and missing tests. [Certain]

The implementer may revise after either review. The integration agent merges only after both reviewers report no unresolved Critical or High findings. [Certain]

### 1.3 Required Commands

Every contract packet runs:

```bash
npm run compile
npm test -- --grep "<focused suite>"
node scripts/selector-collision-check.js
node scripts/storage-layout-analyzer.js
git diff --check
```

Every indexer packet runs:

```bash
npm --prefix indexer run codegen
npm --prefix indexer run typecheck
npm --prefix indexer test
```

Every UI packet runs:

```bash
npm --prefix ui-management run type-check
npm --prefix ui-management run build
npm --prefix ui-management run test:e2e
```

### 1.4 No Production Activation from an Agent Branch

Agents may deploy to a local Hardhat or isolated Besu test environment. Main shared-environment activation, selector restriction, opening allocation, and role grants require the integration gate in Wave 9. [Certain]

---

## 2. Authoritative Domains

The implementation must keep these domains distinct. [Certain]

| Domain | Source of Truth | Conservation Rule |
|---|---|---|
| Wallet ownership | `StorageLib.AppStorage._balances` | Sum equals `totalSupply` |
| Holder and escrow claim attribution | `ClaimAttributionStorage` | Wallet claims equal wallet balance; domain-separated escrow claims equal the Diamond balance |
| Aggregate issuer liability and capacity | `ClaimAttributionStorage` plus `IssuanceCapacityStorage` | Issuer outstanding totals equal `totalSupply` |
| Reserve custody and valuation | `ReserveControlStorage` | Effective reserve remains above dynamic floor after risk-increasing actions |
| Settlement obligations | `SettlementCycleStorage` | Cycle net positions sum to zero |
| Institution lifecycle and authority | `InstitutionLifecycleStorage` plus existing role storage | Frozen institutions cannot increase risk |

Regulatory capacity is authorization data and never substitutes for funded reserves. [Certain]

---

## 3. Wave Dependency Graph

```text
Wave 0  Legal and accounting decisions
   |
Wave 1  Upgrade safety, roles, storage, interfaces
   |
Wave 2  Claim attribution and canonical supply accounting
   |
+-----------------------------+
|                             |
Wave 3A Reserve controls      Wave 3B Lifecycle and eligibility
|                             |
+--------------+--------------+
               |
Wave 4  Direct single-bank issuance vertical slice
               |
Wave 5  Cross-bank obligations and settlement engine
               |
+--------------+--------------------+
|              |                    |
Wave 6A Indexer/API  Wave 6B Keeper  Wave 6C Reconciliation
|              |                    |
+--------------+--------------------+
               |
Wave 7  Operations UI and runbooks
               |
Wave 8  Sponsored issuance
               |
Wave 9  Shadow migration and cutover
               |
Wave 10 Repo pilot, separately approved
```

Waves 3A and 3B may run in parallel. Waves 6A, 6B, and 6C may run in parallel after Wave 5 event signatures are frozen. [Certain]

### 3.1 External Spec Dependencies (cross-review reconciliation)

The graph above orders the internal waves. External designs remain constraints
on dependent waves, but completed dependencies should be treated as integration
contracts rather than open design blockers. [Updated 2026-06-11]

- **Wave 0.5 (done) precedes Wave 1.** The emergency mint-bypass kill switch
  (RES-01/RES-06) is already implemented on `feat/reserve-impl`; Wave 1 extends
  `IssuanceControlStorage` rather than reintroducing the bypass. [Decided 2026-06-10]
- **FR-1402 dependency is satisfied for Wave 3B and Wave 5.** Lifecycle/eligibility
  (Wave 3B) and the obligation/settlement/recovery engine (Wave 5) must reuse the
  implemented FR-1402 state machine, bounded successor semantics, quarantine
  checks, and role migration rather than inventing competing behavior. Residual
  FR-1402 maintenance does not reopen the design. [Updated 2026-06-11]
- **FR-CUTOVER (Wave J) blocks Wave 9.** The cutover policy determines opening
  balances for the settlement-cycle state machine, so Wave 9 (shadow migration
  and cutover) cannot start until FR-CUTOVER is finalized. [Decided 2026-06-10]
- **No dependency on FR-1404 (L), FR-COMPLIANCE-BESU (M), or public bearer
  redemption (N).** These are independent satellites and do not gate any reserve
  wave. [Decided 2026-06-10]

---

## 4. Wave 0: Legal, Accounting, and Product Gate

**Exit condition:** The project has signed decision records for the legal claim model, reserve funding evidence, sponsor funding, finality, and default authority. [Certain]

### Task 0.1: Approve the Holder Claim Model

**Status:** PRODUCT DECISION COMPLETE; banking-counsel approval remains open and
blocks production activation, not Wave 2 library development. [Certain]

**Files:**
- Create: `Documentation/envelope_besu/decisions/ADR-001-holder-issuer-claim-model.md`
- Reference: `Documentation/envelope_besu/specs/2026-06-10-t3-bank-deposit-issuance-settlement-design.md`

- [x] **Step 1: Record the selected legal model**

Use this decision:

```text
Cross-institution transfer immediately substitutes the approved receiving
issuer for the transferred customer liability. The receiving issuer must
have funded floor headroom, ceiling headroom, standing assumption authority,
and concentration capacity before the transfer executes.

Programmable envelope creation is not recipient settlement. While T3 remains
in Diamond escrow, originating issuer liability and claim composition remain
unchanged. Recipient-directed envelope finalization is the substitution event.
```

- [x] **Step 2: Record the technical consequence**

```text
The protocol maintains bounded wallet-by-issuer claim buckets.
Same-institution transfers move claim composition unchanged.
Ordinary cross-institution transfers debit outgoing-issuer claims and credit one
receiving-issuer claim bucket in the same transaction.
Settlement cycles move reserve value and do not rebucket customer claims.

Envelope creation records exact issuer composition by envelope ID.
Envelope reversal returns that composition.
Envelope finalization substitutes only the recipient-directed amount.
```

- [x] **Step 3: Record the initial bucket rule**

```text
Transfer allocation: FIFO by issuer-bucket insertion order.
Initial maximum active issuer buckets per wallet: 16.
Administrative maximum: 32.
Zero-value buckets are removed immediately.
```

- [x] **Step 4: Record secured reimbursement**

```text
The outgoing issuer's controlled reserve is encumbered at transfer time for
the receiving issuer. Failed reimbursement does not reverse the customer's
claim against the receiving issuer.
```

- [ ] **Step 5: Obtain banking counsel approval**

Approval must address transfer-time liability substitution, deposit status, depositor preference, deposit-insurance recordkeeping, secured reimbursement, default, and disclosures. [Certain]

- [x] **Step 6: Commit**

```bash
git add Documentation/envelope_besu/decisions/ADR-001-holder-issuer-claim-model.md
git commit -m "docs: decide holder issuer claim model"
```

### Task 0.2: Approve Reserve and Deposit-Origin Evidence

**Status:** COMPLETE (2026-06-11). Accounting/regulatory approval and banking-counsel
deposit-origin decision both received 2026-06-11. ADR-002 marked ACCEPTED. Wave 3A may begin. [Certain]

**Files:**
- Create: `Documentation/envelope_besu/decisions/ADR-002-reserve-funding-evidence.md`

- [x] **Step 1: Define accepted funding events**

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

- [x] **Step 2: Define the attestation payload**

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

- [x] **Step 3: Define prohibited accounting**

```text
Pledging an existing bank asset without a deposit-origin event does not
create a new customer deposit liability.

Issuing T3 against an existing deposit without extinguishing or converting
the original deposit would duplicate liabilities and is prohibited.
```

- [x] **Step 4: Obtain accounting and regulatory approval**

The approval must address balance-sheet recognition, reserve encumbrance, call-report presentation, Durbin treatment, and sponsor accounting. Received 2026-06-11 — all five items confirmed. Banking-counsel deposit-origin decision also received: deposit-origin remains non-blocking audit metadata. See `ADR-002-reserve-funding-evidence.md`. [Certain]

- [x] **Step 5: Commit**

```bash
git add Documentation/envelope_besu/decisions/ADR-002-reserve-funding-evidence.md
git commit -m "docs: define reserve funding evidence"
```

### Task 0.3: Approve Settlement and Default Authority

**Status:** TECHNICAL DRAFT COMPLETE; product/counsel approval and runbook
finality evidence remain open before Wave 5 begins. [Certain]

**Files:**
- Create: `Documentation/envelope_besu/decisions/ADR-003-settlement-finality-default.md`

- [x] **Step 1: Record finality**

```text
Customer liability substitution becomes final in the cross-bank transfer
transaction after receiving-issuer headroom and standing limits pass.
Interbank reserve reimbursement becomes final only after settlement funding
and protocol finalization.
```

- [x] **Step 2: Record failure behavior**

```text
Failure preserves the receiving issuer's customer liability and the outgoing
issuer's secured reimbursement obligation. Failure does not reverse customer
claim attribution.
```

- [x] **Step 3: Record default permissions**

```text
DEFAULT blocks issuance, sponsorship, reserve release, and new repo.
DEFAULT permits redemption, valid burns, settlement completion, collateral
enforcement, and resolution actions that reduce risk.
```

- [ ] **Step 4: Record Besu finality evidence**

The deployment runbook must identify the consensus protocol and the exact confirmation rule used by the keeper and indexer. [Certain]

- [x] **Step 5: Commit**

```bash
git add Documentation/envelope_besu/decisions/ADR-003-settlement-finality-default.md
git commit -m "docs: decide settlement finality and default authority"
```

---

## 5. Wave 1: Upgrade Safety, Roles, Storage, and Interfaces

**Status:** COMPLETE (2026-06-11) in commits `6207020`, `4113ca0`, `4218d57`, and `97a8cac`. [Certain]

**Exit condition:** Existing storage is unchanged, new namespaces have unique slots, stable interface primitives are frozen, and Diamond authorization no longer depends on the replaceable `hasRole` selector. [Certain]

### Parallel Agent Assignments

| Agent | Ownership |
|---|---|
| W1-A | `DiamondCutFacet.sol` and its security test |
| W1-B | Six new storage libraries |
| W1-C | Interfaces, errors, events, and role constants |
| W1-D | Storage and selector analysis tests |
| W1-I | Integration of shared deployment helpers |

### Task 1.1: Harden Diamond Cut Authorization

**Files:**
- Modify: `contracts/facets/DiamondCutFacet.sol`
- Test: `test/security/DiamondCutAuthorization.test.js`

- [x] **Step 1: Write the failing regression test**

```javascript
it("authorizes diamondCut from storage even when hasRole selector is replaced", async function () {
    await replacePublicHasRoleWithAlwaysFalseFacet();
    await expect(
        diamondCut.connect(owner).diamondCut(validCut, ethers.ZeroAddress, "0x")
    ).not.to.be.reverted;
    await expect(
        diamondCut.connect(attacker).diamondCut(validCut, ethers.ZeroAddress, "0x")
    ).to.be.revertedWithCustomError(accessControl, "UnauthorizedRole");
});
```

- [x] **Step 2: Run the test and verify failure**

```bash
npm test -- --grep "authorizes diamondCut from storage"
```

Expected: the authorized cut fails because `DiamondCutFacet` calls the replaced public selector. [Certain]

- [x] **Step 3: Replace the external self-call**

```solidity
if (accessControlAvailable) {
    if (!AccessControlLib.hasRole(ds, RoleConstants.DEFAULT_ADMIN_ROLE, _msgSender())) {
        revert StorageLib.UnauthorizedRole(_msgSender(), RoleConstants.DEFAULT_ADMIN_ROLE);
    }
}
```

- [x] **Step 4: Run focused and upgrade tests**

```bash
npm test -- --grep "DiamondCut"
```

Expected: authorized cuts pass and unauthorized cuts revert regardless of public `hasRole` selector ownership. [Certain]

- [x] **Step 5: Commit**

```bash
git add contracts/facets/DiamondCutFacet.sol test/security/DiamondCutAuthorization.test.js
git commit -m "security: harden diamond cut authorization"
```

### Task 1.2: Add Isolated Storage Namespaces

**Files:**
- Create: `contracts/lib/ClaimAttributionStorage.sol`
- Create: `contracts/lib/IssuanceCapacityStorage.sol`
- Create: `contracts/lib/IssuanceSponsorshipStorage.sol`
- Create: `contracts/lib/ReserveControlStorage.sol`
- Create: `contracts/lib/SettlementCycleStorage.sol`
- Create: `contracts/lib/InstitutionLifecycleStorage.sol`
- Test: `test/security/BankingStorageNamespaces.test.js`

- [x] **Step 1: Write slot uniqueness tests**

```javascript
it("uses unique banking storage namespaces", async function () {
    const slots = await storageHarness.getBankingStorageSlots();
    expect(new Set(slots).size).to.equal(slots.length);
});
```

- [x] **Step 2: Implement deterministic slots**

Use these namespace anchors:

```solidity
keccak256("t3.storage.claim-attribution.v1")
keccak256("t3.storage.issuance-capacity.v1")
keccak256("t3.storage.issuance-sponsorship.v1")
keccak256("t3.storage.reserve-control.v1")
keccak256("t3.storage.settlement-cycle.v1")
keccak256("t3.storage.institution-lifecycle.v1")
```

- [x] **Step 3: Add namespace metadata**

Each layout includes:

```solidity
uint32 storageVersion;
bool initialized;
uint256[48] __gap;
```

The gap appears only at the end of the new namespace. [Certain]

- [x] **Step 4: Verify the existing layout is unchanged**

```bash
npm run compile
node scripts/storage-layout-analyzer.js
git diff -- contracts/lib/StorageLib.sol contracts/lib/ConsortiumStorage.sol contracts/lib/InstitutionStorage.sol
```

Expected: no existing deployed field moves or changes type. [Certain]

- [x] **Step 5: Commit**

```bash
git add contracts/lib/*Storage.sol test/security/BankingStorageNamespaces.test.js
git commit -m "storage: add banking control namespaces"
```

### Task 1.3: Freeze Stable Events, Types, Errors, and Roles

**Files:**
- Create: `contracts/interfaces/IClaimAttribution.sol`
- Create: `contracts/interfaces/IIssuanceControl.sol`
- Create: `contracts/interfaces/ISettlementCycle.sol`
- Create: `contracts/interfaces/IInstitutionLifecycle.sol`
- Create: `contracts/lib/BankingErrors.sol`
- Modify: `contracts/lib/RoleConstants.sol`
- Modify: `test/helpers/roles.js`
- Test: `test/unit/BankingRoleConstants.test.js`
- Create: `Documentation/envelope_besu/specs/wave1-role-authority-matrix.md`

**Correction from prior draft:** The docs previously overstated a complete function-selector freeze. Wave 1 freezes stable events, types, errors, and roles only. Mutating facet selectors are added in their implementation waves after economics and state transitions are specified. Interfaces may contain type declarations, events, and clearly stable read functions; settlement and issuance mutating signatures are not invented ahead of their waves. [Certain]

- [x] **Step 1: Add narrow roles**

```solidity
bytes32 public constant ISSUER_OPERATOR_ROLE = keccak256("ISSUER_OPERATOR_ROLE");
bytes32 public constant SETTLEMENT_KEEPER_ROLE = keccak256("SETTLEMENT_KEEPER_ROLE");
bytes32 public constant SETTLEMENT_ATTESTOR_ROLE = keccak256("SETTLEMENT_ATTESTOR_ROLE");
bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");
bytes32 public constant LIFECYCLE_ADMIN_ROLE = keccak256("LIFECYCLE_ADMIN_ROLE");
bytes32 public constant EMERGENCY_SETTLEMENT_ROLE = keccak256("EMERGENCY_SETTLEMENT_ROLE");
```

`CONSORTIUM_AUDITOR_ROLE` already exists and must not be redeclared. [Certain]

- [x] **Step 2: Define state enums and public structs**

Interfaces must use the same enum values and field order as the storage libraries. [Certain]

Enums with safe zero defaults:

```solidity
enum IssuanceState { NONE=0, QUOTED=1, RESERVED=2, EXECUTED=3, CANCELLED=4, EXPIRED=5 }
enum CycleState { NONE=0, OPEN=1, PROPOSED=2, CONFIRMED=3, FUNDING=4, FINALIZED=5, FAILED=6 }
enum InstitutionMode { UNREGISTERED=0, ACTIVE=1, ISSUANCE_PAUSED=2, ORDERLY_EXIT=3, DEFAULTED=4, RESOLVED=5 }
```

**Correction from stale draft:** An earlier draft used `ACTIVE=0` for `InstitutionMode`. That has been corrected to `UNREGISTERED=0` so the zero default is safe and `ACTIVE` is an explicit opt-in state. [Certain]

Stable structs with exact canonical field order:

```solidity
struct ClaimBucket { address issuer; uint256 amount; }
struct CapacityAttestation { uint256 ceiling; uint256 capitalHeadroom; uint256 liquidityHeadroom; uint256 concentrationHeadroom; uint256 growthHeadroom; uint40 effectiveAt; uint40 expiresAt; bytes32 sourcePeriod; bytes32 formulaVersion; bytes32 evidenceHash; }
struct IssuerPosition { uint256 attributedOutstanding; uint256 pendingInboundReserveReimbursement; uint256 pendingOutboundReserveReimbursement; uint256 reservedIssuanceCapacity; uint256 reservedEnvelopeAssumptionCapacity; uint256 fixedLiquidityBuffer; uint16 variableLiquidityBufferBps; uint256 targetSurplus; }
struct Sponsorship { address sponsorIssuer; uint256 sponsorLimit; uint40 effectiveAt; uint40 expiresAt; bool bankOptedOut; bool sponsorAccepted; }
struct SettlementObligation { address outgoingIssuer; address receivingIssuer; address senderInstitution; address recipientInstitution; uint256 amount; bytes32 cycleId; bytes32 sourceTransferId; uint8 status; }
struct SettlementCycle { uint8 status; uint8 cycleType; uint40 openedAt; uint40 proposalDeadline; uint40 confirmationDeadline; uint40 fundingDeadline; uint40 challengeDeadline; bytes32 obligationRoot; bytes32 exceptionRoot; }
```

- [x] **Step 3: Define canonical events**

There are 23 events total. Ownership:

- `IClaimAttribution` — `ClaimBucketsMoved`, `IssuerLiabilitySubstituted`, `EnvelopeClaimEscrowed`, `EnvelopeLiabilitySubstituted`
- `IIssuanceControl` — `CapacityAttested`, `SponsorshipUpdated`, `IssuanceQuoted`, `IssuanceReserved`, `IssuanceExecuted`, `EnvelopeCapacityReserved`, `EnvelopeCapacityReleased`
- `ISettlementCycle` — `SettlementObligationRecorded`, `SettlementCycleProposed`, `SettlementCycleConfirmed`, `SettlementCycleFunded`, `SettlementCycleFinalized`, `SettlementCycleFailed`, `FedwireFallbackInitiated`, `FedwireAttested`, `FedwireChallenged`, `FedwireFinalized`
- `IInstitutionLifecycle` — `InstitutionModeUpdated`, `WalletInstitutionReassigned`

Event parameter types and indexing match canonical design Section 14 exactly, except `InstitutionModeUpdated` uses `uint8` to avoid enum coupling. [Certain]

- [x] **Step 4: Define BankingErrors**

Thirteen decoupled primitive-parameter errors: `StaleCapacityAttestation(address issuer, uint40 expiresAt, uint40 currentTime)`, `InsufficientFundedCapacity(address issuer, uint256 requested, uint256 available)`, `TransferHeadroomExceeded(address receivingIssuer, uint256 requested, uint256 available)`, `StandingAssumptionLimitExceeded(address outgoingIssuer, address receivingIssuer, uint256 requested, uint256 limit)`, `CeilingExceeded(address issuer, uint256 requested, uint256 ceiling)`, `IneligibleWallet(address wallet, bytes32 reason)`, `InvalidSponsor(address requestingBank, address sponsorIssuer)`, `InvalidCycleState(bytes32 cycleId, uint8 currentState, uint8 expectedState)`, `MissingPositionConfirmation(bytes32 cycleId, address institution)`, `DuplicateObligation(bytes32 obligationId)`, `ReusedPaymentReference(bytes32 paymentRef)`, `ReserveFloorBreached(address issuer, uint256 effectiveReserve, uint256 requiredFloor)`, `LifecycleFreeze(address institution, uint8 mode)`. State params use `uint8` so the library does not import interfaces. [Certain]

- [x] **Step 5: Define stable reads**

```solidity
// IClaimAttribution
function getWalletClaimIssuers(address wallet) external view returns (address[] memory);
function getWalletClaimAmount(address wallet, address issuer) external view returns (uint256);
function getIssuerAttributedOutstanding(address issuer) external view returns (uint256);
function totalAttributedOutstanding() external view returns (uint256);

// IIssuanceControl
function getCapacityAttestation(address issuer) external view returns (CapacityAttestation memory);
function getIssuerPosition(address issuer) external view returns (IssuerPosition memory);
function getSponsorship(address requestingBank, address sponsorIssuer) external view returns (Sponsorship memory);

// ISettlementCycle
function getSettlementObligation(bytes32 obligationId) external view returns (SettlementObligation memory);
function getSettlementCycle(bytes32 cycleId) external view returns (SettlementCycle memory);

// IInstitutionLifecycle
function getInstitutionMode(address institution) external view returns (uint8);
```

No write functions are added in Wave 1. [Certain]

- [x] **Step 6: Run role and selector tests**

```bash
npm test -- --grep "BankingRoleConstants"
node scripts/selector-collision-check.js
```

- [x] **Step 7: Commit**

```bash
git add contracts/interfaces contracts/lib/BankingErrors.sol contracts/lib/RoleConstants.sol test/helpers/roles.js test/unit/BankingRoleConstants.test.js Documentation/envelope_besu/specs/wave1-role-authority-matrix.md
git commit -m "interfaces: freeze banking control ABI and roles"
```

### Task 1.4: Integrate Storage and Selector Verification

**Files:**
- Review unchanged: `scripts/lib/facet-manifest.js`
- Review unchanged: `test/helpers/deployment.js`
- Review unchanged: `scripts/deploy-diamond-complete.js`
- Modify: `scripts/analyze-selectors.js`
- Modify: `scripts/selector-collision-check.js`
- Create: `scripts/lib/selector-tools.js`
- Create: `scripts/lib/verify-banking-storage-slots.js`
- Test: `test/unit/BankingStorageSlotScript.test.js`
- Test: `test/unit/SelectorManifestVerification.test.js`

- [x] **Step 1: Add no new active facets**

Wave 1 adds libraries and interfaces only. Do not add unfinished facet selectors to the production manifest. [Certain]

- [x] **Step 2: Add harness deployment only in tests**

The storage harness is test-only and excluded from `scripts/lib/facet-manifest.js`. [Certain]

- [x] **Step 3: Run compile and deployment fixture**

```bash
npm run compile
npm test -- --grep "T3 Diamond Test Fixture"
node scripts/lib/verify-banking-storage-slots.js
```

- [x] **Step 4: Remove stale selector-script assumptions**

Update `scripts/selector-collision-check.js` and `scripts/analyze-selectors.js` so they discover current manifest facets instead of hardcoding decommissioned `T3TokenTransferFacet`, `LockedTransferManagerFacet`, or `T3TokenReversalExpiryFacet` assumptions. [Certain]

- [x] **Step 5: Review selector ownership**

```bash
node scripts/analyze-selectors.js
node scripts/selector-collision-check.js
```

- [x] **Step 6: Commit**

```bash
git add scripts test/unit/BankingStorageSlotScript.test.js test/unit/SelectorManifestVerification.test.js
git commit -m "scripts: derive selector checks from facet manifest"
```

---

## 6. Wave 2: Claim Attribution and Canonical Supply Accounting

**Status:** COMPLETE. Tasks 2.1-2.3 are complete in commits `07e96cd`,
`d50b7da`, `fd4850f`, `3f4c255`, `aa1bd45`, `f8682ed`, and `12bcfa8`.
Task 2.4 complete — attribution hooks installed across all balance/supply paths,
`initialized` gate prevents regressions pre-cutover, 1401 tests passing. [Certain]

**Exit condition:** Every mint, transfer, escrow movement, burn, and recovery movement conserves wallet balances, claim buckets, issuer attribution, and total supply. [Certain]

This wave is the critical path and must be serialized around shared core libraries. [Certain]

### Task 2.1: Implement Claim Attribution Test Contract

**Status:** COMPLETE in commits `d50b7da` and `3f4c255`. [Certain]

**Files:**
- Create: `contracts/test/ClaimAttributionHarness.sol`
- Test: `test/unit/ClaimAttributionLib.test.js`

- [x] **Step 1: Write failing bucket tests**

Cover:

```text
credit new issuer bucket
credit existing issuer bucket
FIFO debit across buckets
move claims between wallets
escrow exact composition by domain-separated business-object key
partially release exact envelope composition
return exact envelope composition on cancellation
remove zero bucket
reject more than configured bucket maximum
reject debit larger than wallet claims
```

- [x] **Step 2: Add conservation assertions**

```javascript
expect(await claims.sumWalletClaims(wallet)).to.equal(await token.balanceOf(wallet));
expect(await claims.totalAttributedOutstanding()).to.equal(await token.totalSupply());
expect(await claims.sumActiveEscrowClaims()).to.equal(await token.balanceOf(diamond));
```

- [x] **Step 3: Run tests and verify failure**

```bash
npm test -- --grep "ClaimAttributionLib"
```

- [x] **Step 4: Commit tests**

```bash
git add contracts/test/ClaimAttributionHarness.sol test/unit/ClaimAttributionLib.test.js
git commit -m "test: specify holder claim attribution"
```

### Task 2.2: Implement `ClaimAttributionLib`

**Status:** COMPLETE in commits `07e96cd`, `fd4850f`, and `aa1bd45`. [Certain]

**Files:**
- Create: `contracts/lib/ClaimAttributionLib.sol`
- Modify: `contracts/lib/ClaimAttributionStorage.sol`
- Test: `test/unit/ClaimAttributionLib.test.js`

- [x] **Step 1: Implement credit and debit**

Required signatures:

```solidity
function credit(address wallet, address issuer, uint256 amount) internal;
function debitFifo(address wallet, uint256 amount)
    internal
    returns (address[] memory issuers, uint256[] memory amounts);
function creditComposition(
    address wallet,
    address[] memory issuers,
    uint256[] memory amounts
) internal;
```

- [x] **Step 2: Implement atomic movement**

```solidity
function moveClaims(address from, address to, uint256 amount)
    internal
    returns (bytes32 compositionHash);
```

- [x] **Step 3: Implement envelope-specific escrow**

```solidity
function escrowClaims(
    bytes32 domainSeparator,
    bytes32 businessObjectId,
    address sender,
    uint256 amount
) internal returns (bytes32 escrowKey, bytes32 compositionHash);

function releaseEnvelopeToSender(
    bytes32 domainSeparator,
    bytes32 businessObjectId,
    address sender,
    uint256 amount
) internal;
```

The library computes the domain-separated escrow key internally. The escrow ledger preserves exact issuer composition for envelopes, SmartLocks, Cambio, and other business objects independently from the aggregate claim buckets held by `address(this)`. [Certain]

- [x] **Step 4: Implement cross-bank substitution**

```solidity
function substituteForReceivingIssuer(
    address sender,
    address recipient,
    uint256 amount,
    address receivingIssuer
) internal returns (bytes32 outgoingCompositionHash);
```

The function debits the sender's deterministic outgoing-issuer composition and credits the recipient with a consolidated receiving-issuer claim bucket. It does not change total supply. [Certain]

- [x] **Step 5: Add envelope finalization helper**

```solidity
function finalizeEnvelopeClaims(
    bytes32 escrowKey,
    address recipient,
    address receivingIssuer,
    uint256 amount,
    bool crossInstitution
) internal returns (bytes32 outgoingCompositionHash);
```

Same-institution release preserves composition. Cross-institution release substitutes only the released recipient amount. [Certain]

- [x] **Step 6: Run focused tests**

```bash
npm test -- --grep "ClaimAttributionLib"
```

Expected: all bucket and conservation tests pass. [Certain]

- [x] **Step 7: Commit**

```bash
git add contracts/lib/ClaimAttributionLib.sol contracts/lib/ClaimAttributionStorage.sol test/unit/ClaimAttributionLib.test.js
git commit -m "lib: add holder claim attribution"
```

### Task 2.3: Implement Canonical Supply Accounting

**Status:** COMPLETE in commits `f8682ed` and `12bcfa8`. [Certain]

**Files:**
- Create: `contracts/lib/IssuanceAccountingLib.sol`
- Test: `test/unit/IssuanceAccountingLib.test.js`

- [x] **Step 1: Write failing mint and burn tests**

Required cases:

```text
mint credits wallet balance, holder claim, issuer outstanding, and supply
burn debits wallet claim composition, issuer outstanding, and supply
burn with mixed issuer buckets decrements each issuer correctly
failed operation changes no ledger
cross-bank substitution changes issuer attribution but not total supply
```

- [x] **Step 2: Implement mint**

```solidity
function mintAttributed(
    address issuer,
    address beneficiary,
    uint256 amount
) internal;
```

- [x] **Step 3: Implement burn**

```solidity
function burnAttributed(
    address account,
    uint256 amount
) internal returns (address[] memory issuers, uint256[] memory amounts);
```

- [x] **Step 4: Implement transfer-time liability substitution**

```solidity
function substituteLiability(
    address[] memory outgoingIssuers,
    uint256[] memory outgoingAmounts,
    address receivingIssuer,
    uint256 amount
) internal;
```

The operation decrements outgoing issuer totals, increments the receiving issuer total, and preserves `totalAttributedOutstanding` and total supply. [Certain]

- [x] **Step 5: Assert conservation after each operation**

The library checks `totalAttributedOutstanding == ds._totalSupply` before returning from any mint, burn, or issuer-substitution operation. [Certain]

- [x] **Step 6: Run tests and commit**

```bash
npm test -- --grep "IssuanceAccountingLib"
git add contracts/lib/IssuanceAccountingLib.sol test/unit/IssuanceAccountingLib.test.js
git commit -m "lib: canonicalize attributed supply accounting"
```

### Task 2.4: Route All Balance and Supply Paths

**Status:** COMPLETE (2026-06-11). All four prerequisites resolved. [Certain]

**Prerequisites resolved:**
1. Issuer binding via `ClaimAttributionLib.moveClaims` (composition follows money). [Certain]
2. `initialized` flag gates all attribution — no-op pre-cutover; Wave 9 activates. [Certain]
3. Pre-cutover generic writers unchanged; `LegacyIssuanceDisabled` guard fires post-activation. [Certain]
4. Diamond escrow 16-bucket limit explicitly accepted. [Certain]

**Files:**
- Modify: `contracts/lib/T3CommonLib.sol`
- Modify: `contracts/lib/EscrowLib.sol`
- Modify: `contracts/facets/T3TokenMintBurnFacet.sol`
- Modify: `contracts/facets/ERC20BaseFacet.sol`
- Modify: `contracts/facets/T3MultiSigSettlementFacet.sol`
- Modify: `contracts/facets/TransferEnvelopeFacet.sol`
- Modify: `contracts/facets/SmartLockEnvelopeFacet.sol`
- Modify: `contracts/lib/SmartLockEnvelopeLib.sol`
- Modify: `contracts/facets/CambioEnvelopeFacet.sol`
- Modify: `contracts/facets/CambioEscrowFacet.sol`
- Modify: `contracts/facets/CambioRedemptionFacet.sol`
- Test: `test/security/ClaimConservationInvariant.test.js`
- Test: existing envelope, Cambio, recovery, and mint/burn suites

- [x] **Step 1: Write a failing cross-path invariant test**

Exercise:

```text
mint
direct transfer
envelope escrow and release
half-life partial reversal
SmartLock cancellation
cross-bank envelope partial split
fiat envelope burn
Cambio escrow and redemption
wallet recovery migration
administrative burn
```

- [x] **Step 2: Update ordinary transfers**

`T3CommonLib.internalTransfer` moves the same claim composition as the balance amount for ordinary same-institution movement. Envelope and Cambio creation use domain-separated `escrowClaims` keys so shared Diamond escrow remains attributable by business object. [Certain]

- [x] **Step 3: Update escrow burns**

Replace the issuer-blind signature with:

```solidity
function burnEscrow(
    bytes32 domainSeparator,
    bytes32 businessObjectId,
    uint256 amount
) internal;
```

The function reads the exact escrow composition, decrements each issuer's attributed outstanding through `IssuanceAccountingLib`, updates the escrow record, and only then reduces the Diamond balance and total supply. Update `TransferEnvelopeFacet` and `WalletRecoveryFacet.applyBulkPolicy` to pass the envelope domain and ID. [Certain]

- [x] **Step 4: Restrict direct mint and burn writes**

`T3TokenMintBurnFacet` delegates to `IssuanceAccountingLib`. `ERC20BaseFacet` must not remain an alternative production supply writer. [Certain]

- [x] **Step 5: Isolate legacy settlement transfer**

Until deprecated, `T3MultiSigSettlementFacet._internal_transfer` must call `T3CommonLib.internalTransfer` so it cannot bypass claim movement. [Certain]

- [x] **Step 6: Integrate Cambio escrow domains**

Use separate Cambio note and Cambio escrow domain separators. `CambioEnvelopeFacet`, `CambioEscrowFacet`, and `CambioRedemptionFacet` must create, release, cancel, and redeem through the corresponding escrow claim record rather than moving aggregate `address(this)` claims. [Certain]

- [x] **Step 7: Run broad regression**

```bash
npm test -- --grep "MintBurn|DirectTransfer|TransferEnvelope|CambioEnvelope|WalletRecovery|ClaimConservation"
```

- [x] **Step 8: Commit**

```bash
git add contracts test
git commit -m "token: conserve issuer claims across all paths"
```

---

## 7. Wave 3A: Reserve Control and Valuation

**Exit condition:** Reserve positions have settled, pending, encumbered, beneficial-owner, valuation, haircut, and staleness state, and releases cannot breach the dynamic floor. [Certain]

### Task 3A.1: Specify Reserve Valuation

**Files:**
- Test: `test/unit/ReserveValuationLib.test.js`
- Create: `contracts/test/ReserveValuationHarness.sol`

- [x] **Step 1: Write formula tests**

```javascript
it("applies price, collateral factor, and haircut", async function () {
    expect(await harness.eligibleValue(
        parseUnits("100", 6),
        6,
        parseUnits("1", 18),
        9000,
        500
    )).to.equal(parseUnits("85.5", 18));
});
```

- [x] **Step 2: Add stale and unsettled tests**

Issuance capacity is zero when price data or custody settlement evidence is stale. [Certain]

- [x] **Step 3: Add encumbrance tests**

Committed floor, pending withdrawal, disputed value, and settlement funding encumbrances reduce available reserve. [Certain]

- [x] **Step 4: Run and commit tests**

```bash
npm test -- --grep "ReserveValuationLib"
git add contracts/test/ReserveValuationHarness.sol test/unit/ReserveValuationLib.test.js
git commit -m "test: specify reserve valuation"
```

### Task 3A.2: Implement Reserve Valuation and Control

**Files:**
- Create: `contracts/lib/ReserveValuationLib.sol`
- Create: `contracts/lib/ReserveControlLib.sol`
- Modify: `contracts/facets/MultiAssetVaultFacet.sol`
- Test: `test/unit/MultiAssetVaultFacet.test.js`
- Test: `test/security/ReserveFloorInvariant.test.js`

- [x] **Step 1: Implement value calculation**

```solidity
function eligibleValue(
    uint256 quantity,
    uint8 decimals,
    uint256 price,
    uint16 collateralFactorBps,
    uint16 haircutBps
) internal pure returns (uint256);
```

- [x] **Step 2: Implement effective reserve**

```solidity
function effectiveReserve(address issuer) internal view returns (uint256);
```

- [x] **Step 3: Refactor pledge**

Pledge records pending transfer first and settled quantity only after the approved token transfer and settlement confirmation succeed. [Certain]

- [x] **Step 4: Implement reimbursement encumbrance**

Cross-bank transfer can atomically encumber outgoing-issuer reserve for a named receiving issuer. The encumbrance cannot be released except by completed reimbursement, compliant collateral substitution, or authorized resolution. [Certain]

- [x] **Step 5: Implement beneficial-entitlement transfer**

For approved consortium or custodian omnibus reserve wallets, add an atomic per-bank beneficial-ownership movement used by ordinary cross-bank transfer and envelope finalization. The physical token quantity may be netted and rebalanced later, but the entitlement ledger must remain fully conserved. [Likely]

- [x] **Step 6: Refactor release**

Release computes post-release effective reserve and compares it with the current dynamic floor. [Certain]

- [x] **Step 7: Add atomic substitution**

Substitution releases the old asset only after the replacement asset is settled and post-substitution reserve remains compliant. [Certain]

- [x] **Step 8: Run tests and commit**

```bash
npm test -- --grep "MultiAssetVault|ReserveFloor"
git add contracts/lib/ReserveValuationLib.sol contracts/lib/ReserveControlLib.sol contracts/facets/MultiAssetVaultFacet.sol test
git commit -m "vault: enforce valued reserve controls"
```

---

## 8. Wave 3B: Institution Lifecycle and Eligibility

**Dependency satisfied:** FR-1402 is implemented; this wave must integrate with its recovery/lifecycle model and must not create a parallel default or successor mechanism (see §3.1). [Updated 2026-06-11]

**Exit condition:** Every risk-increasing path can determine institution, KYC, custody, recovery, and lifecycle eligibility from canonical shared logic. [Certain]

### Task 3B.1: Implement Banking Eligibility

**Files:**
- Create: `contracts/lib/BankingEligibilityLib.sol`
- Test: `test/unit/BankingEligibilityLib.test.js`

- [x] **Step 1: Write eligibility tests**

Cover active bank wallets, active affiliated customer wallets, expired KYC, revoked affiliation, wallet recovery, issuance pause, orderly exit, and default. [Certain]

- [x] **Step 2: Implement read-only checks**

```solidity
function requireEligibleWallet(address wallet) internal view returns (bytes32 institutionId);
function requireRiskIncreasingInstitution(address institution) internal view;
function requireRiskReducingInstitution(address institution) internal view;
```

- [x] **Step 3: Verify redemption remains available**

The default test must allow an authorized attributed burn while rejecting mint and reserve release. [Certain]

- [x] **Step 4: Run and commit**

```bash
npm test -- --grep "BankingEligibilityLib"
git add contracts/lib/BankingEligibilityLib.sol test/unit/BankingEligibilityLib.test.js
git commit -m "lib: centralize banking eligibility"
```

### Task 3B.2: Implement Institution Lifecycle

**Files:**
- Create: `contracts/facets/InstitutionLifecycleFacet.sol`
- Modify: `contracts/facets/ConsortiumMembershipFacet.sol`
- Modify: `contracts/facets/InstitutionRegistryFacet.sol`
- Modify: `contracts/facets/CustodianRegistryFacet.sol`
- Test: `test/unit/InstitutionLifecycleFacet.test.js`
- Test: `test/integration/InstitutionDefaultFreeze.test.js`

- [x] **Step 1: Implement mode transitions**

```text
ACTIVE -> ISSUANCE_PAUSED
ACTIVE -> ORDERLY_EXIT
ACTIVE -> DEFAULT
ISSUANCE_PAUSED -> ACTIVE
ORDERLY_EXIT -> RESOLVED
DEFAULT -> RESOLVED
```

- [x] **Step 2: Reject unsafe direct deactivation**

`setBankActivation(false)` must route through lifecycle logic or revert when outstanding claims, reserves, or cycles exist. [Certain]

- [x] **Step 3: Integrate affiliation and custody**

Lifecycle status is checked before wallet linking, custodian reassignment, issuance, and reserve release. [Certain]

- [x] **Step 4: Add default integration hooks**

The facet exposes internal library functions for Wave 5 to fail or quarantine open cycles. [Certain]

- [x] **Step 5: Run and commit**

```bash
npm test -- --grep "InstitutionLifecycle|InstitutionDefaultFreeze"
git add contracts/facets contracts/lib test
git commit -m "lifecycle: enforce institution risk states"
```

---

## 9. Wave 4: Direct Single-Bank Issuance Vertical Slice

**Exit condition:** One bank can fund reserves, receive a capacity attestation, issue T3 directly, transfer within its institution, redeem, and prove all invariants. [Certain]

### Task 4.1: Implement Capacity Attestations

**Files:**
- Create: `contracts/lib/IssuanceCapacityLib.sol`
- Create: `contracts/facets/IssuanceControlFacet.sol`
- Test: `test/unit/IssuanceCapacityLib.test.js`
- Test: `test/unit/IssuanceControlFacet.test.js`

- [ ] **Step 1: Write signature and expiry tests**

Test accepted risk-admin attestation, unauthorized signer, future effective time, expired attestation, duplicate evidence hash, and lower replacement ceiling. [Certain]

- [ ] **Step 2: Implement capacity**

```solidity
function executableCapacity(address issuer) internal view returns (uint256);
```

The result is the minimum of funded, regulatory, concentration, growth, and consortium headroom. [Certain]

- [ ] **Step 3: Implement attestation submission**

```solidity
function submitCapacityAttestation(
    address issuer,
    CapacityAttestation calldata attestation
) external;
```

- [ ] **Step 4: Run tests and commit**

```bash
npm test -- --grep "IssuanceCapacity|IssuanceControl"
git add contracts test
git commit -m "issuance: add expiring capacity attestations"
```

### Task 4.2: Implement Quote, Reservation, and Direct Issuance

**Files:**
- Modify: `contracts/facets/IssuanceControlFacet.sol`
- Create: `contracts/lib/IssuanceRoutingLib.sol`
- Test: `test/integration/DirectBankIssuance.test.js`

- [ ] **Step 1: Write the direct issuance lifecycle test**

```text
submit funding attestation
settle reserve
submit capacity attestation
request quote
reserve capacity
execute issuance
same-institution transfer
redeem and burn
```

- [ ] **Step 2: Implement quote and reservation**

```solidity
function quoteIssuance(
    address servicingInstitution,
    address beneficiary,
    uint256 amount,
    address preferredIssuer
) external returns (bytes32 quoteId);

function reserveIssuance(bytes32 quoteId) external returns (bytes32 reservationId);
```

- [ ] **Step 3: Implement direct execution**

Execution verifies funding evidence, reserve, capacity, lifecycle, claim bucket capacity, and quote expiry before attributed mint. [Certain]

- [ ] **Step 4: Implement cancellation and expiry**

Expired reservations release reserved capacity without changing outstanding supply. [Certain]

- [ ] **Step 5: Run integration and invariant tests**

```bash
npm test -- --grep "DirectBankIssuance|ClaimConservation|ReserveFloor"
```

- [ ] **Step 6: Commit**

```bash
git add contracts test
git commit -m "issuance: add direct bank issuance flow"
```

### Task 4.3: Replace Unsafe Production Mutation Paths in Test Deployment

**Files:**
- Modify: `contracts/facets/T3TokenMintBurnFacet.sol`
- Modify: `contracts/facets/BankDepositTokenFacet.sol`
- Test: `test/security/LegacyIssuanceBypass.test.js`

- [ ] **Step 1: Add shadow-mode guards**

Legacy mutation functions, including `mint`, `burn`, `mintForConsortiumBank`, `burnForConsortiumBank`, `adjustDepositBalance`, and `recordMintBurn`, remain callable only while an explicit shadow flag is enabled and only by the migration controller. When shadow mode is disabled, they revert or delegate to canonical attributed accounting. [Certain]

- [ ] **Step 2: Add bypass tests**

```javascript
await expect(mintBurn.connect(minter).mint(user, amount))
    .to.be.revertedWithCustomError(issuance, "LegacyIssuanceDisabled");
await expect(bankDeposit.recordMintBurn(bank, amount, 0))
    .to.be.revertedWithCustomError(issuance, "LegacyIssuanceDisabled");
await expect(mintBurn.connect(bank).mintForConsortiumBank(bank, user, amount))
    .to.be.revertedWithCustomError(issuance, "LegacyIssuanceDisabled");
```

- [ ] **Step 3: Keep reads available**

Legacy deposit account and mint statistics remain readable for reconciliation. [Certain]

- [ ] **Step 4: Run and commit**

```bash
npm test -- --grep "LegacyIssuanceBypass"
git add contracts test
git commit -m "issuance: gate legacy mutation paths"
```

---

## 10. Wave 5: Cross-Bank Obligations and Settlement

**Dependency satisfied:** FR-1402 is implemented; this wave must reuse its recovery, successor, and resolution semantics (see §3.1). [Updated 2026-06-11]

**Exit condition:** Cross-institution transfers immediately substitute the receiving issuer under funded standing limits, encumber outgoing reserve, and create secured reimbursement obligations that periodic cycles can settle or resolve. [Likely]

### Task 5.1: Record Canonical Obligations

**Files:**
- Create: `contracts/lib/SettlementCycleLib.sol`
- Modify: `contracts/lib/ClaimAttributionLib.sol`
- Modify: `contracts/lib/IssuanceAccountingLib.sol`
- Modify: `contracts/lib/ReserveControlLib.sol`
- Modify: `contracts/facets/T3TokenDirectTransferFacet.sol`
- Test: `test/integration/CrossInstitutionObligation.test.js`

- [ ] **Step 1: Write transfer tests**

Test same-institution transfer, cross-institution substitution, mixed outgoing issuer buckets, chained A-to-B-to-C transfer, insufficient receiving reserve, insufficient ceiling, standing-limit breach, concentration breach, duplicate event prevention, recovery quarantine, and ineligible recipient. [Certain]

- [ ] **Step 2: Implement obligation identifiers**

```solidity
obligationId = keccak256(
    abi.encode(
        bytes32("T3_SETTLEMENT_OBLIGATION_V1"),
        block.chainid,
        protocolNonce,
        sourceTransferId,
        outgoingIssuer,
        receivingIssuer
    )
);
```

- [ ] **Step 3: Snapshot institution identities**

Resolve and persist immutable `senderInstitutionId`, `recipientInstitutionId`, outgoing issuer composition, receiving issuer, and affiliation evidence version at the transfer event. Current wallet affiliation must not be used to rewrite historical obligations. [Certain]

- [ ] **Step 4: Validate receiving-issuer assumption**

Before moving value, validate receiving-issuer funded reserve headroom, ceiling headroom, standing assumption limit, concentration limit, lifecycle state, and bucket capacity. [Certain]

- [ ] **Step 5: Substitute liability and secure reimbursement**

The transfer debits the sender's outgoing-issuer claims, credits one receiving-issuer claim bucket, updates aggregate issuer attribution without changing supply, encumbers outgoing reserve for the receiving issuer, and records the reimbursement obligation atomically. [Certain]

- [ ] **Step 6: Aggregate by institution and issuer**

Build cycle positions from stable institution and issuer identifiers:

```text
(cycleId, outgoingIssuerId, receivingIssuerId, settlementAsset)
```

Wallet events remain drill-down evidence; institution-level net positions are the settlement primitive. [Certain]

- [ ] **Step 7: Prove chained transfer semantics**

After A-to-B and B-to-C transfers, the final holder has a claim against C, B owes C reimbursement, and A's earlier obligation to B remains independently settled or outstanding. No customer claim points back to A merely because interbank settlement is pending. [Likely]

- [ ] **Step 8: Run and commit**

```bash
npm test -- --grep "CrossInstitutionObligation"
git add contracts test
git commit -m "settlement: record cross-bank obligations"
```

### Task 5.1A: Integrate Programmable Envelope Liability Finality

**Files:**
- Modify: `contracts/lib/ClaimAttributionStorage.sol`
- Modify: `contracts/lib/ClaimAttributionLib.sol`
- Modify: `contracts/lib/IssuanceAccountingLib.sol`
- Modify: `contracts/lib/ReserveControlLib.sol`
- Modify: `contracts/facets/TransferEnvelopeFacet.sol`
- Modify: `contracts/facets/SmartLockEnvelopeFacet.sol`
- Modify: `contracts/lib/SmartLockEnvelopeLib.sol`
- Test: `test/integration/EnvelopeIssuerFinality.test.js`
- Test: existing `TransferEnvelopeFacet.*` and `SmartLockEnvelopeFacet.test.js`

- [ ] **Step 1: Write failure-first envelope accounting tests**

Cover cross-bank `HALFLIFE_DECAY`, `HOLD_UNTIL_MANUAL`, SmartLock fragment release, cancellation, oracle finalize and reverse, dispute recipient award, sender award, partial split, provisional fiat clawback, and envelope burn. [Certain]

- [ ] **Step 2: Preserve issuer composition at creation**

`createEnvelope` and `createSmartLockEnvelope` move the sender's exact claim composition into `escrowClaims[envelopeEscrowKey(envelopeId)]` and the Diamond escrow balance without changing aggregate issuer attribution. [Certain]

- [ ] **Step 3: Reserve contingent receiving capacity**

For a cross-bank recipient, reserve the maximum recipient-directed amount against a distinct `reservedEnvelopeAssumptionCapacity`, the receiving issuer's ceiling, standing assumption limit, and concentration limit. If custody cannot transfer beneficial reserve entitlement by book entry at finalization, also reserve prefunded floor headroom. Record the reservation expiry and renewal authority. [Likely]

- [ ] **Step 4: Finalize recipient value**

Recipient-directed finalization consumes reserved capacity, substitutes only the released amount to the receiving issuer, shifts equal beneficial reserve entitlement or secured reimbursement, and records an intraday rebalancing obligation. Physical reserve tokens may remain in an approved consortium or custodian omnibus wallet until the aggregate cycle. [Likely]

- [ ] **Step 5: Preserve sender value**

Reversal, cancellation, clawback, and sender-directed dispute value return the exact originating-issuer composition and release unused receiving capacity. [Certain]

- [ ] **Step 6: Implement half-life partial reversal**

The reversed amount returns to the sender or recovery successor with exact originating-issuer composition. No receiving-issuer substitution occurs for the reversed amount. [Certain]

- [ ] **Step 7: Implement dispute partial split**

Only `splitAmount` released to a cross-bank recipient substitutes to the receiving issuer. The remainder returned to the sender or recovery successor preserves originating issuers. [Certain]

- [ ] **Step 8: Preserve fiat-envelope burn semantics**

Confirmed `FIAT_INSTITUTIONAL` delivery burns the envelope's exact originating-issuer composition and does not create receiving-issuer T3 liability. Clawback returns the exact originating composition. [Certain]

- [ ] **Step 9: Handle long-running SmartLocks**

An expired contingent reservation cannot silently block a valid fragment release. The envelope enters an explicit renewal, approved reroute, or resolution path, and the UI and keeper surface the condition before expiry. [Likely]

- [ ] **Step 10: Handle institution default and recovery**

Receiving-issuer default before finalization requires renewal, approved sponsor or successor reroute, or reversal under the envelope terms. Outgoing-issuer default preserves envelope composition and protected reserve. Recovery successor routing must move claim buckets to the same payee that receives the ERC-20 balance. [Likely]

- [ ] **Step 11: Run focused and regression tests**

```bash
npm test -- --grep "EnvelopeIssuerFinality|TransferEnvelope|SmartLockEnvelope"
```

- [ ] **Step 12: Commit**

```bash
git add contracts test
git commit -m "envelope: transfer bank liability at finalization"
```

### Task 5.2: Implement Settlement Cycle State Machine

**Files:**
- Create: `contracts/facets/SettlementCycleFacet.sol`
- Modify: `contracts/lib/SettlementCycleStorage.sol`
- Test: `test/unit/SettlementCycleFacet.test.js`
- Test: `test/security/SettlementCycleInvariant.test.js`

- [ ] **Step 1: Write every transition test**

```text
OPEN -> PROPOSED
PROPOSED -> CONFIRMED
CONFIRMED -> FUNDING
FUNDING -> FINALIZED
OPEN|PROPOSED|CONFIRMED|FUNDING -> FAILED
FAILED -> EXCEPTION
```

- [ ] **Step 2: Implement timestamp deadlines**

Store timestamp deadlines plus transition block number and transaction hash evidence in indexed events. [Certain]

- [ ] **Step 3: Implement proposal root validation**

Reject missing, duplicate, finalized, failed, or mismatched obligations. Reject more than 64 obligations. Confirm reimbursement net positions sum to zero. [Certain]

- [ ] **Step 4: Implement position confirmation**

Each participating bank confirms its exact reimbursement position and settlement instructions. Finalization reverts if any required confirmation is absent or stale. [Certain]

- [ ] **Step 5: Implement failure**

Failure leaves transfer-time customer claim attribution unchanged, preserves reimbursement collateral and positions, and creates exception entries. [Certain]

- [ ] **Step 6: Run and commit**

```bash
npm test -- --grep "SettlementCycle"
git add contracts test
git commit -m "settlement: add cycle state machine"
```

### Task 5.3: Implement Tokenized-Asset DvP

**Files:**
- Create: `contracts/lib/SettlementFundingLib.sol`
- Modify: `contracts/facets/SettlementCycleFacet.sol`
- Test: `test/integration/TokenizedSettlementDvp.test.js`
- Create: `contracts/mocks/MockFailingSettlementAsset.sol`

- [ ] **Step 1: Write failure-first tests**

Test failed transfer, fee-on-transfer asset, stale valuation, insufficient amount, revoked asset, collateral shortfall, default during funding, and replayed funding reference. [Certain]

- [ ] **Step 2: Lock funding**

Funding transfers an approved asset into controlled escrow and records actual received quantity. [Certain]

- [ ] **Step 3: Finalize atomically**

Finalization transfers settlement funding, clears matching reserve encumbrances and reimbursement positions, and leaves holder claims and aggregate issuer liability unchanged. [Certain]

- [ ] **Step 4: Fail safely**

Any failure reverts reserve movement and retains the receiving issuer's customer liability, outgoing issuer's reimbursement obligation, and secured collateral state. [Certain]

- [ ] **Step 5: Run and commit**

```bash
npm test -- --grep "TokenizedSettlementDvp"
git add contracts test
git commit -m "settlement: add atomic tokenized funding"
```

### Task 5.4: Implement Exception and Fedwire Fallback

**Files:**
- Modify: `contracts/lib/SettlementCycleStorage.sol`
- Modify: `contracts/facets/SettlementCycleFacet.sol`
- Test: `test/integration/FedwireFallback.test.js`
- Test: `test/security/FedwireReplay.test.js`

- [ ] **Step 1: Implement exception records**

```solidity
struct SettlementException {
    bytes32 obligationId;
    uint40 failedAt;
    uint16 retryCount;
    uint8 resolutionPath;
    uint8 status;
    bytes32 evidenceHash;
}
```

- [ ] **Step 2: Implement payment references**

```solidity
paymentRef = keccak256(
    abi.encode(
        bytes32("T3_FEDWIRE_V1"),
        block.chainid,
        cycleId,
        obligationRoot,
        protocolNonce
    )
);
```

- [ ] **Step 3: Implement dual attestation and quorum**

Require outgoing issuer, receiving issuer, and configured consortium quorum before challenge-period finality. [Certain]

- [ ] **Step 4: Implement replay and challenge**

Used payment references remain permanently marked. Challenges block finalization until resolved. [Certain]

- [ ] **Step 5: Run and commit**

```bash
npm test -- --grep "FedwireFallback|FedwireReplay"
git add contracts test
git commit -m "settlement: add exceptions and Fedwire fallback"
```

### Task 5.5: Integrate Default and Recovery

**Files:**
- Modify: `contracts/facets/InstitutionLifecycleFacet.sol`
- Modify: `contracts/facets/WalletRecoveryFacet.sol`
- Test: `test/integration/SettlementDefaultRecovery.test.js`

- [ ] **Step 1: Test default in every cycle state**

Default may fail, quarantine, enforce collateral, or complete a cycle according to its state, but cannot reverse a customer's receiving-issuer claim. [Certain]

- [ ] **Step 2: Test wallet recovery in every cycle state**

Recovery completion blocks while unresolved obligations reference the recovering authority unless the cycle is failed or finalized. [Certain]

- [ ] **Step 3: Implement shared hooks**

Lifecycle and recovery call internal settlement libraries rather than duplicating obligation state. `WalletRecoveryFacet.migrateBalance` must move the complete issuer claim composition atomically with the raw balance and assert that the successor's claim sum equals its post-migration balance. [Certain]

- [ ] **Step 4: Run and commit**

```bash
npm test -- --grep "SettlementDefaultRecovery"
git add contracts test
git commit -m "recovery: integrate settlement obligations"
```

---

## 11. Wave 6A: Indexer and API

**Exit condition:** Every canonical event has an idempotent projection, and APIs expose issuer claims, reserves, cycles, exceptions, and reconciliation. [Certain]

### Task 6A.1: Add Ponder Tables

**Files:**
- Modify: `indexer/ponder.schema.ts`
- Modify: `indexer/src/index.ts`
- Test: `indexer/src/banking-events.test.ts`

- [ ] **Step 1: Add enums and tables**

Add the tables listed in canonical design Section 15 plus:

```text
wallet_issuer_claim
envelope_issuer_claim
envelope_capacity_reservation
claim_movement
legacy_shadow_reconciliation
keeper_heartbeat
```

- [ ] **Step 2: Add idempotent handlers**

Primary keys use transaction hash plus log index or canonical protocol identifier. [Certain]

- [ ] **Step 3: Preserve legacy tables**

`secure_settlement_event`, `multi_sig_settlement_event`, and `interbank_liability_event` remain historical and receive no canonical cycle writes. [Certain]

- [ ] **Step 4: Run and commit**

```bash
npm --prefix indexer run codegen
npm --prefix indexer run typecheck
npm --prefix indexer test
git add indexer
git commit -m "indexer: project banking issuance and settlement"
```

### Task 6A.2: Add APIs

**Files:**
- Modify: `indexer/src/api/index.ts`
- Modify: `indexer/src/api/compliance.ts`
- Create: `indexer/src/api/banking.ts`
- Test: `indexer/src/api/banking.test.ts`

- [ ] **Step 1: Add capacity and claim endpoints**

```text
GET /banking/issuers/:issuer/capacity
GET /banking/issuers/:issuer/reserves
GET /banking/issuers/:issuer/transfer-headroom
GET /banking/wallets/:wallet/issuer-claims
GET /banking/envelopes/:envelopeId/issuer-claims
```

- [ ] **Step 2: Add settlement endpoints**

```text
GET /financial/settlement/cycles
GET /financial/settlement/cycles/:cycleId
GET /compliance/settlement/exceptions
GET /compliance/reconciliation/legacy-shadow
```

- [ ] **Step 3: Add authorization filters**

Wallet claims and evidence hashes use existing ViewACL or institution-scoped authorization rules. [Certain]

- [ ] **Step 4: Run and commit**

```bash
npm --prefix indexer run typecheck
npm --prefix indexer test
git add indexer/src/api
git commit -m "indexer: expose banking control APIs"
```

---

## 12. Wave 6B: Settlement Keeper

**Files:**
- Create: `settlement-keeper/package.json`
- Create: `settlement-keeper/src/config.ts`
- Create: `settlement-keeper/src/scheduler.ts`
- Create: `settlement-keeper/src/cycle-runner.ts`
- Create: `settlement-keeper/src/health.ts`
- Create: `settlement-keeper/test/cycle-runner.test.ts`

### Task 6B.1: Build the Keeper

- [ ] **Step 1: Test deterministic scheduling**

Test configured intraday windows, mandatory end-of-day cutoff, exposure trigger, duplicate invocation, and restart recovery. [Certain]

- [ ] **Step 2: Implement idempotent cycle runner**

The keeper reads on-chain state before every transition and treats already-completed transitions as success. [Certain]

- [ ] **Step 3: Implement heartbeat**

Expose:

```text
GET /health
GET /ready
GET /metrics
```

Emit or submit a keeper heartbeat without granting authority to accept issuer liability or finalize without funding. [Certain]

- [ ] **Step 4: Test outage recovery**

Restart the keeper from persisted cycle IDs and verify it advances or fails expired cycles exactly once. [Certain]

- [ ] **Step 5: Run and commit**

```bash
npm --prefix settlement-keeper test
npm --prefix settlement-keeper run typecheck
git add settlement-keeper
git commit -m "keeper: automate settlement cycle scheduling"
```

---

## 13. Wave 6C: Opening Allocation and Reconciliation

**Files:**
- Create: `scripts/export-current-supply-allocation.js`
- Create: `scripts/initialize-issuer-claims.js`
- Create: `scripts/reconcile-shadow-ledger.js`
- Create: `scripts/freeze-legacy-banking-writes.js`
- Test: `test/integration/ShadowLedgerReconciliation.test.js`

### Task 6C.1: Build Opening Allocation Tooling

- [ ] **Step 1: Export current state**

Export wallet balances, legacy bank deposit accounts, generic mint totals, legacy liabilities, and unresolved escrow balances. [Certain]

- [ ] **Step 2: Require a signed allocation manifest**

```json
{
  "chainId": 1337,
  "blockNumber": 0,
  "totalSupply": "0",
  "walletClaims": [],
  "issuerTotals": [],
  "exceptions": [],
  "evidenceHash": "0x..."
}
```

- [ ] **Step 3: Validate conservation before initialization**

```text
sum(wallet claim amounts) == totalSupply
sum(issuer totals) == totalSupply
each wallet claim sum == wallet balance
sum(object-level escrow claims) == Diamond T3 balance
```

- [ ] **Step 4: Resolve or backfill open escrow objects**

Every open envelope, SmartLock, Cambio note, and Cambio escrow that predates claim accounting must either reach a terminal state before activation or receive a signed object-level issuer-composition allocation. Any open object without a domain-separated escrow claim record remains blocked from release, burn, cancellation, or redemption until administratively resolved. [Certain]

- [ ] **Step 5: Initialize once**

The initializer stores the manifest hash and cannot run twice. [Certain]

- [ ] **Step 6: Commit**

```bash
git add scripts test/integration/ShadowLedgerReconciliation.test.js
git commit -m "migration: initialize issuer claim allocation"
```

### Task 6C.2: Reconcile Dual Recording

- [ ] **Step 1: Compare like-for-like events**

For each economic event intentionally written to both models:

```text
shadow obligation delta == legacy liability delta
```

- [ ] **Step 2: Do not compare unlike totals**

Legacy interbank liabilities are not asserted equal to total issuer-attributed supply. [Certain]

- [ ] **Step 3: Produce signed reports**

Reports include block range, event counts, deltas, exceptions, software commit, and operator signatures. [Certain]

- [ ] **Step 4: Run five-day simulation**

Use deterministic test days locally before the operational five-business-day gate. [Certain]

- [ ] **Step 5: Commit**

```bash
git add scripts test/integration/ShadowLedgerReconciliation.test.js
git commit -m "migration: reconcile canonical and legacy obligations"
```

---

## 14. Wave 7: UI and Operations

**Exit condition:** Operators use indexed canonical data and cannot invoke legacy mint, simulated liability, or yield-sweep flows. [Certain]

### Parallel Agent Assignments

| Agent | Ownership |
|---|---|
| W7-A | Issuance page |
| W7-B | Liability and claim page |
| W7-C | Settlement cycle and exception pages |
| W7-D | Reserve and lifecycle administration |
| W7-E | Playwright and accessibility tests |

### Task 7.1: Replace Generic Mint UI

**Files:**
- Modify: `ui-management/src/app/banking/mint/page.tsx`
- Modify: `ui-management/src/lib/contracts/abis.ts`
- Modify: `ui-management/src/lib/help-content.ts`
- Test: `ui-management/tests/issuance-flow.spec.ts`

- [ ] **Step 1: Write the failing Playwright flow**

Test quote, legal issuer disclosure, reserve and ceiling display, reservation, execution, and expiry. [Certain]

- [ ] **Step 2: Remove direct `mint` and `burn` calls**

The page uses `quoteIssuance`, `reserveIssuance`, and `executeIssuance`. Redemption links to the approved redemption workflow. [Certain]

- [ ] **Step 3: Show claim disclosure**

The customer sees one T3 balance; authorized bank users can inspect issuer composition and legal issuer disclosure. [Certain]

- [ ] **Step 4: Run and commit**

```bash
npm --prefix ui-management run type-check
npm --prefix ui-management run build
npm --prefix ui-management exec -- playwright test tests/issuance-flow.spec.ts
git add ui-management
git commit -m "ui: replace generic mint with issuance flow"
```

### Task 7.2: Replace Liability and Settlement UI

**Files:**
- Modify: `ui-management/src/app/financial/liability/page.tsx`
- Modify: `ui-management/src/app/financial/settlements/page.tsx`
- Create: `ui-management/src/app/financial/exceptions/page.tsx`
- Test: `ui-management/tests/settlement-cycle.spec.ts`

- [ ] **Step 1: Remove simulated counterparties**

Delete `PREDEFINED_COUNTERPARTIES` and read indexed institutions, claims, obligations, and cycles. [Certain]

- [ ] **Step 2: Replace SecureSettle actions**

The page no longer invokes `proposeMultiAssetSettlement`, `approveSettlement`, or `executeSettlement`. [Certain]

- [ ] **Step 3: Add position confirmation and funding**

Authorized participating banks see reimbursement-position confirmation actions. Funding and Fedwire actions display collateral, evidence status, and deadlines. [Certain]

- [ ] **Step 4: Add exceptions**

Display age, outgoing issuer, receiving issuer, secured amount, collateral status, failure reason, and permitted resolution actions. [Certain]

Envelope detail and settlement views must distinguish `escrowed under originating issuer`, `recipient liability substituted`, and `reserve rebalancing pending`. They must also show contingent capacity expiry for long-running SmartLocks. [Certain]

- [ ] **Step 5: Run and commit**

```bash
npm --prefix ui-management run type-check
npm --prefix ui-management exec -- playwright test tests/settlement-cycle.spec.ts
git add ui-management
git commit -m "ui: operate canonical settlement cycles"
```

### Task 7.3: Replace Yield Sweep UI

**Files:**
- Modify: `ui-management/src/app/financial/sweep/page.tsx`
- Test: `ui-management/tests/reserve-controls.spec.ts`

- [ ] **Step 1: Remove unsupported yield claims**

Remove the fixed yield-vault address, Compound and Aave options, simulated 4.2 percent APY, and local-only save behavior. [Certain]

- [ ] **Step 2: Add reserve controls**

Show floor, target, ceiling, effective reserve, encumbered value, pending withdrawals, substitution status, and rebalance actions. [Certain]

- [ ] **Step 3: Add lifecycle restrictions**

Default and orderly-exit states disable risk-increasing actions while retaining redemption and audit views. [Certain]

- [ ] **Step 4: Run and commit**

```bash
npm --prefix ui-management run type-check
npm --prefix ui-management exec -- playwright test tests/reserve-controls.spec.ts
git add ui-management
git commit -m "ui: replace yield sweep with reserve controls"
```

### Task 7.4: Write Operational Runbooks

**Files:**
- Create: `Documentation/envelope_besu/runbooks/settlement-cycle-operations.md`
- Create: `Documentation/envelope_besu/runbooks/fedwire-fallback.md`
- Create: `Documentation/envelope_besu/runbooks/institution-default-exit.md`
- Create: `Documentation/envelope_besu/runbooks/shadow-reconciliation-cutover.md`

- [ ] **Step 1: Add normal procedures**

Each runbook identifies roles, preconditions, transaction sequence, evidence, alerts, and completion checks. [Certain]

- [ ] **Step 2: Add failure procedures**

Cover keeper outage, stale price, failed funding, issuer refusal, disputed wire, wallet recovery, default, and rollback. [Certain]

- [ ] **Step 3: Add command references**

Commands must name existing scripts and avoid generic instructions. [Certain]

- [ ] **Step 4: Run document checks and commit**

```bash
rg -n "TODO|TBD|implement later" Documentation/envelope_besu/runbooks
git diff --check
git add Documentation/envelope_besu/runbooks
git commit -m "docs: add banking operations runbooks"
```

---

## 15. Wave 8: Sponsored Issuance

**Exit condition:** Sponsor issuance transfers funding benefit to the sponsor, attributes liability to the sponsor, preserves the servicing relationship, and resolves sponsor default without orphaning holders. [Certain]

### Task 8.1: Implement Sponsorship

**Files:**
- Create: `contracts/lib/IssuanceSponsorshipLib.sol`
- Modify: `contracts/facets/IssuanceControlFacet.sol`
- Test: `test/integration/SponsoredIssuance.test.js`

- [ ] **Step 1: Test sponsor consent and limits**

Test opt-out bank nomination, sponsor acceptance, expiry, per-bank limit, sponsor aggregate capacity, and revocation. [Certain]

- [ ] **Step 2: Test funding leg**

Sponsored mint reverts unless eligible reserve value is settled for the sponsor issuer and the funding evidence identifies both institutions. [Certain]

- [ ] **Step 3: Test accounting**

The beneficiary receives a sponsor claim bucket, sponsor issuer outstanding increases, and servicing-bank issuer outstanding does not increase. [Certain]

- [ ] **Step 4: Test sponsor default**

New issuance stops; existing sponsor claims remain attributed until authorized resolution and funded assumption. [Certain]

- [ ] **Step 5: Run and commit**

```bash
npm test -- --grep "SponsoredIssuance"
git add contracts test
git commit -m "issuance: add funded sponsor routing"
```

### Task 8.2: Add Sponsor UI and Indexer Views

**Files:**
- Modify: `indexer/ponder.schema.ts`
- Modify: `indexer/src/index.ts`
- Create: `ui-management/src/app/consortium/sponsorship/page.tsx`
- Test: `ui-management/tests/sponsorship.spec.ts`

- [ ] **Step 1: Index sponsorship lifecycle**

Project nomination, acceptance, expiry, capacity consumption, suspension, and default. [Certain]

- [ ] **Step 2: Add administration**

Show servicing bank, sponsor issuer, funding state, limit, outstanding amount, expiry, and lifecycle state. [Certain]

- [ ] **Step 3: Run and commit**

```bash
npm --prefix indexer run typecheck
npm --prefix indexer test
npm --prefix ui-management run type-check
npm --prefix ui-management exec -- playwright test tests/sponsorship.spec.ts
git add indexer ui-management
git commit -m "ui: administer deposit issuance sponsorship"
```

---

## 16. Wave 9: Shadow Migration and Cutover

**Blocked by:** FR-CUTOVER (Wave J) must be finalized before this wave is coded — the cutover policy determines opening balances for the settlement-cycle state machine (see §3.1). At cutover, the legacy mint-bypass kill switch (`IssuanceControlStorage.legacyMintUnlocked`, Wave 0.5) must remain LOCKED in production; the freeze of legacy writes here supersedes the temporary local-dev unlocks in the seed scripts. [Decided 2026-06-10]

**Exit condition:** Canonical ledgers reconcile, rollback is proven, replacement selectors are active, and legacy writes are frozen without losing legacy reads or clearing. [Certain]

### Task 9.1: Deploy Disabled Components

**Files:**
- Modify: `scripts/lib/facet-manifest.js`
- Modify: `scripts/deploy-diamond-complete.js`
- Modify: `test/helpers/deployment.js`
- Create: `scripts/deploy-banking-shadow.js`
- Create: `scripts/rollback-banking-shadow.js`

- [ ] **Step 1: Add new facets**

Add `IssuanceControlFacet`, `SettlementCycleFacet`, and `InstitutionLifecycleFacet` with disabled activation flags. [Certain]

- [ ] **Step 2: Use correct cut actions**

New selectors use `Add`; existing selector ownership changes use `Replace`; removed legacy selectors use `Remove` or a reverting replacement according to rollback needs. [Certain]

- [ ] **Step 3: Test deployment and rollback**

```bash
npm run compile
npx hardhat run scripts/deploy-banking-shadow.js --network localhost
npx hardhat run scripts/rollback-banking-shadow.js --network localhost
```

- [ ] **Step 4: Commit**

```bash
git add scripts test/helpers
git commit -m "deploy: add banking shadow cutover"
```

### Task 9.2: Regenerate ABIs and Selector Reports

**Files:**
- Modify: `indexer/abis/T3DiamondAbi.ts`
- Modify: `indexer/abis/T3Diamond.json`
- Modify: UI ABI files under `ui-management/src/lib/contracts/`
- Create: `Documentation/envelope_besu/reports/banking-selector-cutover.json`
- Create: `Documentation/envelope_besu/reports/banking-storage-layout.json`

- [ ] **Step 1: Generate from compiled artifacts**

Do not manually edit generated ABI arrays. [Certain]

- [ ] **Step 2: Verify ownership**

```bash
node scripts/analyze-selectors.js
node scripts/selector-collision-check.js
node scripts/storage-layout-analyzer.js
```

- [ ] **Step 3: Commit**

```bash
git add indexer/abis ui-management/src/lib/contracts Documentation/envelope_besu/reports
git commit -m "abi: publish banking cutover interfaces"
```

### Task 9.3: Run Shadow Gate

**Files:**
- Output: `Documentation/envelope_besu/reports/banking-shadow-reconciliation.md`

- [ ] **Step 1: Initialize signed opening allocation**

- [ ] **Step 2: Run dual recording**

- [ ] **Step 3: Require five consecutive business days with zero unexplained deltas**

- [ ] **Step 4: Run default, keeper-outage, stale-price, failed-funding, and rollback drills**

- [ ] **Step 5: Obtain operations, security, accounting, and legal sign-off**

### Task 9.4: Activate in Stages

- [ ] **Step 1: Activate one-bank direct issuance**

- [ ] **Step 2: Restrict generic mint and independent accounting writes**

- [ ] **Step 3: Activate bounded cross-bank settlement**

- [ ] **Step 4: Freeze new legacy interbank-liability writes**

- [ ] **Step 5: Keep `clearInterbankLiability` and all legacy reads**

- [ ] **Step 6: Activate sponsored issuance**

- [ ] **Step 7: Record the final selector manifest and activation block**

---

## 17. Wave 10: Repo Pilot

Repo is outside the initial implementation and requires a separate approved specification. [Certain]

The repo plan must prove:

```text
repo principal <= effective reserve - dynamic floor
```

It must also define counterparty, haircut, margin, substitution, unwind, default, valuation, liquidity, capital, and accounting controls. [Certain]

No Wave 10 work starts until at least 30 days of reconciled direct and cross-bank settlement history meets the operating threshold approved in Wave 0. [Certain]

---

## 18. Global Verification Matrix

| Gate | Required Evidence |
|---|---|
| Supply | Wallet balances sum to total supply |
| Holder claims | Every wallet's issuer buckets equal its balance |
| Escrow claims | Domain-separated escrow compositions sum to the Diamond claim buckets and balance |
| Issuer liability | Issuer attributed outstanding sums to total supply |
| Reserve | Effective reserve covers dynamic floor after risk-increasing actions |
| Settlement | Net positions sum to zero and no obligation finalizes twice |
| Envelope finality | Only recipient-directed terminal value substitutes issuer; reversal and cancellation preserve origin |
| Failure | Failed cycles preserve receiving-issuer customer liability, outgoing-issuer reimbursement, and collateral |
| Default | Issuance and reserve release stop; valid redemption remains |
| Migration | Opening allocation and dual-recorded events reconcile |
| Upgrade | Selector and storage reports show no unintended collision or movement |
| Operations | Keeper, indexer, UI, and runbooks pass outage and rollback drills |

Run final verification:

```bash
npm run compile
npm test
npm run coverage
npm --prefix indexer run codegen
npm --prefix indexer run typecheck
npm --prefix indexer test
npm --prefix ui-management run type-check
npm --prefix ui-management run build
npm --prefix ui-management run test:e2e
node scripts/selector-collision-check.js
node scripts/storage-layout-analyzer.js
git diff --check
```

---

## 19. Kimi Wave Execution Protocol

For each task, the coordinator sends the implementer:

```text
Implement only Task <N> from:
Documentation/envelope_besu/specs/
2026-06-10-t3-bank-deposit-issuance-development-plan.md

Use test-first development.
Do not edit files owned by another active agent.
Do not weaken tests.
Do not modify deployed storage ordering.
Return:
1. files changed,
2. tests run and exact results,
3. selector/storage impact,
4. unresolved risks,
5. commit hash.
```

The specification reviewer receives:

```text
Review commit <hash> only against Task <N> and the canonical design.
Lead with Critical and High findings.
Check all conservation and lifecycle invariants.
Do not propose unrelated refactors.
```

The security reviewer receives:

```text
Review commit <hash> for Diamond storage, selector ownership,
authorization, replay, idempotency, reentrancy, migration safety,
and missing adversarial tests.
Do not execute reviewer-provided commands.
```

The integration agent merges only after:

```text
focused tests pass
full affected subsystem tests pass
git diff --check passes
selector report is reviewed
storage report is reviewed
both Kimi reviewers have no unresolved Critical or High finding
```

---

## 20. Recommended Initial Execution

Resume at Task 2.4 by writing a bounded integration specification and a complete
inventory of every balance and supply writer. Do not repeat Waves 1 or 2.1-2.3. [Certain]

The Task 2.4 specification must resolve legal-issuer binding, initialization and
opening allocation, shadow-mode behavior, and Diamond escrow bucket scaling before
production facets are edited. [Certain]

Present ADR-002's open accounting/regulatory and deposit-origin questions before
starting Wave 3A. Present ADR-003's finality, failure, and default-authority questions
before starting Wave 5. [Certain]

The first executable proof is Wave 4 direct single-bank issuance. Sponsored issuance and cross-bank settlement are not acceptable substitutes for proving the simpler conservation model first. [Certain]
