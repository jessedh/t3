const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");

describe("Wave 8E remediation — wallet recovery depositor-identity migration", function () {
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

  function makeTinHashes(count) {
    return Array.from({ length: count }, (_, i) =>
      ethers.keccak256(ethers.toUtf8Bytes(`tin-${i}-${ethers.randomBytes(4).toString("hex")}`))
    );
  }

  describe("migrateDepositorIdentityState", function () {
    it("migrates all hashes, epochs, and set membership to the successor", async function () {
      const { diamond, facets, owner, admin, custodian1, custodian2 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const did = await ethers.getContractAt("DepositorIdentityFacet", diamond.target ?? diamond.address);

      // Initialize salt epoch.
      await did.connect(owner).rotateSalt(ethers.keccak256(ethers.toUtf8Bytes("salt-1")), 0);
      const epoch = await did.getCurrentSaltEpoch();
      expect(epoch).to.be.gt(0);

      const hashes = makeTinHashes(5);
      await did.connect(oldWallet).batchSubmitDepositorHashes(hashes);

      // Pre-recovery conflict check baseline: an unrelated bank (custodian2) checking oldWallet.
      const preConflicts = await did.connect(custodian2).batchCheckDepositorConflicts.staticCall(hashes[0], [oldWallet.address]);
      expect(preConflicts[0]).to.equal(true);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      const tx = await facets.walletRecovery.connect(owner).migrateDepositorIdentityState(recoveryId, 100);
      const rec = await tx.wait();
      const migratedEvent = rec.logs
        .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "DepositorIdentityStateMigrated");
      expect(migratedEvent).to.not.be.undefined;
      expect(migratedEvent.args.movedThisCall).to.equal(5n);
      expect(migratedEvent.args.remaining).to.equal(0n);

      // Old registry empty.
      expect(await did.getDepositorHashCount(oldWallet.address)).to.equal(0n);
      // New registry contains all hashes with correct epochs.
      expect(await did.getDepositorHashCount(newWallet.address)).to.equal(5n);
      for (const h of hashes) {
        expect(await did.hasDepositorHash(newWallet.address, h)).to.equal(true);
        expect(await did.hasDepositorHash(oldWallet.address, h)).to.equal(false);
      }

      // Conflict checks against new wallet behave like pre-recovery checks against old wallet.
      const postConflicts = await did.connect(custodian2).batchCheckDepositorConflicts.staticCall(hashes[0], [newWallet.address]);
      expect(postConflicts[0]).to.equal(true);

      // banksWithHashes tracking: new wallet present, old wallet absent.
      const stats = await did.getGlobalStatistics();
      expect(stats.totalHashes).to.equal(5n);
      expect(stats.bankCount).to.equal(1n);
    });

    it("paginates correctly and leaves partial state consistent", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const did = await ethers.getContractAt("DepositorIdentityFacet", diamond.target ?? diamond.address);
      await did.connect(owner).rotateSalt(ethers.keccak256(ethers.toUtf8Bytes("salt-2")), 0);

      const hashes = makeTinHashes(7);
      await did.connect(oldWallet).batchSubmitDepositorHashes(hashes);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      // First batch: move 3.
      await facets.walletRecovery.connect(owner).migrateDepositorIdentityState(recoveryId, 3);
      expect(await did.getDepositorHashCount(oldWallet.address)).to.equal(4n);
      expect(await did.getDepositorHashCount(newWallet.address)).to.equal(3n);

      // Second batch: move 3.
      await facets.walletRecovery.connect(owner).migrateDepositorIdentityState(recoveryId, 3);
      expect(await did.getDepositorHashCount(oldWallet.address)).to.equal(1n);
      expect(await did.getDepositorHashCount(newWallet.address)).to.equal(6n);

      // Final batch: move last 1.
      await facets.walletRecovery.connect(owner).migrateDepositorIdentityState(recoveryId, 3);
      expect(await did.getDepositorHashCount(oldWallet.address)).to.equal(0n);
      expect(await did.getDepositorHashCount(newWallet.address)).to.equal(7n);

      // All hashes migrated.
      for (const h of hashes) {
        expect(await did.hasDepositorHash(newWallet.address, h)).to.equal(true);
        expect(await did.hasDepositorHash(oldWallet.address, h)).to.equal(false);
      }
    });

    it("is idempotent and no-ops when old registry is empty", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const did = await ethers.getContractAt("DepositorIdentityFacet", diamond.target ?? diamond.address);
      await did.connect(owner).rotateSalt(ethers.keccak256(ethers.toUtf8Bytes("salt-3")), 0);

      const hashes = makeTinHashes(4);
      await did.connect(oldWallet).batchSubmitDepositorHashes(hashes);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      await facets.walletRecovery.connect(owner).migrateDepositorIdentityState(recoveryId, 100);
      expect(await did.getDepositorHashCount(oldWallet.address)).to.equal(0n);
      expect(await did.getDepositorHashCount(newWallet.address)).to.equal(4n);

      // Re-call must be a clean no-op and must not double-count.
      const tx = await facets.walletRecovery.connect(owner).migrateDepositorIdentityState(recoveryId, 100);
      const rec = await tx.wait();
      const migratedEvent = rec.logs
        .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "DepositorIdentityStateMigrated");
      expect(migratedEvent.args.movedThisCall).to.equal(0n);
      expect(migratedEvent.args.remaining).to.equal(0n);

      expect(await did.getDepositorHashCount(oldWallet.address)).to.equal(0n);
      expect(await did.getDepositorHashCount(newWallet.address)).to.equal(4n);
      expect((await did.getGlobalStatistics()).totalHashes).to.equal(4n);
    });

    it("handles overlapping hashes without double-counting", async function () {
      const { diamond, facets, owner, admin, custodian1, custodian2 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const did = await ethers.getContractAt("DepositorIdentityFacet", diamond.target ?? diamond.address);
      await did.connect(owner).rotateSalt(ethers.keccak256(ethers.toUtf8Bytes("salt-4")), 0);

      const shared = makeTinHashes(3);
      const oldOnly = makeTinHashes(2);
      await did.connect(oldWallet).batchSubmitDepositorHashes([...shared, ...oldOnly]);
      await did.connect(newWallet).batchSubmitDepositorHashes(shared);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      await facets.walletRecovery.connect(owner).migrateDepositorIdentityState(recoveryId, 100);

      // newWallet should have exactly 5 distinct hashes (3 shared + 2 oldOnly), no double-count.
      expect(await did.getDepositorHashCount(newWallet.address)).to.equal(5n);
      expect(await did.getDepositorHashCount(oldWallet.address)).to.equal(0n);
      expect((await did.getGlobalStatistics()).totalHashes).to.equal(5n);
      for (const h of shared) expect(await did.hasDepositorHash(newWallet.address, h)).to.equal(true);
      for (const h of oldOnly) expect(await did.hasDepositorHash(newWallet.address, h)).to.equal(true);
    });

    it("reverts BatchTooLarge when maxHashes exceeds the bound", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const did = await ethers.getContractAt("DepositorIdentityFacet", diamond.target ?? diamond.address);
      await did.connect(owner).rotateSalt(ethers.keccak256(ethers.toUtf8Bytes("salt-5")), 0);
      await did.connect(oldWallet).batchSubmitDepositorHashes(makeTinHashes(3));

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      await expect(facets.walletRecovery.connect(owner).migrateDepositorIdentityState(recoveryId, 101))
        .to.be.revertedWithCustomError(facets.walletRecovery, "BatchTooLarge");
    });

    it("does not add empty successor to banksWithHashes when source registry is empty", async function () {
      const { diamond, facets, owner, admin, custodian1 } = await loadFixture(fixture);
      const oldWallet = custodian1;
      const newWallet = admin;
      await makeEligibleSuccessor(facets, owner, custodian1, newWallet);

      const did = await ethers.getContractAt("DepositorIdentityFacet", diamond.target ?? diamond.address);

      // Baseline: no bank has registered any hashes.
      const preStats = await did.getGlobalStatistics();
      expect(preStats.totalHashes).to.equal(0n);
      expect(preStats.bankCount).to.equal(0n);

      const recoveryId = await initiateRecovery(facets, owner, oldWallet);
      await facets.walletRecovery.connect(owner).designateSuccessor(recoveryId, newWallet.address);

      const tx = await facets.walletRecovery.connect(owner).migrateDepositorIdentityState(recoveryId, 100);
      const rec = await tx.wait();
      const migratedEvent = rec.logs
        .map(l => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean).find(l => l.name === "DepositorIdentityStateMigrated");
      expect(migratedEvent.args.movedThisCall).to.equal(0n);
      expect(migratedEvent.args.remaining).to.equal(0n);

      expect(await did.getDepositorHashCount(oldWallet.address)).to.equal(0n);
      expect(await did.getDepositorHashCount(newWallet.address)).to.equal(0n);

      const postStats = await did.getGlobalStatistics();
      expect(postStats.totalHashes).to.equal(0n);
      expect(postStats.bankCount).to.equal(0n);
    });
  });
});
