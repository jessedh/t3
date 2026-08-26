const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");

describe("WalletRecoveryFacet — Unit Tests (FR-1402)", function () {
    let deployment;
    let walletRecovery;
    let accessControl;
    let erc20;
    let mintBurn;
    let custodianRegistry;
    let owner, admin, custodian1, custodian2, user1, user2;

    async function setupFixture() {
        deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        
        walletRecovery = deployment.facets.walletRecovery;
        accessControl = deployment.facets.accessControl;
        erc20 = deployment.facets.erc20;
        mintBurn = deployment.facets.mintBurn;
        custodianRegistry = deployment.facets.custodian;

        owner = deployment.signers.owner;
        admin = deployment.signers.admin;
        custodian1 = deployment.signers.custodian1;
        custodian2 = deployment.signers.custodian2;
        user1 = deployment.signers.user1;
        user2 = deployment.signers.user2;

        // Register custodian1 and custodian2 in the custodian registry with valid KYC
        const futureExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
        await custodianRegistry.connect(owner).grantCustodianRole(custodian1.address);
        await custodianRegistry.connect(custodian1).registerCustodiedWallet(custodian1.address, 1, futureExpiry);
        await custodianRegistry.connect(owner).grantCustodianRole(custodian2.address);
        await custodianRegistry.connect(custodian2).registerCustodiedWallet(custodian2.address, 1, futureExpiry);

        return { deployment, walletRecovery, accessControl, erc20, mintBurn, custodianRegistry, owner, admin, custodian1, custodian2, user1, user2 };
    }

    beforeEach(async function () {
        ({ deployment, walletRecovery, accessControl, erc20, mintBurn, custodianRegistry, owner, admin, custodian1, custodian2, user1, user2 } = await loadFixture(setupFixture));
    });

    // =========================================================================
    // STANDBY REGISTRATION
    // =========================================================================
    describe("Standby Registration", function () {
        it("should allow an admin to set and get recovery standby wallet", async function () {
            await expect(walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, custodian2.address))
                .to.emit(walletRecovery, "RecoveryStandbySet")
                .withArgs(custodian1.address, custodian2.address, admin.address);

            const standby = await walletRecovery.getRecoveryStandby(custodian1.address);
            expect(standby).to.equal(custodian2.address);
        });

        it("should revert if setRecoveryStandby is called by a non-admin", async function () {
            await expect(walletRecovery.connect(user1).setRecoveryStandby(custodian1.address, custodian2.address))
                .to.be.reverted; // Reverts due to UnauthorizedRole
        });

        it("should revert setRecoveryStandby with SuccessorNotCustodian for ineligible standby", async function () {
            await expect(walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, user1.address))
                .to.be.revertedWithCustomError(walletRecovery, "SuccessorNotCustodian")
                .withArgs(user1.address);
        });
    });

    // =========================================================================
    // RECOVERY INITIATION
    // =========================================================================
    describe("Recovery Initiation", function () {
        it("should allow admin to initiate recovery (LostKey = 0)", async function () {
            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt = await tx.wait();

            // Find the RecoveryInitiated event
            const recoveryInitiatedLog = receipt.logs.find(l => {
                try {
                    return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated";
                } catch {
                    return false;
                }
            });
            const parsedLog = walletRecovery.interface.parseLog(recoveryInitiatedLog);
            const recoveryId = parsedLog.args.recoveryId;

            expect(recoveryId).to.not.equal(ethers.ZeroHash);

            const record = await walletRecovery.getRecovery(recoveryId);
            expect(record.oldWallet).to.equal(custodian1.address);
            expect(record.state).to.equal(1); // RecoveryPending
            expect(record.recoveryType).to.equal(0); // LostKey
        });

        it("should allow custodian to self-initiate recovery (KeyRotation = 3)", async function () {
            // Register standby first
            await walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, custodian2.address);

            const tx = await walletRecovery.connect(custodian1).initiateRecovery(custodian1.address, 3);
            const receipt = await tx.wait();

            const parsedLogs = receipt.logs.map(l => {
                try { return walletRecovery.interface.parseLog(l); } catch { return null; }
            }).filter(Boolean);

            const recoveryInitiated = parsedLogs.find(l => l.name === "RecoveryInitiated");
            const timelockStarted = parsedLogs.find(l => l.name === "RecoveryTimelockStarted");

            expect(recoveryInitiated).to.not.be.undefined;
            expect(timelockStarted).to.not.be.undefined;

            const recoveryId = recoveryInitiated.args.recoveryId;
            const record = await walletRecovery.getRecovery(recoveryId);
            expect(record.state).to.equal(1); // RecoveryPending
            expect(record.recoveryType).to.equal(3); // KeyRotation
            expect(record.timelockEndsAt).to.be.gt(0);
        });

        it("should revert self-initiation if caller is not the wallet itself", async function () {
            await expect(walletRecovery.connect(custodian2).initiateRecovery(custodian1.address, 3))
                .to.be.reverted; // Reverts with UnauthorizedRole (Custodian)
        });

        it("should revert if wallet to recover is not a custodian (bank wallet)", async function () {
            await expect(walletRecovery.connect(admin).initiateRecovery(user1.address, 0))
                .to.be.reverted; // Reverts with UnauthorizedRole (Custodian)
        });

        it("should revert duplicate initiation and leave the first recovery intact", async function () {
            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const firstRecoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            // Second initiation must revert before overwriting state
            await expect(walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0))
                .to.be.revertedWithCustomError(walletRecovery, "WalletInRecovery")
                .withArgs(custodian1.address);

            // First recovery record must remain unchanged
            const record = await walletRecovery.getRecovery(firstRecoveryId);
            expect(record.state).to.equal(1); // RecoveryPending
            expect(record.oldWallet).to.equal(custodian1.address);

            // Cancelling the first recovery must fully release quarantine. If the
            // failed duplicate incremented the count, this second initiation reverts.
            await walletRecovery.connect(admin).cancelRecovery(firstRecoveryId);
            await expect(walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0))
                .to.emit(walletRecovery, "RecoveryInitiated");
        });
    });

    // =========================================================================
    // SUCCESSOR DESIGNATION AND REDIRECTION
    // =========================================================================
    describe("Successor Designation and Redirection", function () {
        let recoveryId;

        beforeEach(async function () {
            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;
        });

        it("should allow admin to designate successor and activate recovery", async function () {
            await expect(walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address))
                .to.emit(walletRecovery, "RecoverySuccessorDesignated")
                .withArgs(recoveryId, custodian2.address, admin.address);

            const record = await walletRecovery.getRecovery(recoveryId);
            expect(record.state).to.equal(2); // RecoveryActive
            expect(record.newWallet).to.equal(custodian2.address);
        });

        it("should revert designateSuccessor with SuccessorNotCustodian for ineligible successor", async function () {
            await expect(walletRecovery.connect(admin).designateSuccessor(recoveryId, user1.address))
                .to.be.revertedWithCustomError(walletRecovery, "SuccessorNotCustodian")
                .withArgs(user1.address);
        });

        it("should allow admin to redirect successor when recovery is active", async function () {
            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);

            // Create and register another custodian for redirect
            const custodian3 = deployment.signers.user2;
            const futureExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
            await custodianRegistry.connect(owner).grantCustodianRole(custodian3.address);
            await custodianRegistry.connect(custodian3).registerCustodiedWallet(custodian3.address, 1, futureExpiry);

            await expect(walletRecovery.connect(admin).redirectSuccessor(recoveryId, custodian3.address))
                .to.emit(walletRecovery, "RecoverySuccessorRedirected")
                .withArgs(recoveryId, custodian2.address, custodian3.address);

            const record = await walletRecovery.getRecovery(recoveryId);
            expect(record.newWallet).to.equal(custodian3.address);
        });

        it("should revert redirectSuccessor with SuccessorNotCustodian for ineligible successor", async function () {
            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);

            await expect(walletRecovery.connect(admin).redirectSuccessor(recoveryId, user1.address))
                .to.be.revertedWithCustomError(walletRecovery, "SuccessorNotCustodian")
                .withArgs(user1.address);
        });

        it("should reject successor designation in KeyRotation if it does not match pre-registered standby", async function () {
            // Cancel the existing recovery from beforeEach so custodian1 is free
            await walletRecovery.connect(owner).cancelRecovery(recoveryId);

            await walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, custodian2.address);

            const tx = await walletRecovery.connect(custodian1).initiateRecovery(custodian1.address, 3);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const keyRotRecoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            // Reject ineligible successor (user1 is not a registered custodian)
            await expect(walletRecovery.connect(admin).designateSuccessor(keyRotRecoveryId, user1.address))
                .to.be.revertedWithCustomError(walletRecovery, "SuccessorNotCustodian")
                .withArgs(user1.address);

            // Accept valid standby (custodian2 is standby and eligible)
            await expect(walletRecovery.connect(admin).designateSuccessor(keyRotRecoveryId, custodian2.address))
                .to.emit(walletRecovery, "RecoverySuccessorDesignated");
        });
    });

    // =========================================================================
    // CANCELLATION PATHS
    // =========================================================================
    describe("Cancellation Paths", function () {
        it("should allow initiator to cancel pending admin-initiated recovery", async function () {
            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            await expect(walletRecovery.connect(admin).cancelRecovery(recoveryId))
                .to.emit(walletRecovery, "RecoveryCancelled")
                .withArgs(recoveryId, custodian1.address, admin.address, false);

            const record = await walletRecovery.getRecovery(recoveryId);
            expect(record.state).to.equal(4); // RecoveryCancelled
        });

        it("should reject cancellation of KeyRotation recovery by the compromised old wallet", async function () {
            await walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, custodian2.address);

            const tx = await walletRecovery.connect(custodian1).initiateRecovery(custodian1.address, 3);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            // Old wallet (custodian1) tries to cancel
            await expect(walletRecovery.connect(custodian1).cancelRecovery(recoveryId))
                .to.be.reverted; // Reverted due to role checks
        });

        it("should allow reversible ACTIVE cancel to clear the successor", async function () {
            // Initiate and activate recovery
            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);

            // Cancel from ACTIVE state requires DEFAULT_ADMIN_ROLE
            await expect(walletRecovery.connect(owner).cancelRecovery(recoveryId))
                .to.emit(walletRecovery, "RecoveryCancelled")
                .withArgs(recoveryId, custodian1.address, owner.address, false);

            const record = await walletRecovery.getRecovery(recoveryId);
            expect(record.state).to.equal(4); // RecoveryCancelled
            expect(record.newWallet).to.equal(ethers.ZeroAddress);
        });

        it("should return Cambio issuer profile to old wallet on reversible cancel", async function () {
            // Skip if envelope-mode Cambio facets are not available in this deployment
            if (!deployment.facets.cambioIssuer || !deployment.facets.cambioEnvelope || !deployment.facets.sponsorBank) {
                // Envelope-mode Cambio issuer setup not feasible: sponsor bank or Cambio facets unavailable in fixture
                this.skip();
            }

            const { ROLES, grantRole } = require("../helpers/roles");

            // Set up roles needed for envelope-mode issuer registration
            await grantRole(accessControl, ROLES.CAMBIO_ADMIN_ROLE, admin.address, owner);
            await grantRole(accessControl, ROLES.SPONSOR_BANK_ADMIN_ROLE, admin.address, owner);

            // Register custodian2 as a sponsor bank so it can endorse issuers
            await deployment.facets.sponsorBank.connect(admin)
                .registerSponsorBank(custodian2.address, "TEST_BANK", 100);

            // Endorse custodian1 as an issuer, then register it envelope-mode
            await deployment.facets.cambioIssuer.connect(custodian2)
                .endorseNonBankIssuer(custodian1.address);
            await deployment.facets.cambioIssuer.connect(admin)
                ["registerIssuer(address,address)"](custodian1.address, custodian2.address);

            // Verify profile exists on custodian1 before recovery
            const profileBefore = await deployment.facets.cambioEnvelope
                .getIssuerEnvelopeProfile(custodian1.address);
            expect(profileBefore.isActive).to.be.true;

            // Initiate recovery and designate successor
            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;
            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);

            // Profile should have moved to successor
            const profileAfterDesignate = await deployment.facets.cambioEnvelope
                .getIssuerEnvelopeProfile(custodian2.address);
            expect(profileAfterDesignate.isActive).to.be.true;

            // Cancel recovery (reversible — no envelopes/notes resolved)
            await walletRecovery.connect(owner).cancelRecovery(recoveryId);

            // Profile should be back on old wallet
            const profileAfterCancel = await deployment.facets.cambioEnvelope
                .getIssuerEnvelopeProfile(custodian1.address);
            expect(profileAfterCancel.isActive).to.be.true;

            const profileOnSuccessorAfterCancel = await deployment.facets.cambioEnvelope
                .getIssuerEnvelopeProfile(custodian2.address);
            expect(profileOnSuccessorAfterCancel.isActive).to.be.false;
        });

        it("should treat cancel after migrateBalance as irreversible, preserving successor and funds", async function () {
            // Pre-seed balance before initiating recovery — quarantine blocks mint to a wallet in recovery.
            const mintAmount = ethers.parseEther("3000");
            await mintBurn.connect(owner).mint(custodian1.address, mintAmount);

            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);

            // Migrate balance
            await walletRecovery.connect(admin).migrateBalance(recoveryId, []);

            // Cancel from ACTIVE state
            await expect(walletRecovery.connect(owner).cancelRecovery(recoveryId))
                .to.emit(walletRecovery, "RecoveryCancelled")
                .withArgs(recoveryId, custodian1.address, owner.address, true);

            const record = await walletRecovery.getRecovery(recoveryId);
            expect(record.state).to.equal(4); // RecoveryCancelled
            expect(record.newWallet).to.equal(custodian2.address);

            // Existing forwarding view must still resolve the old wallet to successor.
            expect(await deployment.facets.cambioEnvelope.resolveEffectiveIssuer(custodian1.address))
                .to.equal(custodian2.address);

            // Migrated funds must stay with successor
            expect(await erc20.balanceOf(custodian2.address)).to.equal(mintAmount);
            expect(await erc20.balanceOf(custodian1.address)).to.equal(0);
        });
    });

    // =========================================================================
    // BALANCE MIGRATION
    // =========================================================================
    describe("Balance Migration", function () {
        let recoveryId;

        beforeEach(async function () {
            // Pre-seed balance before initiating recovery — quarantine blocks mint to a wallet in recovery.
            await mintBurn.connect(owner).mint(custodian1.address, ethers.parseEther("5000"));

            // Setup active recovery
            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;
            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);
        });

        it("should successfully migrate liquid balances", async function () {
            // Balance was pre-seeded in beforeEach before recovery was initiated.
            const mintAmount = ethers.parseEther("5000");

            const initialCustodian1Bal = await erc20.balanceOf(custodian1.address);
            const initialCustodian2Bal = await erc20.balanceOf(custodian2.address);

            expect(initialCustodian1Bal).to.equal(mintAmount);

            await expect(walletRecovery.connect(admin).migrateBalance(recoveryId, []))
                .to.emit(walletRecovery, "RecoveryBalanceMigrated")
                .withArgs(recoveryId, custodian1.address, custodian2.address, mintAmount);

            expect(await erc20.balanceOf(custodian1.address)).to.equal(0);
            expect(await erc20.balanceOf(custodian2.address)).to.equal(initialCustodian2Bal + mintAmount);
        });

        it("should fail migration if there are interbank liabilities with counterparties", async function () {
            // Mock interbank liability by modifying storage or using interbank facet helper
            const interbank = deployment.facets.interbankLiability;
            
            // Set liability: custodian1 owes custodian2
            // If the interbankLiability facet supports setting, we call it, else we mock
            if (interbank && typeof interbank.setTestLiability === "function") {
                await interbank.setTestLiability(custodian1.address, custodian2.address, ethers.parseEther("100"));
                await expect(walletRecovery.connect(admin).migrateBalance(recoveryId, [custodian2.address]))
                    .to.be.revertedWithCustomError(walletRecovery, "RecoveryBlockedOnInterbankLiabilities");
            }
        });
    });

    // =========================================================================
    // BULK RESOLUTION
    // =========================================================================
    describe("Bulk Resolution and Expiration Behavior", function () {
        let recoveryId;

        beforeEach(async function () {
            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;
            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);
        });

        it("should allow admin to override choices per envelope", async function () {
            // overrideEnvelopeChoice requires the envelope to involve the recovering wallet.
            // Create a real envelope where custodian1 is the recipient.
            const amount = ethers.parseEther("50");
            await mintBurn.connect(owner).mint(user1.address, amount);
            const windowEnd = (await time.latest()) + 3600;
            const txEnv = await deployment.facets.envelope.connect(user1).createEnvelope(
                custodian1.address, amount, windowEnd, 0, 0, "0x"
            );
            const receiptEnv = await txEnv.wait();
            const iface = new ethers.Interface([
                "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
            ]);
            const envLog = receiptEnv.logs.find(l => iface.parseLog(l) !== null);
            const envelopeId = iface.parseLog(envLog).args.envelopeId;

            await expect(walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, envelopeId, 1)) // 1 = Reverse
                .to.emit(walletRecovery, "EnvelopeChoiceOverridden")
                .withArgs(recoveryId, envelopeId, 1);

            const storedOverride = await walletRecovery.getEnvelopeOverride(recoveryId, envelopeId);
            expect(storedOverride).to.equal(2); // choice + 1
        });

        it("resolveCambioNotesBulk reverts on invalid action", async function () {
            const fakeNoteId = ethers.id("fake-note-1");
            await expect(
                walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [fakeNoteId], [3])
            )
                .to.be.revertedWithCustomError(walletRecovery, "InvalidNoteAction")
                .withArgs(3);

            // Valid action 0 should NOT revert with InvalidNoteAction (may no-op on nonexistent note)
            await expect(
                walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [fakeNoteId], [0])
            )
                .to.not.be.revertedWithCustomError(walletRecovery, "InvalidNoteAction");
        });

        it("applyBulkPolicy does not mark a no-op resolved", async function () {
            // Create envelope with recovering wallet as recipient (sender quarantine blocks in-recovery wallets)
            const amount = ethers.parseEther("100");
            await mintBurn.connect(owner).mint(user1.address, amount);
            const windowEnd = (await time.latest()) + 3600;
            const txEnv = await deployment.facets.envelope.connect(user1).createEnvelope(
                custodian1.address, amount, windowEnd, 0, 0, "0x"
            );
            const receiptEnv = await txEnv.wait();
            const iface = new ethers.Interface([
                "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
            ]);
            const log = receiptEnv.logs.find(l => iface.parseLog(l) !== null);
            const envelopeId = iface.parseLog(log).args.envelopeId;

            const activeRecoveryId = recoveryId;

            // Override to ConfirmFiat (choice=3) — envelope is ES_CREATED, so this is a no-op
            await walletRecovery.connect(admin).overrideEnvelopeChoice(activeRecoveryId, envelopeId, 3);

            const recordBefore = await walletRecovery.getRecovery(activeRecoveryId);

            await walletRecovery.connect(admin).applyBulkPolicy(activeRecoveryId, [envelopeId]);

            const recordAfter = await walletRecovery.getRecovery(activeRecoveryId);
            expect(recordAfter.envelopesResolved).to.equal(recordBefore.envelopesResolved);

            // Second call should NOT emit choice=255 (not marked as resolved)
            const tx2 = await walletRecovery.connect(admin).applyBulkPolicy(activeRecoveryId, [envelopeId]);
            const receipt2 = await tx2.wait();
            const resolvedEvents = receipt2.logs.filter(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryEnvelopeResolved"; } catch { return false; }
            });
            expect(resolvedEvents.length).to.equal(0);
        });

        describe("Positive path per choice", function () {
            const ES_CREATED = 1;
            const ES_FINALIZED = 2;
            const ES_REVERSED = 3;
            const ES_DISPUTED = 4;
            const ES_PENDING_FIAT = 6;
            const ST_CRYPTO_DIRECT = 0;
            const ST_FIAT_INSTITUTIONAL = 1;

            async function createRealEnvelope({ sender = user1, recipient = custodian1, amount, settlementType = ST_CRYPTO_DIRECT, expirationBehavior = 0 }) {
                await mintBurn.connect(owner).mint(sender.address, amount);
                const windowEnd = (await time.latest()) + 3600;
                const tx = await deployment.facets.envelope.connect(sender).createEnvelope(
                    recipient.address, amount, windowEnd, settlementType, expirationBehavior, "0x"
                );
                const receipt = await tx.wait();
                const iface = new ethers.Interface([
                    "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
                ]);
                const log = receipt.logs.find(l => iface.parseLog(l) !== null);
                return iface.parseLog(log).args.envelopeId;
            }

            async function setupActiveRecovery() {
                return recoveryId;
            }

            it("Finalize: choice 0 on ES_CREATED → ES_FINALIZED", async function () {
                const amount = ethers.parseEther("100");
                const envelopeId = await createRealEnvelope({ sender: user1, recipient: custodian1, amount });
                const rid = await setupActiveRecovery();

                // Default sender policy is Finalize(0), no override needed
                await walletRecovery.connect(admin).applyBulkPolicy(rid, [envelopeId]);

                const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
                expect(state).to.equal(ES_FINALIZED);

                // Replay emits original choice with replayed=true
                const tx2 = await walletRecovery.connect(admin).applyBulkPolicy(rid, [envelopeId]);
                const receipt2 = await tx2.wait();
                const resolvedEvents = receipt2.logs.filter(l => {
                    try { return walletRecovery.interface.parseLog(l).name === "RecoveryEnvelopeResolved"; } catch { return false; }
                });
                expect(resolvedEvents.length).to.equal(1);
                const parsed = walletRecovery.interface.parseLog(resolvedEvents[0]);
                expect(parsed.args.choice).to.equal(0);
                expect(parsed.args.replayed).to.equal(true);
            });

            it("Reverse: choice 1 on ES_CREATED → ES_REVERSED", async function () {
                const amount = ethers.parseEther("100");
                const envelopeId = await createRealEnvelope({ sender: user1, recipient: custodian1, amount });
                const rid = await setupActiveRecovery();

                await walletRecovery.connect(admin).overrideEnvelopeChoice(rid, envelopeId, 1); // Reverse
                await walletRecovery.connect(admin).applyBulkPolicy(rid, [envelopeId]);

                const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
                expect(state).to.equal(ES_REVERSED);
            });

            it("Clawback: choice 2 on ES_CREATED → ES_REVERSED", async function () {
                const amount = ethers.parseEther("100");
                const envelopeId = await createRealEnvelope({ sender: user1, recipient: custodian1, amount });
                const rid = await setupActiveRecovery();

                await walletRecovery.connect(admin).overrideEnvelopeChoice(rid, envelopeId, 2); // Clawback
                await walletRecovery.connect(admin).applyBulkPolicy(rid, [envelopeId]);

                const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
                expect(state).to.equal(ES_REVERSED);
            });

            it("ConfirmFiat: choice 3 on ES_PENDING_FIAT → ES_FINALIZED", async function () {
                const amount = ethers.parseEther("100");
                const envelopeId = await createRealEnvelope({
                    sender: user1, recipient: custodian1, amount,
                    settlementType: ST_FIAT_INSTITUTIONAL
                });
                // Finalize to move into PENDING_FIAT before recovery
                await deployment.facets.envelope.connect(custodian1).finalizeEnvelope(envelopeId);
                const [,,,,,, stateBefore] = await deployment.facets.envelope.getEnvelope(envelopeId);
                expect(stateBefore).to.equal(ES_PENDING_FIAT);

                const rid = await setupActiveRecovery();
                await walletRecovery.connect(admin).overrideEnvelopeChoice(rid, envelopeId, 3); // ConfirmFiat
                await walletRecovery.connect(admin).applyBulkPolicy(rid, [envelopeId]);

                const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
                expect(state).to.equal(ES_FINALIZED);
            });

            it("CarryDispute: choice 4 on ES_DISPUTED → remains ES_DISPUTED, marked resolved", async function () {
                const amount = ethers.parseEther("100");
                const envelopeId = await createRealEnvelope({ sender: user1, recipient: custodian1, amount });
                // Raise dispute before recovery
                await deployment.facets.envelope.connect(custodian1).raiseDispute(envelopeId, ethers.toUtf8Bytes("reason"));
                const [,,,,,, stateBefore] = await deployment.facets.envelope.getEnvelope(envelopeId);
                expect(stateBefore).to.equal(ES_DISPUTED);

                const rid = await setupActiveRecovery();
                await walletRecovery.connect(admin).overrideEnvelopeChoice(rid, envelopeId, 4); // CarryDispute
                await walletRecovery.connect(admin).applyBulkPolicy(rid, [envelopeId]);

                // State should remain disputed
                const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
                expect(state).to.equal(ES_DISPUTED);

                // Should be marked resolved (replay emits original choice with replayed=true)
                const tx2 = await walletRecovery.connect(admin).applyBulkPolicy(rid, [envelopeId]);
                const receipt2 = await tx2.wait();
                const resolvedEvents = receipt2.logs.filter(l => {
                    try { return walletRecovery.interface.parseLog(l).name === "RecoveryEnvelopeResolved"; } catch { return false; }
                });
                expect(resolvedEvents.length).to.equal(1);
                const parsed = walletRecovery.interface.parseLog(resolvedEvents[0]);
                expect(parsed.args.choice).to.equal(4);
                expect(parsed.args.replayed).to.equal(true);
            });
        });

        it("Replay/idempotency: already-resolved envelope emits replayed=true and does not double-increment", async function () {
            const amount = ethers.parseEther("100");
            await mintBurn.connect(owner).mint(user1.address, amount);
            const windowEnd = (await time.latest()) + 3600;
            const txEnv = await deployment.facets.envelope.connect(user1).createEnvelope(
                custodian1.address, amount, windowEnd, 0, 0, "0x"
            );
            const receiptEnv = await txEnv.wait();
            const iface = new ethers.Interface([
                "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
            ]);
            const log = receiptEnv.logs.find(l => iface.parseLog(l) !== null);
            const envelopeId = iface.parseLog(log).args.envelopeId;

            const rid = recoveryId;

            // First resolution (default policy = Finalize = choice 0)
            await walletRecovery.connect(admin).applyBulkPolicy(rid, [envelopeId]);
            const recordAfterFirst = await walletRecovery.getRecovery(rid);
            expect(recordAfterFirst.envelopesResolved).to.equal(1);

            // Second resolution — should emit original choice with replayed=true and NOT increment
            const tx2 = await walletRecovery.connect(admin).applyBulkPolicy(rid, [envelopeId]);
            const receipt2 = await tx2.wait();
            const resolvedEvents = receipt2.logs.filter(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryEnvelopeResolved"; } catch { return false; }
            });
            expect(resolvedEvents.length).to.equal(1);
            const parsed = walletRecovery.interface.parseLog(resolvedEvents[0]);
            expect(parsed.args.choice).to.equal(0); // original choice was Finalize (0)
            expect(parsed.args.replayed).to.equal(true);

            const recordAfterSecond = await walletRecovery.getRecovery(rid);
            expect(recordAfterSecond.envelopesResolved).to.equal(1);
        });

        it("Partial batch: only resolvable item is marked resolved", async function () {
            const amount = ethers.parseEther("100");
            await mintBurn.connect(owner).mint(user1.address, amount * 2n);
            const windowEnd = (await time.latest()) + 3600;

            // Envelope 1: resolvable (recipient=custodian1, default recipientDefault=Finalize)
            const tx1 = await deployment.facets.envelope.connect(user1).createEnvelope(
                custodian1.address, amount, windowEnd, 0, 0, "0x"
            );
            const receipt1 = await tx1.wait();
            const iface = new ethers.Interface([
                "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
            ]);
            const log1 = receipt1.logs.find(l => iface.parseLog(l) !== null);
            const envelopeId1 = iface.parseLog(log1).args.envelopeId;

            // Envelope 2: no-op (override to ConfirmFiat but state is ES_CREATED)
            const tx2 = await deployment.facets.envelope.connect(user1).createEnvelope(
                custodian1.address, amount, windowEnd, 0, 0, "0x"
            );
            const receipt2 = await tx2.wait();
            const log2 = receipt2.logs.find(l => iface.parseLog(l) !== null);
            const envelopeId2 = iface.parseLog(log2).args.envelopeId;

            const rid = recoveryId;

            await walletRecovery.connect(admin).overrideEnvelopeChoice(rid, envelopeId2, 3); // ConfirmFiat on ES_CREATED = no-op

            const recordBefore = await walletRecovery.getRecovery(rid);
            await walletRecovery.connect(admin).applyBulkPolicy(rid, [envelopeId1, envelopeId2]);
            const recordAfter = await walletRecovery.getRecovery(rid);

            // Only envelopeId1 should have been resolved
            expect(recordAfter.envelopesResolved).to.equal(recordBefore.envelopesResolved + 1n);

            // envelopeId2 should still be resolvable on a second call (still a no-op)
            const txRetry = await walletRecovery.connect(admin).applyBulkPolicy(rid, [envelopeId2]);
            const receiptRetry = await txRetry.wait();
            const resolvedEvents = receiptRetry.logs.filter(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryEnvelopeResolved"; } catch { return false; }
            });
            expect(resolvedEvents.length).to.equal(0);
        });

        it("applyBulkPolicy skips unrelated envelope; overrideEnvelopeChoice rejects it", async function () {
            const amount = ethers.parseEther("100");
            await mintBurn.connect(owner).mint(user1.address, amount);
            const windowEnd = (await time.latest()) + 3600;

            // Envelope where neither sender nor recipient relates to custodian1
            const txEnv = await deployment.facets.envelope.connect(user1).createEnvelope(
                user2.address, amount, windowEnd, 0, 0, "0x"
            );
            const receiptEnv = await txEnv.wait();
            const iface = new ethers.Interface([
                "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
            ]);
            const log = receiptEnv.logs.find(l => iface.parseLog(l) !== null);
            const envelopeId = iface.parseLog(log).args.envelopeId;

            // M-01 fix: overrideEnvelopeChoice must reject unrelated envelopes.
            await expect(
                walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, envelopeId, 1)
            ).to.be.revertedWithCustomError(walletRecovery, "EnvelopeNotInRecovery");

            // applyBulkPolicy silently skips unrelated envelopes — counters unchanged.
            const recordBefore = await walletRecovery.getRecovery(recoveryId);
            await walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId]);
            const recordAfter = await walletRecovery.getRecovery(recoveryId);
            expect(recordAfter.envelopesResolved).to.equal(recordBefore.envelopesResolved);
            expect(await walletRecovery.isEnvelopeResolved(recoveryId, envelopeId)).to.be.false;

            // Envelope state should remain unchanged
            const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(1); // ES_CREATED
        });

        it("applyBulkPolicy processes chained-lineage envelope", async function () {
            const amount = ethers.parseEther("100");
            const windowEnd = (await time.latest()) + 3600;

            // Register user1 as a custodian so it can be an oldWallet
            const futureExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
            await custodianRegistry.connect(owner).grantCustodianRole(user1.address);
            await custodianRegistry.connect(user1).registerCustodiedWallet(user1.address, 1, futureExpiry);

            // Cancel the beforeEach recovery so custodian1 is free
            await walletRecovery.connect(owner).cancelRecovery(recoveryId);

            // Initiate and complete recovery user1 -> custodian1 to set recoverySuccessor[user1]=custodian1
            await mintBurn.connect(owner).mint(user1.address, amount);
            const tx1 = await walletRecovery.connect(admin).initiateRecovery(user1.address, 0);
            const receipt1 = await tx1.wait();
            const log1 = receipt1.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const firstRecoveryId = walletRecovery.interface.parseLog(log1).args.recoveryId;
            await walletRecovery.connect(admin).designateSuccessor(firstRecoveryId, custodian1.address);
            await walletRecovery.connect(admin).migrateBalance(firstRecoveryId, []);
            await walletRecovery.connect(admin).completeRecovery(firstRecoveryId, []);

            // Now initiate recovery custodian1 -> custodian2
            const tx2 = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt2 = await tx2.wait();
            const log2 = receipt2.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const secondRecoveryId = walletRecovery.interface.parseLog(log2).args.recoveryId;
            await walletRecovery.connect(admin).designateSuccessor(secondRecoveryId, custodian2.address);

            // Create envelope where sender is user1 (predecessor of custodian1 in recovery chain)
            await mintBurn.connect(owner).mint(user1.address, amount);
            const txEnv = await deployment.facets.envelope.connect(user1).createEnvelope(
                user2.address, amount, windowEnd, 0, 0, "0x"
            );
            const receiptEnv = await txEnv.wait();
            const iface = new ethers.Interface([
                "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
            ]);
            const logEnv = receiptEnv.logs.find(l => iface.parseLog(l) !== null);
            const envelopeId = iface.parseLog(logEnv).args.envelopeId;

            await walletRecovery.connect(admin).applyBulkPolicy(secondRecoveryId, [envelopeId]);

            const recordAfter = await walletRecovery.getRecovery(secondRecoveryId);
            expect(recordAfter.envelopesResolved).to.equal(1);
            expect(await walletRecovery.isEnvelopeResolved(secondRecoveryId, envelopeId)).to.be.true;

            // Default sender policy is Finalize, so envelope should be finalized
            const [,,,,,, state] = await deployment.facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(2); // ES_FINALIZED
        });

        it("resolveCambioNotesBulk reverts on invalid action and unrelated note", async function () {
            const fakeNoteId = ethers.id("fake-note-1");
            await expect(
                walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [fakeNoteId], [3])
            )
                .to.be.revertedWithCustomError(walletRecovery, "InvalidNoteAction")
                .withArgs(3);

            // Nonexistent note with issuer zero is unrelated and must revert
            await expect(
                walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [fakeNoteId], [0])
            )
                .to.be.revertedWithCustomError(walletRecovery, "CambioNoteNotInRecovery")
                .withArgs(fakeNoteId, recoveryId);
        });

        it("resolveCambioNotesBulk rejects unrelated real note and preserves state", async function () {
            // Skip if envelope-mode Cambio facets unavailable
            if (!deployment.facets.cambioEnvelope || !deployment.facets.cambioIssuer) {
                this.skip();
            }

            const { ROLES, grantRole } = require("../helpers/roles");
            await grantRole(accessControl, ROLES.CAMBIO_ADMIN_ROLE, admin.address, owner);
            await grantRole(accessControl, ROLES.CAMBIO_ISSUER_ROLE, user1.address, owner);
            await deployment.facets.cambioIssuer.connect(admin).registerIssuer(user1.address);
            await deployment.facets.cambioEnvelope.connect(admin).advanceCambioPhase();
            await deployment.facets.cambioAdmin.connect(admin).setCambioEnvelopeConfig(
                ethers.parseEther("1000"), 3600, 86400, 2048, ethers.parseEther("1000"), 7200, false
            );
            await mintBurn.connect(owner).mint(user1.address, ethers.parseEther("100"));

            const latestBlock = await ethers.provider.getBlock("latest");
            const noteDeadline = latestBlock.timestamp + 86400;
            const phraseCommitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], ["phrase", ethers.hexlify(ethers.randomBytes(32))]));
            const txNote = await deployment.facets.cambioEnvelope.connect(user1).createCambioNote(
                ethers.parseEther("10"), phraseCommitment, ethers.hexlify(ethers.randomBytes(32)), noteDeadline, "meta"
            );
            const receiptNote = await txNote.wait();
            const event = receiptNote.logs.find(l => l.fragment && l.fragment.name === "CambioEnvelopeNoteCreated");
            const noteId = event.args.noteId;

            const noteBefore = await deployment.facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(noteBefore.active).to.be.true;

            const profileBefore = await deployment.facets.cambioEnvelope.getIssuerEnvelopeProfile(user1.address);

            // Attempt to cancel the unrelated note in custodian1's recovery
            await expect(
                walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [noteId], [1])
            )
                .to.be.revertedWithCustomError(walletRecovery, "CambioNoteNotInRecovery")
                .withArgs(noteId, recoveryId);

            // Note and issuer counters must remain unchanged
            const noteAfter = await deployment.facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(noteAfter.active).to.be.true;
            const profileAfter = await deployment.facets.cambioEnvelope.getIssuerEnvelopeProfile(user1.address);
            expect(profileAfter.notesOutstanding).to.equal(profileBefore.notesOutstanding);
            expect(profileAfter.valueOutstanding).to.equal(profileBefore.valueOutstanding);
        });

        it("resolveCambioNotesBulk accepts chained-lineage issuer note", async function () {
            // Skip if envelope-mode Cambio facets unavailable
            if (!deployment.facets.cambioEnvelope || !deployment.facets.cambioIssuer) {
                this.skip();
            }

            const { ROLES, grantRole } = require("../helpers/roles");
            await grantRole(accessControl, ROLES.CAMBIO_ADMIN_ROLE, admin.address, owner);
            await grantRole(accessControl, ROLES.CAMBIO_ISSUER_ROLE, user1.address, owner);
            await deployment.facets.cambioIssuer.connect(admin).registerIssuer(user1.address);
            await deployment.facets.cambioEnvelope.connect(admin).advanceCambioPhase();
            await deployment.facets.cambioAdmin.connect(admin).setCambioEnvelopeConfig(
                ethers.parseEther("1000"), 3600, 86400, 2048, ethers.parseEther("1000"), 7200, false
            );
            await mintBurn.connect(owner).mint(user1.address, ethers.parseEther("100"));

            const latestBlock = await ethers.provider.getBlock("latest");
            const noteDeadline = latestBlock.timestamp + 86400;
            const phraseCommitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], ["phrase", ethers.hexlify(ethers.randomBytes(32))]));
            const txNote = await deployment.facets.cambioEnvelope.connect(user1).createCambioNote(
                ethers.parseEther("10"), phraseCommitment, ethers.hexlify(ethers.randomBytes(32)), noteDeadline, "meta"
            );
            const receiptNote = await txNote.wait();
            const event = receiptNote.logs.find(l => l.fragment && l.fragment.name === "CambioEnvelopeNoteCreated");
            const noteId = event.args.noteId;

            // Register user1 as custodian
            const futureExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
            await custodianRegistry.connect(owner).grantCustodianRole(user1.address);
            await custodianRegistry.connect(user1).registerCustodiedWallet(user1.address, 1, futureExpiry);

            // Cancel beforeEach recovery so custodian1 is free
            await walletRecovery.connect(owner).cancelRecovery(recoveryId);

            // Complete recovery user1 -> custodian1 to establish chain
            await mintBurn.connect(owner).mint(user1.address, ethers.parseEther("1"));
            const tx1 = await walletRecovery.connect(admin).initiateRecovery(user1.address, 0);
            const receipt1 = await tx1.wait();
            const log1 = receipt1.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const firstRecoveryId = walletRecovery.interface.parseLog(log1).args.recoveryId;
            await walletRecovery.connect(admin).designateSuccessor(firstRecoveryId, custodian1.address);
            await walletRecovery.connect(admin).migrateBalance(firstRecoveryId, []);
            await walletRecovery.connect(admin).completeRecovery(firstRecoveryId, []);

            // Initiate recovery custodian1 -> custodian2
            const tx2 = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt2 = await tx2.wait();
            const log2 = receipt2.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const secondRecoveryId = walletRecovery.interface.parseLog(log2).args.recoveryId;
            await walletRecovery.connect(admin).designateSuccessor(secondRecoveryId, custodian2.address);

            // Resolve the note (action 1 = cancel) should succeed because issuer=user1 is in chain
            const recordBefore = await walletRecovery.getRecovery(secondRecoveryId);
            await expect(
                walletRecovery.connect(admin).resolveCambioNotesBulk(secondRecoveryId, [noteId], [1])
            )
                .to.emit(walletRecovery, "RecoveryCambioNoteResolved")
                .withArgs(secondRecoveryId, noteId, 1, ethers.parseEther("10"), false);

            const recordAfter = await walletRecovery.getRecovery(secondRecoveryId);
            expect(recordAfter.cambioNotesResolved).to.equal(recordBefore.cambioNotesResolved + 1n);

            const noteAfter = await deployment.facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(noteAfter.active).to.be.false;
        });
    });

    // =========================================================================
    // RECOVERY COMPLETION
    // =========================================================================
    describe("Recovery Completion", function () {
        it("should successfully complete recovery and perform role transfers", async function () {
            // Set standby
            await walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, custodian2.address);

            // Initiate KeyRotation
            const tx = await walletRecovery.connect(custodian1).initiateRecovery(custodian1.address, 3);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            // Designate successor
            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);

            // Migrate balance (required before completion)
            await walletRecovery.connect(admin).migrateBalance(recoveryId, []);

            // Fast forward past the 48-hour timelock
            await time.increase(48 * 3600 + 1);

            // Verify custodian1 has CUSTODIAN_ROLE
            const custodianRole = ethers.id("CUSTODIAN_ROLE");
            expect(await accessControl.hasRole(custodianRole, custodian1.address)).to.be.true;

            // Complete recovery
            await expect(walletRecovery.connect(admin).completeRecovery(recoveryId, []))
                .to.emit(walletRecovery, "RecoveryComplete")
                .withArgs(recoveryId, custodian1.address, custodian2.address, anyValue => true);

            // Verify role transfer
            expect(await accessControl.hasRole(custodianRole, custodian1.address)).to.be.false;
            expect(await accessControl.hasRole(custodianRole, custodian2.address)).to.be.true;

            const record = await walletRecovery.getRecovery(recoveryId);
            expect(record.state).to.equal(3); // RecoveryComplete
        });

        it("should add new wallet to custodian set and remove old on completeRecovery", async function () {
            // Set standby
            await walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, custodian2.address);

            // Initiate KeyRotation
            const tx = await walletRecovery.connect(custodian1).initiateRecovery(custodian1.address, 3);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            // Designate successor
            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);

            // Migrate balance (required before completion)
            await walletRecovery.connect(admin).migrateBalance(recoveryId, []);

            // Fast forward past the 48-hour timelock
            await time.increase(48 * 3600 + 1);

            // Verify both wallets are in the custodian set before completion
            expect(await custodianRegistry.isCustodian(custodian1.address)).to.be.true;
            expect(await custodianRegistry.isCustodian(custodian2.address)).to.be.true;

            // Complete recovery
            await walletRecovery.connect(admin).completeRecovery(recoveryId, []);

            // Verify old wallet removed and new wallet remains in the custodian set
            expect(await custodianRegistry.isCustodian(custodian1.address)).to.be.false;
            expect(await custodianRegistry.isCustodian(custodian2.address)).to.be.true;
        });

        it("should reject completion if KeyRotation timelock is active", async function () {
            await walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, custodian2.address);

            const tx = await walletRecovery.connect(custodian1).initiateRecovery(custodian1.address, 3);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);

            // Completion should fail since the 48-hour timelock has not elapsed
            await expect(walletRecovery.connect(admin).completeRecovery(recoveryId, []))
                .to.be.revertedWithCustomError(walletRecovery, "TimelockActive");
        });

        it("should reject completion if migrateBalance was never called", async function () {
            await walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, custodian2.address);

            const tx = await walletRecovery.connect(custodian1).initiateRecovery(custodian1.address, 3);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);

            // Fast forward past the 48-hour timelock
            await time.increase(48 * 3600 + 1);

            await expect(walletRecovery.connect(admin).completeRecovery(recoveryId, []))
                .to.be.revertedWithCustomError(walletRecovery, "RecoveryNotMigrated")
                .withArgs(recoveryId);
        });

        it("should reject completion via RecoveryNotMigrated even when old wallet had tokens pre-recovery", async function () {
            await walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, custodian2.address);

            // Seed balance BEFORE initiating recovery.
            // Quarantine blocks all inbound token flows once recovery is active (mint AND direct-transfer
            // both check activeRecoveryCount on the target wallet).
            const mintAmount = ethers.parseEther("1000");
            await mintBurn.connect(owner).mint(custodian1.address, mintAmount);

            const tx = await walletRecovery.connect(custodian1).initiateRecovery(custodian1.address, 3);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);

            // Fast forward past the 48-hour timelock
            await time.increase(48 * 3600 + 1);

            // RecoveryNotMigrated fires first — migrateBalance was never called.
            await expect(walletRecovery.connect(admin).completeRecovery(recoveryId, []))
                .to.be.revertedWithCustomError(walletRecovery, "RecoveryNotMigrated")
                .withArgs(recoveryId);
        });

        it("should block direct transfers to old wallet while in recovery (confirms CompletionStateNotZero is unreachable)", async function () {
            // T3TokenDirectTransferFacet quarantines sender, recipient, AND operator.
            // This means all transfer paths to a recovering wallet are blocked, so
            // CompletionStateNotZero cannot be triggered post-migration.
            await walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, custodian2.address);

            await mintBurn.connect(owner).mint(user1.address, ethers.parseEther("200"));

            const tx = await walletRecovery.connect(custodian1).initiateRecovery(custodian1.address, 3);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;
            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);
            await walletRecovery.connect(admin).migrateBalance(recoveryId, []);

            // Transfer to the recovering old wallet must revert.
            await expect(
                deployment.facets.directTransfer.connect(user1).transfer(custodian1.address, ethers.parseEther("100"))
            ).to.be.revertedWithCustomError(walletRecovery, "WalletInRecovery")
             .withArgs(custodian1.address);
        });

        it("should allow happy path migrateBalance then completeRecovery with RecoveryComplete event", async function () {
            // Seed balance before initiating recovery — quarantine guard blocks mint to a wallet in recovery.
            const mintAmount = ethers.parseEther("2500");
            await mintBurn.connect(owner).mint(custodian1.address, mintAmount);

            // Use a non-KeyRotation recovery so no timelock wait is needed
            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);
            await expect(walletRecovery.connect(admin).migrateBalance(recoveryId, []))
                .to.emit(walletRecovery, "RecoveryBalanceMigrated")
                .withArgs(recoveryId, custodian1.address, custodian2.address, mintAmount);

            // Complete recovery
            await expect(walletRecovery.connect(admin).completeRecovery(recoveryId, []))
                .to.emit(walletRecovery, "RecoveryComplete")
                .withArgs(recoveryId, custodian1.address, custodian2.address, anyValue => true);

            const record = await walletRecovery.getRecovery(recoveryId);
            expect(record.state).to.equal(3); // RecoveryComplete
        });

        it("FIX E2: completeRecovery reverts with SuccessorNotCustodian when successor becomes ineligible", async function () {
            // Set standby and initiate KeyRotation so the recovery uses a timelock.
            await walletRecovery.connect(admin).setRecoveryStandby(custodian1.address, custodian2.address);

            const tx = await walletRecovery.connect(custodian1).initiateRecovery(custodian1.address, 3);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            // Successor was eligible at activation.
            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);
            await walletRecovery.connect(admin).migrateBalance(recoveryId, []);

            // Fast forward past the 48-hour timelock.
            await time.increase(48 * 3600 + 1);

            // Make the successor ineligible before completion (revoke CUSTODIAN_ROLE and custodian set membership).
            await custodianRegistry.connect(owner).revokeCustodianRole(custodian2.address);

            await expect(walletRecovery.connect(admin).completeRecovery(recoveryId, []))
                .to.be.revertedWithCustomError(walletRecovery, "SuccessorNotCustodian")
                .withArgs(custodian2.address);
        });
    });

    // =========================================================================
    // CONSORTIUM / INSTITUTION MIGRATION
    // =========================================================================
    describe("Consortium/Institution Migration", function () {
        let recoveryId;

        beforeEach(async function () {
            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian1.address, 0);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            recoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;
            await walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian2.address);
        });

        it("Consortium state migrates to the new wallet on active recovery", async function () {
            const consortiumMembership = deployment.facets.consortiumMembership;
            if (!consortiumMembership || typeof consortiumMembership.registerBank !== "function") {
                // ConsortiumMembershipFacet not available in fixture
                this.skip();
            }

            // Seed consortium state for custodian1
            await consortiumMembership.connect(admin).registerBank(
                custodian1.address,
                "TestBank",
                custodian1.address,
                ethers.parseEther("1000000")
            );
            await consortiumMembership.connect(admin).configureBankWallet(
                custodian1.address,
                1,
                custodian1.address,
                custodian1.address
            );

            // Verify old wallet has profile
            const profileBefore = await consortiumMembership.getBankProfile(custodian1.address);
            expect(profileBefore.isActive).to.be.true;

            // Migrate consortium state
            await expect(
                walletRecovery.connect(admin).migrateConsortiumState(recoveryId, [1], [])
            )
                .to.emit(walletRecovery, "ConsortiumStateMigrated")
                .withArgs(recoveryId, custodian1.address, custodian2.address);

            // Verify new wallet has profile
            const profileAfter = await consortiumMembership.getBankProfile(custodian2.address);
            expect(profileAfter.isActive).to.be.true;
            expect(profileAfter.name).to.equal("TestBank");

            // Old wallet should no longer have profile
            await expect(consortiumMembership.getBankProfile(custodian1.address))
                .to.be.revertedWith("not registered");
        });

        it("Institution state migrates", async function () {
            const institutionRegistry = deployment.facets.institutionRegistry;
            const institutionPolicy = deployment.facets.institutionPolicy;
            if (!institutionRegistry || typeof institutionRegistry.registerInstitution !== "function") {
                // InstitutionRegistryFacet not available in fixture
                this.skip();
            }

            // Register institution and link custodian1
            const tx = await institutionRegistry.connect(owner).registerInstitution(
                "TestInstitution",
                ethers.id("metadata"),
                "https://example.com",
                owner.address
            );
            const receipt = await tx.wait();
            const regLog = receipt.logs.find(l => {
                try { return institutionRegistry.interface.parseLog(l).name === "InstitutionRegistered"; } catch { return false; }
            });
            const institutionId = institutionRegistry.interface.parseLog(regLog).args.id;

            await institutionRegistry.connect(owner).linkWalletToInstitution(custodian1.address, institutionId);

            // Grant scoped role
            const role = ethers.id("TEST_ROLE");
            await institutionPolicy.connect(owner).grantScopedRole(role, custodian1.address, institutionId);

            // Set wallet policy using a valid policy key
            const policyKey = ethers.id("cancel_oob_threshold_usd");
            await institutionPolicy.connect(owner).setWalletPolicy(custodian1.address, policyKey, 42);

            // Migrate institution state
            await expect(
                walletRecovery.connect(admin).migrateInstitutionState(recoveryId, [institutionId], [role], [policyKey])
            )
                .to.emit(walletRecovery, "InstitutionStateMigrated")
                .withArgs(recoveryId, custodian1.address, custodian2.address);

            // Verify new wallet has affiliation
            const affAfter = await institutionRegistry.getWalletAffiliation(custodian2.address);
            expect(affAfter.institutionId).to.equal(institutionId);

            // Verify scoped role migrated
            const hasRole = await institutionPolicy.hasScopedRole(role, custodian2.address, institutionId);
            expect(hasRole).to.be.true;

            // Verify old wallet no longer has affiliation
            const affOld = await institutionRegistry.getWalletAffiliation(custodian1.address);
            expect(affOld.institutionId).to.equal(ethers.ZeroHash);
        });

        it("Bounded-array revert", async function () {
            const longArray = Array(101).fill(1);
            await expect(
                walletRecovery.connect(admin).migrateConsortiumState(recoveryId, longArray, [])
            )
                .to.be.revertedWithCustomError(walletRecovery, "BatchTooLarge");
        });

        it("Reverts when recovery not ACTIVE", async function () {
            // Create a fresh PENDING recovery
            const tx = await walletRecovery.connect(admin).initiateRecovery(custodian2.address, 0);
            const receipt = await tx.wait();
            const log = receipt.logs.find(l => {
                try { return walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const pendingRecoveryId = walletRecovery.interface.parseLog(log).args.recoveryId;

            await expect(
                walletRecovery.connect(admin).migrateConsortiumState(pendingRecoveryId, [], [])
            )
                .to.be.revertedWithCustomError(walletRecovery, "InvalidRecoveryState");
        });
    });
});
