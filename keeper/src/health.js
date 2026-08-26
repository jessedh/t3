"use strict";

const express = require("express");

// Minimal health endpoint for monitoring (cycle id, last rollover, lag, reconciliation status).
function startHealthServer(cfg, state, chain, logger) {
  const app = express();
  app.get("/health", async (_req, res) => {
    let currentCycleId = null;
    let active = null;
    try {
      currentCycleId = await chain.getCurrentCycleId();
      active = await chain.isSettlementModelActive();
    } catch (e) {
      return res.status(503).json({ status: "degraded", error: e.message, state });
    }
    const now = Math.floor(Date.now() / 1000);
    res.json({
      status: state.halted ? "halted" : "ok",
      haltReason: state.haltReason || null,
      settlementModelActive: active,
      currentCycleId,
      lastAction: state.lastAction || null,
      lastCycleId: state.lastCycleId || null,
      lastTickAt: state.lastTickAt || null,
      lagSec: state.lastTickAt ? now - state.lastTickAt : null,
      lastRecon: state.lastRecon || null,
      lastError: state.lastError || null,
    });
  });
  const server = app.listen(cfg.healthPort, () => logger.info(`[keeper] health on :${cfg.healthPort}/health`));
  return server;
}

module.exports = { startHealthServer };
