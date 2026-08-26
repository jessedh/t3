const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { ROLES } = require("../helpers/roles");

describe("Cross-Storage Emergency Synchronization Integration Tests", function () {
    async function deployFixture() {
        const deployment = await deployT3DiamondFixture();
        const { signers, facets } = deployment;

        await facets.accessControl.connect(signers.owner).grantRole(ROLES.ADMIN_ROLE, signers.admin.address);
        await facets.accessControl.connect(signers.owner).grantRole(ROLES.PAUSER_ROLE, signers.pauser.address);

        return { facets, signers };
    }

    describe("End-to-End Emergency Coordination", function () {
        it("should coordinate emergency across all three storage systems", async function () {
            const { facets, signers } = await loadFixture(deployFixture);
            const ar = facets.automatedResponse;

            const initialStatus = await ar.getEmergencyStatus();
            expect(initialStatus.appStatus).to.be.false;
            expect(initialStatus.sponsorStatus).to.be.false;
            expect(initialStatus.investmentStatus).to.be.false;
            expect(initialStatus.threatLevel).to.equal(0);

            await ar.connect(signers.pauser).activateCoordinatedEmergencyMode(8, "Integration test emergency");

            const activeStatus = await ar.getEmergencyStatus();
            expect(activeStatus.appStatus).to.be.true;
            expect(activeStatus.sponsorStatus).to.be.true;
            expect(activeStatus.investmentStatus).to.be.true;
            expect(activeStatus.threatLevel).to.equal(8);

            const consistency = await ar.checkEmergencyStateConsistency();
            expect(consistency.isConsistent).to.be.true;
            expect(consistency.states[0]).to.be.true;
            expect(consistency.states[1]).to.be.true;
            expect(consistency.states[2]).to.be.true;

            await ar.connect(signers.pauser).deactivateCoordinatedEmergencyMode("Integration test completed");

            const resumedStatus = await ar.getEmergencyStatus();
            expect(resumedStatus.appStatus).to.be.false;
            expect(resumedStatus.sponsorStatus).to.be.false;
            expect(resumedStatus.investmentStatus).to.be.false;
            expect(resumedStatus.threatLevel).to.equal(0);

            const finalConsistency = await ar.checkEmergencyStateConsistency();
            expect(finalConsistency.isConsistent).to.be.true;
            expect(finalConsistency.states[0]).to.be.false;
            expect(finalConsistency.states[1]).to.be.false;
            expect(finalConsistency.states[2]).to.be.false;
        });

        it("should reject activation from unauthorized address", async function () {
            const { facets, signers } = await loadFixture(deployFixture);
            const ar = facets.automatedResponse;

            await expect(
                ar.connect(signers.user1).activateCoordinatedEmergencyMode(8, "unauthorized attempt")
            ).to.be.revertedWithCustomError(ar, "UnauthorizedRole");
        });

        it("should reject deactivation from unauthorized address", async function () {
            const { facets, signers } = await loadFixture(deployFixture);
            const ar = facets.automatedResponse;

            await ar.connect(signers.pauser).activateCoordinatedEmergencyMode(5, "setup for deactivation test");

            await expect(
                ar.connect(signers.user1).deactivateCoordinatedEmergencyMode("unauthorized deactivation attempt")
            ).to.be.revertedWithCustomError(ar, "UnauthorizedRole");
        });

        it("should handle multiple concurrent activations atomically", async function () {
            const { facets, signers } = await loadFixture(deployFixture);
            const ar = facets.automatedResponse;

            const concurrentActivations = [
                ar.connect(signers.pauser).activateCoordinatedEmergencyMode(5, "concurrent 1"),
                ar.connect(signers.pauser).activateCoordinatedEmergencyMode(5, "concurrent 2"),
                ar.connect(signers.pauser).activateCoordinatedEmergencyMode(5, "concurrent 3"),
            ];

            const results = await Promise.allSettled(concurrentActivations);
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failureCount = results.filter(r => r.status === 'rejected').length;

            expect(successCount).to.equal(1);
            expect(failureCount).to.equal(2);

            const consistency = await ar.checkEmergencyStateConsistency();
            expect(consistency.isConsistent).to.be.true;
        });
    });

    describe("Cross-Storage Operation Impact", function () {
        it("should reflect emergency across all storage systems at threat level 9", async function () {
            const { facets, signers } = await loadFixture(deployFixture);
            const ar = facets.automatedResponse;

            await ar.connect(signers.pauser).activateCoordinatedEmergencyMode(9, "level-9 test");

            const status = await ar.getEmergencyStatus();
            expect(status.appStatus).to.be.true;
            expect(status.sponsorStatus).to.be.true;
            expect(status.investmentStatus).to.be.true;
            expect(status.threatLevel).to.equal(9);
        });

        it("should resume all storage systems after deactivation", async function () {
            const { facets, signers } = await loadFixture(deployFixture);
            const ar = facets.automatedResponse;

            await ar.connect(signers.pauser).activateCoordinatedEmergencyMode(6, "activation");
            await ar.connect(signers.pauser).deactivateCoordinatedEmergencyMode("deactivation");

            const status = await ar.getEmergencyStatus();
            expect(status.appStatus).to.be.false;
            expect(status.sponsorStatus).to.be.false;
            expect(status.investmentStatus).to.be.false;
            expect(status.threatLevel).to.equal(0);
        });
    });

    describe("Emergency State Recovery", function () {
        it("should force-synchronize emergency state to active", async function () {
            const { facets, signers } = await loadFixture(deployFixture);
            const ar = facets.automatedResponse;

            await ar.connect(signers.owner).forceEmergencyStateSynchronization(true, "force activate");

            const consistency = await ar.checkEmergencyStateConsistency();
            expect(consistency.isConsistent).to.be.true;
            expect(consistency.states[0]).to.be.true;
            expect(consistency.states[1]).to.be.true;
            expect(consistency.states[2]).to.be.true;
        });

        it("should force-synchronize emergency state to inactive", async function () {
            const { facets, signers } = await loadFixture(deployFixture);
            const ar = facets.automatedResponse;

            await ar.connect(signers.owner).forceEmergencyStateSynchronization(true, "activate first");
            await ar.connect(signers.owner).forceEmergencyStateSynchronization(false, "force deactivate");

            const consistency = await ar.checkEmergencyStateConsistency();
            expect(consistency.isConsistent).to.be.true;
            expect(consistency.states[0]).to.be.false;
            expect(consistency.states[1]).to.be.false;
            expect(consistency.states[2]).to.be.false;
        });
    });

    describe("Performance and Gas", function () {
        it("should activate and deactivate within gas bounds", async function () {
            const { facets, signers } = await loadFixture(deployFixture);
            const ar = facets.automatedResponse;

            const activationTx = await ar.connect(signers.pauser)
                .activateCoordinatedEmergencyMode(4, "gas test");
            const activationReceipt = await activationTx.wait();

            const deactivationTx = await ar.connect(signers.pauser)
                .deactivateCoordinatedEmergencyMode("gas test done");
            const deactivationReceipt = await deactivationTx.wait();

            expect(activationReceipt.gasUsed).to.be.lt(300000n);
            expect(deactivationReceipt.gasUsed).to.be.lt(300000n);
        });
    });
});
