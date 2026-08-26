const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Bootstrap Test - Verify Diamond Cut Authorization Bootstrap Logic
 * 
 * This test verifies that the DiamondCutFacet can handle the bootstrap scenario
 * where AccessControlFacet hasn't been added yet.
 */
describe("Diamond Bootstrap Test", function () {
    let diamond, diamondCut, owner, user1;
    let accessControlFacet;

    beforeEach(async function () {
        [owner, user1] = await ethers.getSigners();
        
        // Deploy DiamondCutFacet
        const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
        const diamondCutFacet = await DiamondCutFacet.deploy();
        await diamondCutFacet.waitForDeployment();
        
        // Deploy Diamond
        const Diamond = await ethers.getContractFactory("Diamond");
        diamond = await Diamond.deploy(owner.address, await diamondCutFacet.getAddress());
        await diamond.waitForDeployment();
        
        // Get diamond cut interface
        diamondCut = await ethers.getContractAt("IDiamondCut", await diamond.getAddress());
        
        // Deploy AccessControlFacet for testing
        const AccessControlFacet = await ethers.getContractFactory("AccessControlFacet");
        accessControlFacet = await AccessControlFacet.deploy();
        await accessControlFacet.waitForDeployment();
    });

    it("should allow contract owner to perform diamond cut during bootstrap", async function () {
        // Prepare diamond cut to add AccessControlFacet
        const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
        
        // Get AccessControlFacet selectors
        const selectors = [];
        accessControlFacet.interface.forEachFunction((funcFragment) => {
            if (funcFragment.name !== 'init') {
                selectors.push(funcFragment.selector);
            }
        });

        const cut = [{
            facetAddress: await accessControlFacet.getAddress(),
            action: FacetCutAction.Add,
            functionSelectors: selectors
        }];

        // This should succeed because we're the contract owner during bootstrap
        await expect(diamondCut.connect(owner).diamondCut(cut, ethers.ZeroAddress, "0x"))
            .to.not.be.reverted;
    });

    it("should reject diamond cut from non-owner during bootstrap", async function () {
        const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
        
        const selectors = [];
        accessControlFacet.interface.forEachFunction((funcFragment) => {
            if (funcFragment.name !== 'init') {
                selectors.push(funcFragment.selector);
            }
        });

        const cut = [{
            facetAddress: await accessControlFacet.getAddress(),
            action: FacetCutAction.Add,
            functionSelectors: selectors
        }];

        // The constructor grants DEFAULT_ADMIN_ROLE directly in shared storage,
        // so bootstrap authorization uses the same role check as later cuts.
        await expect(diamondCut.connect(user1).diamondCut(cut, ethers.ZeroAddress, "0x"))
            .to.be.revertedWithCustomError(accessControlFacet, "UnauthorizedRole")
            .withArgs(user1.address, ethers.ZeroHash);
    });

    it("should transition to role-based authorization after AccessControlFacet is added", async function () {
        const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
        
        // First, add AccessControlFacet
        const selectors = [];
        accessControlFacet.interface.forEachFunction((funcFragment) => {
            if (funcFragment.name !== 'init') {
                selectors.push(funcFragment.selector);
            }
        });

        const cut = [{
            facetAddress: await accessControlFacet.getAddress(),
            action: FacetCutAction.Add,
            functionSelectors: selectors
        }];

        await diamondCut.connect(owner).diamondCut(cut, ethers.ZeroAddress, "0x");

        // Now try another diamond cut from user1 — they have no DEFAULT_ADMIN_ROLE,
        // so the role-based check should reject them (owner was auto-granted the role
        // by the Diamond constructor and would be allowed)
        const dummyCut = [{
            facetAddress: ethers.ZeroAddress,
            action: FacetCutAction.Remove,
            functionSelectors: [selectors[0]] // Remove one function
        }];

        await expect(diamondCut.connect(user1).diamondCut(dummyCut, ethers.ZeroAddress, "0x"))
            .to.be.reverted;
    });
});
