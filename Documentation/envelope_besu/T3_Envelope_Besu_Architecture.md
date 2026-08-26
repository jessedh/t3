# T3 Envelope Architecture — Besu Consortium Design

**Date:** 2026-03-24
**Status:** Active source-of-truth design for the `feature/envelope-besu` branch
**Supersedes:** `T3_Envelope_Privacy_Unified_Design_v1.md` (archived on `archive/envelope-refactor-avalanche` tag)

---

## 1. Why This Branch Exists

### 1.1 The Original Design

T3USD was originally designed for deployment on the public Avalanche C-Chain. On a public EVM chain, transaction calldata, event logs, and storage slots are visible to anyone with a block explorer or an RPC endpoint. The envelope system was designed with multiple cryptographic privacy layers to protect sensitive financial data in this hostile environment:

- **Masked balances** (ADR-001) — KYC-gated public balance obfuscation to prevent casual balance lookups.
- **Commitment-only events** (FR-1302 / ADR-002) — Events emitted `amountCommitment` hashes instead of plaintext amounts, with plaintext delivered via a separate off-chain compliance delivery service.
- **Calldata blinding** (FR-1101) — XOR-based obfuscation of transaction calldata to prevent amount exposure in the public mempool.
- **Salt epochs** (FR-1103) — Rotating cryptographic salts for identity rotation, supporting quantum-resistance semantics and key migration.
- **Three-tier privacy model** (ADR-003) — Relayer-submitted (full privacy), direct-with-blinding (partial), direct-without-blinding (break-glass).

These layers added significant gas overhead, implementation complexity, and interface burden. Every event needed a commitment computation. Every function signature carried both an executable amount and a separate `amountCommitment`. The `creationEpoch` field in every envelope tracked which salt epoch was active for key infrastructure.

### 1.2 The Strategic Pivot

T3USD is migrating to a **permissioned Hyperledger Besu consortium network** operated entirely by T3. This changes the threat model fundamentally:

| Threat | Public Avalanche | Permissioned Besu |
|--------|-----------------|-------------------|
| **Mempool visibility** | Anyone can monitor pending transactions | Only consortium nodes see pending transactions |
| **Block explorer access** | Anonymous, unrestricted | Authenticated, API-gated by T3 |
| **Validator trust** | Untrusted, economically incentivized | T3-operated, contractually bound |
| **Storage reads** | `eth_getStorageAt` available to anyone | Available only to authenticated consortium members |
| **Event indexing** | Public indexers (Snowtrace, The Graph) | T3-operated Ponder indexer with permission gating |

With no public mempool, no anonymous block explorer, and no untrusted validators, the cryptographic privacy layers designed for Avalanche become unnecessary complexity with real costs: gas overhead, implementation burden, and interface friction.

### 1.3 Why a Fresh Branch

The previous `codex/envelope-refactor` branch accumulated 49 documentation files over its development lifecycle:

- **5 migration plan revisions** documenting the incremental pivot from Avalanche to Besu
- **4 architectural challenge documents** reviewing each revision
- **Dozens of CANCELED or SUPERSEDED Feature Requests** written for the Avalanche privacy model
- **A frozen interface** (`ITransferEnvelope.sol`) with an explicit `PRIVACY CONSTRAINT` block mandating commitment-only events

Rather than carrying this planning archaeology forward — incrementally "unfreezing" decisions, rewriting "SUPERSEDED" labels on old FRs, and explaining which parts of 1,675-line design docs still apply — we start from `main` with:

- The Solidity code adapted for Besu (privacy-specific fields removed, events simplified to plaintext)
- Documentation written natively for the new architecture
- A clean FR inventory that reflects what actually needs to be built

The old branch is preserved at the `archive/envelope-refactor-avalanche` tag for historical reference.

### 1.4 What Was Preserved

The core Solidity implementation (~1,575 lines of code across 7 files) is being transferred from the old branch and adapted. This is a **build-and-migrate process**, not a completed migration:

- **Removed**: `amountCommitment` (bytes32) and `creationEpoch` (uint40) from the `EnvelopeData` struct
- **Simplified**: Events emit plaintext `uint256 amount` instead of `bytes32 amountCommitment`
- **Updated**: All NatSpec comments reference ADR-004 instead of ADR-001/ADR-002
- **Unchanged**: The escrow model, state machine, 6 expiration behaviors, dispute surface, oracle integration, and settlement pathing

**Current status (2026-06-15): COMPLETE.** All envelope contracts are compiled, wired into deployment, and integration-tested. The legacy transfer stack has been archived (never deployed to production). The active diamond surface has since grown beyond the envelope core to span token, banking/consortium, and rules/compliance facets — **41 facets** per `scripts/lib/facet-manifest.js`. The bank-deposit-issuance MVP (Waves 4–5: attributed issuance capacity + bilateral-net settlement cycle) and the Wave 8 compliance-attestation series are implemented behind admin activation gates that default OFF.

The architectural investment in the envelope *model* — which is substantial — carries forward unchanged. Only the *privacy layer around it* is removed.

---

## 2. The Besu Consortium Model

### 2.1 T3-Hosted Shared Ledger (BaaS)

The network operates as a **single shared ledger** managed entirely by T3. There are no private partitioned states, no separate bank subnets, and no per-institution chains. Every consortium transaction exists on one unified ledger state.

T3 operates:
- All Hyperledger Besu validator and RPC nodes
- All Tessera transaction managers
- The Ponder indexer (single-source chain data index)
- The Relayer API (authenticated transaction submission gateway)

### 2.2 Operator-Enforced Access Control

Visibility is enforced through layered controls, with a critical distinction between **normal operation** and **degraded/break-glass modes**:

#### Normal Operation (Tier 1)

In normal operation, banks connect **exclusively through the T3 Relayer API**. They do not have direct access to Besu JSON-RPC endpoints. Visibility is enforced through:

1. **Infrastructure control** — T3 runs the hardware. Bank clients connect only through T3-operated API endpoints. The Relayer API and Ponder Explorer API are the only ingress paths.

2. **Authenticated API gating** — The T3 Relayer API authenticates every request. A bank's API client can only see envelope data for wallets associated with that bank's custodian address. The Ponder indexer's Explorer API enforces the same permission model.

3. **Smart contract role checks** — On-chain `AccessControlFacet` enforces role-based access control for privileged operations (minting, pausing, compliance actions, dispute resolution). Roles are:
   - `DEFAULT_ADMIN_ROLE` — T3 system administrator
   - `ADMIN_ROLE` — Operational administration
   - `MINTER_ROLE` — Token minting authorization
   - `PAUSER_ROLE` — Emergency pause capability
   - `CUSTODIAN_ROLE` — Bank custodian operations
   - `COMPLIANCE_ROLE` — Compliance monitoring and reporting

