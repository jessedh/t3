const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

describe("InstitutionRegistryFacet Unit Tests", function () {
    let deployment;

    async function setupFixture() {
        deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        return deployment;
    }

    beforeEach(async function () {
        deployment = await loadFixture(setupFixture);
    });

async function registerInstitution(
        caller,
        name = "First National Bank",
        metadataURI = "ipfs://institution/1",
        adminAddress
    ) {
        const { facets, signers } = deployment;
        const institutionAdmin = adminAddress || signers.user1.address;

        // Parse emitted event to retrieve deterministic institutionId for follow-up assertions.
        const tx = await facets.institutionRegistry
            .connect(caller)
            .registerInstitution(
                name,
                ethers.keccak256(ethers.toUtf8Bytes(`${name}-hash`)),
                metadataURI,
                institutionAdmin
            );
        const receipt = await tx.wait();
        const event = receipt.logs
            .map((log) => {
                try {
                    return facets.institutionRegistry.interface.parseLog(log);
                } catch {
                    return null;
                }
            })
            .find((parsed) => parsed && parsed.name === "InstitutionRegistered");

        return event.args.id;
    }

    describe("Institution Registration", function () {
        it("should register institution with valid params", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.institutionRegistry.connect(signers.admin).registerInstitution(
                    "First National Bank",
                    ethers.keccak256(ethers.toUtf8Bytes("meta-1")),
                    "ipfs://institution/1",
                    signers.user1.address
                )
            )
                .to.emit(facets.institutionRegistry, "InstitutionRegistered")
                .withArgs(
                    ethers.solidityPackedKeccak256(["uint256"], [0]),
                    "First National Bank",
                    signers.user1.address,
                    signers.admin.address
                );

            const institution = await facets.institutionRegistry.getInstitution(
                ethers.solidityPackedKeccak256(["uint256"], [0])
            );

            expect(institution.id).to.equal(
                ethers.solidityPackedKeccak256(["uint256"], [0])
            );
            expect(institution.name).to.equal("First National Bank");
            expect(institution.metadataURI).to.equal("ipfs://institution/1");
            expect(institution.status).to.equal(1);
            expect(institution.adminAddress).to.equal(signers.user1.address);
            expect(await facets.institutionRegistry.getInstitutionCount()).to.equal(1);
        });

        it("should generate unique immutable ID", async function () {
            const { facets, signers } = deployment;

            const id1 = await registerInstitution(signers.admin, "Bank A", "ipfs://a");
            const id2 = await registerInstitution(signers.admin, "Bank B", "ipfs://b", signers.user2.address);

            expect(id1).to.not.equal(id2);
            expect(id1).to.equal(ethers.solidityPackedKeccak256(["uint256"], [0]));
            expect(id2).to.equal(ethers.solidityPackedKeccak256(["uint256"], [1]));

            const institution = await facets.institutionRegistry.getInstitution(id1);
            expect(institution.id).to.equal(id1);
        });

        it("should reject registration from non-admin", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.institutionRegistry.connect(signers.user1).registerInstitution(
                    "Unauthorized Bank",
                    ethers.keccak256(ethers.toUtf8Bytes("meta")),
                    "ipfs://unauthorized",
                    signers.user1.address
                )
            ).to.be.revertedWithCustomError(facets.institutionRegistry, "UnauthorizedRole");
        });

        it("should reject empty institution name", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.institutionRegistry.connect(signers.admin).registerInstitution(
                    "",
                    ethers.keccak256(ethers.toUtf8Bytes("meta")),
                    "ipfs://meta",
                    signers.user1.address
                )
            ).to.be.revertedWithCustomError(
                facets.institutionRegistry,
                "InvalidInstitutionName"
            );
        });

        it("should reject zero-address admin", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.institutionRegistry.connect(signers.admin).registerInstitution(
                    "Zero Admin Bank",
                    ethers.keccak256(ethers.toUtf8Bytes("meta")),
                    "ipfs://meta",
                    ethers.ZeroAddress
                )
            ).to.be.revertedWithCustomError(
                facets.institutionRegistry,
                "ZeroAddressNotAllowed"
            );
        });

        it("should set initial status to Active", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            const institution = await facets.institutionRegistry.getInstitution(institutionId);
            expect(institution.status).to.equal(1);
        });
    });

    describe("Institution Updates", function () {
        it("should allow admin to update name/metadata", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);
            const before = await facets.institutionRegistry.getInstitution(institutionId);

            await facets.institutionRegistry
                .connect(signers.admin)
                .updateInstitution(
                    institutionId,
                    "Updated Bank Name",
                    ethers.keccak256(ethers.toUtf8Bytes("updated-meta")),
                    "ipfs://updated"
                );

            const after = await facets.institutionRegistry.getInstitution(institutionId);
            expect(after.name).to.equal("Updated Bank Name");
            expect(after.metadataURI).to.equal("ipfs://updated");
            expect(after.metadataHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes("updated-meta")));
            expect(after.updatedAt).to.be.gt(before.updatedAt);
        });

        it("should allow institution admin to update own institution", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(
                signers.admin,
                "Institution Admin Bank",
                "ipfs://institution-admin",
                signers.user1.address
            );

            await facets.accessControl
                .connect(signers.owner)
                .grantRole(ROLES.INSTITUTION_ADMIN_ROLE, signers.user1.address);

            await expect(
                facets.institutionRegistry
                    .connect(signers.user1)
                    .updateInstitution(
                        institutionId,
                        "Institution Admin Bank Updated",
                        ethers.keccak256(ethers.toUtf8Bytes("institution-admin-updated")),
                        "ipfs://institution-admin-updated"
                    )
            )
                .to.emit(facets.institutionRegistry, "InstitutionUpdated")
                .withArgs(
                    institutionId,
                    "Institution Admin Bank Updated",
                    signers.user1.address
                );
        });

        it("should reject update from non-admin", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await expect(
                facets.institutionRegistry
                    .connect(signers.user2)
                    .updateInstitution(
                        institutionId,
                        "Hacker Update",
                        ethers.keccak256(ethers.toUtf8Bytes("meta")),
                        "ipfs://hacker"
                    )
            ).to.be.revertedWithCustomError(facets.institutionRegistry, "UnauthorizedRole");
        });

        it("should reject update for nonexistent institution", async function () {
            const { facets, signers } = deployment;
            const missingId = ethers.keccak256(ethers.toUtf8Bytes("does-not-exist"));

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .updateInstitution(
                        missingId,
                        "Missing",
                        ethers.keccak256(ethers.toUtf8Bytes("meta")),
                        "ipfs://missing"
                    )
            ).to.be.revertedWithCustomError(facets.institutionRegistry, "InstitutionNotFound");
        });
    });

    describe("Institution Status Management", function () {
        it("should allow admin to suspend institution", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .setInstitutionStatus(institutionId, 2)
            )
                .to.emit(facets.institutionRegistry, "InstitutionStatusChanged")
                .withArgs(institutionId, 2, signers.admin.address);

            const institution = await facets.institutionRegistry.getInstitution(institutionId);
            expect(institution.status).to.equal(2);
        });

        it("should allow admin to deactivate institution", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await facets.institutionRegistry
                .connect(signers.admin)
                .setInstitutionStatus(institutionId, 0);

            const institution = await facets.institutionRegistry.getInstitution(institutionId);
            expect(institution.status).to.equal(0);
        });

        it("should allow admin to reactivate institution", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await facets.institutionRegistry
                .connect(signers.admin)
                .setInstitutionStatus(institutionId, 0);
            await facets.institutionRegistry
                .connect(signers.admin)
                .setInstitutionStatus(institutionId, 1);

            const institution = await facets.institutionRegistry.getInstitution(institutionId);
            expect(institution.status).to.equal(1);
        });

        it("should reject status change from non-admin", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await expect(
                facets.institutionRegistry
                    .connect(signers.user1)
                    .setInstitutionStatus(institutionId, 2)
            ).to.be.revertedWithCustomError(facets.institutionRegistry, "UnauthorizedRole");
        });
    });

    describe("Admin Rotation", function () {
        it("should rotate institution admin", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(
                signers.admin,
                "Rotate Admin Bank",
                "ipfs://rotate-admin",
                signers.user1.address
            );

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .rotateInstitutionAdmin(institutionId, signers.user2.address)
            )
                .to.emit(facets.institutionRegistry, "InstitutionAdminRotated")
                .withArgs(
                    institutionId,
                    signers.user1.address,
                    signers.user2.address,
                    signers.admin.address
                );

            const institution = await facets.institutionRegistry.getInstitution(institutionId);
            expect(institution.adminAddress).to.equal(signers.user2.address);
        });

        it("should reject rotation from non-admin", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await expect(
                facets.institutionRegistry
                    .connect(signers.user1)
                    .rotateInstitutionAdmin(institutionId, signers.user2.address)
            ).to.be.revertedWithCustomError(facets.institutionRegistry, "UnauthorizedRole");
        });

        it("should reject rotation to zero address", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .rotateInstitutionAdmin(institutionId, ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(
                facets.institutionRegistry,
                "ZeroAddressNotAllowed"
            );
        });
    });

    describe("Wallet Affiliation", function () {
        it("should link wallet to institution", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .linkWalletToInstitution(signers.user2.address, institutionId)
            )
                .to.emit(facets.institutionRegistry, "WalletLinked")
                .withArgs(signers.user2.address, institutionId, signers.admin.address);

            const affiliation = await facets.institutionRegistry.getWalletAffiliation(
                signers.user2.address
            );
            expect(affiliation.institutionId).to.equal(institutionId);
            expect(affiliation.status).to.equal(1);
        });

        it("should reject linking already-affiliated wallet", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .linkWalletToInstitution(signers.user2.address, institutionId)
            ).to.be.revertedWithCustomError(
                facets.institutionRegistry,
                "WalletAlreadyAffiliated"
            );
        });

        it("should allow institution admin to link wallet to own institution", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(
                signers.admin,
                "Institution Admin Wallet Bank",
                "ipfs://inst-admin-wallet",
                signers.user1.address
            );

            await facets.accessControl
                .connect(signers.owner)
                .grantRole(ROLES.INSTITUTION_ADMIN_ROLE, signers.user1.address);

            await expect(
                facets.institutionRegistry
                    .connect(signers.user1)
                    .linkWalletToInstitution(signers.user3.address, institutionId)
            )
                .to.emit(facets.institutionRegistry, "WalletLinked")
                .withArgs(signers.user3.address, institutionId, signers.user1.address);
        });

        it("should reject institution admin linking to other institution", async function () {
            const { facets, signers } = deployment;
            const institution1 = await registerInstitution(
                signers.admin,
                "Institution One",
                "ipfs://institution/one",
                signers.user1.address
            );
            const institution2 = await registerInstitution(
                signers.admin,
                "Institution Two",
                "ipfs://institution/two",
                signers.user2.address
            );

            await facets.accessControl
                .connect(signers.owner)
                .grantRole(ROLES.INSTITUTION_ADMIN_ROLE, signers.user1.address);

            await expect(
                facets.institutionRegistry
                    .connect(signers.user1)
                    .linkWalletToInstitution(signers.user3.address, institution2)
            ).to.be.revertedWithCustomError(facets.institutionRegistry, "UnauthorizedRole");

            // Ensure failed write did not leave partial affiliation state.
            const walletAffiliation = await facets.institutionRegistry.getWalletAffiliation(
                signers.user3.address
            );
            expect(walletAffiliation.institutionId).to.equal(ethers.ZeroHash);
            expect(institution1).to.not.equal(institution2);
        });

        it("should unlink wallet", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .unlinkWalletFromInstitution(signers.user2.address)
            )
                .to.emit(facets.institutionRegistry, "WalletUnlinked")
                .withArgs(signers.user2.address, institutionId, signers.admin.address);

            const affiliation = await facets.institutionRegistry.getWalletAffiliation(
                signers.user2.address
            );
            expect(affiliation.institutionId).to.equal(ethers.ZeroHash);
            expect(affiliation.status).to.equal(0);
        });

        it("should reject unlinking unaffiliated wallet", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .unlinkWalletFromInstitution(signers.user2.address)
            ).to.be.revertedWithCustomError(
                facets.institutionRegistry,
                "WalletNotAffiliated"
            );
        });

        it("should allow re-linking after unlink", async function () {
            const { facets, signers } = deployment;
            const institution1 = await registerInstitution(signers.admin, "Bank 1", "ipfs://bank/1");
            const institution2 = await registerInstitution(signers.admin, "Bank 2", "ipfs://bank/2", signers.user2.address);

            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user3.address, institution1);
            await facets.institutionRegistry
                .connect(signers.admin)
                .unlinkWalletFromInstitution(signers.user3.address);
            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user3.address, institution2);

            const affiliation = await facets.institutionRegistry.getWalletAffiliation(
                signers.user3.address
            );
            expect(affiliation.institutionId).to.equal(institution2);
        });

        it("should reject linking to inactive institution", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await facets.institutionRegistry
                .connect(signers.admin)
                .setInstitutionStatus(institutionId, 0);

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .linkWalletToInstitution(signers.user2.address, institutionId)
            ).to.be.revertedWithCustomError(
                facets.institutionRegistry,
                "InstitutionNotActive"
            );
        });

        it("should reject linking zero-address wallet", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .linkWalletToInstitution(ethers.ZeroAddress, institutionId)
            ).to.be.revertedWithCustomError(
                facets.institutionRegistry,
                "ZeroAddressNotAllowed"
            );
        });
    });

    describe("Wallet Affiliation Status", function () {
        it("should suspend affiliated wallet", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);

            await facets.institutionRegistry
                .connect(signers.admin)
                .setWalletAffiliationStatus(signers.user2.address, 2);

            const affiliation = await facets.institutionRegistry.getWalletAffiliation(
                signers.user2.address
            );
            expect(affiliation.status).to.equal(2);
        });

        it("should revoke affiliated wallet", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);

            await facets.institutionRegistry
                .connect(signers.admin)
                .setWalletAffiliationStatus(signers.user2.address, 3);

            const affiliation = await facets.institutionRegistry.getWalletAffiliation(
                signers.user2.address
            );
            expect(affiliation.status).to.equal(3);
        });

        it("should reject status change on unaffiliated wallet", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .setWalletAffiliationStatus(signers.user2.address, 2)
            ).to.be.revertedWithCustomError(
                facets.institutionRegistry,
                "WalletNotAffiliated"
            );
        });
    });

    describe("View Functions", function () {
        it("should return correct institution data", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(
                signers.admin,
                "View Bank",
                "ipfs://view-bank",
                signers.user2.address
            );

            const institution = await facets.institutionRegistry.getInstitution(institutionId);
            expect(institution.id).to.equal(institutionId);
            expect(institution.name).to.equal("View Bank");
            expect(institution.adminAddress).to.equal(signers.user2.address);
            expect(institution.metadataURI).to.equal("ipfs://view-bank");
            expect(institution.registeredBy).to.equal(signers.admin.address);
            expect(institution.registeredAt).to.be.gt(0);
        });

        it("should return correct count", async function () {
            const { signers } = deployment;
            await registerInstitution(signers.admin, "Count A", "ipfs://count-a");
            await registerInstitution(signers.admin, "Count B", "ipfs://count-b", signers.user2.address);
            await registerInstitution(signers.admin, "Count C", "ipfs://count-c", signers.user3.address);

            expect(await deployment.facets.institutionRegistry.getInstitutionCount()).to.equal(3);
        });

        it("should enumerate by index", async function () {
            const { facets, signers } = deployment;
            const id0 = await registerInstitution(signers.admin, "Index A", "ipfs://index-a");
            const id1 = await registerInstitution(signers.admin, "Index B", "ipfs://index-b", signers.user2.address);
            const id2 = await registerInstitution(signers.admin, "Index C", "ipfs://index-c", signers.user3.address);

            expect(await facets.institutionRegistry.getInstitutionAtIndex(0)).to.equal(id0);
            expect(await facets.institutionRegistry.getInstitutionAtIndex(1)).to.equal(id1);
            expect(await facets.institutionRegistry.getInstitutionAtIndex(2)).to.equal(id2);
        });

        it("should return wallet affiliation", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);

            const affiliation = await facets.institutionRegistry.getWalletAffiliation(
                signers.user2.address
            );
            expect(affiliation.institutionId).to.equal(institutionId);
            expect(affiliation.status).to.equal(1);
            expect(affiliation.affiliatedAt).to.be.gt(0);
        });

        it("should return zero for unaffiliated wallet", async function () {
            const { facets, signers } = deployment;
            const affiliation = await facets.institutionRegistry.getWalletAffiliation(
                signers.user2.address
            );
            expect(affiliation.institutionId).to.equal(ethers.ZeroHash);
        });

        it("should check isInstitutionActive correctly", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            expect(await facets.institutionRegistry.isInstitutionActive(institutionId)).to.be.true;

            await facets.institutionRegistry
                .connect(signers.admin)
                .setInstitutionStatus(institutionId, 0);
            expect(await facets.institutionRegistry.isInstitutionActive(institutionId)).to.be.false;

            await facets.institutionRegistry
                .connect(signers.admin)
                .setInstitutionStatus(institutionId, 2);
            expect(await facets.institutionRegistry.isInstitutionActive(institutionId)).to.be.false;
        });
    });

    describe("Edge Cases", function () {
        it("institution deactivation does not unlink wallets", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);
            await facets.institutionRegistry
                .connect(signers.admin)
                .setInstitutionStatus(institutionId, 0);

            const affiliation = await facets.institutionRegistry.getWalletAffiliation(
                signers.user2.address
            );
            expect(affiliation.institutionId).to.equal(institutionId);
            expect(affiliation.status).to.equal(1);
        });

        it("revoked wallet cannot be re-linked without explicit unlink", async function () {
            const { facets, signers } = deployment;
            const institution1 = await registerInstitution(signers.admin, "Revoked Bank A", "ipfs://revoked-a");
            const institution2 = await registerInstitution(signers.admin, "Revoked Bank B", "ipfs://revoked-b", signers.user2.address);

            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user3.address, institution1);
            await facets.institutionRegistry
                .connect(signers.admin)
                .setWalletAffiliationStatus(signers.user3.address, 3);

            await expect(
                facets.institutionRegistry
                    .connect(signers.admin)
                    .linkWalletToInstitution(signers.user3.address, institution2)
            ).to.be.revertedWithCustomError(
                facets.institutionRegistry,
                "WalletAlreadyAffiliated"
            );
        });
    });
});
