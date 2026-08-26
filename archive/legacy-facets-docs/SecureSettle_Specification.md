# T3 SecureSettle - Formal Specification

**Version:** 1.0  
**Status:** Implemented  
**Last Updated:** December 2024

---

## 1. Overview

**SecureSettle** is a functional extension of the T3 Programmable Fiat Framework designed to serve as a universal crypto-to-fiat settlement bridge. It leverages on-chain smart contract escrows and a trusted oracle system to eliminate settlement risk for asynchronous trades.

The system is designed to be asset-agnostic, support self-custody use cases, and integrate a novel custodial reversal mechanism to balance consumer protection with settlement finality.

---

## 2. Architecture

SecureSettle is implemented as a modular facet within the T3 Diamond Standard architecture. It interacts with several key components:

- **`SecureSettleFacet.sol`**: The core smart contract logic for creating, managing, and settling escrows.
- **`StorageLib.sol`**: Contains the core data structures (`SecureSettleData`, `CustodialReversal`).
- **Oracle Service**: An off-chain entity (e.g., Cubix network, Chainlink) responsible for verifying fiat payments and calling the settlement function on-chain.
- **Bridge & Escrow Orchestrator**: A backend service that programmatically manages the asset bridging workflow for non-native assets like Bitcoin.

### Architecture Diagram

```
┌──────────────────────────┐      ┌──────────────────────────┐      ┌──────────────────────────┐
│       User Interface     │◀─────▶   Orchestrator Service   │◀─────▶      Avalanche Bridge    │
└──────────────────────────┘      └────────────┬─────────────┘      └──────────────────────────┘
                                               │
                                               ▼
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│                                   T3 Diamond Contract (on-chain)                            │
│                                                                                             │
│   ┌────────────────────────┐      ┌────────────────────────┐      ┌───────────────────────┐   │
│   │   SecureSettleFacet    │◀─────▶      StorageLib        │◀─────▶   AccessControlFacet  │   │
│   │ (Escrow Logic)         │      │ (State Variables)      │      │ (Roles & Permissions) │   │
│   └────────────────────────┘      └────────────────────────┘      └───────────────────────┘   │
│               ▲                                                                             │
│               │ (settle() call)                                                             │
└───────────────┼─────────────────────────────────────────────────────────────────────────────┘
               │
┌───────────────┴────────────────┐
│      Settlement Oracle         │
│ (Monitors Fiat Rails - Cubix)  │
└────────────────────────────────┘
```

---

## 3. Core Data Structures

### `SecureSettleData`
Stores the state for a single cross-party settlement.

```solidity
struct SecureSettleData {
    address cryptoAsset;           // The ERC20 token address of the asset being escrowed.
    uint256 cryptoAmount;          // The amount of the crypto asset held in escrow.
    string fiatCurrency;           // The fiat currency for settlement (e.g., "USD").
    uint256 fiatAmount;            // The expected fiat amount.
    bytes32 cubixTransactionId;    // The off-chain reference ID for the fiat transaction.
    bytes32 clearingEndpointHash;  // A keccak256 hash of a URL, nonce, and secret for dynamic clearing.
    uint8 settlementMode;          // 0 for custodial, 1 for self-custody.
    address breakGlassCustodian;   // An authorized address for emergency recovery in self-custody mode.
    uint256 oracleConfirmationAt;  // Timestamp of when the oracle confirmed settlement.
    bool requiresCustodianApproval;
    bool isEndpointRevealed;       // Tracks if the clearing endpoint was revealed to prevent replay.
}
```

### `CustodialReversal`
Manages funds from a `reverseTransfer()` call that are held in custody due to recent settlement activity.

```solidity
struct CustodialReversal {
    address originalSender;        // The user who initiated the reversal.
    address originalRecipient;     // The original target of the reversed transaction.
    uint256 amount;                // The amount being held in the custodial wallet.
    bytes32 relatedSettlementId;   // The SecureSettle transaction that triggered custodial intervention.
    uint256 autoReleaseTime;       // Timestamp when funds can be automatically returned if the settlement expires.
    bool isReleased;               // Flag indicating if the funds have been released from custody.
    string disputeReason;          // The reason provided for the custodial hold.
}
```

---

## 4. Functional Specification

