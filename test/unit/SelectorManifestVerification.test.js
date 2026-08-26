const { expect } = require("chai");
const fs = require("fs");
const { FACETS, SUPPORTS_INTERFACE_SIG } = require("../../scripts/lib/facet-manifest");
const {
    classifySelectorOwners,
    buildEffectiveSelectorMap,
} = require("../../scripts/lib/selector-tools");

describe("Selector Manifest Verification (Wave 1.4)", function () {
    const OBSOLETE_NAMES = [
        "T3TokenTransferFacet",
        "LockedTransferManagerFacet",
        "T3TokenReversalExpiryFacet",
    ];

    it("scripts do not contain obsolete hardcoded facet names", function () {
        const analyzeContent = fs.readFileSync("scripts/analyze-selectors.js", "utf8");
        const collisionContent = fs.readFileSync("scripts/selector-collision-check.js", "utf8");

        for (const name of OBSOLETE_NAMES) {
            expect(analyzeContent, `analyze-selectors.js should not reference ${name}`).to.not.include(name);
            expect(collisionContent, `selector-collision-check.js should not reference ${name}`).to.not.include(name);
        }
    });

    it("uses manifest facet count for selector derivation", async function () {
        const { cutFacetSelectors, skipCutFacetSelectors, missing } = await buildEffectiveSelectorMap();

        expect(missing).to.deep.equal([]);
        expect(cutFacetSelectors.size + skipCutFacetSelectors.size).to.equal(FACETS.length);
    });

    it("includes skipCut selectors as occupied owners but not as cut entries", async function () {
        const { cutFacetSelectors, skipCutFacetSelectors, selectorOwners } = await buildEffectiveSelectorMap();

        const skipCutEntry = FACETS.find((f) => f.skipCut);
        expect(skipCutEntry, "manifest should have at least one skipCut entry").to.exist;

        expect(skipCutFacetSelectors.has(skipCutEntry.name)).to.be.true;
        expect(cutFacetSelectors.has(skipCutEntry.name)).to.be.false;

        const skipCutSels = skipCutFacetSelectors.get(skipCutEntry.name);
        expect(skipCutSels.length).to.be.greaterThan(0);

        for (const sel of skipCutSels) {
            const owners = selectorOwners.get(sel.selector);
            expect(owners, `selector ${sel.selector} should have owners`).to.exist;
            expect(owners.some((o) => o.facetName === skipCutEntry.name)).to.be.true;
        }
    });

    it("ERC165Facet retains supportsInterface while all other facets exclude it", async function () {
        const { cutFacetSelectors, skipCutFacetSelectors } = await buildEffectiveSelectorMap();
        const all = new Map([...cutFacetSelectors, ...skipCutFacetSelectors]);

        const erc165Sels = all.get("ERC165Facet");
        expect(erc165Sels).to.exist;
        expect(erc165Sels.some((s) => s.signature === SUPPORTS_INTERFACE_SIG)).to.be.true;

        for (const [name, selectors] of all) {
            if (name === "ERC165Facet") continue;
            const hasIt = selectors.some((s) => s.signature === SUPPORTS_INTERFACE_SIG);
            expect(hasIt, `${name} should exclude supportsInterface from effective selectors`).to.be.false;
        }
    });

    it("applies per-facet excludes from the manifest", async function () {
        const { cutFacetSelectors } = await buildEffectiveSelectorMap();

        const erc20BaseSels = cutFacetSelectors.get("ERC20BaseFacet");
        expect(erc20BaseSels).to.exist;
        const erc20BaseSigs = erc20BaseSels.map((s) => s.signature);
        expect(erc20BaseSigs).to.not.include("transfer(address,uint256)");
        expect(erc20BaseSigs).to.not.include("transferFrom(address,address,uint256)");
    });

    it("distinguishes duplicate identical signatures from hash collisions", async function () {
        const duplicateOwners = [
            { facetName: "FacetA", signature: "foo(uint256)" },
            { facetName: "FacetB", signature: "foo(uint256)" },
        ];
        const collisionOwners = [
            { facetName: "FacetA", signature: "foo(uint256)" },
            { facetName: "FacetB", signature: "bar(uint256)" },
        ];

        expect(classifySelectorOwners(duplicateOwners)).to.equal("DUPLICATE_SIGNATURE");
        expect(classifySelectorOwners(collisionOwners)).to.equal("HASH_COLLISION");
    });

    it("fails the build if a manifest artifact is missing", async function () {
        const entries = [{ name: "MissingFacet" }];
        const getContractFactory = async () => {
            throw new Error("artifact not found");
        };

        const { missing, cutFacetSelectors, collisions } =
            await buildEffectiveSelectorMap(entries, getContractFactory);

        expect(missing).to.have.length(1);
        expect(missing[0].name).to.equal("MissingFacet");
        expect(missing[0].error).to.include("artifact not found");
        expect(cutFacetSelectors.size).to.equal(0);
        expect(collisions).to.deep.equal([]);
    });
});
