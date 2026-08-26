// test/unit/InstitutionLifecycleFacet.test.js
//
// Unit tests for Wave 3B.2 — InstitutionLifecycleFacet
//
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

// Numeric values matching InstitutionLifecycleStorage.InstitutionMode
const MODE = {
    ACTIVE: 0,
    ISSUANCE_PAUSED: 1,
    ORDERLY_EXIT: 2,
    DEFAULTED: 3,
    RESOLVED: 4,
};

describe("InstitutionLifecycleFacet Unit Tests", function () {
    let deployment;

    async function setupFixture() {
        const dep = await deployT3DiamondFixture();
        await setupTestRoles(dep.facets, dep.signers);
        return dep;
    }

    beforeEach(async function () {
        deployment = await loadFixture(setupFixture);
    });

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    function lifecycle() {
        return deployment.facets.institutionLifecycle;
    }

    function consortium() {
        return deployment.facets.consortiumMembership;
    }

    async function registerBank(signer) {
        await consortium()
            .connect(deployment.signers.admin)
            .registerBank(signer.address, "Test Bank", signer.address, ethers.parseEther("1"));
    }

    // -----------------------------------------------------------------------
    // setInstitutionMode — valid transitions
    // -----------------------------------------------------------------------

    describe("Valid mode transitions", function () {
        it("ACTIVE → ISSUANCE_PAUSED emits InstitutionModeChanged", async function () {
            const { signers } = deployment;
            const institution = signers.user1.address;

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.ISSUANCE_PAUSED)
            )
                .to.emit(lifecycle(), "InstitutionModeChanged")
                .withArgs(institution, MODE.ACTIVE, MODE.ISSUANCE_PAUSED);

            expect(await lifecycle().getInstitutionMode(institution)).to.equal(MODE.ISSUANCE_PAUSED);
        });

        it("ACTIVE → ORDERLY_EXIT emits InstitutionModeChanged", async function () {
            const { signers } = deployment;
            const institution = signers.user1.address;

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.ORDERLY_EXIT)
            )
                .to.emit(lifecycle(), "InstitutionModeChanged")
                .withArgs(institution, MODE.ACTIVE, MODE.ORDERLY_EXIT);
        });

        it("ACTIVE → DEFAULT emits InstitutionModeChanged", async function () {
            const { signers } = deployment;
            const institution = signers.user2.address;

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.DEFAULTED)
            )
                .to.emit(lifecycle(), "InstitutionModeChanged")
                .withArgs(institution, MODE.ACTIVE, MODE.DEFAULTED);
        });

        it("ISSUANCE_PAUSED → ACTIVE emits InstitutionModeChanged", async function () {
            const { signers } = deployment;
            const institution = signers.user2.address;

            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.ISSUANCE_PAUSED);

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.ACTIVE)
            )
                .to.emit(lifecycle(), "InstitutionModeChanged")
                .withArgs(institution, MODE.ISSUANCE_PAUSED, MODE.ACTIVE);
        });

        it("ORDERLY_EXIT → RESOLVED emits InstitutionModeChanged", async function () {
            const { signers } = deployment;
            const institution = signers.user3.address;

            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.ORDERLY_EXIT);

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.RESOLVED)
            )
                .to.emit(lifecycle(), "InstitutionModeChanged")
                .withArgs(institution, MODE.ORDERLY_EXIT, MODE.RESOLVED);
        });

        it("DEFAULT → RESOLVED emits InstitutionModeChanged", async function () {
            const { signers } = deployment;
            const institution = signers.minter.address;

            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.DEFAULTED);

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.RESOLVED)
            )
                .to.emit(lifecycle(), "InstitutionModeChanged")
                .withArgs(institution, MODE.DEFAULTED, MODE.RESOLVED);
        });
    });

    // -----------------------------------------------------------------------
    // setInstitutionMode — invalid transitions
    // -----------------------------------------------------------------------

    describe("Invalid mode transitions revert InvalidModeTransition", function () {
        it("ACTIVE → RESOLVED is invalid", async function () {
            const { signers } = deployment;
            const institution = signers.user1.address;

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.RESOLVED)
            ).to.be.revertedWithCustomError(lifecycle(), "InvalidModeTransition")
                .withArgs(institution, MODE.ACTIVE, MODE.RESOLVED);
        });

        it("ISSUANCE_PAUSED → ORDERLY_EXIT is invalid", async function () {
            const { signers } = deployment;
            const institution = signers.user2.address;

            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.ISSUANCE_PAUSED);

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.ORDERLY_EXIT)
            ).to.be.revertedWithCustomError(lifecycle(), "InvalidModeTransition")
                .withArgs(institution, MODE.ISSUANCE_PAUSED, MODE.ORDERLY_EXIT);
        });

        it("ISSUANCE_PAUSED → DEFAULTED is invalid", async function () {
            const { signers } = deployment;
            const institution = signers.user3.address;

            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.ISSUANCE_PAUSED);

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.DEFAULTED)
            ).to.be.revertedWithCustomError(lifecycle(), "InvalidModeTransition")
                .withArgs(institution, MODE.ISSUANCE_PAUSED, MODE.DEFAULTED);
        });

        it("ORDERLY_EXIT → ACTIVE is invalid", async function () {
            const { signers } = deployment;
            const institution = signers.pauser.address;

            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.ORDERLY_EXIT);

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.ACTIVE)
            ).to.be.revertedWithCustomError(lifecycle(), "InvalidModeTransition")
                .withArgs(institution, MODE.ORDERLY_EXIT, MODE.ACTIVE);
        });
    });

    // -----------------------------------------------------------------------
    // RESOLVED is terminal
    // -----------------------------------------------------------------------

    describe("RESOLVED is terminal", function () {
        it("RESOLVED → ACTIVE reverts InvalidModeTransition", async function () {
            const { signers } = deployment;
            const institution = signers.user1.address;

            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.ORDERLY_EXIT);
            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.RESOLVED);

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.ACTIVE)
            ).to.be.revertedWithCustomError(lifecycle(), "InvalidModeTransition");
        });

        it("RESOLVED → ISSUANCE_PAUSED reverts InvalidModeTransition", async function () {
            const { signers } = deployment;
            const institution = signers.user2.address;

            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.DEFAULTED);
            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.RESOLVED);

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.ISSUANCE_PAUSED)
            ).to.be.revertedWithCustomError(lifecycle(), "InvalidModeTransition");
        });

        it("RESOLVED → RESOLVED (self-transition) reverts InvalidModeTransition", async function () {
            const { signers } = deployment;
            const institution = signers.user3.address;

            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.DEFAULTED);
            await lifecycle().connect(signers.admin).setInstitutionMode(institution, MODE.RESOLVED);

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .setInstitutionMode(institution, MODE.RESOLVED)
            ).to.be.revertedWithCustomError(lifecycle(), "InvalidModeTransition");
        });
    });

    // -----------------------------------------------------------------------
    // linkBankToInstitution — bidirectional lookup
    // -----------------------------------------------------------------------

    describe("linkBankToInstitution", function () {
        it("stores both directions and both lookups return correct values", async function () {
            const { signers } = deployment;
            const bank = signers.user1.address;
            const institutionId = ethers.keccak256(ethers.toUtf8Bytes("bank-a"));

            await expect(
                lifecycle()
                    .connect(signers.admin)
                    .linkBankToInstitution(bank, institutionId)
            )
                .to.emit(lifecycle(), "BankInstitutionLinked")
                .withArgs(bank, institutionId);

            expect(await lifecycle().resolveInstitutionBank(institutionId)).to.equal(bank);
            expect(await lifecycle().resolveBankInstitution(bank)).to.equal(institutionId);
        });

        it("is idempotent when called with the same (bank, institutionId) pair", async function () {
            const { signers } = deployment;
            const bank = signers.user2.address;
            const institutionId = ethers.keccak256(ethers.toUtf8Bytes("bank-b"));

            // First call succeeds and emits
            await lifecycle().connect(signers.admin).linkBankToInstitution(bank, institutionId);

            // Second call with exact same pair must not revert
            await expect(
                lifecycle().connect(signers.admin).linkBankToInstitution(bank, institutionId)
            ).to.not.be.reverted;

            // State unchanged
            expect(await lifecycle().resolveInstitutionBank(institutionId)).to.equal(bank);
        });

        it("reverts BankAlreadyLinked when bank is re-linked to a different institutionId", async function () {
            const { signers } = deployment;
            const bank = signers.user3.address;
            const id1 = ethers.keccak256(ethers.toUtf8Bytes("bank-c-v1"));
            const id2 = ethers.keccak256(ethers.toUtf8Bytes("bank-c-v2"));

            await lifecycle().connect(signers.admin).linkBankToInstitution(bank, id1);

            await expect(
                lifecycle().connect(signers.admin).linkBankToInstitution(bank, id2)
            )
                .to.be.revertedWithCustomError(lifecycle(), "BankAlreadyLinked")
                .withArgs(bank, id1);
        });

        it("reverts InstitutionIdAlreadyLinked when institutionId is linked to a different bank", async function () {
            const { signers } = deployment;
            const bank1 = signers.pauser.address;
            const bank2 = signers.minter.address;
            const institutionId = ethers.keccak256(ethers.toUtf8Bytes("shared-institution"));

            await lifecycle().connect(signers.admin).linkBankToInstitution(bank1, institutionId);

            await expect(
                lifecycle().connect(signers.admin).linkBankToInstitution(bank2, institutionId)
            )
                .to.be.revertedWithCustomError(lifecycle(), "InstitutionIdAlreadyLinked")
                .withArgs(institutionId, bank1);
        });

        it("unlinked addresses return zero values from lookup views", async function () {
            const unknown = ethers.Wallet.createRandom().address;
            const unknownId = ethers.keccak256(ethers.toUtf8Bytes("nobody"));

            expect(await lifecycle().resolveInstitutionBank(unknownId)).to.equal(ethers.ZeroAddress);
            expect(await lifecycle().resolveBankInstitution(unknown)).to.equal(ethers.ZeroHash);
        });
    });

    // -----------------------------------------------------------------------
    // getInstitutionMode — default ACTIVE
    // -----------------------------------------------------------------------

    describe("getInstitutionMode", function () {
        it("returns ACTIVE (0) for any address not explicitly set", async function () {
            const unknown = ethers.Wallet.createRandom().address;
            expect(await lifecycle().getInstitutionMode(unknown)).to.equal(MODE.ACTIVE);
        });
    });

    // -----------------------------------------------------------------------
    // setBankActivation — lifecycle gate
    // -----------------------------------------------------------------------

    describe("ConsortiumMembership.setBankActivation lifecycle gate", function () {
        it("reverts LifecycleDeactivationBlocked when bank mode is ACTIVE", async function () {
            const { signers } = deployment;
            await registerBank(signers.user1);

            await expect(
                consortium()
                    .connect(signers.admin)
                    .setBankActivation(signers.user1.address, false)
            ).to.be.revertedWithCustomError(lifecycle(), "LifecycleDeactivationBlocked")
                .withArgs(signers.user1.address, MODE.ACTIVE);
        });

        it("reverts LifecycleDeactivationBlocked when bank mode is ISSUANCE_PAUSED", async function () {
            const { signers } = deployment;
            await registerBank(signers.user2);
            await lifecycle()
                .connect(signers.admin)
                .setInstitutionMode(signers.user2.address, MODE.ISSUANCE_PAUSED);

            await expect(
                consortium()
                    .connect(signers.admin)
                    .setBankActivation(signers.user2.address, false)
            ).to.be.revertedWithCustomError(lifecycle(), "LifecycleDeactivationBlocked")
                .withArgs(signers.user2.address, MODE.ISSUANCE_PAUSED);
        });

        it("succeeds when bank mode is ORDERLY_EXIT", async function () {
            const { signers } = deployment;
            await registerBank(signers.user3);
            await lifecycle()
                .connect(signers.admin)
                .setInstitutionMode(signers.user3.address, MODE.ORDERLY_EXIT);

            await expect(
                consortium()
                    .connect(signers.admin)
                    .setBankActivation(signers.user3.address, false)
            ).to.not.be.reverted;
        });

        it("succeeds when bank mode is DEFAULT", async function () {
            const { signers } = deployment;
            // Use custodian1 as bank to avoid conflicts with other tests
            await registerBank(signers.custodian1);
            await lifecycle()
                .connect(signers.admin)
                .setInstitutionMode(signers.custodian1.address, MODE.DEFAULTED);

            await expect(
                consortium()
                    .connect(signers.admin)
                    .setBankActivation(signers.custodian1.address, false)
            ).to.not.be.reverted;
        });

        it("succeeds when bank mode is RESOLVED", async function () {
            const { signers } = deployment;
            await registerBank(signers.custodian2);
            await lifecycle()
                .connect(signers.admin)
                .setInstitutionMode(signers.custodian2.address, MODE.ORDERLY_EXIT);
            await lifecycle()
                .connect(signers.admin)
                .setInstitutionMode(signers.custodian2.address, MODE.RESOLVED);

            await expect(
                consortium()
                    .connect(signers.admin)
                    .setBankActivation(signers.custodian2.address, false)
            ).to.not.be.reverted;
        });

        it("always allows re-activation (isActive == true) regardless of mode", async function () {
            const { signers } = deployment;
            await registerBank(signers.user1);
            await lifecycle()
                .connect(signers.admin)
                .setInstitutionMode(signers.user1.address, MODE.ORDERLY_EXIT);
            await consortium()
                .connect(signers.admin)
                .setBankActivation(signers.user1.address, false);

            // Re-activation must succeed even in ORDERLY_EXIT mode
            await expect(
                consortium()
                    .connect(signers.admin)
                    .setBankActivation(signers.user1.address, true)
            ).to.not.be.reverted;
        });
    });

    // -----------------------------------------------------------------------
    // Access control: non-admin cannot call admin-only functions
    // -----------------------------------------------------------------------

    describe("Access control", function () {
        it("setInstitutionMode reverts for non-admin", async function () {
            const { signers } = deployment;
            await expect(
                lifecycle()
                    .connect(signers.user1)
                    .setInstitutionMode(signers.user2.address, MODE.DEFAULTED)
            ).to.be.reverted;
        });

        it("linkBankToInstitution reverts for non-admin", async function () {
            const { signers } = deployment;
            await expect(
                lifecycle()
                    .connect(signers.user1)
                    .linkBankToInstitution(
                        signers.user2.address,
                        ethers.keccak256(ethers.toUtf8Bytes("some-id"))
                    )
            ).to.be.reverted;
        });
    });
});
