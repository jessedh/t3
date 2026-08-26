const { expect } = require('chai');
const { ethers } = require('hardhat');
const fs = require('fs');
require('dotenv').config();
const { createBesuLocalRpcUrlResolver } = require('../../scripts/lib/env');

// Node 18+ has global fetch; fallback if needed
const fetchFn = global.fetch || ((...args) => import('node-fetch').then(({default: f}) => f(...args)));

// Minimal ABIs
const FORWARDER_ABI = [
  'function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) external payable',
  'function nonces(address from) external view returns (uint256)',
  'function verify((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) external view returns (bool)',
  'function NAME() external view returns (string)',
  'function VERSION() external view returns (string)'
];
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address) view returns (uint256)'
];

// Helpers
function env(name, def) { return process.env[name] ?? def; }
function readForwarderAddressFile() {
  try { return fs.readFileSync('.forwarder_address', 'utf8').trim(); } catch { return ''; }
}

describe('E2E: Gasless relay via local relayer', function () {
  this.timeout(180_000);

  const getBesuLocalRpcUrl = createBesuLocalRpcUrlResolver({
    env: process.env,
    warn: console.warn,
  });
  const RELAYER_URL = env('RELAYER_URL', 'http://localhost:8787/relay');
  const RELAYER_HEALTH_URL = env('RELAYER_HEALTH_URL', 'http://localhost:8787/health');

  let provider, chainId, ttlMax;
  let forwarderAddress, diamondAddress;
  let wallet, userAddress;
  let enforcedDeny = false;

  before(async function () {
    if (!process.env.RUN_E2E_RELAY) {
      this.skip();
      return;
    }
    // Basic env intake
    forwarderAddress = env('FORWARDER_ADDRESS', readForwarderAddressFile());
    diamondAddress = env('DIAMOND_ADDRESS', env('ALLOWED_TO', ''));

    // Provider
    provider = new ethers.JsonRpcProvider(getBesuLocalRpcUrl());
    const net = await provider.getNetwork();
    chainId = Number(net.chainId);

    // Wallet for signing EIP-712 (user)
    // Prefer E2E_PRIVATE_KEY if provided; else fall back to PRIVATE_KEY
    let pk = env('E2E_PRIVATE_KEY', env('PRIVATE_KEY', '')).replace(/^"|"$/g, '');
    if (pk && pk.startsWith('0x')) pk = pk.slice(2);
    if (!pk) this.skip?.();
    wallet = new ethers.Wallet('0x' + pk, provider);
    userAddress = await wallet.getAddress();

    // Relayer health & TTL
    try {
      const r = await fetchFn(RELAYER_HEALTH_URL, { method: 'GET' });
      if (!r.ok) throw new Error('health not ok');
      const info = await r.json();
      ttlMax = Number(info.ttlMax || 300);
      const a = info.extA?.configured ? Number(info.extA.weight) : 0;
      const b = info.extB?.configured ? Number(info.extB.weight) : 0;
      const denyAt = Number(info.denyAt || 800);
      const observation = !!info.observation;
      enforcedDeny = !observation && (a + b) >= denyAt;
    } catch (e) {
      // If no relayer, skip the suite with a helpful hint
      this.skip?.();
    }
  });

  it('posts a signed meta-tx to /relay and confirms on-chain', async function () {
    if (enforcedDeny) return this.skip();
    // Sanity checks
    expect(ethers.isAddress(forwarderAddress), 'FORWARDER_ADDRESS missing/invalid').to.equal(true);
    expect(ethers.isAddress(diamondAddress), 'DIAMOND_ADDRESS/ALLOWED_TO missing/invalid').to.equal(true);

    // Contracts
    const forwarder = new ethers.Contract(forwarderAddress, FORWARDER_ABI, provider);
    const t3 = new ethers.Contract(diamondAddress, ERC20_ABI, provider);

    // Determine EIP-712 domain name/version if available
    let name = 'T3Forwarder', version = '1';
    try { name = await forwarder.NAME(); } catch {}
    try { version = await forwarder.VERSION(); } catch {}

    const domain = {
      name,
      version,
      chainId,
      verifyingContract: forwarderAddress
    };

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

    // Build calldata for ERC20.transfer — use minimal non-zero amount (1 wei)
    const data = new ethers.Interface(ERC20_ABI).encodeFunctionData('transfer', [userAddress, 1n]);

    // Get nonce from forwarder
    const nonce = await forwarder.nonces(userAddress);

    // Deadline within relayer TTL
    const ttl = Math.max(60, Math.min(Number(ttlMax || 300), 600));
    const deadline = Math.floor(Date.now() / 1000) + ttl - 10;

    const forSigning = {
      from: userAddress,
      to: diamondAddress,
      value: 0,
      gas: 500000,
      nonce: nonce,
      deadline,
      data
    };

    const signature = await wallet.signTypedData(domain, types, forSigning);

    const request = {
      from: userAddress,
      to: diamondAddress,
      value: 0,
      gas: 500000,
      deadline,
      data,
      signature
    };

    // POST to relayer
    const resp = await fetchFn(RELAYER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forwarder: forwarderAddress, request })
    });

    const text = await resp.text();
    expect(resp.status, `Relayer error: ${text}`).to.equal(200);
    const body = JSON.parse(text);
    expect(body).to.have.property('txHash');

    // Wait for tx confirmation
    const receipt = await provider.waitForTransaction(body.txHash);
    expect(receipt).to.have.property('status');
    expect(Number(receipt.status), 'Transaction failed/reverted on-chain').to.equal(1);
  });
});
