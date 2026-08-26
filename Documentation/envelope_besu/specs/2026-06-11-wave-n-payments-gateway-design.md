# Wave N — T3 Payments Gateway Design

**Date:** 2026-06-11
**Branch:** `feature/envelope-besu`
**Status:** APPROVED — ready for implementation planning

---

## Problem

The existing `ui-management` admin surface (Persona A) serves bank operators on `admin.t3token.io`. There is no surface for:

- End consumers (bearers) redeeming T3 / Cambio notes on a mobile device
- Merchants accepting T3 payments through a familiar payments-style API
- Third-party systems (POS, ERP, banking cores) integrating T3 without blockchain knowledge

T3 must be invisible infrastructure. Counterparties interact with familiar payments concepts — not wallets, envelope IDs, or gas.

---

## Decisions

| # | Decision |
|---|---|
| D1 | New `gateway/` package alongside `relayer/`, `indexer/`, `ui-management/` in this repo |
| D2 | ISO 20022 field semantics in JSON (not raw XML externally; ISO 20022 XML generated internally for bank fiat settlement leg) |
| D3 | Idempotency-Key header required on all state-changing operations; 24-hour TTL, scoped per credential |
| D4 | Participants generalize merchants, institutions, individuals, and services — not a merchant-specific model |
| D5 | Rules engine: condition/action pairs evaluated in priority order; replaces fixed redemption policy struct |
| D6 | Three redemption paths: Cambio bearer (implemented), bank-deposit direct (Wave 4–5 hook), cross-bank (Wave 5+ hook) |
| D7 | Dynamic redemption: Ponder indexer fires webhook to gateway on T3 received → gateway evaluates participant rules |
| D8 | Consumer surface: `pay.t3token.io`, Privy for auth+signing (passkey = embedded wallet, unified flow), no RainbowKit |
| D9 | Redemption policy is a Wave N feature — expressed as participant rules, not a future wave |
| D10 | Fee collection is a Wave N feature — fee rules are executed, not just modelled; fees collected into a gateway fee wallet, distributed via participant rules |
| D11 | T3-specific features (reversal expiry / half-life, envelope expiry, locked transfers) surfaced in ISO 20022 messages via `SplmtryData` under namespace `T3USD-EXT-V1`; backward-compatible — non-T3 recipients ignore the extension element |

---

## System Topology

```
External Systems
  Merchant POS / ERP / Core Banking
          ↓  REST + webhooks (ISO 20022-aligned JSON)
          ↓  Idempotency-Key on all writes
┌─────────────────────────────────────────────────────┐
│              T3 Payments Gateway                    │
│  gateway/                                           │
│    src/                                             │
│      api/           REST endpoints + auth           │
│      rules/         participant rules engine        │
│      paths/         redemption path implementations │
│      consumer/      pay.t3token.io Next.js app      │
│      events/        Ponder webhook listener         │
│      iso20022/      message generation              │
│    package.json                                     │
└─────────────────────────────────────────────────────┘
          ↓ internal
  ┌───────────────────────────────────────────────┐
  │  Relayer (ERC-2771 meta-tx)     existing      │
  │  Besu JSON-RPC                  existing      │
  │  CambioEnvelopeFacet            existing      │
  │  Ponder Indexer                 existing      │
  └───────────────────────────────────────────────┘
```

The gateway is the only new production service Wave N introduces. The relayer and indexer are consumed as internal clients; neither is modified.

---

## API Surface

### Authentication

API keys with `sk_live_` / `sk_test_` prefix. One key per credential, revocable, scoped to a participant. Provisioned via admin-only endpoint. Keys stored as bcrypt hashes in `participant_credentials`.

### Idempotency

All `POST` and `PUT` requests require `Idempotency-Key: <uuid>` header. The gateway stores `(credential_id, idempotency_key) → response_body` in Postgres with a 24-hour TTL. Retry with the same key returns the cached response without re-executing. Missing key on a state-changing request returns `400 IdempotencyKeyRequired`.

### Endpoints

