const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");

describe("CambioIssuerFacet — Open Redemption (T0.1 Bug Fix)", function () {
    async function setupFixture() {
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
        ({ facets, signers } = await loadFixture(setupFixture));
    });

    describe("setIssuerOpenRedemption", function () {
        it("legacy-only issuer: updates legacy profile and emits IssuerOpenRedemptionSet", async function () {
            const issuer = signers.user3.address;

            // Register legacy only
            await facets.cambioIssuer.connect(signers.admin).registerIssuer(issuer);

            await expect(
                facets.cambioIssuer.connect(signers.admin).setIssuerOpenRedemption(issuer, true)
            )
                .to.emit(facets.cambioIssuer, "IssuerOpenRedemptionSet")
                .withArgs(issuer, true);

            const legacyProfile = await facets.cambioIssuer.getIssuerProfile(issuer);
            expect(legacyProfile.openRedemption).to.be.true;

            // Envelope profile should not exist
            const envelopeProfile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(issuer);
            expect(envelopeProfile.registeredAt).to.equal(0);
        });

        it("envelope-only issuer: updates envelope profile, does not revert, and emits IssuerOpenRedemptionUpdated", async function () {
            const issuer = signers.user3.address;
            const sponsorBank = signers.user2.address;

            // Register envelope only
            await facets.cambioIssuer.connect(signers.user2).endorseNonBankIssuer(issuer);
            await facets.cambioIssuer.connect(signers.admin)["registerIssuer(address,address)"](issuer, sponsorBank);

            await expect(
                facets.cambioIssuer.connect(signers.admin).setIssuerOpenRedemption(issuer, true)
            )
                .to.emit(facets.cambioIssuer, "IssuerOpenRedemptionUpdated")
                .withArgs(issuer, true);

            const envelopeProfile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(issuer);
            expect(envelopeProfile.openRedemption).to.be.true;

            // Legacy profile should not exist
            const legacyProfile = await facets.cambioIssuer.getIssuerProfile(issuer);
            expect(legacyProfile.registeredAt).to.equal(0);
        });

        it("both profiles: updates both and emits both events", async function () {
            const issuer = signers.user3.address;
            const sponsorBank = signers.user2.address;

            // Register legacy
            await facets.cambioIssuer.connect(signers.admin).registerIssuer(issuer);

            // Register envelope
            await facets.cambioIssuer.connect(signers.user2).endorseNonBankIssuer(issuer);
            await facets.cambioIssuer.connect(signers.admin)["registerIssuer(address,address)"](issuer, sponsorBank);

            await expect(
                facets.cambioIssuer.connect(signers.admin).setIssuerOpenRedemption(issuer, true)
            )
                .to.emit(facets.cambioIssuer, "IssuerOpenRedemptionSet")
                .withArgs(issuer, true)
                .and.to.emit(facets.cambioIssuer, "IssuerOpenRedemptionUpdated")
                .withArgs(issuer, true);

            const legacyProfile = await facets.cambioIssuer.getIssuerProfile(issuer);
            expect(legacyProfile.openRedemption).to.be.true;

            const envelopeProfile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(issuer);
            expect(envelopeProfile.openRedemption).to.be.true;
        });

        it("unregistered issuer (neither profile): reverts with IssuerNotRegistered", async function () {
            const unregistered = signers.user3.address;

            await expect(
                facets.cambioIssuer.connect(signers.admin).setIssuerOpenRedemption(unregistered, true)
            ).to.be.revertedWithCustomError(facets.cambioIssuer, "IssuerNotRegistered");
        });
    });
});
