// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title DepositorIdentityStorage
 * @notice Dedicated storage library for privacy-preserving depositor identity
 *         conflict detection in reciprocal deposit networks.
 * @dev Mirrors the diamond storage pattern to keep depositor identity data
 *      isolated from the legacy StorageLib.AppStorage layout.
 *
 *      Design inspired by the quantum resistance pattern in LockedTransferManagerFacet:
 *      - Actual TINs stay off-chain (like master secrets never touching the chain)
 *      - Only keccak256(TIN || ownershipCategory || salt) hashes are stored
 *      - Salt epochs support rotation without invalidation (like derivationMethod 0-2)
 *      - Emergency salt compromise mirrors quantum threat response
 */
library DepositorIdentityStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.depositoridentity.v1");

    // ═══════════════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Ownership categories modeled on the FDIC category framework. These mirror the
     *         categories that, under FDIC rules, are each separately insured up to the
     *         per-bank limit (USD 250,000 at time of writing).
     * @dev Active manifest storage. Shared network salt per epoch enables the FDIC cross-bank
     *      conflict check but permits cross-bank correlation by colluding members within an
     *      epoch; per-bank salts would break the cross-bank check (counsel tradeoff).
     *      Recording-only; NOT wired into compliance enforcement. Banks include this value
     *      when computing off-chain hashes:
     *      hash = keccak256(abi.encodePacked(TIN, uint8(category), salt))
     */
    enum OwnershipCategory {
        Single,           // 0 - Individual single account
        Joint,            // 1 - Joint account (hash per co-owner)
        RevocableTrust,   // 2 - Revocable trust (per beneficiary)
        IrrevocableTrust, // 3 - Irrevocable trust (per beneficiary)
        Retirement,       // 4 - IRA, 401k, etc.
        Business,         // 5 - Corporate/LLC accounts
        Government        // 6 - Municipal/government entity
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Represents a salt epoch — analogous to derivationMethod in quantum resistance.
     * @dev Multiple epochs can be active simultaneously during salt rotation transitions.
     */
    struct SaltEpoch {
        bytes32 saltHash;     // keccak256(actualSalt) — for verification, NOT the salt itself
        uint256 activatedAt;  // When this epoch started
        uint256 expiresAt;    // When hashes from this epoch stop being checked (0 = no expiry)
        bool isActive;        // Whether this epoch is valid for conflict checks
    }

    /**
     * @notice Per-bank hash registry — tracks all depositor identity hashes for one bank.
     */
    struct BankHashRegistry {
        EnumerableSet.Bytes32Set tinHashes;        // O(1) add/remove/contains
        mapping(bytes32 => uint16) tinHashEpochs;  // hash => salt epoch it was created under
        uint256 lastUpdated;                       // Timestamp of last modification
        uint256 hashCount;                         // Cached count for gas-efficient reads
    }

    /**
     * @notice Main storage layout for the Depositor Identity Registry.
     */
    struct Layout {
        // Per-bank hash registries
        mapping(address => BankHashRegistry) bankRegistries;

        // Salt epoch management (inspired by QuantumSecurityConfig pattern)
        mapping(uint16 => SaltEpoch) saltEpochs;
        uint16 currentSaltEpoch;       // Active epoch counter (starts at 0 = uninitialized)
        uint16 maxConcurrentEpochs;    // How many old epochs stay valid (default: 2)

        // Bank tracking
        EnumerableSet.AddressSet banksWithHashes;

        // Global statistics
        uint256 totalHashesRegistered;
        uint256 totalConflictChecksPerformed;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event DepositorHashSubmitted(address indexed bank, bytes32 tinHash, uint256 timestamp);
    event DepositorHashRemoved(address indexed bank, bytes32 tinHash, uint256 timestamp);
    event DepositorHashBatchSubmitted(address indexed bank, uint256 count, uint256 timestamp);
    event DepositorHashBatchRemoved(address indexed bank, uint256 count, uint256 timestamp);
    event ConflictDetected(address indexed checkingBank, address indexed conflictBank, bytes32 tinHash);
    event SaltEpochCreated(uint16 indexed epochId, bytes32 saltHash, uint256 activatedAt, uint256 transitionWindow);
    event SaltEpochExpired(uint16 indexed epochId, uint256 expiredAt);
    event EmergencySaltCompromise(address indexed admin, uint16 newEpochId, uint256 timestamp);

    // ═══════════════════════════════════════════════════════════════════════
    // CUSTOM ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error DepositorHashAlreadyExists(address bank, bytes32 tinHash);
    error DepositorHashNotFound(address bank, bytes32 tinHash);
    error BankNotCustodian(address bank);
    error InvalidTinHash();
    error BatchSizeTooLarge(uint256 provided, uint256 max);
    error NoActiveSaltEpoch();
    error SaltEpochNotFound(uint16 epochId);
    error SaltEpochAlreadyExpired(uint16 epochId);
    error InvalidSaltHash();

    // ═══════════════════════════════════════════════════════════════════════
    // STORAGE ACCESS
    // ═══════════════════════════════════════════════════════════════════════

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }
}
