const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");
const { setupTestBalances } = require("../helpers/tokens");

const TRAVEL_RULE_ENFORCE_ACTIVE = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_enforce_active"));
const TRAVEL_RULE_THRESHOLD_USD = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_threshold_usd"));

function uint40(value) {
    return BigInt.asUintN(40, BigInt(value));
}

// C-F3 commitment object types (ComplianceTravelRuleLib.OBJ_*)
const OBJ_ENVELOPE = 1;
const OBJ_SMARTLOCK = 2;
const OBJ_CAMBIO_NOTE = 3;

async function stagingDeadline() {
    return uint40((await time.latest()) + 3600);
}

describe("ComplianceTravelRuleFacet (Wave 8D/8E-1)", function () {
    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        await setupTestBalances(deployment.facets, deployment.signers);
        const { diamondAddress } = deployment;
        const { user1, user2 } = deployment.signers;
        await deployment.facets.erc20.connect(user1).approve(diamondAddress, ethers.parseEther("10000"));
        await deployment.facets.erc20.connect(user2).approve(diamondAddress, ethers.parseEther("10000"));
        return deployment;
    }

    describe("setPendingTravelRule (C-F3 commitment schema)", function () {
        it("reverts when ref is zero", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const deadline = await stagingDeadline();
            await expect(
                facets.complianceTravelRule.connect(signers.user1)
                    .setPendingTravelRule(ethers.ZeroHash, signers.user2.address, 1n, OBJ_ENVELOPE, deadline)
            ).to.be.revertedWithCustomError(facets.complianceTravelRule, "InvalidRef");
        });

        it("reverts on unknown objectType and past deadline", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-validation"));
            const deadline = await stagingDeadline();

            await expect(
                facets.complianceTravelRule.connect(signers.user1)
                    .setPendingTravelRule(ref, signers.user2.address, 1n, 0, deadline)
            ).to.be.revertedWithCustomError(facets.complianceTravelRule, "InvalidObjectType").withArgs(0);
            await expect(
                facets.complianceTravelRule.connect(signers.user1)
                    .setPendingTravelRule(ref, signers.user2.address, 1n, OBJ_CAMBIO_NOTE + 1, deadline)
            ).to.be.revertedWithCustomError(facets.complianceTravelRule, "InvalidObjectType").withArgs(OBJ_CAMBIO_NOTE + 1);

            const past = uint40(await time.latest());
            await expect(
                facets.complianceTravelRule.connect(signers.user1)
                    .setPendingTravelRule(ref, signers.user2.address, 1n, OBJ_ENVELOPE, past)
            ).to.be.revertedWithCustomError(facets.complianceTravelRule, "DeadlineInPast").withArgs(past);
        });

        it("stores the full commitment and emits PendingTravelRuleSet", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const ref = ethers.keccak256(ethers.toUtf8Bytes("travel-rule-ref-1"));
            const amount = ethers.parseEther("2");
            const deadline = await stagingDeadline();

            await expect(
                facets.complianceTravelRule.connect(signers.user1)
                    .setPendingTravelRule(ref, signers.user2.address, amount, OBJ_ENVELOPE, deadline)
            )
                .to.emit(facets.complianceTravelRule, "PendingTravelRuleSet")
                .withArgs(signers.user1.address, ref, signers.user2.address, amount, OBJ_ENVELOPE, deadline);

            const pending = await facets.complianceTravelRule.getPendingTravelRule(signers.user1.address);
            expect(pending.ref).to.equal(ref);
            expect(pending.recipient).to.equal(signers.user2.address);
            expect(pending.amount).to.equal(amount);
            expect(pending.objectType).to.equal(OBJ_ENVELOPE);
            expect(pending.deadline).to.equal(deadline);
        });

        it("overwrites an existing pending commitment", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const ref1 = ethers.keccak256(ethers.toUtf8Bytes("ref-1"));
            const ref2 = ethers.keccak256(ethers.toUtf8Bytes("ref-2"));
            const deadline = await stagingDeadline();

            await facets.complianceTravelRule.connect(signers.user1)
                .setPendingTravelRule(ref1, signers.user2.address, 1n, OBJ_ENVELOPE, deadline);
            await facets.complianceTravelRule.connect(signers.user1)
                .setPendingTravelRule(ref2, signers.user2.address, 2n, OBJ_SMARTLOCK, deadline);

            const pending = await facets.complianceTravelRule.getPendingTravelRule(signers.user1.address);
            expect(pending.ref).to.equal(ref2);
            expect(pending.amount).to.equal(2n);
            expect(pending.objectType).to.equal(OBJ_SMARTLOCK);
        });

        it("kimi-verify LOW: staging and clearing are quarantined while the sender is in active recovery", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;
            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-quarantine"));
            const deadline = await stagingDeadline();

            await grantRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, user1.address, owner);
            await facets.walletRecovery.connect(owner).initiateRecovery(user1.address, 0);

            await expect(
                facets.complianceTravelRule.connect(user1)
                    .setPendingTravelRule(ref, user2.address, 1n, OBJ_ENVELOPE, deadline)
            ).to.be.revertedWithCustomError(facets.complianceTravelRule, "WalletInRecovery")
                .withArgs(user1.address);
            await expect(
                facets.complianceTravelRule.connect(user1).clearPendingTravelRule()
            ).to.be.revertedWithCustomError(facets.complianceTravelRule, "WalletInRecovery")
                .withArgs(user1.address);
        });
    });

    describe("clearPendingTravelRule", function () {
        it("deletes pending commitment and emits PendingTravelRuleCleared", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-1"));
            const deadline = await stagingDeadline();

            await facets.complianceTravelRule.connect(signers.user1)
                .setPendingTravelRule(ref, signers.user2.address, 1n, OBJ_ENVELOPE, deadline);
            await expect(facets.complianceTravelRule.connect(signers.user1).clearPendingTravelRule())
                .to.emit(facets.complianceTravelRule, "PendingTravelRuleCleared")
                .withArgs(signers.user1.address);

            const pending = await facets.complianceTravelRule.getPendingTravelRule(signers.user1.address);
            expect(pending.ref).to.equal(ethers.ZeroHash);
            expect(pending.deadline).to.equal(0);
        });
    });

    describe("scoped Travel Rule enforcement", function () {
        it("gate OFF = create succeeds regardless of pending ref", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { user1, user2 } = signers;

            expect(await facets.complianceConfig.isTravelRuleEnforceActive()).to.equal(false);

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            await expect(
                facets.envelope.connect(user1).createEnvelope(
                    user2.address,
                    ethers.parseEther("10"),
                    commitWindowEnd,
                    0,
                    0,
                    "0x"
                )
            ).not.to.be.reverted;
        });

        it("gate ON without pending ref reverts TravelRuleRequired for amount >= threshold", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;
            const threshold = ethers.parseEther("1");
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            await expect(
                facets.envelope.connect(user1).createEnvelope(
                    user2.address,
                    threshold,
                    commitWindowEnd,
                    0,
                    0,
                    "0x"
                )
            )
                .to.be.revertedWithCustomError(facets.envelope, "TravelRuleRequired")
                .withArgs(user1.address, threshold, threshold);
        });

        it("gate ON with pending ref binds ref to envelope and emits TravelRuleAttached", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            const ref = ethers.keccak256(ethers.toUtf8Bytes("travel-rule-ref-ok"));
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);
            await facets.complianceTravelRule.connect(user1)
                .setPendingTravelRule(ref, user2.address, threshold, OBJ_ENVELOPE, await stagingDeadline());

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            const tx = await facets.envelope.connect(user1).createEnvelope(
                user2.address,
                threshold,
                commitWindowEnd,
                0,
                0,
                "0x"
            );
            const envelopeIds = await facets.envelope.getEnvelopesBySender(user1.address);
            const envelopeId = envelopeIds[envelopeIds.length - 1];

            const receipt = await tx.wait();
            const parsed = receipt.logs
                .map((l) => { try { return facets.envelope.interface.parseLog(l); } catch { return null; } })
                .filter(Boolean)
                .find((l) => l.name === "TravelRuleAttached");

            expect(parsed).to.not.be.undefined;
            expect(parsed.args.envelopeId).to.equal(envelopeId);
            expect(parsed.args.sender).to.equal(user1.address);
            expect(parsed.args.ref).to.equal(ref);

            const rule = await facets.complianceTravelRule.getTravelRule(envelopeId);
            expect(rule.ref).to.equal(ref);
            expect(rule.satisfied).to.equal(true);
            expect(rule.attachedAt).to.be.gt(0);

            expect((await facets.complianceTravelRule.getPendingTravelRule(user1.address)).ref).to.equal(ethers.ZeroHash);
        });

        it("C-F3 mismatch matrix: a ref staged for transfer A cannot bind transfer B", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, user3 } = signers;

            const threshold = ethers.parseEther("1");
            const amount = ethers.parseEther("2");
            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-committed"));
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            const stage = async (recipient, amt, objectType) =>
                facets.complianceTravelRule.connect(user1)
                    .setPendingTravelRule(ref, recipient, amt, objectType, await stagingDeadline());

            // recipient mismatch: staged for user3, transfer goes to user2
            await stage(user3.address, amount, OBJ_ENVELOPE);
            await expect(
                facets.envelope.connect(user1).createEnvelope(user2.address, amount, commitWindowEnd, 0, 0, "0x")
            ).to.be.revertedWithCustomError(facets.envelope, "TravelRuleCommitmentMismatch")
                .withArgs(user1.address, ref);

            // amount mismatch: staged for amount+1
            await stage(user2.address, amount + 1n, OBJ_ENVELOPE);
            await expect(
                facets.envelope.connect(user1).createEnvelope(user2.address, amount, commitWindowEnd, 0, 0, "0x")
            ).to.be.revertedWithCustomError(facets.envelope, "TravelRuleCommitmentMismatch")
                .withArgs(user1.address, ref);

            // objectType mismatch: staged for a smartlock, bound to a plain envelope
            await stage(user2.address, amount, OBJ_SMARTLOCK);
            await expect(
                facets.envelope.connect(user1).createEnvelope(user2.address, amount, commitWindowEnd, 0, 0, "0x")
            ).to.be.revertedWithCustomError(facets.envelope, "TravelRuleCommitmentMismatch")
                .withArgs(user1.address, ref);

            // exact commitment binds
            await stage(user2.address, amount, OBJ_ENVELOPE);
            await expect(
                facets.envelope.connect(user1).createEnvelope(user2.address, amount, commitWindowEnd, 0, 0, "0x")
            ).not.to.be.reverted;
        });

        it("C-F3 expiry: an expired staged ref reverts TravelRuleRefExpired (fail-closed)", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-expiring"));
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            const deadline = uint40((await time.latest()) + 600);
            await facets.complianceTravelRule.connect(user1)
                .setPendingTravelRule(ref, user2.address, threshold, OBJ_ENVELOPE, deadline);
            await time.increase(601);

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            await expect(
                facets.envelope.connect(user1).createEnvelope(user2.address, threshold, commitWindowEnd, 0, 0, "0x")
            ).to.be.revertedWithCustomError(facets.envelope, "TravelRuleRefExpired")
                .withArgs(user1.address, ref, deadline);
        });

        it("C-F3 boundary: bind at block.timestamp == deadline succeeds (expiry is strictly after)", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-at-deadline"));
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            const deadline = uint40((await time.latest()) + 100);
            await facets.complianceTravelRule.connect(user1)
                .setPendingTravelRule(ref, user2.address, threshold, OBJ_ENVELOPE, deadline);

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            await time.setNextBlockTimestamp(deadline);
            await expect(
                facets.envelope.connect(user1).createEnvelope(user2.address, threshold, commitWindowEnd, 0, 0, "0x")
            ).not.to.be.reverted;
        });

        it("C-F3 expired commitment can be overwritten by a fresh staging", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            const staleRef = ethers.keccak256(ethers.toUtf8Bytes("ref-stale"));
            const freshRef = ethers.keccak256(ethers.toUtf8Bytes("ref-fresh"));
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            await facets.complianceTravelRule.connect(user1)
                .setPendingTravelRule(staleRef, user2.address, threshold, OBJ_ENVELOPE, uint40((await time.latest()) + 600));
            await time.increase(601);
            await facets.complianceTravelRule.connect(user1)
                .setPendingTravelRule(freshRef, user2.address, threshold, OBJ_ENVELOPE, await stagingDeadline());

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            await facets.envelope.connect(user1).createEnvelope(user2.address, threshold, commitWindowEnd, 0, 0, "0x");
            const envelopeIds = await facets.envelope.getEnvelopesBySender(user1.address);
            const rule = await facets.complianceTravelRule.getTravelRule(envelopeIds[envelopeIds.length - 1]);
            expect(rule.ref).to.equal(freshRef);
        });

        it("C-F3 single-use: a consumed ref cannot satisfy a second identical transfer", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-once"));
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);
            await facets.complianceTravelRule.connect(user1)
                .setPendingTravelRule(ref, user2.address, threshold, OBJ_ENVELOPE, await stagingDeadline());

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            await expect(
                facets.envelope.connect(user1).createEnvelope(user2.address, threshold, commitWindowEnd, 0, 0, "0x")
            ).not.to.be.reverted;
            // identical second transfer: the ref was consumed at bind
            await expect(
                facets.envelope.connect(user1).createEnvelope(user2.address, threshold, commitWindowEnd, 0, 0, "0x")
            ).to.be.revertedWithCustomError(facets.envelope, "TravelRuleRequired")
                .withArgs(user1.address, threshold, threshold);
        });

        it("C-F5 boundary: amount == threshold - 1 wei passes; amount == threshold triggers (18-dec raw compare)", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("400"); // 400e18 token units (user1 holds 1000e18)
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            // threshold − 1 wei: below → no ref required
            await expect(
                facets.envelope.connect(user1).createEnvelope(
                    user2.address, threshold - 1n, commitWindowEnd, 0, 0, "0x"
                )
            ).not.to.be.reverted;
            // exactly threshold: at/above → ref required
            await expect(
                facets.envelope.connect(user1).createEnvelope(
                    user2.address, threshold, commitWindowEnd, 0, 0, "0x"
                )
            )
                .to.be.revertedWithCustomError(facets.envelope, "TravelRuleRequired")
                .withArgs(user1.address, threshold, threshold);
        });

        it("C-F5 default magnitude: explicit 1_000_000e18 threshold gates a 1M-token transfer, not dust", async function () {
            const { facets, signers, diamondAddress } = await loadFixture(setupFixture);
            const { owner, user2, custodian1 } = signers;

            // initializeDefaultPolicies intentionally does NOT seed the travel-rule
            // threshold — arming requires an explicit threshold (fail-closed at 0).
            await facets.institutionPolicy.connect(owner).initializeDefaultPolicies();
            expect(await facets.institutionPolicy.getNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD)).to.equal(0);

            const threshold = ethers.parseEther("1000000"); // same magnitude as DEFAULT_THRESHOLD_18DEC
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            await facets.erc20.connect(custodian1).approve(diamondAddress, ethers.parseEther("2000000"));
            const commitWindowEnd = uint40((await time.latest()) + 3600);
            // 1M − 1 wei: below the 18-dec threshold → no ref required (pre-fix 6-dec
            // seeding made everything above 1e-6 tokens require a ref)
            await expect(
                facets.envelope.connect(custodian1).createEnvelope(
                    user2.address, threshold - 1n, commitWindowEnd, 0, 0, "0x"
                )
            ).not.to.be.reverted;
            await expect(
                facets.envelope.connect(custodian1).createEnvelope(
                    user2.address, threshold, commitWindowEnd, 0, 0, "0x"
                )
            )
                .to.be.revertedWithCustomError(facets.envelope, "TravelRuleRequired")
                .withArgs(custodian1.address, threshold, threshold);
        });

        it("C-F3 recovery interaction: sender in recovery cannot create even with a valid commitment", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-sender-recovery"));
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);
            await facets.complianceTravelRule.connect(user1)
                .setPendingTravelRule(ref, user2.address, threshold, OBJ_ENVELOPE, await stagingDeadline());

            await grantRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, user1.address, owner);
            await facets.walletRecovery.connect(owner).initiateRecovery(user1.address, 0);

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            await expect(
                facets.envelope.connect(user1).createEnvelope(user2.address, threshold, commitWindowEnd, 0, 0, "0x")
            ).to.be.revertedWithCustomError(facets.envelope, "WalletInRecovery")
                .withArgs(user1.address);
            // the staged commitment is untouched by the quarantine revert
            expect((await facets.complianceTravelRule.getPendingTravelRule(user1.address)).ref).to.equal(ref);
        });

        it("C-F3 recovery interaction: recipient entering recovery does not break the commitment match", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-recipient-recovery"));
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);
            await facets.complianceTravelRule.connect(user1)
                .setPendingTravelRule(ref, user2.address, threshold, OBJ_ENVELOPE, await stagingDeadline());

            // Recipient enters recovery between staging and create; the create still
            // targets the ORIGINAL recipient (payee resolution happens at release),
            // so the commitment matches and binds.
            await grantRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, user2.address, owner);
            await facets.walletRecovery.connect(owner).initiateRecovery(user2.address, 0);

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            await facets.envelope.connect(user1).createEnvelope(user2.address, threshold, commitWindowEnd, 0, 0, "0x");
            const envelopeIds = await facets.envelope.getEnvelopesBySender(user1.address);
            const rule = await facets.complianceTravelRule.getTravelRule(envelopeIds[envelopeIds.length - 1]);
            expect(rule.ref).to.equal(ref);
            expect(rule.satisfied).to.equal(true);
        });

        it("wave-panel MED-1: arming + threshold reads resolve the recovery payee after a completed recovery", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, minter, user1, user2, custodian1 } = signers;
            const threshold = ethers.parseEther("100");

            // Wallet-scoped arming + threshold on user1 ONLY (no network policy) —
            // after migration a raw read of user1 would be unarmed (the evasion
            // the wave panel flagged).
            await facets.institutionPolicy.connect(owner).setWalletPolicy(user1.address, TRAVEL_RULE_ENFORCE_ACTIVE, 1);
            await facets.institutionPolicy.connect(owner).setWalletPolicy(user1.address, TRAVEL_RULE_THRESHOLD_USD, threshold);

            // Complete recovery user1 -> custodian1: policies migrate at designation,
            // recoverySuccessor[user1] = custodian1 persists after completion.
            await grantRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, user1.address, owner);
            const expires = (await time.latest()) + 365 * 24 * 3600;
            // Successor eligibility: registered custodian (registry set) + valid KYC.
            await facets.custodian.connect(owner).grantCustodianRole(custodian1.address);
            await facets.custodian.connect(custodian1).registerCustodiedWallet(custodian1.address, 1, expires);
            const tx = await facets.walletRecovery.connect(owner).initiateRecovery(user1.address, 0);
            const rc = await tx.wait();
            const recoveryId = rc.logs
                .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
                .filter(Boolean).find(l => l.name === "RecoveryInitiated").args.recoveryId;
            await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, custodian1.address);
            await facets.walletRecovery.connect(owner).migrateBalance(recoveryId, []);
            await facets.walletRecovery.connect(owner).completeRecovery(recoveryId, []);

            // Sanity: the wallet-scoped policies genuinely left user1.
            const [, rawSet] = await facets.institutionPolicy.getWalletPolicyValue(user1.address, TRAVEL_RULE_ENFORCE_ACTIVE);
            expect(rawSet).to.equal(false);

            // user1 receives fresh funds post-recovery and tries to create above
            // threshold WITHOUT a staged ref: the recovery-resolving reads see the
            // successor's migrated arming + threshold and fail closed. withArgs pins
            // the resolved threshold (an unresolved threshold read would report 0).
            await facets.mintBurn.connect(minter).mint(user1.address, threshold);
            const commitWindowEnd = uint40((await time.latest()) + 3600);
            await expect(
                facets.envelope.connect(user1).createEnvelope(user2.address, threshold, commitWindowEnd, 0, 0, "0x")
            ).to.be.revertedWithCustomError(facets.envelope, "TravelRuleRequired")
                .withArgs(user1.address, threshold, threshold);

            // The pending lookup stays raw-keyed: user1 stages its OWN commitment
            // and the create binds.
            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-post-recovery"));
            await facets.complianceTravelRule.connect(user1)
                .setPendingTravelRule(ref, user2.address, threshold, OBJ_ENVELOPE, await stagingDeadline());
            await facets.envelope.connect(user1).createEnvelope(user2.address, threshold, commitWindowEnd, 0, 0, "0x");
            const envIds = await facets.envelope.getEnvelopesBySender(user1.address);
            const bound = await facets.complianceTravelRule.getTravelRule(envIds[envIds.length - 1]);
            expect(bound.ref).to.equal(ref);
            expect(bound.satisfied).to.equal(true);
        });

        it("kimi-verify NOTE-3: a migrated pending commitment binds a successor-created transfer", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, minter, user1, user2, custodian1 } = signers;
            const threshold = ethers.parseEther("100");

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            // Predecessor stages the commitment BEFORE recovery (staging is
            // quarantined during an active recovery).
            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-migrates-to-successor"));
            await facets.complianceTravelRule.connect(user1)
                .setPendingTravelRule(ref, user2.address, threshold, OBJ_ENVELOPE, await stagingDeadline());

            // Complete recovery user1 -> custodian1: designation moves
            // pending[user1] -> pending[custodian1] (empty destination).
            await grantRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, user1.address, owner);
            const expires = (await time.latest()) + 365 * 24 * 3600;
            await facets.custodian.connect(owner).grantCustodianRole(custodian1.address);
            await facets.custodian.connect(custodian1).registerCustodiedWallet(custodian1.address, 1, expires);
            const tx = await facets.walletRecovery.connect(owner).initiateRecovery(user1.address, 0);
            const rc = await tx.wait();
            const recoveryId = rc.logs
                .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
                .filter(Boolean).find(l => l.name === "RecoveryInitiated").args.recoveryId;
            await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, custodian1.address);
            await facets.walletRecovery.connect(owner).migrateBalance(recoveryId, []);
            await facets.walletRecovery.connect(owner).completeRecovery(recoveryId, []);

            // Move semantics: predecessor slot empty, successor carries the commitment.
            expect((await facets.complianceTravelRule.connect(owner).getPendingTravelRule(user1.address)).ref)
                .to.equal(ethers.ZeroHash);
            expect((await facets.complianceTravelRule.connect(owner).getPendingTravelRule(custodian1.address)).ref)
                .to.equal(ref);

            // The successor creates the exact committed transfer: the raw-keyed
            // lookup on the successor (the actual tx creator) finds the migrated
            // commitment and binds it.
            await facets.mintBurn.connect(minter).mint(custodian1.address, threshold);
            const commitWindowEnd = uint40((await time.latest()) + 3600);
            await facets.envelope.connect(custodian1).createEnvelope(user2.address, threshold, commitWindowEnd, 0, 0, "0x");
            const envIds2 = await facets.envelope.getEnvelopesBySender(custodian1.address);
            const bound2 = await facets.complianceTravelRule.getTravelRule(envIds2[envIds2.length - 1]);
            expect(bound2.ref).to.equal(ref);
            expect(bound2.satisfied).to.equal(true);

            // Single-use: the migrated commitment is consumed by the bind.
            expect((await facets.complianceTravelRule.connect(owner).getPendingTravelRule(custodian1.address)).ref)
                .to.equal(ethers.ZeroHash);
        });

        it("getPendingTravelRule ACL: only the sender or DEFAULT_ADMIN can read a staged commitment", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, user3 } = signers;

            const ref = ethers.keccak256(ethers.toUtf8Bytes("ref-acl"));
            await facets.complianceTravelRule.connect(user1)
                .setPendingTravelRule(ref, user2.address, 1n, OBJ_ENVELOPE, await stagingDeadline());

            await expect(
                facets.complianceTravelRule.connect(user3).getPendingTravelRule(user1.address)
            ).to.be.reverted; // AccessControlLib.checkRole
            expect((await facets.complianceTravelRule.connect(user1).getPendingTravelRule(user1.address)).ref)
                .to.equal(ref);
            expect((await facets.complianceTravelRule.connect(owner).getPendingTravelRule(user1.address)).ref)
                .to.equal(ref);
        });

        it("gate ON with amount < threshold succeeds without pending ref", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("10");
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            const commitWindowEnd = uint40((await time.latest()) + 3600);
            await expect(
                facets.envelope.connect(user1).createEnvelope(
                    user2.address,
                    ethers.parseEther("1"),
                    commitWindowEnd,
                    0,
                    0,
                    "0x"
                )
            ).not.to.be.reverted;
        });
    });

    describe("getTravelRule", function () {
        it("returns default struct for unknown envelope", async function () {
            const { facets } = await loadFixture(setupFixture);
            const rule = await facets.complianceTravelRule.getTravelRule(ethers.ZeroHash);
            expect(rule.ref).to.equal(ethers.ZeroHash);
            expect(rule.satisfied).to.equal(false);
            expect(rule.attachedAt).to.equal(0);
        });
    });

    // K-F12 (Task 7.3): staging is _msgSender-aligned — a relayed call must bind
    // the pending commitment to the appended original sender, not the forwarder.
    describe("ERC-2771 forwarder path (K-F12)", function () {
        function buildForwarderCalldata(contractInterface, functionName, args, senderAddress) {
            const encoded = contractInterface.encodeFunctionData(functionName, args);
            return encoded + senderAddress.slice(2).toLowerCase();
        }

        it("setPendingTravelRule via trusted forwarder binds to the appended sender", async function () {
            const { facets, signers, diamondAddress } = await loadFixture(setupFixture);
            const { owner, user1, user2, user3 } = signers;
            const erc2771 = await ethers.getContractAt("ERC2771ContextFacet", diamondAddress);
            await erc2771.connect(owner).setTrustedForwarder(user3.address);

            const ref = ethers.keccak256(ethers.toUtf8Bytes("forwarded-ref"));
            const deadline = await stagingDeadline();
            const calldata = buildForwarderCalldata(
                facets.complianceTravelRule.interface,
                "setPendingTravelRule",
                [ref, user2.address, 1n, OBJ_ENVELOPE, deadline],
                user1.address
            );

            await expect(user3.sendTransaction({ to: diamondAddress, data: calldata }))
                .to.emit(facets.complianceTravelRule, "PendingTravelRuleSet")
                .withArgs(user1.address, ref, user2.address, 1n, OBJ_ENVELOPE, deadline);

            const pendingUser1 = await facets.complianceTravelRule.getPendingTravelRule(user1.address);
            expect(pendingUser1.ref).to.equal(ref);
            const pendingForwarder = await facets.complianceTravelRule.getPendingTravelRule(user3.address);
            expect(pendingForwarder.ref).to.equal(ethers.ZeroHash);
        });

        it("appended sender is ignored when the caller is not the trusted forwarder", async function () {
            const { facets, signers, diamondAddress } = await loadFixture(setupFixture);
            const { owner, user1, user2, user3 } = signers;
            const erc2771 = await ethers.getContractAt("ERC2771ContextFacet", diamondAddress);
            await erc2771.connect(owner).setTrustedForwarder(user3.address);

            const ref = ethers.keccak256(ethers.toUtf8Bytes("spoofed-ref"));
            const deadline = await stagingDeadline();
            const calldata = buildForwarderCalldata(
                facets.complianceTravelRule.interface,
                "setPendingTravelRule",
                [ref, user2.address, 1n, OBJ_ENVELOPE, deadline],
                user1.address
            );

            // user2 is NOT the forwarder: the appended user1 suffix must be ignored
            // and the commitment binds to msg.sender (user2).
            await user2.sendTransaction({ to: diamondAddress, data: calldata });

            expect((await facets.complianceTravelRule.getPendingTravelRule(user1.address)).ref)
                .to.equal(ethers.ZeroHash);
            expect((await facets.complianceTravelRule.getPendingTravelRule(user2.address)).ref)
                .to.equal(ref);
        });
    });
});