### 4.1. Cross-Party Settlement

**Workflow:**
1.  **Commit Phase**: The seller calls `createSecureSettle()`, depositing the crypto asset and committing to a `clearingEndpointHash`.
2.  **Fiat Transfer**: The buyer sends fiat off-chain.
3.  **Reveal Phase**: A trusted oracle, upon seeing the fiat payment, calls `confirmFiatSettlement()`, revealing the original `clearingURL`, `nonce`, and `secret`.
4.  **Verification & Release**: The contract verifies the revealed data matches the stored hash and releases the crypto asset to the buyer.
5.  **Timeout**: If the fiat payment is not confirmed before the settlement window expires, the seller can call `refund()` to reclaim their crypto asset.

### 4.2. Self-Custody Vault

This mode allows a user to create a personal, time-locked vault with an institutional recovery option.

**Workflow:**
1.  **Vault Creation**: A user calls `createSelfEscrow()`, setting `sender` and `recipient` to their own address. They provide a `secretHash` and designate a `breakGlassCustodian`.
2.  **Normal Release**: The user can reclaim their assets at any time by calling `releaseEscrow()` and providing the original secret.
3.  **Emergency Recovery**: If the user loses their secret, the designated `breakGlassCustodian` (who must have `CUSTODIAN_ROLE`) can call `custodianRecover()` to return the assets to the user's wallet. This action is heavily audited.

### 4.3. Settlement Risk Mitigation (Custodial Reversals)

This mechanism prevents a malicious actor from abusing T3's `reverseTransfer` feature to defraud a counterparty.

**Logic:**
- If a user involved in a recent `SecureSettle` transaction calls `reverseTransfer(transferId)`, the funds are not returned to them directly.
- Instead, the funds are transferred to a secure custodial wallet controlled by the T3 system.
- The funds are held until one of three conditions is met:
    1.  **Auto-Release**: The associated settlement expires without completion. The funds are safely returned to the original reverser.
    2.  **Custodian Resolution**: A designated custodian investigates the dispute and manually directs the funds to the rightful owner (sender or recipient).
    3.  **Multi-Sig Emergency Resolution**: For high-value disputes, multiple administrators must approve the resolution.

---

## 5. API Reference (Core Functions)

### `createSecureSettle`
Initiates a standard crypto-to-fiat escrow.
```solidity
function createSecureSettle(address cryptoAsset, uint256 cryptoAmount, string calldata fiatCurrency, uint256 fiatAmount, bytes32 clearingEndpointHash) external payable returns (bytes32 settlementId);
```

### `confirmFiatSettlement`
Called by an oracle to confirm fiat payment and release assets.
```solidity
function confirmFiatSettlement(bytes32 settlementId, string calldata clearingURL, bytes32 nonce, bytes32 userSecret, bytes32 cubixTransactionId) external;
```
**Access Control**: `SETTLEMENT_ORACLE_ROLE`

### `createSelfEscrow`
Creates a personal, time-locked vault.
```solidity
function createSelfEscrow(address cryptoAsset, uint256 amount, bytes32 secretHash, uint256 releaseTime, address breakGlassCustodian) external payable returns (bytes32 escrowId);
```

### `releaseEscrow`
Allows the owner to release funds from their self-custody vault.
```solidity
function releaseEscrow(bytes32 escrowId, bytes32 secret) external;
```

### `custodianRecover`
Allows a designated custodian to perform an emergency recovery on a self-custody vault.
```solidity
function custodianRecover(bytes32 escrowId) external;
```
**Access Control**: Caller must be the designated `breakGlassCustodian` and have `CUSTODIAN_ROLE`.

### `refund`
Allows the creator of an expired escrow to reclaim their assets.
```solidity
function refund(bytes32 settlementId) external;
```

---

## 6. Security & Roles

- **`SETTLEMENT_ORACLE_ROLE`**: Can confirm fiat settlements.
- **`SETTLEMENT_ADMIN_ROLE`**: Can manage oracle addresses and settlement parameters.
- **`CUSTODIAN_ROLE`**: Can resolve custodial reversals and perform "break-glass" recovery.

All administrative functions are protected by `AccessControlLib` and emit events for full auditability. The dynamic clearing endpoint mechanism prevents replay and misrouting attacks.

---