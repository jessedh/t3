const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");

// Task 5.4 (K-F7): read/write symmetry — resolved-view variants must judge the
// recovery-resolved payee like enforcement does, while raw views stay literal.
describe("Task 5.4 — recovery-resolved compliance views (K-F7)", function () {
  const SCREENING_NONE = 0;
  const SCREENING_CLEAR = 1;
  const SCREENING_FLAGGED = 2;
  const SCREENING_BLOCKED = 3;

  const AFFILIATION_ACTIVE = 1;

  const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));
  const KYC_KEY = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));

  async function fixture() {
    const base = await deployT3DiamondFixture();
    await setupTestRoles(base.facets, base.signers);
    const { diamond, facets, signers } = base;
    const { owner, admin, custodian1 } = signers;
    const addr = diamond.target ?? diamond.address;

    const reg = await ethers.getContractAt("InstitutionRegistryFacet", addr);
    const scr = await ethers.getContractAt("ComplianceScreeningFacet", addr);
    const pol = await ethers.getContractAt("InstitutionPolicyFacet", addr);

    return { facets, signers, owner, custodian1, oldWallet: custodian1, newWallet: admin, reg, scr, pol };
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

  async function activeRecoveryFixture() {
    const ctx = await loadFixture(fixture);
    const { facets, owner, custodian1, oldWallet, newWallet, reg, scr, pol } = ctx;
    await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

    const instId = await registerInstitution(reg, owner, "ResolvedViewsInst");
    await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
    await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instId);

    await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_FLAGGED, ethers.ZeroHash);
    await scr.connect(owner).recordScopedScreening(instId, oldWallet.address, SCREENING_FLAGGED, ethers.ZeroHash);
    await reg.connect(owner).linkWalletToInstitution(oldWallet.address, instId);
    await pol.connect(owner).setWalletPolicy(oldWallet.address, KYC_KEY, 1);

    const recoveryId = await initiateRecovery(facets, owner, oldWallet);
    await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);
    return { ...ctx, instId, recoveryId };
  }

  it("identity: with no recovery, resolved views return the wallet's own records", async function () {
    const { owner, oldWallet, scr, pol, reg } = await loadFixture(fixture);
    await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_CLEAR, ethers.ZeroHash);

    const [resolved, screening] = await scr.getResolvedScreening(oldWallet.address);
    expect(resolved).to.equal(oldWallet.address);
    expect(screening.status).to.equal(SCREENING_CLEAR);

    const [polResolved, , source] = await pol.getResolvedEffectivePolicy(oldWallet.address, KYC_KEY);
    expect(polResolved).to.equal(oldWallet.address);
    expect(source).to.equal("network");

    const [affResolved] = await reg.getResolvedWalletAffiliation(oldWallet.address);
    expect(affResolved).to.equal(oldWallet.address);
  });

  it("mid-recovery: resolved views follow the successor while raw views stay literal", async function () {
    const { oldWallet, newWallet, instId, scr, pol, reg } = await activeRecoveryFixture();

    // Raw views on the dead key report nothing (records migrated away).
    expect((await scr.getScreening(oldWallet.address)).status).to.equal(SCREENING_NONE);
    expect((await scr.getScopedScreening(instId, oldWallet.address)).status).to.equal(SCREENING_NONE);
    const [, rawSource] = await pol.getEffectivePolicy(oldWallet.address, KYC_KEY);
    expect(rawSource).to.equal("network");
    expect((await reg.getWalletAffiliation(oldWallet.address)).institutionId).to.equal(ethers.ZeroHash);

    // Resolved views judge the successor's records — matching enforcement.
    const [resolved, screening] = await scr.getResolvedScreening(oldWallet.address);
    expect(resolved).to.equal(newWallet.address);
    expect(screening.status).to.equal(SCREENING_FLAGGED);

    const [scopedResolved, scoped] = await scr.getResolvedScopedScreening(instId, oldWallet.address);
    expect(scopedResolved).to.equal(newWallet.address);
    expect(scoped.status).to.equal(SCREENING_FLAGGED);

    const [polResolved, polValue, polSource] = await pol.getResolvedEffectivePolicy(oldWallet.address, KYC_KEY);
    expect(polResolved).to.equal(newWallet.address);
    expect(polValue).to.equal(1n);
    expect(polSource).to.equal("wallet");

    const [affResolved, affiliation] = await reg.getResolvedWalletAffiliation(oldWallet.address);
    expect(affResolved).to.equal(newWallet.address);
    expect(affiliation.institutionId).to.equal(instId);
    expect(affiliation.status).to.equal(AFFILIATION_ACTIVE);
  });

  it("mid-recovery: isResolvedScreeningBlocked sees a successor-side block, raw does not", async function () {
    const { owner, oldWallet, newWallet, scr } = await activeRecoveryFixture();

    // A block recorded on the successor AFTER designation must be visible
    // through the dead key's resolved view (enforcement would block it too).
    await scr.connect(owner).recordNetworkScreening(newWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);

    expect(await scr.isScreeningBlocked(oldWallet.address)).to.equal(false);
    expect(await scr.isResolvedScreeningBlocked(oldWallet.address)).to.equal(true);
  });

  it("after reversible cancel: resolution collapses back to identity", async function () {
    const { facets, owner, oldWallet, instId, recoveryId, scr, pol, reg } = await activeRecoveryFixture();

    await facets.walletRecovery.connect(owner).cancelRecovery(recoveryId);

    const [resolved, screening] = await scr.getResolvedScreening(oldWallet.address);
    expect(resolved).to.equal(oldWallet.address);
    expect(screening.status).to.equal(SCREENING_FLAGGED);

    const [polResolved, polValue, polSource] = await pol.getResolvedEffectivePolicy(oldWallet.address, KYC_KEY);
    expect(polResolved).to.equal(oldWallet.address);
    expect(polValue).to.equal(1n);
    expect(polSource).to.equal("wallet");

    const [affResolved, affiliation] = await reg.getResolvedWalletAffiliation(oldWallet.address);
    expect(affResolved).to.equal(oldWallet.address);
    expect(affiliation.institutionId).to.equal(instId);
  });

  it("getResolvedCIP follows the successor mid-recovery and collapses after cancel (wave-panel LOW-1)", async function () {
    const ctx = await loadFixture(fixture);
    const { facets, owner, custodian1, oldWallet, newWallet } = ctx;
    await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

    const expires = Math.floor(Date.now() / 1000) + 86400;
    await facets.custodian.connect(custodian1).registerCustodiedWallet(oldWallet.address, 1, expires);
    const hash = ethers.keccak256(ethers.toUtf8Bytes("cip-resolved-view"));
    await facets.custodian.connect(custodian1).recordCIP(oldWallet.address, hash);

    // Identity before recovery.
    let [resolved, completedAt, recordHash] = await facets.custodian.getResolvedCIP(oldWallet.address);
    expect(resolved).to.equal(oldWallet.address);
    expect(completedAt).to.not.equal(0n);
    expect(recordHash).to.equal(hash);

    const recoveryId = await initiateRecovery(facets, owner, oldWallet);
    await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

    // Raw view on the dead key reports nothing (record migrated away);
    // resolved view judges the successor — matching _requireCIP enforcement.
    expect(await facets.custodian.hasCIP(oldWallet.address)).to.equal(false);
    [resolved, completedAt, recordHash] = await facets.custodian.getResolvedCIP(oldWallet.address);
    expect(resolved).to.equal(newWallet.address);
    expect(completedAt).to.not.equal(0n);
    expect(recordHash).to.equal(hash);

    // Reversible cancel: resolution collapses back to identity, record restored.
    await facets.walletRecovery.connect(owner).cancelRecovery(recoveryId);
    [resolved, , recordHash] = await facets.custodian.getResolvedCIP(oldWallet.address);
    expect(resolved).to.equal(oldWallet.address);
    expect(recordHash).to.equal(hash);
  });

  // C-F10 ACL: the resolved views judge the successor's own record, so the
  // successor must be able to read them (carve-out) — but not the dead key's
  // raw record, and strangers get nothing.
  it("C-F10 ACL: recovery successor may read resolved views; raw views and strangers stay gated", async function () {
    const { facets, signers, owner, custodian1, oldWallet, scr } = await loadFixture(fixture);
    const { pauser, user2 } = signers; // pauser = non-operator successor; user2 = stranger

    await makeEligibleSuccessor(facets, owner, custodian1, pauser);
    const recoveryId = await initiateRecovery(facets, owner, oldWallet);
    await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, pauser.address);

    // Successor (not wallet/custodian/operator) reads the dead key's resolved views
    const [resolved] = await scr.connect(pauser).getResolvedScreening(oldWallet.address);
    expect(resolved).to.equal(pauser.address);
    const [scopedResolved] = await scr.connect(pauser).getResolvedScopedScreening(ethers.ZeroHash, oldWallet.address);
    expect(scopedResolved).to.equal(pauser.address);
    expect(await scr.connect(pauser).isResolvedScreeningBlocked(oldWallet.address)).to.equal(false);
    const [cipResolved] = await facets.custodian.connect(pauser).getResolvedCIP(oldWallet.address);
    expect(cipResolved).to.equal(pauser.address);

    // The carve-out does NOT extend to the dead key's raw record
    await expect(scr.connect(pauser).getScreening(oldWallet.address))
      .to.be.revertedWithCustomError(scr, "UnauthorizedViewer")
      .withArgs(pauser.address);

    // Strangers are denied on resolved and raw alike
    await expect(scr.connect(user2).getResolvedScreening(oldWallet.address))
      .to.be.revertedWithCustomError(scr, "UnauthorizedViewer")
      .withArgs(user2.address);
    await expect(scr.connect(user2).getScreening(oldWallet.address))
      .to.be.revertedWithCustomError(scr, "UnauthorizedViewer")
      .withArgs(user2.address);
  });
});
