const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Import our test infrastructure
const { deployT3DiamondFixture } = require("../../helpers/deployment");
const { setupTestRoles } = require("../../helpers/roles");
const { AMOUNTS } = require("../../helpers/constants");
const { expectEvent } = require("../../helpers/assertions");

/**
 * SponsorBankCoreFacet Unit Tests
 * 
 * Tests sponsor bank registration, management, and core functionality.
 * This facet manages the registration of sponsor banks, their configuration,
 * and provides core functionality for the Phase 2 distribution framework.
 */
describe("SponsorBankCoreFacet Unit Tests", function () {
    let deployment;
    
    // Role constants for Phase 2
    const SPONSOR_BANK_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SPONSOR_BANK_ADMIN_ROLE"));
    const SPONSOR_BANK_OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SPONSOR_BANK_OPERATOR_ROLE"));
    
    // Test constants
    const VALID_FEE_RATE = 100; // 1%
    const HIGH_FEE_RATE = 600; // 6% (above 5% limit)
    const BANK_IDENTIFIER = "JPMORGAN_USD";
    const UPDATED_IDENTIFIER = "CHASE_USD";
    
    async function setupSponsorBankFixture() {
        // Deploy diamond with all facets
        const deployment = await deployT3DiamondFixture();
        
        // Setup standard test roles
        await setupTestRoles(deployment.facets, deployment.signers);
        
        // Grant Phase 2 roles for testing
        await deployment.facets.accessControl.connect(deployment.signers.owner)
            .grantRole(SPONSOR_BANK_ADMIN_ROLE, deployment.signers.admin.address);
        
        return { deployment };
    }
    
    beforeEach(async function () {
        const fixture = await loadFixture(setupSponsorBankFixture);
        deployment = fixture.deployment;
    });

    describe("Role-Based Access Control", function () {
        it("should have correct Phase 2 role constants", async function () {
            const { facets } = deployment;
            
            // Verify roles are properly configured (no direct role constant access, verify through usage)
            await expect(
                facets.sponsorBank.connect(deployment.signers.user1)
                    .registerSponsorBank(deployment.signers.user2.address, BANK_IDENTIFIER, VALID_FEE_RATE)
            ).to.be.revertedWithCustomError(facets.sponsorBank, "UnauthorizedRole");
        });

        it("should allow admin to grant sponsor bank admin role", async function () {
            const { facets, signers } = deployment;
            
            await expectEvent(
                facets.accessControl.connect(signers.owner)
                    .grantRole(SPONSOR_BANK_ADMIN_ROLE, signers.user1.address),
                facets.accessControl,
                "RoleGranted",
                [SPONSOR_BANK_ADMIN_ROLE, signers.user1.address, signers.owner.address]
            );
            
            expect(await facets.accessControl.hasRole(SPONSOR_BANK_ADMIN_ROLE, signers.user1.address)).to.be.true;
        });

        it("should reject unauthorized access to admin functions", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.sponsorBank.connect(signers.user1)
                    .registerSponsorBank(signers.user2.address, BANK_IDENTIFIER, VALID_FEE_RATE)
            ).to.be.revertedWithCustomError(facets.sponsorBank, "UnauthorizedRole");
            
            await expect(
                facets.sponsorBank.connect(signers.user1)
                    .updateBankStatus(signers.user2.address, false)
            ).to.be.revertedWithCustomError(facets.sponsorBank, "UnauthorizedRole");
        });
    });

    describe("Sponsor Bank Registration", function () {
        it("should register a new sponsor bank with valid parameters", async function () {
            const { facets, signers } = deployment;
            
            const bankAddress = signers.user1.address;
            const initialBankCount = await facets.sponsorBank.getTotalBanksCount();
            
            await expectEvent(
                facets.sponsorBank.connect(signers.admin)
                    .registerSponsorBank(bankAddress, BANK_IDENTIFIER, VALID_FEE_RATE),
                facets.sponsorBank,
                "SponsorBankRegistered",
                [bankAddress, BANK_IDENTIFIER, VALID_FEE_RATE]
            );
            
            // Verify bank info
            const bankInfo = await facets.sponsorBank.getSponsorBankInfo(bankAddress);
            expect(bankInfo[0]).to.equal(bankAddress); // bankAddr
            expect(bankInfo[1]).to.equal(BANK_IDENTIFIER); // identifier
            expect(bankInfo[2]).to.equal(VALID_FEE_RATE); // feeRate
            expect(bankInfo[3]).to.be.true; // isActive
            expect(bankInfo[4]).to.be.true; // isRegistered
            expect(bankInfo[5]).to.equal(0); // totalDistributions
            expect(bankInfo[6]).to.equal(0); // totalVolume
            expect(bankInfo[7]).to.be.greaterThan(0); // registrationTime
            expect(bankInfo[8]).to.equal(0); // totalFeeEarned
            
            // Verify bank count increased
            expect(await facets.sponsorBank.getTotalBanksCount()).to.equal(initialBankCount + 1n);
            
            // Verify bank is valid
            expect(await facets.sponsorBank.isValidSponsorBank(bankAddress)).to.be.true;
            
            // Verify bank was granted operator role
            expect(await facets.accessControl.hasRole(SPONSOR_BANK_OPERATOR_ROLE, bankAddress)).to.be.true;
        });

        it("should reject registration with invalid bank address", async function () {
            const { facets, signers } = deployment;
            
            // Zero address
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .registerSponsorBank(ethers.ZeroAddress, BANK_IDENTIFIER, VALID_FEE_RATE)
            ).to.be.revertedWith("Invalid bank address");
            
            // Contract address (self)
            const contractAddress = await facets.sponsorBank.getAddress();
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .registerSponsorBank(contractAddress, BANK_IDENTIFIER, VALID_FEE_RATE)
            ).to.be.revertedWith("Cannot register contract as bank");
        });

        it("should reject registration with invalid parameters", async function () {
            const { facets, signers } = deployment;
            
            const bankAddress = signers.user1.address;
            
            // Empty identifier
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .registerSponsorBank(bankAddress, "", VALID_FEE_RATE)
            ).to.be.revertedWith("Identifier required");
            
            // Fee rate too high
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .registerSponsorBank(bankAddress, BANK_IDENTIFIER, HIGH_FEE_RATE)
            ).to.be.revertedWith("Fee rate too high");
        });

        it("should reject duplicate bank registration", async function () {
            const { facets, signers } = deployment;
            
            const bankAddress = signers.user1.address;
            
            // Register bank first time
            await facets.sponsorBank.connect(signers.admin)
                .registerSponsorBank(bankAddress, BANK_IDENTIFIER, VALID_FEE_RATE);
            
            // Attempt to register same bank again
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .registerSponsorBank(bankAddress, UPDATED_IDENTIFIER, VALID_FEE_RATE)
            ).to.be.revertedWith("Bank already registered");
        });

        it("should reject registration when contract is paused", async function () {
            const { facets, signers } = deployment;
            
            // Pause the contract
            await facets.pausable.connect(signers.pauser).pause();
            
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .registerSponsorBank(signers.user1.address, BANK_IDENTIFIER, VALID_FEE_RATE)
            ).to.be.revertedWith("Pausable: paused");
        });
    });

    describe("Sponsor Bank Status Management", function () {
        beforeEach(async function () {
            // Register a bank for testing
            await deployment.facets.sponsorBank.connect(deployment.signers.admin)
                .registerSponsorBank(deployment.signers.user1.address, BANK_IDENTIFIER, VALID_FEE_RATE);
        });

        it("should update bank active status", async function () {
            const { facets, signers } = deployment;
            const bankAddress = signers.user1.address;
            
            // Initially bank should be active
            expect(await facets.sponsorBank.isValidSponsorBank(bankAddress)).to.be.true;
            
            // Deactivate bank
            await expectEvent(
                facets.sponsorBank.connect(signers.admin)
                    .updateBankStatus(bankAddress, false),
                facets.sponsorBank,
                "SponsorBankStatusUpdated",
                [bankAddress, false]
            );
            
            // Verify bank is no longer valid (not active)
            expect(await facets.sponsorBank.isValidSponsorBank(bankAddress)).to.be.false;
            
            // Verify bank info reflects deactivation
            const bankInfo = await facets.sponsorBank.getSponsorBankInfo(bankAddress);
            expect(bankInfo[3]).to.be.false; // isActive
            expect(bankInfo[4]).to.be.true; // isRegistered (still true)
            
            // Reactivate bank
            await expectEvent(
                facets.sponsorBank.connect(signers.admin)
                    .updateBankStatus(bankAddress, true),
                facets.sponsorBank,
                "SponsorBankStatusUpdated",
                [bankAddress, true]
            );
            
            // Verify bank is valid again
            expect(await facets.sponsorBank.isValidSponsorBank(bankAddress)).to.be.true;
        });

        it("should reject status update for non-existent bank", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .updateBankStatus(signers.user2.address, false)
            ).to.be.revertedWith("Bank not registered");
        });

        it("should reject status update from unauthorized user", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.sponsorBank.connect(signers.user1)
                    .updateBankStatus(signers.user1.address, false)
            ).to.be.revertedWithCustomError(facets.sponsorBank, "UnauthorizedRole");
        });
    });

    describe("Fee Rate Management", function () {
        beforeEach(async function () {
            // Register a bank for testing
            await deployment.facets.sponsorBank.connect(deployment.signers.admin)
                .registerSponsorBank(deployment.signers.user1.address, BANK_IDENTIFIER, VALID_FEE_RATE);
        });

        it("should update bank fee rate", async function () {
            const { facets, signers } = deployment;
            const bankAddress = signers.user1.address;
            const newFeeRate = 150; // 1.5%
            
            await facets.sponsorBank.connect(signers.admin)
                .updateBankFeeRate(bankAddress, newFeeRate);
            
            // Verify fee rate was updated
            const bankInfo = await facets.sponsorBank.getSponsorBankInfo(bankAddress);
            expect(bankInfo[2]).to.equal(newFeeRate); // feeRate
        });

        it("should reject fee rate update above maximum", async function () {
            const { facets, signers } = deployment;
            const bankAddress = signers.user1.address;
            
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .updateBankFeeRate(bankAddress, HIGH_FEE_RATE)
            ).to.be.revertedWith("Fee rate too high");
        });

        it("should reject fee rate update for non-existent bank", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .updateBankFeeRate(signers.user2.address, 150)
            ).to.be.revertedWith("Bank not registered");
        });

        it("should allow zero fee rate", async function () {
            const { facets, signers } = deployment;
            const bankAddress = signers.user1.address;
            
            await facets.sponsorBank.connect(signers.admin)
                .updateBankFeeRate(bankAddress, 0);
            
            const bankInfo = await facets.sponsorBank.getSponsorBankInfo(bankAddress);
            expect(bankInfo[2]).to.equal(0); // feeRate
        });
    });

    describe("Bank Information Queries", function () {
        it("should return empty info for non-existent bank", async function () {
            const { facets, signers } = deployment;
            
            const bankInfo = await facets.sponsorBank.getSponsorBankInfo(signers.user1.address);
            expect(bankInfo[0]).to.equal(ethers.ZeroAddress); // bankAddr
            expect(bankInfo[1]).to.equal(""); // identifier
            expect(bankInfo[2]).to.equal(0); // feeRate
            expect(bankInfo[3]).to.be.false; // isActive
            expect(bankInfo[4]).to.be.false; // isRegistered
        });

        it("should return correct initial bank count", async function () {
            const { facets } = deployment;
            
            expect(await facets.sponsorBank.getTotalBanksCount()).to.equal(0);
        });

        it("should return false for non-existent bank validity check", async function () {
            const { facets, signers } = deployment;
            
            expect(await facets.sponsorBank.isValidSponsorBank(signers.user1.address)).to.be.false;
        });

        it("should return empty array for getAllSponsorBanks", async function () {
            const { facets } = deployment;
            
            const banks = await facets.sponsorBank.getAllSponsorBanks();
            expect(banks).to.be.an('array');
            expect(banks.length).to.equal(0);
        });
    });

    describe("Global Parameters Management", function () {
        it("should set and retrieve global parameters", async function () {
            const { facets, signers } = deployment;
            
            const minDistributionAmount = ethers.parseEther("100");
            const maxBatchSize = 500;
            const globalKYCFeeRate = 50; // 0.5%
            
            await facets.sponsorBank.connect(signers.admin)
                .setGlobalParameters(minDistributionAmount, maxBatchSize, globalKYCFeeRate);
            
            const params = await facets.sponsorBank.getGlobalParameters();
            expect(params[0]).to.equal(minDistributionAmount); // minDistributionAmount
            expect(params[1]).to.equal(maxBatchSize); // maxBatchSize
            expect(params[2]).to.equal(globalKYCFeeRate); // globalKYCFeeRate
            expect(params[3]).to.be.false; // emergencyPaused (should be false initially)
        });

        it("should reject global parameters with invalid values", async function () {
            const { facets, signers } = deployment;
            
            // KYC fee rate too high
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .setGlobalParameters(ethers.parseEther("100"), 500, 150) // 1.5% > 1% max
            ).to.be.revertedWith("KYC fee rate too high");
            
            // Batch size too large
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .setGlobalParameters(ethers.parseEther("100"), 1500, 50)
            ).to.be.revertedWith("Invalid batch size");
            
            // Batch size zero
            await expect(
                facets.sponsorBank.connect(signers.admin)
                    .setGlobalParameters(ethers.parseEther("100"), 0, 50)
            ).to.be.revertedWith("Invalid batch size");
        });

        it("should reject global parameter updates from unauthorized user", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.sponsorBank.connect(signers.user1)
                    .setGlobalParameters(ethers.parseEther("100"), 500, 50)
            ).to.be.revertedWithCustomError(facets.sponsorBank, "UnauthorizedRole");
        });

        it("should return default global parameters initially", async function () {
            const { facets } = deployment;
            
            const params = await facets.sponsorBank.getGlobalParameters();
            expect(params[0]).to.equal(0); // minDistributionAmount
            expect(params[1]).to.equal(0); // maxBatchSize  
            expect(params[2]).to.equal(0); // globalKYCFeeRate
            expect(params[3]).to.be.false; // emergencyPaused
        });
    });

    describe("Integration Tests", function () {
        it("should handle multiple bank registrations", async function () {
            const { facets, signers } = deployment;
            
            const banks = [
                { address: signers.user1.address, identifier: "JPMORGAN_USD", feeRate: 100 },
                { address: signers.user2.address, identifier: "WELLS_FARGO_USD", feeRate: 75 },
                { address: signers.user3.address, identifier: "BANK_OF_AMERICA_USD", feeRate: 125 }
            ];
            
            for (const bank of banks) {
                await facets.sponsorBank.connect(signers.admin)
                    .registerSponsorBank(bank.address, bank.identifier, bank.feeRate);
                
                expect(await facets.sponsorBank.isValidSponsorBank(bank.address)).to.be.true;
                
                const bankInfo = await facets.sponsorBank.getSponsorBankInfo(bank.address);
                expect(bankInfo[1]).to.equal(bank.identifier);
                expect(bankInfo[2]).to.equal(bank.feeRate);
            }
            
            expect(await facets.sponsorBank.getTotalBanksCount()).to.equal(banks.length);
        });

        it("should handle mixed operations on multiple banks", async function () {
            const { facets, signers } = deployment;
            
            // Register multiple banks
            await facets.sponsorBank.connect(signers.admin)
                .registerSponsorBank(signers.user1.address, "BANK_A", 100);
            await facets.sponsorBank.connect(signers.admin)
                .registerSponsorBank(signers.user2.address, "BANK_B", 150);
            
            // Deactivate one bank
            await facets.sponsorBank.connect(signers.admin)
                .updateBankStatus(signers.user1.address, false);
            
            // Update fee rate for active bank
            await facets.sponsorBank.connect(signers.admin)
                .updateBankFeeRate(signers.user2.address, 200);
            
            // Verify states
            expect(await facets.sponsorBank.isValidSponsorBank(signers.user1.address)).to.be.false;
            expect(await facets.sponsorBank.isValidSponsorBank(signers.user2.address)).to.be.true;
            
            const bank2Info = await facets.sponsorBank.getSponsorBankInfo(signers.user2.address);
            expect(bank2Info[2]).to.equal(200); // Updated fee rate
        });
    });

    describe("Edge Cases and Error Conditions", function () {
        it("should handle maximum valid fee rate", async function () {
            const { facets, signers } = deployment;
            
            const maxFeeRate = 500; // 5% - maximum allowed
            
            await facets.sponsorBank.connect(signers.admin)
                .registerSponsorBank(signers.user1.address, BANK_IDENTIFIER, maxFeeRate);
            
            const bankInfo = await facets.sponsorBank.getSponsorBankInfo(signers.user1.address);
            expect(bankInfo[2]).to.equal(maxFeeRate);
        });

        it("should handle very long bank identifier", async function () {
            const { facets, signers } = deployment;
            
            const longIdentifier = "A".repeat(100);
            
            await facets.sponsorBank.connect(signers.admin)
                .registerSponsorBank(signers.user1.address, longIdentifier, VALID_FEE_RATE);
            
            const bankInfo = await facets.sponsorBank.getSponsorBankInfo(signers.user1.address);
            expect(bankInfo[1]).to.equal(longIdentifier);
        });

        it("should handle special characters in bank identifier", async function () {
            const { facets, signers } = deployment;
            
            const specialIdentifier = "BANK-NAME_123.USD";
            
            await facets.sponsorBank.connect(signers.admin)
                .registerSponsorBank(signers.user1.address, specialIdentifier, VALID_FEE_RATE);
            
            const bankInfo = await facets.sponsorBank.getSponsorBankInfo(signers.user1.address);
            expect(bankInfo[1]).to.equal(specialIdentifier);
        });

        it("should handle rapid status changes", async function () {
            const { facets, signers } = deployment;
            
            await facets.sponsorBank.connect(signers.admin)
                .registerSponsorBank(signers.user1.address, BANK_IDENTIFIER, VALID_FEE_RATE);
            
            // Rapid status changes
            await facets.sponsorBank.connect(signers.admin)
                .updateBankStatus(signers.user1.address, false);
            await facets.sponsorBank.connect(signers.admin)
                .updateBankStatus(signers.user1.address, true);
            await facets.sponsorBank.connect(signers.admin)
                .updateBankStatus(signers.user1.address, false);
            
            expect(await facets.sponsorBank.isValidSponsorBank(signers.user1.address)).to.be.false;
        });
    });
});