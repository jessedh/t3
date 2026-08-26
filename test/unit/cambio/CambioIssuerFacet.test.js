const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../../helpers/roles");

describe("CambioIssuerFacet", function () {
    async function setupIssuerFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        const { facets, signers } = deployment;

        // Grant Cambio roles
        await grantRole(facets.accessControl, ROLES.CAMBIO_ADMIN_ROLE, signers.admin.address, signers.owner);
        await grantRole(facets.accessControl, ROLES.CAMBIO_ISSUER_ROLE, signers.user1.address, signers.owner);

        // Set up a sponsor bank for envelope-mode tests
        if (facets.sponsorBank) {
            await grantRole(facets.accessControl, ROLES.SPONSOR_BANK_ADMIN_ROLE, signers.admin.address, signers.owner);
            await facets.sponsorBank.connect(signers.admin).registerSponsorBank(signers.user2.address, "TEST_BANK", 100);
        }

        return deployment;
    }

    let facets, signers;

    beforeEach(async function () {
        ({ facets, signers } = await loadFixture(setupIssuerFixture));
    });

    describe("Legacy Issuer Registration", function () {
        it("registers a new issuer", async function () {
            await expect(
                facets.cambioIssuer.connect(signers.admin).registerIssuer(signers.user1.address)
            ).to.emit(facets.cambioIssuer, "IssuerRegistered(address,uint256)");

            const profile = await facets.cambioIssuer.getIssuerProfile(signers.user1.address);
            expect(profile.isActive).to.be.true;
            expect(profile.registeredAt).to.be.gt(0);
        });

        it("reverts when registering same issuer twice (legacy)", async function () {
            await facets.cambioIssuer.connect(signers.admin).registerIssuer(signers.user1.address);
            await expect(
                facets.cambioIssuer.connect(signers.admin).registerIssuer(signers.user1.address)
            ).to.be.revertedWithCustomError(facets.cambioIssuer, "IssuerAlreadyRegistered");
        });

        it("reverts when non-admin tries to register", async function () {
            await expect(
                facets.cambioIssuer.connect(signers.user2).registerIssuer(signers.user1.address)
            ).to.be.revertedWithCustomError(facets.cambioIssuer, "UnauthorizedRole");
        });

        it("deactivates an issuer (legacy profile)", async function () {
            await facets.cambioIssuer.connect(signers.admin).registerIssuer(signers.user1.address);
            await facets.cambioIssuer.connect(signers.admin).deactivateIssuer(signers.user1.address);

            const profile = await facets.cambioIssuer.getIssuerProfile(signers.user1.address);
            expect(profile.isActive).to.be.false;
        });

        it("sets open redemption flag (legacy profile)", async function () {
            await facets.cambioIssuer.connect(signers.admin).registerIssuer(signers.user1.address);
            await facets.cambioIssuer.connect(signers.admin).setIssuerOpenRedemption(signers.user1.address, true);

            const profile = await facets.cambioIssuer.getIssuerProfile(signers.user1.address);
            expect(profile.openRedemption).to.be.true;
        });
    });

    describe("Sponsor Bank Endorsement", function () {
        it("allows sponsor bank to endorse a non-bank issuer", async function () {
            const issuer = signers.user3.address;
            const sponsorBank = signers.user2.address;

            await expect(
                facets.cambioIssuer.connect(signers.user2).endorseNonBankIssuer(issuer)
            ).to.emit(facets.cambioIssuer, "SponsorBankEndorsed");

            const pending = await facets.cambioIssuer.getPendingEndorsement(sponsorBank, issuer);
            expect(pending).to.be.true;
        });

        it("reverts when non-sponsor-bank tries to endorse", async function () {
            await expect(
                facets.cambioIssuer.connect(signers.user3).endorseNonBankIssuer(signers.user1.address)
            ).to.be.revertedWithCustomError(facets.cambioIssuer, "UnauthorizedRole");
        });
    });

    describe("Envelope-Mode Issuer Registration", function () {
        it("registers an issuer with sponsor bank after endorsement", async function () {
            const issuer = signers.user3.address;
            const sponsorBank = signers.user2.address;

            // Step 1: Sponsor bank endorses
            await facets.cambioIssuer.connect(signers.user2).endorseNonBankIssuer(issuer);

            // Step 2: Admin registers
            await expect(
                facets.cambioIssuer.connect(signers.admin)["registerIssuer(address,address)"](issuer, sponsorBank)
            ).to.emit(facets.cambioIssuer, "IssuerRegistered(address,address,uint256)");

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(issuer);
            expect(profile.sponsorBank).to.equal(sponsorBank);
            expect(profile.isActive).to.be.true;
            expect(profile.openRedemption).to.be.false;
            expect(profile.registeredAt).to.be.gt(0);
            expect(profile.pauseState).to.equal(0); // ACTIVE = 0

            // CAMBIO_ISSUER_ROLE should be granted
            const hasRole = await facets.accessControl.hasRole(ROLES.CAMBIO_ISSUER_ROLE, issuer);
            expect(hasRole).to.be.true;
        });

        it("reverts when registering without endorsement", async function () {
            const issuer = signers.user3.address;
            const sponsorBank = signers.user2.address;

            await expect(
                facets.cambioIssuer.connect(signers.admin)["registerIssuer(address,address)"](issuer, sponsorBank)
            ).to.be.revertedWithCustomError(facets.cambioIssuer, "NoPendingEndorsement");
        });

        it("reverts when non-admin tries envelope registration", async function () {
            await facets.cambioIssuer.connect(signers.user2).endorseNonBankIssuer(signers.user3.address);

            await expect(
                facets.cambioIssuer.connect(signers.user3)["registerIssuer(address,address)"](signers.user3.address, signers.user2.address)
            ).to.be.revertedWithCustomError(facets.cambioIssuer, "UnauthorizedRole");
        });

        it("reverts when registering same issuer twice (envelope)", async function () {
            const issuer = signers.user3.address;
            const sponsorBank = signers.user2.address;

            await facets.cambioIssuer.connect(signers.user2).endorseNonBankIssuer(issuer);
            await facets.cambioIssuer.connect(signers.admin)["registerIssuer(address,address)"](issuer, sponsorBank);

            // Re-endorse and try again
            await facets.cambioIssuer.connect(signers.user2).endorseNonBankIssuer(issuer);
            await expect(
                facets.cambioIssuer.connect(signers.admin)["registerIssuer(address,address)"](issuer, sponsorBank)
            ).to.be.revertedWithCustomError(facets.cambioIssuer, "IssuerAlreadyRegistered");
        });
    });

    describe("Issuer Effective State", function () {
        async function registerEnvelopeIssuer(issuerSigner, sponsorBankSigner) {
            await facets.cambioIssuer.connect(sponsorBankSigner).endorseNonBankIssuer(issuerSigner.address);
            await facets.cambioIssuer.connect(signers.admin)["registerIssuer(address,address)"](issuerSigner.address, sponsorBankSigner.address);
        }

        it("returns ACTIVE when sponsor bank is active and issuer is ACTIVE", async function () {
            await registerEnvelopeIssuer(signers.user3, signers.user2);
            const state = await facets.cambioIssuer.issuerEffectiveState(signers.user3.address);
            expect(state).to.equal(0); // ACTIVE = 0
        });

        it("returns ISSUANCE_PAUSED when sponsor bank is inactive", async function () {
            await registerEnvelopeIssuer(signers.user3, signers.user2);

            // Deactivate sponsor bank
            await facets.sponsorBank.connect(signers.admin).updateBankStatus(signers.user2.address, false);

            const state = await facets.cambioIssuer.issuerEffectiveState(signers.user3.address);
            expect(state).to.equal(1); // ISSUANCE_PAUSED = 1
        });

        it("returns FULLY_PAUSED when sponsor bank is FULLY_PAUSED", async function () {
            await registerEnvelopeIssuer(signers.user3, signers.user2);

            // Set sponsor bank's own envelope profile to FULLY_PAUSED
            // First register sponsor bank as an envelope issuer (so it has a profile)
            await registerEnvelopeIssuer(signers.user2, signers.user2);
            await facets.cambioIssuer.connect(signers.admin).setIssuerPauseState(signers.user2.address, 2); // FULLY_PAUSED = 2

            const state = await facets.cambioIssuer.issuerEffectiveState(signers.user3.address);
            expect(state).to.equal(2); // FULLY_PAUSED = 2
        });

        it("preserves issuer FULLY_PAUSED when sponsor bank becomes inactive", async function () {
            await registerEnvelopeIssuer(signers.user3, signers.user2);
            await facets.cambioIssuer.connect(signers.admin).setIssuerPauseState(signers.user3.address, 2); // FULLY_PAUSED

            // Deactivate sponsor bank
            await facets.sponsorBank.connect(signers.admin).updateBankStatus(signers.user2.address, false);

            const state = await facets.cambioIssuer.issuerEffectiveState(signers.user3.address);
            expect(state).to.equal(2); // FULLY_PAUSED = 2
        });

        it("returns ACTIVE for legacy issuers (no envelope profile)", async function () {
            await facets.cambioIssuer.connect(signers.admin).registerIssuer(signers.user1.address);
            const state = await facets.cambioIssuer.issuerEffectiveState(signers.user1.address);
            expect(state).to.equal(0); // ACTIVE = 0
        });
    });

    describe("Set Issuer Pause State", function () {
        async function registerEnvelopeIssuer(issuerSigner, sponsorBankSigner) {
            await facets.cambioIssuer.connect(sponsorBankSigner).endorseNonBankIssuer(issuerSigner.address);
            await facets.cambioIssuer.connect(signers.admin)["registerIssuer(address,address)"](issuerSigner.address, sponsorBankSigner.address);
        }

        it("allows admin to set pause state", async function () {
            await registerEnvelopeIssuer(signers.user3, signers.user2);

            await expect(
                facets.cambioIssuer.connect(signers.admin).setIssuerPauseState(signers.user3.address, 1) // ISSUANCE_PAUSED
            )
                .to.emit(facets.cambioIssuer, "IssuerPauseStateChanged")
                .withArgs(signers.user3.address, 1);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user3.address);
            expect(profile.pauseState).to.equal(1);
        });

        it("reverts when non-admin tries to set pause state", async function () {
            await registerEnvelopeIssuer(signers.user3, signers.user2);

            await expect(
                facets.cambioIssuer.connect(signers.user3).setIssuerPauseState(signers.user3.address, 1)
            ).to.be.revertedWithCustomError(facets.cambioIssuer, "UnauthorizedRole");
        });

        it("reverts when setting pause state for unregistered issuer", async function () {
            await expect(
                facets.cambioIssuer.connect(signers.admin).setIssuerPauseState(signers.user3.address, 1)
            ).to.be.revertedWithCustomError(facets.cambioIssuer, "IssuerNotRegistered");
        });
    });

    describe("Deactivate Issuer (Dual Profile)", function () {
        it("marks both legacy and envelope profiles inactive", async function () {
            const issuer = signers.user3.address;

            // Register legacy
            await facets.cambioIssuer.connect(signers.admin).registerIssuer(issuer);

            // Register envelope
            await facets.cambioIssuer.connect(signers.user2).endorseNonBankIssuer(issuer);
            await facets.cambioIssuer.connect(signers.admin)["registerIssuer(address,address)"](issuer, signers.user2.address);

            // Deactivate
            await facets.cambioIssuer.connect(signers.admin).deactivateIssuer(issuer);

            const legacyProfile = await facets.cambioIssuer.getIssuerProfile(issuer);
            expect(legacyProfile.isActive).to.be.false;

            const envelopeProfile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(issuer);
            expect(envelopeProfile.isActive).to.be.false;
        });
    });

    describe("Set Issuer Open Redemption (Dual Profile)", function () {
        it("sets both legacy and envelope profiles", async function () {
            const issuer = signers.user3.address;

            // Register legacy
            await facets.cambioIssuer.connect(signers.admin).registerIssuer(issuer);

            // Register envelope
            await facets.cambioIssuer.connect(signers.user2).endorseNonBankIssuer(issuer);
            await facets.cambioIssuer.connect(signers.admin)["registerIssuer(address,address)"](issuer, signers.user2.address);

            // Set open redemption
            await facets.cambioIssuer.connect(signers.admin).setIssuerOpenRedemption(issuer, true);

            const legacyProfile = await facets.cambioIssuer.getIssuerProfile(issuer);
            expect(legacyProfile.openRedemption).to.be.true;

            const envelopeProfile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(issuer);
            expect(envelopeProfile.openRedemption).to.be.true;
        });
    });

    describe("Envelope-Mode Risk Control Fields", function () {
        async function registerEnvelopeIssuer(issuerSigner, sponsorBankSigner) {
            await facets.cambioIssuer.connect(sponsorBankSigner).endorseNonBankIssuer(issuerSigner.address);
            await facets.cambioIssuer.connect(signers.admin)["registerIssuer(address,address)"](issuerSigner.address, sponsorBankSigner.address);
        }

        it("risk control fields exist on envelope profile", async function () {
            await registerEnvelopeIssuer(signers.user3, signers.user2);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user3.address);
            // Fields should exist with default values (0)
            expect(profile.maxOutstandingNoteCount).to.equal(0);
            expect(profile.maxOutstandingNoteValue).to.equal(0);
            expect(profile.dailyRedemptionCeiling).to.equal(0);
        });

        it("risk control fields are settable via CambioAdminFacet", async function () {
            await registerEnvelopeIssuer(signers.user3, signers.user2);

            await facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteCount(signers.user3.address, 100);
            await facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteValue(signers.user3.address, ethers.parseEther("10000"));
            await facets.cambioAdmin.connect(signers.admin).setIssuerDailyRedemptionCeiling(signers.user3.address, ethers.parseEther("5000"));

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user3.address);
            expect(profile.maxOutstandingNoteCount).to.equal(100);
            expect(profile.maxOutstandingNoteValue).to.equal(ethers.parseEther("10000"));
            expect(profile.dailyRedemptionCeiling).to.equal(ethers.parseEther("5000"));
        });
    });
});