```
# Payment lifecycle
POST   /v1/payments                     Idempotency-Key required
GET    /v1/payments/{id}
GET    /v1/payments/{id}/receipt        ISO 20022 camt.054-equivalent JSON

# Redemption (participant-facing visibility)
GET    /v1/redemptions/{id}
POST   /v1/redemptions/{id}/cancel      Idempotency-Key required

# Participants
POST   /v1/participants                 admin-only, Idempotency-Key required
GET    /v1/participants/{id}

# Participant rules
GET    /v1/participants/{id}/rules
PUT    /v1/participants/{id}/rules      Idempotency-Key required (full replace)
POST   /v1/participants/{id}/rules      Idempotency-Key required (append single rule)
DELETE /v1/participants/{id}/rules/{ruleId}

# Credentials
POST   /v1/credentials                  admin-only, Idempotency-Key required
DELETE /v1/credentials/{id}

# Webhooks
POST   /v1/webhooks                     Idempotency-Key required
DELETE /v1/webhooks/{id}
```

### Payment Request (ISO 20022-aligned)

```json
POST /v1/payments
{
  "endToEndId": "ORDER-9182",
  "instructedAmount": { "currency": "USD", "value": "42.50" },
  "remittanceInformation": "Table 7 - Dinner service",
  "requestedExecutionDate": "2026-06-11",
  "expiresIn": 300,
  "creditorAgent": {
    "routingNumber": "021000021",
    "accountNumber": "123456789",
    "accountType": "checking"
  }
}
```

Response includes `paymentUrl` (`https://pay.t3token.io/p/{id}`) and `qrPayload` (base64 QR content the POS renders). Counterparty never sees a wallet address, envelope ID, or transaction hash.

### Payment Receipt (camt.054-equivalent)

```json
GET /v1/payments/{id}/receipt
{
  "ntfctnId": "RCPT-...",
  "crdt": {
    "amt": { "currency": "USD", "value": "42.50" },
    "bookgDt": "2026-06-11T18:23:01Z",
    "valDt": "2026-06-11",
    "endToEndId": "ORDER-9182",
    "addtlTxInf": "T3 on-chain settlement ref: 0x..."
  }
}
```

### Webhook Events

| Event | Fired when |
|---|---|
| `payment.created` | Payment request accepted |
| `payment.completed` | Consumer signed and T3 transfer confirmed on-chain |
| `payment.failed` | Consumer error, contract revert, or unrecoverable relay failure |
| `payment.expired` | `expiresIn` elapsed without completion |
| `redemption.initiated` | Redemption path invoked for a completed payment |
| `redemption.completed` | T3 burned, fiat settlement instruction sent to bank |
| `redemption.failed` | Redemption path error; payment stays completed, redemption retried per policy |

Webhook delivery: HTTPS POST with `T3-Signature` header (HMAC-SHA256 of body with `webhook_secret`). Retried with exponential backoff (1s, 2s, 4s, 8s, 16s) up to 5 attempts. Failed deliveries stored for manual replay.

---

## Participant Model

### Participant Types

| Type | Example |
|---|---|
| `merchant` | Restaurant, retail store, vending operator |
| `institution` | Partner bank, credit union, fintech |
| `individual` | Peer-to-peer recipient |
| `service` | API-integrated service, government agency |

### Rules Engine

Participant rules are condition/action pairs evaluated in descending priority order. The first matching rule wins.

**Rule schema:**
```json
{
  "id": "rule-uuid",
  "ruleType": "redemption | routing | compliance | notification | fee",
  "priority": 10,
  "condition": { ... },
  "action": { ... },
  "isActive": true
}
```

**Condition fields (all optional; empty condition always matches):**

| Field | Type | Example |
|---|---|---|
| `amount_gt` | string (USD) | `"10000.00"` |
| `amount_lte` | string (USD) | `"500.00"` |
| `currency` | string | `"USD"` |
| `issuer_type` | string | `"cambio_bearer"`, `"bank_deposit"`, `"cross_bank"` |
| `time_of_day_after` | string (HH:MM UTC) | `"17:00"` |
| `time_of_day_before` | string (HH:MM UTC) | `"09:00"` |

**Action shapes by rule type:**

*redemption:*
```json
{ "type": "immediate" }
{ "type": "batch", "schedule": "0 18 * * *" }
{ "type": "threshold", "thresholdAmount": "500.00" }
{ "type": "manual" }
```

