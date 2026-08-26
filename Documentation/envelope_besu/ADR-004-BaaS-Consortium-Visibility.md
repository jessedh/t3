# ADR-004: BaaS Consortium Visibility and Governance Model

- **Status:** PROPOSED (pending sign-off — see §Sign-Off Requirements)
- **Date:** 2026-03-24
- **Decision Drivers:** Avalanche-to-Besu migration, privacy model simplification, regulatory compliance, operational scalability.
- **Supersedes:** ADR-001 (Masked Balance Compatibility), ADR-002 (Compliance Visibility Model)
- **Related:** ADR-003 (Relayer Fallback Policy — revised scope for Besu)

---

## Context

T3USD was originally designed for the public Avalanche C-Chain, where transaction calldata, event logs, and storage are visible to anyone. The envelope system included cryptographic privacy layers to protect sensitive financial data:

- **ADR-001** defined masked balances and KYC-gated privacy eligibility.
- **ADR-002** defined commitment-only public events with off-chain compliance delivery.
- **FR-1100–1103** specified blinding primitives, calldata obfuscation, and salt epoch infrastructure.

The project is migrating to a **permissioned Hyperledger Besu consortium network** operated entirely by T3. On a permissioned network, the threat model changes fundamentally:

- There is no public mempool — only consortium nodes see pending transactions.
- There is no anonymous block explorer — only authenticated API clients can query chain state.
- There are no untrusted validators — T3 operates all nodes.

The cryptographic privacy layers designed for Avalanche become unnecessary complexity with significant gas overhead and implementation burden. This ADR formally adopts the replacement architecture.

---

## Decision

### 1. T3-Hosted Shared Ledger (Blockchain-as-a-Service)

T3USD adopts a **Managed Consortium (BaaS)** model with a **Single Shared Ledger**.

- There are no private partitioned states or separate bank subnets.
- The entire consortium runs on one unified ledger state.
- T3 operates all Hyperledger Besu nodes, all Tessera transaction managers, and the Ponder indexer.

### 2. Operator-Enforced Access Control

In Phase 1, participant visibility is enforced through a combination of:

- **Operator-controlled infrastructure** — T3 runs the hardware; banks cannot dump raw chain state.
- **Authenticated API gating** — Banks connect exclusively through the T3 Relayer API with role-based authentication.
- **Smart contract role checks** — On-chain `AccessControlFacet` enforces RBAC for privileged operations.

**This is operator-enforced access control, not cryptographic participant isolation.**

T3 retains full operator visibility of the shared ledger. This is stated plainly so that all stakeholders understand the trust model.

### 3. Governance Shift

Banks **do not** run nodes. In normal operation (Tier 1), they connect exclusively through the T3 Relayer API. This means:

- Banks lose independent ledger visibility and verification.
- Banks must explicitly trust T3 as the operator of nodes, indexer, and ingress.
- This trust shift must be formally accepted by Product, Compliance/Legal, and Bank Partners.

**Note**: The relayer fallback policy (ADR-003, revised for Besu) defines degraded tiers where banks may gain direct RPC access. The visibility implications of these tiers are an open design decision — see the architecture document §2.2 for the three resolution options. The governance model described here assumes Tier 1 (relayer-only) as the normal operating posture.

### 4. Data Fiduciary Obligations

Because T3 operates all nodes and has full visibility into every consortium transaction (amounts, timing, counterparties, envelope states), T3 becomes:

- A **data processor** under GDPR Article 28 (for EU-nexus bank participants).
- Potentially a **data fiduciary** under GLBA and OCC guidance (for US participants).
- Subject to banking secrecy laws in participating jurisdictions.

**Required contractual and operational measures:**

| Obligation | Implementation |
|---|---|
| **Data Processing Agreements (DPAs)** | Banks must execute DPAs with T3 as processor before live transactions are routed through T3 nodes. |
| **Bank Audit Rights** | T3 must provide audit rights to bank participants over the node/indexer infrastructure that processes their customer data. |
| **Employee Access Controls** | T3 employees with infrastructure access are subject to the same regulatory constraints as bank employees regarding that data. Access must be logged, role-gated, and auditable. |
| **Legal Compulsion Risk** | A subpoena or national security letter directed at T3 may force disclosure of ALL consortium banks' customer data. This cross-bank exposure risk must be documented in the DPA. |
| **Geographic Constraints** | Node placement may be constrained by data residency requirements (GDPR, banking regulators). Multi-region deployment must respect these constraints. |

### 5. Plaintext On-Chain Model

With operator-enforced access control replacing cryptographic privacy:

- **Storage**: All amounts are stored as plaintext `uint256`. No masked balances.
- **Events**: All events emit plaintext amounts. No commitment-only events.
- **Interface**: `createEnvelope` does not accept `amountCommitment`. `getEnvelope` returns plaintext `amount`, not a commitment.
- **Removed fields**: `amountCommitment` (bytes32) and `creationEpoch` (uint40) are removed from `EnvelopeData` struct.

