const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

describe("Wave 8E-1 scoping + sanctions", function () {
  // NOTE (verified 2026-06-23): deployT3DiamondFixture() returns
  //   { diamond, diamondAddress, facets, signers: { owner, admin, user1, user2, user3, pauser, minter, custodian1, custodian2, treasury }, ... }
  // and setupTestRoles takes (facets, signers) — NOT (base). There is no top-level
  // `owner` and no `addr1/addr2`; normalize here so the test bodies below can use
  // owner/addr1/addr2. setupTestRoles is extended in Task 2 to grant the new roles.
  async function fixture() {
    const base = await deployT3DiamondFixture();
    await setupTestRoles(base.facets, base.signers);
    const { diamond, diamondAddress, facets, signers } = base;
    const { owner, admin, user1, user2, user3, custodian1, custodian2 } = signers;
    return { diamond, diamondAddress, facets, owner, admin, addr1: user1, addr2: user2, addr3: user3, custodian1, custodian2 };
  }

  async function makeEligibleSuccessor(facets, owner, custodian, wallet) {
    await facets.custodian.connect(owner).grantCustodianRole(wallet.address);
    const validated = 1;
    const expires = Math.floor(Date.now() / 1000) + 86400;
    await facets.custodian.connect(custodian).registerCustodiedWallet(wallet.address, validated, expires);
  }

  async function deployHarness(diamondAddress, owner) {
    const Harness = await ethers.getContractFactory("ComplianceLibHarnessFacet");
    const harness = await Harness.deploy();
    await harness.waitForDeployment();
    const selectors = [];
    harness.interface.forEachFunction(fn => selectors.push(fn.selector));
    const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);
    const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
    await diamondCut.connect(owner).diamondCut(
      [{ facetAddress: await harness.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors }],
      ethers.ZeroAddress,
      "0x"
    );
    return await ethers.getContractAt("ComplianceLibHarnessFacet", diamondAddress);
  }

  describe("storage / default-off", function () {
    it("activeScopeCount starts at 0 (compliance inert)", async function () {
      const { diamond } = await loadFixture(fixture);
      const cfg = await ethers.getContractAt("ComplianceConfigFacet", diamond.target ?? diamond.address);
      // derived view added in Task 3
      expect(await cfg.activeScopeCount()).to.equal(0n);
    });

    it("complianceArmed is false when nothing armed", async function () {
      const { diamond } = await loadFixture(fixture);
      const cfg = await ethers.getContractAt("ComplianceConfigFacet", diamond.target ?? diamond.address);
      expect(await cfg.activeScopeCount()).to.equal(0n);
      expect(await cfg.complianceArmed()).to.equal(false);
    });
  });

  describe("DP-A sanctions enablement bit", function () {
    it("enabling institution sanctions increments activeScopeCount and reads back", async function () {
      const { diamond, owner } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const cfg = await ethers.getContractAt("ComplianceConfigFacet", diamond.target ?? diamond.address);
      const instId = ethers.keccak256(ethers.toUtf8Bytes("INST_A"));
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      expect(await scr.isInstitutionSanctionsEnabled(instId)).to.equal(true);
      expect(await cfg.activeScopeCount()).to.equal(1n);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, false);
      expect(await cfg.activeScopeCount()).to.equal(0n);
    });

    it("isScreeningEnforceActive reflects enabled-institution count", async function () {
      const { diamond, owner } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const cfg = await ethers.getContractAt("ComplianceConfigFacet", diamond.target ?? diamond.address);

      expect(await cfg.isScreeningEnforceActive()).to.equal(false);

      const instA = ethers.keccak256(ethers.toUtf8Bytes("INST_A"));
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      expect(await cfg.isScreeningEnforceActive()).to.equal(true);

      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, false);
      expect(await cfg.isScreeningEnforceActive()).to.equal(false);

      const instB = ethers.keccak256(ethers.toUtf8Bytes("INST_B"));
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instB, true);
      expect(await cfg.isScreeningEnforceActive()).to.equal(true);

      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, false);
      expect(await cfg.isScreeningEnforceActive()).to.equal(true);

      await scr.connect(owner).setInstitutionSanctionsEnabled(instB, false);
      expect(await cfg.isScreeningEnforceActive()).to.equal(false);
    });
  });

  describe("sanctions deny predicate (context-aware, union, bilateral)", function () {
    const SCREENING_BLOCKED = 3;

    it("network BLOCK denies a WALLET_TRANSFER on both legs", async function () {
      const { diamond, diamondAddress, owner, addr1, addr2 } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);
      const instId = ethers.keccak256(ethers.toUtf8Bytes("INST_A"));
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
      await expect(attached.harnessPrecheck(addr2.address, addr1.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
    });

    it("BANK_MINT screens the recipient leg only (CF-1 narrowed)", async function () {
      const { diamond, diamondAddress, owner, addr1, addr2 } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);
      const instId = ethers.keccak256(ethers.toUtf8Bytes("INST_A"));
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      // Mint TO a network-blocked recipient reverts.
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 3))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
      // Minter (from) leg stays unscreened: MINTER_ROLE is bank/admin-held (D5).
      await expect(attached.harnessPrecheck(addr2.address, addr1.address, 100, 3)).not.to.be.reverted;
    });

    it("D4-T: FLAGGED status does not block (network or scoped)", async function () {
      const { diamond, diamondAddress, facets, owner, addr1, addr2, addr3 } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);

      const SCREENING_FLAGGED = 2;
      const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));

      // Network FLAGGED must not block.
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_FLAGGED, ethers.ZeroHash);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;

      // Scoped FLAGGED must not block.
      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;
      await reg.connect(owner).linkWalletToInstitution(addr1.address, instA);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instA);
      await scr.connect(owner).recordScopedScreening(instA, addr2.address, SCREENING_FLAGGED, ethers.ZeroHash);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;

      // Sanity: BLOCKED on the same scoped record does block.
      await scr.connect(owner).recordScopedScreening(instA, addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      const diamondHarness = await ethers.getContractAt("ComplianceLibHarnessFacet", diamondAddress);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(diamondHarness, "ComplianceSanctioned").withArgs(addr2.address);
    });

    it("D1-T: network block is non-exemptable even with compliance exemptions", async function () {
      const { diamond, diamondAddress, facets, owner, addr1, addr2 } = await loadFixture(fixture);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);

      // Arm requirement controls at network scope so a relax would matter.
      const KYC = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));
      const TR = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_enforce_active"));
      const CIP = ethers.keccak256(ethers.toUtf8Bytes("cip_enforce_active"));
      await pol.connect(owner).setNetworkPolicy(KYC, 1);
      await pol.connect(owner).setNetworkPolicy(TR, 1);
      await pol.connect(owner).setNetworkPolicy(CIP, 1);

      // CF-R Obs-1: sanctions is independently armed (per-control counters) — the
      // requirement keys above no longer switch it on. Arm it via the DP-A path.
      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);

      // Network-block addr2.
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      // Grant compliance exemptions for addr2 on every requirement key (relax to 0).
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("exempt-addr2"));
      for (const key of [KYC, TR, CIP]) {
        await pol.connect(owner).setWalletPolicyWithReason(addr2.address, key, 0, reasonHash);
      }

      // The network block still denies the transfer; exemptions do not lift it.
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
    });
  });

  describe("sanctions context-aware party selection", function () {
    const SCREENING_BLOCKED = 3;
    const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));

    it("D6-T: all five contexts apply the sanctions predicate directionally", async function () {
      const { diamond, diamondAddress, facets, owner, addr1, addr2, addr3 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      await reg.connect(owner).linkWalletToInstitution(addr1.address, instA);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instA);
      await scr.connect(owner).recordScopedScreening(instA, addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      async function expectSanctioned(from, to, ctx, label) {
        let didRevert = false;
        try {
          await attached.harnessPrecheck.staticCall(from, to, 100, ctx);
        } catch (err) {
          didRevert = err.code === "CALL_EXCEPTION" ||
            (err.message && err.message.includes("ComplianceSanctioned"));
        }
        expect(didRevert, label).to.equal(true);
      }
      async function expectNotSanctioned(from, to, ctx, label) {
        await expect(attached.harnessPrecheck(from, to, 100, ctx), label).not.to.be.reverted;
      }

      // WALLET_TRANSFER (0): both legs checked; institution-scoped bite works directionally.
      await expectSanctioned(addr1.address, addr2.address, 0, "WALLET_TRANSFER from affiliated to blocked");
      await expectNotSanctioned(addr3.address, addr2.address, 0, "WALLET_TRANSFER from unaffiliated to blocked");

      // ESCROW_IN (1): K-F1 — both legs are checked (recipient screened at creation),
      // so the institution-scoped bite now applies directionally like WALLET_TRANSFER.
      await expectSanctioned(addr2.address, addr1.address, 1, "ESCROW_IN from scoped-blocked to affiliated (scoped bite)");
      await expectSanctioned(addr1.address, addr2.address, 1, "ESCROW_IN from affiliated to scoped-blocked recipient (K-F1)");
      await expectNotSanctioned(addr3.address, addr2.address, 1, "ESCROW_IN unaffiliated to scoped-blocked (no scoped bite)");

      // ESCROW_RELEASE (2): to-only is checked; institution-scoped bite is not applied because
      // the counterparty leg is not checked.
      await expectNotSanctioned(addr1.address, addr2.address, 2, "ESCROW_RELEASE from affiliated to blocked (no scoped bite)");
      await expectNotSanctioned(addr2.address, addr1.address, 2, "ESCROW_RELEASE from blocked to affiliated (no scoped bite)");

      // BANK_MINT (3): to-only is checked; institution-scoped bite is not applied because
      // the minter leg is not checked. No network block is set yet, so no bite.
      await expectNotSanctioned(addr1.address, addr2.address, 3, "BANK_MINT scoped-blocked recipient (no scoped bite)");

      // RECOVERY_MIGRATE (4): to-only is checked; institution-scoped bite is not applied.
      await expectNotSanctioned(addr1.address, addr2.address, 4, "RECOVERY_MIGRATE successor blocked (no scoped bite)");
      await expectNotSanctioned(addr2.address, addr1.address, 4, "RECOVERY_MIGRATE successor unblocked");

      // Add a network block to exercise the non-WALLET_TRANSFER checked legs.
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      // ESCROW_IN (1): K-F1 — network block on either leg reverts.
      await expectSanctioned(addr2.address, addr3.address, 1, "ESCROW_IN network block on from");
      await expectSanctioned(addr3.address, addr2.address, 1, "ESCROW_IN network block on recipient (K-F1)");
      await expectNotSanctioned(addr3.address, addr1.address, 1, "ESCROW_IN neither leg blocked");

      // ESCROW_RELEASE (2): network block on "to" reverts; clearing "to" avoids the bite.
      await expectSanctioned(addr3.address, addr2.address, 2, "ESCROW_RELEASE network block on to");
      await expectNotSanctioned(addr2.address, addr3.address, 2, "ESCROW_RELEASE to not blocked");

      // BANK_MINT (3): network block on the recipient reverts; minter leg unscreened.
      await expectSanctioned(addr3.address, addr2.address, 3, "BANK_MINT network block on recipient");
      await expectNotSanctioned(addr2.address, addr3.address, 3, "BANK_MINT minter leg unscreened");

      // RECOVERY_MIGRATE (4): network block on "to" reverts; clearing "to" avoids the bite.
      await expectSanctioned(addr3.address, addr2.address, 4, "RECOVERY_MIGRATE network block on successor");
      await expectNotSanctioned(addr2.address, addr3.address, 4, "RECOVERY_MIGRATE successor not blocked");
    });
  });

  describe("recordScreening scoping + network-write restriction", function () {
    const SCREENING_BLOCKED = 3;

    it("institution attestor can scoped-block within own institution only", async function () {
      const { diamond, facets, owner, addr1, addr2, addr3 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;
      const instB = (await (await reg.connect(owner).registerInstitution("InstB", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, addr1.address, instA);

      await expect(scr.connect(addr1).recordScopedScreening(instA, addr2.address, SCREENING_BLOCKED, ethers.ZeroHash))
        .to.emit(scr, "ScopedWalletScreened");
      expect((await scr.getScopedScreening(instA, addr2.address)).status).to.equal(SCREENING_BLOCKED);

      // addr1 cannot scoped-block within instB
      await expect(scr.connect(addr1).recordScopedScreening(instB, addr2.address, SCREENING_BLOCKED, ethers.ZeroHash))
        .to.be.revertedWithCustomError(scr, "UnauthorizedRole");
    });

    it("institution attestor CANNOT write the network screenings map", async function () {
      const { diamond, facets, owner, addr1, addr2 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, addr1.address, instA);

      await expect(scr.connect(addr1).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash))
        .to.be.revertedWithCustomError(scr, "UnauthorizedRole");
      await expect(scr.connect(addr1).recordScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash))
        .to.be.revertedWithCustomError(scr, "UnauthorizedRole");
    });

    it("only NETWORK_SCREENING_AUTHORITY_ROLE can place a network block", async function () {
      const { diamond, owner, addr1, addr2 } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      // addr1 has no network authority
      await expect(scr.connect(addr1).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash))
        .to.be.revertedWithCustomError(scr, "UnauthorizedRole");
      // owner has NETWORK_SCREENING_AUTHORITY_ROLE from the helper
      await expect(scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash))
        .to.emit(scr, "NetworkBlockPlaced");
    });
  });

  describe("network clearance + janitor", function () {
    const SCREENING_BLOCKED = 3;
    const SCREENING_CLEAR = 1;

    it("clearNetworkBlock records a NetworkClearance and lifts the network block", async function () {
      const { diamond, diamondAddress, owner, addr1, addr2 } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);
      const instId = ethers.keccak256(ethers.toUtf8Bytes("INST_A"));
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned");

      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("false-positive"));
      await expect(scr.connect(owner).clearNetworkBlock(addr2.address, reasonHash))
        .to.emit(scr, "NetworkCleared")
        .withArgs(addr2.address, SCREENING_BLOCKED, reasonHash, owner.address);

      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;
    });

    it("clearance does NOT lift institution-scoped blocks (institution discretion)", async function () {
      const { diamond, diamondAddress, facets, owner, addr1, addr2, addr3 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      await reg.connect(owner).linkWalletToInstitution(addr1.address, instA);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, addr3.address, instA);
      await scr.connect(addr3).recordScopedScreening(instA, addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      // also network-block addr2, then clear it
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await scr.connect(owner).clearNetworkBlock(addr2.address, ethers.keccak256(ethers.toUtf8Bytes("clear")));

      // institution-scoped block remains
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
    });

    it("NetworkClearance fields decode in the expected order (gap guard)", async function () {
      const { diamond, owner, addr2 } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("decode-guard"));
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await scr.connect(owner).clearNetworkBlock(addr2.address, reasonHash);

      const c = await scr.getNetworkClearance(addr2.address);
      expect(c.previousStatus).to.equal(SCREENING_BLOCKED);
      expect(c.clearedBy).to.equal(owner.address);
      expect(c.reasonHash).to.equal(reasonHash);
      expect(c.clearedAt).to.be.gt(0);
    });

    it("B3-T: re-blocking deletes stale NetworkClearance audit row", async function () {
      const { diamond, owner, addr2 } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("false-positive"));

      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await scr.connect(owner).clearNetworkBlock(addr2.address, reasonHash);

      const clearanceBefore = await scr.getNetworkClearance(addr2.address);
      expect(clearanceBefore.clearedAt).to.be.gt(0);

      // Re-block the same wallet.
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const screeningAfter = await scr.getScreening(addr2.address);
      expect(screeningAfter.status).to.equal(SCREENING_BLOCKED);

      const clearanceAfter = await scr.getNetworkClearance(addr2.address);
      expect(clearanceAfter.clearedAt).to.equal(0);
      expect(clearanceAfter.clearedBy).to.equal(ethers.ZeroAddress);
      expect(clearanceAfter.reasonHash).to.equal(ethers.ZeroHash);
      expect(clearanceAfter.previousStatus).to.equal(0);
    });

    it("C1-T: clearNetworkBlock reverts when wallet is not BLOCKED", async function () {
      const { diamond, owner, addr2 } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("spurious"));

      // NONE
      await expect(scr.connect(owner).clearNetworkBlock(addr2.address, reasonHash))
        .to.be.revertedWithCustomError(scr, "NotNetworkBlocked")
        .withArgs(addr2.address);

      // CLEAR
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_CLEAR, ethers.ZeroHash);
      await expect(scr.connect(owner).clearNetworkBlock(addr2.address, reasonHash))
        .to.be.revertedWithCustomError(scr, "NotNetworkBlocked")
        .withArgs(addr2.address);

      // FLAGGED
      await scr.connect(owner).recordNetworkScreening(addr2.address, 2, ethers.ZeroHash);
      await expect(scr.connect(owner).clearNetworkBlock(addr2.address, reasonHash))
        .to.be.revertedWithCustomError(scr, "NotNetworkBlocked")
        .withArgs(addr2.address);

      // BLOCKED -> succeeds.
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await expect(scr.connect(owner).clearNetworkBlock(addr2.address, reasonHash))
        .to.emit(scr, "NetworkCleared");
    });

    it("C2-T: clearDefunctInstitutionBlocks enforces max batch size", async function () {
      const { diamond, facets, owner, addr2 } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      const tooMany = Array.from({ length: 201 }, (_, i) => ethers.getAddress(ethers.hexlify(ethers.randomBytes(20))));
      await expect(scr.connect(owner).clearDefunctInstitutionBlocks(instA, tooMany))
        .to.be.revertedWithCustomError(scr, "BatchTooLarge")
        .withArgs(201, 200);

      const ok = Array.from({ length: 200 }, (_, i) => ethers.getAddress(ethers.hexlify(ethers.randomBytes(20))));
      await expect(scr.connect(owner).clearDefunctInstitutionBlocks(instA, ok))
        .to.emit(scr, "DefunctInstitutionBlocksCleared")
        .withArgs(instA, 200, owner.address);
    });

    it("D3-T: clearDefunctInstitutionBlocks clears caller-supplied scoped blocks (bounded array)", async function () {
      const { diamond, facets, owner, addr1, addr2, addr3 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, addr3.address, instA);
      await scr.connect(addr3).recordScopedScreening(instA, addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      expect((await scr.getScopedScreening(instA, addr2.address)).status).to.equal(SCREENING_BLOCKED);

      await expect(scr.connect(owner).clearDefunctInstitutionBlocks(instA, [addr2.address]))
        .to.emit(scr, "DefunctInstitutionBlocksCleared")
        .withArgs(instA, 1, owner.address);
      expect((await scr.getScopedScreening(instA, addr2.address)).status).to.equal(0); // NONE
    });
  });

  describe("Travel Rule scoped arming + threshold", function () {
    const TRAVEL_RULE_ENFORCE_ACTIVE = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_enforce_active"));
    const TRAVEL_RULE_THRESHOLD_USD = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_threshold_usd"));

    async function fundAndApprove(facets, owner, addr1, diamondAddress) {
      await facets.accessControl.connect(owner).grantRole(ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")), owner.address);
      await facets.mintBurn.connect(owner).mint(addr1.address, ethers.parseEther("100"));
      await facets.erc20.connect(addr1).approve(diamondAddress, ethers.parseEther("100"));
    }

    it("bindOnCreate follows scoped travel_rule_enforce_active and threshold", async function () {
      const { diamond, diamondAddress, facets, owner, addr1, addr2 } = await loadFixture(fixture);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      await fundAndApprove(facets, owner, addr1, diamondAddress);
      const commitWindowEnd = uint40((await time.latest()) + 3600);

      // gate OFF -> no ref needed
      await expect(facets.envelope.connect(addr1).createEnvelope(
        addr2.address, ethers.parseEther("1"), commitWindowEnd, 0, 0, "0x"
      )).not.to.be.reverted;

      // gate ON, threshold 0 -> enforce-all
      await pol.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);
      await expect(facets.envelope.connect(addr1).createEnvelope(
        addr2.address, ethers.parseEther("0.01"), commitWindowEnd + 1n, 0, 0, "0x"
      )).to.be.revertedWithCustomError(facets.envelope, "TravelRuleRequired")
        .withArgs(addr1.address, ethers.parseEther("0.01"), 0n);

      // threshold 2 ETH -> below threshold no ref
      await pol.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("2"));
      await expect(facets.envelope.connect(addr1).createEnvelope(
        addr2.address, ethers.parseEther("1"), commitWindowEnd + 2n, 0, 0, "0x"
      )).not.to.be.reverted;

      // above threshold with pending ref -> binds
      const ref = ethers.keccak256(ethers.toUtf8Bytes("tr-ref"));
      await facets.complianceTravelRule.connect(addr1).setPendingTravelRule(
        ref, addr2.address, ethers.parseEther("3"), 1, uint40((await time.latest()) + 3600)
      );
      const tx = await facets.envelope.connect(addr1).createEnvelope(
        addr2.address, ethers.parseEther("3"), commitWindowEnd + 3n, 0, 0, "0x"
      );
      await tx.wait();
      const ids = await facets.envelope.getEnvelopesBySender(addr1.address);
      const envelopeId = ids[ids.length - 1];
      const rule = await facets.complianceTravelRule.getTravelRule(envelopeId);
      expect(rule.ref).to.equal(ref);
      expect(rule.satisfied).to.equal(true);
    });

    it("institution override applies most-specific threshold", async function () {
      const { diamond, diamondAddress, facets, owner, addr1, addr2 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      await fundAndApprove(facets, owner, addr1, diamondAddress);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;
      await reg.connect(owner).linkWalletToInstitution(addr1.address, instA);

      await pol.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);
      await pol.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("2"));
      // institution threshold tighter: 0.5 ETH
      await pol.connect(owner).setInstitutionPolicy(instA, TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("0.5"));

      const commitWindowEnd = uint40((await time.latest()) + 3600);
      await expect(facets.envelope.connect(addr1).createEnvelope(
        addr2.address, ethers.parseEther("1"), commitWindowEnd, 0, 0, "0x"
      )).to.be.revertedWithCustomError(facets.envelope, "TravelRuleRequired")
        .withArgs(addr1.address, ethers.parseEther("1"), ethers.parseEther("0.5"));

      const ref = ethers.keccak256(ethers.toUtf8Bytes("tr-ref-inst"));
      await facets.complianceTravelRule.connect(addr1).setPendingTravelRule(
        ref, addr2.address, ethers.parseEther("1"), 1, uint40((await time.latest()) + 3600)
      );
      await expect(facets.envelope.connect(addr1).createEnvelope(
        addr2.address, ethers.parseEther("1"), commitWindowEnd + 1n, 0, 0, "0x"
      )).not.to.be.reverted;
    });
  });

  describe("P4 default-off acceptance", function () {
    const KYC = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));

    it("nothing armed => activeScopeCount==0, precheckGated is a no-op, transfers pass", async function () {
      const { diamond, diamondAddress, owner, addr1, addr2 } = await loadFixture(fixture);
      const cfg = await ethers.getContractAt("ComplianceConfigFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);

      expect(await cfg.activeScopeCount()).to.equal(0n);
      expect(await cfg.complianceArmed()).to.equal(false);

      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;
    });

    it("arming one scope does not change unrelated transfers", async function () {
      const { diamond, diamondAddress, owner, addr1, addr2 } = await loadFixture(fixture);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const cfg = await ethers.getContractAt("ComplianceConfigFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);
      const instId = ethers.keccak256(ethers.toUtf8Bytes("INST_ISOLATED"));

      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      expect(await cfg.activeScopeCount()).to.equal(1n);

      // addr1/addr2 are unaffiliated -> no institution-scoped block can bite
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;

      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, false);
      expect(await cfg.activeScopeCount()).to.equal(0n);
    });

    it("arming kyc does not arm screening", async function () {
      const { diamond, diamondAddress, owner, addr1, addr2 } = await loadFixture(fixture);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      const cfg = await ethers.getContractAt("ComplianceConfigFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);

      await pol.connect(owner).setNetworkPolicy(KYC, 1);
      expect(await cfg.activeScopeCount()).to.equal(1n);

      // screening is NOT armed: a wallet with no KYC is blocked by KYC, but a network BLOCK is not in force.
      // This just verifies the counter is scoped to the requirement key.
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceKycRequired");

      await pol.connect(owner).setNetworkPolicy(KYC, 0);
      expect(await cfg.activeScopeCount()).to.equal(0n);
    });
  });

  describe("activeScopeCount no-desync", function () {
    const KYC = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));

    it("D5-T: network-armed + institution override churn keeps activeScopeCount at network-only value", async function () {
      const { diamond, diamondAddress, facets, owner, addr1, addr2 } = await loadFixture(fixture);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      const cfg = await ethers.getContractAt("ComplianceConfigFacet", diamond.target ?? diamond.address);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);
      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      // Network-only arm.
      await pol.connect(owner).setNetworkPolicy(KYC, 1);
      expect(await cfg.activeScopeCount()).to.equal(1n);

      // Institution relax to 0 (with exemption): counter unchanged.
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("inst-kyc-off"));
      await pol.connect(owner).setInstitutionPolicyWithReason(instA, KYC, 0, reasonHash);
      expect(await cfg.activeScopeCount()).to.equal(1n);

      // Clear institution override: counter still network-only.
      await pol.connect(owner).clearInstitutionPolicy(instA, KYC);
      expect(await cfg.activeScopeCount()).to.equal(1n);

      // Enforcement still fires for a non-exempt, unaffiliated wallet.
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceKycRequired");
    });

    it("arm/clear churn across scopes returns count to 0", async function () {
      const { diamond, facets, owner, addr1, addr2 } = await loadFixture(fixture);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const cfg = await ethers.getContractAt("ComplianceConfigFacet", diamond.target ?? diamond.address);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      expect(await cfg.activeScopeCount()).to.equal(0n);

      // 1) network kyc arm
      await pol.connect(owner).setNetworkPolicy(KYC, 1);
      expect(await cfg.activeScopeCount()).to.equal(1n);

      // 2) institution kyc arm (different scope/key slot -> count 2)
      await pol.connect(owner).setInstitutionPolicy(instA, KYC, 1);
      expect(await cfg.activeScopeCount()).to.equal(2n);

      // 3) wallet kyc arm (different scope/key slot -> count 3)
      await pol.connect(owner).setWalletPolicy(addr1.address, KYC, 1);
      expect(await cfg.activeScopeCount()).to.equal(3n);

      // 4) sanctions bit arm (different control class -> count 4)
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      expect(await cfg.activeScopeCount()).to.equal(4n);

      // idempotent re-arm must not double-count
      await pol.connect(owner).setNetworkPolicy(KYC, 1);
      await pol.connect(owner).setInstitutionPolicy(instA, KYC, 1);
      await pol.connect(owner).setWalletPolicy(addr1.address, KYC, 1);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      expect(await cfg.activeScopeCount()).to.equal(4n);

      // tear down in reverse
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, false);
      expect(await cfg.activeScopeCount()).to.equal(3n);

      await pol.connect(owner).clearWalletPolicy(addr1.address, KYC);
      expect(await cfg.activeScopeCount()).to.equal(2n);

      await pol.connect(owner).clearInstitutionPolicy(instA, KYC);
      expect(await cfg.activeScopeCount()).to.equal(1n);

      await pol.connect(owner).setNetworkPolicy(KYC, 0);
      expect(await cfg.activeScopeCount()).to.equal(0n);
    });
  });

  describe("requirement-control scoping", function () {
    const KYC = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));
    const SCREEN = ethers.keccak256(ethers.toUtf8Bytes("screening_enforce_active"));

    it("rejects screening_enforce_active as a policy key (sanctions off the stack)", async function () {
      const { diamond, owner } = await loadFixture(fixture);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      await expect(pol.connect(owner).setNetworkPolicy(SCREEN, 1))
        .to.be.revertedWithCustomError(pol, "InvalidPolicyKey");
    });

    it("arming kyc at network scope increments activeScopeCount", async function () {
      const { diamond, owner } = await loadFixture(fixture);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      const cfg = await ethers.getContractAt("ComplianceConfigFacet", diamond.target ?? diamond.address);
      await pol.connect(owner).setNetworkPolicy(KYC, 1);
      expect(await cfg.activeScopeCount()).to.equal(1n);
      await pol.connect(owner).setNetworkPolicy(KYC, 0);
      expect(await cfg.activeScopeCount()).to.equal(0n);
    });

    it("relaxing below network requires COMPLIANCE_EXEMPTION_ROLE + emits event", async function () {
      const { diamond, facets, owner, addr1, addr3 } = await loadFixture(fixture);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      await pol.connect(owner).setNetworkPolicy(KYC, 1);

      // addr3 is DEFAULT_ADMIN but lacks COMPLIANCE_EXEMPTION_ROLE -> revert
      await facets.accessControl.connect(owner).grantRole(ROLES.DEFAULT_ADMIN_ROLE, addr3.address);
      const scopeId = ethers.zeroPadValue(addr1.address, 32);
      await expect(pol.connect(addr3).setWalletPolicy(addr1.address, KYC, 0))
        .to.be.revertedWithCustomError(pol, "ComplianceExemptionRequired")
        .withArgs(scopeId, KYC);

      // owner has COMPLIANCE_EXEMPTION_ROLE and uses the WithReason path -> succeeds + emits
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("test-exemption"));
      await expect(pol.connect(owner).setWalletPolicyWithReason(addr1.address, KYC, 0, reasonHash))
        .to.emit(pol, "ComplianceExemptionGranted")
        .withArgs(scopeId, KYC, reasonHash, owner.address);
    });

    it("B1-T: raising Travel Rule threshold above network requires COMPLIANCE_EXEMPTION_ROLE", async function () {
      const { diamond, facets, owner, addr1 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", addr1.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      await facets.accessControl.connect(owner).grantRole(ROLES.INSTITUTION_ADMIN_ROLE, addr1.address);

      const TRAVEL_RULE_THRESHOLD_USD = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_threshold_usd"));
      const networkThreshold = ethers.parseEther("1");
      const higherThreshold = ethers.parseEther("2");
      const lowerThreshold = ethers.parseEther("0.5");
      await pol.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, networkThreshold);

      // Admin without COMPLIANCE_EXEMPTION_ROLE cannot relax (raise) the threshold.
      await expect(pol.connect(addr1).setInstitutionPolicy(instA, TRAVEL_RULE_THRESHOLD_USD, higherThreshold))
        .to.be.revertedWithCustomError(pol, "ComplianceExemptionRequired")
        .withArgs(instA, TRAVEL_RULE_THRESHOLD_USD);

      // Admin with COMPLIANCE_EXEMPTION_ROLE can relax with reason and emits exemption event.
      await facets.accessControl.connect(owner).grantRole(ROLES.COMPLIANCE_EXEMPTION_ROLE, addr1.address);
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("travel-rule-relax"));
      await expect(pol.connect(addr1).setInstitutionPolicyWithReason(instA, TRAVEL_RULE_THRESHOLD_USD, higherThreshold, reasonHash))
        .to.emit(pol, "ComplianceExemptionGranted")
        .withArgs(instA, TRAVEL_RULE_THRESHOLD_USD, reasonHash, addr1.address);

      // Tightening (lowering) below network does not require an exemption.
      await expect(pol.connect(addr1).setInstitutionPolicy(instA, TRAVEL_RULE_THRESHOLD_USD, lowerThreshold))
        .to.emit(pol, "InstitutionPolicySet")
        .withArgs(instA, TRAVEL_RULE_THRESHOLD_USD, lowerThreshold, addr1.address);
    });

    it("B4-T: raising Travel Rule threshold when network baseline is enforce-all (0) requires COMPLIANCE_EXEMPTION_ROLE", async function () {
      const { diamond, facets, owner, addr1 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", addr1.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      await facets.accessControl.connect(owner).grantRole(ROLES.INSTITUTION_ADMIN_ROLE, addr1.address);

      const TRAVEL_RULE_THRESHOLD_USD = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_threshold_usd"));
      // Network baseline 0 = enforce-all (strictest).
      await pol.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, 0);

      // Any nonzero institution threshold relaxes from enforce-all and requires an exemption.
      const relaxedThreshold = ethers.parseEther("1");
      await expect(pol.connect(addr1).setInstitutionPolicy(instA, TRAVEL_RULE_THRESHOLD_USD, relaxedThreshold))
        .to.be.revertedWithCustomError(pol, "ComplianceExemptionRequired")
        .withArgs(instA, TRAVEL_RULE_THRESHOLD_USD);

      // With the exemption role the relax succeeds and emits an exemption event.
      await facets.accessControl.connect(owner).grantRole(ROLES.COMPLIANCE_EXEMPTION_ROLE, addr1.address);
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("enforce-all-relax"));
      await expect(pol.connect(addr1).setInstitutionPolicyWithReason(instA, TRAVEL_RULE_THRESHOLD_USD, relaxedThreshold, reasonHash))
        .to.emit(pol, "ComplianceExemptionGranted")
        .withArgs(instA, TRAVEL_RULE_THRESHOLD_USD, reasonHash, addr1.address);
    });

    it("B5-T: Travel Rule threshold tightening (override <= network) needs no exemption", async function () {
      const { diamond, facets, owner, addr1 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", addr1.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      await facets.accessControl.connect(owner).grantRole(ROLES.INSTITUTION_ADMIN_ROLE, addr1.address);
      // Explicitly do NOT grant COMPLIANCE_EXEMPTION_ROLE.

      const TRAVEL_RULE_THRESHOLD_USD = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_threshold_usd"));
      await pol.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("2"));

      // Tightening to a lower threshold does not relax the control.
      await expect(pol.connect(addr1).setInstitutionPolicy(instA, TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("1")))
        .to.emit(pol, "InstitutionPolicySet")
        .withArgs(instA, TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("1"), addr1.address);

      // Setting threshold equal to network is also not a relax.
      await expect(pol.connect(addr1).setInstitutionPolicy(instA, TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("2")))
        .to.emit(pol, "InstitutionPolicySet")
        .withArgs(instA, TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("2"), addr1.address);
    });

    it("B3-T: non-Active institution admin cannot write institution policy", async function () {
      const { diamond, facets, owner, addr1 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", addr1.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      await facets.accessControl.connect(owner).grantRole(ROLES.INSTITUTION_ADMIN_ROLE, addr1.address);

      const TRAVEL_RULE_THRESHOLD_USD = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_threshold_usd"));
      // Set a network baseline so the institution override is a tighten, not a relax.
      await pol.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("2"));

      // Active institution admin can set policy.
      await expect(pol.connect(addr1).setInstitutionPolicy(instA, TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("1")))
        .to.emit(pol, "InstitutionPolicySet")
        .withArgs(instA, TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("1"), addr1.address);

      // Suspend the institution.
      await reg.connect(owner).setInstitutionStatus(instA, 2); // InstitutionStatus.Suspended

      // Same admin can no longer modify policy.
      await expect(pol.connect(addr1).setInstitutionPolicy(instA, TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("2")))
        .to.be.revertedWithCustomError(pol, "UnauthorizedRole");
      await expect(pol.connect(addr1).clearInstitutionPolicy(instA, TRAVEL_RULE_THRESHOLD_USD))
        .to.be.revertedWithCustomError(pol, "UnauthorizedRole");

      // Global admin can still write policy for the non-Active institution.
      await expect(pol.connect(owner).setInstitutionPolicy(instA, TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("3")))
        .to.emit(pol, "InstitutionPolicySet")
        .withArgs(instA, TRAVEL_RULE_THRESHOLD_USD, ethers.parseEther("3"), owner.address);
    });

    it("B2-T: non-Active institution admin cannot arm sanctions bit or grant scoped role", async function () {
      const { diamond, facets, owner, addr1, addr2 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", addr1.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      await facets.accessControl.connect(owner).grantRole(ROLES.INSTITUTION_ADMIN_ROLE, addr1.address);

      // Suspend the institution.
      await reg.connect(owner).setInstitutionStatus(instA, 2); // InstitutionStatus.Suspended

      const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));

      // Institution admin of a Suspended institution cannot flip the sanctions bit.
      await expect(scr.connect(addr1).setInstitutionSanctionsEnabled(instA, true))
        .to.be.revertedWithCustomError(scr, "UnauthorizedRole");

      // Institution admin of a Suspended institution cannot grant scoped roles.
      await expect(pol.connect(addr1).grantScopedRole(SCREENING_ATTESTOR, addr2.address, instA))
        .to.be.revertedWithCustomError(pol, "UnauthorizedRole");

      // Global / network authority remains able to arm the bit.
      await expect(scr.connect(owner).setInstitutionSanctionsEnabled(instA, true))
        .to.emit(scr, "InstitutionSanctionsEnabledSet")
        .withArgs(instA, true, owner.address);

      // Global admin remains able to grant scoped roles.
      await expect(pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, addr2.address, instA))
        .to.emit(pol, "ScopedRoleGranted");
    });

    it("institution admin can scoped-grant SCREENING_ATTESTOR_ROLE within its own institution only", async function () {
      const { diamond, diamondAddress, facets, owner, addr1, addr2, addr3 } = await loadFixture(fixture);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      // register instA with addr1 as its admin
      const txA = await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", addr1.address);
      const instA = (await txA.wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      // register instB with addr3 as its admin
      const txB = await reg.connect(owner).registerInstitution("InstB", ethers.ZeroHash, "", addr3.address);
      const instB = (await txB.wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      // grant INSTITUTION_ADMIN_ROLE to addr1 and addr3
      await facets.accessControl.connect(owner).grantRole(ethers.keccak256(ethers.toUtf8Bytes("INSTITUTION_ADMIN_ROLE")), addr1.address);
      await facets.accessControl.connect(owner).grantRole(ethers.keccak256(ethers.toUtf8Bytes("INSTITUTION_ADMIN_ROLE")), addr3.address);

      const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));
      const CAMBIO_ADMIN = ethers.keccak256(ethers.toUtf8Bytes("CAMBIO_ADMIN_ROLE"));

      // addr1 can grant SCREENING_ATTESTOR_ROLE within instA
      await expect(pol.connect(addr1).grantScopedRole(SCREENING_ATTESTOR, addr2.address, instA))
        .to.emit(pol, "ScopedRoleGranted");
      expect(await pol.hasScopedRole(SCREENING_ATTESTOR, addr2.address, instA)).to.equal(true);

      // addr1 CANNOT grant within instB
      await expect(pol.connect(addr1).grantScopedRole(SCREENING_ATTESTOR, addr2.address, instB))
        .to.be.revertedWithCustomError(pol, "UnauthorizedRole");

      // addr1 CANNOT self-grant a non-allowlisted scoped role
      await expect(pol.connect(addr1).grantScopedRole(CAMBIO_ADMIN, addr1.address, instA))
        .to.be.revertedWithCustomError(pol, "UnauthorizedRole");
    });
  });

  describe("institution lifecycle mode and sanctions enforcement", function () {
    const SCREENING_BLOCKED = 3;
    const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));

    async function setupEnforcingInstitution(diamond, facets, owner, bankAddr, otherAddrs) {
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const lifecycle = await ethers.getContractAt("InstitutionLifecycleFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const name = `Inst_${bankAddr.address.slice(2, 8)}`;
      const tx = await reg.connect(owner).registerInstitution(name, ethers.ZeroHash, "", owner.address);
      const instId = (await tx.wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      await lifecycle.connect(owner).linkBankToInstitution(bankAddr.address, instId);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instId);
      return { reg, lifecycle, scr, pol, instId };
    }

    it("D2-T: enforcement continues in ISSUANCE_PAUSED and ORDERLY_EXIT, stops in DEFAULTED and RESOLVED", async function () {
      const { diamond, diamondAddress, facets, owner, admin, addr1, addr2, addr3, custodian1, custodian2 } = await loadFixture(fixture);
      const attached = await deployHarness(diamondAddress, owner);

      // Distinct source wallets so each can be actively affiliated to a different institution.
      const source1 = custodian1;
      const source2 = admin;
      const source3 = custodian2;

      // --- ISSUANCE_PAUSED ---
      const ctx1 = await setupEnforcingInstitution(diamond, facets, owner, addr1, []);
      await ctx1.reg.connect(owner).linkWalletToInstitution(source1.address, ctx1.instId);
      await ctx1.scr.connect(owner).recordScopedScreening(ctx1.instId, addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await expect(attached.harnessPrecheck(source1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned").withArgs(addr2.address);

      await ctx1.lifecycle.connect(owner).setInstitutionMode(addr1.address, 1); // ISSUANCE_PAUSED
      await expect(attached.harnessPrecheck(source1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned").withArgs(addr2.address);

      await ctx1.lifecycle.connect(owner).setInstitutionMode(addr1.address, 0); // ACTIVE

      // --- ORDERLY_EXIT -> RESOLVED ---
      const ctx2 = await setupEnforcingInstitution(diamond, facets, owner, addr2, []);
      await ctx2.reg.connect(owner).linkWalletToInstitution(source2.address, ctx2.instId);
      await ctx2.scr.connect(owner).recordScopedScreening(ctx2.instId, addr3.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await expect(attached.harnessPrecheck(source2.address, addr3.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned").withArgs(addr3.address);

      await ctx2.lifecycle.connect(owner).setInstitutionMode(addr2.address, 2); // ORDERLY_EXIT
      await expect(attached.harnessPrecheck(source2.address, addr3.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned").withArgs(addr3.address);

      await ctx2.lifecycle.connect(owner).setInstitutionMode(addr2.address, 4); // RESOLVED
      await expect(attached.harnessPrecheck(source2.address, addr3.address, 100, 0)).not.to.be.reverted;

      // --- DEFAULTED ---
      const ctx3 = await setupEnforcingInstitution(diamond, facets, owner, addr3, []);
      await ctx3.reg.connect(owner).linkWalletToInstitution(source3.address, ctx3.instId);
      await ctx3.scr.connect(owner).recordScopedScreening(ctx3.instId, addr1.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await expect(attached.harnessPrecheck(source3.address, addr1.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned").withArgs(addr1.address);

      await ctx3.lifecycle.connect(owner).setInstitutionMode(addr3.address, 3); // DEFAULTED
      await expect(attached.harnessPrecheck(source3.address, addr1.address, 100, 0)).not.to.be.reverted;
    });
  });

  describe("wallet recovery sanctions migration", function () {
    describe("DP-B recovery successor migration", function () {
    const SCREENING_BLOCKED = 3;
    const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));

    it("network-BLOCKED source wallet prevents recovery activation until cleared", async function () {
      const { diamond, diamondAddress, facets, owner, admin, custodian1, addr2 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;

      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);

      // arm sanctions so the sanctions predicate runs
      const instId = ethers.keccak256(ethers.toUtf8Bytes("DPB_NET"));
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);

      // Recovery activation is fail-closed: a network block prevents migration.
      const tx = await facets.walletRecovery.connect(owner).initiateRecovery(oldWallet.address, 0);
      const rec = await tx.wait();
      const recoveryId = rec.logs
        .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "RecoveryInitiated").args.recoveryId;
      await expect(facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address))
        .to.be.revertedWithCustomError(facets.walletRecovery, "RecoveryBlockedBySanctions")
        .withArgs(oldWallet.address);

      // After the authority clears the block, migration proceeds and the successor
      // is no longer blocked (the block was explicitly removed, not copied forward).
      await scr.connect(owner).clearNetworkBlock(oldWallet.address, ethers.keccak256(ethers.toUtf8Bytes("dpb-clear")));
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);
      await expect(attached.harnessPrecheck(oldWallet.address, addr2.address, 100, 0)).not.to.be.reverted;

      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, false);
    });

    it("institution-scoped block on the source survives to the successor", async function () {
      const { diamond, diamondAddress, facets, owner, admin, custodian1, addr1, addr2 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;

      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);
      const attached = await deployHarness(diamondAddress, owner);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      await reg.connect(owner).linkWalletToInstitution(addr1.address, instA);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instA);
      await scr.connect(owner).recordScopedScreening(instA, oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const tx = await facets.walletRecovery.connect(owner).initiateRecovery(oldWallet.address, 0);
      const rec = await tx.wait();
      const recoveryId = rec.logs
        .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "RecoveryInitiated").args.recoveryId;
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // addr1 is affiliated to instA; oldWallet resolves to newWallet; instA-scoped block must bite
      await expect(attached.harnessPrecheck(addr1.address, oldWallet.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(newWallet.address);
    });

    it("migrateInstitutionState is idempotent and does not clobber atomic successor migration", async function () {
      const { diamond, diamondAddress, facets, owner, admin, custodian1, addr1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;

      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      const instA = (await (await reg.connect(owner).registerInstitution("InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;

      await reg.connect(owner).linkWalletToInstitution(oldWallet.address, instA);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instA);
      await scr.connect(owner).recordScopedScreening(instA, oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const tx = await facets.walletRecovery.connect(owner).initiateRecovery(oldWallet.address, 0);
      const rec = await tx.wait();
      const recoveryId = rec.logs
        .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "RecoveryInitiated").args.recoveryId;
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      const affAfterAtomic = await reg.getWalletAffiliation(newWallet.address);
      expect(affAfterAtomic.institutionId).to.equal(instA);
      const scopedAfterAtomic = await scr.getScopedScreening(instA, newWallet.address);
      expect(scopedAfterAtomic.status).to.equal(SCREENING_BLOCKED);

      // First migrateInstitutionState call must be a no-op relative to atomic state
      await facets.walletRecovery.connect(owner).migrateInstitutionState(recoveryId, [instA], [SCREENING_ATTESTOR], [ethers.ZeroHash]);
      const affAfterMigrate = await reg.getWalletAffiliation(newWallet.address);
      expect(affAfterMigrate.institutionId).to.equal(instA);
      const scopedAfterMigrate = await scr.getScopedScreening(instA, newWallet.address);
      expect(scopedAfterMigrate.status).to.equal(SCREENING_BLOCKED);

      // Second call must also be a no-op
      await facets.walletRecovery.connect(owner).migrateInstitutionState(recoveryId, [instA], [SCREENING_ATTESTOR], [ethers.ZeroHash]);
      const affAfterSecond = await reg.getWalletAffiliation(newWallet.address);
      expect(affAfterSecond.institutionId).to.equal(instA);
    });

    it("A1-T: multiply-scoped screenings migrate fully and chain through a second recovery", async function () {
      const { diamond, diamondAddress, facets, owner, admin, custodian1, addr3, addr1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const succ1 = admin;
      const succ2 = addr3;

      await makeEligibleSuccessor(facets, owner, custodian1, succ1);
      await makeEligibleSuccessor(facets, owner, custodian1, succ2);

      const reg = await ethers.getContractAt("InstitutionRegistryFacet", diamond.target ?? diamond.address);
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      // Register three institutions and enable sanctions on each.
      const insts = [];
      for (const name of ["InstA", "InstB", "InstC"]) {
        const tx = await reg.connect(owner).registerInstitution(name, ethers.ZeroHash, "", owner.address);
        const id = (await tx.wait()).logs
          .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
          .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;
        insts.push(id);
        await scr.connect(owner).setInstitutionSanctionsEnabled(id, true);
        await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, id);
      }

      // Place scoped BLOCKED records on oldWallet under all three institutions.
      for (const id of insts) {
        await scr.connect(owner).recordScopedScreening(id, oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);
      }

      // First recovery: oldWallet -> succ1.
      const tx1 = await facets.walletRecovery.connect(owner).initiateRecovery(oldWallet.address, 0);
      const rec1 = await tx1.wait();
      const recoveryId = rec1.logs
        .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "RecoveryInitiated").args.recoveryId;
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, succ1.address);

      // All three scoped blocks must have migrated to succ1; oldWallet records cleared.
      for (const id of insts) {
        expect((await scr.getScopedScreening(id, succ1.address)).status).to.equal(SCREENING_BLOCKED);
        expect((await scr.getScopedScreening(id, oldWallet.address)).status).to.equal(0); // NONE
        expect(await scr.isWalletScopedInstitution(succ1.address, id)).to.equal(true);
        expect(await scr.isWalletScopedInstitution(oldWallet.address, id)).to.equal(false);
      }

      // Second recovery: redirect succ1 -> succ2; blocks must chain through.
      await facets.walletRecovery.connect(owner).redirectSuccessor(recoveryId, succ2.address);
      for (const id of insts) {
        expect((await scr.getScopedScreening(id, succ2.address)).status).to.equal(SCREENING_BLOCKED);
        expect((await scr.getScopedScreening(id, succ1.address)).status).to.equal(0); // NONE
        expect(await scr.isWalletScopedInstitution(succ2.address, id)).to.equal(true);
        expect(await scr.isWalletScopedInstitution(succ1.address, id)).to.equal(false);
      }

      // Enforcement still bites via recovery resolution.
      const attached = await deployHarness(diamondAddress, owner);
      await reg.connect(owner).linkWalletToInstitution(addr1.address, insts[0]);
      await expect(attached.harnessPrecheck(addr1.address, oldWallet.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(succ2.address);

      // Cleanup
      for (const id of insts) {
        await scr.connect(owner).setInstitutionSanctionsEnabled(id, false);
      }
    });

    it("NetworkClearance record migrates to successor and is deleted from source", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("false-positive"));
      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await scr.connect(owner).clearNetworkBlock(oldWallet.address, reasonHash);

      const tx = await facets.walletRecovery.connect(owner).initiateRecovery(oldWallet.address, 0);
      const rec = await tx.wait();
      const recoveryId = rec.logs
        .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "RecoveryInitiated").args.recoveryId;
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      const succClearance = await scr.getNetworkClearance(newWallet.address);
      expect(succClearance.clearedAt).to.be.gt(0n);
      expect(succClearance.reasonHash).to.equal(reasonHash);
      expect(succClearance.previousStatus).to.equal(SCREENING_BLOCKED);

      const oldClearance = await scr.getNetworkClearance(oldWallet.address);
      expect(oldClearance.clearedAt).to.equal(0n);
    });
  });

    describe("wallet recovery blocked by network sanctions", function () {
    const SCREENING_BLOCKED = 3;

    async function initiateAndGetId(walletRecovery, owner, oldWallet, recoveryType = 0) {
      const tx = await walletRecovery.connect(owner).initiateRecovery(oldWallet.address, recoveryType);
      const rec = await tx.wait();
      return rec.logs
        .map(l => { try { return walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "RecoveryInitiated").args.recoveryId;
    }

    it("designateSuccessor reverts when oldWallet is network-BLOCKED", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const recoveryId = await initiateAndGetId(facets.walletRecovery, owner, oldWallet);
      await expect(facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address))
        .to.be.revertedWithCustomError(facets.walletRecovery, "RecoveryBlockedBySanctions")
        .withArgs(oldWallet.address);
    });

    it("designateSuccessor reverts when proposed successor is network-BLOCKED", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      await scr.connect(owner).recordNetworkScreening(newWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const recoveryId = await initiateAndGetId(facets.walletRecovery, owner, oldWallet);
      await expect(facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address))
        .to.be.revertedWithCustomError(facets.walletRecovery, "RecoveryBlockedBySanctions")
        .withArgs(newWallet.address);
    });

    it("clearing the block allows recovery + migrateBalance to complete (regression)", async function () {
      const { diamond, diamondAddress, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const scr = await ethers.getContractAt("ComplianceScreeningFacet", diamond.target ?? diamond.address);
      const mintBurn = await ethers.getContractAt("T3TokenMintBurnFacet", diamond.target ?? diamond.address);
      const accessControl = await ethers.getContractAt("AccessControlFacet", diamond.target ?? diamond.address);

      // Fund oldWallet via a legacy mint.
      const amount = ethers.parseEther("10");
      await accessControl.connect(owner).grantRole(ROLES.MINTER_ROLE, owner.address);
      await mintBurn.connect(owner).mint(oldWallet.address, amount);

      // Arm sanctions and block the old wallet.
      const instId = ethers.keccak256(ethers.toUtf8Bytes("RECOVERY_BLOCK"));
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
      await scr.connect(owner).recordNetworkScreening(oldWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const recoveryId = await initiateAndGetId(facets.walletRecovery, owner, oldWallet);

      // Block must prevent designation.
      await expect(facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address))
        .to.be.revertedWithCustomError(facets.walletRecovery, "RecoveryBlockedBySanctions")
        .withArgs(oldWallet.address);

      // Authority clears the block.
      await scr.connect(owner).clearNetworkBlock(oldWallet.address, ethers.keccak256(ethers.toUtf8Bytes("false-positive")));

      // Recovery proceeds and balance migrates without self-lock.
      await expect(facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address))
        .to.emit(facets.walletRecovery, "RecoverySuccessorDesignated");
      await expect(facets.walletRecovery.connect(owner).migrateBalance(recoveryId, []))
        .to.emit(facets.walletRecovery, "RecoveryBalanceMigrated")
        .withArgs(recoveryId, oldWallet.address, newWallet.address, amount);

      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, false);
    });

    it("normal unblocked recovery still works end-to-end", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const recoveryId = await initiateAndGetId(facets.walletRecovery, owner, oldWallet);
      await expect(facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address))
        .to.emit(facets.walletRecovery, "RecoverySuccessorDesignated");
      await expect(facets.walletRecovery.connect(owner).migrateBalance(recoveryId, []))
        .to.emit(facets.walletRecovery, "RecoveryBalanceMigrated");
    });
  });
  });

  describe("CF-R Obs-1: per-control arming counters", function () {
    const KYC = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));
    const TR = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_enforce_active"));
    const CIP = ethers.keccak256(ethers.toUtf8Bytes("cip_enforce_active"));
    const SCREENING_BLOCKED = 3;

    async function handles(ctx) {
      const { diamond, diamondAddress, owner, addr1, addr2 } = ctx;
      const addr = diamond.target ?? diamond.address;
      return {
        owner, addr1, addr2,
        pol: await ethers.getContractAt("InstitutionPolicyFacet", addr),
        scr: await ethers.getContractAt("ComplianceScreeningFacet", addr),
        reg: await ethers.getContractAt("InstitutionRegistryFacet", addr),
        cfg: await ethers.getContractAt("ComplianceConfigFacet", addr),
        attached: await deployHarness(diamondAddress, owner),
      };
    }

    async function registerInst(reg, owner, name) {
      const rc = await (await reg.connect(owner).registerInstitution(name, ethers.ZeroHash, "", owner.address)).wait();
      return rc.logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;
    }

    it("each arming path increments only its own counter", async function () {
      const base = await loadFixture(fixture);
      const { owner, pol, scr, reg, cfg } = await handles(base);

      await pol.connect(owner).setNetworkPolicy(KYC, 1);
      expect(await cfg.kycScopeCount()).to.equal(1n);
      expect(await cfg.sanctionsScopeCount()).to.equal(0n);
      expect(await cfg.cipScopeCount()).to.equal(0n);
      expect(await cfg.travelRuleScopeCount()).to.equal(0n);

      await pol.connect(owner).setNetworkPolicy(CIP, 1);
      expect(await cfg.cipScopeCount()).to.equal(1n);

      await pol.connect(owner).setNetworkPolicy(TR, 1);
      expect(await cfg.travelRuleScopeCount()).to.equal(1n);

      const instA = await registerInst(reg, owner, "InstA");
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      expect(await cfg.sanctionsScopeCount()).to.equal(1n);

      // Sum view + armed view derive from the per-control counters.
      expect(await cfg.activeScopeCount()).to.equal(4n);
      expect(await cfg.complianceArmed()).to.equal(true);
    });

    it("travel rule armed alone does NOT activate sanctions screening", async function () {
      const base = await loadFixture(fixture);
      const { owner, addr1, addr2, pol, scr, cfg, attached } = await handles(base);

      await pol.connect(owner).setNetworkPolicy(TR, 1);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      // Old single-counter behavior: this reverted ComplianceSanctioned. Now the
      // sanctions control is unarmed, so the network block does not screen here.
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;
      expect(await cfg.sanctionsScopeCount()).to.equal(0n);
      expect(await cfg.complianceArmed()).to.equal(true);
    });

    it("KYC armed alone does NOT activate sanctions screening (reverts KYC, not sanctioned)", async function () {
      const base = await loadFixture(fixture);
      const { owner, addr1, addr2, pol, scr, attached } = await handles(base);

      await pol.connect(owner).setNetworkPolicy(KYC, 1);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceKycRequired");
    });

    it("CIP armed alone does NOT activate sanctions screening (reverts CIP, not sanctioned)", async function () {
      const base = await loadFixture(fixture);
      const { owner, addr1, addr2, pol, scr, attached } = await handles(base);

      await pol.connect(owner).setNetworkPolicy(CIP, 1);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceCIPRequired");
    });

    it("sanctions armed alone (DP-A) screens without requiring KYC/CIP", async function () {
      const base = await loadFixture(fixture);
      const { owner, addr1, addr2, scr, reg, attached } = await handles(base);

      const instA = await registerInst(reg, owner, "InstA");
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);

      // No KYC/CIP records anywhere: clean parties pass (requirements unarmed) ...
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;

      // ... and a network-blocked recipient is screened.
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
    });

    it("pairwise: travel rule + sanctions armed — sanctions bites, KYC does not", async function () {
      const base = await loadFixture(fixture);
      const { owner, addr1, addr2, pol, scr, reg, attached } = await handles(base);

      await pol.connect(owner).setNetworkPolicy(TR, 1);
      const instA = await registerInst(reg, owner, "InstA");
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
    });

    it("counters never underflow on set/unset/re-set sequences (both feeding paths)", async function () {
      const base = await loadFixture(fixture);
      const { owner, pol, scr, reg, cfg } = await handles(base);

      // Policy-key path: re-set while armed is a no-op; double-unset stays at 0.
      await pol.connect(owner).setNetworkPolicy(KYC, 1);
      await pol.connect(owner).setNetworkPolicy(KYC, 1);
      expect(await cfg.kycScopeCount()).to.equal(1n);
      await pol.connect(owner).setNetworkPolicy(KYC, 0);
      await pol.connect(owner).setNetworkPolicy(KYC, 0);
      expect(await cfg.kycScopeCount()).to.equal(0n);

      // Institution-scope churn on the same key.
      const instA = await registerInst(reg, owner, "InstA");
      await pol.connect(owner).setInstitutionPolicy(instA, KYC, 1);
      await pol.connect(owner).setInstitutionPolicy(instA, KYC, 1);
      expect(await cfg.kycScopeCount()).to.equal(1n);
      await pol.connect(owner).clearInstitutionPolicy(instA, KYC);
      await pol.connect(owner).clearInstitutionPolicy(instA, KYC);
      expect(await cfg.kycScopeCount()).to.equal(0n);

      // DP-A path: idempotent enable/disable.
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      expect(await cfg.sanctionsScopeCount()).to.equal(1n);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, false);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, false);
      expect(await cfg.sanctionsScopeCount()).to.equal(0n);

      expect(await cfg.activeScopeCount()).to.equal(0n);
      expect(await cfg.complianceArmed()).to.equal(false);
    });

    it("Sprint 1 fixes hold under per-control arming: BANK_MINT recipient screened iff sanctions armed", async function () {
      const base = await loadFixture(fixture);
      const { owner, addr1, addr2, pol, scr, reg, attached } = await handles(base);

      // Travel rule armed alone: blocked recipient may still receive mint (sanctions unarmed).
      await pol.connect(owner).setNetworkPolicy(TR, 1);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 3)).not.to.be.reverted;

      // Sanctions armed: CF-1 recipient screening bites on BANK_MINT.
      const instA = await registerInst(reg, owner, "InstA");
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 3))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
      // Minter leg still unscreened (D5).
      await expect(attached.harnessPrecheck(addr2.address, addr1.address, 100, 3)).not.to.be.reverted;
    });

    it("travel-rule-only arming leaves precheckGated a no-op (gate exclusion locked in)", async function () {
      const base = await loadFixture(fixture);
      const { owner, addr1, addr2, pol, scr, reg, attached } = await handles(base);

      // Travel rule enforces at envelope creation (bindOnCreate), not precheck:
      // arming it alone must not fire the external compliance gate per transfer.
      await pol.connect(owner).setNetworkPolicy(TR, 1);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await expect(attached.harnessPrecheckGated(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;

      // Arming a genuine precheck control (sanctions) switches the gate on.
      const instA = await registerInst(reg, owner, "InstA");
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      await expect(attached.harnessPrecheckGated(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
    });

    it("wallet-scope explicit-0 override churn keeps kycScopeCount in sync", async function () {
      const base = await loadFixture(fixture);
      const { owner, addr1, pol, cfg } = await handles(base);

      // Explicit 0 override sets walletPolicySet without arming: no counter move.
      await pol.connect(owner).setWalletPolicy(addr1.address, KYC, 0);
      expect(await cfg.kycScopeCount()).to.equal(0n);

      // Arm, idempotent re-arm, disarm to explicit 0, then clear the unarmed slot.
      await pol.connect(owner).setWalletPolicy(addr1.address, KYC, 1);
      expect(await cfg.kycScopeCount()).to.equal(1n);
      await pol.connect(owner).setWalletPolicy(addr1.address, KYC, 1);
      expect(await cfg.kycScopeCount()).to.equal(1n);
      await pol.connect(owner).setWalletPolicy(addr1.address, KYC, 0);
      expect(await cfg.kycScopeCount()).to.equal(0n);
      await pol.connect(owner).clearWalletPolicy(addr1.address, KYC);
      await pol.connect(owner).clearWalletPolicy(addr1.address, KYC);
      expect(await cfg.kycScopeCount()).to.equal(0n);

      // Re-arm then clear the ARMED slot: exactly one decrement, no underflow.
      await pol.connect(owner).setWalletPolicy(addr1.address, KYC, 1);
      expect(await cfg.kycScopeCount()).to.equal(1n);
      await pol.connect(owner).clearWalletPolicy(addr1.address, KYC);
      expect(await cfg.kycScopeCount()).to.equal(0n);
    });
  });

  describe("CF-R Obs-2: relax guard vs effective parent", function () {
    const KYC = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));
    const TRT = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_threshold_usd"));

    async function polReg(ctx) {
      const addr = ctx.diamond.target ?? ctx.diamond.address;
      return {
        pol: await ethers.getContractAt("InstitutionPolicyFacet", addr),
        reg: await ethers.getContractAt("InstitutionRegistryFacet", addr),
      };
    }

    async function registerInst(reg, owner, name) {
      const rc = await (await reg.connect(owner).registerInstitution(name, ethers.ZeroHash, "", owner.address)).wait();
      return rc.logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;
    }

    it("lowering a network baseline (boolean key) requires COMPLIANCE_EXEMPTION_ROLE; raising stays admin", async function () {
      const base = await loadFixture(fixture);
      const { facets, owner, addr3 } = base;
      const { pol } = await polReg(base);

      // addr3 is DEFAULT_ADMIN but lacks COMPLIANCE_EXEMPTION_ROLE.
      await facets.accessControl.connect(owner).grantRole(ROLES.DEFAULT_ADMIN_ROLE, addr3.address);

      // Raising (arming) the baseline is admin-only — no exemption needed.
      await expect(pol.connect(addr3).setNetworkPolicy(KYC, 1))
        .to.emit(pol, "NetworkPolicySet").withArgs(KYC, 1, addr3.address);

      // Lowering (disarming) is a relax vs the current network value.
      await expect(pol.connect(addr3).setNetworkPolicy(KYC, 0))
        .to.be.revertedWithCustomError(pol, "ComplianceExemptionRequired")
        .withArgs(ethers.ZeroHash, KYC);

      // Holder of the exemption role can lower it; exemption event is emitted.
      await expect(pol.connect(owner).setNetworkPolicy(KYC, 0))
        .to.emit(pol, "ComplianceExemptionGranted")
        .withArgs(ethers.ZeroHash, KYC, ethers.ZeroHash, owner.address);
      expect(await pol.getNetworkPolicy(KYC)).to.equal(0n);
    });

    it("raising the network Travel Rule threshold requires the exemption role; tightening does not", async function () {
      const base = await loadFixture(fixture);
      const { facets, owner, addr3 } = base;
      const { pol } = await polReg(base);

      await facets.accessControl.connect(owner).grantRole(ROLES.DEFAULT_ADMIN_ROLE, addr3.address);
      await pol.connect(owner).setNetworkPolicy(TRT, ethers.parseEther("100"));

      // Raising the threshold screens fewer transfers = relax.
      await expect(pol.connect(addr3).setNetworkPolicy(TRT, ethers.parseEther("200")))
        .to.be.revertedWithCustomError(pol, "ComplianceExemptionRequired")
        .withArgs(ethers.ZeroHash, TRT);

      // Lowering and enforce-all (0) are tighten — no exemption needed.
      await expect(pol.connect(addr3).setNetworkPolicy(TRT, ethers.parseEther("50")))
        .to.emit(pol, "NetworkPolicySet").withArgs(TRT, ethers.parseEther("50"), addr3.address);
      await expect(pol.connect(addr3).setNetworkPolicy(TRT, 0))
        .to.emit(pol, "NetworkPolicySet").withArgs(TRT, 0, addr3.address);
    });

    it("institution-scope relax of a network-armed boolean baseline requires the exemption role", async function () {
      const base = await loadFixture(fixture);
      const { facets, owner, addr3 } = base;
      const { pol, reg } = await polReg(base);

      await facets.accessControl.connect(owner).grantRole(ROLES.DEFAULT_ADMIN_ROLE, addr3.address);
      const instA = await registerInst(reg, owner, "InstA");
      await pol.connect(owner).setNetworkPolicy(KYC, 1);

      await expect(pol.connect(addr3).setInstitutionPolicy(instA, KYC, 0))
        .to.be.revertedWithCustomError(pol, "ComplianceExemptionRequired")
        .withArgs(instA, KYC);

      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("inst-relax"));
      await expect(pol.connect(owner).setInstitutionPolicyWithReason(instA, KYC, 0, reasonHash))
        .to.emit(pol, "ComplianceExemptionGranted")
        .withArgs(instA, KYC, reasonHash, owner.address);
    });

    it("three-tier: wallet relax is judged against the institution override, not the raw network value", async function () {
      const base = await loadFixture(fixture);
      const { facets, owner, addr1, addr3 } = base;
      const { pol, reg } = await polReg(base);

      await facets.accessControl.connect(owner).grantRole(ROLES.DEFAULT_ADMIN_ROLE, addr3.address);
      const instA = await registerInst(reg, owner, "InstA");
      await reg.connect(owner).linkWalletToInstitution(addr1.address, instA);

      // Network 100, institution tightens to 50 -> effective parent for the wallet is 50.
      await pol.connect(owner).setNetworkPolicy(TRT, ethers.parseEther("100"));
      await pol.connect(owner).setInstitutionPolicy(instA, TRT, ethers.parseEther("50"));

      // 80 is below the raw network 100 but ABOVE the effective parent 50 -> relax.
      const scopeId = ethers.zeroPadValue(addr1.address, 32);
      await expect(pol.connect(addr3).setWalletPolicy(addr1.address, TRT, ethers.parseEther("80")))
        .to.be.revertedWithCustomError(pol, "ComplianceExemptionRequired")
        .withArgs(scopeId, TRT);

      // With the exemption role the relax succeeds and emits the exemption event.
      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("wallet-relax"));
      await expect(pol.connect(owner).setWalletPolicyWithReason(addr1.address, TRT, ethers.parseEther("80"), reasonHash))
        .to.emit(pol, "ComplianceExemptionGranted")
        .withArgs(scopeId, TRT, reasonHash, owner.address);

      // Tightening below the institution parent needs no exemption.
      await expect(pol.connect(addr3).setWalletPolicy(addr1.address, TRT, ethers.parseEther("40")))
        .to.emit(pol, "WalletPolicySet")
        .withArgs(addr1.address, TRT, ethers.parseEther("40"), addr3.address);
    });

    it("wallet with no institution override falls back to the network parent", async function () {
      const base = await loadFixture(fixture);
      const { facets, owner, addr1, addr3 } = base;
      const { pol } = await polReg(base);

      await facets.accessControl.connect(owner).grantRole(ROLES.DEFAULT_ADMIN_ROLE, addr3.address);
      await pol.connect(owner).setNetworkPolicy(TRT, ethers.parseEther("100"));

      // 80 < network 100 with no institution override -> tighten, no exemption needed.
      await expect(pol.connect(addr3).setWalletPolicy(addr1.address, TRT, ethers.parseEther("80")))
        .to.emit(pol, "WalletPolicySet")
        .withArgs(addr1.address, TRT, ethers.parseEther("80"), addr3.address);

      // 120 > network 100 -> relax, guarded.
      const scopeId = ethers.zeroPadValue(addr1.address, 32);
      await expect(pol.connect(addr3).setWalletPolicy(addr1.address, TRT, ethers.parseEther("120")))
        .to.be.revertedWithCustomError(pol, "ComplianceExemptionRequired")
        .withArgs(scopeId, TRT);
    });

    it("wallet-scope boolean relax is judged against the institution effective parent", async function () {
      const base = await loadFixture(fixture);
      const { facets, owner, addr1, addr2, addr3 } = base;
      const { pol, reg } = await polReg(base);

      await facets.accessControl.connect(owner).grantRole(ROLES.DEFAULT_ADMIN_ROLE, addr3.address);
      const instA = await registerInst(reg, owner, "InstA");
      await reg.connect(owner).linkWalletToInstitution(addr1.address, instA);

      // Network unarmed, institution arms KYC -> effective parent for addr1 is 1.
      await pol.connect(owner).setInstitutionPolicy(instA, KYC, 1);

      // Disarming the wallet below its armed institution parent is a relax.
      const scopeId = ethers.zeroPadValue(addr1.address, 32);
      await expect(pol.connect(addr3).setWalletPolicy(addr1.address, KYC, 0))
        .to.be.revertedWithCustomError(pol, "ComplianceExemptionRequired")
        .withArgs(scopeId, KYC);

      const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("wallet-bool-relax"));
      await expect(pol.connect(owner).setWalletPolicyWithReason(addr1.address, KYC, 0, reasonHash))
        .to.emit(pol, "ComplianceExemptionGranted")
        .withArgs(scopeId, KYC, reasonHash, owner.address);

      // Unaffiliated wallet falls back to the unarmed network parent: 0 is no relax.
      await expect(pol.connect(addr3).setWalletPolicy(addr2.address, KYC, 0))
        .to.emit(pol, "WalletPolicySet")
        .withArgs(addr2.address, KYC, 0, addr3.address);
    });

    it("clearing a tighter institution override is a guarded implicit relax (kimi S2 MED)", async function () {
      const base = await loadFixture(fixture);
      const { facets, owner, addr3 } = base;
      const { pol, reg } = await polReg(base);

      await facets.accessControl.connect(owner).grantRole(ROLES.DEFAULT_ADMIN_ROLE, addr3.address);
      const instA = await registerInst(reg, owner, "InstA");

      // Network 100, institution tightens to 50 (free). Clearing reverts the
      // institution to the looser 100 baseline -> same relax as setting 100.
      await pol.connect(owner).setNetworkPolicy(TRT, ethers.parseEther("100"));
      await pol.connect(addr3).setInstitutionPolicy(instA, TRT, ethers.parseEther("50"));

      await expect(pol.connect(addr3).clearInstitutionPolicy(instA, TRT))
        .to.be.revertedWithCustomError(pol, "ComplianceExemptionRequired")
        .withArgs(instA, TRT);

      await expect(pol.connect(owner).clearInstitutionPolicy(instA, TRT))
        .to.emit(pol, "ComplianceExemptionGranted")
        .withArgs(instA, TRT, ethers.ZeroHash, owner.address);

      // An override equal to the parent clears freely (no effective relax).
      await pol.connect(addr3).setInstitutionPolicy(instA, TRT, ethers.parseEther("100"));
      await expect(pol.connect(addr3).clearInstitutionPolicy(instA, TRT))
        .to.emit(pol, "InstitutionPolicyCleared")
        .withArgs(instA, TRT, addr3.address);
    });

    it("clearing an armed wallet boolean override is a guarded implicit relax (kimi S2 MED)", async function () {
      const base = await loadFixture(fixture);
      const { facets, owner, addr1, addr3 } = base;
      const { pol } = await polReg(base);

      await facets.accessControl.connect(owner).grantRole(ROLES.DEFAULT_ADMIN_ROLE, addr3.address);

      // Network unarmed; wallet arms KYC locally (tighten, free). Clearing it
      // disarms back to the looser parent -> guarded.
      await pol.connect(addr3).setWalletPolicy(addr1.address, KYC, 1);

      const scopeId = ethers.zeroPadValue(addr1.address, 32);
      await expect(pol.connect(addr3).clearWalletPolicy(addr1.address, KYC))
        .to.be.revertedWithCustomError(pol, "ComplianceExemptionRequired")
        .withArgs(scopeId, KYC);

      await expect(pol.connect(owner).clearWalletPolicy(addr1.address, KYC))
        .to.emit(pol, "ComplianceExemptionGranted")
        .withArgs(scopeId, KYC, ethers.ZeroHash, owner.address);
    });
  });

  describe("K-F1: recipient screened at escrow creation", function () {
    const SCREENING_BLOCKED = 3;

    async function setup(ctx) {
      const { diamond, diamondAddress, facets, owner, addr1 } = ctx;
      const addr = diamond.target ?? diamond.address;
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", addr);
      const attached = await deployHarness(diamondAddress, owner);
      // fund + approve the sender so creates reach escrow when they pass
      await facets.accessControl.connect(owner).grantRole(ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")), owner.address);
      await facets.mintBurn.connect(owner).mint(addr1.address, ethers.parseEther("100"));
      await facets.erc20.connect(addr1).approve(diamondAddress, ethers.parseEther("100"));
      return { scr, attached };
    }

    async function armSanctions(scr, owner) {
      const instId = ethers.keccak256(ethers.toUtf8Bytes("KF1_ARM"));
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
    }

    it("createEnvelope to a network-blocked recipient reverts iff sanctions armed", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, addr1, addr2 } = ctx;
      const { scr, attached } = await setup(ctx);
      const commitWindowEnd = uint40((await time.latest()) + 3600);

      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      // Sanctions unarmed -> block does not bite (default-off preserved).
      await expect(facets.envelope.connect(addr1).createEnvelope(
        addr2.address, ethers.parseEther("1"), commitWindowEnd, 0, 0, "0x"
      )).not.to.be.reverted;

      // Armed -> the named recipient is screened at creation (K-F1).
      await armSanctions(scr, owner);
      await expect(facets.envelope.connect(addr1).createEnvelope(
        addr2.address, ethers.parseEther("1"), commitWindowEnd + 1n, 0, 0, "0x"
      )).to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
    });

    it("createSmartLockEnvelope to a network-blocked recipient reverts when armed", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, addr1, addr2, addr3 } = ctx;
      const { scr, attached } = await setup(ctx);
      const commitWindowEnd = uint40((await time.latest()) + 3600);
      const hashCommitment = ethers.keccak256(ethers.toUtf8Bytes("smartlock-secret"));

      await armSanctions(scr, owner);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      await expect(facets.smartLockEnvelope.connect(addr1).createSmartLockEnvelope(
        addr2.address, ethers.parseEther("1"), hashCommitment, ethers.ZeroHash, commitWindowEnd, addr1.address
      )).to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);

      // Clean recipient still passes with sanctions armed.
      await expect(facets.smartLockEnvelope.connect(addr1).createSmartLockEnvelope(
        addr3.address, ethers.parseEther("1"), hashCommitment, ethers.ZeroHash, commitWindowEnd + 1n, addr1.address
      )).not.to.be.reverted;
    });

    it("createChildEnvelope to a network-blocked recipient reverts when armed", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, addr1, addr2, addr3 } = ctx;
      const { scr, attached } = await setup(ctx);
      const commitWindowEnd = uint40((await time.latest()) + 3600);

      // Parent to a clean recipient first.
      const tx = await facets.envelope.connect(addr1).createEnvelope(
        addr3.address, ethers.parseEther("2"), commitWindowEnd, 0, 0, "0x"
      );
      await tx.wait();
      const ids = await facets.envelope.getEnvelopesBySender(addr1.address);
      const parentId = ids[ids.length - 1];

      await armSanctions(scr, owner);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      await expect(facets.envelopeInheritance.connect(addr1).createChildEnvelope(
        parentId, addr2.address, ethers.parseEther("1"), commitWindowEnd
      )).to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);

      // Clean child recipient passes.
      await expect(facets.envelopeInheritance.connect(addr1).createChildEnvelope(
        parentId, addr3.address, ethers.parseEther("1"), commitWindowEnd
      )).not.to.be.reverted;
    });

    it("zero recipient (Cambio bearer-note leg) is never screened", async function () {
      const ctx = await loadFixture(fixture);
      const { owner, addr1 } = ctx;
      const { scr, attached } = await setup(ctx);

      await armSanctions(scr, owner);
      // ESCROW_IN with to == address(0) must not screen the recipient leg.
      await expect(attached.harnessPrecheck(addr1.address, ethers.ZeroAddress, 100, 1)).not.to.be.reverted;
    });

    it("in-recovery recipient resolves to its successor before screening", async function () {
      const ctx = await loadFixture(fixture);
      const { facets, owner, admin, custodian1, addr1 } = ctx;
      const { scr, attached } = await setup(ctx);
      const oldWallet = custodian1;
      const newWallet = admin;

      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);
      const tx = await facets.walletRecovery.connect(owner).initiateRecovery(oldWallet.address, 0);
      const rec = await tx.wait();
      const recoveryId = rec.logs
        .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "RecoveryInitiated").args.recoveryId;
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // Arm sanctions and block the SUCCESSOR, not the named recipient.
      await armSanctions(scr, owner);
      await scr.connect(owner).recordNetworkScreening(newWallet.address, SCREENING_BLOCKED, ethers.ZeroHash);

      const commitWindowEnd = uint40((await time.latest()) + 3600);
      // Naming the in-recovery wallet as recipient screens its successor (K-F1 +
      // payee resolution): the revert carries the RESOLVED address.
      await expect(facets.envelope.connect(addr1).createEnvelope(
        oldWallet.address, ethers.parseEther("1"), commitWindowEnd, 0, 0, "0x"
      )).to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(newWallet.address);
    });
  });

  describe("C-F9: screening freshness under armed sanctions", function () {
    const SCREENING_BLOCKED = 3;
    const SCREENING_CLEAR = 1;
    const STALE_WINDOW = 3600;

    async function setup(ctx) {
      const { diamond, diamondAddress, owner } = ctx;
      const addr = diamond.target ?? diamond.address;
      const scr = await ethers.getContractAt("ComplianceScreeningFacet", addr);
      const attached = await deployHarness(diamondAddress, owner);
      return { scr, attached };
    }

    async function armSanctions(scr, owner) {
      const instId = ethers.keccak256(ethers.toUtf8Bytes("CF9_ARM"));
      await scr.connect(owner).setInstitutionSanctionsEnabled(instId, true);
    }

    it("fresh screenings pass; the same records fail closed once stale", async function () {
      const ctx = await loadFixture(fixture);
      const { owner, addr1, addr2 } = ctx;
      const { scr, attached } = await setup(ctx);

      await armSanctions(scr, owner);
      await scr.connect(owner).recordNetworkScreening(addr1.address, SCREENING_CLEAR, ethers.ZeroHash);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_CLEAR, ethers.ZeroHash);
      await scr.connect(owner).setScreeningStaleAfter(STALE_WINDOW);

      // Fresh records pass under the armed freshness regime.
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;

      // The same records, past the window, fail closed (from leg checked first).
      await time.increase(STALE_WINDOW + 1);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceScreeningStale")
        .withArgs(addr1.address);

      // Re-screening restores passage.
      await scr.connect(owner).recordNetworkScreening(addr1.address, SCREENING_CLEAR, ethers.ZeroHash);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_CLEAR, ethers.ZeroHash);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;
    });

    it("never-screened parties fail closed under an armed freshness regime", async function () {
      const ctx = await loadFixture(fixture);
      const { owner, addr1, addr2 } = ctx;
      const { scr, attached } = await setup(ctx);

      await armSanctions(scr, owner);
      await scr.connect(owner).setScreeningStaleAfter(STALE_WINDOW);

      // lastScreenedAt == 0 is stricter than the isScreeningStale() view: no
      // record at all fails closed when a window is configured.
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceScreeningStale")
        .withArgs(addr1.address);

      await scr.connect(owner).recordNetworkScreening(addr1.address, SCREENING_CLEAR, ethers.ZeroHash);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceScreeningStale")
        .withArgs(addr2.address);

      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_CLEAR, ethers.ZeroHash);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;
    });

    it("window 0 (default) preserves today's behavior exactly", async function () {
      const ctx = await loadFixture(fixture);
      const { owner, addr1, addr2 } = ctx;
      const { scr, attached } = await setup(ctx);

      await armSanctions(scr, owner);

      // Never-screened parties pass when no window is configured.
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;

      // An arbitrarily old CLEAR record also passes without a window.
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_CLEAR, ethers.ZeroHash);
      await time.increase(365 * 24 * 3600);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;

      // Sanity: BLOCKED still blocks regardless of freshness config.
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
    });

    it("freshness applies only to CHECKED legs (ESCROW_RELEASE screens `to` only)", async function () {
      const ctx = await loadFixture(fixture);
      const { owner, addr1, addr2 } = ctx;
      const { scr, attached } = await setup(ctx);

      await armSanctions(scr, owner);
      await scr.connect(owner).setScreeningStaleAfter(STALE_WINDOW);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_CLEAR, ethers.ZeroHash);

      // ctx 2 = ESCROW_RELEASE: never-screened `from` is not a checked party.
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 2)).not.to.be.reverted;

      // Flip the legs: never-screened `to` IS checked and fails closed.
      await expect(attached.harnessPrecheck(addr2.address, addr1.address, 100, 2))
        .to.be.revertedWithCustomError(attached, "ComplianceScreeningStale")
        .withArgs(addr1.address);
    });

    it("bearer-note escrow-in (to == 0) skips freshness on the missing leg", async function () {
      const ctx = await loadFixture(fixture);
      const { owner, addr1 } = ctx;
      const { scr, attached } = await setup(ctx);

      await armSanctions(scr, owner);
      await scr.connect(owner).setScreeningStaleAfter(STALE_WINDOW);
      await scr.connect(owner).recordNetworkScreening(addr1.address, SCREENING_CLEAR, ethers.ZeroHash);

      // ctx 1 = ESCROW_IN with no predetermined recipient: only the sender leg
      // is screened, so the zero address does not trip never-screened.
      await expect(attached.harnessPrecheck(addr1.address, ethers.ZeroAddress, 100, 1)).not.to.be.reverted;
    });

    it("freshness never fires when only non-sanctions controls are armed", async function () {
      const ctx = await loadFixture(fixture);
      const { diamond, owner, addr1, addr2 } = ctx;
      const { scr, attached } = await setup(ctx);
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", diamond.target ?? diamond.address);

      // Window configured, nobody screened, sanctions NOT armed.
      await scr.connect(owner).setScreeningStaleAfter(STALE_WINDOW);

      // Travel-rule-only arming: precheckGated stays a no-op entirely.
      const TR = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_enforce_active"));
      await pol.connect(owner).setNetworkPolicy(TR, 1);
      await expect(attached.harnessPrecheckGated(addr1.address, addr2.address, 100, 0)).not.to.be.reverted;

      // KYC-only arming: precheck runs, but the failure is the KYC requirement —
      // never ComplianceScreeningStale, because the sanctions counter is 0.
      const KYC = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));
      await pol.connect(owner).setNetworkPolicy(KYC, 1);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceKycRequired");
    });

    it("boundary: a screening at exactly lastScreenedAt + window is still fresh (strict >)", async function () {
      const ctx = await loadFixture(fixture);
      const { owner, addr1, addr2 } = ctx;
      const { scr, attached } = await setup(ctx);

      await armSanctions(scr, owner);
      const rc = await (await scr.connect(owner).recordNetworkScreening(
        addr2.address, SCREENING_CLEAR, ethers.ZeroHash
      )).wait();
      const last = (await ethers.provider.getBlock(rc.blockNumber)).timestamp;
      await scr.connect(owner).setScreeningStaleAfter(STALE_WINDOW);

      // ctx 2 = ESCROW_RELEASE screens `to` only, so addr1 (never screened)
      // stays out of the way and the boundary is measured on addr2 alone.
      await time.increaseTo(last + STALE_WINDOW);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 2)).not.to.be.reverted;

      await time.increase(1);
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 2))
        .to.be.revertedWithCustomError(attached, "ComplianceScreeningStale")
        .withArgs(addr2.address);
    });

    it("a fresh network CLEAR does not lift a scoped BLOCKED (block checked before freshness)", async function () {
      const ctx = await loadFixture(fixture);
      const { diamond, owner, addr1, addr2 } = ctx;
      const { scr, attached } = await setup(ctx);
      const addr = diamond.target ?? diamond.address;
      const pol = await ethers.getContractAt("InstitutionPolicyFacet", addr);
      const reg = await ethers.getContractAt("InstitutionRegistryFacet", addr);

      const SCREENING_ATTESTOR = ethers.keccak256(ethers.toUtf8Bytes("SCREENING_ATTESTOR_ROLE"));
      const instA = (await (await reg.connect(owner).registerInstitution("CF9InstA", ethers.ZeroHash, "", owner.address)).wait()).logs
        .map(l => { try { return reg.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "InstitutionRegistered").args.id;
      await reg.connect(owner).linkWalletToInstitution(addr1.address, instA);
      await scr.connect(owner).setInstitutionSanctionsEnabled(instA, true);
      await pol.connect(owner).grantScopedRole(SCREENING_ATTESTOR, owner.address, instA);
      await scr.connect(owner).recordScopedScreening(instA, addr2.address, SCREENING_BLOCKED, ethers.ZeroHash);

      // Both parties freshly network-CLEAR under an armed window.
      await scr.connect(owner).recordNetworkScreening(addr1.address, SCREENING_CLEAR, ethers.ZeroHash);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_CLEAR, ethers.ZeroHash);
      await scr.connect(owner).setScreeningStaleAfter(STALE_WINDOW);

      // Freshness never weakens the deny predicate: the scoped block wins.
      await expect(attached.harnessPrecheck(addr1.address, addr2.address, 100, 0))
        .to.be.revertedWithCustomError(attached, "ComplianceSanctioned")
        .withArgs(addr2.address);
    });

    it("WALLET_TRANSFER freshness fires through the real transfer entrypoint", async function () {
      const ctx = await loadFixture(fixture);
      const { diamond, facets, owner, addr1, addr2 } = ctx;
      const { scr, attached } = await setup(ctx);
      const addr = diamond.target ?? diamond.address;
      const dt = await ethers.getContractAt("T3TokenDirectTransferFacet", addr);
      const accessControl = await ethers.getContractAt("AccessControlFacet", addr);
      const mintBurn = await ethers.getContractAt("T3TokenMintBurnFacet", addr);

      await accessControl.connect(owner).grantRole(ROLES.MINTER_ROLE, owner.address);
      await mintBurn.connect(owner).mint(addr1.address, ethers.parseEther("10"));

      await armSanctions(scr, owner);
      await scr.connect(owner).recordNetworkScreening(addr1.address, SCREENING_CLEAR, ethers.ZeroHash);
      await scr.connect(owner).recordNetworkScreening(addr2.address, SCREENING_CLEAR, ethers.ZeroHash);
      await scr.connect(owner).setScreeningStaleAfter(STALE_WINDOW);

      // Fresh screenings: the real transfer passes end-to-end.
      await expect(dt.connect(addr1).transfer(addr2.address, ethers.parseEther("1"))).not.to.be.reverted;

      // Stale screenings: the same transfer fails closed (from leg first).
      await time.increase(STALE_WINDOW + 1);
      await expect(dt.connect(addr1).transfer(addr2.address, ethers.parseEther("1")))
        .to.be.revertedWithCustomError(attached, "ComplianceScreeningStale")
        .withArgs(addr1.address);
    });

    it("RECOVERY_MIGRATE freshness: a never-screened successor fails closed through real migrateBalance", async function () {
      const ctx = await loadFixture(fixture);
      const { diamond, facets, owner, admin, custodian1 } = ctx;
      const { scr, attached } = await setup(ctx);
      const addr = diamond.target ?? diamond.address;
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const accessControl = await ethers.getContractAt("AccessControlFacet", addr);
      const mintBurn = await ethers.getContractAt("T3TokenMintBurnFacet", addr);
      await accessControl.connect(owner).grantRole(ROLES.MINTER_ROLE, owner.address);
      const amount = ethers.parseEther("5");
      await mintBurn.connect(owner).mint(oldWallet.address, amount);

      const rc = await (await facets.walletRecovery.connect(owner).initiateRecovery(oldWallet.address, 0)).wait();
      const recoveryId = rc.logs
        .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "RecoveryInitiated").args.recoveryId;
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // Armed + window: RECOVERY_MIGRATE checks `to` — the never-screened
      // successor blocks the migration until an authority screens it.
      await armSanctions(scr, owner);
      await scr.connect(owner).setScreeningStaleAfter(STALE_WINDOW);
      await expect(facets.walletRecovery.connect(owner).migrateBalance(recoveryId, []))
        .to.be.revertedWithCustomError(attached, "ComplianceScreeningStale")
        .withArgs(newWallet.address);

      await scr.connect(owner).recordNetworkScreening(newWallet.address, SCREENING_CLEAR, ethers.ZeroHash);
      await expect(facets.walletRecovery.connect(owner).migrateBalance(recoveryId, []))
        .to.emit(facets.walletRecovery, "RecoveryBalanceMigrated")
        .withArgs(recoveryId, oldWallet.address, newWallet.address, amount);
    });
  });
});

function uint40(value) {
  return BigInt.asUintN(40, BigInt(value));
}
