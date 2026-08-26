# T3 Programmable Fiat Framework

> Envelope-mode tokenized deposit infrastructure for regulated banking consortiums on Hyperledger Besu

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-blue.svg)](https://soliditylang.org)
[![Hardhat](https://img.shields.io/badge/Built%20with-Hardhat-yellow.svg)](https://hardhat.org)
[![Status: Technical Preview](https://img.shields.io/badge/status-technical%20preview-blue.svg)](REGULATORY-STATUS.md)

> **Technical preview — additional legal and compliance vetting required before production use.**
> Tokenized deposits sit at the intersection of banking regulation, payments law, and securities
> analysis, and any production deployment will need its own legal and compliance review in the
> relevant jurisdictions. This repository is a reference implementation: it does **not** create a
> bank deposit, an insured deposit, or any payment/settlement obligation, and makes no
> representation of FDIC insurance or settlement finality. Nothing here is legal, regulatory,
> financial, or accounting advice. Running it locally operates against a throwaway development
> blockchain and creates no real-world relationship; both banking feature gates ship **OFF** by
> default. See [REGULATORY-STATUS.md](REGULATORY-STATUS.md),
> [KNOWN-ISSUES.md](KNOWN-ISSUES.md), and [SECURITY.md](SECURITY.md).

---

## Overview

T3 is a smart contract system for bank-to-bank tokenized deposits on a permissioned Hyperledger Besu network. It implements the Diamond proxy pattern (EIP-2535) to provide a modular, upgradeable token system with built-in compliance controls, escrow-based settlement, and consortium governance.

**Current state:** 41 facets registered in the manifest, deployed through a single diamond proxy. 1,545 passing tests and 20 pending tests. Envelope-mode settlement, per-bank claim attribution, attributed issuance capacity (Wave 4), and the bilateral-net interbank settlement cycle (Wave 5) are all implemented and wired into the diamond behind admin activation gates (`capacityModelActive` / `settlementModelActive`). **Nothing is production-activated.** The open legal and compliance questions are catalogued in
[COUNSEL-GATES.md](Documentation/envelope_besu/COUNSEL-GATES.md) — this release publishes them
openly rather than holding the code back until they are all settled, so that reviewers can see
exactly which questions a deployment would need to answer. Next: indexer/compliance API on Besu, settlement keeper + reconciliation, and ops UI (Waves 6–7).

---

## Architecture

### Why Besu and the Envelope Model

T3 was originally built for the public Avalanche C-Chain, where every transaction and storage slot is visible to anyone. That environment required expensive cryptographic privacy features — masked balances, commitment-only events, calldata blinding — that added gas cost and interface friction.

T3 now runs on a **permissioned Hyperledger Besu consortium** operated by member banks. The threat model is different:

| Threat | Public Avalanche | Permissioned Besu |
|--------|-----------------|-------------------|
| Mempool visibility | Anyone can observe pending transactions | Only consortium nodes |
| Block explorer | Anonymous, unrestricted | Authenticated, API-gated |
| Validator trust | Economically incentivized strangers | T3-operated, contractually bound |
| Storage reads | `eth_getStorageAt` open to anyone | Authenticated consortium members only |

With those threats removed, the cryptographic privacy layers were dropped. The **envelope model** — escrow semantics, state machines, expiration behaviors — carries forward and is now the sole settlement primitive.

### Envelope Settlement Model

Every programmable transfer is an escrow container with a configurable lifecycle:

1. **Create** — Sender locks tokens in the diamond contract
2. **Finalize** — Recipient receives tokens from the diamond's escrow
3. **Reverse** — Sender recovers unclaimed tokens (partial reversal supported)
4. **Dispute** — Arbiter-mediated resolution with configurable split

Each envelope independently selects a **settlement type** and an **expiration behavior** as two separate axes at creation time.

**SettlementType** (how tokens move at finalization):

| Value | What Happens |
|-------|-------------|
| `CRYPTO_DIRECT` (0) | Tokens transfer on-chain: escrow → recipient |
| `FIAT_INSTITUTIONAL` (1) | Tokens burn from recipient; off-chain fiat settlement triggered |

**ExpirationBehavior** (what happens when `commitWindowEnd` is reached):

| Behavior | What Happens at Boundary | Use Case |
|----------|-------------------------|----------|
| `IMMEDIATE_FINALIZE` (0) | Auto-finalizes at `commitWindowEnd` | Standard transfers with review window |
| `HALFLIFE_DECAY` (1) | Reversibility decays over time | Consumer cooling-off period |
| `HOLD_UNTIL_MANUAL` (2) | Waits for authorized release | SmartLock, multi-party sign-off |
| `ORACLE_CONDITIONAL` (3) | Oracle callback decides outcome | Conditional payments |
| `AUTO_REVERSE` (4) | Auto-reverses if not finalized by deadline | Time-bounded reversible transfers |
| `DISPUTE_HOLD` (5) | Frozen during active dispute; resolution determines outcome | Disputed envelopes |

### Diamond Facet Layout

The diamond's facets (41 in the manifest; `DiamondCutFacet` is registered by the constructor separately, the other 40 via `diamondCut`):

**Infrastructure**
- `DiamondLoupeFacet` — facet introspection
- `ERC165Facet` — interface detection
- `AccessControlFacet` — role-based access control
- `ERC2771ContextFacet` — ERC-2771 meta-transaction context

**ERC-20 Core**
- `ERC20BaseFacet` — balanceOf, allowance, approve
- `ERC20PausableFacet` — pause/unpause

**T3 Token**
- `T3TokenAdminFacet` — admin configuration
- `T3TokenDirectTransferFacet` — transfer/transferFrom with envelope routing
- `T3TokenMintBurnFacet` — mint/burn with consortium collateral check
- `IssuanceControlFacet` — issuance gating (legacyMintUnlocked toggle)
- `T3TokenFeeLogicFacet` — fee tier calculation
- `T3TokenCommonLogicFacet` — shared token utilities

**Custodian / Institution Registries**
- `CustodianRegistryFacet` — custodian wallet registration
- `InstitutionRegistryFacet` — institution registry
- `InstitutionPolicyFacet` — per-institution policy configuration
- `InstitutionLifecycleFacet` — institution state machine
- `DepositorIdentityFacet` — FDIC 12 CFR 370 pass-through TIN-hash registry (recording-only; not wired into enforcement; shared-salt correlation is counsel gate G9)

**Consortium Core**
- `ConsortiumMembershipFacet` — member bank enrollment
- `MultiAssetVaultFacet` — collateral pledging and 1:1 reserve check
- `BankDepositTokenFacet` — bank deposit token issuance primitives
- `ConsortiumEmergencyFacet` — consortium-wide emergency controls
- `ConsortiumComplianceFacet` — compliance coordination
- `SettlementCycleFacet` — bilateral-net settlement cycle management
- `SponsorBankCoreFacet` — sponsor bank registry (retained as a Cambio storage consumer; sponsor-bank model is post-MVP)

**Rules / Compliance**
- `AutomatedResponseFacet` — automated threat response
- `RulesConfigFacet` — compliance rule configuration
- `RulesEngineFacet` — rule evaluation engine
- `ComplianceConfigFacet` — scope arming/getters (`activeScopeCount`); legacy KYC/screening/travel-rule/CIP bool toggles retired (setters revert `Deprecated()`)
- `ComplianceGateFacet` — context-typed forward-entrypoint pre-check (no-op when `activeScopeCount == 0`)
- `ComplianceScreeningFacet` — sanctions screening attestations (scoped + network tiers) and per-institution sanctions enablement
- `ComplianceTravelRuleFacet` — Travel Rule origination binding

**Cambio**
- `CambioIssuerFacet` — issuer registration and pause-state gate
- `CambioEnvelopeFacet` — envelope-mode note create/commit/redeem
- `CambioAdminFacet` — cambio system administration

**Envelope System**
- `TransferEnvelopeFacet` — envelope create/finalize/reverse/dispute
- `TransferEnvelopeAdminFacet` — envelope admin surface (split out to keep `TransferEnvelopeFacet` under the EIP-170 24 KiB limit)
- `EnvelopeInheritanceFacet` — parent-child envelope relationships (depth limit: 1)
- `WalletRecoveryFacet` — wallet recovery state machine
- `SmartLockEnvelopeFacet` — multi-condition hold envelopes
- `RelayerFallbackFacet` — 4-hour relayer self-declaration fallback

Deferred product-line facets (yield, rewards, investment, oracle, coordination) and superseded legacy facets are tracked outside the active diamond and are not part of this MVP surface.

---

## Project Structure

```
T3-Programmable_Fiat_Framework/
├── contracts/
│   ├── facets/             # Active facet source files
│   ├── lib/                # Shared libraries (*Lib.sol, *Storage.sol)
│   ├── interfaces/         # Contract interfaces (I*.sol)
│   ├── base/               # Abstract base contracts
│   ├── mocks/              # Test doubles
│   └── test/               # Solidity test harnesses
├── test/
│   ├── unit/               # Per-facet unit tests
│   ├── integration/        # Cross-facet interaction tests
│   ├── security/           # Attack vector tests
│   ├── e2e/                # End-to-end workflow tests
│   ├── upgrade/            # Upgrade-path tests
│   └── helpers/            # deployment.js, roles.js, assertions.js
├── scripts/
│   ├── lib/facet-manifest.js           # Single source of truth for active facets
│   ├── deploy-diamond-complete.js      # Canonical deployment script
│   ├── selector-collision-check.js     # Selector collision gate
│   ├── check-manifest-abi-parity.js    # ABI parity gate
│   └── regenerate-indexer-abi.js       # Manifest-driven ABI regeneration
├── indexer/                # Ponder event indexer + compliance REST API
├── relayer/                # ERC-2771 meta-transaction relayer (server.js, Dockerfile)
├── keeper/                 # Settlement keeper and monitoring workers
├── docker/                 # Local Besu QBFT devnet
├── Documentation/          # Architecture specs and design documents
└── archive/                # Deprecated trail retained for historical context
```

---

## Quick Start

### Prerequisites

- Node.js 22+ and npm 9+
- Hardhat development environment

### Setup

```bash
npm install
npm run compile
npm test
```

Expected: 1,545 passing, 0 failing, and 20 pending (pending items are documented stubs for Wave 6–7 surfaces).

### Deployment (local Hardhat network)

```bash
npx hardhat run scripts/deploy-diamond-complete.js --network hardhat
```

### Manifest and ABI tooling

```bash
# Check for function selector collisions across all manifest facets
node scripts/selector-collision-check.js

# Verify indexer ABI matches manifest exactly
node scripts/check-manifest-abi-parity.js

# Regenerate indexer ABI from manifest
node scripts/regenerate-indexer-abi.js
```

### Running the full stack locally

Each service has its **own** `package.json` and is installed/run separately. The
whole stack runs against a **local** chain — no testnet, no real keys, no
external accounts. Both banking feature gates ship **OFF**, so this is a safe
self-contained sandbox (see [REGULATORY-STATUS.md](REGULATORY-STATUS.md)).

```bash
# 1. Contracts: install, compile, test, and deploy to a local Hardhat node
npm install
npm run compile
npx hardhat node            # terminal 1: local chain at http://127.0.0.1:8545
npx hardhat run scripts/deploy-diamond-complete.js --network localhost  # terminal 2
# -> note the printed diamond + forwarder addresses

# 2. Indexer (Ponder) — terminal 3
cp indexer/.env.example indexer/.env.local   # set PONDER_DIAMOND_ADDRESS
cd indexer && npm install && npm run dev      # serves at http://localhost:42070

# 3. Relayer — terminal 4
cp relayer/.env.example relayer/.env        # set FORWARDER_ADDRESS and ALLOWED_TO
cd relayer && npm install && npm start      # exposes GET /health and POST /relay
```

> A local Besu devnet (instead of the Hardhat node) is available under `docker/`;
> point `BESU_LOCAL_RPC_URL` / the `besu-local` Hardhat network at it and deploy
> with `--network besu-local`.

`scripts/deploy-diamond-complete.js` rewrites local config in place. It updates
root `.env` with the new diamond address, and if `relayer/.env` contains the
previous `DIAMOND_ADDRESS`, it rewrites `relayer/.env` to the new address.

The former `gateway/`, `mcp-server/`, and `ui-management/` services are not part
of this public v1 release. They remain private backlog candidates for a
fast-follow release after separate readiness work.

> Root `npm install` uses `.npmrc` (`legacy-peer-deps=true`) to work around a
> hardhat / hardhat-ignition peer-dependency mismatch — a plain `npm install` works.

---

## Key Design Decisions

**Diamond storage isolation** — every storage library uses an isolated slot via `keccak256("t3.storage.<module>.v1")`. No two facets share a storage slot. This is enforced by convention; the deployment fixture includes a collision check.

**Factor-based collateral check** — `T3TokenMintBurnFacet.mintForConsortiumBank` reads each asset's `collateralFactorBps` from `ConsortiumStorage.AssetTypeConfig` and requires the factor-adjusted deposits to cover outstanding + amount. The default factor is 100% (10000 bps), so out-of-the-box behavior is strict 1:1; per-bank fractional factors are configurable via `MultiAssetVaultFacet.setBankCollateralFactor`.

**Claim attribution is wired** — every consortium mint routes through `IssuanceAccountingLib.mintAttributed` (writing a per-issuer claim bucket), and envelope finalization routes through `ClaimAttributionLib.finalizeEnvelopeClaims` + `IssuanceAccountingLib.substituteLiability` for cross-institution settlement. The subledger is activated by `IssuanceControlFacet.initializeClaimAttribution` (which requires zero supply at init).

**Attributed issuance capacity (Wave 4) and bilateral-net settlement (Wave 5) are implemented.** Issuance flows through quote → reserve → execute bounded by each bank's factor-adjusted reserves and daily caps (`capacityModelActive` gate). Cross-bank transfers record interbank obligations into a settlement cycle that nets **per counterparty pair** and encumbers a **bilateral-net** reimbursement lien on the outgoing bank (`settlementModelActive` gate); cycles fund (off-chain payment, replay-protected attestation) and finalize (releasing liens) or fail (preserving them). Multilateral-net CCP is the documented scale endgame (future ADR + counsel), not this build. See ADR-003.

**ERC-2771 context** — `ERC2771ContextFacet` enables gasless meta-transactions. The relayer in `relayer/` submits signed requests on behalf of users. `RelayerFallbackFacet` provides a 4-hour self-declaration fallback when the primary relayer is unavailable.

**SmartLock fragment commitments and post-quantum posture** — `SmartLockEnvelopeFacet` releases
escrow against a hash commitment rather than a signature. At creation the sender stores
`hashCommitment = keccak256(fragment || nonce)`; release requires revealing a preimage that
re-derives it. The full secret is never committed on-chain — only a per-transfer fragment and
nonce — so recovering a lock means finding a preimage, not breaking a signature.

That distinction matters for quantum exposure. Shor's algorithm breaks ECDSA outright, which is
what a signature-gated lock would depend on. Grover's algorithm gives only a quadratic speedup
against preimage search, and against a 256-bit commitment that leaves a ~2^128 effective margin —
already impractical, and further constrained here because a lock's `commitWindowEnd` bounds the
attack to the lifetime of that single transfer rather than a long-lived key.

**This is a design posture, not a post-quantum implementation.** T3 uses no lattice-, hash-, or
code-based PQC signature scheme, and the surrounding system still relies on ECDSA for
transaction authorisation and ERC-2771 meta-transactions — so an adversary with a
cryptographically relevant quantum computer would attack those, not the SmartLock commitment.
The claim is narrow and deliberate: the *lock-release path* does not add ECDSA exposure. A
predecessor facet (`archive/legacy-facets/LockedTransferManagerFacet.sol`) carried explicit
quantum-threat-level plumbing; that machinery was not carried forward into the envelope model,
and the commitment scheme is what survived.

**Envelope inheritance** — `EnvelopeInheritanceFacet` allows a parent envelope sender to create a sub-envelope (child) against the same escrow. Max depth is 1 — no grandchildren. Child's `commitWindowEnd` must not exceed the parent's.

---

## What's Next (Planned Waves)

| Wave | Description | Status |
|------|-------------|--------|
| G.0.c | Factor-based collateral check on `mintForConsortiumBank` | Done |
| G.0.a | Wire `mintAttributed` into `mintForConsortiumBank` | Done |
| G.0.b | Wire `finalizeEnvelopeClaims` + `substituteLiability` into envelope finalize | Done |
| 4 | Single-bank attributed issuance: capacity quoting, reserve/execute | Done |
| 5 | Settlement cycle: **bilateral-net** liens, funding (replay-protected), finalize/fail | Done |
| 6A | Indexer banking API + compliance endpoint re-pointed to Besu | Planned |
| 6B | Settlement keeper (cycle rollover + funding) — correctness dependency for live cycles | Planned |
| 6C | Reconciliation scripts (net-vs-encumbered invariant as a monitored job) | Planned |
| 7 | Ops UI pages (quote/reserve/execute) + runbooks | Planned |

Before `settlementModelActive` is flipped on: S4 collateral-release role guards (reimbursement path) and the ADR-003 counsel gate. Before real deposits: AML/sanctions screening on redemption, BSA/CIP + Travel Rule identity layer, and FDIC 12 CFR 370 depositor-record path (see the roadmap recommendations recorded in the plan).

Out of scope: yield-bearing T3, dynamic call-report ingestion, public issuance capacity market, autonomous keeper.

---

## Testing

```bash
# Full suite
npm test

# Unit tests only
npx hardhat test test/unit/

# Integration tests
npx hardhat test test/integration/

# Security tests
npx hardhat test test/security/
```

Coverage: `npm run coverage`

Indexer tests: `cd indexer && npm test`

---

## Security Notes

- `RulesEngineFacet.postTransferUpdate` is restricted to the canonical transfer surface (direct transfers and envelope facets). Permissionless metric inflation is blocked.
- `AutomatedResponseFacet.deactivateCoordinatedEmergencyMode` requires explicit role authorization. The level-9 self-activation path was fixed to use an internal library call (no `this.` self-call).
- `CustodianRegistryFacet.registerCustodiedWallet` rejects duplicate custody assignment without an explicit authorized transfer workflow.
- `WalletRecoveryFacet` (FR-1402) uses the 4-arg `EscrowLib.releaseEscrow` overload that includes issuer domain. All five recovery paths route through this overload; 2-arg calls would bypass claim attribution.
- Emergency controls are tested fail-closed: `ConsortiumEmergencyFacet` and `AutomatedResponseFacet` tests revert if setup fails rather than logging and continuing.

---

## Releases and repository model

This repository is a **published snapshot**, not the development repository. Each release is
a single commit containing the full tree at that version, rather than the upstream commit
history.

That is deliberate. Development happens in a private repository whose history contains
material that cannot be published — decommissioned testnet keys, infrastructure credentials,
and confidential commercial documents. Rather than attempt to rewrite that history and hope
nothing was missed, releases are produced by copying an explicitly allowlisted set of files
into a fresh tree with no git history at all. Nothing unpublished exists in this repository
to be recovered, because it was never copied here.

The practical consequences for you as a reader:

- `git blame` and `git log` will not show authorship of individual changes.
- Issues and pull requests are welcome at
  [github.com/jessedh/t3/issues](https://github.com/jessedh/t3/issues); accepted changes are
  applied upstream and appear in the next release snapshot rather than as direct commits.
- Each release is tagged. To see what changed between versions, diff the tags or read
  [CHANGELOG.md](CHANGELOG.md).

## License

Apache-2.0. See [LICENSE](LICENSE) for details.
