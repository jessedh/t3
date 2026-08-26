// scripts/check-contract-size.js
//
// Contract-size gate for the manifest facets.
//  - HARD FAIL (exit 1) if any facet exceeds the consortium Besu contractSizeLimit
//    (free-gas QBFT genesis sets contractSizeLimit = 49152; see scripts/besu-genesis-local.sh).
//  - WARN (exit 0) for facets over the EIP-170 standard limit (24576) — these are deployable
//    on the consortium but NOT on a standard EVM; tracked for the planned facet-split wave.
//
// Run `npx hardhat compile` first. Usage: node scripts/check-contract-size.js

const fs = require("fs");
const path = require("path");
const { FACETS } = require("./lib/facet-manifest");

const EIP170 = 24576;                       // standard EVM deployed-code cap
const CONSORTIUM_LIMIT = 49152;             // must match genesis config.contractSizeLimit
const artifactsDir = path.resolve(__dirname, "../artifacts/contracts");

function deployedSize(name) {
  const p = path.join(artifactsDir, `facets/${name}.sol/${name}.json`);
  if (!fs.existsSync(p)) return null;
  const art = JSON.parse(fs.readFileSync(p, "utf8"));
  const obj = (art.deployedBytecode && art.deployedBytecode.object) || art.deployedBytecode || "0x";
  const hex = obj.startsWith("0x") ? obj.slice(2) : obj;
  return hex.length / 2;
}

let hardFail = [];
let warn = [];
let missing = [];

for (const f of FACETS) {
  const size = deployedSize(f.name);
  if (size == null) { missing.push(f.name); continue; }
  if (size > CONSORTIUM_LIMIT) hardFail.push({ name: f.name, size });
  else if (size > EIP170) warn.push({ name: f.name, size });
}

const kib = (b) => (b / 1024).toFixed(3);

if (missing.length) {
  console.warn(`⚠️  no artifact for: ${missing.join(", ")} (run npx hardhat compile)`);
}
if (warn.length) {
  console.warn(`⚠️  over EIP-170 (24 KiB) — deployable on the free-gas consortium (contractSizeLimit=${kib(CONSORTIUM_LIMIT)} KiB), tracked for the facet-split wave:`);
  for (const w of warn) console.warn(`    - ${w.name}: ${kib(w.size)} KiB`);
}
if (hardFail.length) {
  console.error(`❌ contract-size gate FAILED — facet exceeds the consortium limit (${kib(CONSORTIUM_LIMIT)} KiB):`);
  for (const h of hardFail) console.error(`    - ${h.name}: ${kib(h.size)} KiB`);
  process.exit(1);
}
console.log(`✅ contract-size gate passed — all ${FACETS.length} facets within the consortium limit (${kib(CONSORTIUM_LIMIT)} KiB)` +
  (warn.length ? `; ${warn.length} over EIP-170 (tracked)` : ""));
