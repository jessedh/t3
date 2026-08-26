const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES, grantRole } = require("../helpers/roles");

describe("T3AuditTrailsFacet Unit Tests", function () {
    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        const audit = await ethers.getContractAt(
            "T3AuditTrailsFacet",
            deployment.diamondAddress
        );

        await grantRole(
            deployment.facets.accessControl,
            ROLES.CUSTODIAN_ROLE,
            deployment.signers.custodian1.address,
            deployment.signers.owner
        );
        await grantRole(
            deployment.facets.accessControl,
            ethers.id("VALIDATOR_ROLE"),
            deployment.signers.user1.address,
            deployment.signers.owner
        );

        return { ...deployment, audit };
    }

    it("creates audit logs and compliance events", async function () {
        const { audit, signers } = await loadFixture(setupFixture);

        const logTx = await audit
            .connect(signers.admin)
            .createAuditLog(
                "TRANSFER",
                "SEED_TRANSFER",
                "seed audit log",
                signers.user2.address,
                ethers.parseEther("10")
            );
        const logReceipt = await logTx.wait();
        const logId = logReceipt.logs
            .map((log) => {
                try {
                    return audit.interface.parseLog(log);
                } catch (error) {
                    return null;
                }
            })
            .filter(Boolean)
            .find((parsed) => parsed.name === "AuditLogCreated").args.logId;

        const storedLog = await audit.getAuditLog(logId);
        expect(storedLog.actor).to.equal(signers.admin.address);
        expect(storedLog.category).to.equal("TRANSFER");

        const complianceTx = await audit
            .connect(signers.custodian1)
            .logComplianceEvent(
                signers.user2.address,
                "SUSPICIOUS_ACTIVITY",
                4,
                "seed compliance check",
                ethers.ZeroHash
            );
        const complianceReceipt = await complianceTx.wait();
        const complianceId = complianceReceipt.logs
            .map((log) => {
                try {
                    return audit.interface.parseLog(log);
                } catch (error) {
                    return null;
                }
            })
            .filter(Boolean)
            .find((parsed) => parsed.name === "ComplianceEventLogged").args.eventId;

        const complianceEvent = await audit.getComplianceEvent(complianceId);
        expect(complianceEvent.wallet).to.equal(signers.user2.address);
        expect(complianceEvent.severity).to.equal(4n);
    });

    it("generates reports, exports data, and updates retention policy", async function () {
        const { audit, signers } = await loadFixture(setupFixture);

        const now = BigInt(await time.latest());
        const fromTimestamp = now - 60n;
        const toTimestamp = now;

        const reportTx = await audit
            .connect(signers.user1)
            .generateRegulatoryReport(
                fromTimestamp,
                toTimestamp,
                "TRANSACTION_SUMMARY",
                true
            );
        await expect(reportTx)
            .to.emit(audit, "RegulatoryReportGenerated");

        const exportTx = await audit
            .connect(signers.admin)
            .exportAuditTrail(
                fromTimestamp,
                toTimestamp,
                "JSON",
                ["TRANSFER"]
            );
        await expect(exportTx)
            .to.emit(audit, "AuditTrailExported");

        await expect(
            audit
                .connect(signers.admin)
                .setDataRetentionPolicy(365n * 24n * 60n * 60n)
        )
            .to.emit(audit, "DataRetentionPolicyUpdated");
    });
});
