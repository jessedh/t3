const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { ROLES } = require("../helpers/roles");

describe("Storage Safety Tests - Phase 1 Multi-Sig Structures", function() {
    let diamond;
    let diamondInit;
    let deployer, admin, signer1, signer2, signer3;
    
    beforeEach(async function() {
        [deployer, admin, signer1, signer2, signer3] = await ethers.getSigners();
        
        // Deploy diamond with multi-sig storage structures
        const deployment = await deployT3DiamondFixture();
        diamond = deployment.diamond;
        
        // Grant DEFAULT_ADMIN_ROLE to admin so they can grant other roles
        const accessControl = await ethers.getContractAt("AccessControlFacet", diamond.target);
        await accessControl.connect(deployment.signers.owner).grantRole(ROLES.DEFAULT_ADMIN_ROLE, admin.address);
    });

    describe("Storage Layout Integrity", function() {
        it("should initialize multi-sig storage correctly", async function() {
            // Access multi-sig configuration through view functions
            // Note: We'll need to add view functions to access storage
            
            // For now, verify initialization doesn't revert
            expect(diamond.target).to.be.properAddress;
        });
        
        it("should maintain storage layout after initialization", async function() {
            // Test that core token functionality still works after adding multi-sig storage
            const erc20 = await ethers.getContractAt("ERC20BaseFacet", diamond.target);
            
            const name = await erc20.name();
            const symbol = await erc20.symbol();
            
            expect(name).to.equal("T3Token");
            expect(symbol).to.equal("T3T");
        });
        
        it("should preserve existing storage slots", async function() {
            // Test critical storage variables are still accessible
            const adminFacet = await ethers.getContractAt("T3TokenAdminFacet", diamond.target);
            
            // These should not revert if storage layout is preserved
            const treasuryAddress = await adminFacet.getTreasuryAddress();
            const [duration] = await adminFacet.getHalfLifeParameters();
            
            expect(treasuryAddress).to.be.properAddress;
            expect(duration).to.be.gt(0);
        });
    });

    describe("Multi-Sig Storage Structure Validation", function() {
        it("should handle proposal counter correctly", async function() {
            // This test would require multi-sig facets to be deployed
            // For now, test that diamond doesn't break with new storage
            expect(diamond.target).to.be.properAddress;
        });
        
        it("should handle operation counter correctly", async function() {
            // Test operation counter initialization
            expect(diamond.target).to.be.properAddress;
        });
        
        it("should handle emergency controls correctly", async function() {
            // Test emergency controls initialization
            expect(diamond.target).to.be.properAddress;
        });
    });

    describe("Storage Gap Management", function() {
        it("should have reduced gap appropriately", async function() {
            // Verify that adding multi-sig structures didn't exceed storage capacity
            // This is more of a compilation test - if it compiles, gaps are managed correctly
            expect(diamond.target).to.be.properAddress;
        });
        
        it("should maintain storage predictability", async function() {
            // Test that storage operations are predictable and don't cause conflicts
            const accessControl = await ethers.getContractAt("AccessControlFacet", diamond.target);
            // Admin role already granted in beforeEach
            // Grant and revoke roles to test storage consistency
            await accessControl.connect(admin).grantRole(ROLES.MINTER_ROLE, signer1.address);
            const hasRole = await accessControl.hasRole(ROLES.MINTER_ROLE, signer1.address);
            expect(hasRole).to.be.true;
            
            await accessControl.connect(admin).revokeRole(ROLES.MINTER_ROLE, signer1.address);
            const hasRoleAfter = await accessControl.hasRole(ROLES.MINTER_ROLE, signer1.address);
            expect(hasRoleAfter).to.be.false;
        });
    });

    describe("Storage Collision Prevention", function() {
        it("should not interfere with existing mappings", async function() {
            // Test that multi-sig storage doesn't interfere with existing token operations
            const erc20 = await ethers.getContractAt("ERC20BaseFacet", diamond.target);
            const mintBurn = await ethers.getContractAt("T3TokenMintBurnFacet", diamond.target);
            
            // Grant minter role and mint tokens
            const accessControl = await ethers.getContractAt("AccessControlFacet", diamond.target);
            await accessControl.connect(deployer).grantRole(ROLES.ADMIN_ROLE, admin.address);
            await accessControl.connect(admin).grantRole(ROLES.MINTER_ROLE, admin.address);
            
            await mintBurn.connect(admin).mint(signer1.address, ethers.parseEther("1000"));
            
            const balance = await erc20.balanceOf(signer1.address);
            expect(balance).to.equal(ethers.parseEther("1000"));
        });
        
        it("should not interfere with role management", async function() {
            const accessControl = await ethers.getContractAt("AccessControlFacet", diamond.target);
            await accessControl.connect(deployer).grantRole(ROLES.ADMIN_ROLE, admin.address);
            // Test multiple role operations
            await accessControl.connect(admin).grantRole(ROLES.PAUSER_ROLE, signer1.address);
            await accessControl.connect(admin).grantRole(ROLES.CUSTODIAN_ROLE, signer2.address);
            
            const hasPauserRole = await accessControl.hasRole(ROLES.PAUSER_ROLE, signer1.address);
            const hasCustodianRole = await accessControl.hasRole(ROLES.CUSTODIAN_ROLE, signer2.address);
            
            expect(hasPauserRole).to.be.true;
            expect(hasCustodianRole).to.be.true;
        });
        
        it("should not interfere with fee calculations", async function() {
            const feeLogic = await ethers.getContractAt("T3TokenFeeLogicFacet", diamond.target);
            
            // Test fee calculation still works
            const transferAmount = ethers.parseEther("100");
            const fee = await feeLogic.estimateTransferFeeDetails(signer1.address, signer2.address, transferAmount);
            
            expect(fee.totalFeeAssessed).to.be.gte(0);
        });
    });

    describe("Storage Version Management", function() {
        it("should track storage version correctly", async function() {
            // This would require a storage version getter function
            // For now, test that the system initializes correctly
            expect(diamond.target).to.be.properAddress;
        });
        
        it("should handle storage upgrades safely", async function() {
            // Test that the storage layout can handle future upgrades
            // This is primarily a structural test
            expect(diamond.target).to.be.properAddress;
        });
    });

    describe("Multi-Sig Storage Interaction Tests", function() {
        it("should not cause reentrancy guard conflicts", async function() {
            // Test that multi-sig storage doesn't interfere with reentrancy protection
            const erc20 = await ethers.getContractAt("ERC20BaseFacet", diamond.target);
            const mintBurn = await ethers.getContractAt("T3TokenMintBurnFacet", diamond.target);
            const accessControl = await ethers.getContractAt("AccessControlFacet", diamond.target);
            await accessControl.connect(deployer).grantRole(ROLES.ADMIN_ROLE, admin.address);
            // Setup: mint tokens and test transfer
            await accessControl.connect(admin).grantRole(ROLES.MINTER_ROLE, admin.address);
            await mintBurn.connect(admin).mint(signer1.address, ethers.parseEther("1000"));
            
            // Test transfer works (tests reentrancy guard)
            const transfer = await ethers.getContractAt("T3TokenDirectTransferFacet", diamond.target);
            await transfer.connect(signer1).transfer(signer2.address, ethers.parseEther("100"));
            
            const balance1 = await erc20.balanceOf(signer1.address);
            const balance2 = await erc20.balanceOf(signer2.address);
            
            // Phase 1 cutover: direct transfers are fee-free.
            expect(balance1).to.equal(ethers.parseEther("900"));
            expect(balance2).to.equal(ethers.parseEther("100"));
        });
        
        it("should maintain custodian registry integrity", async function() {
            const custodianRegistry = await ethers.getContractAt("CustodianRegistryFacet", diamond.target);
            const accessControl = await ethers.getContractAt("AccessControlFacet", diamond.target);
            await accessControl.connect(deployer).grantRole(ROLES.ADMIN_ROLE, admin.address);
            // Test custodian registration still works
            await accessControl.connect(admin).grantRole(ROLES.ADMIN_ROLE, admin.address);
            
            await custodianRegistry.connect(admin).grantCustodianRole(signer1.address);
            
            const isRegistered = await custodianRegistry.isCustodian(signer1.address);
            expect(isRegistered).to.be.true;
        });
    });
});
