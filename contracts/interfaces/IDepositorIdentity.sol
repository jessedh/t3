// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title IDepositorIdentity
 * @notice Interface for privacy-preserving depositor identity conflict detection
 *         in reciprocal deposit networks (FDIC 12 CFR 370 pass-through recordkeeping).
 * @dev Active manifest facet. Shared network salt per epoch enables the FDIC cross-bank
 *      conflict check but permits cross-bank correlation by colluding members within an
 *      epoch; per-bank salts would break the cross-bank check (counsel tradeoff).
 *      Recording-only; NOT wired into compliance enforcement.
 */
interface IDepositorIdentity {
    // ==================== HASH MANAGEMENT ====================

    function submitDepositorHash(bytes32 tinHash) external;
    function batchSubmitDepositorHashes(bytes32[] calldata tinHashes) external;
    function removeDepositorHash(bytes32 tinHash) external;
    function batchRemoveDepositorHashes(bytes32[] calldata tinHashes) external;

    // ==================== CONFLICT CHECKING ====================

    function checkDepositorConflict(
        bytes32 tinHash,
        address destinationBank
    ) external view returns (bool exists);

    function batchCheckDepositorConflicts(
        bytes32 tinHash,
        address[] calldata destinationBanks
    ) external returns (bool[] memory conflicts);

    // ==================== SALT EPOCH MANAGEMENT ====================

    function rotateSalt(bytes32 newSaltHash, uint256 transitionWindowSeconds) external;
    function emergencySaltCompromise(bytes32 newSaltHash) external;
    function expireSaltEpoch(uint16 epochId) external;

    // ==================== VIEW FUNCTIONS ====================

    function getSaltEpochInfo(uint16 epochId) external view returns (
        bytes32 saltHash,
        uint256 activatedAt,
        uint256 expiresAt,
        bool isActive
    );
    function getCurrentSaltEpoch() external view returns (uint16);
    function getDepositorHashCount(address bank) external view returns (uint256);
    function getLastUpdateTimestamp(address bank) external view returns (uint256);
    function getGlobalStatistics() external view returns (
        uint256 totalHashes,
        uint256 totalChecks,
        uint256 bankCount
    );
    function hasDepositorHash(address bank, bytes32 tinHash) external view returns (bool);
    function getBankMigrationStatus(address bank) external view returns (
        uint256 currentEpochCount,
        uint256 oldEpochCount,
        uint256 lastUpdated
    );
}
