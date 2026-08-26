# FR-1404: Cambio Adapter — As-Built Design Reference

> **Status note (2026-06-11):** FR-1404 is implemented. This dated document records the design and remaining product/QA follow-ups; it is not an open implementation proposal. Where this document conflicts with current contracts, tests, the facet manifest, or indexer handlers, the current repository behavior is authoritative.

**Date:** 2026-05-25  
**Branch:** `feature/envelope-besu`  
**Status:** IMPLEMENTED — historical/as-built reference
**Author:** AI Agent  
**Depends on:** FR-1001 (Envelope Lifecycle), FR-1002 (Expiration Behaviors), FR-1006 (EscrowLib), FR-1402 (Wallet Recovery)

---

## 1. Problem Statement

The T3 Cambio system enables QR-backed bearer notes: an issuer (typically a non-bank merchant or licensed money-service business) escrows T3USD in the diamond contract, prints a QR code containing a secret phrase, and a redeemer scans the code to claim the funds. In the Avalanche-era architecture, Cambio notes were managed by `CambioEscrowFacet` and `CambioRedemptionFacet` with legacy storage in `StorageLib.AppStorage.cambioNotes`.

The Besu envelope redesign requires Cambio to operate inside the envelope model while preserving:

1. **QR identity continuity** — Existing printed QR codes must remain valid (or have a deterministic migration path).
2. **Escrow auditability** — All token movements through `address(this)` must emit `Transfer` events for Ponder indexer reconciliation.
3. **High-value note security** — Notes above a configurable threshold must use a commit-reveal mechanism to prevent front-running and MEV extraction on the permissioned network.
4. **Recovery compatibility** — If an issuer enters wallet recovery (FR-1402), outstanding notes must be resolvable or transferable to the successor wallet.

The `CambioEnvelopeFacet` already implements the core envelope-mode Cambio lifecycle. This spec documents the adapter architecture, explicit design decisions, and any remaining integration gaps.

---

## 2. Scope & Boundaries

| Component | Status | Notes |
|---|---|---|
| `CambioEnvelopeFacet.sol` | **IMPLEMENTED** | Note creation, redemption, cancellation, commit-reveal, receipt generation. |
| `CambioEnvelopeStorage.sol` | **IMPLEMENTED** | Isolated storage slot `keccak256("t3.storage.cambio.envelope.v1")`. |
| `CambioIssuerFacet.sol` | **IMPLEMENTED** | Dual-mode facet supporting legacy and envelope issuer profiles. |
| `WalletRecoveryFacet` integration | **IMPLEMENTED** | `_transferCambioIssuerProfile()` migrates issuer profiles during recovery. |
| Ponder indexing for envelope Cambio events | **IMPLEMENTED** | Handlers cover `CambioEnvelopeNoteCreated`, `CambioEnvelopeNoteRedeemed`, `CambioEnvelopeNoteCancelled`, and commit lifecycle events. |
| Legacy-to-envelope note migration | **OUT OF SCOPE** | No on-chain migration of legacy `StorageLib.CambioNote` structs. Legacy notes are settled or voided under FR-CUTOVER. |

---

## 3. Epoch-Free Identity Continuity

### 3.1 Problem

The Avalanche-era design used epoch-based salt rotation for identity continuity. On Besu, epochs are unnecessary (ADR-004: permissioned network provides visibility boundary), but note identifiers must still be **unique, non-predictable, and stable** across the lifetime of a printed QR code.

### 3.2 Solution: Counter-Based Deterministic Note ID

`CambioEnvelopeFacet.createCambioNote` generates:

```solidity
noteId = keccak256(abi.encode(block.chainid, address(this), issuer, ++es.envelopeNoteCounter));
```

**Properties:**
- **Uniqueness**: Guaranteed by monotonic `envelopeNoteCounter` per diamond instance.
- **Stability**: The `noteId` is immutable once created. The printed QR code encodes the `noteId` (or a URL containing it) plus the secret phrase.
- **No epoch dependency**: No salt rotation, no epoch registry, no external oracle.
- **Cross-chain safety**: `block.chainid` prevents note ID collisions if the same issuer deploys on multiple chains.

### 3.3 QR Code Content Format (Off-Chain Recommendation)

```
t3://cambio/{noteId}?salt={noteSalt}
```

The redeemer app extracts `noteId` and `noteSalt`, prompts the user for the secret phrase, and calls:
- `redeemByPhrase(noteId, phrase, amount, nonce, metadata)` for low-value notes
- `commitRedemption(commitmentHash, expiresAt)` + `revealRedemption(...)` for high-value notes

> **Security note**: `noteSalt` is public and per-note unique. Its sole purpose is to prevent rainbow-table attacks against the `phraseCommitment`. Reusing `noteSalt` across multiple notes with the same phrase enables cross-note replay.

---

## 4. Escrow Integration

### 4.1 Design Decision: T3CommonLib vs. EscrowLib

`CambioEnvelopeFacet` uses `T3CommonLib.internalTransfer` for all token movements:

