const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployT3DiamondFixture, FacetCutAction } = require("../helpers/deployment");

describe("DiamondCut Authorization Security", function () {
    let diamond, diamondAddress, diamondCut, accessControl;
    let owner, admin, attacker;

    beforeEach(async function () {
        const fixture = await deployT3DiamondFixture();
        diamond = fixture.diamond;
        diamondAddress = fixture.diamondAddress;
        owner = fixture.signers.owner;
        admin = fixture.signers.admin;
        attacker = fixture.signers.user1;

        diamondCut = await ethers.getContractAt("DiamondCutFacet", diamondAddress);
        accessControl = await ethers.getContractAt("AccessControlFacet", diamondAddress);

        // Grant DEFAULT_ADMIN_ROLE to admin for tests that need a secondary admin
        await accessControl.connect(owner).grantRole(ethers.ZeroHash, admin.address);
    });

    const validCut = [];
    const ZeroAddress = ethers.ZeroAddress;

    async function replacePublicHasRoleWithAlwaysFalseFacet() {
        const MockFacet = await ethers.getContractFactory("MockAlwaysFalseHasRoleFacet");
        const mockFacet = await MockFacet.deploy();
        await mockFacet.waitForDeployment();
        const selector = ethers.id("hasRole(bytes32,address)").substring(0, 10);
        const cut = [{
            facetAddress: await mockFacet.getAddress(),
            action: FacetCutAction.Replace,
            functionSelectors: [selector]
        }];
        await diamondCut.connect(owner).diamondCut(cut, ZeroAddress, "0x");
    }

    async function removePublicHasRoleSelector() {
        const selector = ethers.id("hasRole(bytes32,address)").substring(0, 10);
        const cut = [{
            facetAddress: ZeroAddress,
            action: FacetCutAction.Remove,
            functionSelectors: [selector]
        }];
        await diamondCut.connect(admin).diamondCut(cut, ZeroAddress, "0x");
    }

    it("authorizes diamondCut from storage even when hasRole selector is REPLACED with always-false", async function () {
        await replacePublicHasRoleWithAlwaysFalseFacet();
        await expect(diamondCut.connect(admin).diamondCut(validCut, ZeroAddress, "0x")).not.to.be.reverted;
        await expect(diamondCut.connect(attacker).diamondCut(validCut, ZeroAddress, "0x"))
            .to.be.revertedWithCustomError(accessControl, "UnauthorizedRole");
    });

    it("authorizes diamondCut from storage even when hasRole selector is REMOVED entirely", async function () {
        // Make owner a former owner by revoking its DEFAULT_ADMIN_ROLE before removing hasRole
        await accessControl.connect(admin).revokeRole(ethers.ZeroHash, owner.address);
        await removePublicHasRoleSelector();
        // Removal must NOT revive contractOwner authority.
        await expect(diamondCut.connect(admin).diamondCut(validCut, ZeroAddress, "0x")).not.to.be.reverted;
        await expect(diamondCut.connect(owner).diamondCut(validCut, ZeroAddress, "0x"))
            .to.be.revertedWithCustomError(accessControl, "UnauthorizedRole");
    });

    it("FIX E3: diamondCut ignores appended ERC-2771 sender and authorizes bare msg.sender", async function () {
        // Set up an ERC-2771 environment by registering a trusted forwarder.
        const Forwarder = await ethers.getContractFactory("DebugForwarder");
        const forwarder = await Forwarder.deploy("T3DebugForwarder");
        await forwarder.waitForDeployment();

        const erc2771 = await ethers.getContractAt("ERC2771ContextFacet", diamondAddress);
        await erc2771.connect(owner).setTrustedForwarder(await forwarder.getAddress());

        // Build a diamondCut call and append an admin address (ERC-2771 style) to the calldata.
        const baseCalldata = diamondCut.interface.encodeFunctionData("diamondCut", [validCut, ZeroAddress, "0x"]);
        const spoofedCalldata = baseCalldata + admin.address.slice(2);

        // A non-admin caller must not be authorized as the appended admin.
        await expect(
            attacker.sendTransaction({ to: diamondAddress, data: spoofedCalldata })
        )
            .to.be.revertedWithCustomError(accessControl, "UnauthorizedRole")
            .withArgs(attacker.address, ethers.ZeroHash);
    });
});
