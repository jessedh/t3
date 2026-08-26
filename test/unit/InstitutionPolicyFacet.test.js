const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

const POLICY_KEYS = {
    // Matches the constants exposed by InstitutionPolicyFacet.
    CANCEL_OOB_THRESHOLD_USD: ethers.keccak256(
        ethers.toUtf8Bytes("cancel_oob_threshold_usd")
    ),
    SHORTEN_OOB_REQUIRED: ethers.keccak256(
        ethers.toUtf8Bytes("shorten_oob_required")
    ),
    DUAL_APPROVAL_THRESHOLD_USD: ethers.keccak256(
        ethers.toUtf8Bytes("dual_approval_threshold_usd")
    )
};

// C-F5: 18-dec token units — $1,000,000 face value at 1 token = $1.
const DEFAULT_POLICY_THRESHOLD = 1_000_000n * 10n ** 18n;

describe("InstitutionPolicyFacet Unit Tests", function () {
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
        name = "Policy Test Institution",
        adminAddress
    ) {
        const { facets, signers } = deployment;
        const institutionAdmin = adminAddress || signers.user1.address;

        // Parse event instead of recomputing id to mirror production interaction pattern.
        const tx = await facets.institutionRegistry
            .connect(caller)
            .registerInstitution(
                name,
                ethers.keccak256(ethers.toUtf8Bytes(`${name}-meta`)),
                `ipfs://${name.toLowerCase().replace(/\s+/g, "-")}`,
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

    async function initializeDefaults(caller) {
        await deployment.facets.institutionPolicy
            .connect(caller)
            .initializeDefaultPolicies();
    }

    describe("Default Policy Initialization", function () {
        it("should initialize default network policies", async function () {
            const { facets, signers } = deployment;
            await initializeDefaults(signers.admin);

            expect(
                await facets.institutionPolicy.getNetworkPolicy(
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
                )
            ).to.equal(DEFAULT_POLICY_THRESHOLD);
            expect(
                await facets.institutionPolicy.getNetworkPolicy(
                    POLICY_KEYS.SHORTEN_OOB_REQUIRED
                )
            ).to.equal(1);
            expect(
                await facets.institutionPolicy.getNetworkPolicy(
                    POLICY_KEYS.DUAL_APPROVAL_THRESHOLD_USD
                )
            ).to.equal(DEFAULT_POLICY_THRESHOLD);
        });

        it("should reject re-initialization from non-admin", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.institutionPolicy
                    .connect(signers.user1)
                    .initializeDefaultPolicies()
            ).to.be.revertedWithCustomError(facets.institutionPolicy, "UnauthorizedRole");
        });

        it("should return network defaults for unaffiliated wallet", async function () {
            const { facets, signers } = deployment;
            await initializeDefaults(signers.admin);

            const [value, source] = await facets.institutionPolicy.getEffectivePolicy(
                signers.user1.address,
                POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
            );

            expect(value).to.equal(DEFAULT_POLICY_THRESHOLD);
            expect(source).to.equal("network");
        });
    });

    describe("Network Policy", function () {
        it("should set network policy", async function () {
            const { facets, signers } = deployment;
            const newValue = 500_000_000_000n;

            await facets.institutionPolicy
                .connect(signers.admin)
                .setNetworkPolicy(POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD, newValue);

            expect(
                await facets.institutionPolicy.getNetworkPolicy(
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
                )
            ).to.equal(newValue);
        });

        it("should emit NetworkPolicySet event", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.institutionPolicy
                    .connect(signers.admin)
                    .setNetworkPolicy(POLICY_KEYS.DUAL_APPROVAL_THRESHOLD_USD, 777_000_000_000n)
            )
                .to.emit(facets.institutionPolicy, "NetworkPolicySet")
                .withArgs(
                    POLICY_KEYS.DUAL_APPROVAL_THRESHOLD_USD,
                    777_000_000_000n,
                    signers.admin.address
                );
        });

        it("should reject from non-admin", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.institutionPolicy
                    .connect(signers.user1)
                    .setNetworkPolicy(POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD, 1)
            ).to.be.revertedWithCustomError(facets.institutionPolicy, "UnauthorizedRole");
        });
    });

    describe("Institution Policy Override", function () {
        it("should set institution policy", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await facets.institutionPolicy
                .connect(signers.admin)
                .setInstitutionPolicy(
                    institutionId,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                    500_000n
                );

            const [value, isSet] =
                await facets.institutionPolicy.getInstitutionPolicyValue(
                    institutionId,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
                );

            expect(value).to.equal(500_000n);
            expect(isSet).to.equal(true);
        });

        it("should resolve institution policy over network", async function () {
            const { facets, signers } = deployment;
            await initializeDefaults(signers.admin);
            const institutionId = await registerInstitution(signers.admin);

            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);

            await facets.institutionPolicy
                .connect(signers.admin)
                .setInstitutionPolicy(
                    institutionId,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                    500_000_000_000n
                );

            const [value, source] = await facets.institutionPolicy.getEffectivePolicy(
                signers.user2.address,
                POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
            );

            expect(value).to.equal(500_000_000_000n);
            expect(source).to.equal("institution");
        });

        it("should allow institution admin to set policy for own institution", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(
                signers.admin,
                "Owned Institution",
                signers.user1.address
            );

            await facets.accessControl
                .connect(signers.owner)
                .grantRole(ROLES.INSTITUTION_ADMIN_ROLE, signers.user1.address);

            await expect(
                facets.institutionPolicy
                    .connect(signers.user1)
                    .setInstitutionPolicy(
                        institutionId,
                        POLICY_KEYS.DUAL_APPROVAL_THRESHOLD_USD,
                        333_000_000_000n
                    )
            )
                .to.emit(facets.institutionPolicy, "InstitutionPolicySet")
                .withArgs(
                    institutionId,
                    POLICY_KEYS.DUAL_APPROVAL_THRESHOLD_USD,
                    333_000_000_000n,
                    signers.user1.address
                );
        });

        it("should reject institution admin setting policy for other institution", async function () {
            const { facets, signers } = deployment;
            await registerInstitution(signers.admin, "Institution 1", signers.user1.address);
            const institution2 = await registerInstitution(
                signers.admin,
                "Institution 2",
                signers.user2.address
            );

            await facets.accessControl
                .connect(signers.owner)
                .grantRole(ROLES.INSTITUTION_ADMIN_ROLE, signers.user1.address);

            await expect(
                facets.institutionPolicy
                    .connect(signers.user1)
                    .setInstitutionPolicy(
                        institution2,
                        POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                        111_000_000_000n
                    )
            ).to.be.revertedWithCustomError(facets.institutionPolicy, "UnauthorizedRole");
        });

        it("should clear institution policy", async function () {
            const { facets, signers } = deployment;
            await initializeDefaults(signers.admin);

            const institutionId = await registerInstitution(signers.admin);
            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);

            await facets.institutionPolicy
                .connect(signers.admin)
                .setInstitutionPolicy(
                    institutionId,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                    500_000_000_000n
                );

            await facets.institutionPolicy
                .connect(signers.admin)
                .clearInstitutionPolicy(
                    institutionId,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
                );

            const [value, isSet] =
                await facets.institutionPolicy.getInstitutionPolicyValue(
                    institutionId,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
                );
            const [effective, source] = await facets.institutionPolicy.getEffectivePolicy(
                signers.user2.address,
                POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
            );

            expect(value).to.equal(0);
            expect(isSet).to.equal(false);
            expect(effective).to.equal(DEFAULT_POLICY_THRESHOLD);
            expect(source).to.equal("network");
        });
    });

    describe("Wallet Policy Override", function () {
        it("should set wallet policy", async function () {
            const { facets, signers } = deployment;

            await facets.institutionPolicy
                .connect(signers.owner)
                .setWalletPolicy(
                    signers.user2.address,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                    100_000n
                );

            const [value, isSet] = await facets.institutionPolicy.getWalletPolicyValue(
                signers.user2.address,
                POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
            );

            expect(value).to.equal(100_000n);
            expect(isSet).to.equal(true);
        });

        it("should resolve wallet policy over institution", async function () {
            const { facets, signers } = deployment;
            await initializeDefaults(signers.admin);

            const institutionId = await registerInstitution(signers.admin);
            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);

            await facets.institutionPolicy
                .connect(signers.admin)
                .setInstitutionPolicy(
                    institutionId,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                    500_000_000_000n
                );
            await facets.institutionPolicy
                .connect(signers.owner)
                .setWalletPolicy(
                    signers.user2.address,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                    100_000_000_000n
                );

            const [value, source] = await facets.institutionPolicy.getEffectivePolicy(
                signers.user2.address,
                POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
            );

            expect(value).to.equal(100_000_000_000n);
            expect(source).to.equal("wallet");
        });

        it("should reject from non-DEFAULT_ADMIN", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.institutionPolicy
                    .connect(signers.admin)
                    .setWalletPolicy(
                        signers.user2.address,
                        POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                        10
                    )
            ).to.be.revertedWithCustomError(facets.institutionPolicy, "UnauthorizedRole");
        });

        it("should clear wallet policy", async function () {
            const { facets, signers } = deployment;
            await initializeDefaults(signers.admin);

            const institutionId = await registerInstitution(signers.admin);
            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);

            await facets.institutionPolicy
                .connect(signers.admin)
                .setInstitutionPolicy(
                    institutionId,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                    500_000_000_000n
                );
            await facets.institutionPolicy
                .connect(signers.owner)
                .setWalletPolicy(
                    signers.user2.address,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                    100_000_000_000n
                );

            await facets.institutionPolicy
                .connect(signers.owner)
                .clearWalletPolicy(
                    signers.user2.address,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
                );

            const [effective, source] = await facets.institutionPolicy.getEffectivePolicy(
                signers.user2.address,
                POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
            );

            expect(effective).to.equal(500_000_000_000n);
            expect(source).to.equal("institution");
        });
    });

    describe("Policy Resolution Precedence", function () {
        it("full 3-level resolution", async function () {
            const { facets, signers } = deployment;
            await initializeDefaults(signers.admin);

            const institutionId = await registerInstitution(signers.admin);
            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);

            await facets.institutionPolicy
                .connect(signers.admin)
                .setInstitutionPolicy(
                    institutionId,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                    500_000_000_000n
                );
            await facets.institutionPolicy
                .connect(signers.owner)
                .setWalletPolicy(
                    signers.user2.address,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                    100_000_000_000n
                );

            // Wallet override should win over institution + network.
            let [value, source] = await facets.institutionPolicy.getEffectivePolicy(
                signers.user2.address,
                POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
            );
            expect(value).to.equal(100_000_000_000n);
            expect(source).to.equal("wallet");

            await facets.institutionPolicy
                .connect(signers.owner)
                .clearWalletPolicy(
                    signers.user2.address,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
                );

            // After clearing wallet override, institution override should become effective.
            [value, source] = await facets.institutionPolicy.getEffectivePolicy(
                signers.user2.address,
                POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
            );
            expect(value).to.equal(500_000_000_000n);
            expect(source).to.equal("institution");

            await facets.institutionPolicy
                .connect(signers.admin)
                .clearInstitutionPolicy(
                    institutionId,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
                );

            // After clearing institution override, resolution should fall back to network default.
            [value, source] = await facets.institutionPolicy.getEffectivePolicy(
                signers.user2.address,
                POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
            );
            expect(value).to.equal(DEFAULT_POLICY_THRESHOLD);
            expect(source).to.equal("network");
        });

        it("unaffiliated wallet skips institution level", async function () {
            const { facets, signers } = deployment;
            await initializeDefaults(signers.admin);

            const institutionId = await registerInstitution(signers.admin);
            await facets.institutionPolicy
                .connect(signers.admin)
                .setInstitutionPolicy(
                    institutionId,
                    POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                    500_000_000_000n
                );

            const [value, source] = await facets.institutionPolicy.getEffectivePolicy(
                signers.user3.address,
                POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
            );

            expect(value).to.equal(DEFAULT_POLICY_THRESHOLD);
            expect(source).to.equal("network");
        });

        it("zero value is valid policy", async function () {
            const { facets, signers } = deployment;
            await initializeDefaults(signers.admin);

            await facets.institutionPolicy
                .connect(signers.owner)
                .setWalletPolicy(signers.user2.address, POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD, 0);

            const [value, source] = await facets.institutionPolicy.getEffectivePolicy(
                signers.user2.address,
                POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD
            );

            // Explicit flag allows zero to be treated as a real wallet override.
            expect(value).to.equal(0);
            expect(source).to.equal("wallet");
        });
    });

    describe("Scoped Roles", function () {
        it("should grant scoped role", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);
            const scopedRole = ethers.keccak256(ethers.toUtf8Bytes("SCOPED_COMPLIANCE_ROLE"));

            await facets.institutionPolicy
                .connect(signers.admin)
                .grantScopedRole(scopedRole, signers.user2.address, institutionId);

            expect(
                await facets.institutionPolicy.hasScopedRole(
                    scopedRole,
                    signers.user2.address,
                    institutionId
                )
            ).to.equal(true);
        });

        it("should revoke scoped role", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);
            const scopedRole = ethers.keccak256(ethers.toUtf8Bytes("SCOPED_COMPLIANCE_ROLE"));

            await facets.institutionPolicy
                .connect(signers.admin)
                .grantScopedRole(scopedRole, signers.user2.address, institutionId);
            await facets.institutionPolicy
                .connect(signers.admin)
                .revokeScopedRole(scopedRole, signers.user2.address, institutionId);

            expect(
                await facets.institutionPolicy.hasScopedRole(
                    scopedRole,
                    signers.user2.address,
                    institutionId
                )
            ).to.equal(false);
        });

        it("should not affect global roles", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);
            const scopedRole = ethers.keccak256(ethers.toUtf8Bytes("CUSTOM_SCOPED_ROLE"));

            await facets.institutionPolicy
                .connect(signers.admin)
                .grantScopedRole(scopedRole, signers.user2.address, institutionId);

            expect(
                await facets.accessControl.hasRole(scopedRole, signers.user2.address)
            ).to.equal(false);
        });

        it("should reject grant from non-admin", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);
            const scopedRole = ethers.keccak256(ethers.toUtf8Bytes("CUSTOM_SCOPED_ROLE"));

            await expect(
                facets.institutionPolicy
                    .connect(signers.user1)
                    .grantScopedRole(scopedRole, signers.user2.address, institutionId)
            ).to.be.revertedWithCustomError(facets.institutionPolicy, "UnauthorizedRole");
        });
    });

    describe("Security", function () {
        it("reject institution policy from unauthorized", async function () {
            const { facets, signers } = deployment;
            const institutionId = await registerInstitution(signers.admin);

            await expect(
                facets.institutionPolicy
                    .connect(signers.user1)
                    .setInstitutionPolicy(
                        institutionId,
                        POLICY_KEYS.CANCEL_OOB_THRESHOLD_USD,
                        123
                    )
            ).to.be.revertedWithCustomError(facets.institutionPolicy, "UnauthorizedRole");
        });

        it("reject wallet policy from non-DEFAULT_ADMIN", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.institutionPolicy
                    .connect(signers.admin)
                    .setWalletPolicy(
                        signers.user1.address,
                        POLICY_KEYS.DUAL_APPROVAL_THRESHOLD_USD,
                        123
                    )
            ).to.be.revertedWithCustomError(facets.institutionPolicy, "UnauthorizedRole");
        });

        it("stale institution mapping", async function () {
            const { facets, signers } = deployment;
            await initializeDefaults(signers.admin);

            const institutionId = await registerInstitution(signers.admin);
            await facets.institutionRegistry
                .connect(signers.admin)
                .linkWalletToInstitution(signers.user2.address, institutionId);

            await facets.institutionPolicy
                .connect(signers.admin)
                .setInstitutionPolicy(
                    institutionId,
                    POLICY_KEYS.DUAL_APPROVAL_THRESHOLD_USD,
                    777_000_000_000n
                );

            await facets.institutionRegistry
                .connect(signers.admin)
                .setInstitutionStatus(institutionId, 0);

            const [value, source] = await facets.institutionPolicy.getEffectivePolicy(
                signers.user2.address,
                POLICY_KEYS.DUAL_APPROVAL_THRESHOLD_USD
            );

            expect(value).to.equal(777_000_000_000n);
            expect(source).to.equal("institution");
        });
    });
});
