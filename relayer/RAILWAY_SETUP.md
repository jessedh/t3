Railway Deployment — T3 Relayer

Overview

- This folder contains a self-contained service definition for Railway.
- Choose either Docker (recommended, reproducible) or Nixpacks (no Dockerfile) during setup.

Option A — Deploy via Docker (recommended)

- Files used: `relayer/Dockerfile`, `relayer/package.json`, `relayer/server.js`.
- Steps:
  - Create a new Railway project (Dashboard → New Project → Deploy from GitHub).
  - Select this repo, then add a Service with Root Directory set to `relayer/`.
  - Build type: Dockerfile (Railway will auto-detect `relayer/Dockerfile`).
  - Set Environment Variables (Service → Variables):
    - `RELAYER_PRIVATE_KEY`: 0x... funded key to pay gas on the Besu consortium network
    - `BESU_LOCAL_RPC_URL`: JSON-RPC endpoint of the Besu consortium node (e.g. `http://127.0.0.1:8545` for a local devnet)
    - `FORWARDER_ADDRESS`: Trusted forwarder address
    - `ALLOWED_TO`: T3 Diamond address
    - `ALLOWED_SELECTORS`: e.g. `0xa9059cbb` (ERC20 transfer)
    - `MAX_TTL_SECONDS`: `300`
    - `OBSERVATION_MODE`: `true` (or `false` to enforce denies)
    - `ENFORCE_WARN_AT`: `400`
    - `ENFORCE_DENY_AT`: `800`
    - `RATE_WINDOW_MS`: `60000`
    - `RATE_LIMIT`: `60`
    - Optional: `EXTERNAL_CHECK_A_URL`, `EXTERNAL_CHECK_B_URL`, `EXTERNAL_CHECK_A_WEIGHT`, `EXTERNAL_CHECK_B_WEIGHT`, `EXTERNAL_TIMEOUT_MS`
    - Idempotency: `IDEMPOTENCY_TTL_MS=300000` (5 minutes)
    - Sponsor budgets (0 disables): `SPONSOR_WINDOW_MS=60000`, `SPONSOR_MAX_TXS_PER_MIN=0`, `SPONSOR_MAX_GAS_PER_MIN=0`
  - Deploy. Railway injects `PORT`, and the service listens on it automatically.
  - Verify: open the Service URL and append `/health`.

Option B — Deploy via Nixpacks (no Dockerfile)

- Files used: `relayer/package.json`, `relayer/server.js`.
- Steps:
  - Create a new Service with Root Directory = `relayer/`.
  - Build type: Nixpacks (auto-detected Node.js).
  - Start Command: `npm start`
  - Set the same Environment Variables as in Option A.
  - Deploy and verify `/health`.

Custom Domain

- In Railway, open the Service → Settings → Domains.
- Add `relay.t3token.io` and follow the DNS instructions (CNAME/ALIAS to the Railway host).
- Once DNS propagates, `https://relay.t3token.io/health` should respond with JSON.

Security & Guardrails

- Keep `ALLOWED_SELECTORS` minimal (start with `0xa9059cbb`).
- Use `MAX_TTL_SECONDS=300` and let the demo set EIP-712 `deadline` accordingly.
- Start with `OBSERVATION_MODE=true` to observe scores; set `false` in production to enforce DENY.
- Rate limiting (`RATE_WINDOW_MS`, `RATE_LIMIT`) is built-in at the service level.

Troubleshooting

- Health returns 500: verify env vars (forwarder/target addresses) and RPC reachability.
- 400 Caller/selector/target: ensure `to` equals `ALLOWED_TO` and the selector is in `ALLOWED_SELECTORS`.
- 400 deadline: ensure the client’s EIP-712 `deadline` ≤ now + `MAX_TTL_SECONDS`.
- 400 invalid meta-tx: signature mismatch or forwarder `verify` reverted; double-check the domain/types and fields.

Quick Test (from any machine)

- curl the health endpoint: `curl -s https://<railway-domain>/health | jq .`
- Point a client at the relayer by setting `RELAYER_URL` and `RELAYER_HEALTH_URL` to your
  Railway domain. (The bundled gasless demo page is not part of this release.)
