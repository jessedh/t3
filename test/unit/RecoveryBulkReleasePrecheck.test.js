const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES, grantRole } = require("../helpers/roles");

// Task 3.2 (crossfacet remediation): the bulk recovery resolutions that RELEASE
// value — applyBulkPolicy choice 3 (ConfirmFiat burn: the recipient took
// beneficial ownership of the fiat leg) and resolveCambioNotesBulk actions 1/2
// (remaining note escrow to the resolved payee) — must run the same
// ESCROW_RELEASE compliance gate as the normal-path releases
// (TransferEnvelopeAdminFacet.confirmFiatReceived, envelope finalize paths).
// The gate lives in WalletRecoverySanctionsLib.precheckEscrowRelease (external,
// DELEGATECALLed) so WalletRecoveryFacet does not grow past EIP-170.
//
// Task 4.4 (D2) supersedes the plain revert for the RETURN legs only: choice 1/2
// reverse/clawback and Cambio actions 1/2 route screened-out counterparties to
// an admin compliance hold (ComplianceHoldLib.checkOrHoldBulk) instead of
// reverting the batch. Choice 3 ConfirmFiat KEEPS the Task 3.2 revert (MED-3):
// a burn leg has no payout to park.
describe("Task 3.2: bulk recovery releases run the ESCROW_RELEASE gate", function () {
  const SCREENING_BLOCKED = 3;
  const CTX_ESCROW_RELEASE = 2;
  const ES_CREATED = 1;
  const ES_FINALIZED = 2;
  const ES_REVERSED = 3;
  const ES_DISPUTED = 4;
  const ES_PENDING_FIAT = 6;
  const ST_FIAT_INSTITUTIONAL = 1;
  const OUTCOME_PAY_ALTERNATE = 2;
  const ENVELOPE_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes("T3_TRANSFER_ENVELOPE_V1"));
  const SMARTLOCK_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes("T3_SMARTLOCK_ENVELOPE_V1"));
  const CAMBIO_NOTE_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes("T3_CAMBIO_NOTE_V1"));
  // DP-A arming accepts any institution id; a dedicated one keeps tests isolated.
  const ARM_INST = ethers.keccak256(ethers.toUtf8Bytes("BULK_RELEASE_ARM"));

  const ENVELOPE_CREATED_IFACE = new ethers.Interface([
    "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)"
  ]);

  async function fixture() {
    const base = await deployT3DiamondFixture();
    await setupTestRoles(base.facets, base.signers);
    const { diamondAddress, facets, signers } = base;
    const { owner, admin, user1, user2, custodian1, custodian2 } = signers;

    const futureExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    for (const [holder, registrar] of [[custodian1, custodian1], [custodian2, custodian2], [user1, user1], [user2, user2]]) {
      await facets.custodian.connect(owner).grantCustodianRole(holder.address);
      await facets.custodian.connect(registrar).registerCustodiedWallet(holder.address, 1, futureExpiry);
    }

    const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamondAddress);
    // Interface-only handle: supplies the ComplianceSanctioned error fragment for
    // revertedWithCustomError decoding (the tx target is the walletRecovery facet).
    const complianceErrors = await ethers.getContractAt("ComplianceLibHarnessFacet", diamondAddress);
    // Hold events are declared in the emitting library; decode through its ABI
    // attached at the diamond address.
    const holdLib = await ethers.getContractAt("ComplianceHoldLib", diamondAddress);

    return { facets, scr, complianceErrors, holdLib, diamondAddress, owner, admin, user1, user2, custodian1, custodian2 };
  }

  async function armSanctions(scr, owner) {
    await scr.connect(owner).setInstitutionSanctionsEnabled(ARM_INST, true);
  }

  async function blockWallet(scr, owner, wallet) {
    await scr.connect(owner).recordNetworkScreening(wallet.address, SCREENING_BLOCKED, ethers.ZeroHash);
  }

  async function startRecovery(facets, admin, oldWallet, successor) {
    const tx = await facets.walletRecovery.connect(admin).initiateRecovery(oldWallet.address, 0);
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => {
      try { return facets.walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
    });
    const recoveryId = facets.walletRecovery.interface.parseLog(log).args.recoveryId;
    await facets.walletRecovery.connect(admin).designateSuccessor(recoveryId, successor.address);
    return recoveryId;
  }

  async function createEnvelope(facets, owner, sender, recipient, amount, settlementType) {
    await facets.mintBurn.connect(owner).mint(sender.address, amount);
    const windowEnd = (await time.latest()) + 3600;
    const tx = await facets.envelope.connect(sender).createEnvelope(
      recipient.address, amount, windowEnd, settlementType, 0, "0x"
    );
    const receipt = await tx.wait();
    const log = receipt.logs.find(l => {
      try { return ENVELOPE_CREATED_IFACE.parseLog(l) !== null; } catch { return false; }
    });
    return ENVELOPE_CREATED_IFACE.parseLog(log).args.envelopeId;
  }

  async function envelopeState(facets, envelopeId) {
    const [, , , , , , state] = await facets.envelope.getEnvelope(envelopeId);
    return state;
  }

  describe("applyBulkPolicy choice 3 (ConfirmFiat burn)", function () {
    async function pendingFiatSetup() {
      const ctx = await loadFixture(fixture);
      const { facets, owner, admin, user1, custodian1, custodian2 } = ctx;
      const amount = ethers.parseEther("100");

      const envelopeId = await createEnvelope(facets, owner, user1, custodian1, amount, ST_FIAT_INSTITUTIONAL);
      await facets.envelope.connect(custodian1).finalizeEnvelope(envelopeId);
      expect(await envelopeState(facets, envelopeId)).to.equal(ES_PENDING_FIAT);

      const recoveryId = await startRecovery(facets, admin, custodian1, custodian2);
      await facets.walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, envelopeId, 3);
      return { ...ctx, envelopeId, recoveryId };
    }

    it("armed: blocked resolved payee of the recipient leg reverts ComplianceSanctioned", async function () {
      const { facets, scr, complianceErrors, owner, admin, custodian2, envelopeId, recoveryId } =
        await pendingFiatSetup();

      // env.recipient (custodian1) is in recovery; the release gate resolves it
      // to the successor custodian2, who is network-blocked.
      await armSanctions(scr, owner);
      await blockWallet(scr, owner, custodian2);

      await expect(facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId]))
        .to.be.revertedWithCustomError(complianceErrors, "ComplianceSanctioned")
        .withArgs(custodian2.address);
      expect(await envelopeState(facets, envelopeId)).to.equal(ES_PENDING_FIAT);
    });

    it("unarmed: the same blocked payee does not gate (default-off preserved)", async function () {
      const { facets, scr, owner, admin, custodian2, envelopeId, recoveryId } =
        await pendingFiatSetup();

      await blockWallet(scr, owner, custodian2);

      await facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId]);
      expect(await envelopeState(facets, envelopeId)).to.equal(ES_FINALIZED);
    });

    it("armed: clean parties confirm-fiat normally", async function () {
      const { facets, scr, owner, admin, envelopeId, recoveryId } = await pendingFiatSetup();

      await armSanctions(scr, owner);

      await facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId]);
      expect(await envelopeState(facets, envelopeId)).to.equal(ES_FINALIZED);
    });

    it("requirement controls (CIP) also gate the bulk release — the precheck is the full gate, not sanctions-only", async function () {
      const { facets, complianceErrors, diamondAddress, owner, admin, custodian1, envelopeId, recoveryId } =
        await pendingFiatSetup();

      // Arm CIP only (sanctions counter stays 0). precheckEscrowRelease routes
      // through precheckGated, so the requirement side must fire too. The
      // requirement check reads the RAW `to` (env.recipient), unlike the
      // sanctions side which payee-resolves through recovery.
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamondAddress);
      const CIP = ethers.keccak256(ethers.toUtf8Bytes("cip_enforce_active"));
      await pol.connect(owner).setNetworkPolicy(CIP, 1);

      await expect(facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId]))
        .to.be.revertedWithCustomError(complianceErrors, "ComplianceCIPRequired")
        .withArgs(custodian1.address, 2);
      expect(await envelopeState(facets, envelopeId)).to.equal(ES_PENDING_FIAT);
    });

    it("batch atomicity: an ungated leg processed first is rolled back when a later gated leg reverts; retry resolves both", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, scr, complianceErrors, owner, admin, user1, custodian1, custodian2 } = ctx;
      const amountA = ethers.parseEther("50");
      const amountB = ethers.parseEther("100");

      // Envelope A: plain, will be reversed (choice 1, ungated in 3.2).
      const envA = await createEnvelope(facets, owner, user1, custodian1, amountA, 0);
      // Envelope B: FIAT_INSTITUTIONAL pending fiat, will be confirm-fiat'd (choice 3, gated).
      const envB = await createEnvelope(facets, owner, user1, custodian1, amountB, ST_FIAT_INSTITUTIONAL);
      await facets.envelope.connect(custodian1).finalizeEnvelope(envB);

      const recoveryId = await startRecovery(facets, admin, custodian1, custodian2);
      await facets.walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, envA, 1);
      await facets.walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, envB, 3);

      await armSanctions(scr, owner);
      await blockWallet(scr, owner, custodian2);

      // A processes first (reverse pays user1), then B's gate reverts —
      // the whole batch must roll back, leaving A untouched.
      const balBefore = await facets.erc20.balanceOf(user1.address);
      await expect(facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envA, envB]))
        .to.be.revertedWithCustomError(complianceErrors, "ComplianceSanctioned")
        .withArgs(custodian2.address);
      expect(await envelopeState(facets, envA)).to.equal(ES_CREATED);
      expect(await envelopeState(facets, envB)).to.equal(ES_PENDING_FIAT);
      expect(await facets.erc20.balanceOf(user1.address)).to.equal(balBefore);

      // Authority clears the block; the retry resolves both items.
      await scr.connect(owner).clearNetworkBlock(custodian2.address, ethers.keccak256(ethers.toUtf8Bytes("false-positive")));
      await facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envA, envB]);
      expect(await envelopeState(facets, envA)).to.equal(ES_REVERSED);
      expect(await envelopeState(facets, envB)).to.equal(ES_FINALIZED);
      expect(await facets.erc20.balanceOf(user1.address)).to.equal(balBefore + amountA);
    });
  });

  describe("resolveCambioNotesBulk actions 1/2 (note escrow release)", function () {
    async function cambioNoteSetup() {
      const ctx = await loadFixture(fixture);
      const { facets, owner, admin, user1, custodian1 } = ctx;

      await grantRole(facets.accessControl, ROLES.CAMBIO_ADMIN_ROLE, admin.address, owner);
      await grantRole(facets.accessControl, ROLES.CAMBIO_ISSUER_ROLE, user1.address, owner);
      await facets.cambioIssuer.connect(admin).registerIssuer(user1.address);
      await facets.cambioEnvelope.connect(admin).advanceCambioPhase();
      await facets.cambioAdmin.connect(admin).setCambioEnvelopeConfig(
        ethers.parseEther("1000"), 3600, 86400, 2048, ethers.parseEther("1000"), 7200, false
      );

      const noteAmount = ethers.parseEther("10");
      await facets.mintBurn.connect(owner).mint(user1.address, noteAmount);
      const latest = await ethers.provider.getBlock("latest");
      const phraseCommitment = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["string", "bytes32"],
          ["phrase", ethers.hexlify(ethers.randomBytes(32))]
        )
      );
      const txNote = await facets.cambioEnvelope.connect(user1).createCambioNote(
        noteAmount, phraseCommitment, ethers.hexlify(ethers.randomBytes(32)), latest.timestamp + 86400, "meta"
      );
      const receiptNote = await txNote.wait();
      const noteEvent = receiptNote.logs.find(
        (l) => l.fragment && l.fragment.name === "CambioEnvelopeNoteCreated"
      );
      const noteId = noteEvent.args.noteId;

      // Recovery on the note issuer; escrow releases resolve to custodian1.
      const recoveryId = await startRecovery(facets, admin, user1, custodian1);
      return { ...ctx, noteId, recoveryId, noteAmount };
    }

    it("armed: blocked resolved payee parks a compliance hold instead of reverting (Task 4.4/D2, action 1)", async function () {
      const { facets, scr, holdLib, owner, admin, custodian1, noteId, recoveryId } =
        await cambioNoteSetup();

      await armSanctions(scr, owner);
      await blockWallet(scr, owner, custodian1);

      await expect(facets.walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [noteId], [1]))
        .to.emit(holdLib, "CompliancePayoutHeld")
        .and.to.emit(holdLib, "RecoveryBulkItemHeld")
        .withArgs(recoveryId, CAMBIO_NOTE_DOMAIN, noteId);

      // Escrow retained; the note is untouched pending admin disposition.
      const note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
      expect(note.active).to.be.true;
      expect(await facets.erc20.balanceOf(custodian1.address)).to.equal(0);

      // Replay hits the 0xFF sentinel and emits the dedicated held event,
      // not action=254 from the generic idempotent skip (LOW-2).
      await expect(facets.walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [noteId], [1]))
        .to.emit(holdLib, "RecoveryBulkItemHeld")
        .withArgs(recoveryId, CAMBIO_NOTE_DOMAIN, noteId);
      expect(await facets.erc20.balanceOf(custodian1.address)).to.equal(0);
    });

    it("armed: parked hold (action 2 mirror) stays non-bulk-actionable after admin pay-to-alternate", async function () {
      const { facets, scr, holdLib, owner, admin, custodian1, custodian2, noteId, recoveryId, noteAmount } =
        await cambioNoteSetup();

      await armSanctions(scr, owner);
      await blockWallet(scr, owner, custodian1);

      await expect(facets.walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [noteId], [2]))
        .to.emit(holdLib, "RecoveryBulkItemHeld")
        .withArgs(recoveryId, CAMBIO_NOTE_DOMAIN, noteId);
      let note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
      expect(note.active).to.be.true;

      // Admin disposition pays a clean alternate and completes the cancel-shaped
      // leg (requestedAction=2 is non-redemption, so the note deactivates).
      // Mid-recovery the effective issuer's profile is not migrated yet, so
      // the counter decrement clamps and emits the audit event (kimi Sprint 4
      // exit LOW-2) instead of panicking.
      const dispositionTx = facets.envelope.connect(owner).resolveComplianceHold(
        CAMBIO_NOTE_DOMAIN, noteId, OUTCOME_PAY_ALTERNATE, custodian2.address
      );
      await expect(dispositionTx).to.emit(holdLib, "ComplianceHoldResolved");
      await expect(dispositionTx).to.emit(holdLib, "ComplianceHoldNoteProfileClamped");
      expect(await facets.erc20.balanceOf(custodian2.address)).to.equal(noteAmount);
      note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
      expect(note.active).to.be.false;

      // The sentinel persists after resolution: the item stays out of bulk reach.
      await expect(facets.walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [noteId], [2]))
        .to.emit(holdLib, "RecoveryBulkItemHeld")
        .withArgs(recoveryId, CAMBIO_NOTE_DOMAIN, noteId);
      expect(await facets.erc20.balanceOf(custodian2.address)).to.equal(noteAmount);
    });

    it("unarmed: the same blocked payee releases (default-off preserved)", async function () {
      const { facets, scr, owner, admin, custodian1, noteId, recoveryId, noteAmount } =
        await cambioNoteSetup();

      await blockWallet(scr, owner, custodian1);

      await expect(facets.walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [noteId], [1]))
        .to.emit(facets.walletRecovery, "RecoveryCambioNoteResolved")
        .withArgs(recoveryId, noteId, 1, noteAmount, false);
      expect(await facets.erc20.balanceOf(custodian1.address)).to.equal(noteAmount);
    });

    it("armed: clean payee releases under CAMBIO_NOTE_DOMAIN (action 2, C-F2 regression)", async function () {
      const { facets, scr, owner, admin, custodian1, noteId, recoveryId, noteAmount } =
        await cambioNoteSetup();

      await armSanctions(scr, owner);

      // A revert here with EscrowNotActive would mean the release regressed to
      // ENVELOPE_DOMAIN (C-F2); success + payee balance proves the domain held.
      await expect(facets.walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [noteId], [2]))
        .to.emit(facets.walletRecovery, "RecoveryCambioNoteResolved")
        .withArgs(recoveryId, noteId, 2, noteAmount, false);
      expect(await facets.erc20.balanceOf(custodian1.address)).to.equal(noteAmount);
    });
  });

  describe("Task 4.4: reverse/clawback refund legs park compliance holds (D2)", function () {
    it("choice 1 reverse to an armed+blocked sender parks a hold; sentinel replay emits the dedicated event", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, scr, holdLib, owner, admin, user1, custodian1, custodian2 } = ctx;
      const amount = ethers.parseEther("50");

      const envelopeId = await createEnvelope(facets, owner, user1, custodian1, amount, 0);
      const recoveryId = await startRecovery(facets, admin, custodian1, custodian2);
      await facets.walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, envelopeId, 1);

      await armSanctions(scr, owner);
      await blockWallet(scr, owner, user1);

      // D2: instead of paying a blocked counterparty (3.2 behavior) or reverting
      // the batch, the leg parks an envelope-shaped hold (DISPUTED) for admin
      // disposition. Escrow stays in the diamond.
      await expect(facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId]))
        .to.emit(holdLib, "CompliancePayoutHeld")
        .and.to.emit(holdLib, "RecoveryBulkItemHeld")
        .withArgs(recoveryId, ENVELOPE_DOMAIN, envelopeId);
      expect(await envelopeState(facets, envelopeId)).to.equal(ES_DISPUTED);
      expect(await facets.erc20.balanceOf(user1.address)).to.equal(0);

      // Replay hits the 0xFF sentinel: dedicated event, not choice=254 (LOW-2).
      await expect(facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId]))
        .to.emit(holdLib, "RecoveryBulkItemHeld")
        .withArgs(recoveryId, ENVELOPE_DOMAIN, envelopeId);
      expect(await facets.erc20.balanceOf(user1.address)).to.equal(0);
    });

    it("mixed batch: the held item parks while the clean item resolves; the retry moves no funds", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, scr, holdLib, owner, admin, user1, user2, custodian1, custodian2 } = ctx;
      const amountA = ethers.parseEther("50");
      const amountB = ethers.parseEther("70");

      const envA = await createEnvelope(facets, owner, user1, custodian1, amountA, 0);
      const envB = await createEnvelope(facets, owner, user2, custodian1, amountB, 0);
      const recoveryId = await startRecovery(facets, admin, custodian1, custodian2);
      await facets.walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, envA, 1);
      await facets.walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, envB, 1);

      await armSanctions(scr, owner);
      await blockWallet(scr, owner, user1);

      // Unlike the choice-3 revert (batch atomicity), a parked hold must NOT
      // abort the batch: the clean leg behind it still resolves.
      await expect(facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envA, envB]))
        .to.emit(holdLib, "RecoveryBulkItemHeld")
        .withArgs(recoveryId, ENVELOPE_DOMAIN, envA);
      expect(await envelopeState(facets, envA)).to.equal(ES_DISPUTED);
      expect(await envelopeState(facets, envB)).to.equal(ES_REVERSED);
      expect(await facets.erc20.balanceOf(user1.address)).to.equal(0);
      expect(await facets.erc20.balanceOf(user2.address)).to.equal(amountB);

      // Retry: held item re-emits the dedicated event; the resolved item takes
      // the idempotent replay path. No funds move on either.
      const tx2 = await facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envA, envB]);
      await expect(tx2)
        .to.emit(holdLib, "RecoveryBulkItemHeld")
        .withArgs(recoveryId, ENVELOPE_DOMAIN, envA);
      await expect(tx2)
        .to.emit(facets.walletRecovery, "RecoveryEnvelopeResolved")
        .withArgs(recoveryId, envB, 1, 0, true);
      expect(await facets.erc20.balanceOf(user1.address)).to.equal(0);
      expect(await facets.erc20.balanceOf(user2.address)).to.equal(amountB);
    });

    it("a held SmartLock envelope parks under SMARTLOCK_DOMAIN without aborting the batch", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, scr, holdLib, owner, admin, user1, user2, custodian1, custodian2 } = ctx;
      const amount = ethers.parseEther("25");

      // SmartLock: user1 → custodian1 (escrowed under SMARTLOCK_DOMAIN).
      await facets.mintBurn.connect(owner).mint(user1.address, amount);
      const fragment = ethers.hexlify(ethers.randomBytes(32));
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const txSl = await facets.smartLockEnvelope.connect(user1).createSmartLockEnvelope(
        custodian1.address, amount,
        ethers.keccak256(ethers.concat([fragment, nonce])),
        nonce, (await time.latest()) + 3600, ethers.ZeroAddress
      );
      const receiptSl = await txSl.wait();
      const slIface = new ethers.Interface([
        "event SmartLockEnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, address releaseAuthorizedAddress)"
      ]);
      const slLog = receiptSl.logs.find(l => {
        try { return slIface.parseLog(l) !== null; } catch { return false; }
      });
      const slEnvelopeId = slIface.parseLog(slLog).args.envelopeId;

      const envB = await createEnvelope(facets, owner, user2, custodian1, amount, 0);
      const recoveryId = await startRecovery(facets, admin, custodian1, custodian2);
      await facets.walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, slEnvelopeId, 1);
      await facets.walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, envB, 1);

      await armSanctions(scr, owner);
      await blockWallet(scr, owner, user1);

      // Pre-4.4 the SmartLock cancel-or-hold path reverted the whole batch on a
      // blocked counterparty; now it parks (domain-correct) and the batch continues.
      await expect(facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [slEnvelopeId, envB]))
        .to.emit(holdLib, "RecoveryBulkItemHeld")
        .withArgs(recoveryId, SMARTLOCK_DOMAIN, slEnvelopeId);
      expect(await facets.erc20.balanceOf(user1.address)).to.equal(0);
      expect(await envelopeState(facets, envB)).to.equal(ES_REVERSED);
      expect(await facets.erc20.balanceOf(user2.address)).to.equal(amount);
    });

    it("a hold parked by a single-item leg is skipped by a later bulk pass (isHeld branch, no sentinel)", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, scr, holdLib, diamondAddress, owner, admin, user1, custodian1, custodian2 } = ctx;
      const amount = ethers.parseEther("40");

      // Cut the hold harness (test-only) to park a hold the way a single-item
      // refund leg would — recoveryId=0, so no bulk sentinel is written.
      const HoldLibFactory = await ethers.getContractFactory("ComplianceHoldLib");
      const holdLibDeployment = await HoldLibFactory.deploy();
      await holdLibDeployment.waitForDeployment();
      const Harness = await ethers.getContractFactory("ComplianceHoldHarnessFacet", {
        libraries: { ComplianceHoldLib: await holdLibDeployment.getAddress() },
      });
      const harness = await Harness.deploy();
      await harness.waitForDeployment();
      const selectors = [];
      harness.interface.forEachFunction((fn) => selectors.push(fn.selector));
      await facets.diamondCut.connect(owner).diamondCut(
        [{ facetAddress: await harness.getAddress(), action: 0, functionSelectors: selectors }],
        ethers.ZeroAddress, "0x"
      );
      const hold = await ethers.getContractAt("ComplianceHoldHarnessFacet", diamondAddress);

      const envelopeId = await createEnvelope(facets, owner, user1, custodian1, amount, 0);
      const recoveryId = await startRecovery(facets, admin, custodian1, custodian2);
      await facets.walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, envelopeId, 1);

      await armSanctions(scr, owner);
      await blockWallet(scr, owner, user1);
      await hold.connect(owner).harnessCheckOrHold(
        ENVELOPE_DOMAIN, envelopeId,
        custodian1.address, user1.address, amount,
        CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 0
      );
      expect(await envelopeState(facets, envelopeId)).to.equal(ES_DISPUTED);

      // The bulk pass finds no sentinel but ComplianceHoldLib.isHeld is true —
      // it must skip (emit) rather than pay out the held escrow.
      await expect(facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId]))
        .to.emit(holdLib, "RecoveryBulkItemHeld")
        .withArgs(recoveryId, ENVELOPE_DOMAIN, envelopeId);
      expect(await envelopeState(facets, envelopeId)).to.equal(ES_DISPUTED);
      expect(await facets.erc20.balanceOf(user1.address)).to.equal(0);
    });
  });
});
