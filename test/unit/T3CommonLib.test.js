const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture, getSelectors, FacetCutAction } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");
const { setupTestBalances } = require("../helpers/tokens");
const { AMOUNTS, ROLES } = require("../helpers/constants");

describe("T3CommonLib Comprehensive Tests", function () {
    let deployment, testContract, admin, user1, user2, nonKycUser;

    beforeEach(async function () {
        deployment = await loadFixture(deployT3DiamondFixture);
        const { signers, facets, diamond } = deployment;
        admin = signers.admin;
        user1 = signers.user1;
        user2 = signers.user2;
        nonKycUser = signers.user3;

        await setupTestRoles(deployment.facets, deployment.signers);
        await setupTestBalances(deployment.facets, deployment.signers);

        // Grant KYC to user1 and user2
        await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(user1.address, await time.latest(), 0);
        await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(user2.address, await time.latest(), 0);

        // Deploy TestT3CommonLib and add it as a facet
        const TestT3CommonLib = await ethers.getContractFactory("TestT3CommonLib");
        const testT3CommonLib = await TestT3CommonLib.deploy();
        await testT3CommonLib.waitForDeployment();

        const cut = [{
            facetAddress: await testT3CommonLib.getAddress(),
            action: FacetCutAction.Add,
            functionSelectors: getSelectors(testT3CommonLib)
        }];
        await facets.diamondCut.diamondCut(cut, ethers.ZeroAddress, "0x");

        testContract = await ethers.getContractAt("TestT3CommonLib", await diamond.getAddress());

        // Set KYC cache duration so cache doesn't expire immediately (M-3 fix: expired cache returns false)
        await testContract.connect(admin).testSetKycCacheDuration(3600); // 1 hour

        // Refresh KYC cache for users
        await testContract.connect(admin).testRefreshKycCache(user1.address);
        await testContract.connect(admin).testRefreshKycCache(user2.address);
    });

    describe("calculateKycMinimumHalfLife", function () {
        it("should return 0 if both parties are KYC'd", async function () {
            const usdValue = ethers.parseEther("100");
            const halfLife = await testContract.testCalculateKycMinimumHalfLife.staticCall(user1.address, user2.address, usdValue);
            expect(halfLife).to.equal(0);
        });

        it("should calculate correct half-life if sender is not KYC'd", async function () {
            const usdValue = ethers.parseEther("100"); // $100
            const halfLife = await testContract.testCalculateKycMinimumHalfLife.staticCall(nonKycUser.address, user1.address, usdValue);
            expect(halfLife).to.equal(2340);
        });

        it("should calculate correct half-life if recipient is not KYC'd", async function () {
            const usdValue = ethers.parseEther("10000"); // $10,000
            const halfLife = await testContract.testCalculateKycMinimumHalfLife.staticCall(user1.address, nonKycUser.address, usdValue);
            expect(halfLife).to.equal(86400);
        });
    });

    describe("calculateAdaptiveHalfLife", function () {
        beforeEach(async function() {
            const { facets, signers } = deployment;
            await facets.mintBurn.connect(signers.minter).mint(user1.address, ethers.parseEther("1000"));
        });

        it("should reduce half-life based on transaction history", async function () {
            const { facets } = deployment;
            await facets.directTransfer.connect(user1).transfer(user2.address, AMOUNTS.TEN_TOKENS);
            await facets.directTransfer.connect(user1).transfer(user2.address, AMOUNTS.TEN_TOKENS);

            const halfLife = await testContract.testCalculateAdaptiveHalfLife.staticCall(user1.address, user2.address, AMOUNTS.TEN_TOKENS);
            const defaultHalfLife = (await facets.admin.getHalfLifeParameters())[0];
            expect(halfLife).to.be.closeTo(defaultHalfLife * 80n / 100n, 1);
        });
    });
});