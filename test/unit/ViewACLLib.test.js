const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");

/**
 * ViewACLLib On-Chain View ACL Tests (FR-1005 — App-Layer Privacy Layer 1)
 *
 * Verifies that sensitive view functions revert with UnauthorizedViewer for
 * callers who are not a party to the data being queried. Covers all 8 gated
 * functions across TransferEnvelopeFacet, SmartLockEnvelopeFacet, and
 * CustodianRegistryFacet.
 *
 * Authorized callers tested:
 *   envelope-based: env.sender, env.recipient, sender's custodian,
 *                   recipient's custodian, admin (ADMIN_ROLE),
 *                   compliance (COMPLIANCE_ROLE), DEFAULT_ADMIN_ROLE holder
 *   wallet-based:   wallet itself, its custodian, operator
 *
 * Unauthorized callers tested:
 *   minter (unrelated third party with no relevant role)
 *
 * Signer assignments:
 *   user1    — envelope sender (wallet registered under custodian1)
 *   user2    — envelope recipient (wallet registered under custodian2)
 *   custodian1 — custodian of user1 (holds CUSTODIAN_ROLE)
 *   custodian2 — custodian of user2 (holds CUSTODIAN_ROLE)
 *   admin    — holds ADMIN_ROLE (operator bypass)
 *   user3    — granted COMPLIANCE_ROLE (operator bypass)
 *   minter   — unrelated third party (no custodian/party/operator relationship)
 *   owner    — DEFAULT_ADMIN_ROLE holder (operator bypass)
 */
