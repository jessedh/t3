const { expect } = require('chai');
const { ethers } = require('hardhat');
require('dotenv').config();
const { createBesuLocalRpcUrlResolver } = require('../../scripts/lib/env');

const FORWARDER_ABI = [
  'function nonces(address from) external view returns (uint256)'
];

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)'
];

const fetchFn = global.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)));

function env(name, def) { return process.env[name] ?? def; }

describe('E2E: Relayer guardrails and responses', function () {
  this.timeout(180_000);

  const getBesuLocalRpcUrl = createBesuLocalRpcUrlResolver({
    env: process.env,
    warn: console.warn,
  });
  const RELAYER_URL = env('RELAYER_URL', 'http://localhost:8787/relay');
  const RELAYER_HEALTH_URL = env('RELAYER_HEALTH_URL', 'http://localhost:8787/health');

  let provider, chainId, ttlMax;
  let forwarderAddress, diamondAddress, name, version;
  let wallet, userAddress;
  let allowedSelectors, warnAt, denyAt, observation, extA, extB;
  let enforcedDeny = false;
  let sponsorBudget;

  before(async function () {
    if (!process.env.RUN_E2E_RELAY) {
      this.skip();
      return;
    }
    provider = new ethers.JsonRpcProvider(getBesuLocalRpcUrl());
    const net = await provider.getNetwork();
    chainId = Number(net.chainId);

    // Signer
    let pk = (env('E2E_PRIVATE_KEY', env('PRIVATE_KEY', '')) || '').replace(/^"|"$/g, '');
    if (pk && pk.startsWith('0x')) pk = pk.slice(2);
    if (!pk) this.skip?.();
    wallet = new ethers.Wallet('0x' + pk, provider);
    userAddress = await wallet.getAddress();

    // Health
    const r = await fetchFn(RELAYER_HEALTH_URL, { method: 'GET' });
    if (!r.ok) this.skip?.();
    const h = await r.json();
    forwarderAddress = h.forwarder;
    diamondAddress = h.target;
    ttlMax = Number(h.ttlMax || 300);
    allowedSelectors = h.allowedSelectors || [];
    warnAt = Number(h.warnAt || 400);
    denyAt = Number(h.denyAt || 800);
    observation = !!h.observation;
    extA = h.extA || { configured: false, weight: 0 };
    extB = h.extB || { configured: false, weight: 0 };
    enforcedDeny = !observation && ((extA.configured ? Number(extA.weight) : 0) + (extB.configured ? Number(extB.weight) : 0)) >= denyAt;
    sponsorBudget = h.sponsorBudget || null;
  });

  function domain() {
    return { name: 'T3Forwarder', version: '1', chainId, verifyingContract: forwarderAddress };
  }
  const types = {
    ForwardRequest: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'gas', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint48' },
      { name: 'data', type: 'bytes' }
    ]
  };

  async function signRequest(to, data, gasOverride) {
    const fwd = new ethers.Contract(forwarderAddress, FORWARDER_ABI, provider);
    const nonce = await fwd.nonces(userAddress);
    const deadline = Math.floor(Date.now() / 1000) + Math.min(ttlMax, 300) - 10;
    const gas = gasOverride ?? 500000;
    const req = { from: userAddress, to, value: 0, gas, nonce, deadline, data };
    const signature = await wallet.signTypedData(domain(), types, req);
    return { req: { from: userAddress, to, value: 0, gas, deadline, data, signature }, raw: req };
  }

  it('health exposes config and addresses', async () => {
    const r = await fetchFn(RELAYER_HEALTH_URL, { method: 'GET' });
    expect(r.ok).to.eq(true);
    const h = await r.json();
    expect(h).to.have.property('forwarder');
    expect(h).to.have.property('target');
    expect(h).to.have.property('ttlMax');
    expect(h).to.have.property('allowedSelectors');
  });

  it('rejects wrong target', async () => {
    const data = new ethers.Interface(ERC20_ABI).encodeFunctionData('transfer', [userAddress, 1n]);
    const { req } = await signRequest(ethers.ZeroAddress, data);
    const resp = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forwarder: forwarderAddress, request: req }) });
    expect(resp.status).to.equal(400);
  });

  it('rejects disallowed selector', async () => {
    // Use a fake selector; still must be hex string
    const badData = '0x12345678';
    const { req } = await signRequest(diamondAddress, badData);
    const resp = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forwarder: forwarderAddress, request: req }) });
    expect(resp.status).to.equal(400);
  });

  it('rejects expired or far-future deadlines', async () => {
    const iface = new ethers.Interface(ERC20_ABI);
    const data = iface.encodeFunctionData('transfer', [userAddress, 1n]);
    // Expired: craft a request with past deadline by overriding gas to reuse signer helper
    const fwd = new ethers.Contract(forwarderAddress, FORWARDER_ABI, provider);
    const nonce = await fwd.nonces(userAddress);
    const past = Math.floor(Date.now() / 1000) - 60;
    const reqPastRaw = { from: userAddress, to: diamondAddress, value: 0, gas: 500000, nonce, deadline: past, data };
    const sigPast = await wallet.signTypedData(domain(), types, reqPastRaw);
    // Exclude nonce from POST body per forwarder.execute argument shape
    const reqPast = { from: userAddress, to: diamondAddress, value: 0, gas: 500000, deadline: past, data, signature: sigPast };
    const r1 = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forwarder: forwarderAddress, request: reqPast }) });
    expect(r1.status).to.equal(400);

    // Far future: > ttlMax
    const future = Math.floor(Date.now() / 1000) + ttlMax + 600;
    const reqFutureRaw = { ...reqPastRaw, deadline: future };
    const sigFuture = await wallet.signTypedData(domain(), types, reqFutureRaw);
    const reqFuture = { from: userAddress, to: diamondAddress, value: 0, gas: 500000, deadline: future, data, signature: sigFuture };
    const r2 = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forwarder: forwarderAddress, request: reqFuture }) });
    expect(r2.status).to.equal(400);
  });

  it('rejects tampered signature (verify fails)', async () => {
    const data = new ethers.Interface(ERC20_ABI).encodeFunctionData('transfer', [userAddress, 1n]);
    const { req, raw } = await signRequest(diamondAddress, data);
    // Tamper gas after signing
    const bad = { ...req, gas: req.gas + 1 };
    const resp = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forwarder: forwarderAddress, request: bad }) });
    expect(resp.status).to.equal(400);
  });

  it('idempotency returns identical response for the same key', async function () {
    const data = new ethers.Interface(ERC20_ABI).encodeFunctionData('transfer', [userAddress, 1n]);
    const { req } = await signRequest(diamondAddress, data);
    const key = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = JSON.stringify({ forwarder: forwarderAddress, request: req });
    const r1 = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key }, body: payload });
    const b1 = await r1.text();
    const r2 = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key }, body: payload });
    const b2 = await r2.text();
    expect(r2.status).to.equal(r1.status);
    expect(b2).to.equal(b1);
  });

  it('enforces sponsor tx budget when configured (may skip)', async function () {
    if (!sponsorBudget || !sponsorBudget.maxTxsPerWindow || Number(sponsorBudget.maxTxsPerWindow) < 1) return this.skip();
    // Attempt two valid requests quickly to cross the tx budget if set to 1
    const data = new ethers.Interface(ERC20_ABI).encodeFunctionData('transfer', [userAddress, 1n]);
    const { req } = await signRequest(diamondAddress, data);
    const p = JSON.stringify({ forwarder: forwarderAddress, request: req });
    const k1 = `e2e-b1-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const r1 = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': k1 }, body: p });
    // Second request (new idempotency key) should be rate-limited by sponsor budget if threshold==1
    const k2 = `e2e-b2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const r2 = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': k2 }, body: p });
    if (Number(sponsorBudget.maxTxsPerWindow) === 1) {
      expect([429,400]).to.include(r2.status); // 429 expected; allow 400 if external DENY interferes
    } else {
      this.skip();
    }
  });

  it('rejects duplicate signature (replay)', async function () {
    if (enforcedDeny) return this.skip();
    const data = new ethers.Interface(ERC20_ABI).encodeFunctionData('transfer', [userAddress, 1n]);
    const { req } = await signRequest(diamondAddress, data);
    const r1 = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forwarder: forwarderAddress, request: req }) });
    // Do not wait for chain, just replay immediately
    const r2 = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forwarder: forwarderAddress, request: req }) });
    expect(r2.status).to.equal(409);
  });

  it('enforces DENY when observation=false and score>=denyAt (if possible)', async function () {
    const possible = (extA.configured ? Number(extA.weight) : 0) + (extB.configured ? Number(extB.weight) : 0);
    if (!(possible >= denyAt && observation === false)) return this.skip();
    const data = new ethers.Interface(ERC20_ABI).encodeFunctionData('transfer', [userAddress, 1n]);
    const { req } = await signRequest(diamondAddress, data);
    const resp = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forwarder: forwarderAddress, request: req }) });
    expect(resp.status).to.equal(400);
  });

  it('allows WARN when warnAt<=score<denyAt (if possible)', async function () {
    const a = extA.configured ? Number(extA.weight) : 0;
    const b = extB.configured ? Number(extB.weight) : 0;
    const possible = a + b;
    const hasWarn = possible >= warnAt && possible < denyAt;
    if (!hasWarn) return this.skip();
    const data = new ethers.Interface(ERC20_ABI).encodeFunctionData('transfer', [userAddress, 1n]);
    const { req } = await signRequest(diamondAddress, data);
    const resp = await fetchFn(RELAYER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forwarder: forwarderAddress, request: req }) });
    expect(resp.status).to.equal(200);
    const body = await resp.json();
    expect(body.decision).to.equal('WARN');
  });
});
