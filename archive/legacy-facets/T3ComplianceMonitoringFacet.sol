// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { ERC20PausableFacet } from "./ERC20PausableFacet.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title T3ComplianceMonitoringFacet
 * @notice Enhanced compliance monitoring with real-time suspicious activity detection
 * @dev Implements velocity checks, pattern recognition, and automated regulatory reporting
 * for the T3Token regulated stablecoin system
 */
contract T3ComplianceMonitoringFacet is ERC20PausableFacet {
    using StorageLib for StorageLib.AppStorage;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Events for compliance monitoring
    event SuspiciousActivityDetected(
        address indexed wallet,
        string activityType,
        uint256 severity,
        bytes32 indexed alertId
    );
    
    event VelocityThresholdExceeded(
        address indexed wallet,
        uint256 amount,
        uint256 timeWindow,
        uint256 threshold
    );
    
    event ComplianceReportGenerated(
        bytes32 indexed reportId,
        address indexed custodian,
        uint256 timestamp,
        string reportType
    );
    
    event RiskScoreUpdated(
        address indexed wallet,
        uint256 oldScore,
        uint256 newScore,
        string reason
    );

    /**
     * @notice Checks for suspicious activity patterns in real-time
     * @dev Called during transfer operations to detect anomalies
     * @param wallet The wallet address to analyze
     * @param amount The transaction amount
     * @param recipient The recipient address
     * @return alertLevel 0=normal, 1=low, 2=medium, 3=high, 4=critical
     */
    function checkSuspiciousActivity(
        address wallet,
        uint256 amount,
        address recipient
    ) external view returns (uint256 alertLevel) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        alertLevel = 0; // Start with normal
        
        // Check 1: Velocity patterns (24-hour window)
        uint256 dailyVolume = getDailyTransactionVolume(wallet);
        if (dailyVolume + amount > ds.velocityThresholds.daily) {
            alertLevel = alertLevel > 2 ? alertLevel : 2; // Medium alert
        }
        
        // Check 2: Unusual amount patterns
        StorageLib.RollingAverage storage avg = ds.rollingAverages[wallet];
        if (avg.count > 5) { // Need some history
            uint256 avgAmount = avg.totalAmount / avg.count;
            if (amount > avgAmount * 50) { // 50x normal amount
                alertLevel = alertLevel > 3 ? alertLevel : 3; // High alert
            }
        }
        
        // Check 3: Rapid sequential transactions
        if (block.timestamp - ds.walletRiskProfiles[wallet].lastTransactionTime < 60) {
            uint256 recentCount = getRecentTransactionCount(wallet, 300); // 5 minutes
            if (recentCount >= 10) {
                alertLevel = alertLevel > 3 ? alertLevel : 3; // High alert
            }
        }
        
        // Check 4: New recipient patterns
        if (ds.transactionCountBetween[wallet][recipient] == 0) {
            uint256 newRecipientCount = getNewRecipientsCount(wallet, 86400); // 24 hours
            if (newRecipientCount >= 20) {
                alertLevel = alertLevel > 2 ? alertLevel : 2; // Medium alert
            }
        }
        
        // Check 5: Round number bias (potential structuring)
        if (isRoundNumber(amount)) {
            uint256 roundTxCount = getRoundNumberTransactions(wallet, 86400);
            if (roundTxCount >= 5) {
                alertLevel = alertLevel > 1 ? alertLevel : 1; // Low alert
            }
        }
    }

    /**
     * @notice Performs real-time compliance check and updates risk scores
     * @dev Should be called before each transfer
     * @param sender The sender address
     * @param recipient The recipient address  
     * @param amount The transaction amount
     * @return approved True if transaction should proceed
     */
    function performComplianceCheck(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool approved) {
        _checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Check sender activity
        uint256 senderAlert = this.checkSuspiciousActivity(sender, amount, recipient);
        uint256 recipientAlert = this.checkSuspiciousActivity(recipient, amount, sender);
        
        // Update risk scores based on alerts
        if (senderAlert > 0) {
            _updateRiskScore(sender, senderAlert, "Suspicious activity detected");
        }
        
        if (recipientAlert > 0) {
            _updateRiskScore(recipient, recipientAlert, "Recipient of suspicious activity");
        }
        
        // Generate alerts for high-risk activities
        if (senderAlert > 0) {
            bytes32 alertId = _generateAlert(sender, "HIGH_RISK_TRANSACTION", senderAlert);
            emit SuspiciousActivityDetected(sender, "HIGH_RISK_TRANSACTION", senderAlert, alertId);
        }
        
        // Check velocity limits
        if (!_checkVelocityLimits(sender, amount)) {
            emit VelocityThresholdExceeded(
                sender,
                amount,
                86400, // 24 hours
                ds.velocityThresholds.daily
            );
            return false; // Block transaction
        }
        
        // Update transaction tracking
        _updateTransactionTracking(sender, recipient, amount);
        
        // Approve transaction if all checks pass
        approved = senderAlert < 4 && recipientAlert < 4; // Block only critical alerts
    }

    /**
     * @notice Generates automated compliance reports for regulatory authorities
     * @param custodianId The custodian to generate report for
     * @param reportType Type of report ("DAILY", "SUSPICIOUS", "VELOCITY")
     * @return reportId Unique identifier for the generated report
     */
    function generateComplianceReport(
        uint256 custodianId,
        string calldata reportType
    ) external returns (bytes32 reportId) {
        _checkRole(RoleConstants.VALIDATOR_ROLE, msg.sender);
        
        reportId = keccak256(abi.encodePacked(
            custodianId,
            reportType,
            block.timestamp,
            block.chainid
        ));
        
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Store report metadata
        ds.complianceReports[reportId] = StorageLib.ComplianceReport({
            custodianId: custodianId,
            reportType: reportType,
            timestamp: block.timestamp,
            dataHash: _generateReportDataHash(custodianId, reportType),
            isSubmitted: false
        });
        
        emit ComplianceReportGenerated(reportId, ds.custodians[custodianId].custodianAddress, block.timestamp, reportType);
    }

    /**
     * @notice Sets velocity thresholds for compliance monitoring
     * @param daily Daily transaction limit in wei
     * @param hourly Hourly transaction limit in wei
     * @param transactionCount Maximum transactions per hour
     */
    function setVelocityThresholds(
        uint256 daily,
        uint256 hourly,
        uint256 transactionCount
    ) external {
        _checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        ds.velocityThresholds.daily = daily;
        ds.velocityThresholds.hourly = hourly;
        ds.velocityThresholds.transactionCount = transactionCount;
    }

    // View functions for compliance monitoring
    function getDailyTransactionVolume(address wallet) public view returns (uint256 volume) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        uint256 dayStart = block.timestamp - (block.timestamp % 86400);
        
        // Sum transactions in current 24-hour window
        for (uint256 i = 0; i < ds.transactionHistory[wallet].length; i++) {
            StorageLib.TransactionRecord storage record = ds.transactionHistory[wallet][i];
            if (record.timestamp >= dayStart) {
                volume += record.amount;
            }
        }
    }

    function getRecentTransactionCount(address wallet, uint256 timeWindow) public view returns (uint256 count) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        uint256 cutoff = block.timestamp - timeWindow;
        
        for (uint256 i = 0; i < ds.transactionHistory[wallet].length; i++) {
            if (ds.transactionHistory[wallet][i].timestamp >= cutoff) {
                count++;
            }
        }
    }

    function getNewRecipientsCount(address wallet, uint256 timeWindow) public view returns (uint256 count) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        uint256 cutoff = block.timestamp - timeWindow;
        
        // Count unique new recipients in time window
        // This is a simplified implementation - production would use more efficient data structures
        address[] memory recipients = new address[](100); // Assume max 100 recent recipients
        uint256 recipientCount = 0;
        
        for (uint256 i = 0; i < ds.transactionHistory[wallet].length && recipientCount < 100; i++) {
            StorageLib.TransactionRecord storage record = ds.transactionHistory[wallet][i];
            if (record.timestamp >= cutoff) {
                bool isNew = true;
                for (uint256 j = 0; j < recipientCount; j++) {
                    if (recipients[j] == record.recipient) {
                        isNew = false;
                        break;
                    }
                }
                if (isNew) {
                    recipients[recipientCount] = record.recipient;
                    recipientCount++;
                    count++;
                }
            }
        }
    }

    function isRoundNumber(uint256 amount) public pure returns (bool) {
        // Check if amount is a "round" number (potential structuring indicator)
        if (amount == 0) return false;
        
        // Remove decimals for analysis (assuming 18 decimals)
        uint256 wholePart = amount / 1e18;
        
        // Check various round number patterns
        return (wholePart % 1000 == 0) || // Multiples of 1000
               (wholePart % 500 == 0) ||  // Multiples of 500
               (wholePart % 100 == 0 && wholePart < 1000); // Small multiples of 100
    }

    function getRoundNumberTransactions(address wallet, uint256 timeWindow) public view returns (uint256 count) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        uint256 cutoff = block.timestamp - timeWindow;
        
        for (uint256 i = 0; i < ds.transactionHistory[wallet].length; i++) {
            StorageLib.TransactionRecord storage record = ds.transactionHistory[wallet][i];
            if (record.timestamp >= cutoff && isRoundNumber(record.amount)) {
                count++;
            }
        }
    }

    // Internal helper functions
    function _updateRiskScore(address wallet, uint256 alertLevel, string memory reason) internal {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        StorageLib.WalletRiskProfile storage profile = ds.walletRiskProfiles[wallet];
        
        uint256 oldScore = profile.riskScore;
        uint256 scoreIncrease = alertLevel * 10; // 10 points per alert level
        
        profile.riskScore += scoreIncrease;
        profile.lastRiskUpdate = block.timestamp;
        
        // Cap maximum risk score
        if (profile.riskScore > 1000) {
            profile.riskScore = 1000;
        }
        
        emit RiskScoreUpdated(wallet, oldScore, profile.riskScore, reason);
    }

    function _generateAlert(address wallet, string memory alertType, uint256 severity) internal returns (bytes32 alertId) {
        alertId = keccak256(abi.encodePacked(
            wallet,
            alertType,
            severity,
            block.timestamp,
            block.chainid
        ));
        
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        ds.complianceAlerts[alertId] = StorageLib.ComplianceAlert({
            wallet: wallet,
            alertType: alertType,
            severity: severity,
            timestamp: block.timestamp,
            isResolved: false
        });
    }

    function _checkVelocityLimits(address wallet, uint256 amount) internal view returns (bool) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Check daily limit
        uint256 dailyVolume = getDailyTransactionVolume(wallet);
        if (dailyVolume + amount > ds.velocityThresholds.daily) {
            return false;
        }
        
        // Check hourly limit
        uint256 hourlyVolume = getHourlyTransactionVolume(wallet);
        if (hourlyVolume + amount > ds.velocityThresholds.hourly) {
            return false;
        }
        
        // Check transaction count limit
        uint256 hourlyCount = getRecentTransactionCount(wallet, 3600); // 1 hour
        if (hourlyCount >= ds.velocityThresholds.transactionCount) {
            return false;
        }
        
        return true;
    }

    function getHourlyTransactionVolume(address wallet) public view returns (uint256 volume) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        uint256 cutoff = block.timestamp - 3600; // 1 hour
        
        for (uint256 i = 0; i < ds.transactionHistory[wallet].length; i++) {
            StorageLib.TransactionRecord storage record = ds.transactionHistory[wallet][i];
            if (record.timestamp >= cutoff) {
                volume += record.amount;
            }
        }
    }

    function _updateTransactionTracking(address sender, address recipient, uint256 amount) internal {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Update sender's transaction history
        ds.transactionHistory[sender].push(StorageLib.TransactionRecord({
            recipient: recipient,
            amount: amount,
            timestamp: block.timestamp,
            transactionType: "TRANSFER"
        }));
        
        // Update recipient's transaction history
        ds.transactionHistory[recipient].push(StorageLib.TransactionRecord({
            recipient: sender, // For recipient, this is the sender
            amount: amount,
            timestamp: block.timestamp,
            transactionType: "RECEIVE"
        }));
        
        // Update last transaction time for risk profiling
        ds.walletRiskProfiles[sender].lastTransactionTime = block.timestamp;
        ds.walletRiskProfiles[recipient].lastTransactionTime = block.timestamp;
    }

    function _generateReportDataHash(uint256 custodianId, string memory reportType) internal view returns (bytes32) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        
        // Generate hash of relevant compliance data
        // This would include transaction volumes, suspicious activities, etc.
        return keccak256(abi.encodePacked(
            custodianId,
            reportType,
            block.timestamp,
            ds.custodians[custodianId].custodianAddress
        ));
    }
}