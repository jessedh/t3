// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library RoleConstants {
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant CUSTODIAN_ROLE = keccak256("CUSTODIAN_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    // Consortium banking extensions
    bytes32 public constant CONSORTIUM_MEMBER_ROLE = keccak256("CONSORTIUM_MEMBER_ROLE");
    bytes32 public constant BANK_REPRESENTATIVE_ROLE = keccak256("BANK_REPRESENTATIVE_ROLE");
    bytes32 public constant EMERGENCY_COORDINATOR_ROLE = keccak256("EMERGENCY_COORDINATOR_ROLE");
    bytes32 public constant ORACLE_ATTESTOR_ROLE = keccak256("ORACLE_ATTESTOR_ROLE");
    bytes32 public constant CONSORTIUM_AUDITOR_ROLE = keccak256("CONSORTIUM_AUDITOR_ROLE");
    bytes32 public constant DEPOSIT_TOKEN_ISSUER_ROLE = keccak256("DEPOSIT_TOKEN_ISSUER_ROLE");
    
    // Phase 2 - Sponsor Bank Distribution Framework
    bytes32 public constant SPONSOR_BANK_ADMIN_ROLE = keccak256("SPONSOR_BANK_ADMIN_ROLE");
    bytes32 public constant SPONSOR_BANK_OPERATOR_ROLE = keccak256("SPONSOR_BANK_OPERATOR_ROLE");
    bytes32 public constant REVENUE_MANAGER_ROLE = keccak256("REVENUE_MANAGER_ROLE");
    
    // Phase 3 - Universal Investment Platform
    bytes32 public constant INVESTMENT_MANAGER_ROLE = keccak256("INVESTMENT_MANAGER_ROLE");
    bytes32 public constant PROPERTY_MANAGER_ROLE = keccak256("PROPERTY_MANAGER_ROLE");
    bytes32 public constant COMPLIANCE_OFFICER_ROLE = keccak256("COMPLIANCE_OFFICER_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // Cambio analog issuance framework (controls note life-cycle authority)
    bytes32 public constant CAMBIO_ADMIN_ROLE = keccak256("CAMBIO_ADMIN_ROLE");
    bytes32 public constant CAMBIO_ISSUER_ROLE = keccak256("CAMBIO_ISSUER_ROLE");
    bytes32 public constant CAMBIO_REDEEMER_ROLE = keccak256("CAMBIO_REDEEMER_ROLE");
    
    // Envelope compliance & settlement
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    // Fee Exemption
    bytes32 public constant FEE_EXEMPT_ROLE = keccak256("FEE_EXEMPT_ROLE");

    // Institution Management
    bytes32 public constant INSTITUTION_ADMIN_ROLE = keccak256("INSTITUTION_ADMIN_ROLE");

    // Wave 1 — Banking control and settlement
    bytes32 public constant ISSUER_OPERATOR_ROLE = keccak256("ISSUER_OPERATOR_ROLE");
    bytes32 public constant SETTLEMENT_KEEPER_ROLE = keccak256("SETTLEMENT_KEEPER_ROLE");
    bytes32 public constant SETTLEMENT_ATTESTOR_ROLE = keccak256("SETTLEMENT_ATTESTOR_ROLE");
    bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");
    bytes32 public constant LIFECYCLE_ADMIN_ROLE = keccak256("LIFECYCLE_ADMIN_ROLE");
    bytes32 public constant EMERGENCY_SETTLEMENT_ROLE = keccak256("EMERGENCY_SETTLEMENT_ROLE");

    // Wave 8C — Sanctions / AML screening attestation
    bytes32 public constant SCREENING_ATTESTOR_ROLE = keccak256("SCREENING_ATTESTOR_ROLE");

    // Wave 8E-1 — scoped sanctions + requirement-control exemptions
    bytes32 public constant NETWORK_SCREENING_AUTHORITY_ROLE = keccak256("NETWORK_SCREENING_AUTHORITY_ROLE");
    bytes32 public constant COMPLIANCE_EXEMPTION_ROLE = keccak256("COMPLIANCE_EXEMPTION_ROLE");

    // Obs-4 / E2 — institutional gate on direct ERC-20 transfers (customer
    // transfers are envelope-mediated; this role marks treasury/ops wallets)
    bytes32 public constant DIRECT_TRANSFER_ROLE = keccak256("DIRECT_TRANSFER_ROLE");
}
