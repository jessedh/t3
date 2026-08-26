const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES, grantRole } = require("../helpers/roles");

describe("AutomatedResponseFacet Unit Tests", function () {
    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        const automatedResponse = await ethers.getContractAt(
            "AutomatedResponseFacet",
            deployment.diamondAddress
        );
        const pausable = await ethers.getContractAt(
            "ERC20PausableFacet",
            deployment.diamondAddress
        );

        await grantRole(
            deployment.facets.accessControl,
            ROLES.PAUSER_ROLE,
            deployment.signers.pauser.address,
            deployment.signers.owner
        );

        return { ...deployment, automatedResponse, pausable };
    }

    it("activates and deactivates coordinated emergency mode", async function () {
        const { automatedResponse, pausable, signers } = await loadFixture(setupFixture);

        await expect(
            automatedResponse
                .connect(signers.pauser)
                .activateCoordinatedEmergencyMode(9, "test emergency activation")
        )
            .to.emit(automatedResponse, "AutomatedEmergencyModeActivated")
            .to.emit(automatedResponse, "CrossStorageEmergencySync");

        expect(await pausable.paused()).to.equal(true);

        await expect(
            automatedResponse
                .connect(signers.pauser)
                .deactivateCoordinatedEmergencyMode("test emergency cleared")
        )
            .to.emit(automatedResponse, "AutomatedEmergencyModeDeactivated")
            .to.emit(automatedResponse, "CrossStorageEmergencySync");

        expect(await pausable.paused()).to.equal(false);
    });

    it("rejects emergency activation from non-pauser", async function () {
        const { automatedResponse, signers } = await loadFixture(setupFixture);

        await expect(
            automatedResponse
                .connect(signers.user1)
                .activateCoordinatedEmergencyMode(8, "unauthorized attempt")
        ).to.be.revertedWithCustomError(automatedResponse, "UnauthorizedRole");
    });
});
