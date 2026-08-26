const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");

// Task 5.3 (DP-5.0-A/B/C): snapshot-journal restore on reversible cancel,
// irreversibility flip via manual migrate helpers. Design spec §6 T2/T3/T4/T5/T7.
describe("Task 5.3 — wallet recovery snapshot/restore (reversible cancel)", function () {
  const SCREENING_NONE = 0;
  const SCREENING_CLEAR = 1;
  const SCREENING_FLAGGED = 2;
  const SCREENING_BLOCKED = 3;

  const AFFILIATION_SUSPENDED = 2;

  const RS_CANCELLED = 4;

  const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));
  const KYC_KEY = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));
  const CIP_KEY = ethers.keccak256(ethers.toUtf8Bytes("cip_enforce_active"));
  const TRT_KEY = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_threshold_usd"));
  const DUAL_KEY = ethers.keccak256(ethers.toUtf8Bytes("dual_approval_threshold_usd"));
  const POLICY_KEYS = [KYC_KEY, CIP_KEY, TRT_KEY, DUAL_KEY];

  async function fixture() {
    const base = await deployT3DiamondFixture();
    await setupTestRoles(base.facets, base.signers);
    const { diamond, facets, signers } = base;
    const { owner, admin, user1, user2, custodian1 } = signers;
    const addr = diamond.target ?? diamond.address;

    const reg = await ethers.getContractAt("InstitutionRegistryFacet", addr);
    const scr = await ethers.getContractAt("ComplianceScreeningFacet", addr);
    const pol = await ethers.getContractAt("InstitutionPolicyFacet", addr);
    const cfg = await ethers.getContractAt("ComplianceConfigFacet", addr);
    const iwr = await ethers.getContractAt("IWalletRecovery", addr);
    const trf = await ethers.getContractAt("ComplianceTravelRuleFacet", addr);

    return {
      facets, owner, admin, user1, user2, custodian1,
      oldWallet: custodian1, newWallet: admin,
      reg, scr, pol, cfg, iwr, trf,
    };
  }

  async function makeEligibleSuccessor(facets, owner, custodian, wallet) {
    await facets.custodian.connect(owner).grantCustodianRole(wallet.address);
    const expires = Math.floor(Date.now() / 1000) + 86400;
    await facets.custodian.connect(custodian).registerCustodiedWallet(wallet.address, 1, expires);
  }

  async function initiateRecovery(facets, owner, oldWallet, recoveryType = 0) {
    const tx = await facets.walletRecovery.connect(owner).initiateRecovery(oldWallet.address, recoveryType);
    const rec = await tx.wait();
    return rec.logs
      .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
      .filter(Boolean).find(l => l.name === "RecoveryInitiated").args.recoveryId;
  }

  async function registerInstitution(reg, owner, name) {
    const tx = await reg.connect(owner).registerInstitution(name, ethers.ZeroHash, "", owner.address);
    const rec = await tx.wait();
    return rec.logs
      .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
      .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;
  }

  // Field-by-field snapshot of every journaled family for one wallet,
  // captured through public views so restore can be asserted bit-identical.
  async function snapState(ctx, instId, w) {
    const { facets, scr, reg, pol, trf } = ctx;
    const out = {
      screening: [...(await scr.getScreening(w))],
      clearance: [...(await scr.getNetworkClearance(w))],
      affiliation: [...(await reg.getWalletAffiliation(w))],
      cip: [...(await facets.custodian.getCIP(w))],
      pendingTravelRule: [...(await trf.getPendingTravelRule(w))],
      policies: {},
    };
    if (instId) {
      out.scoped = [...(await scr.getScopedScreening(instId, w))];
      out.scopedMember = await scr.isWalletScopedInstitution(w, instId);
    }
    for (const k of POLICY_KEYS) {
      out.policies[k] = [...(await pol.getWalletPolicyValue(w, k))];
    }
    if (facets.cambioEnvelope) {
      out.profile = [...(await facets.cambioEnvelope.getIssuerEnvelopeProfile(w))];
      const [buckets, hour] = await facets.cambioEnvelope.getIssuerCeilingBuckets(w);
      out.buckets = [...buckets];
      out.bucketHour = hour;
    }
    return out;
  }

  describe("T2 — reversible cancel restores every family bit-identical", function () {
    it("predecessor and successor return to their exact pre-designation state", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, admin, user2, custodian1, oldWallet, newWallet, reg, scr, pol, cfg } = ctx;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      // Institution scaffolding for scoped screening + affiliation.
      const instId = await registerInstitution(reg, owner, "SnapInstA");
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instId);

      // Family 1+2: network screening + clearance (block, clear, leaving a populated clearance tuple).
      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await scr.connect(owner).clearNetworkBlock(oldWallet.address, ethers.keccak256(ethers.toUtf8Bytes("cleared-ok")));
      // Family 3: affiliation (Suspended — migrates most-restrictively but does not block designation).
      await reg.connect(owner).linkWalletToInstitution(oldWallet.address, instId);
      await reg.connect(owner).setWalletAffiliationStatus(oldWallet.address, AFFILIATION_SUSPENDED);
      // Family 4: scoped screening.
      await scr.connect(owner).recordScopedScreening(instId, oldWallet.address, SCREENING_FLAGGED, ethers.ZeroHash);
      // Family 5: wallet policies (enforcement + non-enforcement keys).
      await pol.connect(owner).setWalletPolicy(oldWallet.address, KYC_KEY, 1);
      await pol.connect(owner).setWalletPolicy(oldWallet.address, DUAL_KEY, ethers.parseUnits("100", 18));
      // Family 6: CIP record (register oldWallet under custodian1 so it can carry one).
      const expires = Math.floor(Date.now() / 1000) + 86400;
      await facets.custodian.connect(custodian1).registerCustodiedWallet(oldWallet.address, 1, expires);
      await facets.custodian.connect(custodian1).recordCIP(oldWallet.address, ethers.keccak256(ethers.toUtf8Bytes("cip-old")));
      // Family 7: Cambio issuer envelope profile (sponsor-endorsed registration).
      await grantRole(facets.accessControl, ROLES.CAMBIO_ADMIN_ROLE, admin.address, owner);
      await grantRole(facets.accessControl, ROLES.SPONSOR_BANK_ADMIN_ROLE, admin.address, owner);
      await facets.sponsorBank.connect(admin).registerSponsorBank(user2.address, "SNAP_BANK", 100);
      await facets.cambioIssuer.connect(user2).endorseNonBankIssuer(oldWallet.address);
      await facets.cambioIssuer.connect(admin)["registerIssuer(address,address)"](oldWallet.address, user2.address);

      const preOld = await snapState(ctx, instId, oldWallet.address);
      const preNew = await snapState(ctx, instId, newWallet.address);
      const preKycCount = await cfg.kycScopeCount();

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // Mid-state sanity: the migration actually moved things.
      expect((await scr.getScopedScreening(instId, newWallet.address)).status).to.equal(SCREENING_FLAGGED);
      expect(await facets.custodian.hasCIP(newWallet.address)).to.equal(true);
      expect((await facets.cambioEnvelope.getIssuerEnvelopeProfile(newWallet.address)).isActive).to.equal(true);

      await facets.walletRecovery.connect(owner).cancelRecovery(recoveryId);

      expect(await snapState(ctx, instId, oldWallet.address)).to.deep.equal(preOld);
      expect(await snapState(ctx, instId, newWallet.address)).to.deep.equal(preNew);
      expect(await cfg.kycScopeCount()).to.equal(preKycCount);

      const rec = await facets.walletRecovery.getRecovery(recoveryId);
      expect(rec.state).to.equal(RS_CANCELLED);
      expect(rec.newWallet).to.equal(ethers.ZeroAddress);
    });
  });

  describe("T3 — manual migrate helpers flip the recovery irreversible (DP-5.0-B)", function () {
    async function activeRecovery(ctx) {
      const { facets, owner, custodian1, oldWallet, newWallet, scr } = ctx;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);
      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_FLAGGED, ethers.ZeroHash);
      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);
      return recoveryId;
    }

    async function assertIrreversibleAfterCancel(ctx, recoveryId) {
      const { facets, owner, oldWallet, newWallet, scr } = ctx;
      await facets.walletRecovery.connect(owner).cancelRecovery(recoveryId);
      const rec = await facets.walletRecovery.getRecovery(recoveryId);
      expect(rec.state).to.equal(RS_CANCELLED);
      // Successor mapping preserved — no restore happened.
      expect(rec.newWallet).to.equal(newWallet.address);
      expect((await scr.getScreening(newWallet.address)).status).to.equal(SCREENING_FLAGGED);
      expect((await scr.getScreening(oldWallet.address)).status).to.equal(SCREENING_NONE);
    }

    it("migrateConsortiumState emits RecoveryStateMigrated and blocks restore", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, iwr } = ctx;
      const recoveryId = await activeRecovery(ctx);

      await expect(facets.walletRecovery.connect(owner).migrateConsortiumState(recoveryId, [], []))
        .to.emit(iwr, "RecoveryStateMigrated")
        .withArgs(recoveryId, ethers.encodeBytes32String("Consortium"));

      await assertIrreversibleAfterCancel(ctx, recoveryId);
    });

    it("migrateInstitutionState emits RecoveryStateMigrated and blocks restore", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, iwr } = ctx;
      const recoveryId = await activeRecovery(ctx);

      await expect(facets.walletRecovery.connect(owner).migrateInstitutionState(recoveryId, [], [], []))
        .to.emit(iwr, "RecoveryStateMigrated")
        .withArgs(recoveryId, ethers.encodeBytes32String("Institution"));

      await assertIrreversibleAfterCancel(ctx, recoveryId);
    });

    it("migrateDepositorIdentityState emits RecoveryStateMigrated and blocks restore", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, iwr } = ctx;
      const recoveryId = await activeRecovery(ctx);

      await expect(facets.walletRecovery.connect(owner).migrateDepositorIdentityState(recoveryId, 1))
        .to.emit(iwr, "RecoveryStateMigrated")
        .withArgs(recoveryId, ethers.encodeBytes32String("DepositorIdentity"));

      await assertIrreversibleAfterCancel(ctx, recoveryId);
    });
  });

  describe("T4 — redirect chain: predecessor, S1, and S2 all restore bit-identical", function () {
    it("designate S1, redirect S2, reversible cancel restores all three wallets", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, user1, custodian1, oldWallet, newWallet: s1, scr, pol, cfg } = ctx;
      const s2 = user1;
      await makeEligibleSuccessor(facets, owner, custodian1, s1);
      await makeEligibleSuccessor(facets, owner, custodian1, s2);

      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_FLAGGED, ethers.ZeroHash);
      await pol.connect(owner).setWalletPolicy(oldWallet.address, KYC_KEY, 1);
      // Pre-seed S2 with its own (looser) record so its restore is meaningful.
      await scr.connect(owner).recordNetworkScreening(s2.address, SCREENING_CLEAR, ethers.ZeroHash);

      const preOld = await snapState(ctx, null, oldWallet.address);
      const preS1 = await snapState(ctx, null, s1.address);
      const preS2 = await snapState(ctx, null, s2.address);
      const preKycCount = await cfg.kycScopeCount();

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, s1.address);
      await facets.walletRecovery.connect(owner).redirectSuccessor(recoveryId, s2.address);

      // Mid-state sanity: state chained old -> S1 -> S2.
      expect((await scr.getScreening(s2.address)).status).to.equal(SCREENING_FLAGGED);
      expect((await scr.getScreening(s1.address)).status).to.equal(SCREENING_NONE);
      const [s2Kyc, s2Set] = await pol.getWalletPolicyValue(s2.address, KYC_KEY);
      expect(s2Kyc).to.equal(1n);
      expect(s2Set).to.equal(true);

      await facets.walletRecovery.connect(owner).cancelRecovery(recoveryId);

      expect(await snapState(ctx, null, oldWallet.address)).to.deep.equal(preOld);
      expect(await snapState(ctx, null, s1.address)).to.deep.equal(preS1);
      expect(await snapState(ctx, null, s2.address)).to.deep.equal(preS2);
      expect(await cfg.kycScopeCount()).to.equal(preKycCount);
    });
  });

  describe("T5 — pre-seeded stricter successor: merge keeps stricter, cancel restores both originals", function () {
    it("scoped BLOCKED successor + TRT thresholds merge then restore exactly", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, custodian1, oldWallet, newWallet, reg, scr, pol } = ctx;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const instId = await registerInstitution(reg, owner, "SnapInstB");
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instId);

      // Successor is STRICTER on both families.
      await scr.connect(owner).recordScopedScreening(instId, oldWallet.address, SCREENING_CLEAR, ethers.ZeroHash);
      await scr.connect(owner).recordScopedScreening(instId, newWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await pol.connect(owner).setNetworkPolicy(TRT_KEY, ethers.parseUnits("1000000", 18));
      await pol.connect(owner).setWalletPolicy(oldWallet.address, TRT_KEY, ethers.parseUnits("500", 18));
      await pol.connect(owner).setWalletPolicy(newWallet.address, TRT_KEY, ethers.parseUnits("200", 18));

      const preOld = await snapState(ctx, instId, oldWallet.address);
      const preNew = await snapState(ctx, instId, newWallet.address);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // Merge kept the stricter successor values.
      expect((await scr.getScopedScreening(instId, newWallet.address)).status).to.equal(SCREENING_BLOCKED);
      expect((await scr.getScopedScreening(instId, oldWallet.address)).status).to.equal(SCREENING_NONE);
      const [trtVal] = await pol.getWalletPolicyValue(newWallet.address, TRT_KEY);
      expect(trtVal).to.equal(ethers.parseUnits("200", 18));

      await facets.walletRecovery.connect(owner).cancelRecovery(recoveryId);

      expect(await snapState(ctx, instId, oldWallet.address)).to.deep.equal(preOld);
      expect(await snapState(ctx, instId, newWallet.address)).to.deep.equal(preNew);
    });
  });

  describe("T8 — pending travel-rule commitment (wave-panel MED-1, family 8)", function () {
    const OBJ_ENVELOPE = 1;

    it("empty successor: commitment moves at designation; reversible cancel restores both sides bit-identical", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, user2, custodian1, oldWallet, newWallet, trf } = ctx;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const ref = ethers.keccak256(ethers.toUtf8Bytes("tr-family8-move"));
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      const amount = ethers.parseUnits("5", 18);
      await trf.connect(oldWallet).setPendingTravelRule(ref, user2.address, amount, OBJ_ENVELOPE, deadline);

      const preOld = await snapState(ctx, null, oldWallet.address);
      const preNew = await snapState(ctx, null, newWallet.address);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // Move semantics: successor carries the commitment, predecessor is cleared.
      const moved = await trf.getPendingTravelRule(newWallet.address);
      expect(moved.ref).to.equal(ref);
      expect(moved.recipient).to.equal(user2.address);
      expect(moved.amount).to.equal(amount);
      expect((await trf.getPendingTravelRule(oldWallet.address)).ref).to.equal(ethers.ZeroHash);

      await facets.walletRecovery.connect(owner).cancelRecovery(recoveryId);

      expect(await snapState(ctx, null, oldWallet.address)).to.deep.equal(preOld);
      expect(await snapState(ctx, null, newWallet.address)).to.deep.equal(preNew);
    });

    it("occupied successor: the successor keeps its OWN staged commitment and the predecessor's is not dropped", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, user1, user2, custodian1, oldWallet, newWallet, trf } = ctx;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const refOld = ethers.keccak256(ethers.toUtf8Bytes("tr-family8-old"));
      const refNew = ethers.keccak256(ethers.toUtf8Bytes("tr-family8-new"));
      const deadline = Math.floor(Date.now() / 1000) + 86400;
      await trf.connect(oldWallet).setPendingTravelRule(refOld, user2.address, ethers.parseUnits("5", 18), OBJ_ENVELOPE, deadline);
      await trf.connect(newWallet).setPendingTravelRule(refNew, user1.address, ethers.parseUnits("9", 18), OBJ_ENVELOPE, deadline);

      const preOld = await snapState(ctx, null, oldWallet.address);
      const preNew = await snapState(ctx, null, newWallet.address);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // Keep-destination: nothing silently dropped on either side. The stranded
      // predecessor staging is inert (quarantine blocks predecessor creates) and
      // expires at its deadline.
      expect((await trf.getPendingTravelRule(newWallet.address)).ref).to.equal(refNew);
      expect((await trf.getPendingTravelRule(oldWallet.address)).ref).to.equal(refOld);

      await facets.walletRecovery.connect(owner).cancelRecovery(recoveryId);

      expect(await snapState(ctx, null, oldWallet.address)).to.deep.equal(preOld);
      expect(await snapState(ctx, null, newWallet.address)).to.deep.equal(preNew);
    });
  });

  describe("T7 companion — no journal residue after a reversible cancel", function () {
    it("a fresh recovery on the same wallet designates and restores cleanly after a prior cancel", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, custodian1, oldWallet, newWallet, scr } = ctx;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_FLAGGED, ethers.ZeroHash);
      const expires = Math.floor(Date.now() / 1000) + 86400;
      await facets.custodian.connect(custodian1).registerCustodiedWallet(oldWallet.address, 1, expires);
      await facets.custodian.connect(custodian1).recordCIP(oldWallet.address, ethers.keccak256(ethers.toUtf8Bytes("cip-t7")));

      const preOld = await snapState(ctx, null, oldWallet.address);
      const preNew = await snapState(ctx, null, newWallet.address);

      // Round 1: designate + reversible cancel.
      const id1 = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(id1, newWallet.address);
      await facets.walletRecovery.connect(owner).cancelRecovery(id1);
      expect(await snapState(ctx, null, oldWallet.address)).to.deep.equal(preOld);
      expect(await snapState(ctx, null, newWallet.address)).to.deep.equal(preNew);

      // Round 2: a brand-new recovery (fresh recoveryId) must migrate and restore
      // with no interference from the deleted round-1 journal.
      const id2 = await initiateRecovery(facets, owner, oldWallet);
      expect(id2).to.not.equal(id1);
      await facets.walletRecovery.connect(owner).designateSuccessor(id2, newWallet.address);
      expect((await scr.getScreening(newWallet.address)).status).to.equal(SCREENING_FLAGGED);
      expect(await facets.custodian.hasCIP(newWallet.address)).to.equal(true);

      await facets.walletRecovery.connect(owner).cancelRecovery(id2);
      expect(await snapState(ctx, null, oldWallet.address)).to.deep.equal(preOld);
      expect(await snapState(ctx, null, newWallet.address)).to.deep.equal(preNew);
    });
  });
});
