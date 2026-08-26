"use strict";

require("dotenv").config();

function loadConfig() {
  const cfg = {
    rpcUrl: process.env.KEEPER_RPC_URL || "http://127.0.0.1:8545",
    diamondAddress: process.env.KEEPER_DIAMOND_ADDRESS || "",
    privateKey: process.env.KEEPER_PRIVATE_KEY || "",
    indexerUrl: process.env.KEEPER_INDEXER_URL || "http://127.0.0.1:42069",
    // steady-state cadence + member confirmation window (seconds)
    cycleWindowSec: parseInt(process.env.KEEPER_CYCLE_WINDOW_SEC || "300", 10),
    confirmWindowSec: parseInt(process.env.KEEPER_CONFIRM_WINDOW_SEC || "3600", 10),
    cycleType: parseInt(process.env.KEEPER_CYCLE_TYPE || "0", 10),
    healthPort: parseInt(process.env.KEEPER_HEALTH_PORT || "8799", 10),
    // double activation gate (see SETTLEMENT-KEEPER-RUNBOOK)
    enabled: String(process.env.KEEPER_ENABLED || "false").toLowerCase() === "true",
    // loop backoff
    maxBackoffSec: parseInt(process.env.KEEPER_MAX_BACKOFF_SEC || "60", 10),
  };
  return cfg;
}

module.exports = { loadConfig };
