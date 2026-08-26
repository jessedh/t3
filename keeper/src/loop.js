"use strict";

const { ethers } = require("ethers");
const { computeObligationRoot } = require("./settlement-math");
const { reconcileCycle } = require("./reconcile");
const { fetchAllObligations } = require("./indexer-client");
const { CycleStateLabel } = require("./abi");

const ZERO = ethers.ZeroHash;

/**
 * Pure decision function (unit-testable). Given the current routing cycle and the status of the
 * last cycle the keeper drove, decide the next keeper action.
 *  - cid != 0            -> "rollover" (steady state; atomic propose+open, no blackout)
 *  - cid == 0, last FAILED -> "halt"   (MF-5: never auto-open after a failure; human must ack)
 *  - cid == 0, otherwise   -> "open"   (bootstrap or clean reopen after a finalize)
 */
function decideAction(currentCycleId, lastCycleStatusLabel) {
  if (currentCycleId && currentCycleId !== ZERO) return "rollover";
  if (lastCycleStatusLabel === "FAILED") return "halt";
  return "open";
}

async function obligationIdsForCycle(chain, cycleId, indexerObligations) {
  const ids = [];
  for (const row of indexerObligations) {
    try {
      const on = await chain.getObligation(row.obligationId);
      if (on.cycleId.toLowerCase() === cycleId.toLowerCase()) ids.push(row.obligationId);
    } catch (_) { /* skip unreadable */ }
  }
  return ids;
}

/**
 * One keeper iteration. Returns a status object (also used by health). Throws on chain error so
 * the caller can apply backoff.
 */
async function tick(ctx) {
  const { chain, cfg, state, logger } = ctx;
  const cid = await chain.getCurrentCycleId();

  let lastStatus = null;
  if (state.lastCycleId) {
    try { lastStatus = CycleStateLabel[Number((await chain.getCycle(state.lastCycleId)).status)]; }
    catch (_) { lastStatus = null; }
  }

  const action = decideAction(cid, lastStatus);
  state.lastAction = action;
  state.lastTickAt = Math.floor(Date.now() / 1000);

  if (action === "halt") {
    state.halted = true;
    state.haltReason = `last cycle ${state.lastCycleId} FAILED — manual ack required (run: keeper open)`;
    logger.error(`[keeper] HALT: ${state.haltReason}`);
    return { action, halted: true, reason: state.haltReason };
  }

  if (action === "open") {
    const next = await chain.write.openSettlementCycle(cfg.cycleType);
    const rcpt = await next.wait();
    const newCid = await chain.getCurrentCycleId();
    state.lastCycleId = newCid;
    logger.info(`[keeper] opened cycle ${newCid} (tx ${rcpt.hash})`);
    return { action, cycleId: newCid };
  }

  // action === "rollover": reconcile before committing a root (MF-4 abort-on-drift).
  const indexerObs = await fetchAllObligations(cfg.indexerUrl).catch((e) => {
    logger.warn(`[keeper] indexer unreachable: ${e.message}`);
    return [];
  });
  const recon = await reconcileCycle(chain, cid, indexerObs);
  state.lastRecon = { cycleId: cid, ok: recon.ok, drift: recon.drift, at: state.lastTickAt };
  if (recon.drift) {
    state.halted = true;
    state.haltReason = `reconciliation drift on cycle ${cid} — refusing to commit obligationRoot`;
    logger.error(`[keeper] HALT: ${state.haltReason}`);
    return { action: "halt", halted: true, reason: state.haltReason, recon };
  }

  const ids = await obligationIdsForCycle(chain, cid, indexerObs);
  const root = computeObligationRoot(ids);
  const deadline = Math.floor(Date.now() / 1000) + cfg.confirmWindowSec;
  const tx = await chain.write.proposeAndRolloverSettlementCycle(cid, root, deadline);
  const rcpt = await tx.wait();
  const newCid = await chain.getCurrentCycleId();
  state.lastCycleId = newCid;
  logger.info(`[keeper] rolled cycle ${cid} -> ${newCid} root=${root} (tx ${rcpt.hash})`);
  return { action, proposedCycle: cid, nextCycle: newCid, root };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runLoop(ctx) {
  const { cfg, state, logger } = ctx;
  let backoff = 1;
  while (!state.stop && !state.halted) {
    try {
      await tick(ctx);
      backoff = 1;
      await sleep(cfg.cycleWindowSec * 1000);
    } catch (e) {
      logger.error(`[keeper] tick error: ${e.message}; backoff ${backoff}s`);
      state.lastError = e.message;
      await sleep(Math.min(backoff, cfg.maxBackoffSec) * 1000);
      backoff = Math.min(backoff * 2, cfg.maxBackoffSec);
    }
  }
  logger.info(`[keeper] loop exited (stop=${state.stop} halted=${state.halted})`);
}

module.exports = { decideAction, tick, runLoop };