*compliance:*
```json
{ "type": "hold", "notify": ["compliance@bank.com"], "reviewTimeout": 86400 }
{ "type": "reject", "reason": "exceeds_daily_limit" }
```

*notification:*
```json
{ "type": "webhook", "event": "payment.large_value" }
{ "type": "email", "to": ["treasury@merchant.com"] }
```

*fee:*
```json
{ "type": "flat", "amount": "0.25", "currency": "USD" }
{ "type": "percent", "bps": 25 }
```

*routing:*
```json
{ "type": "preferred_issuer", "issuerId": "bank-address" }
{ "type": "round_robin", "issuerIds": ["addr1", "addr2"] }
```

**Example policy — tiered redemption with compliance hold:**
```json
[
  { "priority": 1,  "ruleType": "compliance", "condition": { "amount_gt": "10000" }, "action": { "type": "hold", "notify": ["compliance@bank.com"] } },
  { "priority": 2,  "ruleType": "redemption", "condition": { "amount_gt": "500" },   "action": { "type": "batch", "schedule": "0 18 * * *" } },
  { "priority": 3,  "ruleType": "redemption", "condition": {},                        "action": { "type": "immediate" } }
]
```

---

## Fee Collection

### Flow

Fee rules are evaluated as part of the rules engine pass on every incoming payment. When a fee rule matches, the gateway:

1. Calculates the fee amount (flat or percent of `instructedAmount`)
2. Deducts fee from the amount routed to the participant's redemption path
3. Routes the fee to the gateway fee wallet (a designated address configured per environment)
4. Records the fee in `fee_collections` with a reference back to the payment
5. Includes `chargesInformation` in the ISO 20022 `pacs.008` credit transfer (`chrgs` element — standard ISO 20022 charges field)
6. Includes `feeAmount` and `feeDescription` in the JSON payment receipt

### Fee Wallet and Distribution

The gateway maintains a **fee wallet address** per environment (test/live), configured via environment variable. Fee T3 accumulates in this wallet on-chain. Distribution from the fee wallet (to consortium, to gateway operator, to bank) is out of scope for Wave N — Wave N only collects.

A fee distribution participant rule type (`fee_distribution`) is reserved for a future wave:
```json
{ "ruleType": "fee_distribution", "condition": {}, "action": { "type": "split", "recipients": [...] } }
```

### ISO 20022 charges element

`pacs.008` carries the fee in the `ChrgsInf` block:
```xml
<ChrgsInf>
  <Amt Ccy="USD">0.25</Amt>
  <Agt>
    <FinInstnId><Othr><Id>T3-GATEWAY</Id></Othr></FinInstnId>
  </Agt>
</ChrgsInf>
```

The JSON API receipt mirrors this as:
```json
"charges": [{ "amount": { "currency": "USD", "value": "0.25" }, "agent": "T3-GATEWAY" }]
```

---

## T3 ISO 20022 Extensions

T3-specific features have no native ISO 20022 equivalent. They are surfaced via the standard `SupplementaryData` (`SplmtryData`) extension element, which all ISO 20022 message types support. Recipients that do not understand T3 extensions ignore the element; T3-aware recipients (consortium banks, the gateway itself) parse it.

### Namespace

```
T3USD-EXT-V1
```

All T3 extension elements are placed inside a single `SplmtryData` block with `PlcAndNm` set to `T3USD-EXT-V1`.

### Extension Elements

| T3 Feature | On-chain source | ISO 20022 extension element | Value |
|---|---|---|---|
| Reversal expiry (half-life) | `T3TokenReversalExpiryFacet` | `<T3ReversalExpiry>` | ISO 8601 timestamp of expiry |
| Envelope / note expiry | `CambioEnvelopeFacet.expiresAt` | `<T3NoteExpiry>` | ISO 8601 timestamp |
| Locked transfer | `LockedTransferManagerFacet` | `<T3LockExpiry>` | ISO 8601 timestamp of lock release |
| Commit-reveal required | `requiresCommitReveal` flag | `<T3CommitRevealRequired>` | `true` / `false` |
| Issuer identity | `ConsortiumStorage.bankProfiles` | `<T3IssuerAddress>` | Besu address hex |
| Claim attribution | `ClaimAttributionStorage` | `<T3ClaimDomain>` | Domain separator string |

