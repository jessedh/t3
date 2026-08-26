const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Import our test infrastructure
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { ROLES } = require("../helpers/roles");
const { expectEvent, expectRevert, expectRole } = require("../helpers/assertions");

/**
 * AccessControlFacet Unit Tests
 * 
 * Tests role-based access control functionality including role management,
 * admin operations, and access restriction enforcement.
 */
describe("AccessControlFacet Unit Tests", function () {
    let deployment;
    
    async function setupAccessControlFixture() {
        // Deploy diamond with all facets
        deployment = await deployT3DiamondFixture();
        // Note: We don't call setupTestRoles here as we want to test role setup manually
        
        return deployment;
    }
    
    beforeEach(async function () {
        deployment = await loadFixture(setupAccessControlFixture);
    });

    describe("Role Constants", function () {
        it("should have correct role constants", async function () {
            // Verify role constants match expected values
            expect(ROLES.DEFAULT_ADMIN_ROLE).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
            expect(ROLES.ADMIN_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")));
            expect(ROLES.MINTER_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")));
            expect(ROLES.PAUSER_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE")));
            expect(ROLES.CUSTODIAN_ROLE).to.equal(ethers.keccak256(ethers.toUtf8Bytes("CUSTODIAN_ROLE")));
        });
    });

    describe("Initial Role Setup", function () {
        it("should grant DEFAULT_ADMIN_ROLE to contract owner", async function () {
            const { facets, signers } = deployment;
            
            await expectRole(facets.accessControl, ROLES.DEFAULT_ADMIN_ROLE, signers.owner.address);
        });

        it("should not have other roles initially assigned", async function () {
            const { facets, signers } = deployment;
            
            // Admin role should not be assigned initially
            await expectRole(facets.accessControl, ROLES.ADMIN_ROLE, signers.admin.address, false);
            await expectRole(facets.accessControl, ROLES.MINTER_ROLE, signers.minter.address, false);
            await expectRole(facets.accessControl, ROLES.PAUSER_ROLE, signers.pauser.address, false);
            await expectRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, signers.custodian1.address, false);
        });

        it("should set correct admin role for each role", async function () {
            const { facets } = deployment;
            
            // Check that DEFAULT_ADMIN_ROLE is admin of other roles
            const adminRoleAdmin = await facets.accessControl.getRoleAdmin(ROLES.ADMIN_ROLE);
            const minterRoleAdmin = await facets.accessControl.getRoleAdmin(ROLES.MINTER_ROLE);
            const pauserRoleAdmin = await facets.accessControl.getRoleAdmin(ROLES.PAUSER_ROLE);
            const custodianRoleAdmin = await facets.accessControl.getRoleAdmin(ROLES.CUSTODIAN_ROLE);
            
            expect(adminRoleAdmin).to.equal(ROLES.DEFAULT_ADMIN_ROLE);
            expect(minterRoleAdmin).to.equal(ROLES.DEFAULT_ADMIN_ROLE);
            expect(pauserRoleAdmin).to.equal(ROLES.DEFAULT_ADMIN_ROLE);
            expect(custodianRoleAdmin).to.equal(ROLES.DEFAULT_ADMIN_ROLE);
        });
    });

    describe("Role Granting", function () {
        it("should allow admin to grant roles", async function () {
            const { facets, signers } = deployment;
            
            await expectEvent(
                facets.accessControl.connect(signers.owner).grantRole(ROLES.ADMIN_ROLE, signers.admin.address),
                facets.accessControl,
                "RoleGranted",
                [ROLES.ADMIN_ROLE, signers.admin.address, signers.owner.address]
            );
            
            await expectRole(facets.accessControl, ROLES.ADMIN_ROLE, signers.admin.address);
        });

        it("should allow granting multiple roles to same user", async function () {
            const { facets, signers } = deployment;
            
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.ADMIN_ROLE, signers.admin.address);
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.MINTER_ROLE, signers.admin.address);
            
            await expectRole(facets.accessControl, ROLES.ADMIN_ROLE, signers.admin.address);
            await expectRole(facets.accessControl, ROLES.MINTER_ROLE, signers.admin.address);
        });

        it("should allow granting same role to multiple users", async function () {
            const { facets, signers } = deployment;
            
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.CUSTODIAN_ROLE, signers.custodian1.address);
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.CUSTODIAN_ROLE, signers.custodian2.address);
            
            await expectRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, signers.custodian1.address);
            await expectRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, signers.custodian2.address);
        });

        it("should reject role granting from non-admin", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.accessControl.connect(signers.user1).grantRole(ROLES.MINTER_ROLE, signers.user2.address)
            ).to.be.revertedWithCustomError(facets.accessControl, "UnauthorizedRole");
        });

        it("should not emit event when granting already held role", async function () {
            const { facets, signers } = deployment;
            
            // Grant role first time
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.ADMIN_ROLE, signers.admin.address);
            
            // Grant same role again - should not emit event
            const tx = await facets.accessControl.connect(signers.owner).grantRole(ROLES.ADMIN_ROLE, signers.admin.address);
            const receipt = await tx.wait();
            
            // Should not have RoleGranted event
            const roleGrantedEvents = receipt.logs.filter(log => {
                try {
                    const parsed = facets.accessControl.interface.parseLog(log);
                    return parsed.name === "RoleGranted";
                } catch {
                    return false;
                }
            });
            
            expect(roleGrantedEvents.length).to.equal(0);
        });
    });

    describe("Role Revoking", function () {
        beforeEach(async function () {
            // Setup some roles for revocation tests
            const { facets, signers } = deployment;
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.ADMIN_ROLE, signers.admin.address);
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.MINTER_ROLE, signers.minter.address);
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.PAUSER_ROLE, signers.pauser.address);
        });

        it("should allow admin to revoke roles", async function () {
            const { facets, signers } = deployment;
            
            await expectEvent(
                facets.accessControl.connect(signers.owner).revokeRole(ROLES.ADMIN_ROLE, signers.admin.address),
                facets.accessControl,
                "RoleRevoked",
                [ROLES.ADMIN_ROLE, signers.admin.address, signers.owner.address]
            );
            
            await expectRole(facets.accessControl, ROLES.ADMIN_ROLE, signers.admin.address, false);
        });

        it("should reject role revoking from non-admin", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.accessControl.connect(signers.user1).revokeRole(ROLES.MINTER_ROLE, signers.minter.address)
            ).to.be.revertedWithCustomError(facets.accessControl, "UnauthorizedRole");
        });

        it("should not emit event when revoking non-held role", async function () {
            const { facets, signers } = deployment;
            
            // Revoke role that user doesn't have
            const tx = await facets.accessControl.connect(signers.owner).revokeRole(ROLES.MINTER_ROLE, signers.user1.address);
            const receipt = await tx.wait();
            
            // Should not have RoleRevoked event
            const roleRevokedEvents = receipt.logs.filter(log => {
                try {
                    const parsed = facets.accessControl.interface.parseLog(log);
                    return parsed.name === "RoleRevoked";
                } catch {
                    return false;
                }
            });
            
            expect(roleRevokedEvents.length).to.equal(0);
        });
    });

    describe("Role Renouncing", function () {
        beforeEach(async function () {
            // Setup roles for renouncing tests
            const { facets, signers } = deployment;
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.ADMIN_ROLE, signers.admin.address);
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.MINTER_ROLE, signers.minter.address);
        });

        it("should allow user to renounce their own role", async function () {
            const { facets, signers } = deployment;
            
            await expectEvent(
                facets.accessControl.connect(signers.admin).renounceRole(ROLES.ADMIN_ROLE, signers.admin.address),
                facets.accessControl,
                "RoleRevoked",
                [ROLES.ADMIN_ROLE, signers.admin.address, signers.admin.address]
            );
            
            await expectRole(facets.accessControl, ROLES.ADMIN_ROLE, signers.admin.address, false);
        });

        it("should reject renouncing role for another user", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.accessControl.connect(signers.admin).renounceRole(ROLES.MINTER_ROLE, signers.minter.address)
            ).to.be.revertedWith("AccessControl: can only renounce roles for self");
        });

        it("should allow renouncing non-held role without error", async function () {
            const { facets, signers } = deployment;
            
            // Should not revert, but also should not emit event
            await expect(
                facets.accessControl.connect(signers.user1).renounceRole(ROLES.MINTER_ROLE, signers.user1.address)
            ).to.not.be.reverted;
        });
    });

    describe("Role Querying", function () {
        beforeEach(async function () {
            // Setup test roles
            const { facets, signers } = deployment;
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.ADMIN_ROLE, signers.admin.address);
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.MINTER_ROLE, signers.minter.address);
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.CUSTODIAN_ROLE, signers.custodian1.address);
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.CUSTODIAN_ROLE, signers.custodian2.address);
        });

        it("should correctly report role membership", async function () {
            const { facets, signers } = deployment;
            
            const isAdminMember = await facets.accessControl.hasRole(ROLES.ADMIN_ROLE, signers.admin.address);
            const isMinterMember = await facets.accessControl.hasRole(ROLES.MINTER_ROLE, signers.minter.address);
            const isNotMember = await facets.accessControl.hasRole(ROLES.ADMIN_ROLE, signers.user1.address);
            
            expect(isAdminMember).to.be.true;
            expect(isMinterMember).to.be.true;
            expect(isNotMember).to.be.false;
        });

        it("should correctly report multiple role memberships", async function () {
            const { facets, signers } = deployment;
            
            // Test multiple users having different roles
            const adminHasRole = await facets.accessControl.hasRole(ROLES.ADMIN_ROLE, signers.admin.address);
            const minterHasRole = await facets.accessControl.hasRole(ROLES.MINTER_ROLE, signers.minter.address);
            const custodian1HasRole = await facets.accessControl.hasRole(ROLES.CUSTODIAN_ROLE, signers.custodian1.address);
            const custodian2HasRole = await facets.accessControl.hasRole(ROLES.CUSTODIAN_ROLE, signers.custodian2.address);
            
            expect(adminHasRole).to.be.true;
            expect(minterHasRole).to.be.true;
            expect(custodian1HasRole).to.be.true;
            expect(custodian2HasRole).to.be.true;
        });

        it("should handle role queries for non-members", async function () {
            const { facets, signers } = deployment;
            
            // Test that users without roles properly return false
            const user1HasAdmin = await facets.accessControl.hasRole(ROLES.ADMIN_ROLE, signers.user1.address);
            const user2HasMinter = await facets.accessControl.hasRole(ROLES.MINTER_ROLE, signers.user2.address);
            const user3HasCustodian = await facets.accessControl.hasRole(ROLES.CUSTODIAN_ROLE, signers.user3.address);
            
            expect(user1HasAdmin).to.be.false;
            expect(user2HasMinter).to.be.false;
            expect(user3HasCustodian).to.be.false;
        });

        it("should handle role admin queries correctly", async function () {
            const { facets } = deployment;
            
            // Test that all roles have DEFAULT_ADMIN_ROLE as their admin
            const adminRoleAdmin = await facets.accessControl.getRoleAdmin(ROLES.ADMIN_ROLE);
            const minterRoleAdmin = await facets.accessControl.getRoleAdmin(ROLES.MINTER_ROLE);
            const pauserRoleAdmin = await facets.accessControl.getRoleAdmin(ROLES.PAUSER_ROLE);
            const custodianRoleAdmin = await facets.accessControl.getRoleAdmin(ROLES.CUSTODIAN_ROLE);
            
            expect(adminRoleAdmin).to.equal(ROLES.DEFAULT_ADMIN_ROLE);
            expect(minterRoleAdmin).to.equal(ROLES.DEFAULT_ADMIN_ROLE);
            expect(pauserRoleAdmin).to.equal(ROLES.DEFAULT_ADMIN_ROLE);
            expect(custodianRoleAdmin).to.equal(ROLES.DEFAULT_ADMIN_ROLE);
        });
    });

    describe("Edge Cases", function () {
        it("should properly check role membership for regular addresses", async function () {
            const { facets, signers } = deployment;
            
            // Test role checking for initially granted roles (only owner has DEFAULT_ADMIN_ROLE)
            const ownerHasDefaultAdmin = await facets.accessControl.hasRole(ROLES.DEFAULT_ADMIN_ROLE, signers.owner.address);
            const adminDoesNotHaveAdmin = await facets.accessControl.hasRole(ROLES.ADMIN_ROLE, signers.admin.address);
            
            expect(ownerHasDefaultAdmin).to.be.true;
            expect(adminDoesNotHaveAdmin).to.be.false; // Admin role not granted in this fixture
        });

        it("should handle non-existent role queries", async function () {
            const { facets, signers } = deployment;
            const fakeRole = ethers.keccak256(ethers.toUtf8Bytes("FAKE_ROLE"));
            
            const hasRole = await facets.accessControl.hasRole(fakeRole, signers.user1.address);
            const roleAdmin = await facets.accessControl.getRoleAdmin(fakeRole);
            
            expect(hasRole).to.be.false;
            expect(roleAdmin).to.equal(ROLES.DEFAULT_ADMIN_ROLE);
        });
    });

    describe("Access Control Integration", function () {
        it("should properly restrict mint function to MINTER_ROLE", async function () {
            const { facets, signers } = deployment;
            
            // Should fail without role
            await expect(
                facets.mintBurn.connect(signers.user1).mint(signers.user2.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(facets.mintBurn, "UnauthorizedRole");
            
            // Grant role and try again
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.MINTER_ROLE, signers.user1.address);
            
            await expect(
                facets.mintBurn.connect(signers.user1).mint(signers.user2.address, ethers.parseEther("100"))
            ).to.not.be.reverted;
        });

        it("should properly restrict pause function to PAUSER_ROLE", async function () {
            const { facets, signers } = deployment;
            
            // Should fail without role
            await expect(
                facets.pausable.connect(signers.user1).pause()
            ).to.be.revertedWithCustomError(facets.pausable, "UnauthorizedRole");
            
            // Grant role and try again
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.PAUSER_ROLE, signers.user1.address);
            
            await expect(
                facets.pausable.connect(signers.user1).pause()
            ).to.not.be.reverted;
        });
    });
});