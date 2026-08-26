const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { deployT3DiamondFixture, FacetCutAction } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");

/**
 * Sprint 4.1 — ComplianceHoldLib (checkOrHold / resolveComplianceHold),
 * the non-reverting compliance predicate (complianceCheck), and the admin
 * disposition surface on TransferEnvelopeAdminFacet.
 *
 * The hold mechanism is exercised through ComplianceHoldHarnessFacet (test-only,
 * cut per-test, links ComplianceHoldLib) because the production call sites land
 * in Tasks 4.2–4.4. Hold state lives in diamond storage via DELEGATECALL, so the
 * harness's own library instance is irrelevant to the admin facet's linked one.
 */
describe("Sprint 4.1 — compliance holds + non-reverting predicate", function () {
  const ENVELOPE_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes("T3_TRANSFER_ENVELOPE_V1"));
  const CAMBIO_NOTE_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes("T3_CAMBIO_NOTE_V1"));

  const SCREENING_BLOCKED = 3;
  const CTX_ESCROW_RELEASE = 2;
  const ES_CREATED = 1;
  const ES_REVERSED = 3;
  const ES_DISPUTED = 4;
  const HOLD_NONE = 0;
  const HOLD_HELD = 1;
  const HOLD_RESOLVED = 2;
  const OUTCOME_PAY_ORIGINAL = 1;
  const OUTCOME_PAY_ALTERNATE = 2;
  const OUTCOME_BURN = 3;
  const DISP_PAID_ORIGINAL = 1;
  const DISP_PAID_ALTERNATE = 2;
  const DISP_BURNED = 3;

  const REASON_SANCTIONED = ethers.encodeBytes32String("SANCTIONED");
  const REASON_KYC_REQUIRED = ethers.encodeBytes32String("KYC_REQUIRED");
  const REASON_CIP_REQUIRED = ethers.encodeBytes32String("CIP_REQUIRED");

  const KYC_ENFORCE_ACTIVE = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));
  const CIP_ENFORCE_ACTIVE = ethers.keccak256(ethers.toUtf8Bytes("cip_enforce_active"));
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

  const AMT = ethers.parseEther("5");

  function holdKey(domain, objectId) {
    return ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [domain, objectId])
    );
  }

  async function fixture() {
    const base = await deployT3DiamondFixture();
    await setupTestRoles(base.facets, base.signers);
    const { diamondAddress, facets, signers } = base;
    const { owner, admin, user1, user2, user3, custodian1, minter } = signers;

    // Cut the hold harness (test-only; never in the manifest).
    const HoldLib = await ethers.getContractFactory("ComplianceHoldLib");
    const holdLibDeployment = await HoldLib.deploy();
    await holdLibDeployment.waitForDeployment();
    const Harness = await ethers.getContractFactory("ComplianceHoldHarnessFacet", {
      libraries: { ComplianceHoldLib: await holdLibDeployment.getAddress() },
    });
    const harness = await Harness.deploy();
    await harness.waitForDeployment();
    const selectors = [];
    harness.interface.forEachFunction((fn) => selectors.push(fn.selector));
    await facets.diamondCut.connect(owner).diamondCut(
      [{ facetAddress: await harness.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors }],
      ethers.ZeroAddress,
      "0x"
    );

    return {
      diamondAddress,
      facets,
      owner,
      admin,
      minter,
      custodian1,
      addr1: user1,
      addr2: user2,
      addr3: user3,
      scr: facets.complianceScreening,
      pol: facets.institutionPolicy,
      hold: await ethers.getContractAt("ComplianceHoldHarnessFacet", diamondAddress),
      // Hold events/errors are declared in the emitting library; decode through
      // its ABI attached at the diamond address.
      holdLib: await ethers.getContractAt("ComplianceHoldLib", diamondAddress),
    };
  }

  async function armSanctions(f, tag = "HOLD_TEST_INST") {
    const instId = ethers.keccak256(ethers.toUtf8Bytes(tag));
    await f.scr.connect(f.owner).setInstitutionSanctionsEnabled(instId, true);
    return instId;
  }

  async function fund(f, wallet, amount = ethers.parseEther("100")) {
    await f.facets.accessControl.connect(f.owner).grantRole(MINTER_ROLE, f.owner.address);
    await f.facets.mintBurn.connect(f.owner).mint(wallet.address, amount);
    await f.facets.erc20.connect(wallet).approve(f.diamondAddress, amount);
  }

  async function createEnvelope(f, sender, recipient, amount) {
    const commitWindowEnd = (await time.latest()) + 3600;
    const tx = await f.facets.envelope
      .connect(sender)
      .createEnvelope(recipient.address, amount, commitWindowEnd, 0, 0, "0x");
    const receipt = await tx.wait();
    return receipt.logs.find((l) => l.fragment?.name === "EnvelopeCreated").args[0];
  }

  // Standard scenario: clean escrow in, payee blocked afterwards, hold parked.
  async function makeHeldEnvelope(f, amount = AMT) {
    await fund(f, f.addr1);
    const envelopeId = await createEnvelope(f, f.addr1, f.addr2, amount);
    await armSanctions(f);
    await f.scr.connect(f.owner).recordNetworkScreening(f.addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
    await f.hold
      .connect(f.owner)
      .harnessCheckOrHold(
        ENVELOPE_DOMAIN, envelopeId,
        f.addr1.address, f.addr2.address, amount,
        CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 0
      );
    return envelopeId;
  }

  async function makeEligibleSuccessor(f, wallet) {
    await f.facets.custodian.connect(f.owner).grantCustodianRole(wallet.address);
    const expires = (await time.latest()) + 86400;
    await f.facets.custodian.connect(f.custodian1).registerCustodiedWallet(wallet.address, 1, expires);
  }

  // =========================================================================
  // complianceCheck (non-reverting predicate view)
  // =========================================================================
  describe("complianceCheck predicate", function () {
    it("returns ok when nothing is armed, even for a screened-out wallet", async function () {
      const f = await loadFixture(fixture);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      const [ok, failingParty, reasonCode] = await f.facets.complianceGate.complianceCheck(
        f.addr1.address, f.addr2.address, AMT, CTX_ESCROW_RELEASE
      );
      expect(ok).to.equal(true);
      expect(failingParty).to.equal(ethers.ZeroAddress);
      expect(reasonCode).to.equal(ethers.ZeroHash);
    });

    it("returns (false, wallet, SANCTIONED) for a blocked payee when sanctions armed", async function () {
      const f = await loadFixture(fixture);
      await armSanctions(f);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      const [ok, failingParty, reasonCode] = await f.facets.complianceGate.complianceCheck(
        f.addr1.address, f.addr2.address, AMT, CTX_ESCROW_RELEASE
      );
      expect(ok).to.equal(false);
      expect(failingParty).to.equal(f.addr2.address);
      expect(reasonCode).to.equal(REASON_SANCTIONED);
    });

    it("matches enforceCompliance verdicts (predicate/revert parity)", async function () {
      const f = await loadFixture(fixture);
      await armSanctions(f);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      // clean pair: predicate ok, enforce does not revert
      expect((await f.facets.complianceGate.complianceCheck(
        f.addr1.address, f.addr3.address, AMT, CTX_ESCROW_RELEASE
      ))[0]).to.equal(true);
      await expect(f.facets.complianceGate.enforceCompliance(
        f.addr1.address, f.addr3.address, AMT, CTX_ESCROW_RELEASE
      )).not.to.be.reverted;

      // blocked pair: predicate fails, enforce reverts with the mapped error
      expect((await f.facets.complianceGate.complianceCheck(
        f.addr1.address, f.addr2.address, AMT, CTX_ESCROW_RELEASE
      ))[0]).to.equal(false);
      await expect(f.facets.complianceGate.enforceCompliance(
        f.addr1.address, f.addr2.address, AMT, CTX_ESCROW_RELEASE
      )).to.be.revertedWithCustomError(f.facets.complianceGate, "ComplianceSanctioned")
        .withArgs(f.addr2.address);
    });
  });

  // =========================================================================
  // checkOrHold (via harness)
  // =========================================================================
  describe("checkOrHold", function () {
    it("no-ops when nothing is armed (blocked wallet, no scope enabled)", async function () {
      const f = await loadFixture(fixture);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      const objectId = ethers.id("unarmed-object");

      const held = await f.hold.harnessCheckOrHold.staticCall(
        ENVELOPE_DOMAIN, objectId, f.addr1.address, f.addr2.address, AMT,
        CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 0
      );
      expect(held).to.equal(false);
      await f.hold.harnessCheckOrHold(
        ENVELOPE_DOMAIN, objectId, f.addr1.address, f.addr2.address, AMT,
        CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 0
      );
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, objectId)).to.equal(false);
      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(ENVELOPE_DOMAIN, objectId);
      expect(rec.status).to.equal(HOLD_NONE);
    });

    it("passes a clean payee through when sanctions armed", async function () {
      const f = await loadFixture(fixture);
      await armSanctions(f);
      const objectId = ethers.id("clean-object");
      const held = await f.hold.harnessCheckOrHold.staticCall(
        ENVELOPE_DOMAIN, objectId, f.addr1.address, f.addr2.address, AMT,
        CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 0
      );
      expect(held).to.equal(false);
    });

    it("parks a hold for a blocked payee and flips the envelope to DISPUTED", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, AMT);
      await armSanctions(f);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const held = await f.hold.connect(f.owner).harnessCheckOrHold.staticCall(
        ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr2.address, AMT,
        CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 7
      );
      expect(held).to.equal(true);

      await expect(
        f.hold.connect(f.owner).harnessCheckOrHold(
          ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr2.address, AMT,
          CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 7
        )
      ).to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr2.address, f.addr2.address, REASON_SANCTIONED, AMT);

      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(true);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_DISPUTED);

      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(ENVELOPE_DOMAIN, envelopeId);
      expect(rec.domain).to.equal(ENVELOPE_DOMAIN);
      expect(rec.objectId).to.equal(envelopeId);
      expect(rec.originalPayee).to.equal(f.addr2.address);
      expect(rec.resolvedPayee).to.equal(f.addr2.address);
      expect(rec.failingParty).to.equal(f.addr2.address);
      expect(rec.amount).to.equal(AMT);
      expect(rec.reasonCode).to.equal(REASON_SANCTIONED);
      expect(rec.priorState).to.equal(ES_CREATED);
      expect(rec.requestedAction).to.equal(7);
      expect(rec.status).to.equal(HOLD_HELD);
      expect(rec.heldAt).to.be.greaterThan(0);

      const [keys, total] = await f.facets.envelope.connect(f.owner).activeComplianceHolds(0, 10);
      expect(total).to.equal(1);
      expect(keys[0]).to.equal(holdKey(ENVELOPE_DOMAIN, envelopeId));
    });

    it("reverts ComplianceHoldActive when the object is already held", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      await expect(
        f.hold.connect(f.owner).harnessCheckOrHold(
          ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr2.address, AMT,
          CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 0
        )
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldActive").withArgs(envelopeId);
    });

    it("non-envelope domain holds do not touch envelope state", async function () {
      const f = await loadFixture(fixture);
      await armSanctions(f);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      const noteId = ethers.id("cambio-note-1");
      await f.hold.connect(f.owner).harnessCheckOrHold(
        CAMBIO_NOTE_DOMAIN, noteId, f.addr1.address, f.addr2.address, AMT,
        CTX_ESCROW_RELEASE, ethers.ZeroHash, 0, 0
      );
      expect(await f.hold.harnessIsHeld(CAMBIO_NOTE_DOMAIN, noteId)).to.equal(true);
      // same objectId under the envelope domain is untouched
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, noteId)).to.equal(false);
    });

    // Arming matrix (test spec item 19): each control trips the hold only via
    // its own counter.
    it("KYC-only armed: missing payee KYC parks a KYC_REQUIRED hold", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, AMT);
      await f.pol.connect(f.owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

      await expect(
        f.hold.connect(f.owner).harnessCheckOrHold(
          ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr2.address, AMT,
          CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 0
        )
      ).to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr2.address, f.addr2.address, REASON_KYC_REQUIRED, AMT);
    });

    it("CIP-only armed: missing payee CIP parks a CIP_REQUIRED hold", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, AMT);
      await f.pol.connect(f.owner).setNetworkPolicy(CIP_ENFORCE_ACTIVE, 1);

      await expect(
        f.hold.connect(f.owner).harnessCheckOrHold(
          ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr2.address, AMT,
          CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 0
        )
      ).to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr2.address, f.addr2.address, REASON_CIP_REQUIRED, AMT);
    });
  });

  // =========================================================================
  // resolveComplianceHold (admin disposition via TransferEnvelopeAdminFacet)
  // =========================================================================
  describe("resolveComplianceHold", function () {
    it("reverts ComplianceHoldNotFound for an unknown hold", async function () {
      const f = await loadFixture(fixture);
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, ethers.id("nope"), OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldNotFound");
    });

    it("requires ADMIN: non-admin caller reverts", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      await expect(
        f.facets.envelope.connect(f.addr1).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(f.facets.envelope, "UnauthorizedCaller");
    });

    it("reverts ComplianceHoldUnsupportedDomain for unknown domains", async function () {
      // Task 4.3 landed the Cambio-note disposition branch; only domains with
      // no disposition semantics at all are rejected now.
      const UNKNOWN_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes("T3_UNKNOWN_DOMAIN_V1"));
      const f = await loadFixture(fixture);
      await armSanctions(f);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      const objectId = ethers.id("unknown-object-1");
      await f.hold.connect(f.owner).harnessCheckOrHold(
        UNKNOWN_DOMAIN, objectId, f.addr1.address, f.addr2.address, AMT,
        CTX_ESCROW_RELEASE, ethers.ZeroHash, 0, 0
      );
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          UNKNOWN_DOMAIN, objectId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldUnsupportedDomain").withArgs(UNKNOWN_DOMAIN);
    });

    it("reverts ComplianceHoldInvalidOutcome for an unknown outcome", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(ENVELOPE_DOMAIN, envelopeId, 4, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldInvalidOutcome").withArgs(4);
    });

    it("re-screen fail: payToOriginal blocks without reverting, hold survives, nothing paid (item 5)", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      const balBefore = await f.facets.erc20.balanceOf(f.addr2.address);

      const released = await f.facets.envelope.connect(f.owner).resolveComplianceHold.staticCall(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
      );
      expect(released).to.equal(false);

      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
        )
      ).to.emit(f.holdLib, "ComplianceHoldReleaseBlocked")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr2.address, REASON_SANCTIONED);

      expect(await f.facets.erc20.balanceOf(f.addr2.address)).to.equal(balBefore);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(true);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_DISPUTED);
    });

    it("after clearing the block, payToOriginal releases escrow and reverses the envelope", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      await f.scr.connect(f.owner).clearNetworkBlock(f.addr2.address, ethers.id("false-positive"));

      const balBefore = await f.facets.erc20.balanceOf(f.addr2.address);
      const released = await f.facets.envelope.connect(f.owner).resolveComplianceHold.staticCall(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
      );
      expect(released).to.equal(true);

      const tx = f.facets.envelope.connect(f.owner).resolveComplianceHold(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
      );
      await expect(tx).to.emit(f.holdLib, "ComplianceHoldResolved")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, DISP_PAID_ORIGINAL, f.addr2.address, AMT, f.owner.address);
      await expect(tx).to.emit(f.facets.envelope, "EnvelopeReversed")
        .withArgs(envelopeId, AMT, anyValue);

      expect(await f.facets.erc20.balanceOf(f.addr2.address)).to.equal(balBefore + AMT);
      const env = await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId);
      expect(env.state).to.equal(ES_REVERSED);
      expect(env.reversedAmount).to.equal(AMT);

      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(ENVELOPE_DOMAIN, envelopeId);
      expect(rec.status).to.equal(HOLD_RESOLVED);
      expect(rec.disposition).to.equal(DISP_PAID_ORIGINAL);
      expect(rec.resolvedBy).to.equal(f.owner.address);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(false);
      const [, total] = await f.facets.envelope.connect(f.owner).activeComplianceHolds(0, 10);
      expect(total).to.equal(0);
    });

    it("resolving twice reverts ComplianceHoldAlreadyResolved", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      await f.scr.connect(f.owner).clearNetworkBlock(f.addr2.address, ethers.id("clear"));
      await f.facets.envelope.connect(f.owner).resolveComplianceHold(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
      );
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldAlreadyResolved");
    });

    it("payToAlternate: zero payee reverts ComplianceHoldInvalidPayee", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ALTERNATE, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldInvalidPayee");
    });

    it("payToAlternate: blocked alternate is screened and blocked; clean alternate is paid", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);

      // blocked alternate → non-reverting block
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr3.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ALTERNATE, f.addr3.address
        )
      ).to.emit(f.holdLib, "ComplianceHoldReleaseBlocked")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr3.address, REASON_SANCTIONED);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(true);

      // clean alternate → paid, disposition PAID_ALTERNATE
      await f.scr.connect(f.owner).clearNetworkBlock(f.addr3.address, ethers.id("alt-clear"));
      const balBefore = await f.facets.erc20.balanceOf(f.addr3.address);
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ALTERNATE, f.addr3.address
        )
      ).to.emit(f.holdLib, "ComplianceHoldResolved")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, DISP_PAID_ALTERNATE, f.addr3.address, AMT, f.owner.address);
      expect(await f.facets.erc20.balanceOf(f.addr3.address)).to.equal(balBefore + AMT);

      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(ENVELOPE_DOMAIN, envelopeId);
      expect(rec.disposition).to.equal(DISP_PAID_ALTERNATE);
    });

    it("re-screen failure on KYC grounds keeps the hold (item 13)", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      // sanctions block cleared, but KYC now armed and the payee has none
      await f.scr.connect(f.owner).clearNetworkBlock(f.addr2.address, ethers.id("clear"));
      await f.pol.connect(f.owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
        )
      ).to.emit(f.holdLib, "ComplianceHoldReleaseBlocked")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr2.address, REASON_KYC_REQUIRED);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(true);
    });

    it("payee entering recovery between hold and release: payToOriginal pays the successor (item 14)", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      // false-positive cleared; then the payee wallet is recovered to addr3
      await f.scr.connect(f.owner).clearNetworkBlock(f.addr2.address, ethers.id("clear"));
      await makeEligibleSuccessor(f, f.addr3);
      // recovery is bank-wallet scoped: the recovered wallet must hold CUSTODIAN_ROLE
      await f.facets.custodian.connect(f.owner).grantCustodianRole(f.addr2.address);
      const tx = await f.facets.walletRecovery.connect(f.owner).initiateRecovery(f.addr2.address, 0);
      const receipt = await tx.wait();
      const recoveryId = receipt.logs
        .map((l) => { try { return f.facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find((l) => l.name === "RecoveryInitiated").args.recoveryId;
      await f.facets.walletRecovery.connect(f.owner).designateSuccessor(recoveryId, f.addr3.address);

      const oldBal = await f.facets.erc20.balanceOf(f.addr2.address);
      const succBal = await f.facets.erc20.balanceOf(f.addr3.address);
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
        )
      ).to.emit(f.holdLib, "ComplianceHoldResolved")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, DISP_PAID_ORIGINAL, f.addr3.address, AMT, f.owner.address);

      expect(await f.facets.erc20.balanceOf(f.addr2.address)).to.equal(oldBal);
      expect(await f.facets.erc20.balanceOf(f.addr3.address)).to.equal(succBal + AMT);
    });

    it("T7: hold across reversible cancel — payToOriginal re-resolves to the predecessor and re-screens RESTORED records", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      // False-positive cleared: the predecessor's restored posture will be releasable.
      await f.scr.connect(f.owner).clearNetworkBlock(f.addr2.address, ethers.id("clear"));

      // A pre-designation block on the successor would be rejected outright
      // (RecoveryBlockedBySanctions), so the block lands MID-recovery instead.
      await makeEligibleSuccessor(f, f.addr3);
      await f.facets.custodian.connect(f.owner).grantCustodianRole(f.addr2.address);
      const tx = await f.facets.walletRecovery.connect(f.owner).initiateRecovery(f.addr2.address, 0);
      const receipt = await tx.wait();
      const recoveryId = receipt.logs
        .map((l) => { try { return f.facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find((l) => l.name === "RecoveryInitiated").args.recoveryId;
      await f.facets.walletRecovery.connect(f.owner).designateSuccessor(recoveryId, f.addr3.address);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr3.address, SCREENING_BLOCKED, ethers.ZeroHash);

      // Mid-recovery: PAY_ORIGINAL resolves to the blocked successor and is held.
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
        )
      ).to.emit(f.holdLib, "ComplianceHoldReleaseBlocked")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr3.address, REASON_SANCTIONED);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(true);

      // Reversible cancel restores both wallets' designation-time records: the
      // successor's MID-recovery block is discarded with the rest of the
      // designation (DP-5.0-C — cancel means "as if it never happened").
      await f.facets.walletRecovery.connect(f.owner).cancelRecovery(recoveryId);
      expect((await f.scr.getScreening(f.addr3.address)).status).to.equal(0); // NONE

      // PAY_ORIGINAL now re-resolves to the predecessor and re-screens its
      // RESTORED (clean) record — the payout follows the restored posture,
      // not the cancelled successor's.
      const oldBal = await f.facets.erc20.balanceOf(f.addr2.address);
      const succBal = await f.facets.erc20.balanceOf(f.addr3.address);
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
        )
      ).to.emit(f.holdLib, "ComplianceHoldResolved")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, DISP_PAID_ORIGINAL, f.addr2.address, AMT, f.owner.address);

      expect(await f.facets.erc20.balanceOf(f.addr2.address)).to.equal(oldBal + AMT);
      expect(await f.facets.erc20.balanceOf(f.addr3.address)).to.equal(succBal);
    });

    it("wave-panel LOW-2: hold survives a COMPLETED recovery — payToOriginal pays the permanent successor", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      // False-positive cleared, then the payee wallet is FULLY recovered to addr3
      // (not just designated): migrateBalance + completeRecovery. The hold is
      // keyed by envelope, not wallet, so completion must neither strand it nor
      // pay the dead key.
      await f.scr.connect(f.owner).clearNetworkBlock(f.addr2.address, ethers.id("clear"));
      await makeEligibleSuccessor(f, f.addr3);
      await f.facets.custodian.connect(f.owner).grantCustodianRole(f.addr2.address);
      const tx = await f.facets.walletRecovery.connect(f.owner).initiateRecovery(f.addr2.address, 0);
      const receipt = await tx.wait();
      const recoveryId = receipt.logs
        .map((l) => { try { return f.facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find((l) => l.name === "RecoveryInitiated").args.recoveryId;
      await f.facets.walletRecovery.connect(f.owner).designateSuccessor(recoveryId, f.addr3.address);
      await f.facets.walletRecovery.connect(f.owner).migrateBalance(recoveryId, []);
      await f.facets.walletRecovery.connect(f.owner).completeRecovery(recoveryId, []);

      // The hold is still parked and dispositionable after completion.
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(true);

      const oldBal = await f.facets.erc20.balanceOf(f.addr2.address);
      const succBal = await f.facets.erc20.balanceOf(f.addr3.address);
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
        )
      ).to.emit(f.holdLib, "ComplianceHoldResolved")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, DISP_PAID_ORIGINAL, f.addr3.address, AMT, f.owner.address);

      // Payout followed the permanent successor; the dead key got nothing.
      expect(await f.facets.erc20.balanceOf(f.addr2.address)).to.equal(oldBal);
      expect(await f.facets.erc20.balanceOf(f.addr3.address)).to.equal(succBal + AMT);
    });

    it("burn disposition burns escrow without re-screening (a burn pays nobody)", async function () {
      const f = await loadFixture(fixture);
      const envelopeId = await makeHeldEnvelope(f);
      // payee is STILL blocked — burn must proceed anyway
      const supplyBefore = await f.facets.erc20.totalSupply();
      const diamondBal = await f.facets.erc20.balanceOf(f.diamondAddress);

      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_BURN, ethers.ZeroAddress
        )
      ).to.emit(f.holdLib, "ComplianceHoldResolved")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, DISP_BURNED, ethers.ZeroAddress, AMT, f.owner.address);

      expect(await f.facets.erc20.totalSupply()).to.equal(supplyBefore - AMT);
      expect(await f.facets.erc20.balanceOf(f.diamondAddress)).to.equal(diamondBal - AMT);
      const env = await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId);
      expect(env.state).to.equal(ES_REVERSED);
      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(ENVELOPE_DOMAIN, envelopeId);
      expect(rec.disposition).to.equal(DISP_BURNED);
    });

    it("partial-amount hold restores the pre-park state after burn (priorState restore)", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, AMT);
      await armSanctions(f);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      const partial = AMT / 5n; // 1 ether of 5
      await f.hold.connect(f.owner).harnessCheckOrHold(
        ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr2.address, partial,
        CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 0
      );

      const supplyBefore = await f.facets.erc20.totalSupply();
      await f.facets.envelope.connect(f.owner).resolveComplianceHold(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_BURN, ethers.ZeroAddress
      );
      expect(await f.facets.erc20.totalSupply()).to.equal(supplyBefore - partial);

      const env = await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId);
      // Task 4.2: partial disposition restores the priorState snapshot (CREATED here)
      // instead of stranding the envelope in DISPUTED — the remainder stays live.
      expect(env.state).to.equal(ES_CREATED);
      expect(env.reversedAmount).to.equal(partial);
    });
  });

  // =========================================================================
  // Burn dispositions under claim attribution (kimi HIGH-3, item 15)
  // =========================================================================
  describe("burn dispositions with claim attribution", function () {
    const SUPPLY = ethers.parseEther("1000");
    const ENV_AMT = ethers.parseEther("400");

    async function attributedFixture() {
      const f = await loadFixture(fixture);
      // Bootstrap attributed supply (must initialize at zero supply).
      const Harness = await ethers.getContractFactory("IssuanceAccountingHarness");
      const h = await Harness.deploy();
      await h.waitForDeployment();
      const sigs = ["initialize()", "mintAttributed(address,address,uint256)"];
      const selectors = sigs.map((s) => h.interface.getFunction(s).selector);
      await f.facets.diamondCut.connect(f.owner).diamondCut(
        [{ facetAddress: await h.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors }],
        ethers.ZeroAddress, "0x"
      );
      const ha = await ethers.getContractAt("IssuanceAccountingHarness", f.diamondAddress);
      await ha.initialize();
      await ha.mintAttributed(f.minter.address, f.addr1.address, SUPPLY);
      await f.facets.erc20.connect(f.addr1).approve(f.diamondAddress, SUPPLY);

      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, ENV_AMT);
      await armSanctions(f);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      return { f, envelopeId };
    }

    it("partial-amount burn reverts ComplianceHoldPartialBurn (burnEscrow wipes full attribution)", async function () {
      const { f, envelopeId } = await attributedFixture();
      const partial = ENV_AMT / 2n;
      await f.hold.connect(f.owner).harnessCheckOrHold(
        ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr2.address, partial,
        CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 0
      );
      const supplyBefore = await f.facets.erc20.totalSupply();
      const attributedBefore = await f.facets.issuanceControl.getTotalAttributedOutstanding();
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          ENVELOPE_DOMAIN, envelopeId, OUTCOME_BURN, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldPartialBurn").withArgs(envelopeId);
      // a pay disposition remains available for the partial hold
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(true);

      // Conservation delta (kimi Sprint 4 exit test gap): the reverted burn
      // moved nothing — supply and attributed outstanding are byte-identical.
      expect(await f.facets.erc20.totalSupply()).to.equal(supplyBefore);
      expect(await f.facets.issuanceControl.getTotalAttributedOutstanding()).to.equal(attributedBefore);
      expect(supplyBefore).to.equal(attributedBefore);

      // A pay disposition then conserves supply (release, not burn) and keeps
      // supply == attributed outstanding.
      await f.facets.envelope.connect(f.owner).resolveComplianceHold(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ALTERNATE, f.addr3.address
      );
      expect(await f.facets.erc20.balanceOf(f.addr3.address)).to.equal(partial);
      expect(await f.facets.erc20.totalSupply()).to.equal(supplyBefore);
      expect(await f.facets.issuanceControl.getTotalAttributedOutstanding()).to.equal(supplyBefore);
    });

    it("full-amount burn conserves supply == attributed outstanding", async function () {
      const { f, envelopeId } = await attributedFixture();
      await f.hold.connect(f.owner).harnessCheckOrHold(
        ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr2.address, ENV_AMT,
        CTX_ESCROW_RELEASE, ethers.ZeroHash, ES_CREATED, 0
      );
      await f.facets.envelope.connect(f.owner).resolveComplianceHold(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_BURN, ethers.ZeroAddress
      );
      const totalSupply = await f.facets.erc20.totalSupply();
      expect(totalSupply).to.equal(SUPPLY - ENV_AMT);
      expect(await f.facets.issuanceControl.getTotalAttributedOutstanding()).to.equal(totalSupply);
    });
  });

  // =========================================================================
  // View ACL on the admin surface
  // =========================================================================
  describe("view access control", function () {
    it("getComplianceHold and activeComplianceHolds are operator-only", async function () {
      const f = await loadFixture(fixture);
      await expect(
        f.facets.envelope.connect(f.addr1).getComplianceHold(ENVELOPE_DOMAIN, ethers.id("x"))
      ).to.be.revertedWithCustomError(f.facets.envelope, "UnauthorizedViewer");
      await expect(
        f.facets.envelope.connect(f.addr1).activeComplianceHolds(0, 10)
      ).to.be.revertedWithCustomError(f.facets.envelope, "UnauthorizedViewer");
    });

    it("activeComplianceHolds pages correctly", async function () {
      const f = await loadFixture(fixture);
      await armSanctions(f);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      const ids = [ethers.id("h1"), ethers.id("h2"), ethers.id("h3")];
      for (const id of ids) {
        await f.hold.connect(f.owner).harnessCheckOrHold(
          CAMBIO_NOTE_DOMAIN, id, f.addr1.address, f.addr2.address, AMT,
          CTX_ESCROW_RELEASE, ethers.ZeroHash, 0, 0
        );
      }
      const [page1, total1] = await f.facets.envelope.connect(f.owner).activeComplianceHolds(0, 2);
      expect(total1).to.equal(3);
      expect(page1.length).to.equal(2);
      const [page2, total2] = await f.facets.envelope.connect(f.owner).activeComplianceHolds(2, 2);
      expect(total2).to.equal(3);
      expect(page2.length).to.equal(1);
      const [page3] = await f.facets.envelope.connect(f.owner).activeComplianceHolds(5, 2);
      expect(page3.length).to.equal(0);
      const all = new Set([...page1, ...page2]);
      for (const id of ids) expect(all.has(holdKey(CAMBIO_NOTE_DOMAIN, id))).to.equal(true);
    });
  });

  // =========================================================================
  // Task 4.2 — production refund-leg wiring (D2)
  // Every sender-refund leg routes through checkOrHold BEFORE mutating state.
  // =========================================================================
  describe("Task 4.2 — refund-leg hold wiring", function () {
    const SMARTLOCK_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes("T3_SMARTLOCK_ENVELOPE_V1"));

    const ES_FINALIZED = 2;
    const ES_PENDING_FIAT = 6;
    const EB_ORACLE_CONDITIONAL = 3;
    const EB_AUTO_REVERSE = 4;
    const ST_FIAT_INSTITUTIONAL = 1;
    const DO_REVERSE_TO_SENDER = 1;
    const DO_PARTIAL_SPLIT = 2;

    const LEG_EXPIRY_AUTO_REVERSE = 10;
    const LEG_ORACLE_REVERSE = 11;
    const LEG_DISPUTE_REFUND = 12;
    const LEG_REVERSE = 13;
    const LEG_CLAWBACK = 14;
    const LEG_SMARTLOCK_CANCEL = 15;

    async function createEnvelopeWith(f, sender, recipient, amount, settlementType, behavior, data = "0x") {
      const commitWindowEnd = (await time.latest()) + 3600;
      const tx = await f.facets.envelope
        .connect(sender)
        .createEnvelope(recipient.address, amount, commitWindowEnd, settlementType, behavior, data);
      const receipt = await tx.wait();
      return receipt.logs.find((l) => l.fragment?.name === "EnvelopeCreated").args[0];
    }

    // Refund legs pay env.sender — arm sanctions and block the SENDER
    // (after envelope creation, so the ESCROW_IN leg passes cleanly).
    async function blockSender(f) {
      await armSanctions(f);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr1.address, SCREENING_BLOCKED, ethers.ZeroHash);
    }

    it("resolveDispute DO_REVERSE: screened-out sender parks a hold; disposition pays after clearing", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, AMT);
      await f.facets.envelope.connect(f.addr1).raiseDispute(envelopeId, "0x01");
      await blockSender(f);

      const senderBal = await f.facets.erc20.balanceOf(f.addr1.address);
      const diamondBal = await f.facets.erc20.balanceOf(f.diamondAddress);

      const tx = f.facets.envelope.connect(f.owner).resolveDispute(envelopeId, DO_REVERSE_TO_SENDER, 0);
      await expect(tx).to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr1.address, REASON_SANCTIONED, AMT);
      await expect(tx).to.emit(f.facets.envelope, "DisputeResolved");

      // Nothing paid; escrow intact; envelope parked in DISPUTED
      expect(await f.facets.erc20.balanceOf(f.addr1.address)).to.equal(senderBal);
      expect(await f.facets.erc20.balanceOf(f.diamondAddress)).to.equal(diamondBal);
      const env = await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId);
      expect(env.state).to.equal(ES_DISPUTED);
      expect(env.reversedAmount).to.equal(0);

      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(ENVELOPE_DOMAIN, envelopeId);
      expect(rec.requestedAction).to.equal(LEG_DISPUTE_REFUND);
      expect(rec.priorState).to.equal(ES_DISPUTED);

      // Clear the block → payToOriginal releases the refund to the sender
      await f.scr.connect(f.owner).clearNetworkBlock(f.addr1.address, ethers.id("cleared"));
      await f.facets.envelope.connect(f.owner).resolveComplianceHold(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
      );
      expect(await f.facets.erc20.balanceOf(f.addr1.address)).to.equal(senderBal + AMT);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_REVERSED);
    });

    it("held envelope blocks resolveDispute — including the post-timeout default path (Q2, item 11)", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, AMT);
      await f.facets.envelope.connect(f.addr1).raiseDispute(envelopeId, "0x01");
      await blockSender(f);
      await f.facets.envelope.connect(f.owner).resolveDispute(envelopeId, DO_REVERSE_TO_SENDER, 0);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(true);

      // Admin retry blocked while held
      await expect(
        f.facets.envelope.connect(f.owner).resolveDispute(envelopeId, DO_REVERSE_TO_SENDER, 0)
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldActive").withArgs(envelopeId);

      // Post-timeout defaultOutcome path (anyone can trigger) is ALSO blocked —
      // it would otherwise pay the screened-out sender.
      await time.increase(8 * 24 * 3600); // > 7-day default dispute timeout
      const diamondBal = await f.facets.erc20.balanceOf(f.diamondAddress);
      await expect(
        f.facets.envelope.connect(f.addr3).resolveDispute(envelopeId, DO_REVERSE_TO_SENDER, 0)
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldActive").withArgs(envelopeId);
      expect(await f.facets.erc20.balanceOf(f.diamondAddress)).to.equal(diamondBal);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_DISPUTED);
    });

    it("PARTIAL_SPLIT: recipient portion settles, sender portion parks; disposition restores FINALIZED", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, AMT);
      await f.facets.envelope.connect(f.addr1).raiseDispute(envelopeId, "0x01");

      // KYC (ESCROW_RELEASE) screens only the payee: KYC the recipient so the
      // forward leg settles, leave the sender un-KYC'd so the refund leg parks.
      const expires = (await time.latest()) + 86400;
      await f.facets.custodian.connect(f.custodian1).registerCustodiedWallet(f.addr2.address, 1, expires);
      await f.pol.connect(f.owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

      const split = ethers.parseEther("3");
      const senderPortion = AMT - split;
      const recipientBal = await f.facets.erc20.balanceOf(f.addr2.address);

      const tx = f.facets.envelope.connect(f.owner).resolveDispute(envelopeId, DO_PARTIAL_SPLIT, split);
      await expect(tx).to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr1.address, REASON_KYC_REQUIRED, senderPortion);

      expect(await f.facets.erc20.balanceOf(f.addr2.address)).to.equal(recipientBal + split);
      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(ENVELOPE_DOMAIN, envelopeId);
      expect(rec.amount).to.equal(senderPortion);
      expect(rec.priorState).to.equal(ES_FINALIZED); // state was set before the refund leg ran
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_DISPUTED);

      // Burn disposition: partial reversal restores the FINALIZED snapshot
      await f.facets.envelope.connect(f.owner).resolveComplianceHold(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_BURN, ethers.ZeroAddress
      );
      const env = await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId);
      expect(env.state).to.equal(ES_FINALIZED);
      expect(env.reversedAmount).to.equal(senderPortion);
    });

    it("receiveOracleCallback(false): screened-out sender parks instead of reversing", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelopeWith(f, f.addr1, f.addr2, AMT, 0, EB_ORACLE_CONDITIONAL, "0x01");
      await f.facets.envelope.connect(f.owner).registerOracle(envelopeId, f.addr3.address, "0x12345678");
      await blockSender(f);

      const tx = f.facets.envelope.connect(f.addr3).receiveOracleCallback(envelopeId, false);
      await expect(tx).to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr1.address, REASON_SANCTIONED, AMT);
      await expect(tx).not.to.emit(f.facets.envelope, "EnvelopeReversed");

      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(ENVELOPE_DOMAIN, envelopeId);
      expect(rec.requestedAction).to.equal(LEG_ORACLE_REVERSE);
      expect(rec.priorState).to.equal(ES_CREATED);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_DISPUTED);
    });

    it("processExpiration AUTO_REVERSE: screened-out sender parks", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelopeWith(f, f.addr1, f.addr2, AMT, 0, EB_AUTO_REVERSE);
      await blockSender(f);
      await time.increase(3700);

      const senderBal = await f.facets.erc20.balanceOf(f.addr1.address);
      const tx = f.facets.envelope.connect(f.addr3).processExpiration(envelopeId);
      await expect(tx).to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr1.address, REASON_SANCTIONED, AMT);
      await expect(tx).not.to.emit(f.facets.envelope, "EnvelopeReversed");

      expect(await f.facets.erc20.balanceOf(f.addr1.address)).to.equal(senderBal);
      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(ENVELOPE_DOMAIN, envelopeId);
      expect(rec.requestedAction).to.equal(LEG_EXPIRY_AUTO_REVERSE);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_DISPUTED);
    });

    it("finalizeEnvelope after AUTO_REVERSE window: parks and returns without settling", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelopeWith(f, f.addr1, f.addr2, AMT, 0, EB_AUTO_REVERSE);
      await blockSender(f);
      await time.increase(3700);

      const recipientBal = await f.facets.erc20.balanceOf(f.addr2.address);
      const tx = f.facets.envelope.connect(f.addr2).finalizeEnvelope(envelopeId);
      await expect(tx).to.emit(f.holdLib, "CompliancePayoutHeld");
      await expect(tx).not.to.emit(f.facets.envelope, "EnvelopeFinalized");

      // Neither party paid: the hold parked and finalize returned without settling
      expect(await f.facets.erc20.balanceOf(f.addr2.address)).to.equal(recipientBal);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_DISPUTED);
    });

    it("reverseEnvelope (full): parks BEFORE reversal accounting; burn disposition reverses", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, AMT);
      await blockSender(f);

      await expect(f.facets.envelope.connect(f.addr1).reverseEnvelope(envelopeId, AMT))
        .to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr1.address, REASON_SANCTIONED, AMT);

      let env = await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId);
      expect(env.reversedAmount).to.equal(0); // accounting untouched at park time
      expect(env.state).to.equal(ES_DISPUTED);
      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(ENVELOPE_DOMAIN, envelopeId);
      expect(rec.requestedAction).to.equal(LEG_REVERSE);
      expect(rec.priorState).to.equal(ES_CREATED);

      await f.facets.envelope.connect(f.owner).resolveComplianceHold(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_BURN, ethers.ZeroAddress
      );
      env = await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId);
      expect(env.state).to.equal(ES_REVERSED);
      expect(env.reversedAmount).to.equal(AMT);
    });

    it("reverseEnvelope (partial): disposition restores CREATED and the remainder still finalizes", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, AMT);
      await blockSender(f);

      const partial = ethers.parseEther("2");
      await f.facets.envelope.connect(f.addr1).reverseEnvelope(envelopeId, partial);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(true);

      await f.facets.envelope.connect(f.owner).resolveComplianceHold(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_BURN, ethers.ZeroAddress
      );
      let env = await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId);
      expect(env.state).to.equal(ES_CREATED); // priorState restore keeps the remainder live
      expect(env.reversedAmount).to.equal(partial);

      // Clear the sender (the forward settle screens both parties) and finalize the rest
      await f.scr.connect(f.owner).clearNetworkBlock(f.addr1.address, ethers.id("cleared"));
      const recipientBal = await f.facets.erc20.balanceOf(f.addr2.address);
      await f.facets.envelope.connect(f.addr2).finalizeEnvelope(envelopeId);
      expect(await f.facets.erc20.balanceOf(f.addr2.address)).to.equal(recipientBal + AMT - partial);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_FINALIZED);
    });

    it("clawbackSettlement: screened-out sender parks with the PENDING_FIAT snapshot", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelopeWith(f, f.addr1, f.addr2, AMT, ST_FIAT_INSTITUTIONAL, 0);
      await f.facets.envelope.connect(f.addr1).finalizeEnvelope(envelopeId);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_PENDING_FIAT);
      await blockSender(f);

      await expect(f.facets.envelope.connect(f.owner).clawbackSettlement(envelopeId))
        .to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(ENVELOPE_DOMAIN, envelopeId, f.addr1.address, f.addr1.address, REASON_SANCTIONED, AMT);

      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(ENVELOPE_DOMAIN, envelopeId);
      expect(rec.requestedAction).to.equal(LEG_CLAWBACK);
      expect(rec.priorState).to.equal(ES_PENDING_FIAT);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_DISPUTED);

      // Clearing + payToOriginal completes the clawback to the sender
      await f.scr.connect(f.owner).clearNetworkBlock(f.addr1.address, ethers.id("cleared"));
      const senderBal = await f.facets.erc20.balanceOf(f.addr1.address);
      await f.facets.envelope.connect(f.owner).resolveComplianceHold(
        ENVELOPE_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
      );
      expect(await f.facets.erc20.balanceOf(f.addr1.address)).to.equal(senderBal + AMT);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_REVERSED);
    });

    it("SmartLock cancel: parks under SMARTLOCK_DOMAIN; disposition releases the SmartLock escrow", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);

      const fragment = ethers.id("secret-fragment");
      const nonce = ethers.id("nonce-1");
      const commitment = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [fragment, nonce]);
      const cwe = (await time.latest()) + 3600;
      const smartLock = f.facets.smartLockEnvelope;
      const tx0 = await smartLock.connect(f.addr1).createSmartLockEnvelope(
        f.addr2.address, AMT, commitment, nonce, cwe, ethers.ZeroAddress
      );
      const receipt = await tx0.wait();
      const envelopeId = receipt.logs.find((l) => l.fragment?.name === "SmartLockEnvelopeCreated").args[0];

      await blockSender(f);
      const tx = smartLock.connect(f.addr1).cancelSmartLockEnvelope(envelopeId);
      await expect(tx).to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(SMARTLOCK_DOMAIN, envelopeId, f.addr1.address, f.addr1.address, REASON_SANCTIONED, AMT);
      await expect(tx).not.to.emit(smartLock, "SmartLockEnvelopeCancelled");

      // Domain isolation: held under SMARTLOCK, not ENVELOPE
      expect(await f.hold.harnessIsHeld(SMARTLOCK_DOMAIN, envelopeId)).to.equal(true);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(false);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_DISPUTED);

      // Re-cancel is blocked by the DISPUTED park state
      await expect(
        smartLock.connect(f.addr1).cancelSmartLockEnvelope(envelopeId)
      ).to.be.revertedWithCustomError(smartLock, "EnvelopeNotInState");

      // Clear + payToOriginal: releases the SMARTLOCK_DOMAIN escrow to the sender
      await f.scr.connect(f.owner).clearNetworkBlock(f.addr1.address, ethers.id("cleared"));
      const senderBal = await f.facets.erc20.balanceOf(f.addr1.address);
      await f.facets.envelope.connect(f.owner).resolveComplianceHold(
        SMARTLOCK_DOMAIN, envelopeId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
      );
      expect(await f.facets.erc20.balanceOf(f.addr1.address)).to.equal(senderBal + AMT);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_REVERSED);
      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(SMARTLOCK_DOMAIN, envelopeId);
      expect(rec.requestedAction).to.equal(LEG_SMARTLOCK_CANCEL);
    });

    it("armed with clean parties: refund legs pay normally (no hold)", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, AMT);
      await armSanctions(f); // armed, nobody blocked

      const senderBal = await f.facets.erc20.balanceOf(f.addr1.address);
      await expect(f.facets.envelope.connect(f.addr1).reverseEnvelope(envelopeId, AMT))
        .to.emit(f.facets.envelope, "EnvelopeReversed");
      expect(await f.facets.erc20.balanceOf(f.addr1.address)).to.equal(senderBal + AMT);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(false);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_REVERSED);
    });

    it("nothing armed: a blocked sender is still paid (holds require an armed control)", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelope(f, f.addr1, f.addr2, AMT);
      // blocked but NOT armed
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr1.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const senderBal = await f.facets.erc20.balanceOf(f.addr1.address);
      await f.facets.envelope.connect(f.addr1).reverseEnvelope(envelopeId, AMT);
      expect(await f.facets.erc20.balanceOf(f.addr1.address)).to.equal(senderBal + AMT);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(false);
    });

    // Per-leg unarmed short-circuit coverage (kimi Sprint 4 exit test gap):
    // each remaining refund leg pays a blocked-but-unarmed sender normally.

    it("nothing armed: SmartLock cancel pays a blocked sender normally (leg 15 short-circuit)", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);

      const fragment = ethers.id("secret-fragment");
      const nonce = ethers.id("nonce-1");
      const commitment = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [fragment, nonce]);
      const cwe = (await time.latest()) + 3600;
      const smartLock = f.facets.smartLockEnvelope;
      const tx0 = await smartLock.connect(f.addr1).createSmartLockEnvelope(
        f.addr2.address, AMT, commitment, nonce, cwe, ethers.ZeroAddress
      );
      const receipt = await tx0.wait();
      const envelopeId = receipt.logs.find((l) => l.fragment?.name === "SmartLockEnvelopeCreated").args[0];

      // blocked but NOT armed
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr1.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const senderBal = await f.facets.erc20.balanceOf(f.addr1.address);
      await expect(smartLock.connect(f.addr1).cancelSmartLockEnvelope(envelopeId))
        .to.emit(smartLock, "SmartLockEnvelopeCancelled");
      expect(await f.facets.erc20.balanceOf(f.addr1.address)).to.equal(senderBal + AMT);
      expect(await f.hold.harnessIsHeld(SMARTLOCK_DOMAIN, envelopeId)).to.equal(false);
    });

    it("nothing armed: receiveOracleCallback(false) reverses to a blocked sender normally (leg 11 short-circuit)", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelopeWith(f, f.addr1, f.addr2, AMT, 0, EB_ORACLE_CONDITIONAL, "0x01");
      await f.facets.envelope.connect(f.owner).registerOracle(envelopeId, f.addr3.address, "0x12345678");
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr1.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const senderBal = await f.facets.erc20.balanceOf(f.addr1.address);
      await expect(f.facets.envelope.connect(f.addr3).receiveOracleCallback(envelopeId, false))
        .to.emit(f.facets.envelope, "EnvelopeReversed");
      expect(await f.facets.erc20.balanceOf(f.addr1.address)).to.equal(senderBal + AMT);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(false);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_REVERSED);
    });

    it("nothing armed: processExpiration AUTO_REVERSE pays a blocked sender normally (leg 10 short-circuit)", async function () {
      const f = await loadFixture(fixture);
      await fund(f, f.addr1);
      const envelopeId = await createEnvelopeWith(f, f.addr1, f.addr2, AMT, 0, EB_AUTO_REVERSE);
      await f.scr.connect(f.owner).recordNetworkScreening(f.addr1.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await time.increase(3700);

      const senderBal = await f.facets.erc20.balanceOf(f.addr1.address);
      await expect(f.facets.envelope.connect(f.addr3).processExpiration(envelopeId))
        .to.emit(f.facets.envelope, "EnvelopeReversed");
      expect(await f.facets.erc20.balanceOf(f.addr1.address)).to.equal(senderBal + AMT);
      expect(await f.hold.harnessIsHeld(ENVELOPE_DOMAIN, envelopeId)).to.equal(false);
      expect((await f.facets.envelope.connect(f.owner).getEnvelope(envelopeId)).state).to.equal(ES_REVERSED);
    });
  });

  // =========================================================================
  // Task 4.3 — Cambio note-domain holds (cancel + redemption legs)
  // =========================================================================

  describe("Task 4.3 — Cambio note-domain holds", function () {
    const CAMBIO_ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CAMBIO_ADMIN_ROLE"));
    const CAMBIO_ISSUER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CAMBIO_ISSUER_ROLE"));
    const CAMBIO_REDEEMER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CAMBIO_REDEEMER_ROLE"));
    const LEG_NOTE_CANCEL = 20;
    const LEG_NOTE_REDEMPTION = 21;
    const NOTE_DEADLINE_OFFSET = 80000;

    // Issuer = addr1; note escrow lives under CAMBIO_NOTE_DOMAIN.
    async function setupCambioNote(f, amount = AMT, opts = {}) {
      const issuer = f.addr1;
      await f.facets.accessControl.connect(f.owner).grantRole(CAMBIO_ADMIN_ROLE, f.admin.address);
      await f.facets.accessControl.connect(f.owner).grantRole(CAMBIO_ISSUER_ROLE, issuer.address);
      await f.facets.cambioIssuer.connect(f.admin).registerIssuer(issuer.address);
      await f.facets.cambioEnvelope.connect(f.admin).advanceCambioPhase();
      await f.facets.cambioAdmin.connect(f.admin).setCambioEnvelopeConfig(
        ethers.parseEther("100"), // maxNoteValue
        3600,                     // minDeadlineBuffer
        86400,                    // maxDeadlineWindow
        2048,                     // maxMetadataLength
        ethers.parseEther("1000"),// commitRevealThreshold (never triggered here)
        7200,                     // maxCommitLifetime
        false                     // cambioPaused
      );
      if (opts.attributed) {
        // Conservation-guard tests need claim attribution armed: bootstrap
        // attributed supply via the issuance harness (same pattern as the
        // envelope burn-disposition fixture above) instead of legacy mint,
        // which credits no wallet-claim buckets.
        const Harness = await ethers.getContractFactory("IssuanceAccountingHarness");
        const h = await Harness.deploy();
        await h.waitForDeployment();
        const sigs = ["initialize()", "mintAttributed(address,address,uint256)"];
        const selectors = sigs.map((s) => h.interface.getFunction(s).selector);
        await f.facets.diamondCut.connect(f.owner).diamondCut(
          [{ facetAddress: await h.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors }],
          ethers.ZeroAddress, "0x"
        );
        const ha = await ethers.getContractAt("IssuanceAccountingHarness", f.diamondAddress);
        await ha.initialize();
        await ha.mintAttributed(f.minter.address, issuer.address, ethers.parseEther("100"));
        await f.facets.erc20.connect(issuer).approve(f.diamondAddress, ethers.parseEther("100"));
      } else {
        await fund(f, issuer, ethers.parseEther("100"));
      }
      const deadline = (await time.latest()) + NOTE_DEADLINE_OFFSET;
      const tx = await f.facets.cambioEnvelope.connect(issuer).createCambioNote(
        amount, ethers.id("commitment"), ethers.id("salt"), deadline, ""
      );
      const receipt = await tx.wait();
      const noteId = receipt.logs.find((l) => l.fragment?.name === "CambioEnvelopeNoteCreated").args.noteId;
      return { issuer, noteId };
    }

    async function grantRedeemer(f, wallet) {
      await f.facets.accessControl.connect(f.owner).grantRole(CAMBIO_REDEEMER_ROLE, wallet.address);
    }

    async function blockWallet(f, wallet) {
      await armSanctions(f);
      await f.scr.connect(f.owner).recordNetworkScreening(wallet.address, SCREENING_BLOCKED, ethers.ZeroHash);
    }

    it("blocked effective issuer: cancelEnvelopeNote parks the remaining escrow (leg 20)", async function () {
      const f = await loadFixture(fixture);
      const { issuer, noteId } = await setupCambioNote(f);
      await blockWallet(f, issuer);

      const issuerBal = await f.facets.erc20.balanceOf(issuer.address);
      const tx = f.facets.cambioEnvelope.connect(issuer).cancelEnvelopeNote(noteId);
      await expect(tx)
        .to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(CAMBIO_NOTE_DOMAIN, noteId, issuer.address, issuer.address, REASON_SANCTIONED, AMT);
      await expect(tx).to.not.emit(f.facets.cambioEnvelope, "CambioEnvelopeNoteCancelled");

      // Q3: note state and issuer counters untouched until disposition.
      const note = await f.facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
      expect(note.active).to.equal(true);
      const profile = await f.facets.cambioEnvelope.getIssuerEnvelopeProfile(issuer.address);
      expect(profile.notesOutstanding).to.equal(1);
      expect(profile.valueOutstanding).to.equal(AMT);
      expect(profile.t3usdCancelled).to.equal(0);
      expect(await f.facets.erc20.balanceOf(issuer.address)).to.equal(issuerBal);

      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(CAMBIO_NOTE_DOMAIN, noteId);
      expect(rec.status).to.equal(HOLD_HELD);
      expect(rec.requestedAction).to.equal(LEG_NOTE_CANCEL);
      expect(rec.priorState).to.equal(1);
      expect(rec.amount).to.equal(AMT);
      expect(rec.originalPayee).to.equal(issuer.address);
    });

    it("held note: cancel, role redemption, and issuer self-recovery all revert ComplianceHoldActive (items 3 + 12)", async function () {
      const f = await loadFixture(fixture);
      const { issuer, noteId } = await setupCambioNote(f);
      await blockWallet(f, issuer);
      await f.facets.cambioEnvelope.connect(issuer).cancelEnvelopeNote(noteId);

      // Re-cancel
      await expect(
        f.facets.cambioEnvelope.connect(issuer).cancelEnvelopeNote(noteId)
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldActive").withArgs(noteId);

      // Role-gated redemption
      await grantRedeemer(f, f.addr3);
      await expect(
        f.facets.cambioEnvelope.connect(f.addr3).redeemByNoteId(noteId, AMT, 1, "")
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldActive").withArgs(noteId);

      // Issuer self-recovery past the deadline (the :295 path)
      await time.increase(NOTE_DEADLINE_OFFSET + 1);
      await expect(
        f.facets.cambioEnvelope.connect(issuer).redeemByNoteId(noteId, AMT, 2, "")
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldActive").withArgs(noteId);
    });

    it("blocked redeemer: partial redemption parks without touching note state (leg 21)", async function () {
      const f = await loadFixture(fixture);
      const { issuer, noteId } = await setupCambioNote(f);
      await grantRedeemer(f, f.addr3);
      await blockWallet(f, f.addr3);

      const part = ethers.parseEther("2");
      const tx = f.facets.cambioEnvelope.connect(f.addr3).redeemByNoteId(noteId, part, 1, "");
      await expect(tx)
        .to.emit(f.holdLib, "CompliancePayoutHeld")
        .withArgs(CAMBIO_NOTE_DOMAIN, noteId, f.addr3.address, f.addr3.address, REASON_SANCTIONED, part);
      await expect(tx).to.not.emit(f.facets.cambioEnvelope, "CambioEnvelopeNoteRedeemed");

      const note = await f.facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
      expect(note.active).to.equal(true);
      expect(note.spent).to.equal(0);
      expect(await f.facets.erc20.balanceOf(f.addr3.address)).to.equal(0);

      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(CAMBIO_NOTE_DOMAIN, noteId);
      expect(rec.status).to.equal(HOLD_HELD);
      expect(rec.requestedAction).to.equal(LEG_NOTE_REDEMPTION);
      expect(rec.originalPayee).to.equal(f.addr3.address);

      // The redemption nonce stays consumed: same nonce is replay-blocked later.
      const profile = await f.facets.cambioEnvelope.getIssuerEnvelopeProfile(issuer.address);
      expect(profile.t3usdRedeemed).to.equal(0);
    });

    it("payToOriginal on a redemption hold completes the leg; note remains redeemable for the rest", async function () {
      const f = await loadFixture(fixture);
      const { issuer, noteId } = await setupCambioNote(f);
      await grantRedeemer(f, f.addr3);
      await blockWallet(f, f.addr3);
      const part = ethers.parseEther("2");
      await f.facets.cambioEnvelope.connect(f.addr3).redeemByNoteId(noteId, part, 1, "");

      await f.scr.connect(f.owner).clearNetworkBlock(f.addr3.address, ethers.id("cleared"));
      const tx = f.facets.envelope.connect(f.owner).resolveComplianceHold(
        CAMBIO_NOTE_DOMAIN, noteId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
      );
      await expect(tx)
        .to.emit(f.holdLib, "ComplianceHoldResolved")
        .withArgs(CAMBIO_NOTE_DOMAIN, noteId, DISP_PAID_ORIGINAL, f.addr3.address, part, f.owner.address);
      expect(await f.facets.erc20.balanceOf(f.addr3.address)).to.equal(part);

      // Disposition applied redemption-shaped accounting.
      const note = await f.facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
      expect(note.active).to.equal(true);
      expect(note.spent).to.equal(part);
      const profile = await f.facets.cambioEnvelope.getIssuerEnvelopeProfile(issuer.address);
      expect(profile.t3usdRedeemed).to.equal(part);
      expect(profile.valueOutstanding).to.equal(AMT - part);
      expect(profile.notesOutstanding).to.equal(1);

      // The consumed nonce cannot be replayed…
      await expect(
        f.facets.cambioEnvelope.connect(f.addr3).redeemByNoteId(noteId, AMT - part, 1, "")
      ).to.be.revertedWithCustomError(f.facets.cambioEnvelope, "NonceAlreadySpent");
      // …but a fresh nonce redeems the remainder and closes the note.
      await f.facets.cambioEnvelope.connect(f.addr3).redeemByNoteId(noteId, AMT - part, 2, "");
      expect(await f.facets.erc20.balanceOf(f.addr3.address)).to.equal(AMT);
      const closed = await f.facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
      expect(closed.active).to.equal(false);
      expect((await f.facets.cambioEnvelope.getIssuerEnvelopeProfile(issuer.address)).notesOutstanding).to.equal(0);
    });

    it("re-screen fail on a note hold blocks without reverting; hold survives (Q6)", async function () {
      const f = await loadFixture(fixture);
      const { noteId } = await setupCambioNote(f);
      await grantRedeemer(f, f.addr3);
      await blockWallet(f, f.addr3);
      await f.facets.cambioEnvelope.connect(f.addr3).redeemByNoteId(noteId, AMT, 1, "");

      const released = await f.facets.envelope.connect(f.owner).resolveComplianceHold.staticCall(
        CAMBIO_NOTE_DOMAIN, noteId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
      );
      expect(released).to.equal(false);
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          CAMBIO_NOTE_DOMAIN, noteId, OUTCOME_PAY_ORIGINAL, ethers.ZeroAddress
        )
      ).to.emit(f.holdLib, "ComplianceHoldReleaseBlocked");

      expect(await f.facets.erc20.balanceOf(f.addr3.address)).to.equal(0);
      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(CAMBIO_NOTE_DOMAIN, noteId);
      expect(rec.status).to.equal(HOLD_HELD);
    });

    it("payToAlternate resolves a cancel hold while the issuer stays blocked (escape hatch)", async function () {
      const f = await loadFixture(fixture);
      const { issuer, noteId } = await setupCambioNote(f);
      await blockWallet(f, issuer);
      await f.facets.cambioEnvelope.connect(issuer).cancelEnvelopeNote(noteId);

      // Cancel-leg re-screen uses from = address(0), so only the alternate
      // payee is screened — a still-sanctioned issuer cannot wedge disposition.
      const tx = f.facets.envelope.connect(f.owner).resolveComplianceHold(
        CAMBIO_NOTE_DOMAIN, noteId, OUTCOME_PAY_ALTERNATE, f.addr3.address
      );
      await expect(tx)
        .to.emit(f.holdLib, "ComplianceHoldResolved")
        .withArgs(CAMBIO_NOTE_DOMAIN, noteId, DISP_PAID_ALTERNATE, f.addr3.address, AMT, f.owner.address);
      // Invariant (kimi Sprint 4 exit LOW-2): with a normal (non-recovery)
      // profile the disposition must NOT clamp — a clamp here means drift.
      await expect(tx).not.to.emit(f.holdLib, "ComplianceHoldNoteProfileClamped");
      expect(await f.facets.erc20.balanceOf(f.addr3.address)).to.equal(AMT);

      // Disposition applied cancel-shaped accounting and closed the note.
      const note = await f.facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
      expect(note.active).to.equal(false);
      const profile = await f.facets.cambioEnvelope.getIssuerEnvelopeProfile(issuer.address);
      expect(profile.notesOutstanding).to.equal(0);
      expect(profile.valueOutstanding).to.equal(0);
      expect(profile.t3usdCancelled).to.equal(AMT);
    });

    it("burn disposition of a cancel hold destroys the escrow and ends the note terminal (Q7)", async function () {
      const f = await loadFixture(fixture);
      const { issuer, noteId } = await setupCambioNote(f);
      await blockWallet(f, issuer);
      await f.facets.cambioEnvelope.connect(issuer).cancelEnvelopeNote(noteId);

      const supplyBefore = await f.facets.erc20.totalSupply();
      const issuerBal = await f.facets.erc20.balanceOf(issuer.address);
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          CAMBIO_NOTE_DOMAIN, noteId, OUTCOME_BURN, ethers.ZeroAddress
        )
      )
        .to.emit(f.holdLib, "ComplianceHoldResolved")
        .withArgs(CAMBIO_NOTE_DOMAIN, noteId, DISP_BURNED, ethers.ZeroAddress, AMT, f.owner.address);

      expect(await f.facets.erc20.totalSupply()).to.equal(supplyBefore - AMT);
      expect(await f.facets.erc20.balanceOf(issuer.address)).to.equal(issuerBal);
      const note = await f.facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
      expect(note.active).to.equal(false);
      const rec = await f.facets.envelope.connect(f.owner).getComplianceHold(CAMBIO_NOTE_DOMAIN, noteId);
      expect(rec.status).to.equal(HOLD_RESOLVED);
      expect(rec.disposition).to.equal(DISP_BURNED);
    });

    it("burn of a partial redemption hold reverts ComplianceHoldPartialBurn (conservation)", async function () {
      const f = await loadFixture(fixture);
      // The guard is gated on claims.initialized: burnEscrow wipes the whole
      // attribution record, so a partial burn would strand the remainder.
      const { noteId } = await setupCambioNote(f, AMT, { attributed: true });
      await grantRedeemer(f, f.addr3);
      await blockWallet(f, f.addr3);
      await f.facets.cambioEnvelope.connect(f.addr3).redeemByNoteId(noteId, ethers.parseEther("2"), 1, "");

      const supplyBefore = await f.facets.erc20.totalSupply();
      const attributedBefore = await f.facets.issuanceControl.getTotalAttributedOutstanding();
      await expect(
        f.facets.envelope.connect(f.owner).resolveComplianceHold(
          CAMBIO_NOTE_DOMAIN, noteId, OUTCOME_BURN, ethers.ZeroAddress
        )
      ).to.be.revertedWithCustomError(f.holdLib, "ComplianceHoldPartialBurn").withArgs(noteId);
      // pay dispositions remain available for the parked partial leg
      expect(await f.hold.harnessIsHeld(CAMBIO_NOTE_DOMAIN, noteId)).to.equal(true);

      // Conservation delta (kimi Sprint 4 exit test gap): nothing burned,
      // nothing paid — supply and attributed outstanding unchanged and equal.
      expect(await f.facets.erc20.totalSupply()).to.equal(supplyBefore);
      expect(await f.facets.issuanceControl.getTotalAttributedOutstanding()).to.equal(attributedBefore);
      expect(supplyBefore).to.equal(attributedBefore);
    });

    it("armed + clean parties: cancel and redemption pay normally (no hold)", async function () {
      const f = await loadFixture(fixture);
      const { issuer, noteId } = await setupCambioNote(f);
      await grantRedeemer(f, f.addr3);
      await armSanctions(f);

      const part = ethers.parseEther("2");
      await expect(f.facets.cambioEnvelope.connect(f.addr3).redeemByNoteId(noteId, part, 1, ""))
        .to.emit(f.facets.cambioEnvelope, "CambioEnvelopeNoteRedeemed");
      expect(await f.facets.erc20.balanceOf(f.addr3.address)).to.equal(part);

      const issuerBal = await f.facets.erc20.balanceOf(issuer.address);
      await expect(f.facets.cambioEnvelope.connect(issuer).cancelEnvelopeNote(noteId))
        .to.emit(f.facets.cambioEnvelope, "CambioEnvelopeNoteCancelled")
        .withArgs(noteId, issuer.address, AMT - part);
      expect(await f.facets.erc20.balanceOf(issuer.address)).to.equal(issuerBal + AMT - part);
      expect(await f.hold.harnessIsHeld(CAMBIO_NOTE_DOMAIN, noteId)).to.equal(false);
    });

    it("unarmed + blocked parties: cancel pays normally (gate short-circuit)", async function () {
      const f = await loadFixture(fixture);
      const { issuer, noteId } = await setupCambioNote(f);
      // Blocked but sanctions never armed anywhere → checkOrHold short-circuits.
      await f.scr.connect(f.owner).recordNetworkScreening(issuer.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const issuerBal = await f.facets.erc20.balanceOf(issuer.address);
      await expect(f.facets.cambioEnvelope.connect(issuer).cancelEnvelopeNote(noteId))
        .to.emit(f.facets.cambioEnvelope, "CambioEnvelopeNoteCancelled");
      expect(await f.facets.erc20.balanceOf(issuer.address)).to.equal(issuerBal + AMT);
      expect(await f.hold.harnessIsHeld(CAMBIO_NOTE_DOMAIN, noteId)).to.equal(false);
    });
  });
});