### Wire format (pacs.008 example)

```xml
<SplmtryData>
  <PlcAndNm>T3USD-EXT-V1</PlcAndNm>
  <Envlp>
    <T3ReversalExpiry>2026-06-12T18:23:01Z</T3ReversalExpiry>
    <T3IssuerAddress>0xaBcD...1234</T3IssuerAddress>
    <T3ClaimDomain>T3_CAMBIO_NOTE_V1</T3ClaimDomain>
  </Envlp>
</SplmtryData>
```

### JSON API surface

The same extension data is included in the JSON payment receipt under `t3Extensions`:

```json
"t3Extensions": {
  "reversalExpiry": "2026-06-12T18:23:01Z",
  "issuerAddress": "0xaBcD...1234",
  "claimDomain": "T3_CAMBIO_NOTE_V1",
  "noteExpiry": null,
  "commitRevealRequired": false
}
```

### Extension evolution

New T3 features add new extension elements under the same `T3USD-EXT-V1` namespace. Version bump (`T3USD-EXT-V2`) only required for breaking changes to existing element semantics. Recipients always ignore unknown elements.

---

## Redemption Paths

All paths implement a single internal interface:

```typescript
interface IRedemptionPath {
  readonly pathType: 'cambio_bearer' | 'bank_deposit' | 'cross_bank';
  redeem(params: RedemptionParams): Promise<RedemptionResult>;
}

interface RedemptionParams {
  paymentId: string;
  amount: string;
  currency: string;
  issuerAddress: string;
  recipientParticipantId: string;
  idempotencyKey: string;
}
```

### Path 1: Cambio Bearer (Wave N — implemented)

1. Gateway decodes `{noteId, phrase}` from payment QR or consumer input
2. Calls `CambioEnvelopeFacet.redeemByPhrase` via relayer (ERC-2771 meta-tx; consumer signs, gateway routes)
3. Ponder indexer confirms on-chain burn event
4. Gateway emits ISO 20022 `pacs.008` credit transfer instruction to issuing bank for fiat settlement to participant's `creditorAgent`
5. Fires `redemption.completed` webhook

### Path 2: Bank-Deposit Direct (Wave 4–5 hook)

1. Gateway detects T3 issued by a consortium bank (not a Cambio note)
2. Calls stub implementation: logs params, stores `redemption.status = pending_wave_implementation`, fires `redemption.initiated` webhook with `pathType: bank_deposit`
3. Interface contract is defined and wired; no-op until Wave 4–5 lands the direct issuance redemption facet

### Path 3: Cross-Bank (Wave 5+ hook)

1. Gateway detects cross-institution settlement requirement
2. Calls stub: same pattern as Path 2, `pathType: cross_bank`
3. Routing logic (source issuer → dest issuer) is modelled in `RedemptionParams` but not executed

**Path selection:** Gateway inspects on-chain issuer metadata at runtime via Ponder indexer query. Cambio notes are identified by `noteId` presence. Bank-deposit T3 carries issuer address resolvable against consortium registry. Cross-bank is detected when issuer and recipient participant bank differ.

### Dynamic Redemption Trigger

Ponder indexer is configured to fire a webhook to `gateway/events/t3-received` on every T3 transfer to a registered participant wallet. The gateway:

1. Receives event: `{ participantId, amount, currency, issuerAddress, txHash }`
2. Queries participant rules in priority order
3. First matching rule determines action
4. Enqueues redemption job (immediate → now; batch → scheduled queue; threshold → accumulate in Postgres; manual → notify only)
5. Redemption job calls the appropriate `IRedemptionPath.redeem()` with an auto-generated idempotency key derived from `txHash + participantId`

Idempotency key derivation from `txHash` guarantees exactly-once redemption initiation even if the Ponder webhook fires more than once (idempotent replay).

---

## Consumer Surface

### Domain and Stack

- Domain: `pay.t3token.io` (separate from `admin.t3token.io`)
- Served from `gateway/consumer/` — Next.js App Router, no admin shell
- No RainbowKit, no MetaMask dependency
- Mobile-first: single-screen flows, large touch targets

### Signing Model

