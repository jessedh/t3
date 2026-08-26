# Wave 1 Role Authority Matrix

> **Scope:** Wave 1 adds six new roles to the existing 27 constants (including `DEFAULT_ADMIN_ROLE`), producing 33 total role constants of which 32 are non-zero. [Certain]
> This matrix documents proposed grant authority, currently enforced AccessControl admin configuration, future authorized operations, and separation-of-duty conflicts. [Certain]

---

## 1. Role Inventory

| # | Role | Hash | Status |
|---|---|---|---|
| 1 | `DEFAULT_ADMIN_ROLE` | `0x00` | Existing, AccessControl native [Certain] |
| 2 | `ADMIN_ROLE` | `keccak256("ADMIN_ROLE")` | Existing [Certain] |
| 3 | `MINTER_ROLE` | `keccak256("MINTER_ROLE")` | Existing [Certain] |
| 4 | `BURNER_ROLE` | `keccak256("BURNER_ROLE")` | Existing [Certain] |
| 5 | `PAUSER_ROLE` | `keccak256("PAUSER_ROLE")` | Existing [Certain] |
| 6 | `CUSTODIAN_ROLE` | `keccak256("CUSTODIAN_ROLE")` | Existing [Certain] |
| 7 | `VALIDATOR_ROLE` | `keccak256("VALIDATOR_ROLE")` | Existing [Certain] |
| 8 | `CONSORTIUM_MEMBER_ROLE` | `keccak256("CONSORTIUM_MEMBER_ROLE")` | Existing [Certain] |
| 9 | `BANK_REPRESENTATIVE_ROLE` | `keccak256("BANK_REPRESENTATIVE_ROLE")` | Existing [Certain] |
| 10 | `EMERGENCY_COORDINATOR_ROLE` | `keccak256("EMERGENCY_COORDINATOR_ROLE")` | Existing [Certain] |
| 11 | `ORACLE_ATTESTOR_ROLE` | `keccak256("ORACLE_ATTESTOR_ROLE")` | Existing [Certain] |
| 12 | `CONSORTIUM_AUDITOR_ROLE` | `keccak256("CONSORTIUM_AUDITOR_ROLE")` | Existing [Certain] |
| 13 | `DEPOSIT_TOKEN_ISSUER_ROLE` | `keccak256("DEPOSIT_TOKEN_ISSUER_ROLE")` | Existing [Certain] |
| 14 | `SPONSOR_BANK_ADMIN_ROLE` | `keccak256("SPONSOR_BANK_ADMIN_ROLE")` | Existing [Certain] |
| 15 | `SPONSOR_BANK_OPERATOR_ROLE` | `keccak256("SPONSOR_BANK_OPERATOR_ROLE")` | Existing [Certain] |
| 16 | `REVENUE_MANAGER_ROLE` | `keccak256("REVENUE_MANAGER_ROLE")` | Existing [Certain] |
| 17 | `INVESTMENT_MANAGER_ROLE` | `keccak256("INVESTMENT_MANAGER_ROLE")` | Existing [Certain] |
| 18 | `PROPERTY_MANAGER_ROLE` | `keccak256("PROPERTY_MANAGER_ROLE")` | Existing [Certain] |
| 19 | `COMPLIANCE_OFFICER_ROLE` | `keccak256("COMPLIANCE_OFFICER_ROLE")` | Existing [Certain] |
| 20 | `ORACLE_ROLE` | `keccak256("ORACLE_ROLE")` | Existing [Certain] |
| 21 | `EMERGENCY_ROLE` | `keccak256("EMERGENCY_ROLE")` | Existing [Certain] |
| 22 | `CAMBIO_ADMIN_ROLE` | `keccak256("CAMBIO_ADMIN_ROLE")` | Existing [Certain] |
| 23 | `CAMBIO_ISSUER_ROLE` | `keccak256("CAMBIO_ISSUER_ROLE")` | Existing [Certain] |
| 24 | `CAMBIO_REDEEMER_ROLE` | `keccak256("CAMBIO_REDEEMER_ROLE")` | Existing [Certain] |
| 25 | `COMPLIANCE_ROLE` | `keccak256("COMPLIANCE_ROLE")` | Existing [Certain] |
| 26 | `FEE_EXEMPT_ROLE` | `keccak256("FEE_EXEMPT_ROLE")` | Existing [Certain] |
| 27 | `INSTITUTION_ADMIN_ROLE` | `keccak256("INSTITUTION_ADMIN_ROLE")` | Existing [Certain] |
| 28 | `ISSUER_OPERATOR_ROLE` | `keccak256("ISSUER_OPERATOR_ROLE")` | **Wave 1 new** [Certain] |
| 29 | `SETTLEMENT_KEEPER_ROLE` | `keccak256("SETTLEMENT_KEEPER_ROLE")` | **Wave 1 new** [Certain] |
| 30 | `SETTLEMENT_ATTESTOR_ROLE` | `keccak256("SETTLEMENT_ATTESTOR_ROLE")` | **Wave 1 new** [Certain] |
| 31 | `RISK_ADMIN_ROLE` | `keccak256("RISK_ADMIN_ROLE")` | **Wave 1 new** [Certain] |
| 32 | `LIFECYCLE_ADMIN_ROLE` | `keccak256("LIFECYCLE_ADMIN_ROLE")` | **Wave 1 new** [Certain] |
| 33 | `EMERGENCY_SETTLEMENT_ROLE` | `keccak256("EMERGENCY_SETTLEMENT_ROLE")` | **Wave 1 new** [Certain] |