```solidity
// Escrow in
T3CommonLib.internalTransfer(ds, issuer, address(this), amount);
emit ERC20BaseFacet.Transfer(issuer, address(this), amount);

// Release to redeemer
T3CommonLib.internalTransfer(ds, address(this), redeemer, amount);
emit ERC20BaseFacet.Transfer(address(this), redeemer, amount);
```

**Why not `EscrowLib`?**

`EscrowLib` (introduced in FR-1006) provides three functions:
- `escrowFrom(address from, uint256 amount)` — debit `from`, credit `address(this)`, emit `Transfer`
- `releaseEscrow(address to, uint256 amount)` — debit `address(this)`, credit `to`, emit `Transfer`
- `burnEscrow(uint256 amount)` — debit `address(this)`, reduce `_totalSupply`, emit `Transfer` to `address(0)`

Cambio notes are **not generic envelope escrow**. They have issuer-specific audit counters (`notesOutstanding`, `valueOutstanding`, `t3usdEscrowed`, `t3usdRedeemed`, `t3usdCancelled`) that must be updated atomically with the token movement. `EscrowLib` functions are too low-level; wrapping them would require additional storage writes anyway, negating the deduplication benefit.

**Conclusion**: Cambio envelope escrow stays on `T3CommonLib`. The invariant "any token movement through `address(this)` must emit a `Transfer` event" is enforced manually via `emit ERC20BaseFacet.Transfer` in every movement path.

### 4.2 Escrow Invariants

| Invariant | Enforcement |
|---|---|
| Total supply preserved | All Cambio escrow is peer-to-peer (`issuer → diamond → redeemer`). No minting or burning during normal lifecycle. |
| Issuer audit counters match escrow | `profile.t3usdEscrowed - profile.t3usdRedeemed - profile.t3usdCancelled == profile.valueOutstanding` (verified in unit tests). |
| No double-spend | `note.spent` incremented before `T3CommonLib.internalTransfer`; `nonReentrant` on all state-changing functions. |
| Ponder balance reconciliation | Every `internalTransfer` is paired with an explicit `Transfer` event. |

---

## 5. Commit-Reveal Mechanism

### 5.1 Threat Model

On a permissioned Besu network, transaction content is visible to all validators. If a redeemer broadcasts `redeemByPhrase` with the secret phrase in calldata, a validator could:
1. See the phrase.
2. Front-run the transaction with its own redemption using the same phrase.
3. Steal the funds.

**Mitigation**: Notes with `amount >= commitRevealThreshold` MUST use the commit-reveal flow. The threshold is configurable via `CambioEnvelopeConfig.commitRevealThreshold`.

### 5.2 Commit Phase

The redeemer (or a relayer on their behalf) computes off-chain:

```solidity
commitmentHash = keccak256(abi.encode(
    block.chainid,
    address(this),
    noteId,
    phrase,
    redeemer,
    amount,
    nonce
));
```

Then calls `commitRedemption(commitmentHash, expiresAt)`.

**On-chain checks:**
- `commitmentHash` must not already exist (`CommitAlreadyExists`).
- `expiresAt <= block.timestamp + maxCommitLifetime` (`MaxCommitLifetimeExceeded`).
- `expiresAt > block.timestamp` (`InvalidCommit`).

The commitment binds **noteId, phrase, redeemer, amount, and nonce**. A front-runner cannot reuse the commitment because:
- The `redeemer` address is hashed into the commitment.
- The front-runner would need to know the `phrase` to create a valid reveal, but the phrase is never exposed on-chain until reveal time.

### 5.3 Reveal Phase

After the commit is mined, the redeemer calls `revealRedemption(noteId, phrase, amount, nonce)`.

**On-chain checks:**
- Recomputes `commitmentHash` on-chain and verifies it exists (`InvalidCommit`).
- Verifies `commit.expiresAt >= block.timestamp` (`CommitExpired`).
- Verifies `commit.redeemer == msg.sender` (`CommitRedeemerMismatch`).
- Verifies `keccak256(abi.encode(phrase, note.noteSalt)) == note.phraseCommitment` (`InvalidPhrase`).
- Deletes the commitment BEFORE executing redemption (prevents reentrancy/replay).
- Calls `_redeemCommon` + `_executeRedemption`.

### 5.4 Commit Lifecycle Management

| Action | Caller | Condition | Effect |
|---|---|---|---|
| `clearExpiredCommit` | Anyone | `commit.exists && commit.expiresAt < block.timestamp` | Deletes commitment, emits `CommitCleared`. |
| `cancelCommit` | Committer | `commit.exists && commit.expiresAt >= block.timestamp` | Deletes commitment, emits `CommitCancelled`. |
| `clearExpiredCommits(bytes32[])` | Anyone | Batch version of above | No-op on non-expired commits. |

### 5.5 Recovery Interaction

