const fs = require("fs");
const path = require("path");
const {
    buildEffectiveSelectorMap,
    FACETS,
} = require("./lib/selector-tools");

async function main() {
    console.log("Analyzing selectors from facet manifest...\n");

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
    const totalSkipCutSelectors = [...result.skipCutFacetSelectors.values()]
        .reduce((sum, arr) => sum + arr.length, 0);

    console.log(`Manifest facets: ${FACETS.length}`);
    console.log(`Cut facets: ${result.cutFacetSelectors.size}`);
    console.log(`Skip-cut facets: ${result.skipCutFacetSelectors.size}`);
    console.log(`Cut selectors: ${totalCutSelectors}`);
    console.log(`Skip-cut selectors: ${totalSkipCutSelectors}\n`);

    if (result.collisions.length > 0) {
        console.error("SELECTOR CONFLICTS DETECTED\n");

        const duplicates = result.collisions.filter((c) => c.type === "DUPLICATE_SIGNATURE");
        const hashCollisions = result.collisions.filter((c) => c.type === "HASH_COLLISION");

        if (duplicates.length > 0) {
            console.error(`Duplicate signatures: ${duplicates.length}`);
            for (const dup of duplicates) {
                console.error(`  ${dup.selector}`);
                for (const owner of dup.owners) {
                    console.error(`    ${owner.signature} in ${owner.facetName}`);
                }
            }
            console.error("");
        }

        if (hashCollisions.length > 0) {
            console.error(`Hash collisions: ${hashCollisions.length}`);
            for (const col of hashCollisions) {
                console.error(`  ${col.selector}`);
                for (const owner of col.owners) {
                    console.error(`    ${owner.signature} in ${owner.facetName}`);
                }
            }
            console.error("");
        }

        const reportDir = path.join(__dirname, "..", "Documentation/envelope_besu/reports");
        fs.mkdirSync(reportDir, { recursive: true });
        const reportPath = path.join(reportDir, "selector-analysis-report.json");
        fs.writeFileSync(reportPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            manifestFacetCount: FACETS.length,
            collisions: result.collisions,
            cutFacetSelectors: Object.fromEntries(
                [...result.cutFacetSelectors].map(([k, v]) => [k, v.map((s) => s.signature)])
            ),
            skipCutFacetSelectors: Object.fromEntries(
                [...result.skipCutFacetSelectors].map(([k, v]) => [k, v.map((s) => s.signature)])
            ),
        }, null, 2));
        console.error(`Report written to: ${reportPath}`);

        process.exit(1);
    }

    console.log("No selector conflicts.\n");

    const reportDir = path.join(__dirname, "..", "Documentation/envelope_besu/reports");
    fs.mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, "selector-analysis-report.json");
    fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        manifestFacetCount: FACETS.length,
        collisions: [],
        cutFacetSelectors: Object.fromEntries(
            [...result.cutFacetSelectors].map(([k, v]) => [k, v.map((s) => s.signature)])
        ),
        skipCutFacetSelectors: Object.fromEntries(
            [...result.skipCutFacetSelectors].map(([k, v]) => [k, v.map((s) => s.signature)])
        ),
    }, null, 2));
    console.log(`Report written to: ${reportPath}`);

    return result;
}

if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });
}

module.exports = { main, buildEffectiveSelectorMap };
