const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

async function main() {
    const diamondAddress = process.env.DIAMOND_ADDRESS;
    if (!diamondAddress) {
        console.error("DIAMOND_ADDRESS not set");
        process.exit(1);
    }

    console.log(`🔍 Snapshotting selectors on ${network.name}...`);
    const loupe = await ethers.getContractAt("DiamondLoupeFacet", diamondAddress);
    const facets = await loupe.facets();

    // Load all facet ABIs to map selectors to signatures
    const artifactsDir = path.resolve(__dirname, "../artifacts/contracts/facets");
    const selectorMap = {};

    function scanDir(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
            const p = path.join(dir, ent.name);
            if (ent.isDirectory()) scanDir(p);
            else if (ent.name.endsWith(".json") && !ent.name.includes(".dbg.")) {
                try {
                    const artifact = JSON.parse(fs.readFileSync(p));
                    const abi = artifact.abi || [];
                    for (const item of abi) {
                        if (item.type === "function") {
                            const sig = item.name + "(" + item.inputs.map(i => i.type).join(",") + ")";
                            const sel = ethers.id(sig).slice(0, 10);
                            if (!selectorMap[sel]) selectorMap[sel] = [];
                            selectorMap[sel].push({ signature: sig, contract: path.basename(path.dirname(p)) });
                        }
                    }
                } catch (e) {}
            }
        }
    }
    scanDir(artifactsDir);

    const snapshot = {
        network: network.name,
        diamond: diamondAddress,
        timestamp: new Date().toISOString(),
        blockNumber: await ethers.provider.getBlockNumber(),
        facets: facets.map(f => ({
            facetAddress: f.facetAddress,
            selectors: f.functionSelectors.map(sel => {
                const matches = selectorMap[sel] || [];
                return {
                    selector: sel,
                    signatures: matches.map(m => m.signature),
                    contracts: [...new Set(matches.map(m => m.contract))]
                };
            })
        }))
    };

    const reportsDir = path.resolve(__dirname, "../Documentation/envelope_besu/reports");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const outPath = path.resolve(reportsDir, `pre-cutover-selectors-${network.name}.json`);
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));

    console.log(`✅ Snapshot saved: ${outPath}`);
    console.log(`📊 Total facets: ${facets.length}`);
    console.log(`📊 Total selectors: ${facets.reduce((sum, f) => sum + f.functionSelectors.length, 0)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
