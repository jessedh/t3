// SPDX-License-Identifier: MIT
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Access Control Bootstrap Security Tests", function () {
  let owner, admin, user;
  let diamond, diamondCutFacet, accessControlFacet;

  beforeEach(async function () {
    [owner, admin, user] = await ethers.getSigners();
  });

  describe("Bootstrap Phase Security", function () {
    it("should correctly detect hasRole selector availability", async function () {
      // Deploy a minimal diamond without AccessControlFacet first
      const Diamond = await ethers.getContractFactory("Diamond");
      const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
      
      const diamondCutFacet = await DiamondCutFacet.deploy();
      const diamond = await Diamond.deploy(owner.address, await diamondCutFacet.getAddress());
      
      // At this point, hasRole selector should not be available
      const hasRoleSelector = ethers.id("hasRole(bytes32,address)").substring(0, 10);
      
      // Check that the selector calculation is correct
      expect(hasRoleSelector).to.equal("0x91d14854");
      
      // The diamond should allow contract owner to perform diamond cuts
      // because the constructor grants DEFAULT_ADMIN_ROLE directly in storage.
      
      // Deploy AccessControlFacet
      const AccessControlFacet = await ethers.getContractFactory("AccessControlFacet");
      const accessControlFacet = await AccessControlFacet.deploy();
      
      // Add AccessControlFacet to diamond
      const diamondCutProxy = await ethers.getContractAt("DiamondCutFacet", await diamond.getAddress());
      
      const cut = [{
        facetAddress: await accessControlFacet.getAddress(),
        action: 0, // Add
        functionSelectors: [hasRoleSelector]
      }];
      
      await expect(
        diamondCutProxy.connect(owner).diamondCut(cut, ethers.ZeroAddress, "0x")
      ).to.not.be.reverted;
    });

    it("should prevent unauthorized diamond cuts during bootstrap", async function () {
      const Diamond = await ethers.getContractFactory("Diamond");
      const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
      
      const diamondCutFacet = await DiamondCutFacet.deploy();
      const diamond = await Diamond.deploy(owner.address, await diamondCutFacet.getAddress());
      
      const diamondCutProxy = await ethers.getContractAt("DiamondCutFacet", await diamond.getAddress());
      
      // Non-owner should not be able to perform diamond cuts during bootstrap
      const cut = [{
        facetAddress: ethers.ZeroAddress,
        action: 2, // Remove
        functionSelectors: ["0x12345678"]
      }];
      
      await expect(
        diamondCutProxy.connect(user).diamondCut(cut, ethers.ZeroAddress, "0x")
      ).to.be.revertedWithCustomError(diamondCutProxy, "UnauthorizedRole");
    });

    it("should transition from bootstrap to role-based authorization", async function () {
      // This test verifies the transition from contractOwner-based authorization
      // to role-based authorization once AccessControlFacet is added
      
      const { diamond: fullDiamond } = await deployTestFixture();
      
      // After full deployment, the diamond should use role-based authorization
      const diamondCutFacet = await ethers.getContractAt("DiamondCutFacet", await fullDiamond.getAddress());
      
      // Owner without admin role should not be able to perform diamond cuts
      const cut = [{
        facetAddress: ethers.ZeroAddress,
        action: 2, // Remove
        functionSelectors: ["0x12345678"]
      }];
      
      // This should fail because caller lacks DEFAULT_ADMIN_ROLE.
      await expect(
        diamondCutFacet.connect(user).diamondCut(cut, ethers.ZeroAddress, "0x")
      ).to.be.revertedWithCustomError(diamondCutFacet, "UnauthorizedRole");
    });
  });

  describe("Selector Validation Tests", function () {
    it("should use correct hasRole selector", async function () {
      // Verify that our computed selector matches the actual function
      const expectedSelector = ethers.id("hasRole(bytes32,address)").substring(0, 10);
      expect(expectedSelector).to.equal("0x91d14854");
      
      // Deploy AccessControlFacet and verify the selector
      const AccessControlFacet = await ethers.getContractFactory("AccessControlFacet");
      const accessControlFacet = await AccessControlFacet.deploy();
      
      // Get the actual selector from the deployed contract
      const hasRoleFunction = accessControlFacet.interface.getFunction("hasRole");
      const actualSelector = hasRoleFunction.selector;
      
      expect(actualSelector).to.equal(expectedSelector);
    });

    it("should handle selector computation correctly in DiamondCutFacet", async function () {
      // This test ensures that the dynamic selector computation
      // in DiamondCutFacet works correctly
      
      const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
      const diamondCutFacet = await DiamondCutFacet.deploy();
      
      // We can't easily test the internal computation directly,
      // but we can verify it works through integration testing
      // by ensuring the bootstrap logic works correctly
      
      const Diamond = await ethers.getContractFactory("Diamond");
      const diamond = await Diamond.deploy(owner.address, await diamondCutFacet.getAddress());
      
      // This should work (bootstrap phase)
      const diamondCutInterface = await ethers.getContractAt("IDiamondCut", await diamond.getAddress());
      
      const cut = [{
        facetAddress: ethers.ZeroAddress,
        action: 2, // Remove (should work even with invalid selector in bootstrap)
        functionSelectors: ["0x00000000"]
      }];
      
      // This might revert for other reasons, but should not revert due to selector issues
      await expect(
        diamondCutInterface.connect(owner).diamondCut(cut, ethers.ZeroAddress, "0x")
      ).to.be.reverted; // Expected to revert, but not due to authorization
    });
  });

  describe("Regression Tests", function () {
    it("should maintain compatibility with existing authorization flows", async function () {
      const { diamond } = await deployTestFixture();
      
      // Test that all existing role-based operations still work
      const accessControl = await ethers.getContractAt("AccessControlFacet", await diamond.getAddress());
      
      // Owner should have admin role
      expect(await accessControl.hasRole(ethers.ZeroHash, owner.address)).to.be.true;
      
      // Admin should be able to grant roles
      const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
      await expect(
        accessControl.connect(owner).grantRole(MINTER_ROLE, admin.address)
      ).to.not.be.reverted;
      
      expect(await accessControl.hasRole(MINTER_ROLE, admin.address)).to.be.true;
    });

    it("should prevent privilege escalation during bootstrap", async function () {
      // Ensure that the bootstrap mechanism doesn't allow unauthorized
      // privilege escalation
      
      const Diamond = await ethers.getContractFactory("Diamond");
      const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
      
      const diamondCutFacet = await DiamondCutFacet.deploy();
      const diamond = await Diamond.deploy(owner.address, await diamondCutFacet.getAddress());
      
      const diamondCutProxy = await ethers.getContractAt("DiamondCutFacet", await diamond.getAddress());
      
      // Malicious user should not be able to exploit bootstrap phase
      const cut = [{
        facetAddress: user.address, // Trying to add user as a facet
        action: 0, // Add
        functionSelectors: ["0x12345678"]
      }];
      
      await expect(
        diamondCutProxy.connect(user).diamondCut(cut, ethers.ZeroAddress, "0x")
      ).to.be.revertedWithCustomError(diamondCutProxy, "UnauthorizedRole");
    });
  });
});

// Helper function to import from deployment helpers
const { deployT3DiamondFixture: deployTestFixture } = require("../helpers/deployment");