#### Degraded Operation (Tier 2/3) — Visibility Implications

The fallback tiers (§4.3) introduce direct RPC access, which **undermines the operator-enforced visibility model**:

- **Tier 2/3 grant raw RPC access**: If a bank client submits transactions directly to a Besu node, that client can also read logs, storage, and events for *all* consortium participants — not just their own envelopes.
- **ComplianceTransactionDetail enumeration**: The custodian-indexed `ComplianceTransactionDetail` event (§5.3) becomes globally enumerable by anyone with raw RPC access. A bank in Tier 2/3 could scan compliance events for *other* banks' custodians.

**Resolution of Architectural Tension:**
By adopting **On-Chain View ACLs** (Layer 1 of the app-layer privacy model, detailed in §5.2), the visibility degradation of Tier 2/3 fallback is severely mitigated. Even if a bank uses direct RPC access to query state (`eth_call`), the smart contract functions will revert if the caller is not the custodian of the queried data. 

*Note: While `eth_getStorageAt` and raw log scraping could technically still expose data, adding View ACLs provides massive defense-in-depth and eliminates the casual enumeration surface.*

We proceed with allowing Tier 2/3 fallback, relying on the combination of On-Chain View ACLs and operator controls.

**Important**: T3 retains full operator visibility of the shared ledger. This is not cryptographic isolation — it is infrastructure-enforced access control. Banks must understand and accept this distinction.

### 2.3 The Governance Shift

The BaaS model introduces a fundamental trust trade-off:

**What banks gain:**
- No node operation or maintenance responsibility
- Gasless transaction submission via the Relayer
- Single API integration point with rate limiting and authenticated routing
- Compliance dashboards powered by the Ponder indexer

**What banks give up:**
- Independent ledger visibility and verification
- Ability to independently audit the chain state
- Direct participation in consensus

Banks must explicitly trust T3 as the infrastructure operator. This trust shift must be formally accepted by Product, Compliance/Legal, and Bank Partners through signed agreements.

### 2.4 Data Fiduciary Obligations

Because T3 has full visibility into every consortium transaction — amounts, timing, counterparties, envelope states, settlement outcomes — T3 assumes significant regulatory obligations:

- **GDPR Article 28** (EU-nexus participants): T3 is a data processor. Data Processing Agreements (DPAs) must be executed before live transactions are routed through T3 nodes.
- **GLBA / OCC Guidance** (US participants): T3 may be a data fiduciary. Banking secrecy obligations apply to T3 employees with infrastructure access.
- **Cross-bank exposure risk**: A legal compulsion (subpoena, national security letter) directed at T3 may force disclosure of ALL consortium banks' customer data — a risk no single bank controls. This must be documented in the DPA.
- **Audit rights**: Bank participants must have audit rights over T3's node and indexer infrastructure.
- **Employee access controls**: T3 employees with infrastructure access are subject to the same regulatory constraints as bank employees. All operator-level data access must be logged, role-gated, and auditable.
- **Geographic constraints**: Node placement may be constrained by data residency requirements.

See ADR-004 for the complete regulatory framework.

### 2.5 App-Layer Privacy (Replacing Tessera)

Tessera has been officially deprecated by the Hyperledger Besu maintainers (sunsetting mid-2025) and is completely removed from the T3 architecture. The previous paradigm of using Tessera privacy groups for inter-bank privacy is permanently abandoned. Node-to-node transport security is now handled by standard TLS.

Without protocol-layer privacy, T3USD implements a **three-layer application-level privacy model**:

1. **Layer 1: Smart Contract View ACLs (On-Chain)**
   View functions mathematically enforce privacy at the smart contract level. Queries like `getEnvelope()` or `getKYCTimestamps()` incorporate modifier guards such as `require(isCustodianOf(msg.sender, wallet) || hasRole(OPERATOR_ROLE, msg.sender))`. This ensures that even if a participant gains direct RPC access (e.g., in Tier 2/3 fallback), they cannot enumerate other banks' customer data or read envelope details they aren't party to.

2. **Layer 2: Relayer-Mediated Cross-Custodian Queries (Off-Chain API)**
   The relayer acts as a compliance oracle. It validates both sides of a cross-bank transfer and returns only a boolean attestation (pass/fail) to the inquiring bank. This prevents Bank A from exposing its internal KYC logic and tiering to Bank B, while still ensuring compliance.

3. **Layer 3: Event Filtering (Off-Chain Indexer)**
   **Planned, not current behaviour.** The design is that the Ponder indexer filters `ComplianceTransactionDetail` events so Bank A's webhook only receives events where `custodian = Bank A`. `ComplianceTransactionDetail` is declared in `IComplianceEvents.sol` but **is not emitted by any facet today**, and no indexer handler subscribes to it — so this partitioning is not yet in force. See the Wave 6–7 compliance surface.

This represents a philosophically sound pivot: pushing privacy up the stack into the application layer, which is simpler to audit, cheaper to run, and aligns with Besu's current technical direction.

### 2.6 QBFT Consensus & High Availability

The network uses **QBFT** (Quorum Byzantine Fault Tolerance) — the production-recommended BFT consensus algorithm for Hyperledger Besu. QBFT provides:

- Byzantine fault tolerance with `3F+1` validator set
- Immediate transaction finality (no probabilistic confirmation)
- Block-level consensus without mining or staking

**High Availability Requirements:**
- Multi-cloud deployment (AWS + GCP minimum) to survive single-provider outages
- Multi-region deployment to survive single-region failures
- `3F+1` validators distributed across regions so consensus continues if one region fails
- Kubernetes StatefulSets for node lifecycle management

---

## 3. Envelope Model

The envelope model is the core architectural concept of T3's programmable transfer system. It was designed on the original branch and carries forward to Besu unchanged in its semantics — only the privacy layer around it was removed.

### 3.1 Core Structure

Every programmable T3 transfer is modeled as an **envelope** — an escrow container with configurable lifecycle behavior. An envelope contains:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | `bytes32` | Unique deterministic identifier |
| `sender` | `address` | Originator of the transfer |
| `recipient` | `address` | Intended recipient |
| `amount` | `uint256` | Plaintext transfer amount (escrowed on create) |
| `commitWindowEnd` | `uint40` | Timestamp after which expiration behavior activates |
| `settlementType` | `uint8` | `CRYPTO_DIRECT` (0) or `FIAT_INSTITUTIONAL` (1) |
| `expirationBehavior` | `uint8` | One of 6 expiration modes (see §3.3) |
| `state` | `uint8` | Current lifecycle state (see §3.4) |
| `createdAt` | `uint40` | Block timestamp at creation |
| `reversedAmount` | `uint256` | Cumulative amount reversed (for partial reversal tracking) |
| `conditionDataHash` | `bytes32` | Hash of condition/oracle metadata (full data off-chain) |

