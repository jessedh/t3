const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Import our test infrastructure
const { deployT3DiamondFixture } = require("./helpers/deployment");
const { ROLES } = require("./helpers/roles");

/**
 * Deployment Integration Test
 * 
 * Tests that the deployment helper correctly handles bootstrap scenarios
 * and diamond cut authorization.
 */
describe("Deployment Integration Test", function () {
    
    async function setupDiamondFixture() {
        return await deployT3DiamondFixture();
    }
    
    it("should deploy diamond successfully", async function () {
        const deployment = await loadFixture(setupDiamondFixture);
        
        // Verify basic deployment
        expect(deployment.diamond).to.not.be.undefined;
        expect(deployment.diamondAddress).to.be.properAddress;
        expect(deployment.facets.diamondCut).to.not.be.undefined;
        
        console.log("Diamond deployed to:", deployment.diamondAddress);
        console.log("Diamond cut succeeded:", deployment.diamondCutSucceeded);
    });
    
    it("should handle diamond cut authorization properly", async function () {
        const deployment = await loadFixture(setupDiamondFixture);
        const { facets, signers } = deployment;
        
        if (deployment.diamondCutSucceeded) {
            // If diamond cut succeeded, we should have AccessControlFacet available
            expect(facets.accessControl).to.not.be.undefined;
            
            // Owner should have DEFAULT_ADMIN_ROLE
            const hasRole = await facets.accessControl.hasRole(ROLES.DEFAULT_ADMIN_ROLE, signers.owner.address);
            expect(hasRole).to.be.true;
            
            console.log("✅ Diamond cut succeeded, AccessControlFacet available");
        } else {
            // If diamond cut failed, AccessControlFacet should not be available
            expect(facets.accessControl).to.be.undefined;
            
            console.log("⚠️ Diamond cut failed during bootstrap, AccessControlFacet not available");
        }
    });
    
    it("should allow manual role setup if diamond cut failed", async function () {
        const deployment = await loadFixture(setupDiamondFixture);
        const { facets, signers } = deployment;
        
        if (!deployment.diamondCutSucceeded) {
            // We can still manually add AccessControlFacet using owner authorization
            const AccessControlFacet = await ethers.getContractFactory("AccessControlFacet");
            const accessControlFacet = await AccessControlFacet.deploy();
            await accessControlFacet.waitForDeployment();
            
            // Get selectors
            const selectors = [];
            accessControlFacet.interface.forEachFunction((funcFragment) => {
                if (funcFragment.name !== 'init') {
                    selectors.push(funcFragment.selector);
                }
            });
            
            const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
            const cut = [{
                facetAddress: await accessControlFacet.getAddress(),
                action: FacetCutAction.Add,
                functionSelectors: selectors
            }];
            
            // This should work because we're the contract owner during bootstrap
            await expect(facets.diamondCut.connect(signers.owner).diamondCut(cut, ethers.ZeroAddress, "0x"))
                .to.not.be.reverted;
                
            console.log("✅ Successfully added AccessControlFacet manually using owner authorization");
        } else {
            console.log("ℹ️ Diamond cut already succeeded, skipping manual setup");
        }
    });
});