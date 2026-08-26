const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ERC165Facet", function () {
    async function deployFacet() {
        // Facet is pure/static for these helpers, so standalone deployment is enough.
        const ERC165Facet = await ethers.getContractFactory("ERC165Facet");
        const facet = await ERC165Facet.deploy();
        await facet.waitForDeployment();
        return facet;
    }

    it("reports support for core known interfaces", async function () {
        const facet = await deployFacet();

        expect(await facet.supportsInterface("0x01ffc9a7")).to.equal(true); // IERC165
        expect(await facet.supportsInterface("0x1f931c1c")).to.equal(true); // IDiamondCut
        expect(await facet.supportsInterface("0x48e2b093")).to.equal(true); // IDiamondLoupe
        expect(await facet.supportsInterface("0x36372b07")).to.equal(true); // IERC20
        expect(await facet.supportsInterface("0xffffffff")).to.equal(false);
    });

    it("returns the supported interface list and categories", async function () {
        const facet = await deployFacet();

        const all = await facet.getAllSupportedInterfaces();
        expect(all.length).to.equal(16);
        expect(all).to.include("0x01ffc9a7");
        expect(all).to.include("0x36372b07");

        const [core, token, banking, investment] = await facet.getInterfacesByCategory();
        expect(core.length).to.equal(4);
        expect(token.length).to.equal(6);
        expect(banking.length).to.equal(5);
        expect(investment.length).to.equal(4);
    });

    it("supports known categories and rejects unknown category ids", async function () {
        const facet = await deployFacet();

        expect(await facet.supportsCategoryInterfaces(0)).to.equal(true);
        expect(await facet.supportsCategoryInterfaces(1)).to.equal(true);
        expect(await facet.supportsCategoryInterfaces(2)).to.equal(true);
        expect(await facet.supportsCategoryInterfaces(3)).to.equal(true);
        expect(await facet.supportsCategoryInterfaces(4)).to.equal(false);
    });
});