Storage is isolated via diamond storage pattern at slot `keccak256("t3.storage.envelope.v1")`.

### 3.2 Escrow Model

The envelope system uses an **internal escrow model** where the diamond contract itself holds escrowed tokens:

1. **Create**: Tokens transfer from `msg.sender` to `address(this)` (the diamond proxy). The sender's ERC-20 balance decreases; the diamond's balance increases.
2. **Finalize**: Tokens transfer from `address(this)` to `recipient`. The diamond's balance decreases; the recipient's balance increases.
3. **Reverse**: Tokens transfer from `address(this)` back to `sender`. Partial reversal is supported — the envelope tracks `reversedAmount`.
4. **Dispute Resolution**: Depending on outcome, tokens finalize to recipient, reverse to sender, or split (partial amounts to each).

**Invariant**: Total token supply is preserved across all envelope operations. No tokens are minted or burned during the envelope lifecycle (except for `FIAT_INSTITUTIONAL` settlement, which burns tokens as the settlement trigger).

### 3.3 Six Expiration Behaviors

The expiration behavior determines what happens to escrowed funds when the envelope reaches a time or condition boundary. These are defined in `EnvelopeStorage.ExpirationBehavior` and specified by FR-1002:

#### 1. `IMMEDIATE_FINALIZE` (0)
Funds release to the recipient automatically when the commit window closes. This is the simplest mode — set a deadline, and if no one intervenes, the transfer completes.

**Use case**: Standard transfers with a short review window.

#### 2. `HALFLIFE_DECAY` (1)
Reversibility diminishes over time. Early in the commit window, the sender may reverse the full amount. As time progresses toward `commitWindowEnd`, the reversible portion decays. After the window closes, reversibility reaches zero and the envelope auto-finalizes.

**Critical design note**: Decay is tracked **per-envelope**, not per-`(sender, recipient)` pair. This corrects the TC-INT-003 overwrite bug from the legacy HalfLife tracking system, where a new transfer between the same parties could overwrite the decay state of a previous transfer.

**Use case**: Consumer-facing transfers where the sender wants a cooling-off period.

#### 3. `HOLD_UNTIL_MANUAL` (2)
Funds remain in escrow indefinitely until an authorized party (admin or arbiter) explicitly releases them. The commit window is effectively infinite — no automatic action occurs.

**Use case**: SmartLock adapter (FR-1403), where fragment-based release security requires manual authorization of each release. Also used for escrow arrangements requiring multi-party sign-off.

#### 4. `ORACLE_CONDITIONAL` (3)
Finalization or reversal depends on an external oracle callback. An oracle must be registered via `registerOracle()` before `commitWindowEnd`. The oracle calls back with a boolean result: `true` = finalize, `false` = reverse.

If the oracle fails to respond by `commitWindowEnd`, the safe fallback behavior applies (configurable per envelope via `conditionData`).

**Use case**: Conditional transfers tied to external events (delivery confirmation, regulatory approval, market conditions).

#### 5. `AUTO_REVERSE` (4)
Funds return to the sender automatically when the commit window closes without prior finalization. This is the inverse of `IMMEDIATE_FINALIZE` — if no one acts, the transfer cancels.

**Use case**: Requests for payment where the recipient must actively claim within a deadline. Also used for timeout-based refund flows.

#### 6. `DISPUTE_HOLD` (5)
Escrow is frozen when a dispute is raised. While the dispute is active:
- Finalization is blocked
- Reversal is blocked
- The envelope remains in `Disputed` state

Resolution (by authorized arbiter or timeout with default outcome) determines whether funds finalize, reverse, or split.

**Use case**: Any envelope can enter `DISPUTE_HOLD` via `raiseDispute()`. The mode is also assignable at creation for envelopes that start in a disputed/held state.

### 3.4 State Machine

```
  None ──create──> Created ──finalize──> Finalized
                     │
                     ├──reverse──> Reversed
                     │
                     ├──raiseDispute──> Disputed ──resolveDispute──> Finalized
                     │                                            ──> Reversed
                     │
                     └──(expiration)──> Expired
```

**State transitions**:
- `None → Created`: `createEnvelope()` — funds escrowed, envelope initialized
- `Created → Finalized`: `finalizeEnvelope()` — funds released to recipient
- `Created → Reversed`: `reverseEnvelope()` with full remaining amount
- `Created → Created`: `reverseEnvelope()` with partial amount (envelope continues with reduced escrow)
- `Created → Disputed`: `raiseDispute()` — escrow frozen
- `Created → Expired`: Automatic, triggered by expiration behavior at `commitWindowEnd`
- `Disputed → Finalized`: `resolveDispute()` with `FINALIZE_TO_RECIPIENT` outcome
- `Disputed → Reversed`: `resolveDispute()` with `REVERSE_TO_SENDER` outcome
- `Disputed → Finalized + Reversed`: `resolveDispute()` with `PARTIAL_SPLIT` outcome

### 3.5 Settlement Pathing

Envelopes support two settlement paths, specified at creation:

#### `CRYPTO_DIRECT` (0)
Standard on-chain token transfer. Finalization transfers tokens from the diamond to the recipient's address. This path is entirely on-chain and unaffected by the Besu pivot.

#### `FIAT_INSTITUTIONAL` (1)
Institutional off-chain fiat settlement. This path requires coordination between on-chain token destruction and off-chain fiat release.

**Critical design note**: The fiat trigger mechanism was originally part of the ADR-002 compliance delivery service, which is now superseded. Under the Besu architecture, the compliance delivery service continues to exist but in a narrower scope — it handles Travel Rule delivery and `FIAT_INSTITUTIONAL` settlement triggers only.

**Settlement ordering decision (resolved 2026-04-07): Option (b) — two-phase commit (provisional settlement with clawback window, ACH model).**

On-chain finalization transitions to `PENDING_FIAT_CONFIRMATION` state. Tokens move escrow → recipient (provisional credit); token burn is gated on a `confirmFiatDelivery()` callback from the Ponder indexer. If fiat delivery fails before `clawbackDeadline`, `clawbackSettlement()` pulls tokens from recipient back to sender.

- `EnvelopeState.PendingFiatConfirmation` (index 6) is the transitional state
- `confirmFiatDelivery(envelopeId)` — called by admin/relayer after confirmed fiat delivery; burns tokens from recipient; transitions to `Finalized`
- `clawbackSettlement(envelopeId)` — callable before `clawbackDeadline`; pulls tokens back; transitions to `Reversed`
- The Ponder indexer watches `FiatSettlementTriggered` events and drives the off-chain fiat wire

**Trigger delivery**: The off-chain trigger is delivered through the narrowed compliance delivery service (or, alternatively, via the Ponder indexer pipeline or a bank-operated webhook called by the T3 relayer). The delivery mechanism is independent of the settlement ordering decision above.

