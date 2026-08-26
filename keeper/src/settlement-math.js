"use strict";

// Pure settlement math mirroring contracts/lib/SettlementCycleLib.sol.
// No chain / no IO so it is unit-testable. All amounts are BigInt (18-decimal wei).

const { ethers } = require("ethers");

/** Canonical ordered pair (lo, hi) by address, matching the contract (a < b). */
function canonicalPair(a, b) {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la < lb ? [la, lb] : [lb, la];
}

const pairKey = (lo, hi) => `${lo}|${hi}`;

/**
 * Derive signed bilateral nets from obligations.
 * Contract convention: pairNet[lo][hi] > 0 means `lo` owes `hi`.
 * @param {{outgoingIssuer:string,receivingIssuer:string,amount:bigint|string}[]} obligations
 * @returns {Map<string, bigint>} keyed by `${lo}|${hi}` -> signed net (lo owes hi if > 0)
 */
function deriveNets(obligations) {
  const nets = new Map();
  for (const o of obligations) {
    const [lo, hi] = canonicalPair(o.outgoingIssuer, o.receivingIssuer);
    const amt = BigInt(o.amount);
    const k = pairKey(lo, hi);
    const prev = nets.get(k) ?? 0n;
    // outgoing owes receiving: if outgoing == lo, lo owes hi more (+), else (-).
    nets.set(k, o.outgoingIssuer.toLowerCase() === lo ? prev + amt : prev - amt);
  }
  return nets;
}

/** Signed net for an unordered pair (positive = `a` owes `b`), matching pairNetOf. */
function pairNetOf(nets, a, b) {
  const [lo, hi] = canonicalPair(a, b);
  const p = nets.get(pairKey(lo, hi)) ?? 0n;
  return a.toLowerCase() === lo ? p : -p;
}

const pos = (x) => (x > 0n ? x : 0n);

/**
 * Per-bank bilateral-net lien = sum of the bank's positive net debits across pairs.
 * Mirrors _applyLienDelta / lienOf: lo contributes pos(net), hi contributes pos(-net).
 * @returns {Map<string, bigint>} bank -> lien
 */
function deriveLiens(obligations) {
  const nets = deriveNets(obligations);
  const liens = new Map();
  const add = (bank, v) => liens.set(bank, (liens.get(bank) ?? 0n) + v);
  for (const [k, net] of nets) {
    const [lo, hi] = k.split("|");
    add(lo, pos(net));
    add(hi, pos(-net));
  }
  // Drop zero entries so equality checks against on-chain (which only encumbers > 0) are clean.
  for (const [bank, v] of [...liens]) if (v === 0n) liens.delete(bank);
  return liens;
}

/**
 * Deterministic obligation root the keeper commits on propose. The contract treats the root as
 * an opaque commitment (never recomputed on-chain), so any deterministic function the keeper and
 * member banks agree on is valid. We use keccak256 over the ascending-sorted obligationIds.
 * Empty cycle -> bytes32(0).
 * @param {string[]} obligationIds bytes32 hex strings
 */
function computeObligationRoot(obligationIds) {
  if (!obligationIds || obligationIds.length === 0) return ethers.ZeroHash;
  const sorted = [...obligationIds].map((x) => x.toLowerCase()).sort();
  return ethers.keccak256(ethers.concat(sorted));
}

module.exports = {
  canonicalPair,
  deriveNets,
  pairNetOf,
  deriveLiens,
  computeObligationRoot,
};