describe("ViewACLLib — On-Chain View ACLs (FR-1005)", function () {
    const EB_HOLD_UNTIL_MANUAL = 2;
    const ST_CRYPTO_DIRECT = 0;

    const COMPLIANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("COMPLIANCE_ROLE"));

    let deployment;
    let envelopeId;       // envelope created in beforeEach, sender=user1, recipient=user2
    let smartLockId;      // smart lock envelope, sender=user1, recipient=user2

    async function mint(to, amount) {
        await deployment.facets.mintBurn.connect(deployment.signers.owner).mint(to, amount);
    }

    async function setupFixture() {
        const dep = await deployT3DiamondFixture();
        await setupTestRoles(dep.facets, dep.signers);

        // Grant COMPLIANCE_ROLE to user3 for operator-bypass tests
        await grantRole(
            dep.facets.accessControl,
            COMPLIANCE_ROLE,
            dep.signers.user3.address,
            dep.signers.owner
        );

        // Register user1 under custodian1
        await dep.facets.custodian
            .connect(dep.signers.custodian1)
            .registerCustodiedWallet(
                dep.signers.user1.address,
                Math.floor(Date.now() / 1000),
                Math.floor(Date.now() / 1000) + 365 * 24 * 3600
            );

        // Register user2 under custodian2
        await dep.facets.custodian
            .connect(dep.signers.custodian2)
            .registerCustodiedWallet(
                dep.signers.user2.address,
                Math.floor(Date.now() / 1000),
                Math.floor(Date.now() / 1000) + 365 * 24 * 3600
            );

        return dep;
    }

    beforeEach(async function () {
        deployment = await loadFixture(setupFixture);
        const { user1, user2, owner } = deployment.signers;

        // Mint to user1 so they can create envelopes
        await mint(user1.address, ethers.parseUnits("1000", 6));

        // Create a standard envelope (HOLD_UNTIL_MANUAL so it stays in Created state)
        const windowEnd = (await time.latest()) + 3600;
        const tx = await deployment.facets.envelope
            .connect(user1)
            .createEnvelope(
                user2.address,
                ethers.parseUnits("100", 6),
                windowEnd,
                ST_CRYPTO_DIRECT,
                EB_HOLD_UNTIL_MANUAL,
                ethers.ZeroHash
            );
        const receipt = await tx.wait();
        const evt = receipt.logs
            .map(log => { try { return deployment.facets.envelope.interface.parseLog(log); } catch { return null; } })
            .find(e => e && e.name === "EnvelopeCreated");
        envelopeId = evt.args.envelopeId;

        // Create a SmartLock envelope
        await mint(user1.address, ethers.parseUnits("100", 6));
        const slNonce = ethers.randomBytes(32);
        const slFragment = ethers.toUtf8Bytes("secret");
        const hashCommitment = ethers.keccak256(
            ethers.concat([slFragment, slNonce])
        );
        const slWindowEnd = (await time.latest()) + 3600;
        const slTx = await deployment.facets.smartLockEnvelope
            .connect(user1)
            .createSmartLockEnvelope(
                user2.address,
                ethers.parseUnits("50", 6),
                hashCommitment,
                slNonce,
                slWindowEnd,
                ethers.ZeroAddress
            );
        const slReceipt = await slTx.wait();
        const slEvt = slReceipt.logs
            .map(log => { try { return deployment.facets.smartLockEnvelope.interface.parseLog(log); } catch { return null; } })
            .find(e => e && e.name === "SmartLockEnvelopeCreated");
        smartLockId = slEvt.args.envelopeId;
    });

    // =========================================================================
    // getEnvelope
    // =========================================================================

    describe("getEnvelope", function () {
        it("allows env.sender to view", async function () {
            const { user1 } = deployment.signers;
            const env = await deployment.facets.envelope.connect(user1).getEnvelope(envelopeId);
            expect(env.sender).to.equal(user1.address);
        });

        it("allows env.recipient to view", async function () {
            const { user2 } = deployment.signers;
            const env = await deployment.facets.envelope.connect(user2).getEnvelope(envelopeId);
            expect(env.sender).to.not.equal(ethers.ZeroAddress);
        });

        it("allows sender's custodian to view", async function () {
            const { custodian1 } = deployment.signers;
            const env = await deployment.facets.envelope.connect(custodian1).getEnvelope(envelopeId);
            expect(env.sender).to.not.equal(ethers.ZeroAddress);
        });

        it("allows recipient's custodian to view", async function () {
            const { custodian2 } = deployment.signers;
            const env = await deployment.facets.envelope.connect(custodian2).getEnvelope(envelopeId);
            expect(env.sender).to.not.equal(ethers.ZeroAddress);
        });

        it("allows ADMIN_ROLE holder to view (operator bypass)", async function () {
            const { admin } = deployment.signers;
            const env = await deployment.facets.envelope.connect(admin).getEnvelope(envelopeId);
            expect(env.sender).to.not.equal(ethers.ZeroAddress);
        });

        it("allows DEFAULT_ADMIN_ROLE holder (owner) to view (operator bypass)", async function () {
            const { owner } = deployment.signers;
            const env = await deployment.facets.envelope.connect(owner).getEnvelope(envelopeId);
            expect(env.sender).to.not.equal(ethers.ZeroAddress);
        });

        it("allows COMPLIANCE_ROLE holder to view (operator bypass)", async function () {
            const { user3 } = deployment.signers;
            const env = await deployment.facets.envelope.connect(user3).getEnvelope(envelopeId);
            expect(env.sender).to.not.equal(ethers.ZeroAddress);
        });

        it("reverts for unrelated third party with UnauthorizedViewer", async function () {
            const { minter } = deployment.signers;
            await expect(
                deployment.facets.envelope.connect(minter).getEnvelope(envelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "UnauthorizedViewer")
             .withArgs(minter.address);
        });

        it("reverts with EnvelopeNotFound for non-existent envelope (any caller)", async function () {
            const { user1, minter } = deployment.signers;
            const fakeId = ethers.keccak256(ethers.toUtf8Bytes("does-not-exist"));

            // Non-party caller also gets EnvelopeNotFound (not UnauthorizedViewer)
            await expect(
                deployment.facets.envelope.connect(minter).getEnvelope(fakeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotFound");

            // Even authorized sender can't probe non-existent envelopes differently
            await expect(
                deployment.facets.envelope.connect(user1).getEnvelope(fakeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "EnvelopeNotFound");
        });
    });

    // =========================================================================
    // getEnvelopesBySender
    // =========================================================================

    describe("getEnvelopesBySender", function () {
        it("allows wallet itself to view its own sender list", async function () {
            const { user1 } = deployment.signers;
            const ids = await deployment.facets.envelope
                .connect(user1)
                .getEnvelopesBySender(user1.address);
            expect(ids.length).to.be.greaterThan(0);
        });

        it("allows wallet's custodian to view sender list", async function () {
            const { custodian1, user1 } = deployment.signers;
            const ids = await deployment.facets.envelope
                .connect(custodian1)
                .getEnvelopesBySender(user1.address);
            expect(ids.length).to.be.greaterThan(0);
        });

        it("allows operator (ADMIN_ROLE) to view sender list", async function () {
            const { admin, user1 } = deployment.signers;
            const ids = await deployment.facets.envelope
                .connect(admin)
                .getEnvelopesBySender(user1.address);
            expect(ids.length).to.be.greaterThan(0);
        });

        it("reverts for unrelated third party with UnauthorizedViewer", async function () {
            const { minter, user1 } = deployment.signers;
            await expect(
                deployment.facets.envelope.connect(minter).getEnvelopesBySender(user1.address)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "UnauthorizedViewer")
             .withArgs(minter.address);
        });

        it("reverts for a different custodian (not user1's custodian)", async function () {
            const { custodian2, user1 } = deployment.signers;
            // custodian2 is custodian of user2, not user1
            await expect(
                deployment.facets.envelope.connect(custodian2).getEnvelopesBySender(user1.address)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "UnauthorizedViewer")
             .withArgs(custodian2.address);
        });
    });

    // =========================================================================
    // getEnvelopesByRecipient
    // =========================================================================

    describe("getEnvelopesByRecipient", function () {
        it("allows wallet itself to view its own recipient list", async function () {
            const { user2 } = deployment.signers;
            const ids = await deployment.facets.envelope
                .connect(user2)
                .getEnvelopesByRecipient(user2.address);
            expect(ids.length).to.be.greaterThan(0);
        });

        it("allows wallet's custodian to view recipient list", async function () {
            const { custodian2, user2 } = deployment.signers;
            const ids = await deployment.facets.envelope
                .connect(custodian2)
                .getEnvelopesByRecipient(user2.address);
            expect(ids.length).to.be.greaterThan(0);
        });

        it("reverts for unrelated third party with UnauthorizedViewer", async function () {
            const { minter, user2 } = deployment.signers;
            await expect(
                deployment.facets.envelope.connect(minter).getEnvelopesByRecipient(user2.address)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "UnauthorizedViewer")
             .withArgs(minter.address);
        });
    });

    // =========================================================================
    // getDispute
    // =========================================================================

    describe("getDispute", function () {
        let disputedEnvelopeId;

        beforeEach(async function () {
            // Raise a dispute on our envelope so getDispute returns data
            const { user1 } = deployment.signers;
            await deployment.facets.envelope
                .connect(user1)
                .raiseDispute(envelopeId, ethers.toUtf8Bytes("test dispute"));
            disputedEnvelopeId = envelopeId;
        });

        it("allows env.sender to view dispute", async function () {
            const { user1 } = deployment.signers;
            const d = await deployment.facets.envelope
                .connect(user1)
                .getDispute(disputedEnvelopeId);
            expect(d.raisedBy).to.equal(user1.address);
        });

        it("allows env.recipient to view dispute", async function () {
            const { user2 } = deployment.signers;
            const d = await deployment.facets.envelope
                .connect(user2)
                .getDispute(disputedEnvelopeId);
            expect(d.raisedBy).to.not.equal(ethers.ZeroAddress);
        });

        it("allows sender's custodian to view dispute", async function () {
            const { custodian1 } = deployment.signers;
            const d = await deployment.facets.envelope
                .connect(custodian1)
                .getDispute(disputedEnvelopeId);
            expect(d.raisedBy).to.not.equal(ethers.ZeroAddress);
        });

        it("reverts for unrelated third party with UnauthorizedViewer", async function () {
            const { minter } = deployment.signers;
            await expect(
                deployment.facets.envelope.connect(minter).getDispute(disputedEnvelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "UnauthorizedViewer")
             .withArgs(minter.address);
        });
    });

    // =========================================================================
    // getOracleBinding
    // =========================================================================

    describe("getOracleBinding", function () {
        let oracleEnvelopeId;
        const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));

        beforeEach(async function () {
            const { user1, user2, user3, owner } = deployment.signers;

            // Grant ORACLE_ROLE to user3 for registering oracle binding
            await grantRole(deployment.facets.accessControl, ORACLE_ROLE, user3.address, owner);

            // Create an ORACLE_CONDITIONAL envelope
            const EB_ORACLE_CONDITIONAL = 3;
            const windowEnd = (await time.latest()) + 3600;
            await mint(user1.address, ethers.parseUnits("100", 6));
            const tx = await deployment.facets.envelope
                .connect(user1)
                .createEnvelope(
                    user2.address,
                    ethers.parseUnits("50", 6),
                    windowEnd,
                    ST_CRYPTO_DIRECT,
                    EB_ORACLE_CONDITIONAL,
                    ethers.ZeroHash
                );
            const receipt = await tx.wait();
            const evt = receipt.logs
                .map(log => { try { return deployment.facets.envelope.interface.parseLog(log); } catch { return null; } })
                .find(e => e && e.name === "EnvelopeCreated");
            oracleEnvelopeId = evt.args.envelopeId;

            // Register an oracle binding
            await deployment.facets.envelope
                .connect(user3)
                .registerOracle(oracleEnvelopeId, user3.address, "0x12345678");
        });

        it("allows env.sender to view oracle binding", async function () {
            const { user1 } = deployment.signers;
            const ob = await deployment.facets.envelope
                .connect(user1)
                .getOracleBinding(oracleEnvelopeId);
            expect(ob.oracleAddress).to.equal(deployment.signers.user3.address);
        });

        it("allows sender's custodian to view oracle binding", async function () {
            const { custodian1 } = deployment.signers;
            const ob = await deployment.facets.envelope
                .connect(custodian1)
                .getOracleBinding(oracleEnvelopeId);
            expect(ob.oracleAddress).to.not.equal(ethers.ZeroAddress);
        });

        it("reverts for unrelated third party with UnauthorizedViewer", async function () {
            const { minter } = deployment.signers;
            await expect(
                deployment.facets.envelope.connect(minter).getOracleBinding(oracleEnvelopeId)
            ).to.be.revertedWithCustomError(deployment.facets.envelope, "UnauthorizedViewer")
             .withArgs(minter.address);
        });
    });

    // =========================================================================
    // getSmartLockCondition (SmartLockEnvelopeFacet)
    // =========================================================================

    describe("getSmartLockCondition", function () {
        it("allows env.sender to view smart lock condition", async function () {
            const { user1 } = deployment.signers;
            const cond = await deployment.facets.smartLockEnvelope
                .connect(user1)
                .getSmartLockCondition(smartLockId);
            expect(cond.hashCommitment).to.not.equal(ethers.ZeroHash);
        });

        it("allows env.recipient to view smart lock condition", async function () {
            const { user2 } = deployment.signers;
            const cond = await deployment.facets.smartLockEnvelope
                .connect(user2)
                .getSmartLockCondition(smartLockId);
            expect(cond.hashCommitment).to.not.equal(ethers.ZeroHash);
        });

        it("allows sender's custodian to view smart lock condition", async function () {
            const { custodian1 } = deployment.signers;
            const cond = await deployment.facets.smartLockEnvelope
                .connect(custodian1)
                .getSmartLockCondition(smartLockId);
            expect(cond.hashCommitment).to.not.equal(ethers.ZeroHash);
        });

        it("allows recipient's custodian to view smart lock condition", async function () {
            const { custodian2 } = deployment.signers;
            const cond = await deployment.facets.smartLockEnvelope
                .connect(custodian2)
                .getSmartLockCondition(smartLockId);
            expect(cond.hashCommitment).to.not.equal(ethers.ZeroHash);
        });

        it("allows operator (COMPLIANCE_ROLE) to view smart lock condition", async function () {
            const { user3 } = deployment.signers;
            const cond = await deployment.facets.smartLockEnvelope
                .connect(user3)
                .getSmartLockCondition(smartLockId);
            expect(cond.hashCommitment).to.not.equal(ethers.ZeroHash);
        });

        it("reverts for unrelated third party with UnauthorizedViewer", async function () {
            const { minter } = deployment.signers;
            await expect(
                deployment.facets.smartLockEnvelope.connect(minter).getSmartLockCondition(smartLockId)
            ).to.be.revertedWithCustomError(deployment.facets.smartLockEnvelope, "UnauthorizedViewer")
             .withArgs(minter.address);
        });
    });

    // =========================================================================
    // getCustodian (CustodianRegistryFacet)
    // =========================================================================

    describe("getCustodian", function () {
        it("allows wallet itself to view its own custodian", async function () {
            const { user1 } = deployment.signers;
            const cust = await deployment.facets.custodian
                .connect(user1)
                .getCustodian(user1.address);
            expect(cust).to.equal(deployment.signers.custodian1.address);
        });

        it("allows registered custodian to view their ward's custodian record", async function () {
            const { custodian1, user1 } = deployment.signers;
            const cust = await deployment.facets.custodian
                .connect(custodian1)
                .getCustodian(user1.address);
            expect(cust).to.equal(custodian1.address);
        });

        it("allows operator (ADMIN_ROLE) to view any custodian record", async function () {
            const { admin, user1 } = deployment.signers;
            const cust = await deployment.facets.custodian
                .connect(admin)
                .getCustodian(user1.address);
            expect(cust).to.equal(deployment.signers.custodian1.address);
        });

        it("reverts for unrelated third party with UnauthorizedViewer", async function () {
            const { minter, user1 } = deployment.signers;
            await expect(
                deployment.facets.custodian.connect(minter).getCustodian(user1.address)
            ).to.be.revertedWithCustomError(deployment.facets.custodian, "UnauthorizedViewer")
             .withArgs(minter.address);
        });

        it("reverts for a different custodian (not user1's custodian) with UnauthorizedViewer", async function () {
            const { custodian2, user1 } = deployment.signers;
            await expect(
                deployment.facets.custodian.connect(custodian2).getCustodian(user1.address)
            ).to.be.revertedWithCustomError(deployment.facets.custodian, "UnauthorizedViewer")
             .withArgs(custodian2.address);
        });
    });

    // =========================================================================
    // getKYCTimestamps (CustodianRegistryFacet)
    // =========================================================================

    describe("getKYCTimestamps", function () {
        it("allows wallet itself to view its own KYC timestamps", async function () {
            const { user1 } = deployment.signers;
            const [validated, expiry] = await deployment.facets.custodian
                .connect(user1)
                .getKYCTimestamps(user1.address);
            expect(validated).to.be.greaterThan(0);
        });

        it("allows wallet's custodian to view KYC timestamps", async function () {
            const { custodian1, user1 } = deployment.signers;
            const [validated] = await deployment.facets.custodian
                .connect(custodian1)
                .getKYCTimestamps(user1.address);
            expect(validated).to.be.greaterThan(0);
        });

        it("allows operator (COMPLIANCE_ROLE) to view KYC timestamps", async function () {
            const { user3, user1 } = deployment.signers;
            const [validated] = await deployment.facets.custodian
                .connect(user3)
                .getKYCTimestamps(user1.address);
            expect(validated).to.be.greaterThan(0);
        });

        it("reverts for unrelated third party with UnauthorizedViewer", async function () {
            const { minter, user1 } = deployment.signers;
            await expect(
                deployment.facets.custodian.connect(minter).getKYCTimestamps(user1.address)
            ).to.be.revertedWithCustomError(deployment.facets.custodian, "UnauthorizedViewer")
             .withArgs(minter.address);
        });
    });

    // =========================================================================
    // isKYCValid (CustodianRegistryFacet)
    // =========================================================================

    describe("isKYCValid", function () {
        it("allows wallet itself to check its own KYC validity", async function () {
            const { user1 } = deployment.signers;
            const valid = await deployment.facets.custodian
                .connect(user1)
                .isKYCValid(user1.address);
            expect(typeof valid).to.equal("boolean");
        });

        it("allows wallet's custodian to check KYC validity", async function () {
            const { custodian1, user1 } = deployment.signers;
            const valid = await deployment.facets.custodian
                .connect(custodian1)
                .isKYCValid(user1.address);
            expect(typeof valid).to.equal("boolean");
        });

        it("allows operator (DEFAULT_ADMIN_ROLE / owner) to check KYC validity", async function () {
            const { owner, user1 } = deployment.signers;
            const valid = await deployment.facets.custodian
                .connect(owner)
                .isKYCValid(user1.address);
            expect(typeof valid).to.equal("boolean");
        });

    });

    // =========================================================================
    // Unregistered wallet edge case
    // =========================================================================

    describe("unregistered wallet access", function () {
        it("only wallet itself or operator can access unregistered wallet data", async function () {
            const { user3, admin, minter } = deployment.signers;
            // user3 is NOT registered (no custodian entry), we revoked COMPLIANCE_ROLE for this sub-test
            // Use pauser (no custodian, no operator role, not the wallet)
            const { pauser } = deployment.signers;

            // pauser queries user3's custodian — should fail (pauser is not user3 or its custodian or operator)
            await expect(
                deployment.facets.custodian.connect(pauser).getCustodian(user3.address)
            ).to.be.revertedWithCustomError(deployment.facets.custodian, "UnauthorizedViewer")
             .withArgs(pauser.address);

            // user3 itself can query its own (unregistered) wallet
            // Note: getCustodian for unregistered wallet returns zero address — but call succeeds
            const cust = await deployment.facets.custodian
                .connect(user3)
                .getCustodian(user3.address);
            expect(cust).to.equal(ethers.ZeroAddress);

            // Admin can query unregistered wallet
            const custAdmin = await deployment.facets.custodian
                .connect(admin)
                .getCustodian(user3.address);
            expect(custAdmin).to.equal(ethers.ZeroAddress);
        });
    });

    // =========================================================================
    // C-F10 — compliance screening + travel-rule views (crossfacet remediation)
    // =========================================================================

    describe("C-F10: wallet-scoped screening views", function () {
        it("allows the wallet itself, its custodian, and operators", async function () {
            const { user1, custodian1, admin, user3, owner } = deployment.signers;
            const scr = deployment.facets.complianceScreening;

            await scr.connect(user1).getScreening(user1.address);      // wallet itself
            await scr.connect(custodian1).getScreening(user1.address); // its custodian
            await scr.connect(admin).getScreening(user1.address);      // ADMIN_ROLE
            await scr.connect(user3).getScreening(user1.address);      // COMPLIANCE_ROLE
            await scr.connect(owner).getScreening(user1.address);      // DEFAULT_ADMIN_ROLE
        });

        it("reverts for an unrelated third party across all wallet-scoped screening views", async function () {
            const { minter, user1 } = deployment.signers;
            const scr = deployment.facets.complianceScreening;

            const calls = [
                scr.connect(minter).getScreening(user1.address),
                scr.connect(minter).getScopedScreening(ethers.ZeroHash, user1.address),
                scr.connect(minter).isWalletScopedInstitution(user1.address, ethers.ZeroHash),
                scr.connect(minter).isScreeningBlocked(user1.address),
                scr.connect(minter).isScreeningStale(user1.address),
                scr.connect(minter).getNetworkClearance(user1.address),
                scr.connect(minter).getResolvedScreening(user1.address),
                scr.connect(minter).getResolvedScopedScreening(ethers.ZeroHash, user1.address),
                scr.connect(minter).isResolvedScreeningBlocked(user1.address),
            ];
            for (const call of calls) {
                await expect(call)
                    .to.be.revertedWithCustomError(scr, "UnauthorizedViewer")
                    .withArgs(minter.address);
            }
        });

        it("resolved views: identity case readable by the wallet itself", async function () {
            const { user1 } = deployment.signers;
            const scr = deployment.facets.complianceScreening;

            const [resolved] = await scr.connect(user1).getResolvedScreening(user1.address);
            expect(resolved).to.equal(user1.address);
            expect(await scr.connect(user1).isResolvedScreeningBlocked(user1.address)).to.equal(false);
        });

        it("isInstitutionSanctionsEnabled stays public (deliberate C-F10 exception)", async function () {
            const { minter } = deployment.signers;
            expect(
                await deployment.facets.complianceScreening
                    .connect(minter)
                    .isInstitutionSanctionsEnabled(ethers.ZeroHash)
            ).to.equal(false);
        });
    });

    describe("C-F10: getTravelRule", function () {
        it("envelope-keyed: parties, custodians, and operators may read", async function () {
            const { user1, user2, user3, custodian1, custodian2, admin } = deployment.signers;
            const tr = deployment.facets.complianceTravelRule;

            await tr.connect(user1).getTravelRule(envelopeId);      // env.sender
            await tr.connect(user2).getTravelRule(envelopeId);      // env.recipient
            await tr.connect(custodian1).getTravelRule(envelopeId); // sender's custodian
            await tr.connect(custodian2).getTravelRule(envelopeId); // recipient's custodian
            await tr.connect(admin).getTravelRule(envelopeId);      // operator (ADMIN_ROLE)
            await tr.connect(user3).getTravelRule(envelopeId);      // operator (COMPLIANCE_ROLE)
        });

        it("envelope-keyed: unrelated third party is denied", async function () {
            const { minter } = deployment.signers;
            const tr = deployment.facets.complianceTravelRule;

            await expect(tr.connect(minter).getTravelRule(envelopeId))
                .to.be.revertedWithCustomError(tr, "UnauthorizedViewer")
                .withArgs(minter.address);
        });

        it("non-envelope ids (bearer notes / unknown) are operator-only, with no existence probing", async function () {
            const { owner, minter, user1 } = deployment.signers;
            const tr = deployment.facets.complianceTravelRule;
            const unknownId = ethers.id("no-such-envelope");

            const rule = await tr.connect(owner).getTravelRule(unknownId);
            expect(rule.ref).to.equal(ethers.ZeroHash);

            // Strangers get the same UnauthorizedViewer whether or not the id exists
            for (const caller of [minter, user1]) {
                await expect(tr.connect(caller).getTravelRule(unknownId))
                    .to.be.revertedWithCustomError(tr, "UnauthorizedViewer")
                    .withArgs(caller.address);
            }
        });
    });
});