**Privy** is the embedded wallet provider. Privy unifies passkey and embedded wallet into a single flow — the passkey IS the wallet, not a separate fallback. On first visit, Face ID / fingerprint registers a passkey and Privy silently creates a wallet behind it. No seed phrase is shown. Recovery is handled by Privy's email re-authentication: the bearer re-authenticates on a new device and the wallet is restored. This closes Open Question #1.

Three signing paths, in order of presentation:
1. **Privy passkey (primary):** Face ID / fingerprint via WebAuthn. Privy creates/restores the embedded wallet. Signs the ERC-2771 `ForwardRequest`. Works on any modern phone with biometrics.
2. **Privy email/social (recovery):** Bearer re-authenticates with email or social login to recover wallet on a new device. Same Privy session, same wallet.
3. **Connected wallet (advanced):** Standard `window.ethereum` for users who already have MetaMask or similar. Not promoted in the UI but not blocked.

The bearer always signs their own meta-tx. The gateway routes the signed `ForwardRequest` to the relayer. Staff never sign on a bearer's behalf — this is enforced at the contract level (`redeemer = _msgSenderCambio()`) and reinforced by the UI never offering a "sign for someone else" path.

### Entry Points

| Entry | URL pattern | Source |
|---|---|---|
| Merchant payment QR | `pay.t3token.io/p/{paymentId}` | POS-rendered QR |
| Bearer note deep-link | `pay.t3token.io/redeem?noteId={id}&phrase={phrase}` | Notes page QR (existing) |
| Manual phrase entry | `pay.t3token.io/redeem` | Printed receipt / manual input |

### Consumer Flow (payment QR path)

```
Scan QR → gateway decodes paymentId
       → show: merchant name, amount, currency, expiry countdown
       → "Pay with T3" CTA
       → passkey prompt (WebAuthn)
       → gateway receives signed ForwardRequest
       → relay to relayer → on-chain
       → success screen: amount, merchant, timestamp, receipt link
```

### Consumer Flow (bearer note path)

```
Scan QR → gateway decodes {noteId, phrase}
       → show: note amount, issuer, expiry
       → "Redeem" CTA
       → passkey prompt
       → gateway submits redeemByPhrase via relayer
       → success screen: amount redeemed, receipt link
```

### Commit-Reveal Notes

High-value notes with `requiresCommitReveal == true` revert `CommitRevealRequired` before the relayer check. The consumer surface handles this as a two-step flow:

1. **Commit step:** consumer signs `commitRedemption` call (direct, not relayed — commit-reveal has no relayer gate)
2. **Reveal step (next block):** consumer signs `revealRedemption`
3. UI stores commit state in `sessionStorage` keyed by `noteId` (device-bound, not shared across sessions)

---

## Data Model (Postgres)

```sql
participants (
  id               UUID PRIMARY KEY,
  type             TEXT NOT NULL,          -- merchant|institution|individual|service
  display_name     TEXT NOT NULL,
  metadata         JSONB,                  -- type-specific extensible fields
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
)

participant_rules (
  id               UUID PRIMARY KEY,
  participant_id   UUID REFERENCES participants,
  rule_type        TEXT NOT NULL,          -- redemption|routing|compliance|notification|fee
  priority         INT NOT NULL,
  condition        JSONB NOT NULL DEFAULT '{}',
  action           JSONB NOT NULL,
  is_active        BOOL NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
)

participant_credentials (
  id               UUID PRIMARY KEY,
  participant_id   UUID REFERENCES participants,
  type             TEXT NOT NULL,          -- api_key|webhook_secret|oauth_client
  credential_hash  TEXT NOT NULL,
  scopes           TEXT[] NOT NULL,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
)

payments (
  id               UUID PRIMARY KEY,
  participant_id   UUID REFERENCES participants,
  end_to_end_id    TEXT NOT NULL,
  amount           NUMERIC(18,6) NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  status           TEXT NOT NULL,          -- created|completed|failed|expired
  path_type        TEXT,                   -- cambio_bearer|bank_deposit|cross_bank
  redemption_id    UUID REFERENCES redemptions,
  expires_at       TIMESTAMPTZ NOT NULL,
  idempotency_key  TEXT NOT NULL,
  creditor_agent   JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
)

redemptions (
  id               UUID PRIMARY KEY,
  payment_id       UUID REFERENCES payments,
  path_type        TEXT NOT NULL,
  issuer_address   TEXT,
  on_chain_tx      TEXT,
  iso20022_msg_id  TEXT,
  status           TEXT NOT NULL,          -- initiated|completed|failed|pending_wave_implementation
  settled_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
)

webhooks (
  id               UUID PRIMARY KEY,
  participant_id   UUID REFERENCES participants,
  url              TEXT NOT NULL,
  events           TEXT[] NOT NULL,
  secret_hash      TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
)

webhook_deliveries (
  id               UUID PRIMARY KEY,
  webhook_id       UUID REFERENCES webhooks,
  event_type       TEXT NOT NULL,
  payload          JSONB NOT NULL,
  attempts         INT NOT NULL DEFAULT 0,
  last_attempted   TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  status           TEXT NOT NULL           -- pending|delivered|failed
)

fee_collections (
  id               UUID PRIMARY KEY,
  payment_id       UUID REFERENCES payments,
  participant_id   UUID REFERENCES participants,
  rule_id          UUID REFERENCES participant_rules,
  amount           NUMERIC(18,6) NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  fee_wallet       TEXT NOT NULL,            -- gateway fee wallet address
  on_chain_tx      TEXT,                     -- tx hash once fee T3 is on-chain
  status           TEXT NOT NULL,            -- pending|collected|failed
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
)

idempotency_keys (
  credential_id    UUID NOT NULL,
  idempotency_key  TEXT NOT NULL,
  response_body    JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (credential_id, idempotency_key)
)
-- TTL: purge rows where created_at < now() - interval '24 hours'
```

