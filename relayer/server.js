/* Simple ERC-2771 relayer for local + Besu consortium usage */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

// Config
const PORT = process.env.PORT || 8787;
const RPC_URL = process.env.RPC_URL || process.env.BESU_LOCAL_RPC_URL || 'http://127.0.0.1:8545';
const NETWORK_LABEL = process.env.NETWORK_LABEL || 'localhost';
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY; // required
const FORWARDER_ADDRESS = process.env.FORWARDER_ADDRESS; // required: lock to known forwarder
const ALLOWED_TO = process.env.ALLOWED_TO; // required: target T3 token (diamond) address
// Comma-separated list of 4-byte selectors, e.g. "0xa9059cbb,0x23b872dd"
const ALLOWED_SELECTORS = (process.env.ALLOWED_SELECTORS || '0xa9059cbb,0x23b872dd').split(',').map(s => s.trim().toLowerCase());
const RELAYER_STRICT_SELECTOR_CHECK = String(process.env.RELAYER_STRICT_SELECTOR_CHECK || 'true').toLowerCase() === 'true';
const MAX_GAS = Number(process.env.MAX_GAS || 600000);

// Scoring/observation for external dummy checks (timeouts)
const OBSERVATION_MODE = String(process.env.OBSERVATION_MODE || 'true').toLowerCase() === 'true';
const ENFORCE_WARN_AT = Number(process.env.ENFORCE_WARN_AT || 400);
const ENFORCE_DENY_AT = Number(process.env.ENFORCE_DENY_AT || 800);
const EXTERNAL_TIMEOUT_MS = Number(process.env.EXTERNAL_TIMEOUT_MS || 1500);
const MAX_TTL_SECONDS = Number(process.env.MAX_TTL_SECONDS || 1209600); // 14 days to cover 7-day drift
// Idempotency window
const IDEMPOTENCY_TTL_MS = Number(process.env.IDEMPOTENCY_TTL_MS || 5 * 60 * 1000);
// Sponsor budget caps (rolling window)
const SPONSOR_WINDOW_MS = Number(process.env.SPONSOR_WINDOW_MS || 60 * 1000);
const SPONSOR_MAX_TXS_PER_MIN = Number(process.env.SPONSOR_MAX_TXS_PER_MIN || 0); // 0 = disabled
const SPONSOR_MAX_GAS_PER_MIN = Number(process.env.SPONSOR_MAX_GAS_PER_MIN || 0); // 0 = disabled
const EXTERNAL_CHECK_A_URL = process.env.EXTERNAL_CHECK_A_URL || '';
const EXTERNAL_CHECK_B_URL = process.env.EXTERNAL_CHECK_B_URL || '';
const EXTERNAL_CHECK_A_WEIGHT = Number(process.env.EXTERNAL_CHECK_A_WEIGHT || 700); // fail-close style
const EXTERNAL_CHECK_B_WEIGHT = Number(process.env.EXTERNAL_CHECK_B_WEIGHT || 300); // fail-open style

if (!RELAYER_PRIVATE_KEY) {
  console.error('RELAYER_PRIVATE_KEY is required in environment');
  process.exit(1);
}
if (!FORWARDER_ADDRESS || !ethers.isAddress(FORWARDER_ADDRESS)) {
  console.error('FORWARDER_ADDRESS is required and must be a valid address');
  process.exit(1);
}
if (!ALLOWED_TO || !ethers.isAddress(ALLOWED_TO)) {
  console.error('ALLOWED_TO is required and must be a valid address');
  process.exit(1);
}

// ABI with named tuple for object-shaped args (must match T3Forwarder's ForwardRequestData exactly)
const FORWARDER_ABI = [
  'function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) external payable',
  'function nonces(address from) external view returns (uint256)',
  'function verify((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) external view returns (bool)'
];

// Ethers v6 setup
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, provider);
const forwarderContract = new ethers.Contract(FORWARDER_ADDRESS, FORWARDER_ABI, wallet);

// Startup selector validation against DiamondLoupe
(async () => {
  try {
    const loupeAbi = ['function facetAddress(bytes4) view returns (address)'];
    const loupe = new ethers.Contract(ALLOWED_TO, loupeAbi, provider);
    for (const sel of ALLOWED_SELECTORS) {
      if (!sel.startsWith('0x') || sel.length !== 10) continue;
      const facetAddr = await loupe.facetAddress(sel);
      if (facetAddr === ethers.ZeroAddress) {
        const msg = `Allowed selector ${sel} not found on diamond ${ALLOWED_TO} — check deployment state`;
        if (RELAYER_STRICT_SELECTOR_CHECK) {
          console.error(`[FATAL] ${msg}. To downgrade to warn-only behavior set RELAYER_STRICT_SELECTOR_CHECK=false in your environment (intended for dev environments with incomplete diamond state).`);
          process.exit(1);
        } else {
          console.warn(`[WARN] ${msg}`);
        }
      }
    }
  } catch (e) {
    // KNOWN LIMITATION: if the DiamondLoupe contract itself reverts (e.g., facetAddress is
    // not registered as a selector on the target diamond), strict mode is silently downgraded
    // to warn-only. True strict enforcement requires a working DiamondLoupe on the target.
    // This is acceptable for now because the relayer is dev tooling; production diamonds
    // are expected to have a complete loupe surface.
    console.warn('[WARN] Could not validate selectors against DiamondLoupe at startup:', e.message);
  }
})();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Simple in-memory replay and rate limit guards (dev-grade)
const seenSignatures = new Map(); // sigHash => ts
const perIpWindow = new Map(); // ip => { count, windowStart }
const RATE_WINDOW_MS = Number(process.env.RATE_WINDOW_MS || 60000);
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 60);
// Idempotency cache: key => { ts, bodyHash, response }
const idemCache = new Map();
// Sponsor budget rolling window
let sponsorWindowStart = Date.now();
let sponsorTxs = 0;
let sponsorGas = 0n;

