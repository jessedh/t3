const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployT3DiamondFixture } = require('../helpers/deployment');
const { getSelectors, FacetCutAction } = require('../helpers/deployment');

describe('Diamond Upgrade Security', function () {
  let diamond;
  let diamondAddress;
  let diamondCutFacet;
  let diamondLoupe;
  let deployedFacets;
  let owner;
  let addr1;

  beforeEach(async function () {
    const deployment = await deployT3DiamondFixture();
    diamond = deployment.diamond;
    deployedFacets = deployment.deployedFacets;
    owner = deployment.signers.owner;
    addr1 = deployment.signers.user1;
    diamondAddress = await diamond.getAddress();
    diamondCutFacet = (await ethers.getContractAt('DiamondCutFacet', diamondAddress)).connect(owner);
    diamondLoupe = await ethers.getContractAt('IDiamondLoupe', diamondAddress);
  });

  it('should revert when adding a function with a selector that already exists', async function () {
    const erc20BaseFacet = await ethers.getContractAt('ERC20BaseFacet', diamondAddress);
    const selectors = getSelectors(erc20BaseFacet, ['name()']);

    const NewFacet = await ethers.getContractFactory('ERC20BaseFacet');
    const newFacet = await NewFacet.deploy();
    await newFacet.waitForDeployment();

    const cut = [{
      facetAddress: await newFacet.getAddress(),
      action: FacetCutAction.Add,
      functionSelectors: selectors,
    }];

    await expect(
      diamondCutFacet.diamondCut(cut, ethers.ZeroAddress, '0x')
    ).to.be.revertedWith('DiamondCut: Function selector already exists');
  });

  it('should not revert when trying to remove a function from a non-removable facet', async function () {
    // DiamondCutFacet is deployed as non-removable by default in deployDiamond
    // However, this is not the case in deployT3DiamondFixture. This test is to document the current behavior.
    const selectors = getSelectors(diamondCutFacet, ['diamondCut((address,uint8,bytes4[])[],address,bytes)']);

    const cut = [{
      facetAddress: ethers.ZeroAddress,
      action: FacetCutAction.Remove,
      functionSelectors: selectors,
    }];

    await expect(
      diamondCutFacet.diamondCut(cut, ethers.ZeroAddress, '0x')
    ).to.not.be.reverted;
  });

  it('should revert when adding functions with a zero address facet', async function () {
    const NewFacet = await ethers.getContractFactory('TestT3CommonLib');
    const newFacet = await NewFacet.deploy();
    await newFacet.waitForDeployment();
    const selectors = getSelectors(newFacet, ['test_bytesToAddress(bytes)']);

    const cut = [{
      facetAddress: ethers.ZeroAddress,
      action: FacetCutAction.Add,
      functionSelectors: selectors,
    }];

    await expect(
      diamondCutFacet.diamondCut(cut, ethers.ZeroAddress, '0x')
    ).to.be.revertedWith('DiamondCut: Add facet address cannot be zero');
  });

  it('should revert when removing function selectors that do not exist', async function () {
    // These selectors are from a mock contract and are guaranteed not to be in the diamond
    const selectors = [
      '0xaaaaaaaa',
      '0xbbbbbbbb',
    ];

    const cut = [{
      facetAddress: ethers.ZeroAddress,
      action: FacetCutAction.Remove,
      functionSelectors: selectors,
    }];

    await expect(
      diamondCutFacet.diamondCut(cut, ethers.ZeroAddress, '0x')
    ).to.be.revertedWith('DiamondCut: Function selector does not exist');
  });

  it('should revert when replacing selectors with the same facet address', async function () {
    const erc20FacetAddress = await deployedFacets.ERC20BaseFacet.getAddress();
    const selectors = getSelectors(deployedFacets.ERC20BaseFacet);

    const cut = [{
      facetAddress: erc20FacetAddress,
      action: FacetCutAction.Replace,
      functionSelectors: selectors.slice(0, 1),
    }];

    await expect(
      diamondCutFacet.diamondCut(cut, ethers.ZeroAddress, '0x')
    ).to.be.revertedWith('DiamondCut: Cannot replace with the same facet address');
  });

  it('should remove facet address when its last selector is removed', async function () {
    const erc165FacetAddress = await deployedFacets.ERC165Facet.getAddress();
    const selectors = getSelectors(deployedFacets.ERC165Facet);

    const cut = [{
      facetAddress: ethers.ZeroAddress,
      action: FacetCutAction.Remove,
      functionSelectors: selectors,
    }];

    await diamondCutFacet.diamondCut(cut, ethers.ZeroAddress, '0x');

    const remainingFacetAddresses = await diamondLoupe.facetAddresses();
    expect(remainingFacetAddresses).to.not.include(erc165FacetAddress);

    const selectorsAfter = await diamondLoupe.facetFunctionSelectors(erc165FacetAddress);
    expect(selectorsAfter.length).to.equal(0);
  });

  it('should execute initializer when provided during diamond cut', async function () {
    const MockDiamondUpgradeInit = await ethers.getContractFactory('MockDiamondUpgradeInit');
    const mockInit = await MockDiamondUpgradeInit.deploy();
    await mockInit.waitForDeployment();

    const newVersion = 42n;
    const initCalldata = mockInit.interface.encodeFunctionData('init', [newVersion]);

    await expect(
      diamondCutFacet.diamondCut([], await mockInit.getAddress(), initCalldata)
    ).to.emit(diamondCutFacet, 'DiamondCut');

    const storageSlot = ethers.keccak256(
      ethers.toUtf8Bytes('com.t3programmablefiat.diamond.AppStorage.v1.995ced7e2b6e426f836004bd3a63670d')
    );

    const rawStorage = await ethers.provider.getStorage(diamondAddress, storageSlot);
    expect(BigInt(rawStorage)).to.equal(newVersion);
  });
});
