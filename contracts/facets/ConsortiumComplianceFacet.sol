// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";

/**
 * @title ConsortiumComplianceFacet
 * @notice Aggregates inter-bank compliance metrics and generates consortium-wide reports.
 */
contract ConsortiumComplianceFacet {
    event InterBankTransactionMonitored(
        address indexed sendingBank,
        address indexed receivingBank,
        uint256 normalizedAmount,
        uint256 riskWeight,
        string memo
    );
    event ConsortiumComplianceReport(
        bytes32 indexed reportId,
        uint256 totalDeposits,
        uint256 outstandingLiabilities,
        uint256 activeBanks,
        uint256 interbankVolume
    );
    event ComplianceAlertResolved(address indexed bank, uint256 remainingAlerts);

    modifier onlyCompliance() {
        AccessControlLib.checkRole(RoleConstants.COMPLIANCE_OFFICER_ROLE, msg.sender);
        _;
    }

    modifier onlyAuditor() {
        AccessControlLib.checkRole(RoleConstants.CONSORTIUM_AUDITOR_ROLE, msg.sender);
        _;
    }

    function monitorInterBankTransaction(
        address sendingBank,
        address receivingBank,
        uint256 normalizedAmount,
        string calldata memo
    ) external onlyCompliance {
        require(sendingBank != address(0) && receivingBank != address(0), "bank zero");
        require(sendingBank != receivingBank, "self transfer");
        require(normalizedAmount > 0, "amount zero");

        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        require(cs.activeBanks[sendingBank] && cs.activeBanks[receivingBank], "inactive bank");

        ConsortiumStorage.BankComplianceMetrics storage fromMetrics = cs.bankCompliance[sendingBank];
        ConsortiumStorage.BankComplianceMetrics storage toMetrics = cs.bankCompliance[receivingBank];

        fromMetrics.lastInterbankCheckAt = block.timestamp;
        toMetrics.lastInterbankCheckAt = block.timestamp;
        fromMetrics.rollingInterbankVolume += normalizedAmount;
        toMetrics.rollingInterbankVolume += normalizedAmount;
        cs.rollingInterbankVolume += normalizedAmount;

        uint256 riskWeight;
        uint256 maxLimit = cs.bankProfiles[sendingBank].maxCollateralLimit;
        if (maxLimit > 0 && normalizedAmount * 5 > maxLimit) {
            fromMetrics.unresolvedAlerts += 1;
            riskWeight = 2;
        } else if (normalizedAmount > cs.bankTotalCollateralValue[sendingBank] / 2) {
            fromMetrics.unresolvedAlerts += 1;
            riskWeight = 1;
        }

        emit InterBankTransactionMonitored(sendingBank, receivingBank, normalizedAmount, riskWeight, memo);
    }

    function generateConsortiumComplianceReport() external onlyAuditor returns (bytes32 reportId) {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        uint256 totalDeposits;
        uint256 outstanding;
        uint256 activeBanks;

        for (uint256 i = 0; i < cs.registeredBanks.length; i++) {
            address bank = cs.registeredBanks[i];
            if (!cs.activeBanks[bank]) {
                continue;
            }
            activeBanks += 1;
            ConsortiumStorage.DepositTokenAccount storage account = cs.depositAccounts[bank];
            totalDeposits += account.totalDeposits;
            outstanding += _getOutstandingMinted(account);
            cs.bankCompliance[bank].lastReportAt = block.timestamp;
        }

        reportId = keccak256(abi.encodePacked(block.timestamp, block.prevrandao, totalDeposits, outstanding));
        cs.lastConsortiumReport = ConsortiumStorage.ConsortiumReport({
            generatedAt: block.timestamp,
            totalDeposits: totalDeposits,
            outstandingLiabilities: outstanding,
            activeBankCount: activeBanks,
            totalInterbankVolume: cs.rollingInterbankVolume
        });
        emit ConsortiumComplianceReport(
            reportId,
            totalDeposits,
            outstanding,
            activeBanks,
            cs.rollingInterbankVolume
        );
        cs.rollingInterbankVolume = 0;
    }

    function resolveComplianceAlert(address bank, uint256 resolvedCount) external onlyAuditor {
        ConsortiumStorage.BankComplianceMetrics storage metrics = ConsortiumStorage.layout().bankCompliance[bank];
        require(metrics.unresolvedAlerts >= resolvedCount, "invalid resolve");
        metrics.unresolvedAlerts -= resolvedCount;
        emit ComplianceAlertResolved(bank, metrics.unresolvedAlerts);
    }

    function getBankComplianceMetrics(address bank) external view returns (ConsortiumStorage.BankComplianceMetrics memory) {
        return ConsortiumStorage.layout().bankCompliance[bank];
    }

    function getLatestConsortiumReport() external view returns (ConsortiumStorage.ConsortiumReport memory) {
        return ConsortiumStorage.layout().lastConsortiumReport;
    }

    function _getOutstandingMinted(ConsortiumStorage.DepositTokenAccount storage account) internal view returns (uint256) {
        return account.totalMinted > account.totalBurned ? account.totalMinted - account.totalBurned : 0;
    }
}
