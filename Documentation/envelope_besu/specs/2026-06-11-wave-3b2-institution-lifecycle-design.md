# Wave 3B.2 — Institution Lifecycle Design

**Date:** 2026-06-11
**Branch:** `feature/envelope-besu`
**Status:** APPROVED — ready for implementation

---

## Problem

`ConsortiumMembershipFacet.setBankActivation(false)` currently flips a bank off in a single admin call with no lifecycle gate. An institution in ACTIVE mode can be silently deactivated even while it holds outstanding reserve, open envelopes, or live cycles. Additionally, `InstitutionRegistryFacet.linkWalletToInstitution` and `CustodianRegistryFacet.registerCustodiedWallet` accept new associations for institutions in any lifecycle state, including DEFAULT and RESOLVED.

---

## Decision — Option B (cross-reference model)

Banks operate across two data models in this codebase:

| Model | Storage | Key | Status field |
|---|---|---|---|
| Old (InstitutionStorage) | `InstitutionStorage` | `bytes32 institutionId` | `InstitutionStatus` (Active/Inactive) |
| New (consortium) | `ConsortiumStorage` + `InstitutionLifecycleStorage` | `address bank` | `InstitutionMode` (5-state) |

Option B: add a bidirectional cross-reference mapping in `InstitutionLifecycleStorage` so both models can resolve to the canonical `InstitutionMode`. Non-bank custodians default to `ACTIVE (0)` and are unaffected.

---

## File Changes (7 files)

### 1. `contracts/lib/InstitutionLifecycleStorage.sol`

Add two cross-reference mappings before `__gap`. Gap shrinks from `uint256[47]` to `uint256[45]`.

```solidity
mapping(bytes32 => address) institutionIdToBank;  // InstitutionStorage ID → bank address
mapping(address => bytes32) bankToInstitutionId;  // bank address → InstitutionStorage ID
```

### 2. `contracts/facets/InstitutionLifecycleFacet.sol` (new)

```solidity
// Events
event InstitutionModeChanged(address indexed institution, InstitutionLifecycleStorage.InstitutionMode oldMode, InstitutionLifecycleStorage.InstitutionMode newMode);
event BankInstitutionLinked(address indexed bank, bytes32 indexed institutionId);

// Errors
error InvalidModeTransition(address institution, InstitutionLifecycleStorage.InstitutionMode current, InstitutionLifecycleStorage.InstitutionMode proposed);
error LifecycleDeactivationBlocked(address bank, InstitutionLifecycleStorage.InstitutionMode mode);
error BankAlreadyLinked(address bank, bytes32 existingId);
error InstitutionIdAlreadyLinked(bytes32 institutionId, address existingBank);
```

**Valid transition table (enforced, all others revert `InvalidModeTransition`):**

```
ACTIVE (0)          → ISSUANCE_PAUSED (1)
ACTIVE (0)          → ORDERLY_EXIT (2)
ACTIVE (0)          → DEFAULT (3)
ISSUANCE_PAUSED (1) → ACTIVE (0)
ORDERLY_EXIT (2)    → RESOLVED (4)
DEFAULT (3)         → RESOLVED (4)
RESOLVED (4)        → (terminal, no transitions out)
```

**Functions:**

```solidity
// Admin-only: enforce state-machine transition
function setInstitutionMode(address institution, InstitutionLifecycleStorage.InstitutionMode newMode) external onlyAdmin;

// Admin-only: create bidirectional cross-reference (idempotent if same pair, reverts on conflict)
function linkBankToInstitution(address bank, bytes32 institutionId) external onlyAdmin;

// Views
function getInstitutionMode(address institution) external view returns (InstitutionLifecycleStorage.InstitutionMode);
function resolveInstitutionBank(bytes32 institutionId) external view returns (address);
function resolveBankInstitution(address bank) external view returns (bytes32);
```

### 3. `contracts/facets/ConsortiumMembershipFacet.sol`

Modify `setBankActivation` — when `isActive == false`, require the bank's current mode to be ORDERLY_EXIT, DEFAULT, or RESOLVED before allowing the flip:

```solidity
function setBankActivation(address bank, bool isActive) external onlyAdmin whenNotPaused {
    // ... existing checks ...
    if (!isActive) {
        InstitutionLifecycleStorage.InstitutionMode mode =
            InstitutionLifecycleStorage.layout().institutionMode[bank];
        if (mode != InstitutionLifecycleStorage.InstitutionMode.ORDERLY_EXIT &&
            mode != InstitutionLifecycleStorage.InstitutionMode.DEFAULT  &&
            mode != InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
            revert InstitutionLifecycleFacet.LifecycleDeactivationBlocked(bank, mode);
        }
    }
    // ... existing activation logic ...
}
```