app.get('/health', async (_req, res) => {
  let chainId = null;
  try { const net = await provider.getNetwork(); chainId = Number(net.chainId); } catch { }
  res.json({
    ok: true,
    network: NETWORK_LABEL,
    chainId,
    relayer: wallet.address,
    forwarder: FORWARDER_ADDRESS,
    target: ALLOWED_TO,
    allowedSelectors: ALLOWED_SELECTORS,
    observation: OBSERVATION_MODE,
    warnAt: ENFORCE_WARN_AT,
    denyAt: ENFORCE_DENY_AT,
    timeoutMs: EXTERNAL_TIMEOUT_MS,
    extA: { configured: !!EXTERNAL_CHECK_A_URL, weight: EXTERNAL_CHECK_A_WEIGHT },
    extB: { configured: !!EXTERNAL_CHECK_B_URL, weight: EXTERNAL_CHECK_B_WEIGHT },
    ttlMax: MAX_TTL_SECONDS,
    rateLimit: { windowMs: RATE_WINDOW_MS, max: RATE_LIMIT },
    idempotency: { ttlMs: IDEMPOTENCY_TTL_MS },
    sponsorBudget: {
      windowMs: SPONSOR_WINDOW_MS,
      maxTxsPerWindow: SPONSOR_MAX_TXS_PER_MIN,
      maxGasPerWindow: String(SPONSOR_MAX_GAS_PER_MIN)
    }
  });
});

