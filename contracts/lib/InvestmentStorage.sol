// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title InvestmentStorage
 * @dev Isolated storage library for investment platform operations using diamond storage pattern
 * @notice Implements storage isolation to prevent conflicts with main AppStorage and SponsorBankStorage
 */
library InvestmentStorage {
    bytes32 private constant STORAGE_POSITION = 
        keccak256("t3token.storage.investment.v1");

    enum InvestmentType { 
        NONE,
        REAL_ESTATE, 
        STABLECOIN_YIELD, 
        SECURITIES, 
        COMMODITIES, 
        PRIVATE_EQUITY,
        CUSTOM 
    }

    enum InvestmentStatus {
        NONE,
        PENDING,
        ACTIVE,
        MATURED,
        SUSPENDED,
        LIQUIDATED
    }

    enum YieldType {
        NONE,
        RENTAL_INCOME,
        INTEREST,
        DIVIDENDS,
        CAPITAL_GAINS,
        STAKING_REWARDS,
        CUSTOM
    }

    struct InvestmentVehicle {
        bytes32 vehicleId;
        InvestmentType investmentType;
        address tokenContract;
        address sponsor;
        string name;
        string description;
        InvestmentStatus status;
        bool isActive;
        uint256 createdAt;
        uint256 totalInvestors;
        uint256 totalInvestment;
        uint256 totalYieldDistributed;
        uint256 minimumInvestment;
        uint256 maximumInvestment;
        mapping(bytes32 => bytes) parameters; // Flexible parameter storage
        mapping(address => uint256) investorShares;
        mapping(address => uint256) investmentTimestamp;
        address[] investors;
    }

    struct YieldDistribution {
        bytes32 distributionId;
        bytes32 vehicleId;
        uint256 totalYield;
        address yieldToken;
        YieldType yieldType;
        uint256 distributionDate;
        uint256 recipientCount;
        bool requiresKYC;
        bool usesPseudoStaking;
        uint256 minimumHoldingPeriod;
        mapping(address => uint256) recipientAmounts;
        mapping(address => bool) claimed;
        address[] recipients;
    }

    struct TaxParameters {
        bool requiresWithholding;
        string incomeType;
        uint256 defaultWithholdingRate;
        mapping(string => uint256) jurisdictionRates;
    }

    struct InvestorProfile {
        bool isAccreditedInvestor;
        mapping(InvestmentType => uint256) investmentLimits;
        mapping(InvestmentType => uint256) currentInvestments;
        string jurisdiction;
        uint256 totalInvestmentValue;
        uint256 profileUpdated;
        bool isActive;
        mapping(bytes32 => bool) vehicleAccess;
    }

    struct GovernanceProposal {
        uint256 proposalId;
        bytes32 vehicleId;
        address proposer;
        string description;
        bytes callData;
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 votingDeadline;
        uint256 executionDeadline;
        bool executed;
        bool cancelled;
        mapping(address => bool) hasVoted;
        mapping(address => uint256) voteWeight;
        mapping(address => bool) supportVote;
    }

    struct Storage {
        mapping(bytes32 => InvestmentVehicle) vehicles;
        mapping(bytes32 => YieldDistribution) yieldDistributions;
        mapping(address => InvestorProfile) investorProfiles;
        mapping(uint256 => GovernanceProposal) proposals;
        mapping(bytes32 => TaxParameters) vehicleTaxParams;
        mapping(address => mapping(bytes32 => uint256)) investorYieldBalance;
        mapping(InvestmentType => bool) requiresAccreditation;
        mapping(bytes32 => address[]) vehicleInvestors;
        mapping(address => bytes32[]) investorVehicles;
        
        uint256 totalVehicles;
        uint256 totalYieldDistributions;
        uint256 nextProposalId;
        uint256 globalMinimumInvestment;
        uint256 globalMaximumInvestment;
        bool emergencyPaused;
        
        // Default governance parameters
        uint256 defaultVotingPeriod;
        uint256 defaultQuorumPercentage;
        uint256 defaultApprovalThreshold;
        uint256 minimumProposalBalance;

        // Governance selector whitelist (M-1: prevent arbitrary self-call escalation)
        mapping(bytes4 => bool) allowedProposalSelectors;
    }

    function layout() internal pure returns (Storage storage l) {
        bytes32 position = STORAGE_POSITION;
        assembly { 
            l.slot := position 
        }
    }

    // Events for investment operations
    event InvestmentVehicleCreated(
        bytes32 indexed vehicleId,
        InvestmentType indexed investmentType,
        address indexed tokenContract,
        address sponsor,
        string name
    );
    
    event InvestmentMade(
        bytes32 indexed vehicleId,
        address indexed investor,
        uint256 amount,
        uint256 shares
    );
    
    event YieldDistributed(
        bytes32 indexed vehicleId,
        bytes32 indexed distributionId,
        uint256 totalYield,
        uint256 recipientCount,
        address yieldToken,
        string reason
    );
    
    event YieldClaimed(
        bytes32 indexed vehicleId,
        bytes32 indexed distributionId,
        address indexed investor,
        uint256 amount,
        address yieldToken
    );
    
    event InvestmentParameterUpdated(
        bytes32 indexed vehicleId,
        bytes32 indexed paramKey,
        bytes paramValue
    );
    
    event ProposalCreated(
        uint256 indexed proposalId,
        bytes32 indexed vehicleId,
        address indexed proposer,
        string description
    );
    
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        bool support,
        uint256 weight,
        string reason
    );
    
    event ProposalExecuted(
        uint256 indexed proposalId,
        bytes result
    );
    
    event InvestorAccreditationUpdated(
        address indexed investor,
        bool isAccredited,
        string jurisdiction
    );
    
    event InvestmentLimitUpdated(
        address indexed investor,
        InvestmentType indexed investmentType,
        uint256 limit
    );
    
    event InvestmentRecorded(
        address indexed investor,
        bytes32 indexed vehicleId,
        InvestmentType indexed investmentType,
        uint256 amount
    );

    // Helper functions for working with parameters
    function setParameter(
        Storage storage self,
        bytes32 vehicleId,
        bytes32 key,
        bytes memory value
    ) internal {
        self.vehicles[vehicleId].parameters[key] = value;
    }

    function getParameter(
        Storage storage self,
        bytes32 vehicleId,
        bytes32 key
    ) internal view returns (bytes memory) {
        return self.vehicles[vehicleId].parameters[key];
    }

    function getParameterAsUint256(
        Storage storage self,
        bytes32 vehicleId,
        bytes32 key
    ) internal view returns (uint256) {
        bytes memory data = self.vehicles[vehicleId].parameters[key];
        if (data.length == 0) return 0;
        return abi.decode(data, (uint256));
    }

    function getParameterAsAddress(
        Storage storage self,
        bytes32 vehicleId,
        bytes32 key
    ) internal view returns (address) {
        bytes memory data = self.vehicles[vehicleId].parameters[key];
        if (data.length == 0) return address(0);
        return abi.decode(data, (address));
    }

    function getParameterAsString(
        Storage storage self,
        bytes32 vehicleId,
        bytes32 key
    ) internal view returns (string memory) {
        bytes memory data = self.vehicles[vehicleId].parameters[key];
        if (data.length == 0) return "";
        return abi.decode(data, (string));
    }
}