// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { DepositorIdentityStorage } from "../lib/DepositorIdentityStorage.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { IAccessControl } from "../interfaces/IAccessControl.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title DepositorIdentityFacet
 * @notice Privacy-preserving depositor identity conflict detection for reciprocal deposit networks.
 * @dev Banks submit one-way hashes of depositor TINs. Before routing a deposit sweep,
 *      the network checks if that TIN hash already exists at the destination bank.
 *      Actual TINs never touch the blockchain — only keccak256(TIN || category || salt).
 *
 *      Salt epochs (inspired by the quantum resistance derivationMethod pattern in
 *      LockedTransferManagerFacet) allow salt rotation without invalidating all hashes:
 *      multiple epochs can be active simultaneously during a transition window.
 */
contract DepositorIdentityFacet is ReentrancyGuardBase {
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using EnumerableSet for EnumerableSet.AddressSet;

    uint256 private constant MAX_BATCH_SIZE = 100;

    // ═══════════════════════════════════════════════════════════════════════
    // HASH SUBMISSION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Submit a single depositor TIN hash for the calling bank.
     * @dev Hash must be computed off-chain as:
     *      keccak256(abi.encodePacked(TIN, uint8(ownershipCategory), networkSalt))
     * @param tinHash The pre-computed hash
     */
    function submitDepositorHash(bytes32 tinHash) external nonReentrant {
        _requireCustodianRole();

        if (tinHash == bytes32(0)) revert DepositorIdentityStorage.InvalidTinHash();

        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();
        uint16 epoch = dis.currentSaltEpoch;
        if (epoch == 0) revert DepositorIdentityStorage.NoActiveSaltEpoch();

        DepositorIdentityStorage.BankHashRegistry storage registry = dis.bankRegistries[msg.sender];

        if (registry.tinHashes.contains(tinHash)) {
            revert DepositorIdentityStorage.DepositorHashAlreadyExists(msg.sender, tinHash);
        }

        registry.tinHashes.add(tinHash);
        registry.tinHashEpochs[tinHash] = epoch;
        registry.hashCount++;
        registry.lastUpdated = block.timestamp;

        if (!dis.banksWithHashes.contains(msg.sender)) {
            dis.banksWithHashes.add(msg.sender);
        }
        dis.totalHashesRegistered++;

        emit DepositorIdentityStorage.DepositorHashSubmitted(msg.sender, tinHash, block.timestamp);
    }

    /**
     * @notice Batch submit depositor TIN hashes. Skips duplicates and zero hashes.
     * @param tinHashes Array of pre-computed hashes (max 100)
     */
    function batchSubmitDepositorHashes(bytes32[] calldata tinHashes) external nonReentrant {
        _requireCustodianRole();

        uint256 batchSize = tinHashes.length;
        if (batchSize == 0) return;
        if (batchSize > MAX_BATCH_SIZE) {
            revert DepositorIdentityStorage.BatchSizeTooLarge(batchSize, MAX_BATCH_SIZE);
        }

        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();
        uint16 epoch = dis.currentSaltEpoch;
        if (epoch == 0) revert DepositorIdentityStorage.NoActiveSaltEpoch();

        DepositorIdentityStorage.BankHashRegistry storage registry = dis.bankRegistries[msg.sender];

        uint256 addedCount = 0;
        for (uint256 i = 0; i < batchSize;) {
            bytes32 h = tinHashes[i];
            if (h != bytes32(0) && !registry.tinHashes.contains(h)) {
                registry.tinHashes.add(h);
                registry.tinHashEpochs[h] = epoch;
                addedCount++;
            }
            unchecked { ++i; }
        }

        if (addedCount > 0) {
            registry.hashCount += addedCount;
            registry.lastUpdated = block.timestamp;
            if (!dis.banksWithHashes.contains(msg.sender)) {
                dis.banksWithHashes.add(msg.sender);
            }
            dis.totalHashesRegistered += addedCount;
            emit DepositorIdentityStorage.DepositorHashBatchSubmitted(msg.sender, addedCount, block.timestamp);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // HASH REMOVAL
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Remove a depositor hash when an account closes.
     * @param tinHash The hash to remove
     */
    function removeDepositorHash(bytes32 tinHash) external nonReentrant {
        _requireCustodianRole();

        if (tinHash == bytes32(0)) revert DepositorIdentityStorage.InvalidTinHash();

        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();
        DepositorIdentityStorage.BankHashRegistry storage registry = dis.bankRegistries[msg.sender];

        if (!registry.tinHashes.contains(tinHash)) {
            revert DepositorIdentityStorage.DepositorHashNotFound(msg.sender, tinHash);
        }

        registry.tinHashes.remove(tinHash);
        delete registry.tinHashEpochs[tinHash];
        registry.hashCount--;
        registry.lastUpdated = block.timestamp;
        dis.totalHashesRegistered--;

        emit DepositorIdentityStorage.DepositorHashRemoved(msg.sender, tinHash, block.timestamp);
    }

    /**
     * @notice Batch remove depositor hashes. Skips non-existent and zero hashes.
     * @param tinHashes Array of hashes to remove (max 100)
     */
    function batchRemoveDepositorHashes(bytes32[] calldata tinHashes) external nonReentrant {
        _requireCustodianRole();

        uint256 batchSize = tinHashes.length;
        if (batchSize == 0) return;
        if (batchSize > MAX_BATCH_SIZE) {
            revert DepositorIdentityStorage.BatchSizeTooLarge(batchSize, MAX_BATCH_SIZE);
        }

        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();
        DepositorIdentityStorage.BankHashRegistry storage registry = dis.bankRegistries[msg.sender];

        uint256 removedCount = 0;
        for (uint256 i = 0; i < batchSize;) {
            bytes32 h = tinHashes[i];
            if (h != bytes32(0) && registry.tinHashes.contains(h)) {
                registry.tinHashes.remove(h);
                delete registry.tinHashEpochs[h];
                removedCount++;
            }
            unchecked { ++i; }
        }

        if (removedCount > 0) {
            registry.hashCount -= removedCount;
            registry.lastUpdated = block.timestamp;
            dis.totalHashesRegistered -= removedCount;
            emit DepositorIdentityStorage.DepositorHashBatchRemoved(msg.sender, removedCount, block.timestamp);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CONFLICT CHECKING
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Check if a depositor hash exists at a destination bank.
     * @dev Only checks hashes whose salt epoch is still active (not expired).
     *      View function — no gas cost for off-chain calls.
     * @param tinHash The hash to check
     * @param destinationBank The bank to check against
     * @return exists True if hash found at destination under an active epoch
     */
    function checkDepositorConflict(
        bytes32 tinHash,
        address destinationBank
    ) external view returns (bool exists) {
        // Gated to consortium custodians; mirrors batchCheckDepositorConflicts. Note: an off-chain
        // eth_call can still spoof `from`, so this raises the bar but does not fully prevent
        // correlation probing — the residual shared-salt correlation surface is tracked under
        // counsel gate G9 (see KNOWN-ISSUES.md / COUNSEL-GATES.md).
        _requireCustodianRole();

        if (tinHash == bytes32(0)) return false;

        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();
        DepositorIdentityStorage.BankHashRegistry storage registry = dis.bankRegistries[destinationBank];

        if (!registry.tinHashes.contains(tinHash)) return false;

        // Verify the hash's epoch is still active
        uint16 hashEpoch = registry.tinHashEpochs[tinHash];
        return _isEpochActive(dis, hashEpoch);
    }

    /**
     * @notice Check for conflicts across multiple destination banks.
     * @dev Emits ConflictDetected events for audit trail. State-changing to emit events.
     * @param tinHash Single hash to check
     * @param destinationBanks Array of banks to check
     * @return conflicts Array of bools (true = conflict at that bank)
     */
    function batchCheckDepositorConflicts(
        bytes32 tinHash,
        address[] calldata destinationBanks
    ) external nonReentrant returns (bool[] memory conflicts) {
        _requireCustodianRole();

        uint256 bankCount = destinationBanks.length;
        conflicts = new bool[](bankCount);

        if (tinHash == bytes32(0)) return conflicts;

        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();

        for (uint256 i = 0; i < bankCount;) {
            address bank = destinationBanks[i];
            DepositorIdentityStorage.BankHashRegistry storage registry = dis.bankRegistries[bank];

            if (registry.tinHashes.contains(tinHash)) {
                uint16 hashEpoch = registry.tinHashEpochs[tinHash];
                if (_isEpochActive(dis, hashEpoch)) {
                    conflicts[i] = true;
                    dis.totalConflictChecksPerformed++;
                    emit DepositorIdentityStorage.ConflictDetected(msg.sender, bank, tinHash);
                }
            }
            unchecked { ++i; }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SALT EPOCH MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a new salt epoch and set a transition window on the previous one.
     * @dev For the first epoch, use transitionWindowSeconds = 0.
     *      Analogous to quantum resistance derivationMethod — multiple epochs active simultaneously.
     * @param newSaltHash keccak256(newSalt) — the actual salt is distributed off-chain
     * @param transitionWindowSeconds How long the previous epoch remains valid (0 for first epoch)
     */
    function rotateSalt(bytes32 newSaltHash, uint256 transitionWindowSeconds) external {
        _requireAdminRole();

        if (newSaltHash == bytes32(0)) revert DepositorIdentityStorage.InvalidSaltHash();

        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();

        uint16 oldEpoch = dis.currentSaltEpoch;

        // If there's an existing epoch, set its expiry
        if (oldEpoch > 0 && transitionWindowSeconds > 0) {
            dis.saltEpochs[oldEpoch].expiresAt = block.timestamp + transitionWindowSeconds;
        } else if (oldEpoch > 0) {
            // No transition window — expire immediately
            dis.saltEpochs[oldEpoch].expiresAt = block.timestamp;
            dis.saltEpochs[oldEpoch].isActive = false;
            emit DepositorIdentityStorage.SaltEpochExpired(oldEpoch, block.timestamp);
        }

        // Create new epoch
        uint16 newEpoch = oldEpoch + 1;
        dis.currentSaltEpoch = newEpoch;
        dis.saltEpochs[newEpoch] = DepositorIdentityStorage.SaltEpoch({
            saltHash: newSaltHash,
            activatedAt: block.timestamp,
            expiresAt: 0, // Current epoch never expires until rotated
            isActive: true
        });

        // Initialize max concurrent epochs if not set
        if (dis.maxConcurrentEpochs == 0) {
            dis.maxConcurrentEpochs = 2;
        }

        emit DepositorIdentityStorage.SaltEpochCreated(newEpoch, newSaltHash, block.timestamp, transitionWindowSeconds);
    }

    /**
     * @notice Emergency: immediately expire all old epochs and create a new one.
     * @dev Mirrors the quantum emergency response pattern. Call when salt is compromised.
     * @param newSaltHash keccak256(newSalt) for the emergency replacement epoch
     */
    function emergencySaltCompromise(bytes32 newSaltHash) external {
        _requireAdminRole();

        if (newSaltHash == bytes32(0)) revert DepositorIdentityStorage.InvalidSaltHash();

        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();

        // Expire ALL previous epochs immediately
        uint16 currentEpoch = dis.currentSaltEpoch;
        for (uint16 i = 1; i <= currentEpoch;) {
            if (dis.saltEpochs[i].isActive) {
                dis.saltEpochs[i].isActive = false;
                dis.saltEpochs[i].expiresAt = block.timestamp;
                emit DepositorIdentityStorage.SaltEpochExpired(i, block.timestamp);
            }
            unchecked { ++i; }
        }

        // Create new epoch
        uint16 newEpoch = currentEpoch + 1;
        dis.currentSaltEpoch = newEpoch;
        dis.saltEpochs[newEpoch] = DepositorIdentityStorage.SaltEpoch({
            saltHash: newSaltHash,
            activatedAt: block.timestamp,
            expiresAt: 0,
            isActive: true
        });

        emit DepositorIdentityStorage.EmergencySaltCompromise(msg.sender, newEpoch, block.timestamp);
        emit DepositorIdentityStorage.SaltEpochCreated(newEpoch, newSaltHash, block.timestamp, 0);
    }

    /**
     * @notice Force-expire a specific salt epoch.
     * @param epochId The epoch to expire
     */
    function expireSaltEpoch(uint16 epochId) external {
        _requireAdminRole();

        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();

        if (epochId == 0 || epochId > dis.currentSaltEpoch) {
            revert DepositorIdentityStorage.SaltEpochNotFound(epochId);
        }
        // Cannot expire the current active epoch via this function
        if (epochId == dis.currentSaltEpoch) {
            revert DepositorIdentityStorage.SaltEpochNotFound(epochId);
        }
        if (!dis.saltEpochs[epochId].isActive) {
            revert DepositorIdentityStorage.SaltEpochAlreadyExpired(epochId);
        }

        dis.saltEpochs[epochId].isActive = false;
        dis.saltEpochs[epochId].expiresAt = block.timestamp;

        emit DepositorIdentityStorage.SaltEpochExpired(epochId, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getSaltEpochInfo(uint16 epochId) external view returns (
        bytes32 saltHash,
        uint256 activatedAt,
        uint256 expiresAt,
        bool isActive
    ) {
        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();
        DepositorIdentityStorage.SaltEpoch storage epoch = dis.saltEpochs[epochId];

        // Compute effective isActive (check time-based expiry)
        bool effectivelyActive = epoch.isActive &&
            (epoch.expiresAt == 0 || block.timestamp < epoch.expiresAt);

        return (epoch.saltHash, epoch.activatedAt, epoch.expiresAt, effectivelyActive);
    }

    function getCurrentSaltEpoch() external view returns (uint16) {
        return DepositorIdentityStorage.layout().currentSaltEpoch;
    }

    function getDepositorHashCount(address bank) external view returns (uint256) {
        return DepositorIdentityStorage.layout().bankRegistries[bank].hashCount;
    }

    function getLastUpdateTimestamp(address bank) external view returns (uint256) {
        return DepositorIdentityStorage.layout().bankRegistries[bank].lastUpdated;
    }

    function getGlobalStatistics() external view returns (
        uint256 totalHashes,
        uint256 totalChecks,
        uint256 bankCount
    ) {
        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();
        return (
            dis.totalHashesRegistered,
            dis.totalConflictChecksPerformed,
            dis.banksWithHashes.length()
        );
    }

    function hasDepositorHash(address bank, bytes32 tinHash) external view returns (bool) {
        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();
        DepositorIdentityStorage.BankHashRegistry storage registry = dis.bankRegistries[bank];
        if (!registry.tinHashes.contains(tinHash)) return false;
        uint16 hashEpoch = registry.tinHashEpochs[tinHash];
        return _isEpochActive(dis, hashEpoch);
    }

    /**
     * @notice Get migration status for a bank — how many hashes are on current vs old epochs.
     * @param bank The bank address
     * @return currentEpochCount Hashes on the current salt epoch
     * @return oldEpochCount Hashes on older (potentially expiring) epochs
     * @return lastUpdated When the bank last modified their registry
     */
    function getBankMigrationStatus(address bank) external view returns (
        uint256 currentEpochCount,
        uint256 oldEpochCount,
        uint256 lastUpdated
    ) {
        DepositorIdentityStorage.Layout storage dis = DepositorIdentityStorage.layout();
        DepositorIdentityStorage.BankHashRegistry storage registry = dis.bankRegistries[bank];
        uint16 current = dis.currentSaltEpoch;

        uint256 total = registry.tinHashes.length();
        uint256 onCurrent = 0;

        for (uint256 i = 0; i < total;) {
            bytes32 h = registry.tinHashes.at(i);
            if (registry.tinHashEpochs[h] == current) {
                onCurrent++;
            }
            unchecked { ++i; }
        }

        return (onCurrent, total - onCurrent, registry.lastUpdated);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════════════════════════════════════

    function _requireCustodianRole() internal view {
        IAccessControl ac = IAccessControl(address(this));
        if (!ac.hasRole(RoleConstants.CUSTODIAN_ROLE, msg.sender)) {
            revert DepositorIdentityStorage.BankNotCustodian(msg.sender);
        }
    }

    function _requireAdminRole() internal view {
        IAccessControl ac = IAccessControl(address(this));
        if (!ac.hasRole(RoleConstants.ADMIN_ROLE, msg.sender) &&
            !ac.hasRole(RoleConstants.DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.ADMIN_ROLE);
        }
    }

    /**
     * @dev Check if a salt epoch is currently active (not expired by time or force).
     *      Mirrors the quantum resistance pattern where multiple derivation methods
     *      can be valid simultaneously.
     */
    function _isEpochActive(
        DepositorIdentityStorage.Layout storage dis,
        uint16 epochId
    ) internal view returns (bool) {
        if (epochId == 0) return false;
        DepositorIdentityStorage.SaltEpoch storage epoch = dis.saltEpochs[epochId];
        if (!epoch.isActive) return false;
        if (epoch.expiresAt != 0 && block.timestamp >= epoch.expiresAt) return false;
        return true;
    }
}