### 3.6 Dispute & Oracle Surface

The dispute and oracle surface (FR-1004) provides two extension points for the envelope lifecycle:

**Dispute Flow:**
1. Any authorized party calls `raiseDispute(envelopeId, reason)` on a `Created` envelope
2. Envelope transitions to `Disputed` state — finalization and reversal are blocked
3. Dispute metadata is stored: `raisedBy`, `raisedAt`, `timeoutAt`, `reasonHash`
4. An authorized arbiter (or admin) calls `resolveDispute(envelopeId, outcome, splitAmount)`:
   - `FINALIZE_TO_RECIPIENT` — full amount to recipient
   - `REVERSE_TO_SENDER` — full amount back to sender
   - `PARTIAL_SPLIT` — `splitAmount` to recipient, remainder to sender
5. If the dispute is not resolved by `timeoutAt`, the `defaultOutcome` applies automatically

**Oracle Flow:**
1. An authorized role calls `registerOracle(envelopeId, oracleAddress, callbackSelector)` on an `ORACLE_CONDITIONAL` envelope
2. The oracle contract calls back with a boolean result via the registered selector
3. On `true`, the envelope can be finalized. On `false`, it reverses.
4. If no callback is received by `commitWindowEnd`, safe fallback behavior applies

---

## 4. The Relayer as Operational Bridge

### 4.1 Why the Relayer Still Matters on Besu

On Avalanche, the relayer was the primary mechanism preventing plaintext amount exposure in the public mempool. It accepted plaintext parameters over an authenticated off-chain channel, constructed blinded calldata using the `FR-1101` primitive, and submitted via ERC-2771 meta-transaction forwarding. Without the relayer, amounts were visible in calldata.

On Besu, the mempool is not public. Only consortium nodes see pending transactions. The privacy rationale for the relayer no longer applies.

**But the relayer remains operationally critical** for entirely different reasons:

#### Gasless UX
Banks and their end users should not manage gas wallets. The EVM requires gas for every transaction, but in a consortium context, gas is an infrastructure concern, not a user concern. The relayer pays gas on behalf of authenticated users via ERC-2771 meta-transaction forwarding, creating a gasless experience for bank API clients.

#### Authenticated Ingress
The relayer is the single entry point for bank API clients. It enforces:
- **Authentication**: Every request is authenticated against the bank's API credentials
- **Rate limiting**: Per-bank and per-endpoint rate limits prevent abuse
- **Client routing**: Requests are routed to appropriate Besu RPC endpoints based on load and geography
- **Input validation**: Requests are validated before hitting the blockchain, providing better error messages than raw Solidity reverts

#### Submission Audit Trail
Every transaction passes through the relayer, creating a complete audit log:
- Who submitted the transaction (authenticated bank identity)
- What was submitted (full request payload)
- When it was submitted (timestamp with relayer receipt)
- From which bank context (custodian, API client identifier)

This audit trail is essential for the data fiduciary obligations described in §2.4. It provides the operational evidence that T3 can demonstrate to bank auditors and regulators.

#### Operational Control Plane
The relayer can enforce business rules before on-chain submission:
- Transaction amount limits per bank or per wallet
- Compliance pre-checks (sanctions screening, Travel Rule validation)
- Institutional routing rules (certain transaction types to specific settlement paths)
- Circuit breakers for anomalous activity

#### Replay Protection
ERC-2771 nonce-based replay protection prevents intercepted meta-transactions from being resubmitted. Even on a permissioned network, replay protection is defense-in-depth against compromised API clients or man-in-the-middle attacks on the relayer-to-node path.

### 4.2 ERC-2771 Meta-Transaction Architecture

The relayer uses the ERC-2771 meta-transaction standard (EIP-2771) to forward transactions on behalf of authenticated users. The implementation has two components:

#### T3Forwarder Contract (`contracts/T3Forwarder.sol`)
An OpenZeppelin-based trusted forwarder with:
- **EIP-712 typed signatures**: Users sign a typed data structure containing `from`, `to`, `value`, `gas`, `nonce`, `deadline`, and `data`. This prevents signature reuse across chains or contracts.
- **Nonce management**: Per-user sequential nonces prevent replay attacks. Each successful forwarded call increments the nonce.
- **Deadline validation**: Signatures include an expiration timestamp. Stale signatures cannot be replayed after the deadline.
- **Batch support**: Multiple operations can be batched into a single forwarded transaction for gas efficiency.

#### ERC2771ContextFacet (`contracts/facets/ERC2771ContextFacet.sol`)
A diamond facet that manages trusted forwarder registration and `msg.sender` resolution:
- **Trusted forwarder registry**: The diamond maintains a set of trusted forwarder addresses. Only calls from trusted forwarders receive special `msg.sender` extraction.
- **`_msgSender()` extraction**: When a call comes from a trusted forwarder, the real sender address is extracted from the last 20 bytes of calldata (per EIP-2771 spec). For direct calls, `msg.sender` is used as-is.
- **`isTrustedForwarder(address)`**: View function for external contracts to verify forwarder trust status.

#### Flow Through the Diamond

```
Bank API Client                 T3 Relayer              T3Forwarder            Diamond Proxy
     │                              │                        │                      │
     ├── sign(EIP-712 request) ────>│                        │                      │
     │                              ├── verify signature ───>│                      │
     │                              │   + pay gas            │                      │
     │                              │                        ├── forward(request) ──>│
     │                              │                        │   appending sender    │
     │                              │                        │                      ├── delegatecall
     │                              │                        │                      │   to facet
     │                              │                        │                      │
     │                              │                        │                      ├── _msgSender()
     │                              │                        │                      │   = real sender
```

### 4.3 Operational Tiers (Revised for Besu)

The three-tier model from ADR-003 simplifies under Besu. The privacy gradient between tiers — which was the primary concern on Avalanche — disappears entirely. The tiers now represent **operational degradation levels**:

#### Tier 1 — Relayer-Submitted (Standard Operation)
Transactions are submitted through the authenticated relayer API. The relayer constructs an ERC-2771 meta-transaction and forwards it to a Besu node.

- **Gasless**: Yes — relayer pays gas
- **Authenticated**: Yes — bank API credentials verified
- **Audit trail**: Full — relayer logs every request
- **Rate limiting**: Active — per-bank limits enforced
- **This is the normal operating mode.**

#### Tier 2 — Direct Submission with ERC-2771 (Degraded)
If the relayer is unavailable, an authenticated bank client submits directly to a Besu RPC endpoint using ERC-2771 forwarding through a secondary forwarder.