There are 33 total unique role constants including `DEFAULT_ADMIN_ROLE`. [Certain] There are 32 non-zero role constants. [Certain] The pre-Wave-1 set contains 27 constants (26 non-zero); Wave 1 adds 6 non-zero constants. [Certain]

---

## 2. Proposed Grant Authority vs. Enforced Admin Configuration

**Proposed grant authority** describes the intended governance model for who may grant or revoke a role. [Likely]
**Currently enforced AccessControl admin configuration** describes what the Diamond's `AccessControlFacet` actually enforces at runtime, which today uses `DEFAULT_ADMIN_ROLE` as the admin for all roles unless explicitly reconfigured. [Certain]

| Role | Proposed Grant Authority | Currently Enforced Admin | Notes |
|---|---|---|---|
| `ISSUER_OPERATOR_ROLE` | `RISK_ADMIN_ROLE` or `DEFAULT_ADMIN_ROLE` | `DEFAULT_ADMIN_ROLE` | Wave 4+ implementation will set role admin. [Likely] |
| `SETTLEMENT_KEEPER_ROLE` | `LIFECYCLE_ADMIN_ROLE` or `DEFAULT_ADMIN_ROLE` | `DEFAULT_ADMIN_ROLE` | Keeper automation may use timelock grantor. [Likely] |
| `SETTLEMENT_ATTESTOR_ROLE` | `LIFECYCLE_ADMIN_ROLE` or `DEFAULT_ADMIN_ROLE` | `DEFAULT_ADMIN_ROLE` | Multi-sig attestation expected in Wave 5. [Likely] |
| `RISK_ADMIN_ROLE` | `DEFAULT_ADMIN_ROLE` | `DEFAULT_ADMIN_ROLE` | No routine role should be able to self-grant risk limits. [Certain] |
| `LIFECYCLE_ADMIN_ROLE` | `DEFAULT_ADMIN_ROLE` | `DEFAULT_ADMIN_ROLE` | Separation from `RISK_ADMIN_ROLE` prevents unilateral pause-and-raise. [Certain] |
| `EMERGENCY_SETTLEMENT_ROLE` | `DEFAULT_ADMIN_ROLE` | `DEFAULT_ADMIN_ROLE` | Narrow recovery scope; may be granted to timelock or multi-sig. [Likely] |

`CONSORTIUM_AUDITOR_ROLE` remains under `DEFAULT_ADMIN_ROLE` and is not redeclared in Wave 1. [Certain]

---

## 3. Future Authorized Operations by Role

These operations are planned for future waves and are not yet implemented or enforced. [Likely]

| Role | Future Authorized Operations | Wave |
|---|---|---|
| `ISSUER_OPERATOR_ROLE` | Request issuance quote; reserve issuance capacity; execute direct single-bank issuance. | Wave 4 [Likely] |
| `SETTLEMENT_KEEPER_ROLE` | Open settlement cycle; propose obligation root; advance cycle state machine. | Wave 5 [Likely] |
| `SETTLEMENT_ATTESTOR_ROLE` | Submit off-chain settlement attestations; confirm Fedwire receipt. | Wave 5 [Likely] |
| `RISK_ADMIN_ROLE` | Update policy limits; accept signed capacity attestations; set standing assumptions. | Wave 3A [Likely] |
| `LIFECYCLE_ADMIN_ROLE` | Initiate pause, orderly exit, default, and resolution; reassign wallet institution. | Wave 3B [Likely] |
| `EMERGENCY_SETTLEMENT_ROLE` | Fail expired cycles; perform narrowly defined recovery actions. | Wave 5 [Likely] |

---

## 4. Separation-of-Duty Conflicts

No single routine role should be able to raise a ceiling, deposit unverified collateral, mint T3, raise standing assumption limits, and finalize reimbursement settlement. [Certain]

| Conflict Pair | Rationale |
|---|---|
| `RISK_ADMIN_ROLE` + `ISSUER_OPERATOR_ROLE` | Risk policy and issuance execution must be separable to prevent self-approved capacity breaches. [Certain] |
| `RISK_ADMIN_ROLE` + `LIFECYCLE_ADMIN_ROLE` | Raising limits while freezing institutions could mask risk. [Certain] |
| `SETTLEMENT_KEEPER_ROLE` + `SETTLEMENT_ATTESTOR_ROLE` | Proposing cycles and attesting to their funding must be independent to prevent self-confirmation. [Certain] |
| `EMERGENCY_SETTLEMENT_ROLE` + `ISSUER_OPERATOR_ROLE` | Emergency failure and new issuance should not be controlled by the same party. [Likely] |
| `LIFECYCLE_ADMIN_ROLE` + `MINTER_ROLE` | Institution lifecycle and supply creation must be separable. [Certain] |

---

## 5. Factual Confidence Summary

- All 33 role hashes are deterministic and verified by Solidity compilation and JavaScript keccak256 cross-check. [Certain]
- Role admin reconfiguration to proposed grant authority requires Wave 4+ facet implementation. [Likely]
- Separation-of-duty enforcement is currently procedural (runbook) and will become on-chain where feasible in Wave 7+. [Likely]
