const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

// Import our new test infrastructure
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES, grantRole } = require("../helpers/roles");
const { setupTestBalances, transferTokens, getFormattedBalance } = require("../helpers/tokens");
const { AMOUNTS } = require("../helpers/constants");
const { expectEvent, expectRole, expectBalanceChange } = require("../helpers/assertions");

/**
 * Golden Path Integration Test
 * 
 * This test validates the complete test infrastructure and demonstrates
 * a successful end-to-end workflow that all other tests should follow.
 */
describe("Golden Path Integration Test", function () {
    let deployment;
    
    async function setupCompleteFixture() {
        // Deploy diamond with all facets
        deployment = await deployT3DiamondFixture();
        
        // Setup roles
        await setupTestRoles(deployment.facets, deployment.signers);

        const { facets, signers } = deployment;
        await grantRole(facets.accessControl, ROLES.CAMBIO_ADMIN_ROLE, signers.admin.address, signers.owner);
        await grantRole(facets.accessControl, ROLES.CAMBIO_ISSUER_ROLE, signers.user1.address, signers.owner);
        await grantRole(facets.accessControl, ROLES.CAMBIO_REDEEMER_ROLE, signers.user2.address, signers.owner);

        await facets.cambioAdmin
            .connect(signers.admin)
            .setCambioConfig(ethers.parseEther("1000000000"), 3600, 0, 4096);
        
        // Setup token balances
        await setupTestBalances(deployment.facets, deployment.signers);
        
        return deployment;
    }
    
    beforeEach(async function () {
        deployment = await loadFixture(setupCompleteFixture);
    });

    describe("Infrastructure Validation", function () {
        it("should deploy diamond with all facets", async function () {
            const { facets, diamondAddress } = deployment;
            
            // Verify diamond is deployed
            expect(diamondAddress).to.be.properAddress;
            
            // Verify core facets are attached
            expect(facets.erc20).to.exist;
            expect(facets.accessControl).to.exist;
            expect(facets.mintBurn).to.exist;
            expect(facets.custodian).to.exist;
            
            // Verify diamond loupe works
            const facetList = await facets.diamondLoupe.facets();
            expect(facetList.length).to.be.greaterThan(5);
        });

        it("should have correct token metadata", async function () {
            const { facets } = deployment;
            
            const name = await facets.erc20.name();
            const symbol = await facets.erc20.symbol();
            const decimals = await facets.erc20.decimals();
            
            expect(name).to.equal("T3Token");
            expect(symbol).to.equal("T3T");
            expect(decimals).to.equal(18);
        });

        it("should have roles properly configured", async function () {
            const { facets, signers } = deployment;
            
            // Check that roles were granted correctly
            await expectRole(facets.accessControl, ROLES.DEFAULT_ADMIN_ROLE, signers.owner.address);
            await expectRole(facets.accessControl, ROLES.ADMIN_ROLE, signers.admin.address);
            await expectRole(facets.accessControl, ROLES.MINTER_ROLE, signers.minter.address);
            await expectRole(facets.accessControl, ROLES.PAUSER_ROLE, signers.pauser.address);
            await expectRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, signers.custodian1.address);
        });

        it("should have test balances minted", async function () {
            const { facets, signers } = deployment;
            
            // Check that tokens were minted correctly
            const user1Balance = await getFormattedBalance(facets.erc20, signers.user1.address);
            const user2Balance = await getFormattedBalance(facets.erc20, signers.user2.address);
            const adminBalance = await getFormattedBalance(facets.erc20, signers.admin.address);
            
            expect(user1Balance).to.equal("1000.0");
            expect(user2Balance).to.equal("500.0");
            expect(adminBalance).to.equal("10000.0");
        });
    });

    describe("Core Token Functionality", function () {
        it("should transfer tokens between users", async function () {
            const { facets, signers } = deployment;
            
            const transferAmount = AMOUNTS.TEN_TOKENS;
            // Phase 1 cutover: T3TokenDirectTransferFacet is fee-free
            const expectedFee = 0n;
            const totalDeduction = transferAmount + expectedFee;
            
            // Execute transfer using T3TokenDirectTransferFacet
            await expectBalanceChange(
                () => facets.directTransfer.connect(signers.user1).transfer(signers.user2.address, transferAmount),
                facets.erc20,
                signers.user1.address,
                -totalDeduction
            );
            
            // Verify recipient balance increased by full transfer amount (no fees)
            const user2Balance = await facets.erc20.balanceOf(signers.user2.address);
            expect(user2Balance).to.equal(AMOUNTS.TEN_TOKENS + ethers.parseEther("500"));
        });

        it("should approve and transferFrom tokens", async function () {
            const { facets, signers } = deployment;
            
            const approveAmount = AMOUNTS.HUNDRED_TOKENS;
            const transferAmount = AMOUNTS.TEN_TOKENS;
            // Phase 1 cutover: T3TokenDirectTransferFacet is fee-free
            const expectedFee = 0n;
            const totalDeduction = transferAmount + expectedFee;
            
            // Approve tokens using ERC20BaseFacet  
            await expectEvent(
                facets.erc20.connect(signers.user1).approve(signers.user2.address, approveAmount),
                facets.erc20,
                "Approval",
                [signers.user1.address, signers.user2.address, approveAmount]
            );
            
            // Check allowance
            const allowance = await facets.erc20.allowance(signers.user1.address, signers.user2.address);
            expect(allowance).to.equal(approveAmount);
            
            // Phase 1 cutover: half-life logic decommissioned; no wait required
            
            // Transfer using allowance via T3TokenDirectTransferFacet (fee-free)
            await expectBalanceChange(
                () => facets.directTransfer.connect(signers.user2).transferFrom(
                    signers.user1.address, 
                    signers.user3.address, 
                    transferAmount
                ),
                facets.erc20,
                signers.user1.address,
                -totalDeduction
            );
        });

        it("should mint and burn tokens with proper roles", async function () {
            const { facets, signers } = deployment;
            
            const mintAmount = AMOUNTS.HUNDRED_TOKENS;
            const burnAmount = AMOUNTS.TEN_TOKENS;
            
            // Mint tokens
            await expectEvent(
                facets.mintBurn.connect(signers.minter).mint(signers.user3.address, mintAmount),
                facets.erc20,
                "Transfer",
                [ethers.ZeroAddress, signers.user3.address, mintAmount]
            );
            
            // Burn tokens (user can burn their own)
            await expectEvent(
                facets.mintBurn.connect(signers.user3).burn(burnAmount),
                facets.erc20,
                "Transfer",
                [signers.user3.address, ethers.ZeroAddress, burnAmount]
            );
            
            // Verify final balance
            const finalBalance = await facets.erc20.balanceOf(signers.user3.address);
            const expectedBalance = ethers.parseEther("250") + mintAmount - burnAmount;
            expect(finalBalance).to.equal(expectedBalance);
        });
    });

    describe("Access Control Functionality", function () {
        it("should pause and unpause contract", async function () {
            const { facets, signers } = deployment;
            
            // Pause contract
            await expectEvent(
                facets.erc20Pausable.connect(signers.pauser).pause(),
                facets.erc20Pausable,
                "Paused",
                [signers.pauser.address]
            );
            
            // Verify paused state
            const isPaused = await facets.erc20Pausable.paused();
            expect(isPaused).to.be.true;
            
            // Verify transfers are blocked (T3 uses string error, not custom error)
            await expect(
                facets.directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.ONE_TOKEN)
            ).to.be.revertedWith("Pausable: paused");
            
            // Unpause contract
            await expectEvent(
                facets.erc20Pausable.connect(signers.pauser).unpause(),
                facets.erc20Pausable,
                "Unpaused",
                [signers.pauser.address]
            );
            
            // Verify transfers work again
            await expect(
                facets.directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.ONE_TOKEN)
            ).to.not.be.reverted;
        });

        it("should grant and revoke roles", async function () {
            const { facets, signers } = deployment;
            
            // Grant new role
            await expectEvent(
                facets.accessControl.connect(signers.owner).grantRole(ROLES.MINTER_ROLE, signers.user3.address),
                facets.accessControl,
                "RoleGranted",
                [ROLES.MINTER_ROLE, signers.user3.address, signers.owner.address]
            );
            
            // Verify role was granted
            await expectRole(facets.accessControl, ROLES.MINTER_ROLE, signers.user3.address);
            
            // User3 should now be able to mint
            await expect(
                facets.mintBurn.connect(signers.user3).mint(signers.user1.address, AMOUNTS.ONE_TOKEN)
            ).to.not.be.reverted;
            
            // Revoke role
            await expectEvent(
                facets.accessControl.connect(signers.owner).revokeRole(ROLES.MINTER_ROLE, signers.user3.address),
                facets.accessControl,
                "RoleRevoked",
                [ROLES.MINTER_ROLE, signers.user3.address, signers.owner.address]
            );
            
            // Verify role was revoked
            await expectRole(facets.accessControl, ROLES.MINTER_ROLE, signers.user3.address, false);
        });
    });

    // Legacy Cambio + HalfLife flow removed in Phase 1 cutover.
    // Envelope-mode Cambio tests are in test/unit/cambio/CambioEnvelopeFacet.test.js

    describe("Custodian Registry Functionality", function () {
        it("should register and manage custodied wallets", async function () {
            const { facets, signers } = deployment;
            
            // Register custodied wallet
            const kycValidTimestamp = Math.floor(Date.now() / 1000);
            const kycExpiryTimestamp = kycValidTimestamp + (365 * 24 * 60 * 60); // 1 year
            
            await expectEvent(
                facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                    signers.user1.address,
                    kycValidTimestamp,
                    kycExpiryTimestamp
                ),
                facets.custodian,
                "WalletRegistered",
                [signers.user1.address, signers.custodian1.address, kycValidTimestamp, kycExpiryTimestamp]
            );
            
            // Verify registration using available methods
            const custodian = await facets.custodian.getCustodian(signers.user1.address);
            expect(custodian).to.equal(signers.custodian1.address);
            
            const [validTimestamp, expiryTimestamp] = await facets.custodian.getKYCTimestamps(signers.user1.address);
            expect(validTimestamp).to.equal(kycValidTimestamp);
            expect(expiryTimestamp).to.equal(kycExpiryTimestamp);
            
            // Check KYC validity
            const isKYCValid = await facets.custodian.isKYCValid(signers.user1.address);
            expect(isKYCValid).to.be.true;
        });
    });

    describe("End-to-End Workflow", function () {
        it("should complete a full token lifecycle", async function () {
            const { facets, signers } = deployment;
            
            console.log("\n🚀 Starting end-to-end workflow test...");
            
            // 1. Register user with custodian
            const kycTimestamp = Math.floor(Date.now() / 1000);
            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user3.address,
                kycTimestamp,
                kycTimestamp + (365 * 24 * 60 * 60)
            );
            
            console.log("✅ User registered with custodian");
            
            // 2. Mint tokens to new user
            await facets.mintBurn.connect(signers.minter).mint(signers.user3.address, AMOUNTS.THOUSAND_TOKENS);
            
            console.log("✅ Tokens minted to new user");
            
            // 3. User transfers to another user
            await facets.directTransfer.connect(signers.user3).transfer(signers.user1.address, AMOUNTS.HUNDRED_TOKENS);
            
            console.log("✅ User-to-user transfer completed");
            
            // Phase 1 cutover: half-life logic decommissioned; no wait required
            
            // 4. Approve and transferFrom workflow
            await facets.erc20.connect(signers.user1).approve(signers.user2.address, AMOUNTS.TEN_TOKENS);
            await facets.directTransfer.connect(signers.user2).transferFrom(
                signers.user1.address,
                signers.treasury.address,
                AMOUNTS.TEN_TOKENS
            );
            
            console.log("✅ Approve/transferFrom workflow completed");
            
            // 5. Verify final balances
            // Phase 1 cutover: direct transfers are fee-free
            const user3Balance = await facets.erc20.balanceOf(signers.user3.address);
            const treasuryBalance = await facets.erc20.balanceOf(signers.treasury.address);
            
            // User3 started with 250 + minted 1000 - sent 100 (no fees)
            const expectedUser3Balance = ethers.parseEther("250") + AMOUNTS.THOUSAND_TOKENS - AMOUNTS.HUNDRED_TOKENS;
            expect(user3Balance).to.equal(expectedUser3Balance);
            
            // Treasury received 10 tokens
            expect(treasuryBalance).to.equal(AMOUNTS.TEN_TOKENS);
            
            console.log("✅ End-to-end workflow completed successfully");
        });
    });

    after(async function () {
        if (deployment) {
            console.log("\n📊 Test Summary:");
            console.log(`  Diamond Address: ${deployment.diamondAddress}`);
            console.log(`  Total Supply: ${await deployment.facets.erc20.totalSupply()}`);
            console.log(`  Facets Deployed: ${(await deployment.facets.diamondLoupe.facets()).length}`);
            console.log("✅ Golden Path test completed successfully");
        }
    });
});
