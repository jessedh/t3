const { ethers } = require("hardhat");

/**
 * Role management utilities for testing
 */

// Role constants (must match RoleConstants.sol)
const ROLES = {
    DEFAULT_ADMIN_ROLE: "0x0000000000000000000000000000000000000000000000000000000000000000",
    ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")),
    MINTER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")),
    PAUSER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("PAUSER_ROLE")),
    CUSTODIAN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("CUSTODIAN_ROLE")),
    BURNER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE")),
    CONSORTIUM_MEMBER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("CONSORTIUM_MEMBER_ROLE")),
    BANK_REPRESENTATIVE_ROLE: ethers.keccak256(ethers.toUtf8Bytes("BANK_REPRESENTATIVE_ROLE")),
    EMERGENCY_COORDINATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_COORDINATOR_ROLE")),
    ORACLE_ATTESTOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ATTESTOR_ROLE")),
    CONSORTIUM_AUDITOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("CONSORTIUM_AUDITOR_ROLE")),
    DEPOSIT_TOKEN_ISSUER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("DEPOSIT_TOKEN_ISSUER_ROLE")),
    
    // Phase 2 roles
    SPONSOR_BANK_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("SPONSOR_BANK_ADMIN_ROLE")),
    SPONSOR_BANK_OPERATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("SPONSOR_BANK_OPERATOR_ROLE")),
    REVENUE_MANAGER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("REVENUE_MANAGER_ROLE")),
    
    // Phase 3 roles
    INVESTMENT_MANAGER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("INVESTMENT_MANAGER_ROLE")),
    COMPLIANCE_OFFICER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("COMPLIANCE_OFFICER_ROLE")),

    // Cambio roles
    CAMBIO_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("CAMBIO_ADMIN_ROLE")),
    CAMBIO_ISSUER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("CAMBIO_ISSUER_ROLE")),
    CAMBIO_REDEEMER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("CAMBIO_REDEEMER_ROLE")),

    // Institution management role
    INSTITUTION_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("INSTITUTION_ADMIN_ROLE")),

    // Wave 1 — Banking control and settlement
    ISSUER_OPERATOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ISSUER_OPERATOR_ROLE")),
    SETTLEMENT_KEEPER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_KEEPER_ROLE")),
    SETTLEMENT_ATTESTOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ATTESTOR_ROLE")),
    RISK_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("RISK_ADMIN_ROLE")),
    LIFECYCLE_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("LIFECYCLE_ADMIN_ROLE")),
    EMERGENCY_SETTLEMENT_ROLE: ethers.keccak256(ethers.toUtf8Bytes("EMERGENCY_SETTLEMENT_ROLE")),

    // Wave 8C — Sanctions / AML screening attestation
    SCREENING_ATTESTOR_ROLE: ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE")),

    // Wave 8E-1 — scoped sanctions + requirement-control exemptions
    NETWORK_SCREENING_AUTHORITY_ROLE: ethers.keccak256(ethers.toUtf8Bytes("NETWORK_SCREENING_AUTHORITY_ROLE")),
    COMPLIANCE_EXEMPTION_ROLE: ethers.keccak256(ethers.toUtf8Bytes("COMPLIANCE_EXEMPTION_ROLE")),

    // Obs-4 / E2 — institutional gate on direct ERC-20 transfers
    DIRECT_TRANSFER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("DIRECT_TRANSFER_ROLE"))
};

/**
 * Grant a role to an address
 * @param {Contract} accessControlFacet - AccessControlFacet attached to diamond
 * @param {string} role - Role hash
 * @param {string} account - Address to grant role to
 * @param {Signer} grantor - Signer with permission to grant the role
 */
async function grantRole(accessControlFacet, role, account, grantor) {
    const tx = await accessControlFacet.connect(grantor).grantRole(role, account);
    await tx.wait();
    console.log(`✅ Granted role ${role} to ${account}`);
}

/**
 * Setup standard test roles for a diamond deployment
 * @param {Object} facets - Facet contracts object
 * @param {Object} signers - Signers object
 */
