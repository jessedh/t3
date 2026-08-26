// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title SponsorBankStorage
 * @dev Isolated storage library for sponsor bank operations using diamond storage pattern
 * @notice Implements storage isolation to prevent conflicts with main AppStorage
 */
library SponsorBankStorage {
    bytes32 private constant STORAGE_POSITION = 
        keccak256("t3token.storage.sponsorbank.v1");

    enum DistributionStatus { 
        NONE,
        INITIATED, 
        REGISTERED, 
        COMPLETED, 
        CANCELLED,
        FAILED 
    }

    struct SponsorBank {
        address bankAddress;
        string identifier;
        uint256 feeRate; // Basis points (e.g., 100 = 1%)
        bool isActive;
        bool isRegistered;
        uint256 totalDistributions;
        uint256 totalVolume;
        uint256 registrationTime;
        uint256 totalFeeEarned;
        mapping(bytes32 => bool) distributionIds;
    }

    struct Distribution {
        bytes32 distributionId;
        address sponsor;
        string sponsorEntity;
        uint256 totalAmount;
        address distributionToken;
        DistributionStatus status;
        uint256 createdAt;
        uint256 finalizedAt;
        uint256 totalRecipients;
        uint256 distributedAmount;
        uint256 sponsorFee;
        uint256 kycBankFees;
        mapping(address => uint256) walletShares;
        mapping(address => bool) registeredWallets;
        address[] recipients;
    }

    struct DistributionParams {
        string sponsorEntity;
        uint256 totalAmount;
        address distributionToken;
        uint256 expectedRecipients;
        bool requiresKYC;
        uint256 distributionDeadline;
    }

    struct Storage {
        mapping(address => SponsorBank) banks;
        mapping(bytes32 => Distribution) distributions;
        mapping(address => bytes32[]) bankDistributions;
        mapping(address => mapping(address => uint256)) kycBankRevenue; // bank => token => amount
        mapping(address => mapping(address => uint256)) sponsorBankRevenue; // bank => token => amount
        uint256 totalBanks;
        uint256 totalDistributions;
        uint256 globalKYCFeeRate; // Basis points for KYC banks (default 25 = 0.25%)
        bool emergencyPaused;
        uint256 minDistributionAmount;
        uint256 maxBatchSize;
    }

    function layout() internal pure returns (Storage storage l) {
        bytes32 position = STORAGE_POSITION;
        assembly { 
            l.slot := position 
        }
    }

    // Events for sponsor bank operations
    event SponsorBankRegistered(address indexed bankAddress, string identifier, uint256 feeRate);
    event SponsorBankStatusUpdated(address indexed bankAddress, bool isActive);
    event DistributionInitiated(bytes32 indexed distributionId, address indexed sponsor, uint256 totalAmount);
    event TokensRegisteredForDistribution(bytes32 indexed distributionId, uint256 recipientCount, uint256 totalShares);
    event DistributionCompleted(bytes32 indexed distributionId, uint256 distributedAmount);
    event DistributionCancelled(bytes32 indexed distributionId, string reason);
    event KYCBankFeeDistributed(bytes32 indexed distributionId, address indexed bank, uint256 fee, uint256 walletCount);
    event SponsorBankRevenueClaimed(address indexed bank, uint256 amount, address token);
}