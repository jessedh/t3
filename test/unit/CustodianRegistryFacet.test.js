const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

// Import our test infrastructure
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");
const { expectEvent } = require("../helpers/assertions");

/**
 * CustodianRegistryFacet Unit Tests
 * 
 * Tests custodian registration, wallet registration, KYC management, and compliance functionality.
 */
describe("CustodianRegistryFacet Unit Tests", function () {
    let deployment;
    const oneDay = 24 * 60 * 60;
    const oneYear = 365 * oneDay;
    
    async function setupCustodianFixture() {
        // Deploy diamond with all facets
        deployment = await deployT3DiamondFixture();
        
        // Setup roles for testing
        await setupTestRoles(deployment.facets, deployment.signers);
        
        return deployment;
    }
    
    beforeEach(async function () {
        deployment = await loadFixture(setupCustodianFixture);
    });

    describe("Custodian Role Management", function () {
        it("should reject grant from ADMIN_ROLE (K-F10: grant requires DEFAULT_ADMIN_ROLE)", async function () {
            const { facets, signers } = deployment;

            expect(await facets.custodian.isCustodian(signers.user1.address)).to.be.false;

            // K-F10 tightening: ADMIN_ROLE can no longer grant — grant/revoke are
            // symmetric under DEFAULT_ADMIN_ROLE.
            await expect(
                facets.custodian.connect(signers.admin).grantCustodianRole(signers.user1.address)
            ).to.be.revertedWithCustomError(facets.custodian, "UnauthorizedRole")
                .withArgs(signers.admin.address, ROLES.DEFAULT_ADMIN_ROLE);

            expect(await facets.custodian.isCustodian(signers.user1.address)).to.be.false;
        });

        it("should allow owner to grant custodian role", async function () {
            const { facets, signers } = deployment;
            
            await expectEvent(
                facets.custodian.connect(signers.owner).grantCustodianRole(signers.user1.address),
                facets.accessControl,
                "RoleGranted",
                [ROLES.CUSTODIAN_ROLE, signers.user1.address, signers.owner.address]
            );
            
            expect(await facets.custodian.isCustodian(signers.user1.address)).to.be.true;
        });

        it("should reject granting custodian role from non-admin", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.custodian.connect(signers.user1).grantCustodianRole(signers.user2.address)
            ).to.be.revertedWithCustomError(facets.custodian, "UnauthorizedRole");
        });

        it("should reject granting custodian role to zero address", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.custodian.connect(signers.owner).grantCustodianRole(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(facets.custodian, "CustodianZeroAddress");
        });

        it("should reject granting custodian role to already registered custodian", async function () {
            const { facets, signers } = deployment;
            
            // Grant role first time
            await facets.custodian.connect(signers.owner).grantCustodianRole(signers.user1.address);
            
            // Try to grant again
            await expect(
                facets.custodian.connect(signers.owner).grantCustodianRole(signers.user1.address)
            ).to.be.revertedWithCustomError(facets.custodian, "UserAlreadyRegistered");
        });

        it("should allow only DEFAULT_ADMIN_ROLE to revoke custodian role", async function () {
            const { facets, signers } = deployment;
            
            // Grant custodian role first
            await facets.custodian.connect(signers.owner).grantCustodianRole(signers.user1.address);
            
            // Only owner (DEFAULT_ADMIN_ROLE) can revoke
            await expectEvent(
                facets.custodian.connect(signers.owner).revokeCustodianRole(signers.user1.address),
                facets.accessControl,
                "RoleRevoked",
                [ROLES.CUSTODIAN_ROLE, signers.user1.address, signers.owner.address]
            );
            
            expect(await facets.custodian.isCustodian(signers.user1.address)).to.be.false;
        });

        it("should reject revoking custodian role from admin", async function () {
            const { facets, signers } = deployment;
            
            // Grant custodian role first
            await facets.custodian.connect(signers.owner).grantCustodianRole(signers.user1.address);
            
            // Admin cannot revoke (needs DEFAULT_ADMIN_ROLE)
            await expect(
                facets.custodian.connect(signers.admin).revokeCustodianRole(signers.user1.address)
            ).to.be.revertedWithCustomError(facets.custodian, "UnauthorizedRole");
        });
    });

    describe("Custodian Registry Queries", function () {
        beforeEach(async function () {
            // Add an additional custodian for testing
            const { facets, signers } = deployment;
            await facets.custodian.connect(signers.owner).grantCustodianRole(signers.user1.address);
        });

        it("should return correct custodian count", async function () {
            const { facets } = deployment;
            
            const count = await facets.custodian.custodianCount();
            expect(count).to.equal(1); // Only user1 (registered via grantCustodianRole)
        });

        it("should return custodians by index", async function () {
            const { facets, signers } = deployment;
            
            const custodianAddresses = [];
            const count = await facets.custodian.custodianCount();
            
            for (let i = 0; i < count; i++) {
                const custodian = await facets.custodian.custodianAtIndex(i);
                custodianAddresses.push(custodian);
            }
            
            // Should include user1 (registered via grantCustodianRole)
            expect(custodianAddresses).to.include(signers.user1.address);
            
            // Note: custodian1 and custodian2 have roles but weren't registered via grantCustodianRole
            // They won't be in the _custodians set unless explicitly added
        });

        it("should correctly identify custodians in registry", async function () {
            const { facets, signers } = deployment;
            
            // Note: isCustodian() checks the _custodians registry, not the role system
            // Only user1 was added via grantCustodianRole which manages both role and registry
            expect(await facets.custodian.isCustodian(signers.user1.address)).to.be.true;
            expect(await facets.custodian.isCustodian(signers.user2.address)).to.be.false;
            
            // These have the role but not in the registry (role granted directly)
            expect(await facets.custodian.isCustodian(signers.custodian1.address)).to.be.false;
            expect(await facets.custodian.isCustodian(signers.custodian2.address)).to.be.false;
        });
        
        it("should distinguish between role and registry", async function () {
            const { facets, signers } = deployment;
            
            // custodian1 has CUSTODIAN_ROLE but not in registry
            expect(await facets.accessControl.hasRole(ROLES.CUSTODIAN_ROLE, signers.custodian1.address)).to.be.true;
            expect(await facets.custodian.isCustodian(signers.custodian1.address)).to.be.false;
            
            // user1 has both role and registry entry
            expect(await facets.accessControl.hasRole(ROLES.CUSTODIAN_ROLE, signers.user1.address)).to.be.true;
            expect(await facets.custodian.isCustodian(signers.user1.address)).to.be.true;
        });
    });

    describe("Wallet Registration", function () {
        let validatedTimestamp, expiresTimestamp;

        beforeEach(async function () {
            const currentTime = await time.latest();
            validatedTimestamp = currentTime;
            expiresTimestamp = currentTime + oneYear;
        });

        it("should allow custodian to register wallet", async function () {
            const { facets, signers } = deployment;
            
            await expectEvent(
                facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                    signers.user1.address,
                    validatedTimestamp,
                    expiresTimestamp
                ),
                facets.custodian,
                "WalletRegistered",
                [signers.user1.address, signers.custodian1.address, validatedTimestamp, expiresTimestamp]
            );
            
            // Verify registration
            const custodian = await facets.custodian.getCustodian(signers.user1.address);
            expect(custodian).to.equal(signers.custodian1.address);
        });

        it("should register wallet with no expiry", async function () {
            const { facets, signers } = deployment;
            
            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address,
                validatedTimestamp,
                0 // No expiry
            );
            
            const [validated, expires] = await facets.custodian.getKYCTimestamps(signers.user1.address);
            expect(validated).to.equal(validatedTimestamp);
            expect(expires).to.equal(0);
        });

        it("should reject registration from non-custodian", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.custodian.connect(signers.user2).registerCustodiedWallet(
                    signers.user1.address,
                    validatedTimestamp,
                    expiresTimestamp
                )
            ).to.be.revertedWithCustomError(facets.custodian, "UnauthorizedRole");
        });

        it("should reject custody takeover while wallet is actively custodied (R-10)", async function () {
            const { facets, signers } = deployment;

            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address,
                validatedTimestamp,
                expiresTimestamp
            );

            await expect(
                facets.custodian.connect(signers.custodian2).registerCustodiedWallet(
                    signers.user1.address,
                    validatedTimestamp,
                    expiresTimestamp
                )
            ).to.be.revertedWithCustomError(facets.custodian, "CustodianAlreadyAssigned");
        });

        it("should reject registration of zero address", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                    ethers.ZeroAddress,
                    validatedTimestamp,
                    expiresTimestamp
                )
            ).to.be.revertedWithCustomError(facets.custodian, "UserAddressZero");
        });

        it("should reject registration with expiry before validation", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                    signers.user1.address,
                    validatedTimestamp,
                    validatedTimestamp - oneDay // Expires before validation
                )
            ).to.be.revertedWithCustomError(facets.custodian, "KYCExpiryBeforeValidation");
        });
    });

    describe("KYC Management", function () {
        let validatedTimestamp, expiresTimestamp;

        beforeEach(async function () {
            const currentTime = await time.latest();
            validatedTimestamp = currentTime;
            expiresTimestamp = currentTime + oneYear;
            
            // Register a wallet for KYC testing
            const { facets, signers } = deployment;
            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address,
                validatedTimestamp,
                expiresTimestamp
            );
        });

        it("should allow custodian to update KYC status", async function () {
            const { facets, signers } = deployment;
            const newValidated = validatedTimestamp + oneDay;
            const newExpires = expiresTimestamp + oneDay;
            
            await expectEvent(
                facets.custodian.connect(signers.custodian1).updateKYCStatus(
                    signers.user1.address,
                    newValidated,
                    newExpires
                ),
                facets.custodian,
                "KYCStatusUpdated",
                [signers.user1.address, signers.custodian1.address, newValidated, newExpires]
            );
            
            const [validated, expires] = await facets.custodian.getKYCTimestamps(signers.user1.address);
            expect(validated).to.equal(newValidated);
            expect(expires).to.equal(newExpires);
        });

        it("should reject KYC update from wrong custodian", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.custodian.connect(signers.custodian2).updateKYCStatus(
                    signers.user1.address,
                    validatedTimestamp + oneDay,
                    expiresTimestamp + oneDay
                )
            ).to.be.revertedWithCustomError(facets.custodian, "CallerNotRegisteredCustodian");
        });

        it("should reject KYC update from non-custodian", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.custodian.connect(signers.user2).updateKYCStatus(
                    signers.user1.address,
                    validatedTimestamp + oneDay,
                    expiresTimestamp + oneDay
                )
            ).to.be.revertedWithCustomError(facets.custodian, "UnauthorizedRole");
        });

        it("should return correct KYC validity", async function () {
            const { facets, signers } = deployment;
            
            // Should be valid (not expired)
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.true;
            
            // Test with expired KYC
            const pastTime = validatedTimestamp - oneDay;
            await facets.custodian.connect(signers.custodian1).updateKYCStatus(
                signers.user1.address,
                pastTime,
                pastTime + 1 // Very short expiry
            );
            
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.false;
        });

        it("should handle no expiry KYC correctly", async function () {
            const { facets, signers } = deployment;
            
            // Update to no expiry
            await facets.custodian.connect(signers.custodian1).updateKYCStatus(
                signers.user1.address,
                validatedTimestamp,
                0
            );
            
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.true;
        });
    });

    describe("Wallet Unregistration", function () {
        beforeEach(async function () {
            // Register a wallet for unregistration testing
            const currentTime = await time.latest();
            const { facets, signers } = deployment;
            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address,
                currentTime,
                currentTime + oneYear
            );
        });

        it("should allow custodian to unregister wallet", async function () {
            const { facets, signers } = deployment;
            
            await expectEvent(
                facets.custodian.connect(signers.custodian1).unregisterCustodiedWallet(signers.user1.address),
                facets.custodian,
                "WalletUnregistered",
                [signers.user1.address, signers.custodian1.address]
            );
            
            // Verify unregistration
            const custodian = await facets.custodian.getCustodian(signers.user1.address);
            expect(custodian).to.equal(ethers.ZeroAddress);
            
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.false;
        });

        it("should reject unregistration from wrong custodian", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.custodian.connect(signers.custodian2).unregisterCustodiedWallet(signers.user1.address)
            ).to.be.revertedWithCustomError(facets.custodian, "CallerNotRegisteredCustodian");
        });

        it("should reject unregistration from non-custodian", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.custodian.connect(signers.user2).unregisterCustodiedWallet(signers.user1.address)
            ).to.be.revertedWithCustomError(facets.custodian, "UnauthorizedRole");
        });

        it("should reject unregistration of zero address", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.custodian.connect(signers.custodian1).unregisterCustodiedWallet(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(facets.custodian, "UserAddressZero");
        });

        it("should emit CIPRevoked tombstone when unregister wipes a live CIP record", async function () {
            const { facets, signers } = deployment;
            const cipRecordHash = ethers.keccak256(ethers.toUtf8Bytes("cip-record-unregister"));

            await facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash);
            expect(await facets.custodian.connect(signers.owner).hasCIP(signers.user1.address)).to.be.true;

            await expect(
                facets.custodian.connect(signers.custodian1).unregisterCustodiedWallet(signers.user1.address)
            )
                .to.emit(facets.custodian, "CIPRevoked")
                .withArgs(signers.user1.address, signers.custodian1.address, await time.latest() + 1)
                .and.to.emit(facets.custodian, "WalletUnregistered")
                .withArgs(signers.user1.address, signers.custodian1.address);

            // CIP cleared for the wallet
            expect(await facets.custodian.connect(signers.owner).hasCIP(signers.user1.address)).to.be.false;
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            // Register multiple wallets for testing
            const currentTime = await time.latest();
            const { facets, signers } = deployment;
            
            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address,
                currentTime,
                currentTime + oneYear
            );
            
            await facets.custodian.connect(signers.custodian2).registerCustodiedWallet(
                signers.user2.address,
                currentTime - oneDay,
                0 // No expiry
            );
        });

        it("should return correct custodian for registered wallets", async function () {
            const { facets, signers } = deployment;
            
            expect(await facets.custodian.getCustodian(signers.user1.address)).to.equal(signers.custodian1.address);
            expect(await facets.custodian.getCustodian(signers.user2.address)).to.equal(signers.custodian2.address);
            expect(await facets.custodian.getCustodian(signers.user3.address)).to.equal(ethers.ZeroAddress);
        });

        it("should return correct KYC timestamps", async function () {
            const { facets, signers } = deployment;
            
            const [validated1, expires1] = await facets.custodian.getKYCTimestamps(signers.user1.address);
            expect(validated1).to.be.greaterThan(0);
            expect(expires1).to.be.greaterThan(validated1);
            
            const [validated2, expires2] = await facets.custodian.getKYCTimestamps(signers.user2.address);
            expect(validated2).to.be.greaterThan(0);
            expect(expires2).to.equal(0); // No expiry
        });

        it("should return correct KYC validity status", async function () {
            const { facets, signers } = deployment;
            
            expect(await facets.custodian.isKYCValid(signers.user1.address)).to.be.true;
            expect(await facets.custodian.isKYCValid(signers.user2.address)).to.be.true;
            expect(await facets.custodian.isKYCValid(signers.user3.address)).to.be.false;
        });
    });

    describe("CIP Management", function () {
        let validatedTimestamp, expiresTimestamp;
        const cipRecordHash = ethers.keccak256(ethers.toUtf8Bytes("cip-record-1"));

        beforeEach(async function () {
            const currentTime = await time.latest();
            validatedTimestamp = currentTime;
            expiresTimestamp = currentTime + oneYear;

            const { facets, signers } = deployment;
            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address,
                validatedTimestamp,
                expiresTimestamp
            );
        });

        it("should record CIP and emit CIPRecorded", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash)
            )
                .to.emit(facets.custodian, "CIPRecorded")
                .withArgs(signers.user1.address, cipRecordHash, signers.custodian1.address, await time.latest() + 1);

            const [cipAt, cipHash] = await facets.custodian.getCIP(signers.user1.address);
            expect(cipAt).to.be.greaterThan(0);
            expect(cipHash).to.equal(cipRecordHash);
            expect(await facets.custodian.hasCIP(signers.user1.address)).to.be.true;
        });

        it("should reject CIP record with zero hash", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, ethers.ZeroHash)
            ).to.be.revertedWithCustomError(facets.custodian, "CIPRecordHashRequired");
        });

        it("should reject CIP record from non-custodian", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.custodian.connect(signers.user2).recordCIP(signers.user1.address, cipRecordHash)
            ).to.be.revertedWithCustomError(facets.custodian, "UnauthorizedRole");
        });

        it("should reject CIP record from wrong custodian", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.custodian.connect(signers.custodian2).recordCIP(signers.user1.address, cipRecordHash)
            ).to.be.revertedWithCustomError(facets.custodian, "CallerNotRegisteredCustodian");
        });

        it("should revoke CIP and emit CIPRevoked", async function () {
            const { facets, signers } = deployment;

            await facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash);

            await expect(
                facets.custodian.connect(signers.custodian1).revokeCIP(signers.user1.address)
            )
                .to.emit(facets.custodian, "CIPRevoked")
                .withArgs(signers.user1.address, signers.custodian1.address, await time.latest() + 1);

            const [cipAt, cipHash] = await facets.custodian.getCIP(signers.user1.address);
            expect(cipAt).to.equal(0);
            expect(cipHash).to.equal(ethers.ZeroHash);
            expect(await facets.custodian.hasCIP(signers.user1.address)).to.be.false;
        });

        it("should reject revoking CIP when no record exists", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.custodian.connect(signers.custodian1).revokeCIP(signers.user1.address)
            )
                .to.be.revertedWithCustomError(facets.custodian, "CIPNotFound")
                .withArgs(signers.user1.address);
        });

        it("should reject CIP revocation from wrong custodian", async function () {
            const { facets, signers } = deployment;

            await facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash);

            await expect(
                facets.custodian.connect(signers.custodian2).revokeCIP(signers.user1.address)
            ).to.be.revertedWithCustomError(facets.custodian, "CallerNotRegisteredCustodian");
        });

        it("should return correct CIP values via getCIP", async function () {
            const { facets, signers } = deployment;

            let [cipAt, cipHash] = await facets.custodian.getCIP(signers.user1.address);
            expect(cipAt).to.equal(0);
            expect(cipHash).to.equal(ethers.ZeroHash);

            await facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash);

            [cipAt, cipHash] = await facets.custodian.getCIP(signers.user1.address);
            expect(cipAt).to.be.greaterThan(0);
            expect(cipHash).to.equal(cipRecordHash);
        });

        it("should return correct hasCIP boolean", async function () {
            const { facets, signers } = deployment;

            expect(await facets.custodian.hasCIP(signers.user1.address)).to.be.false;

            await facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash);
            expect(await facets.custodian.hasCIP(signers.user1.address)).to.be.true;

            await facets.custodian.connect(signers.custodian1).revokeCIP(signers.user1.address);
            expect(await facets.custodian.hasCIP(signers.user1.address)).to.be.false;
        });

        it("should gate hasCIP via ViewACL", async function () {
            const { facets, signers } = deployment;

            await facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash);

            // Unauthorized viewer
            await expect(
                facets.custodian.connect(signers.user3).hasCIP(signers.user1.address)
            )
                .to.be.revertedWithCustomError(facets.custodian, "UnauthorizedViewer")
                .withArgs(signers.user3.address);

            // Wallet owner can view
            expect(await facets.custodian.connect(signers.user1).hasCIP(signers.user1.address)).to.be.true;

            // Custodian of record can view
            expect(await facets.custodian.connect(signers.custodian1).hasCIP(signers.user1.address)).to.be.true;

            // Admin/operator can view
            expect(await facets.custodian.connect(signers.admin).hasCIP(signers.user1.address)).to.be.true;
        });

        it("should gate getCIP via ViewACL", async function () {
            const { facets, signers } = deployment;

            await facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash);

            // Unauthorized viewer (user3 is not the wallet, its custodian, nor an operator)
            await expect(
                facets.custodian.connect(signers.user3).getCIP(signers.user1.address)
            ).to.be.revertedWithCustomError(facets.custodian, "UnauthorizedViewer");

            // Wallet itself can view
            const [cipAt, cipHash] = await facets.custodian.connect(signers.user1).getCIP(signers.user1.address);
            expect(cipHash).to.equal(cipRecordHash);

            // Custodian can view
            expect(await facets.custodian.connect(signers.custodian1).getCIP(signers.user1.address)).to.deep.equal([cipAt, cipHash]);
        });

        it("revoking KYC cascades to CIP (Task 7.2, K-F8: CIP presupposes KYC)", async function () {
            const { facets, signers } = deployment;

            await facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash);

            await expect(
                facets.custodian.connect(signers.custodian1).revokeKYC(signers.user1.address, 1)
            ).to.emit(facets.custodian, "KYCRevoked")
             .and.to.emit(facets.custodian, "CIPRevoked");

            const [cipAt, cipHash] = await facets.custodian.connect(signers.custodian1).getCIP(signers.user1.address);
            expect(cipAt).to.equal(0);
            expect(cipHash).to.equal(ethers.ZeroHash);
            expect(await facets.custodian.connect(signers.custodian1).hasCIP(signers.user1.address)).to.be.false;
        });

        it("revoking KYC with no CIP record emits no CIPRevoked tombstone", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.custodian.connect(signers.custodian1).revokeKYC(signers.user1.address, 1)
            ).to.emit(facets.custodian, "KYCRevoked")
             .and.not.to.emit(facets.custodian, "CIPRevoked");
        });

        it("should clear CIP when the wallet is unregistered", async function () {
            const { facets, signers } = deployment;

            await facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash);
            expect(await facets.custodian.connect(signers.owner).hasCIP(signers.user1.address)).to.be.true;

            await facets.custodian.connect(signers.custodian1).unregisterCustodiedWallet(signers.user1.address);

            // After deletion, only an operator can still call the gated views
            const [cipAt, cipHash] = await facets.custodian.connect(signers.owner).getCIP(signers.user1.address);
            expect(cipAt).to.equal(0);
            expect(cipHash).to.equal(ethers.ZeroHash);
            expect(await facets.custodian.connect(signers.owner).hasCIP(signers.user1.address)).to.be.false;
        });
    });

    describe("Lifecycle-aware attestation mutations (Task 7.2, K-F8)", function () {
        // InstitutionLifecycleStorage.InstitutionMode numeric values
        const MODE = { ACTIVE: 0, ISSUANCE_PAUSED: 1, ORDERLY_EXIT: 2, DEFAULTED: 3, RESOLVED: 4 };
        const cipRecordHash = ethers.keccak256(ethers.toUtf8Bytes("cip-record-lc"));

        beforeEach(async function () {
            const { facets, signers } = deployment;
            const currentTime = await time.latest();
            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address,
                currentTime,
                currentTime + oneYear
            );
        });

        function mutations(facets, signers) {
            const c = facets.custodian.connect(signers.custodian1);
            return {
                updateKYCStatus: () => c.updateKYCStatus(signers.user1.address, 1, 0),
                revokeKYC: () => c.revokeKYC(signers.user1.address, 1),
                recordCIP: () => c.recordCIP(signers.user1.address, cipRecordHash),
                revokeCIP: () => c.revokeCIP(signers.user1.address)
            };
        }

        it("DEFAULTED custodian: all four attestation mutations revert InstitutionModeBlocksAttestation", async function () {
            const { facets, signers } = deployment;
            // CIP record must exist before the mode flips so revokeCIP reaches the guard.
            await facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash);
            await facets.institutionLifecycle.connect(signers.admin)
                .setInstitutionMode(signers.custodian1.address, MODE.DEFAULTED);

            for (const [name, call] of Object.entries(mutations(facets, signers))) {
                await expect(call(), name)
                    .to.be.revertedWithCustomError(facets.custodian, "InstitutionModeBlocksAttestation")
                    .withArgs(signers.custodian1.address, MODE.DEFAULTED);
            }
        });

        it("RESOLVED custodian: all four attestation mutations revert InstitutionModeBlocksAttestation", async function () {
            const { facets, signers } = deployment;
            await facets.custodian.connect(signers.custodian1).recordCIP(signers.user1.address, cipRecordHash);
            // RESOLVED is only reachable via ORDERLY_EXIT (or DEFAULTED).
            await facets.institutionLifecycle.connect(signers.admin)
                .setInstitutionMode(signers.custodian1.address, MODE.ORDERLY_EXIT);
            await facets.institutionLifecycle.connect(signers.admin)
                .setInstitutionMode(signers.custodian1.address, MODE.RESOLVED);

            for (const [name, call] of Object.entries(mutations(facets, signers))) {
                await expect(call(), name)
                    .to.be.revertedWithCustomError(facets.custodian, "InstitutionModeBlocksAttestation")
                    .withArgs(signers.custodian1.address, MODE.RESOLVED);
            }
        });

        it("ISSUANCE_PAUSED custodian: attestation mutations still allowed (services existing customers)", async function () {
            const { facets, signers } = deployment;
            await facets.institutionLifecycle.connect(signers.admin)
                .setInstitutionMode(signers.custodian1.address, MODE.ISSUANCE_PAUSED);

            const m = mutations(facets, signers);
            await expect(m.updateKYCStatus()).to.emit(facets.custodian, "KYCStatusUpdated");
            await expect(m.recordCIP()).to.emit(facets.custodian, "CIPRecorded");
            await expect(m.revokeCIP()).to.emit(facets.custodian, "CIPRevoked");
            await expect(m.revokeKYC()).to.emit(facets.custodian, "KYCRevoked");
        });

        it("ORDERLY_EXIT custodian: attestation mutations still allowed (wind-down maintenance)", async function () {
            const { facets, signers } = deployment;
            await facets.institutionLifecycle.connect(signers.admin)
                .setInstitutionMode(signers.custodian1.address, MODE.ORDERLY_EXIT);

            const m = mutations(facets, signers);
            await expect(m.updateKYCStatus()).to.emit(facets.custodian, "KYCStatusUpdated");
            await expect(m.recordCIP()).to.emit(facets.custodian, "CIPRecorded");
            await expect(m.revokeCIP()).to.emit(facets.custodian, "CIPRevoked");
            await expect(m.revokeKYC()).to.emit(facets.custodian, "KYCRevoked");
        });
    });

    describe("Edge Cases", function () {
        it("should handle wallet re-registration correctly", async function () {
            const { facets, signers } = deployment;
            const currentTime = await time.latest();
            
            // Register
            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address,
                currentTime,
                currentTime + oneYear
            );
            
            // Unregister
            await facets.custodian.connect(signers.custodian1).unregisterCustodiedWallet(signers.user1.address);
            
            // Re-register with different custodian
            await facets.custodian.connect(signers.custodian2).registerCustodiedWallet(
                signers.user1.address,
                currentTime + oneDay,
                currentTime + oneYear + oneDay
            );
            
            expect(await facets.custodian.getCustodian(signers.user1.address)).to.equal(signers.custodian2.address);
        });

        it("should handle custodian role revocation impact", async function () {
            const { facets, signers } = deployment;
            const currentTime = await time.latest();
            
            // Register wallet
            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                signers.user1.address,
                currentTime,
                currentTime + oneYear
            );
            
            // This test needs a custodian that was added via grantCustodianRole
            // Let's grant role to user2 first, then revoke it
            await facets.custodian.connect(signers.owner).grantCustodianRole(signers.user2.address);
            
            // Register wallet with user2 as custodian
            await facets.custodian.connect(signers.user2).registerCustodiedWallet(
                signers.user3.address,
                currentTime,
                currentTime + oneYear
            );
            
            // Revoke custodian role
            await facets.custodian.connect(signers.owner).revokeCustodianRole(signers.user2.address);
            
            // Custodian should no longer be able to update KYC
            await expect(
                facets.custodian.connect(signers.user2).updateKYCStatus(
                    signers.user3.address,
                    currentTime + oneDay,
                    currentTime + oneYear + oneDay
                )
            ).to.be.revertedWithCustomError(facets.custodian, "UnauthorizedRole");
            
            // But wallet registration should still exist
            expect(await facets.custodian.getCustodian(signers.user3.address)).to.equal(signers.user2.address);
        });
    });
});