If an issuer enters recovery while commitments are pending:
- The commitment remains valid until `expiresAt`.
- The redeemer can still reveal and claim funds.
- If the note is cancelled during `resolveCambioNotesBulk`, active commitments become invalid because `note.active == false` — the reveal will revert at `_redeemCommon` (`NoteNotActive`).
- The `WalletRecoveryFacet` emits `RecoveryCambioNoteResolved` for each note, allowing the Ponder indexer to alert the redeemer app that the note is no longer claimable.

---

## 6. Settlement Pathing

Cambio notes use `CRYPTO_DIRECT` settlement semantics (tokens move directly from escrow to redeemer). There is no `FIAT_INSTITUTIONAL` variant for Cambio — bearer notes represent digital claims, not fiat wires.

However, the envelope model's `ExpirationBehavior` concept does not directly apply to Cambio notes. Instead, Cambio notes have:
- `deadline`: Absolute timestamp after which the note expires.
- `openRedemptionSnapshot`: Whether the note is bearer-style (anyone with phrase can redeem) or role-gated.
- `requiresCommitReveal`: Whether the high-value commit-reveal path is mandatory.

These fields are captured at creation time and remain immutable for the note's lifetime.

---

## 7. Authorization Model

### 7.1 Roles

| Role | Purpose |
|---|---|
| `CAMBIO_ISSUER_ROLE` | Can create notes. Granted on issuer registration. |
| `CAMBIO_REDEEMER_ROLE` | Can redeem role-gated notes via `redeemByNoteId`. |
| `CAMBIO_ADMIN_ROLE` | Can pause/unpause, set config, advance phase. |
| `SPONSOR_BANK_OPERATOR_ROLE` | Can endorse non-bank issuers. |
| `CUSTODIAN_ROLE` | Implied for bank wallets that also issue Cambio notes. |

### 7.2 Phase Gate

`CambioEnvelopeFacet` uses a three-phase state machine:

```
DISABLED → ENABLED → LEGACY_REMOVED
```

- **DISABLED**: All envelope-mode write functions revert (`CambioEnvelopeDisabled`). Legacy Cambio remains operational.
- **ENABLED**: Envelope-mode Cambio is live. Legacy and envelope coexist.
- **LEGACY_REMOVED**: Legacy Cambio functions are frozen. Only envelope-mode operations are allowed.

Phase transitions are one-way and require `CAMBIO_ADMIN_ROLE`.

---

## 8. Recovery Integration (FR-1402)

### 8.1 Issuer Profile Transfer

When `WalletRecoveryFacet.designateSuccessor()` or `redirectSuccessor()` is called, `_transferCambioIssuerProfile()` copies the `IssuerEnvelopeProfile` and `RollingCeilingBuckets` from the old wallet to the new wallet.

**Important**: The `CambioEnvelopeNote.issuer` field is **immutable**. Notes created by the old wallet continue to reference the old address. `CambioEnvelopeFacet.resolveEffectiveIssuer(note.issuer)` uses `WalletRecoveryStorage.layout().recoverySuccessor[oldWallet]` to dynamically resolve the effective issuer at redemption time.

### 8.2 Note Resolution During Recovery

`WalletRecoveryFacet.resolveCambioNotesBulk()` supports three actions:
- **0 = Transferred**: Note stays active; profile already migrated. Redemptions continue against the successor wallet's ceiling and pause state.
- **1 = Cancelled**: Deactivate note, release remaining escrow to old wallet (which is then migrated via `migrateBalance`).
- **2 = Expired**: Same as cancelled; semantic distinction for reporting only.

---

## 9. Remaining Product and QA Follow-Ups

| Item | Priority | Owner |
|---|---|---|
| Off-chain QR code generation spec (URL format, checksum, error-correction level) | Medium | Product |
| Redeemer app integration guide (commit-reveal UX flow) | Medium | Product |
| Integration test: recovery + commit-reveal (stranded commit after issuer recovery) | Medium | QA |
| Stress test: 1,000 concurrent note creations with rolling ceiling | Low | QA |

---

## 10. Decision Log

| ID | Decision | Rationale |
|---|---|---|
| CAD-001 | Counter-based `noteId` instead of epoch-based | Epochs removed per ADR-004. Counter is simpler and collision-free per chain. |
| CAD-002 | `T3CommonLib` instead of `EscrowLib` for Cambio | Cambio requires issuer-specific audit counters that `EscrowLib` cannot atomically update. |
| CAD-003 | Commit-reveal threshold is configurable, not hardcoded | Allows banks to adjust risk appetite without code changes. |
| CAD-004 | `noteSalt` is public and per-note | Secures `phraseCommitment` against rainbow tables without requiring off-chain secret storage. |
| CAD-005 | Immutable `note.issuer` with runtime successor resolution | Avoids storage migration of all outstanding notes during recovery. `resolveEffectiveIssuer` adds one mapping lookup per redemption. |
| CAD-006 | Three-phase `CambioEnvelopePhase` instead of boolean | Supports gradual cutover: legacy-only → dual-mode → envelope-only. |