- **Gasless**: Depends — preserved only if the bank operates its own forwarder, or if a backup T3 forwarder is available
- **Authenticated**: Partial — EIP-712 signature proves sender identity, but relayer-level authentication is bypassed
- **Audit trail**: Partial — on-chain events capture the transaction, but relayer-level request logging is missing
- **Rate limiting**: None — relayer-level limits are bypassed
- **⚠️ Visibility**: If the bank has RPC access to submit transactions, it can likely also *read* chain state — see §2.2 for implications

#### Tier 3 — Plain Direct Submission (Break-Glass)
Ordinary ABI call without meta-transaction wrapping. The submitter must have gas and calls the diamond directly.

- **Gasless**: No — submitter must manage gas
- **Authenticated**: Minimal — only on-chain role checks apply
- **Audit trail**: On-chain only — no relayer-level logging
- **Rate limiting**: None
- **⚠️ Visibility**: Full raw RPC access — the bank can read all consortium data (logs, storage, events). See §2.2.

**Critical distinction from Avalanche**: On Besu, Tier 2/3 do not add a *privacy* degradation in the Avalanche sense (no mempool exposure of plaintext). However, they **do degrade the visibility control model** — banks with direct RPC access can read data for other consortium participants. The distinction between tiers is operational (audit trail, gas management, rate limiting) *and* visibility (§2.2).

**Tier 3 requires explicit operator approval** and should not be the silent automatic default. It is break-glass continuity mode for emergencies (e.g., both relayer and backup forwarder are down simultaneously).

### 4.4 Fallback Policy (Revised for Besu)

The ADR-003 fallback policy simplifies for Besu:

- **Automatic failover**: Tier 1 → Tier 2 on relayer health failure (if secondary forwarder is available)
- **Manual approval only**: Tier 2 → Tier 3 requires explicit operator approval
- **Hysteresis**: Prevent flapping between tiers during transient relayer health issues
- **Mode-transition events**: All tier transitions must emit auditable events
- **Tier 3 disclosure**: If Tier 3 is activated, all participating banks must be notified (loss of audit trail and rate limiting affects their compliance posture)

### 4.5 Relayer and Adapter Interaction

The SmartLock (FR-1403) and Cambio (FR-1404) adapters must support both relayer-submitted and direct-submitted envelope creation. Key design principle:

**Adapters must not assume relayer availability for correctness — only for operational completeness.**

In the Besu model, SmartLock fragment releases and Cambio redemptions remain *functionally* correct in Tier 2 or even Tier 3. The degradation is operational (audit trail, rate limiting) and visibility-related (cross-bank data exposure — see §2.2 and §5.2). There is no mempool-level privacy degradation as there was on Avalanche.

This is simpler than the Avalanche design (where adapters had to handle three materially different privacy postures), but the cross-bank visibility concern in Tier 2/3 means adapters should still prefer Tier 1 when available.

---

## 5. Compliance & Visibility Model

### 5.1 On-Chain Visibility

Under the Besu architecture, all on-chain data is plaintext:

- **Events**: `EnvelopeCreated` emits `uint256 amount` (not `bytes32 amountCommitment`)
- **Storage**: `EnvelopeData.amount` is `uint256` (not masked or committed)
- **View functions**: `getEnvelope()` returns plaintext `amount` directly

The permissioned network itself is the visibility boundary. Only consortium nodes and authenticated API clients can read chain state. There is no public block explorer or anonymous RPC access.

### 5.2 Cross-Bank Data Visibility

**⚠️ This is a critical architectural concern for bank partner conversations.**

On the shared Besu ledger, all smart contract state is visible to all consortium nodes. Raw storage (`eth_getStorageAt`) is readable by any node operator regardless of contract logic — the permissioned-node boundary, not the contract, is the ultimate read control. At the contract-call layer, sensitive view functions are now gated by `ViewACLLib` (FR-1005, see below); the historical concern was that view functions had **no** on-chain access control, which is resolved for the gated views.

**Data already on-chain with cross-bank exposure:**

| Data | Access Method | What Bank B learns about Bank A |
|---|---|---|
| Custodian assignments | `getCustodian(address)` *(ACL-gated via ViewACLLib.requireWalletAccess)* — public view | Which wallets Bank A custodies |
| KYC validation status | `getKYCTimestamps(address)` *(ACL-gated via ViewACLLib.requireWalletAccess; note `isKYCValid(address)` remains ungated)* — public view | When Bank A validated a wallet, when KYC expires |
| KYC validity | `isKYCValid(address)` — public view | Whether Bank A considers a wallet KYC-valid right now |
| Risk scores | `WalletRiskProfile` in AppStorage | Bank A's risk assessment of specific wallets |
| Wallet registrations | `WalletRegistered` events | When Bank A onboarded wallets, plus KYC timestamps |
| Compliance events *(planned — event declared but not emitted)* | `ComplianceTransactionDetail` events | Bank A's transaction volumes, counterparties, settlement types |
| Depositor identity | `checkDepositorConflict()` | Whether a TIN hash exists at Bank A (intentionally cross-bank for FDIC) |

**Protection in Tier 1 (normal operation):**
In Tier 1, banks connect only through the T3 Relayer API and Ponder Explorer API. These APIs filter by custodian — Bank A's client only sees data for Bank A's custodied wallets. **The API layer is the visibility boundary, not the ledger.**

**Protection failure modes:**
1. **Tier 2/3 fallback** — Bank gets direct RPC access, can call any view function or scan any event for any participant
2. **Compromised T3 employee** — Full node access means full data access; mitigated by employee access controls (§2.4) but not eliminated
3. **Legal compulsion** — Subpoena or NSL directed at T3 exposes ALL banks' data (already documented in §2.4)
4. **Ponder API filtering bug** — A bug in the permission-gating logic could leak cross-bank data
5. **On-chain inference** — Even without direct reads, publicly visible transaction patterns (gas usage, block timing, function selector frequency) can reveal information about other banks' activity

**Mitigation implemented (App-Layer Privacy):**

We have formally adopted **Option (a) — On-chain view ACLs**, supplemented by API and Indexer filtering (the three-layer app-layer privacy model):

| Layer | Approach | Protection |
|---|---|---|
| **1. Smart Contract View ACLs** | **Implemented (FR-1005).** `ViewACLLib` (`requireEnvelopeAccess` / `requireWalletAccess`) gates sensitive views: 5 views on `TransferEnvelopeFacet`, `getSmartLockCondition` on `SmartLockEnvelopeFacet`, and `getCustodian` / `getKYCTimestamps` on `CustodianRegistryFacet`. | Enforces strict data access at the contract-call layer, mitigating cross-bank visibility even if a bank uses Tier 2 direct RPC. Note: raw `eth_getStorageAt` still bypasses contract logic — read-blocking at the node remains the backstop. |
| **2. Relayer Compliance Oracle** | Relayer acts as an intermediary, returning zero-knowledge boolean attestations for cross-bank compliance checks. | Prevents leakage of internal bank policies/tiers to peer banks. |
| **3. Indexer Event Filtering** | Ponder filters `ComplianceTransactionDetail` events and only dispatches them to the relevant custodian's explicitly registered webhook. | Prevents off-chain scraping of other banks' transaction flows. |

