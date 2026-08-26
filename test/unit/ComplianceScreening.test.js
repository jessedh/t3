const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");

const STATUS_NONE = 0;
const STATUS_CLEAR = 1;
const STATUS_FLAGGED = 2;
const STATUS_BLOCKED = 3;
const INVALID_STATUS = 4;

describe("ComplianceScreeningFacet (Wave 8C)", function () {
    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        return deployment;
    }

    describe("recordScreening", function () {
        it("requires NETWORK_SCREENING_AUTHORITY_ROLE", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { user1, user2 } = signers;

            await expect(
                facets.complianceScreening.connect(user1).recordScreening(user2.address, STATUS_CLEAR, ethers.ZeroHash)
            )
                .to.be.revertedWithCustomError(facets.complianceScreening, "UnauthorizedRole")
                .withArgs(user1.address, ROLES.NETWORK_SCREENING_AUTHORITY_ROLE);
        });

        it("rejects invalid status and zero wallet", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1 } = signers;

            await grantRole(facets.accessControl, ROLES.SCREENING_ATTESTOR_ROLE, owner.address, owner);

            await expect(
                facets.complianceScreening.connect(owner).recordScreening(user1.address, INVALID_STATUS, ethers.ZeroHash)
            ).to.be.revertedWith("Invalid screening status");

            await expect(
                facets.complianceScreening.connect(owner).recordScreening(ethers.ZeroAddress, STATUS_CLEAR, ethers.ZeroHash)
            ).to.be.revertedWith("Invalid wallet address");
        });

        it("records screening and emits WalletScreened + ScreeningBlocked for BLOCKED", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1 } = signers;

            await grantRole(facets.accessControl, ROLES.SCREENING_ATTESTOR_ROLE, owner.address, owner);

            const listVersion = ethers.keccak256(ethers.toUtf8Bytes("list-v1"));
            await expect(
                facets.complianceScreening.connect(owner).recordScreening(user1.address, STATUS_BLOCKED, listVersion)
            )
                .to.emit(facets.complianceScreening, "WalletScreened")
                .withArgs(user1.address, STATUS_BLOCKED, listVersion, owner.address)
                .and.to.emit(facets.complianceScreening, "ScreeningBlocked")
                .withArgs(user1.address, owner.address);

            const screening = await facets.complianceScreening.getScreening(user1.address);
            expect(screening.status).to.equal(STATUS_BLOCKED);
            expect(screening.listVersionHash).to.equal(listVersion);
            expect(screening.attestor).to.equal(owner.address);
            expect(screening.lastScreenedAt).to.be.gt(0);
        });

        it("records CLEAR without ScreeningBlocked", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1 } = signers;

            await grantRole(facets.accessControl, ROLES.SCREENING_ATTESTOR_ROLE, owner.address, owner);

            await expect(
                facets.complianceScreening.connect(owner).recordScreening(user1.address, STATUS_CLEAR, ethers.ZeroHash)
            )
                .to.emit(facets.complianceScreening, "WalletScreened")
                .withArgs(user1.address, STATUS_CLEAR, ethers.ZeroHash, owner.address);

            expect(await facets.complianceScreening.isScreeningBlocked(user1.address)).to.equal(false);
        });
    });

    describe("isScreeningBlocked", function () {
        it("returns true only for BLOCKED status", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1 } = signers;

            await grantRole(facets.accessControl, ROLES.SCREENING_ATTESTOR_ROLE, owner.address, owner);

            expect(await facets.complianceScreening.isScreeningBlocked(user1.address)).to.equal(false);

            await facets.complianceScreening.connect(owner).recordScreening(user1.address, STATUS_FLAGGED, ethers.ZeroHash);
            expect(await facets.complianceScreening.isScreeningBlocked(user1.address)).to.equal(false);

            await facets.complianceScreening.connect(owner).recordScreening(user1.address, STATUS_BLOCKED, ethers.ZeroHash);
            expect(await facets.complianceScreening.isScreeningBlocked(user1.address)).to.equal(true);
        });
    });

    describe("isScreeningStale", function () {
        it("returns true when staleAfter is set and screening has aged past the window", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1 } = signers;

            await grantRole(facets.accessControl, ROLES.SCREENING_ATTESTOR_ROLE, owner.address, owner);

            // No stale window configured: never stale
            await facets.complianceScreening.connect(owner).recordScreening(user1.address, STATUS_CLEAR, ethers.ZeroHash);
            expect(await facets.complianceScreening.isScreeningStale(user1.address)).to.equal(false);

            // Set stale window to 1 hour
            await facets.complianceScreening.connect(owner).setScreeningStaleAfter(3600);
            expect(await facets.complianceScreening.isScreeningStale(user1.address)).to.equal(false);

            // Move past the window
            await time.increase(3601);
            expect(await facets.complianceScreening.isScreeningStale(user1.address)).to.equal(true);
        });

        it("returns false for unscreened wallets", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1 } = signers;

            await facets.complianceScreening.connect(owner).setScreeningStaleAfter(3600);
            expect(await facets.complianceScreening.isScreeningStale(user1.address)).to.equal(false);
        });
    });

    describe("setScreeningStaleAfter", function () {
        it("requires DEFAULT_ADMIN_ROLE", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { user1 } = signers;

            await expect(
                facets.complianceScreening.connect(user1).setScreeningStaleAfter(3600)
            )
                .to.be.revertedWithCustomError(facets.complianceScreening, "UnauthorizedRole")
                .withArgs(user1.address, ROLES.DEFAULT_ADMIN_ROLE);
        });

        it("sets the window and emits", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner } = signers;

            await expect(facets.complianceScreening.connect(owner).setScreeningStaleAfter(3600))
                .to.emit(facets.complianceScreening, "ScreeningStaleAfterSet")
                .withArgs(3600, owner.address);

            // 0 disables staleness
            await expect(facets.complianceScreening.connect(owner).setScreeningStaleAfter(0))
                .to.emit(facets.complianceScreening, "ScreeningStaleAfterSet")
                .withArgs(0, owner.address);
        });
    });
});
