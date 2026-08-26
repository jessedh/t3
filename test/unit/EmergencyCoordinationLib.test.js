const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { ROLES } = require("../helpers/roles");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("EmergencyCoordinationLib - Atomic Cross-Storage Emergency Operations", function () {
    async function deployEmergencyFixture() {
        const deployment = await deployT3DiamondFixture();
        const { signers, facets } = deployment;

        await facets.accessControl.connect(signers.owner).grantRole(ROLES.ADMIN_ROLE, signers.admin.address);
        await facets.accessControl.connect(signers.owner).grantRole(ROLES.PAUSER_ROLE, signers.pauser.address);

        return { facets, signers, automatedResponseFacet: facets.automatedResponse };
    }

    describe("Atomic Emergency Activation", function () {
        it("should atomically activate emergency mode across all storage systems", async function () {
            const { automatedResponseFacet, signers } = await loadFixture(deployEmergencyFixture);

            await automatedResponseFacet.connect(signers.pauser).activateCoordinatedEmergencyMode(
                8, "Critical security threat detected"
            );

            const emergencyStatus = await automatedResponseFacet.getEmergencyStatus();
            expect(emergencyStatus.appStatus).to.be.true;
            expect(emergencyStatus.sponsorStatus).to.be.true;
            expect(emergencyStatus.investmentStatus).to.be.true;
            expect(emergencyStatus.threatLevel).to.equal(8);

            const consistency = await automatedResponseFacet.checkEmergencyStateConsistency();
            expect(consistency.isConsistent).to.be.true;
            expect(consistency.states[0]).to.be.true;
            expect(consistency.states[1]).to.be.true;
            expect(consistency.states[2]).to.be.true;
        });

        it("should prevent activation when emergency is already active", async function () {
            const { automatedResponseFacet, signers } = await loadFixture(deployEmergencyFixture);

            await automatedResponseFacet.connect(signers.pauser).activateCoordinatedEmergencyMode(
                5, "First threat"
            );

            await expect(
                automatedResponseFacet.connect(signers.pauser).activateCoordinatedEmergencyMode(
                    5, "Second threat"
                )
            ).to.be.revertedWithCustomError(automatedResponseFacet, "EmergencyAlreadyActive");
        });

        it("should reject activation from unauthorized address", async function () {
            const { automatedResponseFacet, signers } = await loadFixture(deployEmergencyFixture);

            await expect(
                automatedResponseFacet.connect(signers.user1).activateCoordinatedEmergencyMode(
                    8, "unauthorized attempt"
                )
            ).to.be.revertedWithCustomError(automatedResponseFacet, "UnauthorizedRole");
        });
    });

    describe("Atomic Emergency Deactivation", function () {
        it("should atomically deactivate emergency mode across all storage systems", async function () {
            const { automatedResponseFacet, signers } = await loadFixture(deployEmergencyFixture);

            await automatedResponseFacet.connect(signers.pauser).activateCoordinatedEmergencyMode(
                7, "Security threat"
            );
            await automatedResponseFacet.connect(signers.pauser).deactivateCoordinatedEmergencyMode(
                "Threat resolved"
            );

            const emergencyStatus = await automatedResponseFacet.getEmergencyStatus();
            expect(emergencyStatus.appStatus).to.be.false;
            expect(emergencyStatus.sponsorStatus).to.be.false;
            expect(emergencyStatus.investmentStatus).to.be.false;
            expect(emergencyStatus.threatLevel).to.equal(0);

            const consistency = await automatedResponseFacet.checkEmergencyStateConsistency();
            expect(consistency.isConsistent).to.be.true;
            expect(consistency.states[0]).to.be.false;
            expect(consistency.states[1]).to.be.false;
            expect(consistency.states[2]).to.be.false;
        });

        it("should prevent deactivation when no emergency is active", async function () {
            const { automatedResponseFacet, signers } = await loadFixture(deployEmergencyFixture);

            await expect(
                automatedResponseFacet.connect(signers.pauser).deactivateCoordinatedEmergencyMode(
                    "No emergency to deactivate"
                )
            ).to.be.revertedWithCustomError(automatedResponseFacet, "EmergencyNotActive");
        });

        it("should reject deactivation from unauthorized address", async function () {
            const { automatedResponseFacet, signers } = await loadFixture(deployEmergencyFixture);

            await automatedResponseFacet.connect(signers.pauser).activateCoordinatedEmergencyMode(
                5, "setup for unauthorized deactivation test"
            );

            await expect(
                automatedResponseFacet.connect(signers.user1).deactivateCoordinatedEmergencyMode(
                    "unauthorized deactivation attempt"
                )
            ).to.be.revertedWithCustomError(automatedResponseFacet, "UnauthorizedRole");
        });
    });

    describe("Emergency State Consistency", function () {
        it("should report consistent state when no emergency is active", async function () {
            const { automatedResponseFacet } = await loadFixture(deployEmergencyFixture);

            const consistency = await automatedResponseFacet.checkEmergencyStateConsistency();
            expect(consistency.isConsistent).to.be.true;

            const status = await automatedResponseFacet.getEmergencyStatus();
            expect(status.appStatus).to.be.false;
            expect(status.sponsorStatus).to.be.false;
            expect(status.investmentStatus).to.be.false;
            expect(typeof status.appStatus).to.equal("boolean");
            expect(typeof status.sponsorStatus).to.equal("boolean");
            expect(typeof status.investmentStatus).to.equal("boolean");
        });
    });

    describe("Force Emergency State Synchronization", function () {
        it("should force-synchronize all storage systems to active state", async function () {
            const { automatedResponseFacet, signers } = await loadFixture(deployEmergencyFixture);

            await automatedResponseFacet.connect(signers.owner).forceEmergencyStateSynchronization(
                true, "Manual synchronization"
            );

            const consistency = await automatedResponseFacet.checkEmergencyStateConsistency();
            expect(consistency.isConsistent).to.be.true;
            expect(consistency.states[0]).to.be.true;
            expect(consistency.states[1]).to.be.true;
            expect(consistency.states[2]).to.be.true;
        });
    });

    describe("Event Emission", function () {
        it("should emit AtomicEmergencyActivated on activation", async function () {
            const { automatedResponseFacet, signers } = await loadFixture(deployEmergencyFixture);
            const reason = "Event emission test";

            const activationTx = await automatedResponseFacet.connect(signers.pauser)
                .activateCoordinatedEmergencyMode(6, reason);

            await expect(activationTx)
                .to.emit(automatedResponseFacet, "AtomicEmergencyActivated")
                .withArgs(signers.pauser.address, reason, anyValue, [true, true, true]);
        });

        it("should emit AtomicEmergencyDeactivated on deactivation", async function () {
            const { automatedResponseFacet, signers } = await loadFixture(deployEmergencyFixture);

            await automatedResponseFacet.connect(signers.pauser)
                .activateCoordinatedEmergencyMode(6, "setup");

            const deactivationTx = await automatedResponseFacet.connect(signers.pauser)
                .deactivateCoordinatedEmergencyMode("Test completed");

            await expect(deactivationTx)
                .to.emit(automatedResponseFacet, "AtomicEmergencyDeactivated")
                .withArgs(signers.pauser.address, "Test completed", anyValue, [true, true, true]);
        });
    });

    describe("Gas Optimization", function () {
        it("should activate and deactivate within gas bounds", async function () {
            const { automatedResponseFacet, signers } = await loadFixture(deployEmergencyFixture);

            const activationGas = await automatedResponseFacet.connect(signers.pauser)
                .activateCoordinatedEmergencyMode.estimateGas(5, "Gas test");
            expect(activationGas).to.be.lt(200000n);

            await automatedResponseFacet.connect(signers.pauser)
                .activateCoordinatedEmergencyMode(5, "Gas test");

            const deactivationGas = await automatedResponseFacet.connect(signers.pauser)
                .deactivateCoordinatedEmergencyMode.estimateGas("Gas test done");
            expect(deactivationGas).to.be.lt(200000n);
        });
    });

    describe("Race Condition Prevention", function () {
        it("should allow only one concurrent activation to succeed", async function () {
            const { automatedResponseFacet, signers } = await loadFixture(deployEmergencyFixture);

            const concurrentActivations = [0, 1, 2].map(i =>
                automatedResponseFacet.connect(signers.pauser)
                    .activateCoordinatedEmergencyMode(4, `Concurrent activation ${i}`)
            );

            const results = await Promise.allSettled(concurrentActivations);
            const successCount = results.filter(r => r.status === 'fulfilled').length;
            const failureCount = results.filter(r => r.status === 'rejected').length;

            expect(successCount).to.equal(1);
            expect(failureCount).to.equal(2);
        });
    });
});