This decision explicitly abandons Tessera privacy groups (which are deprecated in Besu) and firmly resolves the cross-bank data exposure issue.

### 5.3 Abstracted KYC Tiers (Planned — Not Yet Implemented)

The codebase does NOT currently have a KYC tier system. The existing compliance data on-chain is:
- **CustodianRegistryFacet**: KYC validation timestamps (valid/expired), not tiers
- **DepositorIdentityFacet**: Privacy-preserving TIN hashes for FDIC conflict detection
- **WalletRiskProfile**: Numeric risk scores (0-N), not categorized tiers

The planned KYC tier system would allow banks to tag wallets with abstracted compliance tiers (e.g., `TIER_3`) on-chain, enabling:
- Global compliance enforcement across the consortium
- Consistent threshold-based rules (e.g., enhanced due diligence above certain amounts)
- Without exposing internal bank formulas, customer segmentation, or threshold triggers

**If implemented, KYC tiers significantly amplify the cross-bank visibility concern (§5.2):**
- Tier assignments stored on-chain are readable by any node
- Tier assignment events are globally scannable
- Tier frequency distributions across a bank's wallets reveal customer segmentation policy
- Tier transitions over time correlate with transaction patterns, revealing threshold triggers

**Leakage review** (required before implementing KYC tiers — see ADR-004):
- Must the tier assignment be on-chain, or can it be an off-chain attribute in the Ponder index?
- Can tier checks be done via oracle callback rather than on-chain storage?
- If on-chain, should view functions be ACL-gated (option (a) from §5.2)?

### 5.4 ComplianceTransactionDetail Event

**⚠️ Open design question**: Whether this event should remain on-chain or move off-chain (see discussion below).

The `ComplianceTransactionDetail` event is **declared** in `IComplianceEvents.sol` as a stable interface for downstream compliance consumers, but is **not yet emitted by any facet** — it is a forward declaration for the Wave 6–7 compliance surface, not a live event. When implemented it will carry plaintext transaction details indexed by custodian:

```solidity
event ComplianceTransactionDetail(
    bytes32 indexed envelopeId,
    address indexed senderCustodian,
    address indexed recipientCustodian,
    address sender,
    address recipient,
    uint256 amount,
    uint256 timestamp,
    string  operationType,       // "CREATE", "FINALIZE", "REVERSE", "PARTIAL_REVERSE"
    bytes32 complianceRef,       // Off-chain compliance reference (e.g., SAR ID)
    uint8   settlementType,
    bytes32 parentEnvelopeId     // bytes32(0) if root envelope
);
```

In the Besu model, `ComplianceTransactionDetail` is no longer the *only* source of plaintext data (since `EnvelopeCreated` now also carries plaintext `amount`). It serves a **distinct indexing purpose**: it is indexed by `senderCustodian` and `recipientCustodian`, enabling institutional webhook listeners to filter to envelopes involving their custodied wallets without scanning all events.

`EnvelopeCreated` indexes by `envelopeId`, `sender`, and `recipient` — a different access pattern optimized for per-envelope lookup rather than per-institution filtering.

**⚠️ On-chain vs. off-chain derivability (open decision):**

Since T3 operates the Ponder indexer, the custodian-indexed filtering that `ComplianceTransactionDetail` provides could instead be derived **off-chain** by Ponder:
1. Ponder already indexes `EnvelopeCreated` events (which carry all the same data except custodian)
2. Ponder can join envelope events with `CustodianRegistryFacet` data to derive the custodian association
3. The webhook/dashboard filtering can be done entirely in the Ponder API layer

**Arguments for keeping the event on-chain:**
- On-chain events are tamper-evident — the custodian association is part of the immutable log
- If Ponder is unavailable, the raw event log still provides custodian-filtered data
- Reduces Ponder's join complexity

**Arguments for removing the event:**
- Every `ComplianceTransactionDetail` emission costs gas (~5-8K per lifecycle event)
- The event makes cross-bank enumeration trivially easy for anyone with RPC access (§5.2) — a custodian-indexed event is literally an index of "which wallets belong to which bank"
- If visibility control is the API layer's job, putting the visibility index on-chain undermines that control
- The data is fully derivable from existing events + view functions

**Recommendation**: If the fallback visibility decision (§2.2) chooses write-only RPC or eliminates direct fallback, the on-chain event is lower risk. If any form of direct RPC access is retained, this event should strongly be considered for removal or replacement with an off-chain Ponder-derived index.

### 5.5 Ponder Indexer

T3 operates the **Ponder indexer** as the single source of indexed chain data for the consortium. Ponder connects to a highly-available "Global" RPC node and indexes the entire shared state.

**Permission gating**: The Ponder Explorer API enforces role-based access:
- Banks see only envelopes involving wallets custodied by that bank
- Compliance dashboards filter by custodian-indexed events
- T3 administrators have full visibility (consistent with the operator model)

**Indexed data**:
- All `EnvelopeCreated`, `EnvelopeFinalized`, `EnvelopeReversed` events
- All `ComplianceTransactionDetail` events (filterable by custodian)
- Abstracted KYC tier assignments and transitions
- Dispute lifecycle events
- Oracle callback events

### 5.6 Fiat Settlement Trigger

For `FIAT_INSTITUTIONAL` envelopes, an off-chain trigger must signal the bank's core banking system to release corresponding fiat funds. Under the Besu architecture:

- The trigger is delivered through a **narrowed compliance delivery service** scoped to:
  - Travel Rule compliance data delivery
  - `FIAT_INSTITUTIONAL` settlement triggers
- The service is **decoupled from the privacy model** — it no longer delivers plaintext versions of commitment-only events (since events are now plaintext)

Settlement ordering uses the two-phase commit / provisional-clawback model (ACH). See §3.5 for the resolved design. FR-1003 is COMPLETE.

---

## 6. Contract Surface Reference

### 6.1 Envelope Lifecycle Functions

```solidity
function createEnvelope(
    address recipient,
    uint256 amount,
    uint40 commitWindowEnd,
    uint8 settlementType,
    uint8 expirationBehavior,
    bytes calldata conditionData
) external returns (bytes32 envelopeId);

function finalizeEnvelope(bytes32 envelopeId) external;

function reverseEnvelope(bytes32 envelopeId, uint256 amount) external;
```

### 6.2 Dispute & Oracle Functions

```solidity
function raiseDispute(bytes32 envelopeId, bytes calldata reason) external;

function resolveDispute(
    bytes32 envelopeId,
    uint8 outcome,
    uint256 splitAmount
) external;

function registerOracle(
    bytes32 envelopeId,
    address oracleAddress,
    bytes4 callbackSelector
) external;
```

