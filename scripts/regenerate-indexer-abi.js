// scripts/regenerate-indexer-abi.js
//
// Regenerates indexer/abis/T3DiamondAbi.ts from the canonical facet manifest.
// Only includes ABIs for facets listed in scripts/lib/facet-manifest.js, plus
// the Diamond proxy itself (for DiamondCut/DiamondLoupe events and errors).
// This prevents harness, mock, and test contracts from polluting the indexer ABI.
//
// BREAKING CHANGE NOTICE (A.9, 2026-06-13):
// InstitutionMode enum ordinals changed — ACTIVE = 0 (was 1), ISSUANCE_PAUSED = 1
// (was 2), ORDERLY_EXIT = 2 (was 3), DEFAULTED = 3 (was 4), RESOLVED = 4 (was 5).
// UNREGISTERED (was 0) has been removed — storage default(0) = ACTIVE.
// Off-chain consumers must update any hardcoded ordinal comparisons.

const fs = require("fs");
const path = require("path");
const { FACETS } = require("./lib/facet-manifest");

const artifactsDir = path.resolve(__dirname, "../artifacts/contracts");
const outPath = path.resolve(__dirname, "../indexer/abis/T3DiamondAbi.ts");

const seen = new Map(); // signature -> abi item

function loadArtifact(relativePath) {
  const fullPath = path.join(artifactsDir, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch {
    return null;
  }
}

function mergeAbi(abi) {
  for (const item of abi) {
    if (item.type !== "event" && item.type !== "function" && item.type !== "error") continue;
    const sig = JSON.stringify({ type: item.type, name: item.name, inputs: item.inputs });
    if (!seen.has(sig)) {
      seen.set(sig, item);
    }
  }
}

// Load each manifest facet's artifact
const missing = [];
for (const facet of FACETS) {
  const artifact = loadArtifact(`facets/${facet.name}.sol/${facet.name}.json`);
  if (!artifact) {
    missing.push(facet.name);
    continue;
  }
  mergeAbi(artifact.abi || []);
}

// Also load Diamond.sol for proxy-level events/errors (DiamondCut events, etc.)
const diamondArtifact = loadArtifact("Diamond.sol/Diamond.json");
if (diamondArtifact) mergeAbi(diamondArtifact.abi || []);

// External DELEGATECALLed libraries emit events from inside their own
// bytecode: at runtime the logs carry the diamond's address, but the event
// definitions appear only in the library artifact, never in a facet ABI
// (e.g. ComplianceHoldLib's hold lifecycle events, Sprint 4). Merge events
// and errors only — library function selectors are not diamond-callable.
const EXTERNAL_EVENT_LIBS = ["ComplianceHoldLib"];
for (const libName of EXTERNAL_EVENT_LIBS) {
  const artifact = loadArtifact(`lib/${libName}.sol/${libName}.json`);
  if (!artifact) {
    missing.push(libName);
    continue;
  }
  mergeAbi((artifact.abi || []).filter((i) => i.type === "event" || i.type === "error"));
}

if (missing.length > 0) {
  console.warn(`⚠️  ${missing.length} manifest facet(s) missing compiled artifacts:`);
  for (const name of missing) {
    console.warn(`   ${name} — run npm run compile first`);
  }
  if (missing.length === FACETS.length) {
    console.error("No artifacts found — run npm run compile before regenerating ABI");
    process.exit(1);
  }
}

const mergedAbi = Array.from(seen.values());

// Sort for determinism
mergedAbi.sort((a, b) => {
  if (a.type !== b.type) return a.type.localeCompare(b.type);
  if (a.name !== b.name) return (a.name || "").localeCompare(b.name || "");
  return JSON.stringify(a.inputs).localeCompare(JSON.stringify(b.inputs));
});

const breakingChangeNotice = [
  "// AUTO-GENERATED — do not edit manually. Run: node scripts/regenerate-indexer-abi.js",
  "//",
  "// Sources: facets listed in scripts/lib/facet-manifest.js only.",
  "// Test harnesses, mocks, and attacker contracts are excluded.",
  "//",
  "// BREAKING (A.9, 2026-06-13): InstitutionMode enum ordinals changed.",
  "// ACTIVE=0 (was 1), ISSUANCE_PAUSED=1 (was 2), ORDERLY_EXIT=2 (was 3),",
  "// DEFAULTED=3 (was 4), RESOLVED=4 (was 5). UNREGISTERED removed.",
  "// Update any hardcoded ordinal comparisons in off-chain consumers.",
].join("\n");

const output = `${breakingChangeNotice}\nexport const T3DiamondAbi = ${JSON.stringify(mergedAbi, null, 2)} as const;\n`;
fs.writeFileSync(outPath, output);

const eventCount = mergedAbi.filter(x => x.type === "event").length;
const fnCount = mergedAbi.filter(x => x.type === "function").length;
const errCount = mergedAbi.filter(x => x.type === "error").length;
console.log(`✅ Regenerated T3DiamondAbi.ts — ${mergedAbi.length} items (${fnCount} functions, ${eventCount} events, ${errCount} errors)`);
console.log(`   Sources: ${FACETS.length - missing.length} of ${FACETS.length} manifest facets`);
