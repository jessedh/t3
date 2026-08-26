"use strict";

const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { ROLES } = require("../helpers/roles");

describe("RelayerFallbackFacet (FR-ADR003-BESU)", function () {
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("relayer unreachable"));

    async function setupFixture() {
        const result = await deployT3DiamondFixture();
        const { facets, signers } = result;
        const { relayerFallback, accessControl } = facets;
        const { owner, custodian1: custodian, user1, user2 } = signers;

        await accessControl.connect(owner).grantRole(ROLES.CUSTODIAN_ROLE, custodian.address);
        await accessControl.connect(owner).grantRole(ROLES.CUSTODIAN_ROLE, user1.address);

        return { relayerFallback, owner, custodian, user1, user2 };
    }

    async function getDeclaration(relayerFallback, bank) {
        const [activatedAt, expiresAt] = await relayerFallback.getFallbackDeclaration(bank);
        return { activatedAt, expiresAt };
    }

    describe("declareRelayerFallback", function () {
        it("custodian can declare fallback and isFallbackActive returns true without explicit init", async function () {
            const { relayerFallback, custodian } = await loadFixture(setupFixture);
            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            expect(await relayerFallback.isFallbackActive(custodian.address)).to.be.true;
        });

        it("stores activation and default 4-hour expiry", async function () {
            const { relayerFallback, custodian } = await loadFixture(setupFixture);
            const tx = await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            const declaration = await getDeclaration(relayerFallback, custodian.address);

            expect(declaration.activatedAt).to.equal(block.timestamp);
            expect(declaration.expiresAt).to.equal(block.timestamp + 4 * 3600);
        });

        it("emits RelayerFallbackDeclared event with reason hash", async function () {
            const { relayerFallback, custodian } = await loadFixture(setupFixture);
            await expect(relayerFallback.connect(custodian).declareRelayerFallback(reasonHash))
                .to.emit(relayerFallback, "RelayerFallbackDeclared")
                .withArgs(custodian.address, reasonHash, anyValue);
        });

        it("non-custodian cannot declare fallback", async function () {
            const { relayerFallback, user2 } = await loadFixture(setupFixture);
            await expect(relayerFallback.connect(user2).declareRelayerFallback(reasonHash))
                .to.be.revertedWithCustomError(relayerFallback, "NotCustodian");
        });
    });

    describe("revokeOwnFallback", function () {
        it("custodian can revoke own declaration", async function () {
            const { relayerFallback, custodian } = await loadFixture(setupFixture);
            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            await relayerFallback.connect(custodian).revokeOwnFallback();
            expect(await relayerFallback.isFallbackActive(custodian.address)).to.be.false;

            const declaration = await getDeclaration(relayerFallback, custodian.address);
            expect(declaration.activatedAt).to.equal(0);
            expect(declaration.expiresAt).to.equal(0);
        });

        it("emits RelayerFallbackRevoked with bank as revokedBy", async function () {
            const { relayerFallback, custodian } = await loadFixture(setupFixture);
            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            await expect(relayerFallback.connect(custodian).revokeOwnFallback())
                .to.emit(relayerFallback, "RelayerFallbackRevoked")
                .withArgs(custodian.address, custodian.address);
        });
    });

    describe("isFallbackActive — expiry boundary", function () {
        it("returns false before any declaration", async function () {
            const { relayerFallback, custodian } = await loadFixture(setupFixture);
            expect(await relayerFallback.isFallbackActive(custodian.address)).to.be.false;
        });

        it("returns true while within expiry window", async function () {
            const { relayerFallback, custodian } = await loadFixture(setupFixture);
            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            await time.increase(3600);
            expect(await relayerFallback.isFallbackActive(custodian.address)).to.be.true;
        });

        it("returns false after expiry timestamp passes", async function () {
            const { relayerFallback, custodian } = await loadFixture(setupFixture);
            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            await time.increase(4 * 3600 + 1);
            expect(await relayerFallback.isFallbackActive(custodian.address)).to.be.false;
        });

        it("declarations are independent per bank", async function () {
            const { relayerFallback, custodian, user1 } = await loadFixture(setupFixture);
            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            expect(await relayerFallback.isFallbackActive(custodian.address)).to.be.true;
            expect(await relayerFallback.isFallbackActive(user1.address)).to.be.false;
        });
    });

    describe("setDefaultFallbackWindow (admin)", function () {
        it("admin can update default window and new declarations use it", async function () {
            const { relayerFallback, owner, custodian } = await loadFixture(setupFixture);
            const twoHours = 2 * 3600;
            await relayerFallback.connect(owner).setDefaultFallbackWindow(twoHours);
            expect(await relayerFallback.getDefaultFallbackWindow()).to.equal(twoHours);

            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            await time.increase(twoHours + 1);
            expect(await relayerFallback.isFallbackActive(custodian.address)).to.be.false;
        });

        it("emits DefaultFallbackWindowUpdated", async function () {
            const { relayerFallback, owner } = await loadFixture(setupFixture);
            await expect(relayerFallback.connect(owner).setDefaultFallbackWindow(3600))
                .to.emit(relayerFallback, "DefaultFallbackWindowUpdated")
                .withArgs(3600);
        });

        it("reverts with InvalidDuration for zero", async function () {
            const { relayerFallback, owner } = await loadFixture(setupFixture);
            await expect(relayerFallback.connect(owner).setDefaultFallbackWindow(0))
                .to.be.revertedWithCustomError(relayerFallback, "InvalidDuration");
        });

        it("reverts with InvalidDuration for more than 7 days", async function () {
            const { relayerFallback, owner } = await loadFixture(setupFixture);
            await expect(relayerFallback.connect(owner).setDefaultFallbackWindow(7 * 24 * 3600 + 1))
                .to.be.revertedWithCustomError(relayerFallback, "InvalidDuration");
        });

        it("non-admin cannot call setDefaultFallbackWindow", async function () {
            const { relayerFallback, custodian } = await loadFixture(setupFixture);
            await expect(relayerFallback.connect(custodian).setDefaultFallbackWindow(3600))
                .to.be.revertedWithCustomError(relayerFallback, "NotAdmin");
        });
    });

    describe("revokeFallbackDeclaration (admin)", function () {
        it("admin can revoke any bank's declaration", async function () {
            const { relayerFallback, owner, custodian } = await loadFixture(setupFixture);
            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            await relayerFallback.connect(owner).revokeFallbackDeclaration(custodian.address);
            expect(await relayerFallback.isFallbackActive(custodian.address)).to.be.false;
        });

        it("emits RelayerFallbackRevoked with admin as revokedBy", async function () {
            const { relayerFallback, owner, custodian } = await loadFixture(setupFixture);
            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            await expect(relayerFallback.connect(owner).revokeFallbackDeclaration(custodian.address))
                .to.emit(relayerFallback, "RelayerFallbackRevoked")
                .withArgs(custodian.address, owner.address);
        });

        it("non-admin cannot call revokeFallbackDeclaration", async function () {
            const { relayerFallback, custodian, user1 } = await loadFixture(setupFixture);
            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            await expect(relayerFallback.connect(user1).revokeFallbackDeclaration(custodian.address))
                .to.be.revertedWithCustomError(relayerFallback, "NotAdmin");
        });
    });

    describe("extendFallbackDeclaration (admin)", function () {
        it("admin can extend any active bank fallback to a specific expiry", async function () {
            const { relayerFallback, owner, custodian } = await loadFixture(setupFixture);
            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            const farFuture = (await time.latest()) + 7 * 24 * 3600;
            await relayerFallback.connect(owner).extendFallbackDeclaration(custodian.address, farFuture);

            const declaration = await getDeclaration(relayerFallback, custodian.address);
            expect(declaration.expiresAt).to.equal(farFuture);
        });

        it("reverts with NotFallbackActive when admin extends inactive declaration", async function () {
            const { relayerFallback, owner, custodian } = await loadFixture(setupFixture);
            const farFuture = (await time.latest()) + 3600;
            await expect(relayerFallback.connect(owner).extendFallbackDeclaration(custodian.address, farFuture))
                .to.be.revertedWithCustomError(relayerFallback, "NotFallbackActive");
        });

        it("non-admin cannot call extendFallbackDeclaration", async function () {
            const { relayerFallback, custodian, user1 } = await loadFixture(setupFixture);
            await relayerFallback.connect(custodian).declareRelayerFallback(reasonHash);
            const farFuture = (await time.latest()) + 3600;
            await expect(relayerFallback.connect(user1).extendFallbackDeclaration(custodian.address, farFuture))
                .to.be.revertedWithCustomError(relayerFallback, "NotAdmin");
        });
    });
});
