// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title ConsortiumStorage
 * @notice Dedicated storage library for consortium banking extensions.
 * @dev Mirrors the diamond storage pattern to keep new facets isolated from
 *      the legacy StorageLib.AppStorage layout.
 */
library ConsortiumStorage {
    bytes32 internal constant CONSORTIUM_STORAGE_SLOT =
        keccak256("t3.storage.consortium.v1");

    struct BankProfile {
        string name;
        address primarySigner;
        uint256 maxCollateralLimit;
        uint256 riskRating;
        bool isActive;
        uint256 joinedAt;
        uint256 lastActivity;
    }

    struct WalletConfig {
        address treasuryWallet;
        address collateralVault;
    }

    struct CollateralPosition {
        uint256 pledgedAmount;
        uint256 yieldAccrued;
        uint256 lastUpdated;
    }

    struct AssetTypeConfig {
        address tokenAddress;
        uint8 decimals;
        uint256 collateralFactorBps;
        uint256 haircutBps;
        uint256 maxBankExposure;
        bool isActive;
    }

    struct DepositTokenAccount {
        uint256 totalDeposits;
        uint256 totalMinted;
        uint256 totalBurned;
    }

    struct BankComplianceMetrics {
        uint256 lastInterbankCheckAt;
        uint256 rollingInterbankVolume;
        uint256 unresolvedAlerts;
        uint256 lastReportAt;
    }

    struct ConsortiumReport {
        uint256 generatedAt;
        uint256 totalDeposits;
        uint256 outstandingLiabilities;
        uint256 activeBankCount;
        uint256 totalInterbankVolume;
    }

    struct AssetValuation {
        uint256 usdValue;
        uint256 updatedAt;
        address attestor;
    }

    enum ProposalType {
        Null,
        AddMember,
        RemoveMember,
        UpdateAssetConfig,
        EmergencyAction
    }

    struct Proposal {
        ProposalType proposalType;
        address proposer;
        uint256 createdAt;
        uint256 deadline;
        bytes data;
        bool executed;
        uint256 quorumBps;
        uint256 snapshotDeposits;
    }

    struct VoteTally {
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
    }

    struct Layout {
        mapping(address => BankProfile) bankProfiles;
        mapping(address => bool) activeBanks;
        mapping(address => mapping(uint256 => WalletConfig)) bankWallets;
        mapping(address => mapping(uint256 => CollateralPosition)) bankCollateralPositions;
        mapping(uint256 => AssetTypeConfig) assetTypes;
        mapping(uint256 => AssetValuation) assetValuations;
        mapping(address => uint256) bankDepositAttestations;
        mapping(address => uint256) bankAttestationUpdatedAt;
        mapping(address => bytes32) auditorReportHashes;
        mapping(address => uint256) auditorReportUpdatedAt;
        mapping(address => DepositTokenAccount) depositAccounts;
        mapping(address => BankComplianceMetrics) bankCompliance;
        mapping(address => uint256) bankTotalCollateralValue;
        mapping(uint256 => Proposal) proposals;
        mapping(uint256 => VoteTally) voteTallies;
        mapping(uint256 => mapping(address => bool)) proposalVotes;
        mapping(address => mapping(address => uint256)) pendingYieldByToken;
        mapping(address => uint256) yieldRemainderByToken;
        ConsortiumReport lastConsortiumReport;
        address[] registeredBanks;
        mapping(address => uint256) bankIndexPlusOne;
        uint256 proposalCounter;
        uint256 aggregateDepositBalance;
        uint256 rollingInterbankVolume;
        mapping(bytes32 => bool) pausedOperations;
        address emergencyGuardian;
        mapping(address => uint256) bankCollateralFactorBps;
    }

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = CONSORTIUM_STORAGE_SLOT;
        assembly {
            l.slot := slot
        }
    }
}