app.post('/relay', async (req, res) => {
  try {
    const { request } = req.body || {};
    if (!request || typeof request !== 'object') {
      return res.status(400).json({ error: 'Missing request object' });
    }
    const { from, to, value = 0, gas = 500000, deadline, data, signature } = request;
    if (!ethers.isAddress(from) || !ethers.isAddress(to)) {
      return res.status(400).json({ error: 'Invalid from/to address' });
    }
    // Hard controls
    if (to.toLowerCase() !== ALLOWED_TO.toLowerCase()) {
      return res.status(400).json({ error: 'Target contract not allowed' });
    }
    if (Number(gas) > MAX_GAS) {
      return res.status(400).json({ error: `Gas exceeds limit (${MAX_GAS})` });
    }
    if (Number(value) !== 0) {
      return res.status(400).json({ error: 'Non-zero value transfers are not allowed' });
    }
    // Basic deadline freshness check (client-supplied; final check is in verify)
    if (!deadline || Number(deadline) < Math.floor(Date.now() / 1000) - 30) {
      return res.status(400).json({ error: 'Request deadline expired or missing' });
    }
    // Enforce allowed selectors (first 4 bytes)
    const selector = (data || '').slice(0, 10).toLowerCase();
    if (!ALLOWED_SELECTORS.includes(selector)) {
      return res.status(400).json({ error: `Function selector ${selector} not allowed` });
    }
    if (!signature || typeof signature !== 'string') {
      return res.status(400).json({ error: 'Missing signature' });
    }
    if (!data || typeof data !== 'string' || !data.startsWith('0x')) {
      return res.status(400).json({ error: 'Invalid calldata' });
    }

    // Per-IP rate limiting
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const nowMs = Date.now();
    const rl = perIpWindow.get(ip) || { count: 0, windowStart: nowMs };
    if (nowMs - rl.windowStart > RATE_WINDOW_MS) { rl.count = 0; rl.windowStart = nowMs; }
    rl.count += 1; perIpWindow.set(ip, rl);
    if (rl.count > RATE_LIMIT) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // Idempotency key handling
    const idemKey = (req.headers['x-idempotency-key'] || '').toString().trim();
    const bodyHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(req.body)));
    if (idemKey) {
      const cached = idemCache.get(idemKey);
      if (cached && cached.bodyHash === bodyHash && nowMs - cached.ts < IDEMPOTENCY_TTL_MS) {
        return res.status(cached.response.status).json(cached.response.body);
      }
    }

    // Caller allowlist removed to reduce operational friction. Rely on selector/target locks,
    // TTL, rate-limiting, and Rules Engine for abuse mitigation.

    // Deadline must not be too far in the future
    if (Number(deadline) > Math.floor(Date.now() / 1000) + MAX_TTL_SECONDS) {
      return res.status(400).json({ error: 'Deadline too far in the future' });
    }

    // Basic replay guard by signature hash (best-effort; on-chain Nonces prevents true replay)
    const sigKey = ethers.keccak256(ethers.toUtf8Bytes(signature));
    if (seenSignatures.has(sigKey)) {
      return res.status(409).json({ error: 'Duplicate signature' });
    }

    // External dummy checks (timeout-based) to contribute to a test score
    const breakdown = [];
    let totalScore = 0;

    async function checkUrl(name, url, weight) {
      if (!url) return;
      let status = 'ok';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), EXTERNAL_TIMEOUT_MS);
        const resp = await fetch(url, { signal: controller.signal, method: 'GET' });
        clearTimeout(timer);
        if (!resp.ok) {
          status = `http_${resp.status}`;
          totalScore += weight;
        }
      } catch (e) {
        status = 'timeout';
        totalScore += weight;
      }
      breakdown.push({ name, status, weight: status === 'ok' ? 0 : weight });
    }

    await Promise.all([
      checkUrl('external_check_a', EXTERNAL_CHECK_A_URL, EXTERNAL_CHECK_A_WEIGHT),
      checkUrl('external_check_b', EXTERNAL_CHECK_B_URL, EXTERNAL_CHECK_B_WEIGHT)
    ]);

    // Decision based on thresholds
    let decision = 'ALLOW';
    if (totalScore >= ENFORCE_DENY_AT) decision = 'DENY';
    else if (totalScore >= ENFORCE_WARN_AT) decision = 'WARN';

    if (decision === 'DENY' && !OBSERVATION_MODE) {
      const payload = { error: 'Denied by external checks', score: totalScore, decision, breakdown };
      if (idemKey) idemCache.set(idemKey, { ts: nowMs, bodyHash, response: { status: 400, body: payload } });
      return res.status(400).json(payload);
    }

    // Compose request object with normalized numeric types (ethers v6 accepts bigint/number/hex)
    const normalized = {
      from,
      to,
      value: BigInt(value),
      gas: BigInt(gas),
      deadline: BigInt(deadline),
      data,
      signature
    };

    // Verify request on-chain
    let valid = false;
    try {
      valid = await forwarderContract.verify(normalized);
    } catch (e) {
      console.warn('verify() threw:', e?.message || e);
    }
    if (!valid) {
      const payload = { error: 'Invalid meta-transaction request' };
      if (idemKey) idemCache.set(idemKey, { ts: nowMs, bodyHash, response: { status: 400, body: payload } });
      return res.status(400).json(payload);
    }

    // Sponsor budget window maintenance
    if (SPONSOR_MAX_TXS_PER_MIN > 0 || SPONSOR_MAX_GAS_PER_MIN > 0) {
      if (nowMs - sponsorWindowStart > SPONSOR_WINDOW_MS) {
        sponsorWindowStart = nowMs; sponsorTxs = 0; sponsorGas = 0n;
      }
      // Enforce tx budget
      if (SPONSOR_MAX_TXS_PER_MIN > 0 && sponsorTxs + 1 > SPONSOR_MAX_TXS_PER_MIN) {
        const payload = { error: 'Sponsor budget exceeded (txs per window)' };
        if (idemKey) idemCache.set(idemKey, { ts: nowMs, bodyHash, response: { status: 429, body: payload } });
        return res.status(429).json(payload);
      }
      // Enforce gas budget (approx by requested gas)
      if (SPONSOR_MAX_GAS_PER_MIN > 0 && sponsorGas + BigInt(gas) > BigInt(SPONSOR_MAX_GAS_PER_MIN)) {
        const payload = { error: 'Sponsor budget exceeded (gas per window)' };
        if (idemKey) idemCache.set(idemKey, { ts: nowMs, bodyHash, response: { status: 429, body: payload } });
        return res.status(429).json(payload);
      }
    }

    // Submit execute with correct value override
    const tx = await forwarderContract.execute(normalized, { value: normalized.value });
    // Update sponsor counters after submission
    if (SPONSOR_MAX_TXS_PER_MIN > 0 || SPONSOR_MAX_GAS_PER_MIN > 0) {
      sponsorTxs += 1;
      sponsorGas += BigInt(gas);
    }
    // Track signature as used for a short time window
    seenSignatures.set(sigKey, Date.now());
    // Garbage collect stale entries
    if (seenSignatures.size > 2048) {
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const [k, ts] of seenSignatures.entries()) {
        if (ts < cutoff) seenSignatures.delete(k);
      }
    }
    const successBody = { txHash: tx.hash, score: totalScore, decision, breakdown };
    if (idemKey) idemCache.set(idemKey, { ts: nowMs, bodyHash, response: { status: 200, body: successBody } });
    return res.json(successBody);
  } catch (err) {
    console.error('Relay error:', err);
    return res.status(500).json({ error: err?.reason || err?.message || 'Relay failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Relayer listening on http://localhost:${PORT} (${NETWORK_LABEL})`);
});