async function setupTestRoles(facets, signers) {
    console.log("\n🔑 Setting up test roles...");
    
    const { accessControl } = facets;
    const { owner, admin, minter, pauser, custodian1, custodian2 } = signers;

    try {
        // Grant admin role to admin signer
        await grantRole(accessControl, ROLES.ADMIN_ROLE, admin.address, owner);
        
        // Grant operational roles
        await grantRole(accessControl, ROLES.MINTER_ROLE, minter.address, owner);
        await grantRole(accessControl, ROLES.PAUSER_ROLE, pauser.address, owner);
        await grantRole(accessControl, ROLES.CUSTODIAN_ROLE, custodian1.address, owner);
        await grantRole(accessControl, ROLES.CUSTODIAN_ROLE, custodian2.address, owner);
        await grantRole(accessControl, ROLES.BURNER_ROLE, owner.address, owner);
        await grantRole(accessControl, ROLES.DEPOSIT_TOKEN_ISSUER_ROLE, minter.address, owner);
        await grantRole(accessControl, ROLES.BANK_REPRESENTATIVE_ROLE, admin.address, owner);
        await grantRole(accessControl, ROLES.CONSORTIUM_MEMBER_ROLE, admin.address, owner);

        // Wave 8E-1 — owner doubles as network screening authority + exemption granter + attestor in tests
        await grantRole(accessControl, ROLES.NETWORK_SCREENING_AUTHORITY_ROLE, owner.address, owner);
        await grantRole(accessControl, ROLES.COMPLIANCE_EXEMPTION_ROLE, owner.address, owner);
        await grantRole(accessControl, ROLES.SCREENING_ATTESTOR_ROLE, owner.address, owner);

        console.log("✅ Standard test roles configured");
    } catch (error) {
        console.error("❌ Role setup failed:", error.message);
        throw error;
    }
}

/**
 * Setup Phase 2 roles for sponsor bank testing
 * @param {Object} facets - Facet contracts object  
 * @param {Object} signers - Signers object
 */
async function setupPhase2Roles(facets, signers) {
    console.log("\n🔑 Setting up Phase 2 roles...");
    
    const { accessControl } = facets;
    const { owner, admin } = signers;
    
    try {
        // Grant sponsor bank admin role to admin
        await grantRole(accessControl, ROLES.SPONSOR_BANK_ADMIN_ROLE, admin.address, owner);
        
        // Grant revenue manager role to admin (for testing)
        await grantRole(accessControl, ROLES.REVENUE_MANAGER_ROLE, admin.address, owner);
        
        console.log("✅ Phase 2 roles configured");
    } catch (error) {
        console.error("❌ Phase 2 role setup failed:", error.message);
        throw error;
    }
}

/**
 * Setup Phase 3 roles for investment platform testing
 * @param {Object} facets - Facet contracts object
 * @param {Object} signers - Signers object  
 */
async function setupPhase3Roles(facets, signers) {
    console.log("\n🔑 Setting up Phase 3 roles...");
    
    const { accessControl } = facets;
    const { owner, admin, user1 } = signers;
    
    try {
        // Grant investment manager role
        await grantRole(accessControl, ROLES.INVESTMENT_MANAGER_ROLE, admin.address, owner);
        
        // Grant compliance officer role to user1 (separate from admin)
        await grantRole(accessControl, ROLES.COMPLIANCE_OFFICER_ROLE, user1.address, owner);
        
        console.log("✅ Phase 3 roles configured");
    } catch (error) {
        console.error("❌ Phase 3 role setup failed:", error.message);
        throw error;
    }
}

/**
 * Check if an address has a specific role
 * @param {Contract} accessControlFacet - AccessControlFacet attached to diamond
 * @param {string} role - Role hash
 * @param {string} account - Address to check
 * @returns {boolean} True if account has role
 */
async function hasRole(accessControlFacet, role, account) {
    return await accessControlFacet.hasRole(role, account);
}

/**
 * Revoke a role from an address
 * @param {Contract} accessControlFacet - AccessControlFacet attached to diamond
 * @param {string} role - Role hash
 * @param {string} account - Address to revoke role from
 * @param {Signer} revoker - Signer with permission to revoke the role
 */
async function revokeRole(accessControlFacet, role, account, revoker) {
    const tx = await accessControlFacet.connect(revoker).revokeRole(role, account);
    await tx.wait();
    console.log(`✅ Revoked role ${role} from ${account}`);
}

module.exports = {
    ROLES,
    grantRole,
    setupTestRoles,
    setupPhase2Roles,
    setupPhase3Roles,
    hasRole,
    revokeRole
};
