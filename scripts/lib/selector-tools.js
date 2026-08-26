const { ethers } = require("hardhat");
const { FACETS, SUPPORTS_INTERFACE_SIG } = require("./facet-manifest");
const path = require("path");
const fs = require("fs");

/**
 * Build the exclusion signature list for a manifest entry.
 * @param {Object} entry - facet manifest entry
 * @returns {string[]} signatures to exclude
 */
function buildExcludeList(entry) {
    const excludeSigs = [];
    if (entry.excludeSupportsInterface !== false) {
        excludeSigs.push(SUPPORTS_INTERFACE_SIG);
    }
    if (entry.excludes) {
        excludeSigs.push(...entry.excludes);
    }
    return excludeSigs;
}

/**
 * Get selectors from a contract interface, excluding init and given signatures.
 * @param {ethers.Interface} contractInterface
 * @param {string[]} excludeSignatures
 * @returns {Array<{selector:string, signature:string, name:string}>}
 */
function getSelectorsFromInterface(contractInterface, excludeSignatures = []) {
    const excludedSelectorsLookup = new Set();
    for (const sig of excludeSignatures) {
        try {
            const funcFragment = contractInterface.getFunction(sig);
            if (funcFragment) excludedSelectorsLookup.add(funcFragment.selector);
        } catch (e) {
            /* ignore invalid signatures */
        }
    }
    const selectors = [];
    contractInterface.forEachFunction((funcFragment) => {
        if (funcFragment.name !== "init" && !excludedSelectorsLookup.has(funcFragment.selector)) {
            selectors.push({
                selector: funcFragment.selector,
                signature: funcFragment.format("sighash"),
                name: funcFragment.name,
            });
        }
    });
    return selectors;
}

/**
 * Get effective selectors for a manifest entry using a contract interface.
 * @param {Object} entry - facet manifest entry
 * @param {ethers.Interface} contractInterface
 * @returns {Array<{selector:string, signature:string, name:string}>}
 */
function getEffectiveSelectorsForEntry(entry, contractInterface) {
    const excludeSigs = buildExcludeList(entry);
    return getSelectorsFromInterface(contractInterface, excludeSigs);
}

/**
 * Build the complete effective selector ownership map from the manifest.
 * Returns cut facets, skipCut facets, missing artifacts, and collisions.
 * @returns {Promise<Object>}
 */
function classifySelectorOwners(owners) {
    return owners.every((owner) => owner.signature === owners[0].signature)
        ? "DUPLICATE_SIGNATURE"
        : "HASH_COLLISION";
}

async function buildEffectiveSelectorMap(
    entries = FACETS,
    getContractFactory = null
) {
    const selectorOwners = new Map(); // selector -> Array<{facetName, signature, isCut}>
    const cutFacetSelectors = new Map(); // facetName -> selectors[]
    const skipCutFacetSelectors = new Map(); // facetName -> selectors[]
    const missing = [];

    for (const entry of entries) {
        let iface;
        try {
            if (getContractFactory) {
                const factory = await getContractFactory(entry.name);
                iface = factory.interface;
            } else {
                const artifactPath = path.resolve(
                    __dirname,
                    "../../artifacts/contracts/facets",
                    `${entry.name}.sol`,
                    `${entry.name}.json`
                );
                if (!fs.existsSync(artifactPath)) {
                    throw new Error(`Artifact not found: ${artifactPath}`);
                }
                const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
                iface = new ethers.Interface(artifact.abi || []);
            }
        } catch (err) {
            missing.push({ name: entry.name, error: err.message });
            continue;
        }

        const selectors = getEffectiveSelectorsForEntry(entry, iface);
        const isCut = !entry.skipCut;

        if (isCut) {
            cutFacetSelectors.set(entry.name, selectors);
        } else {
            skipCutFacetSelectors.set(entry.name, selectors);
        }

        for (const sel of selectors) {
            if (!selectorOwners.has(sel.selector)) {
                selectorOwners.set(sel.selector, []);
            }
            selectorOwners.get(sel.selector).push({
                facetName: entry.name,
                signature: sel.signature,
                isCut,
            });
        }
    }

    const collisions = [];
    for (const [selector, owners] of selectorOwners) {
        if (owners.length > 1) {
            collisions.push({
                selector,
                owners,
                type: classifySelectorOwners(owners),
            });
        }
    }

    return {
        selectorOwners,
        cutFacetSelectors,
        skipCutFacetSelectors,
        missing,
        collisions,
    };
}

module.exports = {
    buildExcludeList,
    getSelectorsFromInterface,
    getEffectiveSelectorsForEntry,
    classifySelectorOwners,
    buildEffectiveSelectorMap,
    SUPPORTS_INTERFACE_SIG,
    FACETS,
};
