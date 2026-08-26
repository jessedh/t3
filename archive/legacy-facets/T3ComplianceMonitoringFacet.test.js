const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole } = require("../helpers/roles");
const { addFacetToDiamond } = require("../helpers/diamond");

describe("T3ComplianceMonitoringFacet", function () {
    const VALIDATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("VALIDATOR_ROLE"));
    const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));

    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        // Add monitoring facet post-deploy and skip inherited pausable selectors that already exist.
        const MonitoringFacet = await ethers.getContractFactory("T3ComplianceMonitoringFacet");
        const monitoringImpl = await MonitoringFacet.deploy();
        await monitoringImpl.waitForDeployment();

        await addFacetToDiamond(
            deployment.facets.diamondCut.connect(deployment.signers.owner),
            monitoringImpl,
            ["pause()", "paused()", "unpause()"]
        );

        const monitoring = await ethers.getContractAt("T3ComplianceMonitoringFacet", deployment.diamondAddress);
        return { ...deployment, monitoring };
    }

    it("restricts velocity threshold configuration to ADMIN_ROLE", async function () {
        const { monitoring, signers } = await loadFixture(setupFixture);

        await expect(
            monitoring.connect(signers.user1).setVelocityThresholds(1000n, 1000n, 10n)
        )
            .to.be.revertedWithCustomError(monitoring, "UnauthorizedRole")
            .withArgs(signers.user1.address, ADMIN_ROLE);

        await expect(
            monitoring.connect(signers.admin).setVelocityThresholds(1000n, 500n, 10n)
        ).to.not.be.reverted;
    });

    it("performs compliance checks and updates transaction tracking under relaxed thresholds", async function () {
        const { monitoring, signers } = await loadFixture(setupFixture);
        const amount = ethers.parseEther("2");

        await monitoring.connect(signers.admin).setVelocityThresholds(
            ethers.parseEther("1000000"),
            ethers.parseEther("100000"),
            1000n
        );

        // `performComplianceCheck` should pass and track sender/recipient history entries.
        const approved = await monitoring
            .connect(signers.admin)
            .performComplianceCheck.staticCall(signers.admin.address, signers.user1.address, amount);
        expect(approved).to.equal(true);

        await monitoring
            .connect(signers.admin)
            .performComplianceCheck(signers.admin.address, signers.user1.address, amount);

        expect(await monitoring.getDailyTransactionVolume(signers.admin.address)).to.equal(amount);
        expect(await monitoring.getRecentTransactionCount(signers.admin.address, 3600)).to.equal(1n);
    });

    it("returns false and emits VelocityThresholdExceeded when limits are breached", async function () {
        const { monitoring, signers } = await loadFixture(setupFixture);
        const amount = ethers.parseEther("100");

        await monitoring.connect(signers.admin).setVelocityThresholds(
            ethers.parseEther("10"),
            ethers.parseEther("10"),
            10n
        );

        await expect(
            monitoring
                .connect(signers.admin)
                .performComplianceCheck(signers.admin.address, signers.user1.address, amount)
        )
            .to.emit(monitoring, "VelocityThresholdExceeded")
            .withArgs(signers.admin.address, amount, 86400n, ethers.parseEther("10"));

        const approved = await monitoring
            .connect(signers.admin)
            .performComplianceCheck.staticCall(signers.admin.address, signers.user1.address, amount);
        expect(approved).to.equal(false);
    });

    it("detects round-number patterns and computes round-number transaction counts", async function () {
        const { monitoring, signers } = await loadFixture(setupFixture);
        const roundAmount = ethers.parseEther("100");

        expect(await monitoring.isRoundNumber(roundAmount)).to.equal(true);
        expect(await monitoring.isRoundNumber(ethers.parseEther("123"))).to.equal(false);

        await monitoring.connect(signers.admin).setVelocityThresholds(
            ethers.parseEther("1000000"),
            ethers.parseEther("100000"),
            1000n
        );

        // Seed round-number history for sender wallet.
        for (let i = 0; i < 5; i++) {
            await monitoring
                .connect(signers.admin)
                .performComplianceCheck(signers.admin.address, signers.user1.address, roundAmount);
        }

        expect(await monitoring.getRoundNumberTransactions(signers.admin.address, 86400)).to.be.gte(5n);

        // With >= 5 round-number txs in window, alert level should be at least low.
        const alertLevel = await monitoring.checkSuspiciousActivity(
            signers.admin.address,
            roundAmount,
            signers.user2.address
        );
        expect(alertLevel).to.be.gte(1n);
    });

    it("requires VALIDATOR_ROLE to generate compliance reports", async function () {
        const { facets, monitoring, signers } = await loadFixture(setupFixture);

        await expect(
            monitoring.connect(signers.admin).generateComplianceReport(1n, "DAILY")
        )
            .to.be.revertedWithCustomError(monitoring, "UnauthorizedRole")
            .withArgs(signers.admin.address, VALIDATOR_ROLE);

        await grantRole(facets.accessControl, VALIDATOR_ROLE, signers.user2.address, signers.owner);

        const tx = await monitoring.connect(signers.user2).generateComplianceReport(1n, "DAILY");
        const receipt = await tx.wait();

        const parsed = receipt.logs
            .map((log) => {
                try {
                    return monitoring.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .filter(Boolean)
            .find((event) => event.name === "ComplianceReportGenerated");

        expect(parsed.args.reportId).to.not.equal(ethers.ZeroHash);
        expect(parsed.args.custodian).to.equal(ethers.ZeroAddress);
        expect(parsed.args.reportType).to.equal("DAILY");
    });
});
