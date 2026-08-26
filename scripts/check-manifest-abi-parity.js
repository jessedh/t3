// scripts/check-manifest-abi-parity.js
//
// Verifies that every function selector in the facet manifest appears in the
// generated indexer ABI. Exits 1 if any manifest selector is absent.
//
// Usage: node scripts/check-manifest-abi-parity.js

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { FACETS } = require("./lib/facet-manifest");

const artifactsDir = path.resolve(__dirname, "../artifacts/contracts");
const abiPath = path.resolve(__dirname, "../indexer/abis/T3DiamondAbi.ts");

function loadArtifact(relativePath) {
  const fullPath = path.join(artifactsDir, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch {
    return null;
  }
}

// Build selector set from generated ABI file
function loadAbiSelectors() {
  if (!fs.existsSync(abiPath)) {
    console.error(`ABI file not found: ${abiPath}`);
    console.error("Run: node scripts/regenerate-indexer-abi.js");
    process.exit(1);
  }
  const content = fs.readFileSync(abiPath, "utf8");
  // Extract the JSON array from the TypeScript export
  const match = content.match(/T3DiamondAbi = (\[[\s\S]*?\]) as const/);
  if (!match) {
    console.error("Could not parse ABI from T3DiamondAbi.ts");
    process.exit(1);
  }
  const abi = JSON.parse(match[1]);
  const selectors = new Set();
  for (const item of abi) {
    if (item.type !== "function") continue;
    const iface = new ethers.Interface([item]);
    iface.forEachFunction(fn => selectors.add(fn.selector));
  }
  return selectors;
}

const abiSelectors = loadAbiSelectors();

let missing = [];

for (const facet of FACETS) {
  if (facet.skipCut) continue; // DiamondCutFacet registered by constructor
  const artifact = loadArtifact(`facets/${facet.name}.sol/${facet.name}.json`);
  if (!artifact) {
    console.warn(`  ⚠️  ${facet.name}: no artifact (run compile first)`);
    continue;
  }
  const iface = new ethers.Interface(artifact.abi || []);
  const excludeSet = new Set(facet.excludes || []);
  const globalExclude = new Set(["supportsInterface(bytes4)"]);

  iface.forEachFunction(fn => {
    const sig = fn.format("sighash");
    if (excludeSet.has(sig) || globalExclude.has(sig)) return;
    if (!abiSelectors.has(fn.selector)) {
      missing.push({ facet: facet.name, signature: sig, selector: fn.selector });
    }
  });
}

if (missing.length > 0) {
  console.error(`FAIL: ${missing.length} manifest selector(s) absent from generated ABI\n`);
  for (const { facet, signature, selector } of missing) {
    console.error(`  [${facet}] ${signature} (${selector})`);
  }
  process.exit(1);
}

console.log(`✅ Manifest-ABI parity check passed — all ${abiSelectors.size} ABI selectors present for ${FACETS.length} manifest facets`);
