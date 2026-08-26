const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");

describe("ConsortiumComplianceFacet", function () {
    async function setupFixture() {
        // Full fixture gives us membership + deposit-token facets sharing ConsortiumStorage.
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        const { facets, signers } = deployment;
        const bank1 = signers.user1.address;
        const bank2 = signers.user2.address;

        await facets.consortiumMembership
            .connect(signers.admin)
            .registerBank(bank1, "Bank One", bank1, 1000n);
        await facets.consortiumMembership
            .connect(signers.admin)
            .registerBank(bank2, "Bank Two", bank2, 1000n);

        await facets.bankDepositToken.connect(signers.minter).adjustDepositBalance(bank1, 1000n);
        await facets.bankDepositToken.connect(signers.minter).adjustDepositBalance(bank2, 500n);

        // Seed outstanding liabilities for report aggregation assertions.
        await facets.bankDepositToken.connect(signers.minter).recordMintBurn(bank1, 700n, 200n);
        await facets.bankDepositToken.connect(signers.minter).recordMintBurn(bank2, 100n, 0);

        return deployment;
    }

    it("requires COMPLIANCE_OFFICER_ROLE to monitor inter-bank transactions", async function () {
        const { facets, signers } = await loadFixture(setupFixture);

        await expect(
            facets.consortiumCompliance
                .connect(signers.user1)
                .monitorInterBankTransaction(signers.user1.address, signers.user2.address, 1n, "memo")
        )
            .to.be.revertedWithCustomError(facets.consortiumCompliance, "UnauthorizedRole")
            .withArgs(signers.user1.address, ROLES.COMPLIANCE_OFFICER_ROLE);
    });

    it("tracks inter-bank volume and raises alerts for high-risk transfers", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        await grantRole(facets.accessControl, ROLES.COMPLIANCE_OFFICER_ROLE, signers.user3.address, signers.owner);

        const amount = 250n;
        await expect(
            facets.consortiumCompliance
                .connect(signers.user3)
                .monitorInterBankTransaction(signers.user1.address, signers.user2.address, amount, "high value")
        )
            .to.emit(facets.consortiumCompliance, "InterBankTransactionMonitored")
            .withArgs(signers.user1.address, signers.user2.address, amount, 2n, "high value");

        const senderMetrics = await facets.consortiumCompliance.getBankComplianceMetrics(signers.user1.address);
        const recipientMetrics = await facets.consortiumCompliance.getBankComplianceMetrics(signers.user2.address);

        expect(senderMetrics.rollingInterbankVolume).to.equal(amount);
        expect(recipientMetrics.rollingInterbankVolume).to.equal(amount);
        expect(senderMetrics.unresolvedAlerts).to.equal(1n);
    });

    it("requires CONSORTIUM_AUDITOR_ROLE for report generation and resets rolling volume", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        await grantRole(facets.accessControl, ROLES.COMPLIANCE_OFFICER_ROLE, signers.user3.address, signers.owner);

        await facets.consortiumCompliance
            .connect(signers.user3)
            .monitorInterBankTransaction(signers.user1.address, signers.user2.address, 50n, "volume");

        await expect(
            facets.consortiumCompliance.connect(signers.user1).generateConsortiumComplianceReport()
        )
            .to.be.revertedWithCustomError(facets.consortiumCompliance, "UnauthorizedRole")
            .withArgs(signers.user1.address, ROLES.CONSORTIUM_AUDITOR_ROLE);

        await grantRole(facets.accessControl, ROLES.CONSORTIUM_AUDITOR_ROLE, signers.owner.address, signers.owner);

        const tx = await facets.consortiumCompliance.connect(signers.owner).generateConsortiumComplianceReport();
        const receipt = await tx.wait();
        // Parse the emitted event directly to avoid timestamp-dependent static-call hashes.
        const parsed = receipt.logs
            .map((log) => {
                try {
                    return facets.consortiumCompliance.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .filter(Boolean)
            .find((event) => event.name === "ConsortiumComplianceReport");

        expect(parsed.args.reportId).to.not.equal(ethers.ZeroHash);
        expect(parsed.args.totalDeposits).to.equal(1500n);
        expect(parsed.args.outstandingLiabilities).to.equal(600n);
        expect(parsed.args.activeBanks).to.equal(2n);
        expect(parsed.args.interbankVolume).to.equal(50n);

        const report = await facets.consortiumCompliance.getLatestConsortiumReport();
        expect(report.totalDeposits).to.equal(1500n);
        expect(report.outstandingLiabilities).to.equal(600n);
        expect(report.activeBankCount).to.equal(2n);
        expect(report.totalInterbankVolume).to.equal(50n);

        await facets.consortiumCompliance.connect(signers.owner).generateConsortiumComplianceReport();
        const nextReport = await facets.consortiumCompliance.getLatestConsortiumReport();
        expect(nextReport.totalInterbankVolume).to.equal(0n);
    });

    it("allows auditors to resolve alerts with bounds checking", async function () {
        const { facets, signers } = await loadFixture(setupFixture);
        await grantRole(facets.accessControl, ROLES.COMPLIANCE_OFFICER_ROLE, signers.user3.address, signers.owner);
        await grantRole(facets.accessControl, ROLES.CONSORTIUM_AUDITOR_ROLE, signers.owner.address, signers.owner);

        await facets.consortiumCompliance
            .connect(signers.user3)
            .monitorInterBankTransaction(signers.user1.address, signers.user2.address, 250n, "alert");

        await expect(facets.consortiumCompliance.connect(signers.owner).resolveComplianceAlert(signers.user1.address, 1n))
            .to.emit(facets.consortiumCompliance, "ComplianceAlertResolved")
            .withArgs(signers.user1.address, 0n);

        await expect(
            facets.consortiumCompliance.connect(signers.owner).resolveComplianceAlert(signers.user1.address, 1n)
        ).to.be.revertedWith("invalid resolve");
    });
});
