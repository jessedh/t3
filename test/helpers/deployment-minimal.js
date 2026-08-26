const { ethers } = require("hardhat");
const { FacetCutAction, getSelectors } = require('./deployment');

async function deployMinimalDiamond() {
    const [owner] = await ethers.getSigners();

    // Deploy DiamondCutFacet
    const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
    const diamondCutFacet = await DiamondCutFacet.deploy();
    await diamondCutFacet.waitForDeployment();
    const diamondCutFacetAddress = await diamondCutFacet.getAddress();

    // Deploy Diamond
    const Diamond = await ethers.getContractFactory("Diamond");
    const diamond = await Diamond.deploy(owner.address, diamondCutFacetAddress);
    await diamond.waitForDeployment();
    const diamondAddress = await diamond.getAddress();

    // Deploy DiamondInit
    const DiamondInit = await ethers.getContractFactory("DiamondInit");
    const diamondInit = await DiamondInit.deploy();
    await diamondInit.waitForDeployment();

    // Deploy DiamondLoupeFacet
    const DiamondLoupeFacet = await ethers.getContractFactory('DiamondLoupeFacet');
    const diamondLoupeFacet = await DiamondLoupeFacet.deploy();
    await diamondLoupeFacet.waitForDeployment();

    // Deploy ERC20BaseFacet for selector clash test
    const ERC20BaseFacet = await ethers.getContractFactory('ERC20BaseFacet');
    const erc20BaseFacet = await ERC20BaseFacet.deploy();
    await erc20BaseFacet.waitForDeployment();

    // Cut DiamondLoupeFacet and ERC20BaseFacet
    const loupeSelectors = getSelectors(diamondLoupeFacet);
    const erc20Selectors = getSelectors(erc20BaseFacet);

    const cut = [
        {
            facetAddress: await diamondLoupeFacet.getAddress(),
            action: FacetCutAction.Add,
            functionSelectors: loupeSelectors
        },
        {
            facetAddress: await erc20BaseFacet.getAddress(),
            action: FacetCutAction.Add,
            functionSelectors: erc20Selectors
        }
    ];

    const diamondCut = await ethers.getContractAt('IDiamondCut', diamondAddress);
    const initData = diamondInit.interface.encodeFunctionData('init', []);
    await diamondCut.diamondCut(cut, await diamondInit.getAddress(), initData);

    return {
        Diamond: diamond,
        diamondAddress: diamondAddress,
    };
}

module.exports = {
    deployMinimalDiamond
};
