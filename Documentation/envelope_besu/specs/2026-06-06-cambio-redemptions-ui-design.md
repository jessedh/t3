# Wave F UI Design Spec — Cambio Redemptions Page

**Date:** 2026-06-06 (decisions resolved 2026-06-07)  
**Scope:** Design for `cambio/redemptions` + the Option-3 create-flow rework. Implementation proceeds wave-by-wave (F.1 then F'), each gated by Jesse.  
**Ground-truth sources:** `contracts/facets/CambioEnvelopeFacet.sol`, `contracts/lib/CambioEnvelopeStorage.sol`, `contracts/facets/CambioEscrowFacet.sol` (legacy), `ui-management/src/app/cambio/notes/page.tsx`, `ui-management/src/lib/contracts/abis.ts`, `indexer/ponder.schema.ts`, `indexer/src/index.ts`.

---

## 0. Decision Resolution (2026-06-07) — APPROVED BY JESSE

After validating the draft against live source and reviewing with Kimi, Jesse approved **Option 3 (hybrid)** for the Cambio note identity/UX model:

- **Keep the live contract (Model B) as canonical.** `noteId = keccak256(chainid, contract, issuer, ++counter)` — independent of the phrase; `phraseCommitment = keccak256(phrase, noteSalt)` is salted. No contract change.
- **Issuer create-flow becomes phrase-first (ergonomic).** The issuer types a memorable phrase; the UI generates a random `noteSalt`, computes the commitment client-side, and calls `createCambioNote`. The issuer never handles raw salts/commitments.
- **Bearer delivery via QR bundling `{noteId, phrase}`.** Because the bearer needs both the noteId and the phrase (Model B decouples them), the QR/code artifact carries both. The phrase alone can neither create nor locate a note.

**Quantum-resistance note (answers Jesse's question):** Cambio commit-reveal is *decoupled* from quantum resistance in the current architecture. The QR lineage (fragment-only reveal) lives in `LockedTransferManagerFacet`; the SmartLock `creationEpoch` QR linkage was removed in the Besu model (Architecture doc:711, FR-1403 PLANNED). Cambio commit-reveal reveals the full phrase, so it carries no QR property — its operative purpose is replay-binding/anti-front-running, and front-running is **not material** on a permissioned, zero-gas, no-public-mempool chain (residual threat = insider relayer/validator, already inside the consortium trust boundary). Therefore commit-reveal is surfaced **only when the contract forces it** (`requiresCommitReveal == true`), never as a user toggle.

The resolved decision table is in §8 (this supersedes the original "DECISION FOR JESSE" prompts inline below).

---

## 1. Title & Context

**Page name:** Envelope Redemptions  
**Purpose:** A dedicated, bearer-facing page for redeeming envelope-mode Cambio notes. It is separate from the issuer-facing `/cambio/notes` page because the user, mental model, and risk patterns are different:

- `/cambio/notes` = create, cancel, and manage notes (issuers / treasury ops).
- `/cambio/redemptions` = look up a note you hold and execute a redemption (redeemers, bearer-wallet users, customer-facing bank staff).

The page must support three redemption paths:

1. `redeemByPhrase` — single-tx path for notes where `requiresCommitReveal == false`.
2. `commitRedemption` → `revealRedemption` — two-tx commit-reveal path for high-value notes where `requiresCommitReveal == true`.
3. QR/code-assisted lookup — later convenience layer (see §2).

Visual conventions must match the existing Notes page: `'use client'`, wagmi v1 hooks, `Card`/`Button` from `@/components/ui/*`, `PageGuide` + `InfoTooltip`, lucide-react icons, `getContractAddress(chainId)`, `chainId = chain?.id || 1337`, and `CAMBIO_ENVELOPE_FACET_ABI` parsed through `parseAbi`.

---

## 2. Receipt / Note Lookup Mechanism

The live `CambioEnvelopeFacet` does **not** expose `deriveCambioNoteId`. Note IDs on the envelope facet are generated as `keccak256(abi.encode(chainid, address(this), issuer, ++counter))`, so a phrase alone cannot deterministically produce a note ID. This is a real product constraint; the design below surfaces it honestly.

### 2a. Lookup by Note ID (primary, always works)
- Input: a `bytes32` hex string (`0x` + 64 hex chars = 66 chars total).
- Source: on-chain call `getCambioEnvelopeNote(bytes32 noteId)`.
- Validation: length check before enabling the read; zero/empty issuer means "not found".

### 2b. Lookup by Phrase — NOT POSSIBLE (resolved: drop it)

**Phrase-only lookup is structurally impossible on the live (Model B) contract, not merely unexposed.** Two independent reasons:

1. **Forward derivation fails.** `noteId = keccak256(abi.encode(chainid, address(this), issuer, ++counter))` (CambioEnvelopeFacet.sol:138). The phrase is not an input, so there is no function from phrase → noteId. The legacy `deriveCambioNoteId` worked only because the old `CambioEscrowFacet` set `noteId = hash(phrase)` (Model A); that model was deliberately abandoned because it makes notes addressable by *guessing* the phrase.
2. **Reverse lookup fails.** `phraseCommitment = keccak256(abi.encode(phrase, noteSalt))` (line 237) is salted per-note; the redeemer does not hold the salt at lookup time, and the indexer stores only the commitment hash (never plaintext). Finding the matching note would require an O(N) brute-force scan over every note's salt, which has no getter.

**Resolution:** Lookup is by **note ID** (§2a) or **QR** (§2c, which encodes the noteId). The phrase is the redemption *secret*, not the lookup *key*. See §0 / §8 decision #2.

### 2c. QR Scan
- A QR code is the most natural way for a bearer to receive both the note ID and, optionally, the phrase.
- Proposed encoding: `https://admin.t3token.io/cambio/redemptions?noteId=0x...&phrase=...` or a compressed JSON payload.
- **Option C1 — Implement scan + deep-link parsing in Wave F'.**
- **Option C2 — Defer scan to a later wave; support only manual paste in F'.**

**Recommendation:** Option C2 for F'. The notes page already has only a QR *warning* modal, not a real scanner, so there is no existing scanner component to reuse.  
**DECISION FOR JESSE:** Do you want a functional QR scanner in Wave F', or manual input only with a deep-link structure reserved for later?

---

## 3. Display Fields

### 3a. Note Detail Card (on-chain, authoritative)

| Display label | Contract source | Rendering / note |
|---|---|---|
| Note ID | user input / resolved lookup | truncate middle if long |
| Status | `CambioEnvelopeNote.active` | "Active" / "Inactive (cancelled or fully redeemed)" |
| Issuer | `CambioEnvelopeNote.issuer` | Original issuer address from note. `resolveEffectiveIssuer()` is **not** in the current UI ABI; if added later, display effective issuer too. |
| Total escrowed | `CambioEnvelopeNote.escrowedAmount` | formatUnits(…, 18) + " T3" |
| Spent | `CambioEnvelopeNote.spent` | formatUnits(…, 18) + " T3" |
| Remaining | computed: `escrowedAmount - spent` | shown prominently; if `0`, disable all redemption actions |
| Created at | `CambioEnvelopeNote.createdAt` | locale date/time |
| Deadline | `CambioEnvelopeNote.deadline` | locale date/time; show "Expired" badge if past |
| Phrase-protected | `CambioEnvelopeNote.phraseCommitment != 0x00...00` | "Yes" / "No" |
| Open redemption (bearer) | `CambioEnvelopeNote.openRedemptionSnapshot` | "Enabled (relayer required)" / "Disabled" |
| Commit-reveal required | `CambioEnvelopeNote.requiresCommitReveal` | "Required" / "Not required"; drives which action panel is shown |

### 3b. Redemption History (indexer primary, on-chain receipts for detail)

Query tables:
- `cambioEnvelopeNoteEvent` — `eventType` in `"Created"`, `"Redeemed"`, `"Cancelled"` filtered by `noteId`.
- `cambioCommitEvent` — `eventType` in `"Cleared"`, `"Cancelled"` filtered by `noteId` (note that `CommitRedemption` events do **not** carry `noteId`, so pending commits cannot be discovered from the indexer alone; see §4b).

| Column | Source field |
|---|---|
| Event | `eventType` |
| Actor | `redeemer` or `issuer` or `commit.redeemer` |
| Amount | `amount` (for Redeemed/Cleared) or `remainingAmount` (for Cancelled) |
| Remaining | `remaining` (Redeemed only) |
| Timestamp | `timestamp` → locale date/time |
| Tx Hash | `txHash` → link to explorer |

For per-receipt detail (redeemer, exact amount, metadata hash), call:
1. `getCambioEnvelopeReceiptsForNote(noteId)` → `bytes32[] receiptIds`.
2. `getCambioEnvelopeReceipt(receiptId)` → `{ noteId, issuer, redeemer, amount, timestamp, metadataHash }`.

### 3c. Live-vs-indexer guidance
- **Current note state** (active, spent, remaining) must always come from on-chain `getCambioEnvelopeNote`. The indexer is for history only.
- **History** comes from the indexer because there is no on-chain event-list getter scoped to a caller.

---

## 4. Action Options

All writes must first verify:
- `getCambioEnvelopePhase() != DISABLED`
- `getCambioEnvelopeConfig().cambioPaused == false`
- `issuerEffectiveState(issuer) != FULLY_PAUSED`

### 4a. Flow A — Redeem by Phrase (single-tx)
**When available:** `note.active == true`, `note.requiresCommitReveal == false`, `block.timestamp <= note.deadline`, `remaining > 0`.

**Contract call:**
```
redeemByPhrase(
  bytes32 noteId,
  string  phrase,
  uint256 amount,
  uint256 nonce,
  string  metadata
)
```
- `metadata` can be a short receipt memo from the user (or `""`).
- `amount` must be `<= note.escrowedAmount - note.spent`.
- `nonce` must be unique per redeemer (`envelopeSpentNonces[redeemer][nonce] == false`).

**UX step sequence:**
1. User looks up the note (§2a).
2. If `requiresCommitReveal == false`, show the "Redeem by Phrase" panel.
3. Collect: phrase, amount (max button = remaining), nonce (default to `0` with a "next unused" helper if the UI later tracks nonces), optional metadata memo.
4. Client validates: `amount <= remaining`, `deadline not passed`, `phrase non-empty` if `phraseCommitment != 0`.
5. If `openRedemptionSnapshot == true`, warn that this redemption **must** be sent via the gasless relayer (contract enforces `msg.sender == trustedForwarder`).
6. Submit via relayer (meta-tx) or direct wallet depending on `openRedemptionSnapshot` / user preference.
7. On success, refetch note state and append the new `CambioEnvelopeNoteRedeemed` event to history.

### 4b. Flow B — Commit (`commitRedemption`)
**When available:** `note.active == true`, `note.requiresCommitReveal == true`, `remaining > 0`.

**Client-side derivation (critical):**
```
commitmentHash = keccak256(abi.encode(
  chainId,
  diamondAddress,
  noteId,
  phrase,
  redeemerAddress,
  amount,
  nonce
))
```
- `expiresAt` is chosen by the user and must satisfy `block.timestamp < expiresAt <= block.timestamp + config.maxCommitLifetime`.
- `config.maxCommitLifetime` comes from `getCambioEnvelopeConfig()`.

**Contract call:**
```
commitRedemption(bytes32 commitmentHash, uint256 expiresAt)
```

**Anti-front-running rationale:** The commitment binds `noteId`, `phrase`, `redeemer`, `amount`, and `nonce` inside a single hash. An observer watching the mempool cannot front-run the reveal because changing any of those fields produces a different hash, and the commitment is recorded under the redeemer’s address.

**UX step sequence (the hard part):**
1. User looks up a commit-reveal note.
2. Show the "Commit" panel with a warning banner: *"This note requires a two-step redemption to prevent front-running. Do not lose the phrase, amount, and nonce you enter here — they are required for the second transaction."*
3. Collect phrase, amount, nonce, and preferred commit lifetime (slider or preset: 5 min / 15 min / 30 min / max).
4. UI computes `commitmentHash` locally and shows a confirmation summary (no phrase in plain text on screen after submission; mask it).
5. User submits the commit tx.
6. On success, persist the pending commit in **local state** (`localStorage` keyed by `chainId-redeemer-noteId-commitmentHash`):
   - `noteId`, `phrase`, `amount`, `nonce`, `commitmentHash`, `expiresAt`.
7. Surface a persistent "Pending commit" banner on the page with a live countdown to `expiresAt` and a primary "Reveal now" CTA.
8. If the user returns later without local state, they must re-enter the same phrase/amount/nonce to reconstruct the commitment for reveal; the contract has no lookup-by-noteId for commits.

### 4c. Flow C — Reveal (`revealRedemption`)
**When available:** A matching commit exists, `block.timestamp < commit.expiresAt`, and all redemption preconditions hold.

**Contract call:**
```
revealRedemption(bytes32 noteId, string phrase, uint256 amount, uint256 nonce)
```
- `metadata` is hardcoded to `""` by the facet; the UI cannot supply a receipt memo on the reveal path.

**UX step sequence:**
1. From the "Pending commit" banner (§4b), pre-fill `noteId`, `phrase`, `amount`, `nonce`.
2. Alternatively, allow manual re-entry if local state was lost.
3. Validate that the locally recomputed `commitmentHash` matches a stored commit and that `expiresAt` is in the future.
4. Submit the reveal tx directly from the user’s wallet (or via relayer if configured).
5. On success:
   - Clear the pending commit from local state.
   - Refetch note state.
   - Show the emitted `receiptId` and a success message.

### 4d. Secondary commit actions (nice-to-have)
- `cancelCommit(bytes32 commitmentHash)` — allow the committer to cancel before expiry.
- `clearExpiredCommit(bytes32 commitmentHash)` — allow anyone to clear an expired commit (useful UX: a "Sweep expired commits" button if the user has multiple expired commits).

---

## 5. Error States

All revert reasons are pulled from `CambioEnvelopeStorage` custom errors and `CambioEnvelopeFacet` usage.

| Trigger | Revert reason / check | User-facing message |
|---|---|---|
| Note ID does not exist or note is inactive | `getCambioEnvelopeNote(noteId).issuer == address(0)` or `note.active == false`; `NoteNotActive(noteId)` | "Note not found or no longer active. It may have been cancelled or fully redeemed." |
| Note expired | `CambioNoteExpired(noteId)` in `_redeemCommon` | "This note expired at {deadline} and can no longer be redeemed." |
| Phrase mismatch | `InvalidPhrase(noteId)` | "The phrase you entered does not match this note." |
| Commit-reveal required but user tried simple redeem | `CommitRevealRequired(noteId)` | "This note requires a secure commit-reveal redemption. Start with Commit." |
| Open bearer note sent directly | `RelayerRequired(noteId)` | "This bearer note must be redeemed through the gasless relayer." |
| Amount > remaining | `InvalidRedemptionAmount(noteId, requested, remaining)` | "Amount exceeds the remaining balance ({remaining} T3 left)." |
| Nonce already spent | `NonceAlreadySpent(redeemer, nonce)` | "This nonce has already been used. Use a different nonce." |
| Redeemer changed between commit and reveal | `CommitRedeemerMismatch(commitmentHash, expected, actual)` | "This commit was made from a different wallet. You must reveal from the same wallet." |
| Reveal attempted without a prior commit | `InvalidCommit(commitmentHash)` (commit missing) | "No matching commit found. Submit a commit first." |
| Commit expired before reveal | `CommitExpired(commitmentHash)` or `InvalidCommit` after expiry | "Your commit expired. Clear it and create a new commit." |
| Commit `expiresAt` too far in future | `MaxCommitLifetimeExceeded(requested, max)` | "Commit lifetime is too long. Maximum allowed is {maxCommitLifetime} seconds." |
| Commit `expiresAt` in the past or now | `InvalidCommit(commitmentHash)` | "Commit expiry must be in the future." |
| Duplicate commit hash | `CommitAlreadyExists(commitmentHash)` | "A commit with these exact parameters already exists. Change your nonce." |
| Issuer fully paused | `IssuerFullyPaused(effectiveIssuer)` | "Redemptions are paused for this issuer. Try again later." |
| Global Cambio paused | `CambioPaused()` | "Cambio operations are globally paused." |
| Envelope mode disabled | `CambioEnvelopeDisabled()` | "Envelope Cambio is not enabled on this network." |
| Metadata too long | `MetadataTooLong(length, maxLength)` | "Receipt memo is too long (max {maxLength} characters)." |
| Daily redemption ceiling hit | `CambioDailyRedemptionCeilingExceeded(issuer, attempted, ceiling)` | "This issuer’s daily redemption limit would be exceeded. Try a smaller amount or wait." |

---

## 6. Routing Decision

**Options:**

- **R1 — Top-level sibling:** `/cambio/redemptions`, alongside `/cambio/notes` and `/cambio/issuers`.
- **R2 — Sub-route/tab under notes:** `/cambio/notes/redemptions` or a tabbed `/cambio/notes` page with Create / Lookup / Redeem tabs.

**Recommendation:** R1. Redeemers are a different persona than issuers; mixing them increases the chance that an issuer accidentally signs a redemption with the wrong wallet. A sibling route also keeps the existing Notes page intact while F' focuses only on redemption logic.  
**DECISION FOR JESSE:** Top-level `/cambio/redemptions` (recommended) or a tab inside `/cambio/notes`?

**Files that would need an entry:**
- `ui-management/src/lib/domain-config.ts` — add `/cambio/redemptions` to `DOMAIN_CONFIGS.cambio.routes`.
- `ui-management/src/app/cambio/page.tsx` — add a hub card for "Redemptions" linking to `/cambio/redemptions`.
- (Optional) `ui-management/src/lib/help-content/cambio.ts` — add `redemptions` help keys following the existing `cambioHelp.notes.*` pattern.

---

## 7. Alternative Layouts (ASCII Wireframes)

### Layout A — Stacked Cards (mirror existing Notes page)

```
+-----------------------------------------------------------+
|  Envelope Redemptions              [PageGuide]            |
+-----------------------------------------------------------+
|  Lookup Note                                              |
|  [ noteId (0x... or text) ................... ] [Lookup]  |
+-----------------------------------------------------------+
|  Note Details                                             |
|  [Status] [Issuer] [Total] [Spent] [Remaining] ...        |
+-----------------------------------------------------------+
|  Redeem by Phrase  (shown if !requiresCommitReveal)       |
|  Phrase / Amount / Nonce / Memo  [Redeem]                 |
+-----------------------------------------------------------+
|  Commit Redemption (shown if requiresCommitReveal)        |
|  Phrase / Amount / Nonce / Lifetime  [Commit]             |
+-----------------------------------------------------------+
|  Reveal Redemption (shown if pending commit)              |
|  [Pre-filled]  [Reveal]                                   |
+-----------------------------------------------------------+
|  Redemption History                                       |
|  [ Created | Redeemed x | Cancelled | Commit Cleared ]    |
+-----------------------------------------------------------+
```

- **Pros:** Identical visual language to `/cambio/notes`; low design/dev friction; easy to reuse `Card`/`PageGuide` patterns.
- **Cons:** The commit-reveal relationship is not visually obvious; users may miss the two-step dependency or lose local state between steps.

### Layout B — Lookup-first Master/Detail (recommended)

```
+-----------------------------------------------------------+
|  Lookup Note                                              |
|  [ noteId (0x... or text) ................... ] [Lookup]  |
+-----------------------------------------------------------+
|  +------------------------+  +-------------------------+  |
|  | NOTE DETAIL            |  | ACTION PANEL            |  |
|  | Status    Active       |  |                         |  |
|  | Issuer    0xabcd...    |  | [Simple Redeem]         |  |
|  | Total     1000 T3      |  |  OR                     |  |
|  | Remaining 750 T3       |  | [Commit] → [Reveal]     |  |
|  | Commit?   Required     |  |                         |  |
|  +------------------------+  +-------------------------+  |
+-----------------------------------------------------------+
|  Redemption History                                       |
+-----------------------------------------------------------+
```

- **Pros:** Context drives the UI; irrelevant actions are hidden; commit-reveal can be rendered as a connected stepper inside the action panel; makes the two-tx flow feel intentional.
- **Cons:** Slightly more state management than stacked cards; deviates from the exact Notes-page form factor.

### Layout C — Wizard/Stepper Centered on Commit-Reveal

```
+-----------------------------------------------------------+
|  Step 1: Note  →  Step 2: Path  →  Step 3: Transact       |
+-----------------------------------------------------------+
|  [ Lookup / paste / QR link ]                             |
+-----------------------------------------------------------+
|  Based on note type:                                      |
|    - Simple note  →  "Enter phrase & amount" → Redeem     |
|    - Commit note  →  "Commit now" → wait → "Reveal now"   |
+-----------------------------------------------------------+
|  Summary / History                                        |
+-----------------------------------------------------------+
```

- **Pros:** Best guidance for non-technical bearers; commit-reveal dependency is explicit.
- **Cons:** Adds clicks for power users; overkill if most notes are simple `redeemByPhrase`; harder to fit the lookup-first pattern of the rest of the app.

**Recommendation:** Layout B. It balances guidance with density, uses the same `Card` components as Layout A, and makes commit-reveal legible without forcing every user through a wizard.

---

## 8. Decision Resolution (RESOLVED 2026-06-07 — Option 3 approved by Jesse)

| # | Decision | Resolution | Rationale |
|---|---|---|---|
| 0 | **Identity/UX model** | **Option 3 (hybrid).** Keep Model B contract; phrase-first issuer create UX; QR bundles `{noteId, phrase}` for bearers. | Preserves Model B's salted/un-guessable security while restoring the "just type a phrase" issuer ergonomics; QR carries the noteId so bearers don't need to. |
| 1 | **Commit-reveal prominence** | **Invisible by default; auto-routed when `requiresCommitReveal == true`.** Never a user toggle. | Front-running not material on permissioned zero-gas chain; commit-reveal is a contract-forced policy, not a preference (see §0). |
| 2 | **Phrase→noteId lookup** | **Dropped.** Lookup by noteId or QR only. | Structurally impossible on Model B (§2b). |
| 3 | **QR scanner** | **Deferred (manual paste in F'; scanner later).** Reserve the deep-link schema now. | Ship noteId lookup first; scanner is a convenience layer (→ Wave H). |
| 4 | **Routing** | **Top-level `/cambio/redemptions` (R1).** | Redeemers are a distinct persona from issuers. |
| 5 | **Layout** | **Lookup-first master/detail (B).** | Context drives UI; hides irrelevant actions; renders commit-reveal as a connected stepper only when needed. |
| 6 | **Commit-reveal pending state** | **`localStorage` (S1)** with a "resume/abandon" recovery path backed by `cancelCommit` / `clearExpiredCommit`. | The two-tx flow needs persistence to bridge steps; recovery functions exist on-chain. |
| 7 | **Reveal metadata** | **Empty string `""`.** | `revealRedemption` takes no metadata arg (verified line 534). |

### 8a. Implementation decisions locked (from Kimi review)
- **Wallet connect required only at the signing moment** (redeem / commit / reveal) — superseded by §8b. Lookup, note-detail, and history render walletless. ~~Original lock: wallet connect required for all flows.~~
- **Nonce auto-generated** by the UI (secure random); never asked of the user.
- **Pending-commit countdown** + clear-expired recovery surfaced in the action panel.
- **Amount defaults** to unspent remainder with a "Redeem Max" shortcut.
- **Client-side pre-flight** blocks redemption on `!active` / past-`deadline` to save relayer round-trips.
- **Revert reasons humanized** (map `RelayerRequired`, `CommitRevealRequired`, etc. to UI copy per §5).

### 8b. Persona separation (RESOLVED 2026-06-08 — Option C, approved by Jesse)

**Concern (Jesse):** Bank/Admin console patterns were leaking into the end-user (bearer) redemption flow. The page hard-gated *everything* — including read-only lookup/detail/history — behind a wallet-connect guard (`if (!address)` at `redemptions/page.tsx:503`), inheriting `ui-management`'s RainbowKit "house" pattern meant for staff actions.

**Decisive technical fact (verified against `CambioEnvelopeFacet.sol`):** for open-bearer `redeemByPhrase`, `redeemer = _msgSenderCambio()` — ERC-2771 extracts the **signer** of the meta-tx, so whoever signs the `ForwardRequest` becomes the on-chain redeemer of record. **Staff must never sign on a bearer's behalf**, or the receipt names staff as redeemer and corrupts the audit/KYC trail. The bearer must always be the signer.

**Resolution — Option C ("A now, B as the target"):**

| Step | Decision | Status |
|---|---|---|
| **A (now)** | Relax the line-503 guard: lookup, note-detail, and history render **walletless** (read-only, no signer needed on a permissioned chain). Require a connected signer **only** at the moment of `redeemByPhrase` / `commitRedemption` / `revealRedemption`. Page stays in `ui-management` as a **staff-assisted redemption desk**. | **In scope now** (Wave H prerequisite) |
| **B (target)** | A true public bearer self-service experience lives as a **separate lightweight consumer surface** (own wave) — relayer-first, mobile/QR-first, bearer-signs-own-meta-tx (embedded wallet / passkey, not RainbowKit), on its own public domain (not an `admin.` subdomain). | **Scoped as future wave** (see waves doc) |

**Carried-forward risks to address in the B wave (from Kimi review):**
- **Commit-reveal has no relayer gate.** High-value open-bearer notes (`requiresCommitReveal == true`) revert `CommitRevealRequired` in `redeemByPhrase` *before* the forwarder check, so `commitRedemption` / `revealRedemption` are **not** forced through the relayer. If bearer self-service must be fully gasless, this is a contract-level gap to resolve.
- **`localStorage` commit-state isolation** — keyed by redeemer address, it leaks across sessions on a shared staff terminal; a bearer-owned device (the B surface) fixes this naturally.
- **QR deep-link domain** — must point at the public bearer surface, not `admin.t3token.io`.
- **RPC access control** — a public-facing surface still needs authenticated Besu RPC reads (proxy via relayer/UI backend, or scoped credentials).

---

## 9. Gasless Considerations

The relayer `.env.example` already lists the three redemption selectors as allowed:

- `0x82cc9248` — `redeemByPhrase(bytes32,string,uint256,uint256,string)`
- `0x7060ddb7` — `commitRedemption(bytes32,uint256)`
- `0x4c35090c` — `revealRedemption(bytes32,string,uint256,uint256)`

However, the relayer default `ALLOWED_SELECTORS` is only ERC-20 transfer selectors; deployment config determines whether the Cambio selectors are actually enabled.

### Direct wallet vs relayer guidance

| Action | Relayer suitability | Contract enforcement / note |
|---|---|---|
| `redeemByPhrase` on `openRedemptionSnapshot == true` notes | **Required** | The facet checks `msg.sender == trustedForwarder`. If the user sends this directly, it reverts `RelayerRequired(noteId)`. The UI must auto-route open-bearer redemptions through the relayer and show a clear "Gasless redemption" label. |
| `redeemByPhrase` on non-open notes | Optional | Can be sent directly. If the relayer includes the selector and the user prefers meta-tx, allow it. |
| `commitRedemption` | Optional | No contract-level relayer gate. Direct wallet is fine; gasless is a UX option if the deployment allows it. |
| `revealRedemption` | Optional | Same as commit. |

**UI behavior:**
- Detect `note.openRedemptionSnapshot`.
- If `true`, disable direct-wallet signing for `redeemByPhrase` and explain: "Bearer notes must be redeemed gaslessly through the T3 relayer."
- Provide a relayer connection status indicator (already present elsewhere in the app if applicable) and fallback to direct wallet for non-bearer notes.

---

## 10. Known ABI Gap (must be documented for F')

The existing `/cambio/notes` page in `ui-management` calls:

- `createCambioNoteWithPhrase(string phrase, uint256 amount, uint48 deadline)` — selector `0x9273d484`
- `deriveCambioNoteId(string phrase)` — selector present only in legacy `CambioEscrowFacet`

On the live Besu diamond, these selectors are **missing**. The verified-live note creation path is:

- `createCambioNote(uint256 amount, bytes32 phraseCommitment, bytes32 noteSalt, uint48 deadline, string metadata)` — selector `0x394b98c5`

**Spec requirement for F':** The new `/cambio/redemptions` page must be implemented against only the verified-live selectors:

- `redeemByPhrase` (`0x82cc9248`)
- `commitRedemption` (`0x7060ddb7`)
- `revealRedemption` (`0x4c35090c`)
- `getCambioEnvelopeNote` / `getCambioEnvelopeReceiptsForNote` / `getCambioEnvelopeReceipt`

The notes-page correction is now **in scope as Wave F.1** (see §11) because Option 3's phrase-first create flow is exactly the fix for this gap.

---

## 11. Wave F.1 — Notes-page create-flow rework (Option 3)

This wave corrects the live bug AND delivers Option 3's issuer ergonomics + QR bearer delivery. It precedes Wave F' because it produces the `{noteId, phrase}` QR artifact that the redemptions page consumes.

**File:** `ui-management/src/app/cambio/notes/page.tsx` (+ `ui-management/src/lib/contracts/abis.ts`).

**Changes:**
1. **Create flow → `createCambioNote` (Model B, phrase-first).** Issuer enters phrase + amount + deadline. Client-side:
   - `noteSalt = random bytes32` (e.g., `crypto.getRandomValues`).
   - `phraseCommitment = keccak256(abiEncode(['string','bytes32'], [phrase, noteSalt]))` — must match `keccak256(abi.encode(phrase, noteSalt))` exactly (verified CambioEnvelopeFacet.sol:237).
   - Call `createCambioNote(amount, phraseCommitment, noteSalt, deadline, metadata)`.
   - Capture the returned/emitted `noteId` from the `CambioEnvelopeNoteCreated` event.
2. **QR artifact bundles `{noteId, phrase}`** (replacing the noteId-only QR), since the bearer needs both. Keep the existing bearer-QR warning modal.
3. **Lookup flow:** remove `deriveCambioNoteId`; lookup by `noteId` (`0x…66 chars`) via `getCambioEnvelopeNote`.
4. **Redeem-on-notes-page:** either remove (redemption moves to F') or rewire to accept a pasted `noteId` (no `deriveCambioNoteId`). Decision deferred to implementation; do not leave `deriveCambioNoteId` calls.
5. **ABI cleanup (`abis.ts`):** remove the two legacy lines that aren't on the live diamond — `createCambioNoteWithPhrase` (284) and `deriveCambioNoteId` (285). `createCambioNote` (283) is already present.

**QA:** `next build` clean; manual create→QR→lookup smoke against local Besu (chainId 1337).
