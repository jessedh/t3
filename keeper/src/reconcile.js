"use strict";

const { deriveNets, deriveLiens, canonicalPair } = require("./settlement-math");
const { CycleStateLabel } = require("./abi");

// Wave 6C reconciliation. Cross-checks indexer-derived bilateral nets/liens against on-chain
// getters and the reserve encumbrance, for a single cycle. See RECONCILIATION-SPEC.md.
//
// PRECONDITION (load-bearing): the contract enforces one cycle in flight (CycleAlreadyActive),
// so reimbursementEncumbered[bank] is attributable to the single active/failed cycle. Invariant 4a
// is only valid under that precondition.

/**
 * @param chain    makeChain(...) instance
 * @param cycleId  bytes32 cycle to reconcile
 * @param indexerObligations  rows from /banking/settlement-obligations (obligationId, issuers, amount)
 * @returns {{cycleId, status, ok, drift, checks: {name,ok,detail}[]}}
 */
async function reconcileCycle(chain, cycleId, indexerObligations) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const cycle = await chain.getCycle(cycleId);
  const status = Number(cycle.status);
  const statusLabel = CycleStateLabel[status] || String(status);

  // Enrich indexer obligations with on-chain truth and filter to this cycle.
  const cycleObs = [];
  for (const row of indexerObligations) {
    let on;
    try {
      on = await chain.getObligation(row.obligationId);
    } catch (e) {
      add("obligation-onchain-read", false, `${row.obligationId}: ${e.message}`);
      continue;
    }
    if (on.cycleId.toLowerCase() !== cycleId.toLowerCase()) continue;
    // indexer-vs-chain consistency (catches indexer drift)
    const consistent =
      on.outgoingIssuer.toLowerCase() === row.outgoingIssuer.toLowerCase() &&
      on.receivingIssuer.toLowerCase() === row.receivingIssuer.toLowerCase() &&
      on.amount.toString() === BigInt(row.amount).toString();
    if (!consistent) {
      add("indexer-chain-consistency", false,
        `${row.obligationId}: indexer(${row.outgoingIssuer}->${row.receivingIssuer}:${row.amount}) != chain(${on.outgoingIssuer}->${on.receivingIssuer}:${on.amount})`);
    }
    cycleObs.push({
      obligationId: row.obligationId,
      outgoingIssuer: on.outgoingIssuer,
      receivingIssuer: on.receivingIssuer,
      amount: on.amount.toString(),
    });
  }
  add("obligation-count", true, `${cycleObs.length} obligations for cycle (status=${statusLabel})`);

  // Invariant 1: per-pair signed net matches getPairNet.
  const nets = deriveNets(cycleObs);
  for (const [k, expected] of nets) {
    const [lo, hi] = k.split("|");
    const onchain = await chain.getPairNet(cycleId, lo, hi);
    add("pair-net", onchain === expected, `pair ${lo}|${hi}: chain=${onchain} expected=${expected}`);
  }

  // Invariant 2: per-bank lien matches getCycleLien.
  const liens = deriveLiens(cycleObs);
  const banks = new Set();
  for (const o of cycleObs) { banks.add(o.outgoingIssuer.toLowerCase()); banks.add(o.receivingIssuer.toLowerCase()); }
  for (const bank of banks) {
    const expected = liens.get(bank) ?? 0n;
    const onchain = await chain.getCycleLien(cycleId, bank);
    add("cycle-lien", onchain === expected, `bank ${bank}: chain=${onchain} expected=${expected}`);
  }

  // Invariant 4a: sum of this cycle's liens per bank == reimbursementEncumbered (single-cycle precondition).
  // Invariant 4b: reimbursementEncumbered <= effectiveReserve (solvency).
  for (const bank of banks) {
    const expected = liens.get(bank) ?? 0n;
    const enc = await chain.getReimbursementEncumbered(bank);
    add("lien-encumbrance", enc === expected,
      `bank ${bank}: reimbursementEncumbered=${enc} cycleLienSum=${expected} (valid only if one cycle in flight)`);
    const eff = await chain.getEffectiveReserve(bank);
    add("solvency", enc <= eff, `bank ${bank}: reimbursementEncumbered=${enc} effectiveReserve=${eff}`);
  }

  // Invariant 6: a FAILED cycle preserves liens (ADR-003) — they must NOT be zeroed.
  if (statusLabel === "FAILED") {
    let anyLien = false;
    for (const bank of banks) {
      const onchain = await chain.getCycleLien(cycleId, bank);
      if (onchain > 0n) anyLien = true;
    }
    add("failed-lien-preserved", banks.size === 0 || anyLien,
      "failed cycle must retain bilateral-net liens (secured reimbursement obligation)");
  }

  const ok = checks.every((c) => c.ok);
  const drift = checks.some((c) => !c.ok && ["pair-net", "cycle-lien", "indexer-chain-consistency"].includes(c.name));
  return { cycleId, status: statusLabel, ok, drift, checks };
}

module.exports = { reconcileCycle, canonicalPair };
