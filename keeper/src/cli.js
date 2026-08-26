"use strict";

const { ethers } = require("ethers");
const { loadConfig } = require("./config");
const { makeChain } = require("./chain");
const { reconcileCycle } = require("./reconcile");
const { fetchAllObligations } = require("./indexer-client");
const { CycleStateLabel } = require("./abi");

// Manual keeper/operator commands. Liveness automation lives in the daemon (index.js); the
// settlement-decision actions (confirm/fund/finalize/fail) are deliberately manual here.
async function run(argv) {
  const [cmd, ...args] = argv;
  const cfg = loadConfig();
  const chain = makeChain(cfg);

  switch (cmd) {
    case "status": {
      const cid = await chain.getCurrentCycleId();
      const active = await chain.isSettlementModelActive();
      let label = "(none)";
      if (cid && cid !== ethers.ZeroHash) label = CycleStateLabel[Number((await chain.getCycle(cid)).status)];
      console.log(JSON.stringify({ settlementModelActive: active, currentCycleId: cid, status: label }, null, 2));
      break;
    }
    case "reconcile": {
      const cid = args[0] || (await chain.getCurrentCycleId());
      if (!cid || cid === ethers.ZeroHash) { console.error("no cycle to reconcile"); process.exit(1); }
      const obs = await fetchAllObligations(cfg.indexerUrl);
      const result = await reconcileCycle(chain, cid, obs);
      console.log(JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
      process.exit(result.ok ? 0 : 1);
      break;
    }
    case "open": {
      const tx = await chain.write.openSettlementCycle(cfg.cycleType);
      const r = await tx.wait();
      console.log(`opened cycle, tx ${r.hash}, currentCycleId=${await chain.getCurrentCycleId()}`);
      break;
    }
    case "confirm": {
      const tx = await chain.write.confirmSettlementCycle(args[0]);
      console.log(`confirm tx ${(await tx.wait()).hash}`);
      break;
    }
    case "finalize": {
      const tx = await chain.write.finalizeSettlementCycle(args[0]);
      console.log(`finalize tx ${(await tx.wait()).hash}`);
      break;
    }
    case "fail": {
      const tx = await chain.write.failSettlementCycle(args[0], args[1] || ethers.ZeroHash);
      console.log(`fail tx ${(await tx.wait()).hash}`);
      break;
    }
    default:
      console.log("usage: node src/cli.js <status|reconcile [cycleId]|open|confirm <cycleId>|finalize <cycleId>|fail <cycleId> [exceptionRoot]>");
      process.exit(cmd ? 1 : 0);
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { run };
