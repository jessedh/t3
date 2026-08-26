# T3 Relayer

The relayer is a small Node service for ERC-2771 meta-transactions on the T3
Diamond. It accepts signed `ForwardRequest` payloads, applies target, selector,
TTL, rate-limit, idempotency, and sponsor-budget guardrails, then submits the
request through `T3Forwarder`.

In the demo flow, a user signs the meta-transaction in the browser, the relayer
pays gas, `T3Forwarder` verifies and executes the request, and
`ERC2771ContextFacet` lets the Diamond recover the original signer from the
forwarded calldata.

## Configuration

Copy `.env.example` to `.env` for local development. The variable names below
match `.env.example`.

| Variable | Purpose |
| --- | --- |
| `RELAYER_PRIVATE_KEY` | Gas-paying relayer key. Use a funded development key locally and keep production keys out of source control. |
| `BESU_LOCAL_RPC_URL` | JSON-RPC endpoint for the local Hardhat node or Besu devnet. |
| `NETWORK_LABEL` | Human-readable network label returned from `/health`. |
| `FORWARDER_ADDRESS` | Deployed `T3Forwarder` address. |
| `ALLOWED_TO` | T3 Diamond address the relayer is allowed to call. |
| `ALLOWED_SELECTORS` | Comma-separated 4-byte function selectors the relayer may submit. |
| `MAX_GAS` | Per-request gas ceiling. |
| `MAX_TTL_SECONDS` | Maximum allowed future deadline for signed requests. |
| `RATE_WINDOW_MS` | Rolling rate-limit window. |
| `RATE_LIMIT` | Maximum requests per IP during the rate-limit window. |
| `IDEMPOTENCY_TTL_MS` | Duration for replaying matching `x-idempotency-key` responses. |
| `SPONSOR_WINDOW_MS` | Rolling sponsor-budget window. |
| `SPONSOR_MAX_TXS_PER_MIN` | Sponsor transaction cap per window; `0` disables the cap. |
| `SPONSOR_MAX_GAS_PER_MIN` | Sponsor gas cap per window; `0` disables the cap. |
| `OBSERVATION_MODE` | When `true`, scoring is reported without enforcing deny decisions. |
| `ENFORCE_WARN_AT` | Score threshold for warnings. |
| `ENFORCE_DENY_AT` | Score threshold for denials when observation mode is off. |
| `EXTERNAL_CHECK_A_URL` | Optional external scoring check URL. |
| `EXTERNAL_CHECK_B_URL` | Optional external scoring check URL. |
| `EXTERNAL_CHECK_A_WEIGHT` | Score contribution for external check A failures or timeouts. |
| `EXTERNAL_CHECK_B_WEIGHT` | Score contribution for external check B failures or timeouts. |
| `EXTERNAL_TIMEOUT_MS` | Timeout for optional external checks. |
| `RELAYER_STRICT_SELECTOR_CHECK` | When `true`, startup exits if an allowed selector is not registered on the Diamond. |
| `PORT` | Optional HTTP port. Platforms such as Railway set this automatically. |

## Run Locally

```bash
npm install
npm start
```

The service exposes `GET /health` and `POST /relay`. See
`../demo/README.md` for the browser demo and `RAILWAY_SETUP.md` for Railway
deployment notes.

## Contract Relationship

- `../contracts/T3Forwarder.sol` verifies the EIP-712 request, nonce, deadline,
  signer, and trusted-target relationship before executing the call.
- `../contracts/facets/ERC2771ContextFacet.sol` stores the Diamond's trusted
  forwarder and resolves the original signer for ERC-2771-aware calls.
- `ALLOWED_TO` should be the Diamond address, and `FORWARDER_ADDRESS` should
  match the forwarder trusted by the Diamond.
