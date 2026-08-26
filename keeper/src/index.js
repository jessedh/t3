"use strict";

const { loadConfig } = require("./config");
const { makeChain } = require("./chain");
const { runLoop } = require("./loop");
const { startHealthServer } = require("./health");

const logger = console;

// Keeper daemon. Liveness only: it keeps a settlement cycle open via atomic rollover. The trusted
// Fedwire attestor (recordFunding) and finalize stay manual (see cli.js / SETTLEMENT-KEEPER-RUNBOOK).
async function main() {
  const cfg = loadConfig();

  // ── Gate 1: explicit enable flag (refuse to poke a gated-off system by default). ──
  if (!cfg.enabled) {
    logger.error("[keeper] KEEPER_ENABLED is not 'true' — refusing to start. This is intentional " +
      "for the counsel-pending preview. Set KEEPER_ENABLED=true only on a network where " +
      "settlementModelActive is ON and you operate the keeper key.");
    process.exit(2);
  }
  if (!cfg.diamondAddress) { logger.error("[keeper] KEEPER_DIAMOND_ADDRESS required"); process.exit(2); }
  if (!cfg.privateKey) { logger.error("[keeper] KEEPER_PRIVATE_KEY required"); process.exit(2); }

  const chain = makeChain(cfg);

  // ── Gate 2: on-chain settlement model must be active. ──
  const active = await chain.isSettlementModelActive();
  if (!active) {
    logger.error("[keeper] isSettlementModelActive() == false on-chain — refusing to start " +
      "(nothing to keep alive). Activate the gate via admin first.");
    process.exit(2);
  }

  // ── Gate 3: keeper key must hold SETTLEMENT_KEEPER_ROLE. ──
  const hasRole = await chain.keeperHasRole();
  if (!hasRole) {
    logger.error(`[keeper] ${chain.keeperAddress} does not hold SETTLEMENT_KEEPER_ROLE — refusing to start.`);
    process.exit(2);
  }

  const state = { stop: false, halted: false };
  startHealthServer(cfg, state, chain, logger);

  const shutdown = () => { logger.info("[keeper] shutting down"); state.stop = true; };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info(`[keeper] starting as ${chain.keeperAddress}; cycleWindow=${cfg.cycleWindowSec}s`);
  await runLoop({ chain, cfg, state, logger });
}

if (require.main === module) {
  main().catch((e) => { logger.error(e); process.exit(1); });
}

module.exports = { main };
