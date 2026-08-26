const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Import our test infrastructure
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");
const { AMOUNTS } = require("../helpers/constants");
const { expectEvent } = require("../helpers/assertions");

/**
 * ERC20PausableFacet Unit Tests
 * 
 * Tests pause/unpause functionality with proper role-based access control.
 * Ensures that all token operations are properly restricted when paused.
 */
describe("ERC20PausableFacet Unit Tests", function () {
    let deployment;
    
    async function setupPausableFixture() {
        // Deploy diamond with all facets
        deployment = await deployT3DiamondFixture();
        
        // Setup roles and some initial balances for transfer testing
        await setupTestRoles(deployment.facets, deployment.signers);
        
        // Mint some tokens for transfer testing
        const { facets, signers } = deployment;
        await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, AMOUNTS.THOUSAND_TOKENS);
        await facets.mintBurn.connect(signers.minter).mint(signers.user2.address, AMOUNTS.HUNDRED_TOKENS);
        
        return deployment;
    }
    
    beforeEach(async function () {
        deployment = await loadFixture(setupPausableFixture);
    });

    describe("Pause State Query", function () {
        it("should return false for paused state initially", async function () {
            const { facets } = deployment;
            
            const isPaused = await facets.pausable.paused();
            expect(isPaused).to.be.false;
        });

        it("should return true for paused state after pausing", async function () {
            const { facets, signers } = deployment;
            
            await facets.pausable.connect(signers.pauser).pause();
            
            const isPaused = await facets.pausable.paused();
            expect(isPaused).to.be.true;
        });
    });

    describe("Pause Operations", function () {
        it("should allow PAUSER_ROLE to pause contract", async function () {
            const { facets, signers } = deployment;
            
            await expectEvent(
                facets.pausable.connect(signers.pauser).pause(),
                facets.pausable,
                "Paused",
                [signers.pauser.address]
            );
            
            const isPaused = await facets.pausable.paused();
            expect(isPaused).to.be.true;
        });

        it("should reject pause from non-PAUSER_ROLE", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.pausable.connect(signers.user1).pause()
            ).to.be.revertedWithCustomError(facets.pausable, "UnauthorizedRole");
        });

        it("should reject pause from admin without PAUSER_ROLE", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.pausable.connect(signers.admin).pause()
            ).to.be.revertedWithCustomError(facets.pausable, "UnauthorizedRole");
        });

        it("should reject pause when already paused", async function () {
            const { facets, signers } = deployment;
            
            // First pause
            await facets.pausable.connect(signers.pauser).pause();
            
            // Try to pause again
            await expect(
                facets.pausable.connect(signers.pauser).pause()
            ).to.be.revertedWith("Pausable: already paused");
        });
    });

    describe("Unpause Operations", function () {
        beforeEach(async function () {
            // Pause the contract for unpause tests
            const { facets, signers } = deployment;
            await facets.pausable.connect(signers.pauser).pause();
        });

        it("should allow PAUSER_ROLE to unpause contract", async function () {
            const { facets, signers } = deployment;
            
            await expectEvent(
                facets.pausable.connect(signers.pauser).unpause(),
                facets.pausable,
                "Unpaused",
                [signers.pauser.address]
            );
            
            const isPaused = await facets.pausable.paused();
            expect(isPaused).to.be.false;
        });

        it("should reject unpause from non-PAUSER_ROLE", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.pausable.connect(signers.user1).unpause()
            ).to.be.revertedWithCustomError(facets.pausable, "UnauthorizedRole");
        });

        it("should reject unpause when not paused", async function () {
            const { facets, signers } = deployment;
            
            // First unpause
            await facets.pausable.connect(signers.pauser).unpause();
            
            // Try to unpause again
            await expect(
                facets.pausable.connect(signers.pauser).unpause()
            ).to.be.revertedWith("Pausable: not paused");
        });
    });

    describe("Pause/Unpause Cycles", function () {
        it("should handle multiple pause/unpause cycles", async function () {
            const { facets, signers } = deployment;
            
            // Initial state
            expect(await facets.pausable.paused()).to.be.false;
            
            // Cycle 1: Pause -> Unpause
            await facets.pausable.connect(signers.pauser).pause();
            expect(await facets.pausable.paused()).to.be.true;
            
            await facets.pausable.connect(signers.pauser).unpause();
            expect(await facets.pausable.paused()).to.be.false;
            
            // Cycle 2: Pause -> Unpause
            await facets.pausable.connect(signers.pauser).pause();
            expect(await facets.pausable.paused()).to.be.true;
            
            await facets.pausable.connect(signers.pauser).unpause();
            expect(await facets.pausable.paused()).to.be.false;
        });

        it("should emit correct events during cycles", async function () {
            const { facets, signers } = deployment;
            
            // Pause
            await expectEvent(
                facets.pausable.connect(signers.pauser).pause(),
                facets.pausable,
                "Paused",
                [signers.pauser.address]
            );
            
            // Unpause
            await expectEvent(
                facets.pausable.connect(signers.pauser).unpause(),
                facets.pausable,
                "Unpaused",
                [signers.pauser.address]
            );
        });
    });

    describe("Integration with Transfer Operations", function () {
        it("should allow transfers when not paused", async function () {
            const { facets, signers } = deployment;
            
            // Verify not paused
            expect(await facets.pausable.paused()).to.be.false;
            
            // Transfer should work
            await expect(
                facets.directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.TEN_TOKENS)
            ).to.not.be.reverted;
        });

        it("should reject transfers when paused", async function () {
            const { facets, signers } = deployment;
            
            // Pause the contract
            await facets.pausable.connect(signers.pauser).pause();
            
            // Transfer should fail with paused error
            await expect(
                facets.directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.TEN_TOKENS)
            ).to.be.revertedWith("Pausable: paused");
        });

        it("should allow transfers again after unpausing", async function () {
            const { facets, signers } = deployment;
            
            // Pause, then unpause
            await facets.pausable.connect(signers.pauser).pause();
            await facets.pausable.connect(signers.pauser).unpause();
            
            // Transfer should work again
            await expect(
                facets.directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.TEN_TOKENS)
            ).to.not.be.reverted;
        });
    });

    describe("Integration with Minting Operations", function () {
        it("should allow minting when not paused", async function () {
            const { facets, signers } = deployment;
            
            // Verify not paused
            expect(await facets.pausable.paused()).to.be.false;
            
            // Mint should work
            await expect(
                facets.mintBurn.connect(signers.minter).mint(signers.user3.address, AMOUNTS.HUNDRED_TOKENS)
            ).to.not.be.reverted;
        });

        it("should allow minting even when paused (admin operations)", async function () {
            const { facets, signers } = deployment;
            
            // Pause the contract
            await facets.pausable.connect(signers.pauser).pause();
            
            // Mint should still work (admin operations not restricted by pause)
            await expect(
                facets.mintBurn.connect(signers.minter).mint(signers.user3.address, AMOUNTS.HUNDRED_TOKENS)
            ).to.not.be.reverted;
        });
    });

    describe("Integration with Approval Operations", function () {
        it("should allow approvals when not paused", async function () {
            const { facets, signers } = deployment;
            
            // Verify not paused
            expect(await facets.pausable.paused()).to.be.false;
            
            // Approval should work
            await expect(
                facets.erc20.connect(signers.user1).approve(signers.user2.address, AMOUNTS.HUNDRED_TOKENS)
            ).to.not.be.reverted;
        });

        it("should allow approvals even when paused (permission setting)", async function () {
            const { facets, signers } = deployment;
            
            // Pause the contract
            await facets.pausable.connect(signers.pauser).pause();
            
            // Approval should still work (setting permissions not restricted by pause)
            await expect(
                facets.erc20.connect(signers.user1).approve(signers.user2.address, AMOUNTS.HUNDRED_TOKENS)
            ).to.not.be.reverted;
        });
    });

    describe("Role-Based Access Control", function () {
        it("should only allow PAUSER_ROLE to pause/unpause", async function () {
            const { facets, signers } = deployment;
            
            // Test that non-pauser roles cannot pause
            await expect(
                facets.pausable.connect(signers.minter).pause()
            ).to.be.revertedWithCustomError(facets.pausable, "UnauthorizedRole");
            
            await expect(
                facets.pausable.connect(signers.user1).pause()
            ).to.be.revertedWithCustomError(facets.pausable, "UnauthorizedRole");
            
            // But pauser can pause
            await expect(
                facets.pausable.connect(signers.pauser).pause()
            ).to.not.be.reverted;
        });

        it("should allow multiple pausers if role is granted to multiple accounts", async function () {
            const { facets, signers } = deployment;
            
            // Grant PAUSER_ROLE to user1
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.PAUSER_ROLE, signers.user1.address);
            
            // Both original pauser and user1 should be able to pause
            await facets.pausable.connect(signers.pauser).pause();
            await facets.pausable.connect(signers.user1).unpause();
            await facets.pausable.connect(signers.user1).pause();
            await facets.pausable.connect(signers.pauser).unpause();
        });
    });

    describe("Edge Cases", function () {
        it("should handle pausing/unpausing with zero address events correctly", async function () {
            const { facets, signers } = deployment;
            
            // Pause and check event emitter is correct
            const pauseTx = await facets.pausable.connect(signers.pauser).pause();
            const pauseReceipt = await pauseTx.wait();
            
            const pauseEvent = pauseReceipt.logs.find(log => {
                try {
                    const parsed = facets.pausable.interface.parseLog(log);
                    return parsed.name === "Paused";
                } catch {
                    return false;
                }
            });
            
            expect(pauseEvent).to.not.be.undefined;
        });

        it("should maintain pause state through other operations", async function () {
            const { facets, signers } = deployment;
            
            // Pause
            await facets.pausable.connect(signers.pauser).pause();
            expect(await facets.pausable.paused()).to.be.true;
            
            // Other operations that don't affect pause state
            await facets.erc20.balanceOf(signers.user1.address);
            await facets.erc20.totalSupply();
            
            // Should still be paused
            expect(await facets.pausable.paused()).to.be.true;
        });
    });
});