### 6. App-Layer Privacy Model (Replacing Tessera)

Tessera has been officially deprecated by the Hyperledger Besu maintainers and is removed from the T3 architecture. Besu no longer supports protocol-layer privacy groups. Instead, T3USD implements a **three-layer application-level privacy model** to manage cross-bank visibility without requiring isolated ledger states:

1. **Layer 1: Smart Contract View ACLs (On-Chain)**
   View functions mathematically enforce privacy at the smart contract level. Functions like `getEnvelope()` or `getKYCTimestamps()` will include modifier guards `require(isCustodianOf(msg.sender, wallet) || hasRole(OPERATOR_ROLE, msg.sender))`. This ensures that even if a participant gains direct RPC access, the contract itself restricts read visibility to authorized custodians and the T3 operator.

2. **Layer 2: Relayer-Mediated Cross-Custodian Queries (Off-Chain API)**
   The relayer acts as a compliance oracle. Instead of Bank A exposing its internal KYC tier data to Bank B, Bank B queries the relayer: "Is the sender of envelope X compliant for this transfer?" The relayer validates both sides against their respective rules and returns a zero-knowledge-like boolean attestation (YES/NO) without revealing the underlying data.

3. **Layer 3: Event Filtering (Off-Chain Indexer)**
   The Ponder indexer serves as the event distribution layer. In the target design it filters `ComplianceTransactionDetail` events (declared but not yet emitted — see IComplianceEvents.sol), ensuring that each bank's webhook only receives events where they are explicitly the sender or recipient custodian. T3 sees all events in an operator capacity.

This architectural shift moves privacy from the protocol/transport layer (Tessera) UP to the application layer, resolving the cross-bank visibility exposure even in degraded operational tiers. Node-to-node transport security is now handled by standard TLS rather than Tessera.

### 7. Consensus Algorithm

The network will use **QBFT** (Quorum Byzantine Fault Tolerance) — the production-recommended BFT consensus for Hyperledger Besu.

- Not IBFT2 (deprecated as of Besu 22.x, creates immediate upgrade obligation).
- Not Clique (PoA, not BFT, insufficient for bank-grade fault tolerance).
- Multi-cloud, multi-region deployment with `3F+1` validator set surviving single-region failure.

### 8. Abstracted KYC Compliance Tiers

Banks tag wallets with abstracted KYC tiers (e.g., `TIER_3`) on-chain for global compliance enforcement without exposing internal bank formulas.

**Leakage review requirements** (must be completed before production):
- Who can query tier assignments? (Operator only vs. any authenticated participant)
- Are assignments globally enumerable via contract events or view functions?
- Do tier frequencies across a bank's wallet population reveal customer segmentation policy?
- Do tier changes over time reveal threshold-trigger events (e.g., TIER_2 → TIER_3 correlating with transaction size)?

---

## Consequences

### Positive
- Eliminates ~4 FRs of cryptographic complexity (FR-1100–1103).
- Reduces gas cost per envelope (struct packs from 8→7 slots, no commitment computation).
- Simplifies the relayer from a privacy mechanism to an operational bridge.
- Enables plaintext Ponder indexing for rich compliance dashboards.

### Negative
- Banks lose independent ledger verification — must trust T3 as operator.
- T3 assumes significant data fiduciary obligations and associated legal risk.
- Cross-bank data exposure under legal compulsion is a risk no single bank controls.
- Requires robust implementation of on-chain view ACLs to prevent state leakage via RPC.

### Artifacts Superseded

| Artifact | Disposition |
|---|---|
| ADR-001 (Masked Balances) | SUPERSEDED by this ADR |
| ADR-002 (Compliance Visibility) | SUPERSEDED by this ADR |
| FR-1100–1102 (Layer 0/1/2 Privacy) | CANCELED |
| FR-1103 (Epoch Integration) | CANCELED |
| FR-1302 (Commitment-Only Events) | CANCELED |

### Artifacts Revised

| Artifact | Change |
|---|---|
| ADR-003 (Relayer Fallback) | Scope narrows from privacy tiers to operational tiers |
| FR-1003 (Settlement Pathing) | Fiat trigger via narrowed compliance service, not ADR-002 delivery |
| FR-1402 (Wallet Recovery) | Must redesign without epoch dependency |
| FR-1403/1404 (Adapters) | Must redesign identity continuity without epochs |

---

## Sign-Off Requirements

This ADR must be signed off by:
- [ ] Product
- [ ] Compliance / Legal
- [ ] Bank Partners (formal acceptance of governance shift + DPA execution)
- [ ] Engineering (architecture spike completed)
