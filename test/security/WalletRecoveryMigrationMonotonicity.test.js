const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { network } = require("hardhat");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");

describe("Wave 8E remediation — wallet recovery migration monotonicity", function () {
  const SCREENING_NONE = 0;
  const SCREENING_CLEAR = 1;
  const SCREENING_FLAGGED = 2;
  const SCREENING_BLOCKED = 3;

  const AFFILIATION_NONE = 0;
  const AFFILIATION_ACTIVE = 1;
  const AFFILIATION_SUSPENDED = 2;
  const AFFILIATION_REVOKED = 3;

  const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));

  async function fixture() {
    const base = await deployT3DiamondFixture();
    await setupTestRoles(base.facets, base.signers);
    const { diamond, diamondAddress, facets, signers } = base;
    const { owner, admin, user1, user2, custodian1, custodian2 } = signers;
    return { diamond, diamondAddress, facets, owner, admin, addr1: user1, addr2: user2, custodian1, custodian2 };
  }

  async function makeEligibleSuccessor(facets, owner, custodian, wallet) {
    await facets.custodian.connect(owner).grantCustodianRole(wallet.address);
    const validated = 1;
    const expires = Math.floor(Date.now() / 1000) + 86400;
    await facets.custodian.connect(custodian).registerCustodiedWallet(wallet.address, validated, expires);
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

  describe("scoped screening merge — most-restrictive wins", function () {
    it("source BLOCKED + successor CLEAR => successor BLOCKED", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instId = await registerInstitution(reg, owner, "InstA");
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instId);

      // Pre-seed successor with CLEAR.
      await scr.connect(owner).recordScopedScreening(instId, newWallet.address, SCREENING_CLEAR, ethers.ZeroHash);
      // Source is BLOCKED.
      await scr.connect(owner).recordScopedScreening(instId, oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      expect((await scr.getScopedScreening(instId, newWallet.address)).status).to.equal(SCREENING_BLOCKED);
      expect((await scr.getScopedScreening(instId, oldWallet.address)).status).to.equal(SCREENING_NONE);
      expect(await scr.isWalletScopedInstitution(newWallet.address, instId)).to.equal(true);
      expect(await scr.isWalletScopedInstitution(oldWallet.address, instId)).to.equal(false);

      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, false);
    });

    it("source CLEAR + successor BLOCKED => successor stays BLOCKED", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instId = await registerInstitution(reg, owner, "InstB");
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instId);

      // Pre-seed successor with BLOCKED.
      await scr.connect(owner).recordScopedScreening(instId, newWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);
      // Source is CLEAR.
      await scr.connect(owner).recordScopedScreening(instId, oldWallet.address, SCREENING_CLEAR, ethers.ZeroHash);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      expect((await scr.getScopedScreening(instId, newWallet.address)).status).to.equal(SCREENING_BLOCKED);
      expect((await scr.getScopedScreening(instId, oldWallet.address)).status).to.equal(SCREENING_NONE);

      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, false);
    });

    it("source FLAGGED + successor CLEAR => successor FLAGGED", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instId = await registerInstitution(reg, owner, "InstB2");
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instId);

      await scr.connect(owner).recordScopedScreening(instId, newWallet.address, SCREENING_CLEAR, ethers.ZeroHash);
      await scr.connect(owner).recordScopedScreening(instId, oldWallet.address, SCREENING_FLAGGED, ethers.ZeroHash);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      expect((await scr.getScopedScreening(instId, newWallet.address)).status).to.equal(SCREENING_FLAGGED);
      expect((await scr.getScopedScreening(instId, oldWallet.address)).status).to.equal(SCREENING_NONE);

      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, false);
    });

    it("empty successor still receives source BLOCKED state (regression)", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instId = await registerInstitution(reg, owner, "InstC");
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instId);

      await scr.connect(owner).recordScopedScreening(instId, oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      expect((await scr.getScopedScreening(instId, newWallet.address)).status).to.equal(SCREENING_BLOCKED);
      expect((await scr.getScopedScreening(instId, oldWallet.address)).status).to.equal(SCREENING_NONE);
      expect(await scr.isWalletScopedInstitution(newWallet.address, instId)).to.equal(true);

      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, false);
    });
  });

  describe("wallet affiliation merge — most-restrictive wins", function () {
    it("source Suspended + successor Active => successor Suspended", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const instId = await registerInstitution(reg, owner, "InstAffA");

      await reg.connect(owner).linkWalletToInstitution(oldWallet.address, instId);
      await reg.connect(owner).setWalletAffiliationStatus(oldWallet.address, AFFILIATION_SUSPENDED);
      await reg.connect(owner).linkWalletToInstitution(newWallet.address, instId);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      const aff = await reg.getWalletAffiliation(newWallet.address);
      expect(aff.institutionId).to.equal(instId);
      expect(aff.status).to.equal(AFFILIATION_SUSPENDED);

      const oldAff = await reg.getWalletAffiliation(oldWallet.address);
      expect(oldAff.institutionId).to.equal(ethers.ZeroHash);
    });

    it("source Revoked + successor Active => successor Revoked", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const instId = await registerInstitution(reg, owner, "InstAffB");

      await reg.connect(owner).linkWalletToInstitution(oldWallet.address, instId);
      await reg.connect(owner).setWalletAffiliationStatus(oldWallet.address, AFFILIATION_REVOKED);
      await reg.connect(owner).linkWalletToInstitution(newWallet.address, instId);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      const aff = await reg.getWalletAffiliation(newWallet.address);
      expect(aff.status).to.equal(AFFILIATION_REVOKED);
    });

    it("migrateInstitutionState keeps successor's stricter affiliation (Active -> Suspended)", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const instId = await registerInstitution(reg, owner, "InstAffC");

      await reg.connect(owner).linkWalletToInstitution(oldWallet.address, instId);
      await reg.connect(owner).linkWalletToInstitution(newWallet.address, instId);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // After atomic migration, oldWallet is unaffiliated. Re-link it as Active and
      // downgrade newWallet to Suspended. migrateInstitutionState must not downgrade.
      await reg.connect(owner).linkWalletToInstitution(oldWallet.address, instId);
      await reg.connect(owner).setWalletAffiliationStatus(newWallet.address, AFFILIATION_SUSPENDED);

      await facets.walletRecovery.connect(owner).migrateInstitutionState(recoveryId, [], [], []);

      const aff = await reg.getWalletAffiliation(newWallet.address);
      expect(aff.status).to.equal(AFFILIATION_SUSPENDED);
    });

    it("migrateInstitutionState also merges affiliation most-restrictively", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const instId = await registerInstitution(reg, owner, "InstAffD");

      await reg.connect(owner).linkWalletToInstitution(oldWallet.address, instId);
      await reg.connect(owner).setWalletAffiliationStatus(oldWallet.address, AFFILIATION_REVOKED);
      await reg.connect(owner).linkWalletToInstitution(newWallet.address, instId);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // Affiliation was already migrated atomically; calling migrateInstitutionState again
      // must not downgrade. Force the second code path by re-linking source as Revoked.
      await reg.connect(owner).linkWalletToInstitution(oldWallet.address, instId);
      await reg.connect(owner).setWalletAffiliationStatus(oldWallet.address, AFFILIATION_REVOKED);

      await facets.walletRecovery.connect(owner).migrateInstitutionState(recoveryId, [], [], []);

      const aff = await reg.getWalletAffiliation(newWallet.address);
      expect(aff.status).to.equal(AFFILIATION_REVOKED);
    });
  });

  describe("network clearance conflict — fail-closed revert", function () {
    it("reverts when source and successor both have differing non-zero clearances", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);

      // Pre-seed successor with a clearance record.
      await scr.connect(owner).recordNetworkScreening(newWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await scr.connect(owner).clearNetworkBlock(newWallet.address, ethers.keccak256(ethers.toUtf8Bytes("succ-reason")));

      // Source has a different clearance record.
      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await scr.connect(owner).clearNetworkBlock(oldWallet.address, ethers.keccak256(ethers.toUtf8Bytes("old-reason")));

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await expect(facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address))
        .to.be.revertedWithCustomError(facets.walletRecovery, "SuccessorStateConflict")
        .withArgs(newWallet.address, ethers.encodeBytes32String("NetworkClearance"));
    });

    it("migrates when source clearance equals successor clearance (idempotent no-op)", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);

      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("shared-reason"));
      // Batch all four calls into one block so both clearance records share the same
      // clearedAt timestamp and are structurally equal.
      await network.provider.send("evm_setAutomine", [false]);
      await scr.connect(owner).recordNetworkScreening(newWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await scr.connect(owner).clearNetworkBlock(newWallet.address, reasonHash);
      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await scr.connect(owner).clearNetworkBlock(oldWallet.address, reasonHash);
      await network.provider.send("evm_mine");
      await network.provider.send("evm_setAutomine", [true]);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      const succClearance = await scr.getNetworkClearance(newWallet.address);
      expect(succClearance.clearedAt).to.be.gt(0n);
      const oldClearance = await scr.getNetworkClearance(oldWallet.address);
      expect(oldClearance.clearedAt).to.equal(0n);
    });
  });

  describe("network screening merge — most-restrictive wins", function () {
    it("source network-FLAGGED + successor network-CLEAR => successor FLAGGED", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);

      // Pre-seed successor with network CLEAR.
      await scr.connect(owner).recordNetworkScreening(newWallet.address, SCREENING_CLEAR, ethers.ZeroHash);
      // Source is network FLAGGED.
      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_FLAGGED, ethers.ZeroHash);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      expect((await scr.getScreening(newWallet.address)).status).to.equal(SCREENING_FLAGGED);
      expect((await scr.getScreening(oldWallet.address)).status).to.equal(SCREENING_NONE);
    });

    it("source network-CLEAR + successor network-FLAGGED => successor stays FLAGGED", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);

      // Pre-seed successor with network FLAGGED.
      await scr.connect(owner).recordNetworkScreening(newWallet.address, SCREENING_FLAGGED, ethers.ZeroHash);
      // Source is network CLEAR.
      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_CLEAR, ethers.ZeroHash);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      expect((await scr.getScreening(newWallet.address)).status).to.equal(SCREENING_FLAGGED);
      expect((await scr.getScreening(oldWallet.address)).status).to.equal(SCREENING_NONE);
    });
  });

  describe("wallet policy merge — most-restrictive wins (Task 5.1)", function () {
    const KYC_KEY = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));
    const TRT_KEY = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_threshold_usd"));
    const DUAL_KEY = ethers.keccak256(ethers.toUtf8Bytes("dual_approval_threshold_usd"));

    async function policyFixture() {
      const base = await loadFixture(fixture);
      const { diamond, facets, owner, admin, custodian1 } = base;
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      const cfg = await ethers.getContractAt("ComplianceConfigFacet", diamond.target ?? diamond.address);
      return { facets, owner, oldWallet, newWallet, pol, cfg };
    }

    async function designateAndMigrate(facets, owner, oldWallet, newWallet, policyIds) {
      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);
      return { recoveryId, migrate: () =>
        facets.walletRecovery.connect(owner).migrateInstitutionState(recoveryId, [], [], policyIds) };
    }

    it("plain move: source armed, successor unset => moves 1:1, counter unchanged", async function () {
      const { facets, owner, oldWallet, newWallet, pol, cfg } = await policyFixture();

      await pol.connect(owner).setWalletPolicy(oldWallet.address, KYC_KEY, 1);
      const countAfterSet = await cfg.kycScopeCount();

      const { migrate } = await designateAndMigrate(facets, owner, oldWallet, newWallet, [KYC_KEY]);
      await migrate();

      const [newVal, newSet] = await pol.getWalletPolicyValue(newWallet.address, KYC_KEY);
      expect(newVal).to.equal(1n);
      expect(newSet).to.equal(true);
      const [, oldSet] = await pol.getWalletPolicyValue(oldWallet.address, KYC_KEY);
      expect(oldSet).to.equal(false);
      expect(await cfg.kycScopeCount()).to.equal(countAfterSet);
    });

    it("both armed: dedupes to one scope and decrements the arming counter", async function () {
      const { facets, owner, oldWallet, newWallet, pol, cfg } = await policyFixture();

      await pol.connect(owner).setWalletPolicy(oldWallet.address, KYC_KEY, 1);
      await pol.connect(owner).setWalletPolicy(newWallet.address, KYC_KEY, 1);
      const countBothArmed = await cfg.kycScopeCount();

      const { migrate } = await designateAndMigrate(facets, owner, oldWallet, newWallet, [KYC_KEY]);
      await migrate();

      const [newVal, newSet] = await pol.getWalletPolicyValue(newWallet.address, KYC_KEY);
      expect(newVal).to.equal(1n);
      expect(newSet).to.equal(true);
      const [, oldSet] = await pol.getWalletPolicyValue(oldWallet.address, KYC_KEY);
      expect(oldSet).to.equal(false);
      // Two armed wallet scopes merged into one — counter must drop by exactly 1,
      // else the control stays phantom-armed network-wide with no live scope.
      expect(await cfg.kycScopeCount()).to.equal(countBothArmed - 1n);
    });

    it("stricter successor kept: source explicit-0, successor armed => successor stays armed", async function () {
      const { facets, owner, oldWallet, newWallet, pol, cfg } = await policyFixture();

      await pol.connect(owner).setWalletPolicy(oldWallet.address, KYC_KEY, 0);
      await pol.connect(owner).setWalletPolicy(newWallet.address, KYC_KEY, 1);
      const countAfterSet = await cfg.kycScopeCount();

      const { migrate } = await designateAndMigrate(facets, owner, oldWallet, newWallet, [KYC_KEY]);
      await migrate();

      const [newVal, newSet] = await pol.getWalletPolicyValue(newWallet.address, KYC_KEY);
      expect(newVal).to.equal(1n);
      expect(newSet).to.equal(true);
      const [, oldSet] = await pol.getWalletPolicyValue(oldWallet.address, KYC_KEY);
      expect(oldSet).to.equal(false);
      expect(await cfg.kycScopeCount()).to.equal(countAfterSet);
    });

    it("looser successor overridden (CF-3a regression): source armed, successor explicit-0 => successor armed", async function () {
      const { facets, owner, oldWallet, newWallet, pol, cfg } = await policyFixture();

      await pol.connect(owner).setWalletPolicy(oldWallet.address, KYC_KEY, 1);
      await pol.connect(owner).setWalletPolicy(newWallet.address, KYC_KEY, 0);
      const countAfterSet = await cfg.kycScopeCount();

      const { migrate } = await designateAndMigrate(facets, owner, oldWallet, newWallet, [KYC_KEY]);
      await migrate();

      // Pre-Task-5.1 copy-only-if-unset would have left the looser explicit-0
      // pre-seed in place — a recovery-laundering bypass of the armed override.
      const [newVal, newSet] = await pol.getWalletPolicyValue(newWallet.address, KYC_KEY);
      expect(newVal).to.equal(1n);
      expect(newSet).to.equal(true);
      const [, oldSet] = await pol.getWalletPolicyValue(oldWallet.address, KYC_KEY);
      expect(oldSet).to.equal(false);
      // Armed scope moved 1:1 (old armed scope gone, successor now armed): net zero.
      expect(await cfg.kycScopeCount()).to.equal(countAfterSet);
    });

    it("travel-rule threshold merges to the lower (stricter) value; 0 = enforce-all wins", async function () {
      const { facets, owner, oldWallet, newWallet, pol } = await policyFixture();

      // High network baseline so wallet thresholds are tightenings, not relaxes.
      await pol.connect(owner).setNetworkPolicy(TRT_KEY, ethers.parseUnits("1000000", 18));
      await pol.connect(owner).setWalletPolicy(oldWallet.address, TRT_KEY, ethers.parseUnits("500", 18));
      await pol.connect(owner).setWalletPolicy(newWallet.address, TRT_KEY, ethers.parseUnits("200", 18));

      const { migrate } = await designateAndMigrate(facets, owner, oldWallet, newWallet, [TRT_KEY]);
      await migrate();

      const [newVal, newSet] = await pol.getWalletPolicyValue(newWallet.address, TRT_KEY);
      expect(newVal).to.equal(ethers.parseUnits("200", 18));
      expect(newSet).to.equal(true);
      const [, oldSet] = await pol.getWalletPolicyValue(oldWallet.address, TRT_KEY);
      expect(oldSet).to.equal(false);
    });

    it("travel-rule threshold: source enforce-all (0) overrides successor's nonzero threshold", async function () {
      const { facets, owner, oldWallet, newWallet, pol } = await policyFixture();

      await pol.connect(owner).setNetworkPolicy(TRT_KEY, ethers.parseUnits("1000000", 18));
      await pol.connect(owner).setWalletPolicy(oldWallet.address, TRT_KEY, 0);
      await pol.connect(owner).setWalletPolicy(newWallet.address, TRT_KEY, ethers.parseUnits("200", 18));

      const { migrate } = await designateAndMigrate(facets, owner, oldWallet, newWallet, [TRT_KEY]);
      await migrate();

      const [newVal] = await pol.getWalletPolicyValue(newWallet.address, TRT_KEY);
      expect(newVal).to.equal(0n);
    });

    it("non-enforcement key conflict fails closed with SuccessorStateConflict at designation (DP-5.0-D)", async function () {
      const { facets, owner, oldWallet, newWallet, pol } = await policyFixture();

      await pol.connect(owner).setWalletPolicy(oldWallet.address, DUAL_KEY, ethers.parseUnits("100", 18));
      await pol.connect(owner).setWalletPolicy(newWallet.address, DUAL_KEY, ethers.parseUnits("200", 18));

      // Since DP-5.0-D auto-merges all 8 wallet-policy keys at designation, the
      // conflict now blocks designateSuccessor itself (admin must clear one side).
      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await expect(facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address))
        .to.be.revertedWithCustomError(facets.walletRecovery, "SuccessorStateConflict")
        .withArgs(newWallet.address, DUAL_KEY);
    });

    it("DP-5.0-D: policies auto-merge at designation; manual migrateInstitutionState is an idempotent no-op", async function () {
      const { facets, owner, oldWallet, newWallet, pol, cfg } = await policyFixture();

      await pol.connect(owner).setWalletPolicy(oldWallet.address, KYC_KEY, 1);
      await pol.connect(owner).setWalletPolicy(newWallet.address, KYC_KEY, 1);
      const countBothArmed = await cfg.kycScopeCount();

      const { migrate } = await designateAndMigrate(facets, owner, oldWallet, newWallet, [KYC_KEY]);

      // Merged at designation, before any migrateInstitutionState call.
      const [newVal, newSet] = await pol.getWalletPolicyValue(newWallet.address, KYC_KEY);
      expect(newVal).to.equal(1n);
      expect(newSet).to.equal(true);
      const [, oldSet] = await pol.getWalletPolicyValue(oldWallet.address, KYC_KEY);
      expect(oldSet).to.equal(false);
      expect(await cfg.kycScopeCount()).to.equal(countBothArmed - 1n);

      // Manual helper re-run must not double-decrement or resurrect source keys.
      await migrate();
      expect(await cfg.kycScopeCount()).to.equal(countBothArmed - 1n);
      const [newVal2, newSet2] = await pol.getWalletPolicyValue(newWallet.address, KYC_KEY);
      expect(newVal2).to.equal(1n);
      expect(newSet2).to.equal(true);
    });

    it("non-enforcement key equal values dedupe as a no-op move", async function () {
      const { facets, owner, oldWallet, newWallet, pol } = await policyFixture();

      const v = ethers.parseUnits("150", 18);
      await pol.connect(owner).setWalletPolicy(oldWallet.address, DUAL_KEY, v);
      await pol.connect(owner).setWalletPolicy(newWallet.address, DUAL_KEY, v);

      const { migrate } = await designateAndMigrate(facets, owner, oldWallet, newWallet, [DUAL_KEY]);
      await migrate();

      const [newVal, newSet] = await pol.getWalletPolicyValue(newWallet.address, DUAL_KEY);
      expect(newVal).to.equal(v);
      expect(newSet).to.equal(true);
      const [, oldSet] = await pol.getWalletPolicyValue(oldWallet.address, DUAL_KEY);
      expect(oldSet).to.equal(false);
    });

    it("T1: full 8-key matrix — every wallet policy migrates to the successor and resolves through the dead key", async function () {
      const { facets, owner, oldWallet, newWallet, pol } = await policyFixture();
      const key = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
      const MATRIX = [
        [key("cancel_oob_threshold_usd"), 111n],
        [key("shorten_oob_required"), 1n],
        [key("dual_approval_threshold_usd"), 222n],
        [key("max_halflife_adjustments"), 3n],
        [key("kyc_enforce_active"), 1n],
        [key("cip_enforce_active"), 1n],
        [key("travel_rule_enforce_active"), 1n],
        [key("travel_rule_threshold_usd"), 444n],
      ];

      // High numeric baselines so every wallet override below is a tightening.
      await pol.connect(owner).setNetworkPolicy(key("travel_rule_threshold_usd"), ethers.parseUnits("1000000", 18));
      await pol.connect(owner).setNetworkPolicy(key("max_halflife_adjustments"), 10);
      await pol.connect(owner).setNetworkPolicy(key("cancel_oob_threshold_usd"), ethers.parseUnits("1000000", 18));
      await pol.connect(owner).setNetworkPolicy(key("dual_approval_threshold_usd"), ethers.parseUnits("1000000", 18));

      for (const [k, v] of MATRIX) {
        await pol.connect(owner).setWalletPolicy(oldWallet.address, k, v);
      }
      // CIP armed => the successor must carry its OWN record at designation.
      await facets.custodian.connect(oldWallet).recordCIP(newWallet.address, ethers.id("t1-cip"));

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      for (const [k, v] of MATRIX) {
        // Clean successor inherits the predecessor's full posture, key by key.
        const [newVal, newSet] = await pol.getWalletPolicyValue(newWallet.address, k);
        expect(newVal, `successor value for ${k}`).to.equal(v);
        expect(newSet, `successor set-flag for ${k}`).to.equal(true);
        const [, oldSet] = await pol.getWalletPolicyValue(oldWallet.address, k);
        expect(oldSet, `predecessor set-flag for ${k}`).to.equal(false);
        // K-F7 symmetry: the dead key resolves to the successor's merged posture.
        const [resolved, effVal, source] = await pol.getResolvedEffectivePolicy(oldWallet.address, k);
        expect(resolved).to.equal(newWallet.address);
        expect(effVal, `resolved effective value for ${k}`).to.equal(v);
        expect(source).to.equal("wallet");
      }
    });
  });

  describe("CIP migration + successor CIP eligibility (Task 5.2, CF-3)", function () {
    const CIP_KEY = ethers.keccak256(ethers.toUtf8Bytes("cip_enforce_active"));
    const ESCROW_RELEASE = 2;
    const cipHash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

    async function cipFixture() {
      const base = await loadFixture(fixture);
      const { diamond, facets, owner, admin, custodian1 } = base;
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);
      // Register the source wallet under custodian1 so it can carry a CIP record.
      const expires = Math.floor(Date.now() / 1000) + 86400;
      await facets.custodian.connect(custodian1).registerCustodiedWallet(oldWallet.address, 1, expires);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      return { facets, owner, custodian1, oldWallet, newWallet, pol };
    }

    it("CF-3(c): designation reverts SuccessorCipMissing when CIP is armed and the successor lacks its own record", async function () {
      const { facets, owner, custodian1, oldWallet, newWallet, pol } = await cipFixture();

      await pol.connect(owner).setNetworkPolicy(CIP_KEY, 1);
      await facets.custodian.connect(custodian1).recordCIP(oldWallet.address, cipHash("cip-old"));

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      // Predecessor's record must NOT satisfy the gate — the successor needs its OWN.
      await expect(facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address))
        .to.be.revertedWithCustomError(facets.walletRecovery, "SuccessorCipMissing")
        .withArgs(newWallet.address);
    });

    it("designation succeeds once the successor carries its own CIP record", async function () {
      const { facets, owner, custodian1, oldWallet, newWallet, pol } = await cipFixture();

      await pol.connect(owner).setNetworkPolicy(CIP_KEY, 1);
      await facets.custodian.connect(custodian1).recordCIP(newWallet.address, cipHash("cip-new"));

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await expect(facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address))
        .not.to.be.reverted;
      expect(await facets.custodian.hasCIP(newWallet.address)).to.equal(true);
    });

    it("CIP record moves to a successor that lacks one; predecessor record cleared", async function () {
      const { facets, owner, custodian1, oldWallet, newWallet } = await cipFixture();

      await facets.custodian.connect(custodian1).recordCIP(oldWallet.address, cipHash("cip-old"));

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      const [completedAt, recordHash] = await facets.custodian.connect(owner).getCIP(newWallet.address);
      expect(completedAt).to.not.equal(0n);
      expect(recordHash).to.equal(cipHash("cip-old"));
      expect(await facets.custodian.hasCIP(oldWallet.address)).to.equal(false);
    });

    it("successor keeps its own CIP record when both sides carry one (differing hashes are normal, no conflict revert)", async function () {
      const { facets, owner, custodian1, oldWallet, newWallet } = await cipFixture();

      await facets.custodian.connect(custodian1).recordCIP(oldWallet.address, cipHash("cip-old"));
      await facets.custodian.connect(custodian1).recordCIP(newWallet.address, cipHash("cip-new"));

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      const [, recordHash] = await facets.custodian.connect(owner).getCIP(newWallet.address);
      expect(recordHash).to.equal(cipHash("cip-new"));
      expect(await facets.custodian.hasCIP(oldWallet.address)).to.equal(false);
    });

    it("MED-1 regression: wallet-level KYC arming follows the successor; release gates on the resolved payee", async function () {
      const { facets, owner, custodian1, oldWallet, newWallet, pol } = await cipFixture();
      const gate = facets.complianceGate;
      const KYC_KEY = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));

      // Wallet-scope KYC override on the predecessor (arms kycScopeCount).
      await pol.connect(owner).setWalletPolicy(oldWallet.address, KYC_KEY, 1);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // The override now lives on the successor; make the successor KYC-invalid.
      await facets.custodian.connect(custodian1).revokeKYC(newWallet.address, 1);

      // Pre-fix, _kycRequired(oldWallet) read the LITERAL wallet, saw the moved
      // override as unarmed, and skipped the check entirely — the release passed.
      await expect(gate.enforceCompliance(owner.address, oldWallet.address, 0, ESCROW_RELEASE))
        .to.be.revertedWithCustomError(gate, "ComplianceKycRequired")
        .withArgs(oldWallet.address, ESCROW_RELEASE);

      // Restoring the successor's KYC clears the release.
      const expires = Math.floor(Date.now() / 1000) + 172800;
      await facets.custodian.connect(custodian1).updateKYCStatus(newWallet.address, 1, expires);
      await expect(gate.enforceCompliance(owner.address, oldWallet.address, 0, ESCROW_RELEASE))
        .not.to.be.reverted;
    });

    it("MED-1 regression: wallet-level CIP arming follows the successor; release gates on the resolved payee", async function () {
      const { facets, owner, custodian1, oldWallet, newWallet, pol } = await cipFixture();
      const gate = facets.complianceGate;

      // Wallet-scope CIP override on the predecessor (arms cipScopeCount); the
      // successor needs its OWN record to pass the designation eligibility gate.
      await pol.connect(owner).setWalletPolicy(oldWallet.address, CIP_KEY, 1);
      await facets.custodian.connect(custodian1).recordCIP(newWallet.address, cipHash("cip-new"));

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // The override now lives on the successor; strip the successor's CIP.
      await facets.custodian.connect(custodian1).revokeCIP(newWallet.address);

      await expect(gate.enforceCompliance(owner.address, oldWallet.address, 0, ESCROW_RELEASE))
        .to.be.revertedWithCustomError(gate, "ComplianceCIPRequired")
        .withArgs(oldWallet.address, ESCROW_RELEASE);

      await facets.custodian.connect(custodian1).recordCIP(newWallet.address, cipHash("cip-new-2"));
      await expect(gate.enforceCompliance(owner.address, oldWallet.address, 0, ESCROW_RELEASE))
        .not.to.be.reverted;
    });

    it("CF-3(b): armed CIP release check judges the resolved payee, not the dead key", async function () {
      const { facets, owner, custodian1, oldWallet, newWallet, pol } = await cipFixture();
      const gate = facets.complianceGate;

      // Designate while CIP is unarmed (eligibility gate skipped), successor has no CIP.
      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // Exploit shape: the dead key gets a record AFTER designation, then CIP arms.
      // Pre-5.2 the literal read on oldWallet would pass; the resolved payee lacks CIP.
      await facets.custodian.connect(custodian1).recordCIP(oldWallet.address, cipHash("cip-old"));
      await pol.connect(owner).setNetworkPolicy(CIP_KEY, 1);

      await expect(gate.enforceCompliance(owner.address, oldWallet.address, 0, ESCROW_RELEASE))
        .to.be.revertedWithCustomError(gate, "ComplianceCIPRequired")
        .withArgs(oldWallet.address, ESCROW_RELEASE);

      // Once the payee carries its own record, the release to the recovered wallet clears.
      await facets.custodian.connect(custodian1).recordCIP(newWallet.address, cipHash("cip-new"));
      await expect(gate.enforceCompliance(owner.address, oldWallet.address, 0, ESCROW_RELEASE))
        .not.to.be.reverted;
    });
  });
});
