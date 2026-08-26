const { ethers } = require("hardhat");

const FacetCutAction = {
    Add: 0,
    Replace: 1,
    Remove: 2
};

function getSelectors(contract, excludeSignatures = []) {
    const excluded = new Set();

    for (const signature of excludeSignatures) {
        try {
            const fragment = contract.interface.getFunction(signature);
            excluded.add(fragment.selector);
        } catch {
            // Ignore signatures not present on the contract.
        }
    }

    // Keep only externally callable selectors that are not explicitly excluded.
    const selectors = [];
    contract.interface.forEachFunction((fragment) => {
        if (!excluded.has(fragment.selector)) {
            selectors.push(fragment.selector);
        }
    });

    return selectors;
}

async function addFacetToDiamond(diamondCut, facet, excludeSignatures = []) {
    const selectors = getSelectors(facet, excludeSignatures);
    if (selectors.length === 0) {
        throw new Error("No selectors to add");
    }

    // EIP-2535 facet cut payload for an Add action.
    const cut = [
        {
            facetAddress: await facet.getAddress(),
            action: FacetCutAction.Add,
            functionSelectors: selectors
        }
    ];

    const tx = await diamondCut.diamondCut(cut, ethers.ZeroAddress, "0x");
    await tx.wait();
    return selectors;
}

module.exports = {
    FacetCutAction,
    getSelectors,
    addFacetToDiamond
};