`isActive == true` is always allowed (re-activation is admin's prerogative).

### 4. `contracts/facets/InstitutionRegistryFacet.sol`

Modify `linkWalletToInstitution` — after the existing `InstitutionStatus.Active` check, add:

```solidity
address bankAddr = InstitutionLifecycleStorage.layout().institutionIdToBank[institutionId];
if (bankAddr != address(0)) {
    InstitutionLifecycleStorage.InstitutionMode mode =
        InstitutionLifecycleStorage.layout().institutionMode[bankAddr];
    if (mode == InstitutionLifecycleStorage.InstitutionMode.DEFAULT ||
        mode == InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
        revert InstitutionModeBlocksWalletLinking(institutionId, mode);
    }
}
```

Add error: `error InstitutionModeBlocksWalletLinking(bytes32 institutionId, InstitutionLifecycleStorage.InstitutionMode mode)`.

If no cross-reference exists (`bankAddr == address(0)`), the check is skipped — backward compatible with InstitutionStorage-only registrations.

ISSUANCE_PAUSED and ORDERLY_EXIT allow wallet linking (wind-down may require onboarding recovery wallets).

### 5. `contracts/facets/CustodianRegistryFacet.sol`

Modify `registerCustodiedWallet` — add at the top of the function body, after the role check:

```solidity
{
    InstitutionLifecycleStorage.InstitutionMode mode =
        InstitutionLifecycleStorage.layout().institutionMode[msg.sender];
    if (mode == InstitutionLifecycleStorage.InstitutionMode.DEFAULT ||
        mode == InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
        revert InstitutionModeBlocksCustodianRegistration(msg.sender, mode);
    }
}
```

Add error: `error InstitutionModeBlocksCustodianRegistration(address custodian, InstitutionLifecycleStorage.InstitutionMode mode)`.

Non-bank custodians return `ACTIVE (0)` from the storage lookup and pass with a single cold SLOAD overhead.

### 6. `test/unit/InstitutionLifecycleFacet.test.js` (new)

Cover:
- All valid transitions succeed and emit `InstitutionModeChanged`
- All invalid transitions revert `InvalidModeTransition`
- RESOLVED is terminal (all transitions out revert)
- `linkBankToInstitution` stores both directions; idempotent on same pair; reverts `BankAlreadyLinked` / `InstitutionIdAlreadyLinked` on conflict
- `setBankActivation(false)` reverts `LifecycleDeactivationBlocked` when mode is ACTIVE or ISSUANCE_PAUSED
- `setBankActivation(false)` succeeds when mode is ORDERLY_EXIT, DEFAULT, or RESOLVED

### 7. `test/integration/InstitutionDefaultFreeze.test.js` (new)

End-to-end scenario:
1. Register bank + institution; link them via `linkBankToInstitution`
2. ACTIVE → DEFAULT: `linkWalletToInstitution` reverts `InstitutionModeBlocksWalletLinking`
3. ACTIVE → DEFAULT: `registerCustodiedWallet` (by bank-as-custodian) reverts `InstitutionModeBlocksCustodianRegistration`
4. ACTIVE → DEFAULT → `setBankActivation(false)` succeeds
5. ACTIVE → ORDERLY_EXIT → `linkWalletToInstitution` succeeds (wind-down allowed)
6. ORDERLY_EXIT → RESOLVED → `setBankActivation(false)` succeeds

---

## Wiring

`scripts/lib/facet-manifest.js`: add `{ name: "InstitutionLifecycleFacet" }` after line containing `ConsortiumMembershipFacet`.

`test/helpers/deployment.js`:
- Add `"InstitutionLifecycleFacet"` to `phase1Facets` array (near line 81)
- Add `facetContracts.institutionLifecycle = await ethers.getContractAt("InstitutionLifecycleFacet", diamondAddress)` (near line 307)

---

## Invariants

- `InstitutionLifecycleStorage.institutionMode[addr]` defaults to `ACTIVE (0)` for all addresses — backward compatible with all existing tests.
- A bank with no registered cross-reference still has mode ACTIVE and can be deactivated only via lifecycle (once it's in ORDERLY_EXIT/DEFAULT/RESOLVED).
- `linkBankToInstitution` is idempotent for the same (bank, institutionId) pair; re-linking a bank to a different institutionId reverts.
