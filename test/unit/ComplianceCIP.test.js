const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");
const { setupTestBalances } = require("../helpers/tokens");

const CIP_ENFORCE_ACTIVE = ethers.keccak256(ethers.toUtf8Bytes("cip_enforce_active"));

describe("ComplianceCIP (Wave 8E-2)", function () {
    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        await setupTestBalances(deployment.facets, deployment.signers);

        const { diamondAddress } = deployment;
        const { user1, user2 } = deployment.signers;
        await deployment.facets.erc20.connect(user1).approve(diamondAddress, ethers.parseEther("10000"));
        await deployment.facets.erc20.connect(user2).approve(diamondAddress, ethers.parseEther("10000"));

        // Register both users under custodian1 so CIP can be recorded
        const currentTime = BigInt(await ethers.provider.getBlock("latest").then(b => b.timestamp));
        await deployment.facets.custodian.connect(deployment.signers.custodian1).registerCustodiedWallet(
            user1.address,
            currentTime,
            currentTime + BigInt(365 * 24 * 60 * 60)
        );
        await deployment.facets.custodian.connect(deployment.signers.custodian1).registerCustodiedWallet(
            user2.address,
            currentTime,
            currentTime + BigInt(365 * 24 * 60 * 60)
        );

        return deployment;
    }

    describe("default-OFF behavior", function () {
        it("transfer succeeds with no CIP record when gate is OFF and activeScopeCount == 0", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { user1, user2 } = signers;

            expect(await facets.complianceConfig.activeScopeCount()).to.equal(0);
            expect(await facets.complianceConfig.isCipEnforceActive()).to.be.false;

            await expect(
                facets.erc20Transfer.connect(user1).transfer(user2.address, ethers.parseEther("10"))
            ).not.to.be.reverted;
        });
    });

    describe("armed network CIP enforcement", function () {
        it("reverts ComplianceCIPRequired when sender has no CIP record", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(CIP_ENFORCE_ACTIVE, 1);

            await expect(
                facets.erc20Transfer.connect(user1).transfer(user2.address, ethers.parseEther("10"))
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceCIPRequired")
                .withArgs(user1.address, 0); // WALLET_TRANSFER = 0
        });

        it("reverts ComplianceCIPRequired when recipient has no CIP record", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, user3 } = signers;

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(CIP_ENFORCE_ACTIVE, 1);

            // user1 has CIP, user3 does not
            await facets.custodian.connect(signers.custodian1).recordCIP(user1.address, ethers.keccak256(ethers.toUtf8Bytes("cip-user1")));

            await expect(
                facets.erc20Transfer.connect(user1).transfer(user3.address, ethers.parseEther("10"))
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceCIPRequired")
                .withArgs(user3.address, 0);
        });

        it("succeeds after both parties record CIP", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(CIP_ENFORCE_ACTIVE, 1);

            await facets.custodian.connect(signers.custodian1).recordCIP(user1.address, ethers.keccak256(ethers.toUtf8Bytes("cip-user1")));
            await facets.custodian.connect(signers.custodian1).recordCIP(user2.address, ethers.keccak256(ethers.toUtf8Bytes("cip-user2")));

            await expect(
                facets.erc20Transfer.connect(user1).transfer(user2.address, ethers.parseEther("10"))
            ).not.to.be.reverted;
        });
    });

    describe("scoped exemption relaxes control", function () {
        it("wallet-scoped override of 0 allows transfer without CIP", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(CIP_ENFORCE_ACTIVE, 1);
            await facets.institutionPolicy.connect(owner).setWalletPolicy(user1.address, CIP_ENFORCE_ACTIVE, 0);

            // user1 exempt (no CIP needed); user2 has CIP recorded so recipient check passes
            await facets.custodian.connect(signers.custodian1).recordCIP(user2.address, ethers.keccak256(ethers.toUtf8Bytes("cip-user2")));
            await expect(
                facets.erc20Transfer.connect(user1).transfer(user2.address, ethers.parseEther("10"))
            ).not.to.be.reverted;
        });
    });

    describe("counter-vs-scoped-exemption", function () {
        it("activeScopeCount > 0 with one wallet exempt, non-exempt wallet still reverts", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, user3 } = signers;

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(CIP_ENFORCE_ACTIVE, 1);
            await facets.institutionPolicy.connect(owner).setWalletPolicy(user1.address, CIP_ENFORCE_ACTIVE, 0);

            expect(await facets.complianceConfig.activeScopeCount()).to.be.greaterThan(0);

            // user3 must be a registered custodied wallet before custodian1 can record CIP
            const currentTime = BigInt(await ethers.provider.getBlock("latest").then(b => b.timestamp));
            await facets.custodian.connect(signers.custodian1).registerCustodiedWallet(
                user3.address,
                currentTime,
                currentTime + BigInt(365 * 24 * 60 * 60)
            );

            // user1 is exempt, user3 has CIP recorded -> transfer succeeds
            await facets.custodian.connect(signers.custodian1).recordCIP(user3.address, ethers.keccak256(ethers.toUtf8Bytes("cip-user3")));
            await expect(
                facets.erc20Transfer.connect(user1).transfer(user3.address, ethers.parseEther("10"))
            ).not.to.be.reverted;

            // user2 is NOT exempt, transfer user2 -> user1 reverts
            await expect(
                facets.erc20Transfer.connect(user2).transfer(user1.address, ethers.parseEther("10"))
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceCIPRequired")
                .withArgs(user2.address, 0);
        });
    });

    describe("most-specific-wins", function () {
        it("institution-scoped CIP requirement applies to affiliated wallets", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, admin, user1, user2 } = signers;

            // Register an institution with admin as institution admin
            const institutionName = "Test Institution";
            const tx = await facets.institutionRegistry.connect(owner).registerInstitution(
                institutionName,
                ethers.keccak256(ethers.toUtf8Bytes("metadata")),
                "uri",
                admin.address
            );
            const receipt = await tx.wait();
            const registeredEvent = receipt.logs
                .map((l) => { try { return facets.institutionRegistry.interface.parseLog(l); } catch { return null; } })
                .filter(Boolean)
                .find((l) => l.name === "InstitutionRegistered");
            const institutionId = registeredEvent.args.id;

            // Link user1 to institution, leave user2 unaffiliated
            await facets.institutionRegistry.connect(owner).linkWalletToInstitution(user1.address, institutionId);

            // Network CIP OFF, institution CIP ON
            await facets.institutionPolicy.connect(owner).setInstitutionPolicy(institutionId, CIP_ENFORCE_ACTIVE, 1);

            // user1 (affiliated) must have CIP
            await expect(
                facets.erc20Transfer.connect(user1).transfer(user2.address, ethers.parseEther("10"))
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceCIPRequired")
                .withArgs(user1.address, 0);

            // Record CIP for user1; now both affiliated user1 and unaffiliated user2 can participate
            await facets.custodian.connect(signers.custodian1).recordCIP(user1.address, ethers.keccak256(ethers.toUtf8Bytes("cip-user1")));

            await expect(
                facets.erc20Transfer.connect(user1).transfer(user2.address, ethers.parseEther("10"))
            ).not.to.be.reverted;

            // user2 (unaffiliated sender, no CIP required) can send to user1 (affiliated recipient with CIP)
            await expect(
                facets.erc20Transfer.connect(user2).transfer(user1.address, ethers.parseEther("10"))
            ).not.to.be.reverted;
        });
    });
});
