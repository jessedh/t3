#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
    buildEffectiveSelectorMap,
    FACETS,
} = require("./lib/selector-tools");

async function main() {
    console.log("Diamond Selector Collision Check\n");

    const result = await buildEffectiveSelectorMap();

    if (result.missing.length > 0) {
        console.error("FAIL: missing manifest artifacts");
        for (const m of result.missing) {
            console.error(`  ${m.name}: ${m.error}`);
        }
        process.exit(1);
    }

    const totalCutSelectors = [...result.cutFacetSelectors.values()]
        .reduce((sum, arr) => sum + arr.length, 0);

    console.log(`Manifest facets: ${FACETS.length}`);
    console.log(`Cut facets: ${result.cutFacetSelectors.size}`);
    console.log(`Total cut selectors: ${totalCutSelectors}\n`);

    if (result.collisions.length > 0) {
        console.error("COLLISIONS DETECTED\n");

        for (const col of result.collisions) {
            const typeLabel = col.type === "DUPLICATE_SIGNATURE" ? "DUPLICATE" : "HASH COLLISION";
            console.error(`${typeLabel}: ${col.selector}`);
            for (const owner of col.owners) {
                console.error(`  ${owner.signature} in ${owner.facetName}`);
            }
            console.error("");
        }

        const reportPath = path.join(__dirname, "../collision-report.json");
        fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            totalSelectors: totalCutSelectors,
            collisions: result.collisions,
        }, null, 2));
        console.error(`Report saved to: ${reportPath}`);
        process.exit(1);
    }

    console.log("No collisions detected.\n");

    const reportPath = path.join(__dirname, "../collision-report.json");
    fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        totalSelectors: totalCutSelectors,
        collisions: [],
    }, null, 2));
    console.log(`Report saved to: ${reportPath}`);

    process.exit(0);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { main, buildEffectiveSelectorMap };
