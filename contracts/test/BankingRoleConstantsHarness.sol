// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "../lib/RoleConstants.sol";

/**
 * @title BankingRoleConstantsHarness
 * @dev Test-only harness exposing all 33 role constants (27 pre-Wave-1 including
 *      DEFAULT_ADMIN_ROLE, plus 6 Wave 1 additions) for cross-verification
 *      between Solidity declarations and JavaScript keccak256 hashes.
 */
contract BankingRoleConstantsHarness {
    bytes32 public constant DEFAULT_ADMIN_ROLE = RoleConstants.DEFAULT_ADMIN_ROLE;
    bytes32 public constant ADMIN_ROLE = RoleConstants.ADMIN_ROLE;
    bytes32 public constant MINTER_ROLE = RoleConstants.MINTER_ROLE;
    bytes32 public constant BURNER_ROLE = RoleConstants.BURNER_ROLE;
    bytes32 public constant PAUSER_ROLE = RoleConstants.PAUSER_ROLE;
    bytes32 public constant CUSTODIAN_ROLE = RoleConstants.CUSTODIAN_ROLE;
    bytes32 public constant VALIDATOR_ROLE = RoleConstants.VALIDATOR_ROLE;
    bytes32 public constant CONSORTIUM_MEMBER_ROLE = RoleConstants.CONSORTIUM_MEMBER_ROLE;
    bytes32 public constant BANK_REPRESENTATIVE_ROLE = RoleConstants.BANK_REPRESENTATIVE_ROLE;
    bytes32 public constant EMERGENCY_COORDINATOR_ROLE = RoleConstants.EMERGENCY_COORDINATOR_ROLE;
    bytes32 public constant ORACLE_ATTESTOR_ROLE = RoleConstants.ORACLE_ATTESTOR_ROLE;
    bytes32 public constant CONSORTIUM_AUDITOR_ROLE = RoleConstants.CONSORTIUM_AUDITOR_ROLE;
    bytes32 public constant DEPOSIT_TOKEN_ISSUER_ROLE = RoleConstants.DEPOSIT_TOKEN_ISSUER_ROLE;
    bytes32 public constant SPONSOR_BANK_ADMIN_ROLE = RoleConstants.SPONSOR_BANK_ADMIN_ROLE;
    bytes32 public constant SPONSOR_BANK_OPERATOR_ROLE = RoleConstants.SPONSOR_BANK_OPERATOR_ROLE;
    bytes32 public constant REVENUE_MANAGER_ROLE = RoleConstants.REVENUE_MANAGER_ROLE;
    bytes32 public constant INVESTMENT_MANAGER_ROLE = RoleConstants.INVESTMENT_MANAGER_ROLE;
    bytes32 public constant PROPERTY_MANAGER_ROLE = RoleConstants.PROPERTY_MANAGER_ROLE;
    bytes32 public constant COMPLIANCE_OFFICER_ROLE = RoleConstants.COMPLIANCE_OFFICER_ROLE;
    bytes32 public constant ORACLE_ROLE = RoleConstants.ORACLE_ROLE;
    bytes32 public constant EMERGENCY_ROLE = RoleConstants.EMERGENCY_ROLE;
    bytes32 public constant CAMBIO_ADMIN_ROLE = RoleConstants.CAMBIO_ADMIN_ROLE;
    bytes32 public constant CAMBIO_ISSUER_ROLE = RoleConstants.CAMBIO_ISSUER_ROLE;
    bytes32 public constant CAMBIO_REDEEMER_ROLE = RoleConstants.CAMBIO_REDEEMER_ROLE;
    bytes32 public constant COMPLIANCE_ROLE = RoleConstants.COMPLIANCE_ROLE;
    bytes32 public constant FEE_EXEMPT_ROLE = RoleConstants.FEE_EXEMPT_ROLE;
    bytes32 public constant INSTITUTION_ADMIN_ROLE = RoleConstants.INSTITUTION_ADMIN_ROLE;

    // Wave 1 Task 1.3 new roles
    bytes32 public constant ISSUER_OPERATOR_ROLE = RoleConstants.ISSUER_OPERATOR_ROLE;
    bytes32 public constant SETTLEMENT_KEEPER_ROLE = RoleConstants.SETTLEMENT_KEEPER_ROLE;
    bytes32 public constant SETTLEMENT_ATTESTOR_ROLE = RoleConstants.SETTLEMENT_ATTESTOR_ROLE;
    bytes32 public constant RISK_ADMIN_ROLE = RoleConstants.RISK_ADMIN_ROLE;
    bytes32 public constant LIFECYCLE_ADMIN_ROLE = RoleConstants.LIFECYCLE_ADMIN_ROLE;
    bytes32 public constant EMERGENCY_SETTLEMENT_ROLE = RoleConstants.EMERGENCY_SETTLEMENT_ROLE;
}