### 6.3 View Functions

```solidity
function getEnvelope(bytes32 envelopeId) external view returns (
    address sender,
    address recipient,
    uint256 amount,           // plaintext — no amountCommitment
    uint40 commitWindowEnd,
    uint8 settlementType,
    uint8 expirationBehavior,
    uint8 state,
    uint40 createdAt,
    // creationEpoch removed — no epoch infrastructure on Besu
    uint256 reversedAmount
);

function getEnvelopesBySender(address sender) external view returns (bytes32[] memory);
function getEnvelopesByRecipient(address recipient) external view returns (bytes32[] memory);
function getDispute(bytes32 envelopeId) external view returns (...);
function getOracleBinding(bytes32 envelopeId) external view returns (...);
```

### 6.4 Events

```solidity
// Plaintext amount — no amountCommitment
event EnvelopeCreated(
    bytes32 indexed envelopeId,
    address indexed sender,
    address indexed recipient,
    uint256 amount,                  // was: bytes32 amountCommitment
    uint40 commitWindowEnd,
    uint8 settlementType,
    uint8 expirationBehavior
);

event EnvelopeFinalized(bytes32 indexed envelopeId, uint40 finalizedAt);

// Plaintext reversed amount — no reversalCommitment
event EnvelopeReversed(
    bytes32 indexed envelopeId,
    uint256 reversedAmount,          // was: bytes32 reversalCommitment
    uint40 reversedAt
);

event DisputeRaised(bytes32 indexed envelopeId, address indexed raisedBy, bytes32 reasonHash, uint40 timeoutAt);
event DisputeResolved(bytes32 indexed envelopeId, address indexed resolver, uint8 outcome, uint40 resolvedAt);
event OracleRegistered(bytes32 indexed envelopeId, address indexed oracleAddress, bytes4 callbackSelector);
event OracleCallbackReceived(bytes32 indexed envelopeId, address indexed oracleAddress, bool result);
```

---

## 7. Adapters and Future Surfaces

### 7.1 SmartLock Adapter (FR-1403)

SmartLock migrates the existing locked-transfer flow (from `LockedTransferManagerFacet`) into the envelope model using `HOLD_UNTIL_MANUAL` expiration behavior:

- **Fragment-based release**: Funds are released in controlled increments rather than all-at-once. The adapter controls the release schedule.
- **Authorization model**: Only the admin or an authorized arbiter can trigger each fragment release via `finalizeEnvelope()`.
- **Functional equivalence**: SmartLock must maintain behavioral equivalence with the legacy `LockedTransferManagerFacet` while gaining per-envelope state tracking and the unified lifecycle.

**Besu change (resolved)**: The `creationEpoch` field (linked to `DepositorIdentityFacet` salt-epoch system) was removed. Identity continuity is maintained through timestamp-based envelopeId generation from `EnvelopeStorage` nonce — no epoch dependency. FR-1403 is **COMPLETE** (implemented and tested 2026-04-20).

### 7.2 Cambio Adapter (FR-1404)

Cambio maps QR-backed note issuance and redemption into envelope settlement:

- **Issuance**: A QR code represents a Cambio note backed by an envelope in `HOLD_UNTIL_MANUAL` state.
- **Redemption**: Scanning the QR triggers finalization of the backing envelope.
- **Institutional capability**: Cambio is a core institutional capability, not an optional extension. The envelope primitive must support its settlement semantics without special-case logic outside the adapter boundary.

**Besu change (resolved)**: Same epoch-free identity continuity as SmartLock; `CambioEnvelopeFacet` uses the envelope nonce for ID uniqueness. FR-1404 is **COMPLETE** (implemented and tested 2026-05-25).

### 7.3 Envelope Inheritance

Parent-child envelope relationships allow an envelope sender to create sub-envelopes that inherit the parent's commit window floor. `EnvelopeInheritanceFacet` is **fully implemented** (2026-06-13):

- `createChildEnvelope(parentEnvelopeId, recipient, amount, commitWindowEnd)` — creates a child; child's `commitWindowEnd` must not exceed parent's; max depth 1 (no grandchildren); caller must be parent's sender
- `getChildEnvelopes(parentEnvelopeId)` — returns all child IDs for a parent
- `getParentEnvelope(childEnvelopeId)` — returns parent ID (or `bytes32(0)` if root)

Child envelopes use the same escrow and storage path as regular envelopes; they appear in `EnvelopeStorage` as normal envelopes with a parallel entry in `EnvelopeInheritanceStorage`.

### 7.4 Wallet Recovery (FR-1402)

The wallet recovery system handles key compromise and key rotation scenarios. `WalletRecoveryFacet` is **fully implemented** (FR-1402 complete 2026-05-21):

- 5-state machine: `None → RecoveryPending → RecoveryActive → RecoveryComplete / RecoveryCancelled`
- Envelope resolution, Cambio-note resolution, and balance migration are wired
- Quarantine flags block compromised wallets in TransferEnvelopeFacet, SmartLockEnvelopeFacet, and CambioEnvelopeFacet
- Ponder indexer handlers cover the full lifecycle with replay-idempotency
- All `EscrowLib.releaseEscrow` calls use the 4-arg overload (includes issuer domain); no 2-arg attribution bypass remains

---

## 8. Implementation Order

### 8.1 In Progress (On This Branch)

**Status as of 2026-06-13 — all items COMPLETE:**