---

## `gateway/` Package Structure

```
gateway/
  src/
    api/
      payments.ts         POST /v1/payments, GET /v1/payments/:id
      participants.ts     participant + credential + rules endpoints
      webhooks.ts         webhook registration
      receipt.ts          camt.054 receipt generation
    rules/
      engine.ts           evaluate participant rules in priority order
      types.ts            condition/action type definitions
    paths/
      index.ts            IRedemptionPath interface + path registry
      cambio-bearer.ts    Path 1: implemented
      bank-deposit.ts     Path 2: Wave 4-5 hook stub
      cross-bank.ts       Path 3: Wave 5+ hook stub
    consumer/             Next.js App Router (pay.t3token.io)
      app/
        p/[paymentId]/    merchant payment QR flow
        redeem/           bearer note flow
    events/
      ponder-listener.ts  Ponder indexer webhook receiver
      redemption-queue.ts job queue (immediate/batch/threshold/manual)
    fees/
      collector.ts        fee rule evaluation + fee_collections writes
      wallet.ts           gateway fee wallet address config
    iso20022/
      pacs008.ts          credit transfer instruction generation
      camt054.ts          receipt notification generation
      t3-extensions.ts    T3USD-EXT-V1 SplmtryData block generation
    relayer/
      client.ts           ERC-2771 ForwardRequest submission
    db/
      schema.ts           Postgres schema (Drizzle or Kysely)
      migrations/
  package.json
  .env.example
```

---

## Out of Scope for Wave N

- KYC verification of individual consumers (deferred to Wave 3B.2+ integration)
- Cross-bank settlement execution (Path 3 stub only)
- Bank-deposit direct redemption execution (Path 2 stub only)
- Merchant onboarding UI (admin API only; no self-serve portal)
- Multi-currency beyond USD
- Fee distribution from the gateway fee wallet (collection is Wave N; distribution to consortium/bank/operator is a future wave)

---

## Open Questions (not blocking Wave N)

1. ~~**Passkey key management**~~ — **Resolved (D8).** Privy email re-authentication restores the wallet on a new device. No separate recovery mechanism needed.
2. **ISO 20022 fiat settlement acknowledgement:** The gateway emits `pacs.008` to the issuing bank. How does the bank acknowledge receipt and confirm fiat credit to the merchant? This is an out-of-band bank integration question; Wave N models it as fire-and-forget with `redemption.completed` fired on `pacs.008` emission. Full round-trip acknowledgement is a future wave.
3. **Ponder indexer webhook auth:** The `gateway/events/ponder-listener.ts` endpoint needs to authenticate that events come from the trusted Ponder instance (HMAC or shared secret). To be defined in implementation.
