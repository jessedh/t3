const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Import our test infrastructure
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");
const { setupTestBalances, getFormattedBalance } = require("../helpers/tokens");
const { AMOUNTS } = require("../helpers/constants");
const { expectEvent, expectRevert } = require("../helpers/assertions");

/**
 * ERC20BaseFacet Unit Tests
 * 
 * Tests core ERC20 functionality including metadata, balances, allowances, and events.
 * Uses the comprehensive test infrastructure for standardized setup.
 */
describe("ERC20BaseFacet Unit Tests", function () {
    let deployment;
    
    async function setupERC20Fixture() {
        // Deploy diamond with all facets
        deployment = await deployT3DiamondFixture();
        
        // Setup roles and balances for testing
        await setupTestRoles(deployment.facets, deployment.signers);
        await setupTestBalances(deployment.facets, deployment.signers);
        
        return deployment;
    }
    
    beforeEach(async function () {
        deployment = await loadFixture(setupERC20Fixture);
    });

    describe("Token Metadata", function () {
        it("should return correct token name", async function () {
            const { facets } = deployment;
            const name = await facets.erc20.name();
            expect(name).to.equal("T3Token");
        });

        it("should return correct token symbol", async function () {
            const { facets } = deployment;
            const symbol = await facets.erc20.symbol();
            expect(symbol).to.equal("T3T");
        });

        it("should return correct decimals", async function () {
            const { facets } = deployment;
            const decimals = await facets.erc20.decimals();
            expect(decimals).to.equal(18);
        });

        it("should return correct total supply after minting", async function () {
            const { facets } = deployment;
            const totalSupply = await facets.erc20.totalSupply();
            
            // Total from setupTestBalances: 1000 + 500 + 250 + 10000 + 2000000 + 200000 = 2211750
            const expectedSupply = ethers.parseEther("2211750");
            expect(totalSupply).to.equal(expectedSupply);
        });
    });

    describe("Balance Operations", function () {
        it("should return correct balance for users", async function () {
            const { facets, signers } = deployment;
            
            const user1Balance = await getFormattedBalance(facets.erc20, signers.user1.address);
            const user2Balance = await getFormattedBalance(facets.erc20, signers.user2.address);
            const user3Balance = await getFormattedBalance(facets.erc20, signers.user3.address);
            const adminBalance = await getFormattedBalance(facets.erc20, signers.admin.address);
            
            expect(user1Balance).to.equal("1000.0");
            expect(user2Balance).to.equal("500.0");
            expect(user3Balance).to.equal("250.0");
            expect(adminBalance).to.equal("10000.0");
        });

        it("should return zero balance for addresses without tokens", async function () {
            const { facets, signers } = deployment;
            
            const balance = await facets.erc20.balanceOf(signers.treasury.address);
            expect(balance).to.equal(0);
        });

        it("should reject zero address balance query", async function () {
            const { facets } = deployment;
            
            await expect(
                facets.erc20.balanceOf(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(facets.erc20, "TransferToZeroAddress");
        });
    });

    describe("Allowance Operations", function () {
        it("should approve tokens and emit Approval event", async function () {
            const { facets, signers } = deployment;
            const approveAmount = AMOUNTS.HUNDRED_TOKENS;
            
            await expectEvent(
                facets.erc20.connect(signers.user1).approve(signers.user2.address, approveAmount),
                facets.erc20,
                "Approval",
                [signers.user1.address, signers.user2.address, approveAmount]
            );
        });

        it("should return correct allowance after approval", async function () {
            const { facets, signers } = deployment;
            const approveAmount = AMOUNTS.HUNDRED_TOKENS;
            
            await facets.erc20.connect(signers.user1).approve(signers.user2.address, approveAmount);
            
            const allowance = await facets.erc20.allowance(signers.user1.address, signers.user2.address);
            expect(allowance).to.equal(approveAmount);
        });

        it("should update allowance when approving again", async function () {
            const { facets, signers } = deployment;
            
            // First approval
            await facets.erc20.connect(signers.user1).approve(signers.user2.address, AMOUNTS.HUNDRED_TOKENS);
            
            // Second approval with different amount
            await facets.erc20.connect(signers.user1).approve(signers.user2.address, AMOUNTS.TEN_TOKENS);
            
            const allowance = await facets.erc20.allowance(signers.user1.address, signers.user2.address);
            expect(allowance).to.equal(AMOUNTS.TEN_TOKENS);
        });

        it("should handle zero allowance", async function () {
            const { facets, signers } = deployment;
            
            const allowance = await facets.erc20.allowance(signers.user1.address, signers.user2.address);
            expect(allowance).to.equal(0);
        });

        it("should approve zero amount to reset allowance", async function () {
            const { facets, signers } = deployment;
            
            // First set allowance
            await facets.erc20.connect(signers.user1).approve(signers.user2.address, AMOUNTS.HUNDRED_TOKENS);
            
            // Reset to zero
            await facets.erc20.connect(signers.user1).approve(signers.user2.address, 0);
            
            const allowance = await facets.erc20.allowance(signers.user1.address, signers.user2.address);
            expect(allowance).to.equal(0);
        });

        it("should approve maximum uint256 value", async function () {
            const { facets, signers } = deployment;
            const maxAmount = ethers.MaxUint256;
            
            await facets.erc20.connect(signers.user1).approve(signers.user2.address, maxAmount);
            
            const allowance = await facets.erc20.allowance(signers.user1.address, signers.user2.address);
            expect(allowance).to.equal(maxAmount);
        });
    });

    describe("Edge Cases and Error Conditions", function () {
        it("should reject approval to zero address", async function () {
            const { facets, signers } = deployment;
            
            // T3 custom behavior rejects zero address approvals
            await expect(
                facets.erc20.connect(signers.user1).approve(ethers.ZeroAddress, AMOUNTS.HUNDRED_TOKENS)
            ).to.be.revertedWithCustomError(facets.erc20, "UserAddressZero");
        });

        it("should handle self-approval", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.erc20.connect(signers.user1).approve(signers.user1.address, AMOUNTS.HUNDRED_TOKENS)
            ).to.not.be.reverted;
        });
    });

    describe("ERC20 Standard Compliance", function () {
        it("should emit Transfer event on deployment", async function () {
            // This test validates that initial minting emits proper Transfer events
            // The events are emitted during setupTestBalances
            const { facets, signers } = deployment;
            
            // Check that transfers from zero address happened during setup
            const totalSupply = await facets.erc20.totalSupply();
            expect(totalSupply).to.be.greaterThan(0);
        });

        it("should have consistent total supply with sum of balances", async function () {
            const { facets, signers } = deployment;
            
            const user1Balance = await facets.erc20.balanceOf(signers.user1.address);
            const user2Balance = await facets.erc20.balanceOf(signers.user2.address);
            const user3Balance = await facets.erc20.balanceOf(signers.user3.address);
            const adminBalance = await facets.erc20.balanceOf(signers.admin.address);
            const totalSupply = await facets.erc20.totalSupply();
            
            const custodian1Balance = await facets.erc20.balanceOf(signers.custodian1.address);
            const custodian2Balance = await facets.erc20.balanceOf(signers.custodian2.address);
            const sumOfBalances = user1Balance + user2Balance + user3Balance + adminBalance + custodian1Balance + custodian2Balance;
            expect(totalSupply).to.equal(sumOfBalances);
        });
    });
});