| Item | Description | Status |
|------|-------------|--------|
| FR-0004 | Corrected contract surface (Besu-native) | COMPLETE |
| FR-0005 | Structural invariant baseline | COMPLETE |
| FR-1001 | Core lifecycle behavioral tests | COMPLETE |
| FR-1002 | Expiration behavior engine | COMPLETE |
| FR-1003 | Settlement pathing + fiat trigger | COMPLETE |
| FR-1004 | Dispute/oracle surface | COMPLETE |
| FR-1005 | On-chain view ACLs | COMPLETE |
| FR-1006 | EscrowLib consolidation | COMPLETE |
| FR-1402 | Wallet recovery (WalletRecoveryFacet) | COMPLETE |
| FR-1403 | SmartLock adapter (SmartLockEnvelopeFacet) | COMPLETE |
| FR-1404 | Cambio adapter (CambioEnvelopeFacet) | COMPLETE |
| FR-ADR003-BESU | Relayer fallback (RelayerFallbackFacet) | COMPLETE |
| FR-CUTOVER | Legacy stack archive | COMPLETE — source moved, never deployed |
| EnvelopeInheritanceFacet | Parent-child envelopes | COMPLETE (2026-06-13) |
| G.0.a | Wire `mintAttributed` into `mintForConsortiumBank` | COMPLETE (PR #128) |
| G.0.b | Wire `finalizeEnvelopeClaims` / `substituteLiability` into envelope finalize | COMPLETE (PR #129) |
| G.0.c | Factor-based collateral check (100% default = 1:1) | COMPLETE (PR #127) |
| FR-2001 / Wave 4 | Attributed issuance capacity (quote/reserve/execute) | COMPLETE (PR #134, gate off) |
| FR-2002 / Wave 5 | Bilateral-net settlement cycle | COMPLETE (PR #134, gate off; ADR-003 counsel gate pending) |

### 8.2 Shipped since Wave 5 (updated 2026-06-25)

| Wave | Description | Status |
|------|-------------|--------|
| 6A | Indexer banking + compliance API on Besu consortium RPC (FR-COMPLIANCE-BESU) | COMPLETE (indexer on `besu-local` id 1337) |
| 6B | Settlement keeper (cycle rollover + funding) — correctness dependency for live cycles | COMPLETE (ships DISABLED) |
| 6C | Reconciliation scripts (net-vs-encumbered invariant as a monitored job) | COMPLETE |
| 7 | Ops UI pages (quote/reserve/execute) + runbooks | COMPLETE |
| 8A–8F | Compliance attestation series: sanctions/AML screening, Travel Rule, scopable controls + sanctions escalation, BSA/CIP, DepositorIdentity promotion, FDIC 12 CFR 370 exam-support endpoint | COMPLETE — all enforcement gates default-OFF, counsel gates pending |

**Pre-activation gates** (before flipping `settlementModelActive` on): S4 collateral-release role guards on the reimbursement path; ADR-003 counsel sign-off. **Before real deposits:** AML/sanctions screening on redemption, BSA/CIP + Travel Rule identity, FDIC 12 CFR 370 depositor-record path. Multilateral-net CCP is the scale endgame (future ADR + counsel), not this build.

### 8.3 Dependency Graph (as of 2026-06-15)

All FRs through Wave 5 are COMPLETE. See §8.1 for canonical status. The graph below shows the resolved dependency order:

```
ADR-004 (ADOPTED) ─────────────────────────────────────────────────────
    │
    ├── FR-0004 (COMPLETE) ─┬── FR-1001 (COMPLETE) ─── FR-1006 (COMPLETE)
    │                       ├── FR-1002 (COMPLETE)           │
    │                       ├── FR-1003 (COMPLETE)           ├── FR-1402 (COMPLETE ✓ 2026-05-21)
    │                       └── FR-1004 (COMPLETE)           ├── FR-1403 (COMPLETE ✓ 2026-04-20)
    │                                                        └── FR-1404 (COMPLETE ✓ 2026-05-25)
    │
    ├── FR-1005 (COMPLETE) — view ACLs
    ├── FR-ADR003-BESU (COMPLETE) ── FR-COMPLIANCE-BESU (COMPLETE ✓ Wave 6A — Besu-local id 1337)
    │
    └── G.0.a/b/c (COMPLETE) ─┬── FR-2001 Wave 4 Attributed Issuance Capacity (COMPLETE ✓ 2026-06-15, gate off)
                              └── FR-2002 Wave 5 Bilateral-Net Settlement Cycle (COMPLETE ✓ 2026-06-15, gate off)

FR-CUTOVER (COMPLETE ✓ 2026-06-13) — source-level archive; never deployed
```

### 8.4 Legacy Transfer Stack Cutover

The legacy transfer stack was **never deployed to production** and has been archived. The table below is a historical record of what was moved to `archive/legacy-facets/`:

| Archived Facet | Was Replaced By |
|---|---|
| `T3TokenTransferFacet` | `T3TokenDirectTransferFacet` + envelope |
| `TransferManagementFacet` | Envelope reverse / dispute |
| `LockedTransferManagerFacet` | `SmartLockEnvelopeFacet` (FR-1403) |
| `CambioEscrowFacet` | `CambioEnvelopeFacet` (FR-1404) |
| `CambioRedemptionFacet` | `CambioEnvelopeFacet` (FR-1404) |

**Cutover status (2026-06-13): COMPLETE — source-level archive.** The legacy stack was never deployed to production; no live wallets or pending-transfer records existed. The cutover executed as a source move only:

- All 15 legacy facets moved to `archive/legacy-facets/` with READMEs naming replacements
- Selectors removed from `scripts/lib/facet-manifest.js`
- No data migration was required
- FR-1403 (SmartLock) and FR-1404 (Cambio) chose the **replace** path: `SmartLockEnvelopeFacet` and `CambioEnvelopeFacet` reimplement the behaviors inside the envelope lifecycle using `EscrowLib` — no delegation to legacy facets

The active diamond is envelope-only. The table above is a historical record of what was archived.

---

## 9. Design Guardrails

These guardrails prevent regression into patterns that were appropriate for Avalanche but are explicitly wrong for the Besu architecture:

1. **Do NOT reintroduce `amountCommitment` or commitment-only events.** Plaintext amounts in events and storage are the architectural choice under ADR-004. The permissioned network provides the visibility boundary.

2. **Do NOT add blinding primitives (FR-1101) or salt epochs (FR-1103).** These FRs are CANCELED. There is no calldata obfuscation on Besu and no identity rotation infrastructure.

3. **Do NOT assume banks have independent ledger visibility.** Banks connect through the T3 Relayer API only. They cannot independently verify chain state. The architecture depends on operator trust, not cryptographic verification.

4. **Do NOT reintroduce Tessera privacy groups.** Tessera was deprecated by the Besu maintainers (sunset mid-2025) and is **permanently removed** from this architecture (see §2.5). Node-to-node transport security is standard TLS; cross-bank confidentiality is enforced at the app layer via view ACLs (§5.2), not by privacy groups.

5. **Do NOT build on the superseded create signature.** The old `createEnvelope(recipient, amountCommitment, commitWindowEnd, settlementType)` is permanently superseded. The corrected signature includes `amount`, `expirationBehavior`, and `conditionData`.

6. **Do NOT conflate the relayer's operational role with its former privacy role.** On Besu, the relayer provides gasless UX, authenticated ingress, audit trail, and operational control — NOT privacy. The three operational tiers differ in audit completeness and gas management, not in privacy posture.

---

## 10. Governing Documents

The following documents are the authoritative source of truth on the `feature/envelope-besu` branch:

| Document | Purpose |
|----------|---------|
| **This document** (`T3_Envelope_Besu_Architecture.md`) | Authoritative architecture reference |
| `ADR-004-BaaS-Consortium-Visibility.md` | Core architectural decision record |
| `FR-inventory.md` | Feature request inventory with status and dependencies |

**Archived materials**: The `archive/envelope-refactor-avalanche` tag preserves the full history of the Avalanche-era design, including migration plans, architectural challenges, and the original 1,675-line unified design document. These are retained for historical provenance only and do not control implementation.
