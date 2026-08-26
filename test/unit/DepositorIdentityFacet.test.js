const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

/**
 * DepositorIdentityFacet Unit Tests
 *
 * Tests privacy-preserving depositor identity conflict detection
 * for reciprocal deposit networks (FDIC insurance compliance).
 */
describe("DepositorIdentityFacet Unit Tests", function () {
    let deployment;
    const oneHour = 3600;
    const oneDay = 86400;
    const sevenDays = 7 * oneDay;

    // Helper: compute a TIN hash the same way a bank would off-chain
    function computeTinHash(tin, ownershipCategory, salt) {
        return ethers.solidityPackedKeccak256(
            ["string", "uint8", "string"],
            [tin, ownershipCategory, salt]
        );
    }

    // Helper: compute a salt hash (what goes on-chain)
    function computeSaltHash(salt) {
        return ethers.keccak256(ethers.toUtf8Bytes(salt));
    }

    async function setupDepositorIdentityFixture() {
        deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        return deployment;
    }

    beforeEach(async function () {
        deployment = await loadFixture(setupDepositorIdentityFixture);
    });

    // ═══════════════════════════════════════════════════════════════════════
    // SALT EPOCH MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════

    describe("Salt Epoch Management", function () {
        it("should create the first salt epoch", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;
            const saltHash = computeSaltHash("network-salt-v1");

            await expect(
                di.connect(signers.owner).rotateSalt(saltHash, 0)
            ).to.emit(di, "SaltEpochCreated").withArgs(1, saltHash, await time.latest() + 1, 0);

            expect(await di.getCurrentSaltEpoch()).to.equal(1);

            const [storedSaltHash, activatedAt, expiresAt, isActive] = await di.getSaltEpochInfo(1);
            expect(storedSaltHash).to.equal(saltHash);
            expect(activatedAt).to.be.gt(0);
            expect(expiresAt).to.equal(0); // No expiry for current epoch
            expect(isActive).to.be.true;
        });

        it("should allow admin to create salt epoch", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;
            const saltHash = computeSaltHash("salt-v1");

            await di.connect(signers.admin).rotateSalt(saltHash, 0);
            expect(await di.getCurrentSaltEpoch()).to.equal(1);
        });

        it("should rotate to a new epoch with transition window", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const salt1 = computeSaltHash("salt-v1");
            const salt2 = computeSaltHash("salt-v2");

            // Create epoch 1
            await di.connect(signers.owner).rotateSalt(salt1, 0);
            expect(await di.getCurrentSaltEpoch()).to.equal(1);

            // Rotate to epoch 2 with 7-day transition window
            await di.connect(signers.owner).rotateSalt(salt2, sevenDays);
            expect(await di.getCurrentSaltEpoch()).to.equal(2);

            // Epoch 1 should still be active (within transition window)
            const [, , expiresAt1, isActive1] = await di.getSaltEpochInfo(1);
            expect(isActive1).to.be.true;
            expect(expiresAt1).to.be.gt(0);

            // Epoch 2 should be active with no expiry
            const [, , expiresAt2, isActive2] = await di.getSaltEpochInfo(2);
            expect(isActive2).to.be.true;
            expect(expiresAt2).to.equal(0);
        });

        it("should expire old epoch after transition window passes", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const salt1 = computeSaltHash("salt-v1");
            const salt2 = computeSaltHash("salt-v2");

            await di.connect(signers.owner).rotateSalt(salt1, 0);
            await di.connect(signers.owner).rotateSalt(salt2, oneHour);

            // Epoch 1 active during transition
            const [, , , isActive1Before] = await di.getSaltEpochInfo(1);
            expect(isActive1Before).to.be.true;

            // Advance past transition window
            await time.increase(oneHour + 1);

            // Epoch 1 should now be effectively expired (time-based)
            const [, , , isActive1After] = await di.getSaltEpochInfo(1);
            expect(isActive1After).to.be.false;

            // Epoch 2 remains active
            const [, , , isActive2] = await di.getSaltEpochInfo(2);
            expect(isActive2).to.be.true;
        });

        it("should rotate with zero transition (immediate expire of old)", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const salt1 = computeSaltHash("salt-v1");
            const salt2 = computeSaltHash("salt-v2");

            await di.connect(signers.owner).rotateSalt(salt1, 0);
            await di.connect(signers.owner).rotateSalt(salt2, 0);

            // Epoch 1 should be immediately expired
            const [, , , isActive1] = await di.getSaltEpochInfo(1);
            expect(isActive1).to.be.false;
        });

        it("should force-expire a specific old epoch", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const salt1 = computeSaltHash("salt-v1");
            const salt2 = computeSaltHash("salt-v2");

            await di.connect(signers.owner).rotateSalt(salt1, 0);
            await di.connect(signers.owner).rotateSalt(salt2, sevenDays);

            // Epoch 1 still active in transition
            const [, , , isActive1Before] = await di.getSaltEpochInfo(1);
            expect(isActive1Before).to.be.true;

            // Force-expire epoch 1
            await expect(
                di.connect(signers.owner).expireSaltEpoch(1)
            ).to.emit(di, "SaltEpochExpired");

            const [, , , isActive1After] = await di.getSaltEpochInfo(1);
            expect(isActive1After).to.be.false;
        });

        it("should reject expiring the current active epoch", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await di.connect(signers.owner).rotateSalt(computeSaltHash("salt-v1"), 0);

            await expect(
                di.connect(signers.owner).expireSaltEpoch(1)
            ).to.be.revertedWithCustomError(di, "SaltEpochNotFound");
        });

        it("should reject expiring an already expired epoch", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await di.connect(signers.owner).rotateSalt(computeSaltHash("salt-v1"), 0);
            await di.connect(signers.owner).rotateSalt(computeSaltHash("salt-v2"), sevenDays);

            // Force-expire epoch 1
            await di.connect(signers.owner).expireSaltEpoch(1);

            // Try to expire again
            await expect(
                di.connect(signers.owner).expireSaltEpoch(1)
            ).to.be.revertedWithCustomError(di, "SaltEpochAlreadyExpired");
        });

        it("should reject invalid epoch ID for expiry", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await di.connect(signers.owner).rotateSalt(computeSaltHash("salt-v1"), 0);

            await expect(
                di.connect(signers.owner).expireSaltEpoch(0)
            ).to.be.revertedWithCustomError(di, "SaltEpochNotFound");

            await expect(
                di.connect(signers.owner).expireSaltEpoch(99)
            ).to.be.revertedWithCustomError(di, "SaltEpochNotFound");
        });

        it("should reject salt rotation from non-admin", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.user1).rotateSalt(computeSaltHash("salt"), 0)
            ).to.be.revertedWithCustomError(di, "UnauthorizedRole");
        });

        it("should reject zero salt hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.owner).rotateSalt(ethers.ZeroHash, 0)
            ).to.be.revertedWithCustomError(di, "InvalidSaltHash");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // EMERGENCY SALT COMPROMISE
    // ═══════════════════════════════════════════════════════════════════════

    describe("Emergency Salt Compromise", function () {
        it("should immediately expire all old epochs", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            // Create three epochs with active transitions
            await di.connect(signers.owner).rotateSalt(computeSaltHash("salt-v1"), 0);
            await di.connect(signers.owner).rotateSalt(computeSaltHash("salt-v2"), sevenDays);
            await di.connect(signers.owner).rotateSalt(computeSaltHash("salt-v3"), sevenDays);

            // Epochs 1 (expired by rotate), 2 (in transition), 3 (current) exist
            const emergencySalt = computeSaltHash("emergency-salt");
            await expect(
                di.connect(signers.owner).emergencySaltCompromise(emergencySalt)
            ).to.emit(di, "EmergencySaltCompromise");

            // All old epochs should be expired
            const [, , , isActive1] = await di.getSaltEpochInfo(1);
            const [, , , isActive2] = await di.getSaltEpochInfo(2);
            const [, , , isActive3] = await di.getSaltEpochInfo(3);
            expect(isActive1).to.be.false;
            expect(isActive2).to.be.false;
            expect(isActive3).to.be.false;

            // New epoch 4 should be active
            expect(await di.getCurrentSaltEpoch()).to.equal(4);
            const [, , , isActive4] = await di.getSaltEpochInfo(4);
            expect(isActive4).to.be.true;
        });

        it("should reject emergency from non-admin", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.user1).emergencySaltCompromise(computeSaltHash("emergency"))
            ).to.be.revertedWithCustomError(di, "UnauthorizedRole");
        });

        it("should reject emergency with zero salt hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.owner).emergencySaltCompromise(ethers.ZeroHash)
            ).to.be.revertedWithCustomError(di, "InvalidSaltHash");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // SINGLE HASH SUBMIT / REMOVE
    // ═══════════════════════════════════════════════════════════════════════

    describe("Single Hash Submit", function () {
        const salt = "network-salt-v1";
        let saltHash;

        beforeEach(async function () {
            const { facets, signers } = deployment;
            saltHash = computeSaltHash(salt);
            await facets.depositorIdentity.connect(signers.owner).rotateSalt(saltHash, 0);
        });

        it("should submit a depositor hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;
            const tinHash = computeTinHash("123-45-6789", 0, salt);

            await expect(
                di.connect(signers.custodian1).submitDepositorHash(tinHash)
            ).to.emit(di, "DepositorHashSubmitted")
                .withArgs(signers.custodian1.address, tinHash, await time.latest() + 1);

            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(1);
            expect(await di.hasDepositorHash(signers.custodian1.address, tinHash)).to.be.true;
        });

        it("should reject duplicate hash submission", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;
            const tinHash = computeTinHash("123-45-6789", 0, salt);

            await di.connect(signers.custodian1).submitDepositorHash(tinHash);

            await expect(
                di.connect(signers.custodian1).submitDepositorHash(tinHash)
            ).to.be.revertedWithCustomError(di, "DepositorHashAlreadyExists");
        });

        it("should reject zero hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.custodian1).submitDepositorHash(ethers.ZeroHash)
            ).to.be.revertedWithCustomError(di, "InvalidTinHash");
        });

        it("should reject submission from non-custodian", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;
            const tinHash = computeTinHash("123-45-6789", 0, salt);

            await expect(
                di.connect(signers.user1).submitDepositorHash(tinHash)
            ).to.be.revertedWithCustomError(di, "BankNotCustodian");
        });

        it("should reject submission before salt epoch is initialized", async function () {
            // Use a fresh deployment without rotateSalt
            const fresh = await deployT3DiamondFixture();
            await setupTestRoles(fresh.facets, fresh.signers);
            const di = fresh.facets.depositorIdentity;
            const tinHash = computeTinHash("123-45-6789", 0, "any-salt");

            await expect(
                di.connect(fresh.signers.custodian1).submitDepositorHash(tinHash)
            ).to.be.revertedWithCustomError(di, "NoActiveSaltEpoch");
        });

        it("should allow different banks to submit the same hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;
            const tinHash = computeTinHash("123-45-6789", 0, salt);

            await di.connect(signers.custodian1).submitDepositorHash(tinHash);
            await di.connect(signers.custodian2).submitDepositorHash(tinHash);

            expect(await di.hasDepositorHash(signers.custodian1.address, tinHash)).to.be.true;
            expect(await di.hasDepositorHash(signers.custodian2.address, tinHash)).to.be.true;
        });
    });

    describe("Single Hash Remove", function () {
        const salt = "network-salt-v1";
        let tinHash;

        beforeEach(async function () {
            const { facets, signers } = deployment;
            await facets.depositorIdentity.connect(signers.owner).rotateSalt(computeSaltHash(salt), 0);
            tinHash = computeTinHash("123-45-6789", 0, salt);
            await facets.depositorIdentity.connect(signers.custodian1).submitDepositorHash(tinHash);
        });

        it("should remove a depositor hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.custodian1).removeDepositorHash(tinHash)
            ).to.emit(di, "DepositorHashRemoved")
                .withArgs(signers.custodian1.address, tinHash, await time.latest() + 1);

            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(0);
            expect(await di.hasDepositorHash(signers.custodian1.address, tinHash)).to.be.false;
        });

        it("should reject removing a non-existent hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;
            const otherHash = computeTinHash("999-99-9999", 0, salt);

            await expect(
                di.connect(signers.custodian1).removeDepositorHash(otherHash)
            ).to.be.revertedWithCustomError(di, "DepositorHashNotFound");
        });

        it("should reject removing zero hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.custodian1).removeDepositorHash(ethers.ZeroHash)
            ).to.be.revertedWithCustomError(di, "InvalidTinHash");
        });

        it("should reject removal from non-custodian", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.user1).removeDepositorHash(tinHash)
            ).to.be.revertedWithCustomError(di, "BankNotCustodian");
        });

        it("should not allow one bank to remove another bank's hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            // custodian2 doesn't have this hash
            await expect(
                di.connect(signers.custodian2).removeDepositorHash(tinHash)
            ).to.be.revertedWithCustomError(di, "DepositorHashNotFound");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // BATCH OPERATIONS
    // ═══════════════════════════════════════════════════════════════════════

    describe("Batch Submit", function () {
        const salt = "network-salt-v1";

        beforeEach(async function () {
            const { facets, signers } = deployment;
            await facets.depositorIdentity.connect(signers.owner).rotateSalt(computeSaltHash(salt), 0);
        });

        it("should batch submit multiple hashes", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const hashes = [
                computeTinHash("111-11-1111", 0, salt),
                computeTinHash("222-22-2222", 0, salt),
                computeTinHash("333-33-3333", 0, salt),
            ];

            await expect(
                di.connect(signers.custodian1).batchSubmitDepositorHashes(hashes)
            ).to.emit(di, "DepositorHashBatchSubmitted")
                .withArgs(signers.custodian1.address, 3, await time.latest() + 1);

            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(3);
        });

        it("should skip duplicates silently in batch", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const hash1 = computeTinHash("111-11-1111", 0, salt);
            const hash2 = computeTinHash("222-22-2222", 0, salt);

            // Submit hash1 individually first
            await di.connect(signers.custodian1).submitDepositorHash(hash1);

            // Batch includes hash1 (dup) and hash2 (new) — should add only hash2
            await di.connect(signers.custodian1).batchSubmitDepositorHashes([hash1, hash2]);
            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(2);
        });

        it("should skip zero hashes silently in batch", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const hash1 = computeTinHash("111-11-1111", 0, salt);
            const hashes = [ethers.ZeroHash, hash1, ethers.ZeroHash];

            await di.connect(signers.custodian1).batchSubmitDepositorHashes(hashes);
            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(1);
        });

        it("should reject batch exceeding max size", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            // Create 101 hashes
            const hashes = [];
            for (let i = 0; i < 101; i++) {
                hashes.push(computeTinHash(`${i}-00-0000`, 0, salt));
            }

            await expect(
                di.connect(signers.custodian1).batchSubmitDepositorHashes(hashes)
            ).to.be.revertedWithCustomError(di, "BatchSizeTooLarge");
        });

        it("should handle empty batch gracefully", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            // Empty array should not revert
            await di.connect(signers.custodian1).batchSubmitDepositorHashes([]);
            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(0);
        });

        it("should handle max batch size (100)", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const hashes = [];
            for (let i = 0; i < 100; i++) {
                hashes.push(computeTinHash(`${i}-00-0000`, 0, salt));
            }

            await di.connect(signers.custodian1).batchSubmitDepositorHashes(hashes);
            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(100);
        });
    });

    describe("Batch Remove", function () {
        const salt = "network-salt-v1";
        let hashes;

        beforeEach(async function () {
            const { facets, signers } = deployment;
            await facets.depositorIdentity.connect(signers.owner).rotateSalt(computeSaltHash(salt), 0);

            hashes = [
                computeTinHash("111-11-1111", 0, salt),
                computeTinHash("222-22-2222", 0, salt),
                computeTinHash("333-33-3333", 0, salt),
            ];
            await facets.depositorIdentity.connect(signers.custodian1).batchSubmitDepositorHashes(hashes);
        });

        it("should batch remove multiple hashes", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.custodian1).batchRemoveDepositorHashes(hashes)
            ).to.emit(di, "DepositorHashBatchRemoved")
                .withArgs(signers.custodian1.address, 3, await time.latest() + 1);

            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(0);
        });

        it("should skip non-existent hashes silently in batch remove", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const nonExistent = computeTinHash("999-99-9999", 0, salt);
            await di.connect(signers.custodian1).batchRemoveDepositorHashes([hashes[0], nonExistent]);

            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(2);
        });

        it("should skip zero hashes in batch remove", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await di.connect(signers.custodian1).batchRemoveDepositorHashes([ethers.ZeroHash, hashes[0]]);
            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(2);
        });

        it("should reject batch remove exceeding max size", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const bigBatch = [];
            for (let i = 0; i < 101; i++) {
                bigBatch.push(computeTinHash(`${i}-00-0000`, 0, salt));
            }

            await expect(
                di.connect(signers.custodian1).batchRemoveDepositorHashes(bigBatch)
            ).to.be.revertedWithCustomError(di, "BatchSizeTooLarge");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // CONFLICT DETECTION
    // ═══════════════════════════════════════════════════════════════════════

    describe("Conflict Detection", function () {
        const salt = "network-salt-v1";
        let tinHash;

        beforeEach(async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await di.connect(signers.owner).rotateSalt(computeSaltHash(salt), 0);
            tinHash = computeTinHash("123-45-6789", 0, salt);

            // custodian1 (Bank A) has this depositor
            await di.connect(signers.custodian1).submitDepositorHash(tinHash);
        });

        it("should detect conflict at a bank that has the hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const conflict = await di.connect(signers.custodian1).checkDepositorConflict(tinHash, signers.custodian1.address);
            expect(conflict).to.be.true;
        });

        it("should return false for a bank without the hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const conflict = await di.connect(signers.custodian2).checkDepositorConflict(tinHash, signers.custodian2.address);
            expect(conflict).to.be.false;
        });

        it("should return false for zero hash", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const conflict = await di.connect(signers.custodian1).checkDepositorConflict(ethers.ZeroHash, signers.custodian1.address);
            expect(conflict).to.be.false;
        });

        it("should reject single conflict check from non-custodian", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.user1).checkDepositorConflict(tinHash, signers.custodian1.address)
            )
                .to.be.revertedWithCustomError(di, "BankNotCustodian")
                .withArgs(signers.user1.address);
        });

        it("should batch check conflicts across multiple banks", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            // custodian2 also has this depositor
            await di.connect(signers.custodian2).submitDepositorHash(tinHash);

            const banks = [signers.custodian1.address, signers.custodian2.address, signers.user1.address];

            const tx = await di.connect(signers.custodian1).batchCheckDepositorConflicts(tinHash, banks);
            const receipt = await tx.wait();

            // Verify events emitted for conflicts
            const conflictEvents = receipt.logs.filter(
                log => {
                    try {
                        const parsed = di.interface.parseLog(log);
                        return parsed && parsed.name === "ConflictDetected";
                    } catch {
                        return false;
                    }
                }
            );
            expect(conflictEvents.length).to.equal(2); // custodian1 and custodian2
        });

        it("should return no conflicts for zero hash in batch", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const banks = [signers.custodian1.address];
            // batchCheckDepositorConflicts is state-changing, call it as tx
            const tx = await di.connect(signers.custodian1).batchCheckDepositorConflicts(ethers.ZeroHash, banks);
            const receipt = await tx.wait();

            const conflictEvents = receipt.logs.filter(
                log => {
                    try {
                        const parsed = di.interface.parseLog(log);
                        return parsed && parsed.name === "ConflictDetected";
                    } catch {
                        return false;
                    }
                }
            );
            expect(conflictEvents.length).to.equal(0);
        });

        it("behaves correctly with the nonReentrant guard: returns conflict array and increments totalChecks", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            // custodian2 also has this depositor
            await di.connect(signers.custodian2).submitDepositorHash(tinHash);

            const banks = [
                signers.custodian1.address,
                signers.custodian2.address,
                signers.user1.address,
            ];

            const checksBefore = (await di.getGlobalStatistics())[1];

            const conflicts = await di
                .connect(signers.custodian1)
                .batchCheckDepositorConflicts.staticCall(tinHash, banks);
            expect(conflicts).to.deep.equal([true, true, false]);

            await expect(di.connect(signers.custodian1).batchCheckDepositorConflicts(tinHash, banks))
                .to.emit(di, "ConflictDetected");

            const checksAfter = (await di.getGlobalStatistics())[1];
            expect(checksAfter - checksBefore).to.equal(2);
        });

        it("should reject batch conflict check from non-custodian", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.user1).batchCheckDepositorConflicts(tinHash, [signers.custodian1.address])
            )
                .to.be.revertedWithCustomError(di, "BankNotCustodian")
                .withArgs(signers.user1.address);
        });

        it("should allow a custodian to batch check conflicts and emit ConflictDetected", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await expect(
                di.connect(signers.custodian1).batchCheckDepositorConflicts(tinHash, [signers.custodian1.address])
            )
                .to.emit(di, "ConflictDetected")
                .withArgs(signers.custodian1.address, signers.custodian1.address, tinHash);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // CROSS-EPOCH CONFLICT DETECTION
    // ═══════════════════════════════════════════════════════════════════════

    describe("Cross-Epoch Conflict Detection", function () {
        it("should detect hash submitted under old epoch during transition window", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const salt1 = "salt-v1";
            await di.connect(signers.owner).rotateSalt(computeSaltHash(salt1), 0);

            // Submit hash under epoch 1
            const tinHash = computeTinHash("123-45-6789", 0, salt1);
            await di.connect(signers.custodian1).submitDepositorHash(tinHash);

            // Rotate to epoch 2 with transition window
            await di.connect(signers.owner).rotateSalt(computeSaltHash("salt-v2"), sevenDays);

            // Hash from epoch 1 should still be detectable during transition
            const conflict = await di.connect(signers.custodian1).checkDepositorConflict(tinHash, signers.custodian1.address);
            expect(conflict).to.be.true;
        });

        it("should NOT detect hash from expired epoch", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const salt1 = "salt-v1";
            await di.connect(signers.owner).rotateSalt(computeSaltHash(salt1), 0);

            // Submit hash under epoch 1
            const tinHash = computeTinHash("123-45-6789", 0, salt1);
            await di.connect(signers.custodian1).submitDepositorHash(tinHash);

            // Rotate with short transition
            await di.connect(signers.owner).rotateSalt(computeSaltHash("salt-v2"), oneHour);

            // Advance past transition window
            await time.increase(oneHour + 1);

            // Hash from epoch 1 should no longer be detected
            const conflict = await di.connect(signers.custodian1).checkDepositorConflict(tinHash, signers.custodian1.address);
            expect(conflict).to.be.false;

            // hasDepositorHash should also return false
            expect(await di.hasDepositorHash(signers.custodian1.address, tinHash)).to.be.false;
        });

        it("should detect hash re-submitted under new epoch after old expires", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const salt1 = "salt-v1";
            const salt2 = "salt-v2";

            await di.connect(signers.owner).rotateSalt(computeSaltHash(salt1), 0);

            // Submit under epoch 1
            const tinHashV1 = computeTinHash("123-45-6789", 0, salt1);
            await di.connect(signers.custodian1).submitDepositorHash(tinHashV1);

            // Rotate and expire immediately
            await di.connect(signers.owner).rotateSalt(computeSaltHash(salt2), 0);

            // Old hash no longer detectable
            expect(await di.connect(signers.custodian1).checkDepositorConflict(tinHashV1, signers.custodian1.address)).to.be.false;

            // Re-submit with new salt (different hash)
            const tinHashV2 = computeTinHash("123-45-6789", 0, salt2);
            await di.connect(signers.custodian1).submitDepositorHash(tinHashV2);

            // New hash IS detectable
            expect(await di.connect(signers.custodian1).checkDepositorConflict(tinHashV2, signers.custodian1.address)).to.be.true;
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // OWNERSHIP CATEGORY SEPARATION
    // ═══════════════════════════════════════════════════════════════════════

    describe("Ownership Category Separation", function () {
        const salt = "network-salt-v1";

        beforeEach(async function () {
            const { facets, signers } = deployment;
            await facets.depositorIdentity.connect(signers.owner).rotateSalt(computeSaltHash(salt), 0);
        });

        it("should produce different hashes for same TIN with different categories", async function () {
            const tin = "123-45-6789";
            const singleHash = computeTinHash(tin, 0, salt);  // Single
            const jointHash = computeTinHash(tin, 1, salt);   // Joint
            const retirementHash = computeTinHash(tin, 4, salt); // Retirement

            expect(singleHash).to.not.equal(jointHash);
            expect(singleHash).to.not.equal(retirementHash);
            expect(jointHash).to.not.equal(retirementHash);
        });

        it("should allow same TIN across different categories at same bank", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;
            const tin = "123-45-6789";

            const singleHash = computeTinHash(tin, 0, salt);
            const jointHash = computeTinHash(tin, 1, salt);

            await di.connect(signers.custodian1).submitDepositorHash(singleHash);
            await di.connect(signers.custodian1).submitDepositorHash(jointHash);

            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(2);
            expect(await di.hasDepositorHash(signers.custodian1.address, singleHash)).to.be.true;
            expect(await di.hasDepositorHash(signers.custodian1.address, jointHash)).to.be.true;
        });

        it("should only flag conflict for matching TIN + category", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;
            const tin = "123-45-6789";

            // Bank A has Single for this TIN
            const singleHash = computeTinHash(tin, 0, salt);
            await di.connect(signers.custodian1).submitDepositorHash(singleHash);

            // Checking Joint category at Bank A — should NOT conflict
            const jointHash = computeTinHash(tin, 1, salt);
            expect(await di.connect(signers.custodian1).checkDepositorConflict(jointHash, signers.custodian1.address)).to.be.false;

            // Checking Single category at Bank A — SHOULD conflict
            expect(await di.connect(signers.custodian1).checkDepositorConflict(singleHash, signers.custodian1.address)).to.be.true;
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // GLOBAL STATISTICS
    // ═══════════════════════════════════════════════════════════════════════

    describe("Global Statistics", function () {
        const salt = "network-salt-v1";

        beforeEach(async function () {
            const { facets, signers } = deployment;
            await facets.depositorIdentity.connect(signers.owner).rotateSalt(computeSaltHash(salt), 0);
        });

        it("should track total hashes and bank count", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            // Two banks each submit hashes
            const hash1 = computeTinHash("111-11-1111", 0, salt);
            const hash2 = computeTinHash("222-22-2222", 0, salt);
            const hash3 = computeTinHash("333-33-3333", 0, salt);

            await di.connect(signers.custodian1).submitDepositorHash(hash1);
            await di.connect(signers.custodian1).submitDepositorHash(hash2);
            await di.connect(signers.custodian2).submitDepositorHash(hash3);

            const [totalHashes, totalChecks, bankCount] = await di.getGlobalStatistics();
            expect(totalHashes).to.equal(3);
            expect(totalChecks).to.equal(0);
            expect(bankCount).to.equal(2);
        });

        it("should decrement total hashes on removal", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const hash1 = computeTinHash("111-11-1111", 0, salt);
            await di.connect(signers.custodian1).submitDepositorHash(hash1);

            let [totalHashes] = await di.getGlobalStatistics();
            expect(totalHashes).to.equal(1);

            await di.connect(signers.custodian1).removeDepositorHash(hash1);

            [totalHashes] = await di.getGlobalStatistics();
            expect(totalHashes).to.equal(0);
        });

        it("should track conflict checks in batch", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const hash1 = computeTinHash("111-11-1111", 0, salt);
            await di.connect(signers.custodian1).submitDepositorHash(hash1);
            await di.connect(signers.custodian2).submitDepositorHash(hash1);

            // Batch check (state-changing version)
            await di.connect(signers.custodian1).batchCheckDepositorConflicts(
                hash1,
                [signers.custodian1.address, signers.custodian2.address]
            );

            const [, totalChecks] = await di.getGlobalStatistics();
            expect(totalChecks).to.equal(2);
        });

        it("should track per-bank hash count and lastUpdated", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const hash1 = computeTinHash("111-11-1111", 0, salt);
            await di.connect(signers.custodian1).submitDepositorHash(hash1);

            expect(await di.getDepositorHashCount(signers.custodian1.address)).to.equal(1);

            const lastUpdated = await di.getLastUpdateTimestamp(signers.custodian1.address);
            expect(lastUpdated).to.be.gt(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // BANK MIGRATION STATUS
    // ═══════════════════════════════════════════════════════════════════════

    describe("Bank Migration Status", function () {
        it("should report correct migration status across epochs", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            const salt1 = "salt-v1";
            const salt2 = "salt-v2";

            // Epoch 1
            await di.connect(signers.owner).rotateSalt(computeSaltHash(salt1), 0);

            // Submit 3 hashes under epoch 1
            const h1 = computeTinHash("111-11-1111", 0, salt1);
            const h2 = computeTinHash("222-22-2222", 0, salt1);
            const h3 = computeTinHash("333-33-3333", 0, salt1);
            await di.connect(signers.custodian1).batchSubmitDepositorHashes([h1, h2, h3]);

            // Check migration: all on current epoch
            let [currentCount, oldCount] = await di.getBankMigrationStatus(signers.custodian1.address);
            expect(currentCount).to.equal(3);
            expect(oldCount).to.equal(0);

            // Rotate to epoch 2 with long transition
            await di.connect(signers.owner).rotateSalt(computeSaltHash(salt2), sevenDays);

            // Now all 3 hashes are on "old" epoch
            [currentCount, oldCount] = await di.getBankMigrationStatus(signers.custodian1.address);
            expect(currentCount).to.equal(0);
            expect(oldCount).to.equal(3);

            // Re-submit 1 hash under new epoch
            const h1v2 = computeTinHash("111-11-1111", 0, salt2);
            await di.connect(signers.custodian1).submitDepositorHash(h1v2);

            [currentCount, oldCount] = await di.getBankMigrationStatus(signers.custodian1.address);
            expect(currentCount).to.equal(1);
            expect(oldCount).to.equal(3); // Old hashes still exist in set
        });

        it("should return zero for bank with no hashes", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            await di.connect(signers.owner).rotateSalt(computeSaltHash("salt"), 0);

            const [currentCount, oldCount, lastUpdated] = await di.getBankMigrationStatus(signers.user1.address);
            expect(currentCount).to.equal(0);
            expect(oldCount).to.equal(0);
            expect(lastUpdated).to.equal(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    describe("View Functions", function () {
        it("should return epoch 0 before initialization", async function () {
            const { facets } = deployment;
            expect(await facets.depositorIdentity.getCurrentSaltEpoch()).to.equal(0);
        });

        it("should return zero counts for unregistered bank", async function () {
            const { facets, signers } = deployment;
            const di = facets.depositorIdentity;

            expect(await di.getDepositorHashCount(signers.user1.address)).to.equal(0);
            expect(await di.getLastUpdateTimestamp(signers.user1.address)).to.equal(0);
        });

        it("should return correct getSaltEpochInfo for non-existent epoch", async function () {
            const { facets } = deployment;
            const di = facets.depositorIdentity;

            const [saltHash, activatedAt, expiresAt, isActive] = await di.getSaltEpochInfo(99);
            expect(saltHash).to.equal(ethers.ZeroHash);
            expect(activatedAt).to.equal(0);
            expect(expiresAt).to.equal(0);
            expect(isActive).to.be.false;
        });
    });
});
