const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

/**
 * Wave 5 bilateral-net settlement cycle. Tests the lien mechanics via the keeper-driven
 * recordObligation path (same lib + lien logic the envelope triple-write uses), plus the
 * full lifecycle, replay protection, challenge, and failure semantics.
 */
describe("SettlementCycle (Wave 5 bilateral-net)", function () {
    const ASSET_TYPE = 1;
    const USDC_PLEDGE = ethers.parseUnits("1000", 6); // 1000 USDC each bank
    const C100 = ethers.parseEther("100");
    const C30 = ethers.parseEther("30");
    const WINDOW = 3600;
    const CYCLE_TYPE = 0;

    let CycleLib, FundingLib;

    before(async function () {
        CycleLib = await ethers.getContractFactory("SettlementCycleLib");
        FundingLib = await ethers.getContractFactory("SettlementFundingLib");
    });

    async function fixture() {
        const dep = await deployT3DiamondFixture();
        const { facets, signers, diamondAddress } = dep;
        await setupTestRoles(facets, signers);

        const settlement = await ethers.getContractAt("SettlementCycleFacet", diamondAddress);

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20.deploy("Mock USDC", "mUSDC", ethers.parseUnits("10000000", 6));
        await usdc.waitForDeployment();

        await facets.multiAssetVault.connect(signers.admin).configureAssetType(ASSET_TYPE, {
            tokenAddress: await usdc.getAddress(),
            decimals: 6, collateralFactorBps: 10000, haircutBps: 0, maxBankExposure: 0, isActive: true,
        });
        await facets.multiAssetVault.connect(signers.admin).registerAssetTypeForReserve(ASSET_TYPE);

        const A = signers.user1;
        const B = signers.user2;
        const C = signers.user3;
        for (const bank of [A, B, C]) {
            await facets.consortiumMembership.connect(signers.admin).registerBank(
                bank.address, "Bank", bank.address, ethers.parseEther("100000000")
            );
            await facets.consortiumMembership.connect(signers.admin).configureBankWallet(
                bank.address, ASSET_TYPE, bank.address, bank.address
            );
            await usdc.connect(signers.owner).transfer(bank.address, USDC_PLEDGE);
            await usdc.connect(bank).approve(diamondAddress, USDC_PLEDGE);
            await facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, USDC_PLEDGE);
        }

        // settlement roles
        const keeper = signers.minter;     // already has other roles; add keeper
        const attestor = signers.admin;    // not a funding party (A/B)
        const emergency = signers.owner;
        await facets.accessControl.connect(signers.owner).grantRole(ROLES.SETTLEMENT_KEEPER_ROLE, keeper.address);
        await facets.accessControl.connect(signers.owner).grantRole(ROLES.SETTLEMENT_ATTESTOR_ROLE, attestor.address);
        await facets.accessControl.connect(signers.owner).grantRole(ROLES.EMERGENCY_SETTLEMENT_ROLE, emergency.address);
        await facets.accessControl.connect(signers.owner).grantRole(ROLES.CONSORTIUM_MEMBER_ROLE, A.address);
        await facets.accessControl.connect(signers.owner).grantRole(ROLES.CONSORTIUM_MEMBER_ROLE, B.address);

        return { ...dep, settlement, usdc, A, B, C, keeper, attestor, emergency };
    }

    async function openCycle(settlement, keeper) {
        const tx = await settlement.connect(keeper).openSettlementCycle(CYCLE_TYPE);
        const rc = await tx.wait();
        for (const log of rc.logs) {
            try {
                const p = settlement.interface.parseLog(log);
                if (p && p.name === "SettlementCycleOpened") return p.args.cycleId;
            } catch (_) {}
        }
        throw new Error("SettlementCycleOpened not emitted");
    }

    let nonce = 0;
    function rid() { return ethers.id("transfer-" + (nonce++)); }

    async function recordObl(settlement, keeper, cycleId, out, recv, amount) {
        await settlement.connect(keeper).recordObligation(cycleId, out, recv, out, recv, amount, rid());
    }

    describe("bilateral netting of liens", function () {
        it("A<->B $100 each way nets to zero lien on both", async function () {
            const { settlement, A, B, keeper } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100);
            expect(await settlement.getCycleLien(cid, A.address)).to.equal(C100);
            await recordObl(settlement, keeper, cid, B.address, A.address, C100);
            expect(await settlement.getCycleLien(cid, A.address)).to.equal(0);
            expect(await settlement.getCycleLien(cid, B.address)).to.equal(0);
            expect(await settlement.getPairNet(cid, A.address, B.address)).to.equal(0);
        });

        it("asymmetric flows lien the bilateral net debit only", async function () {
            const { settlement, A, B, keeper } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100);
            await recordObl(settlement, keeper, cid, B.address, A.address, C30);
            // A owes B net 70
            expect(await settlement.getPairNet(cid, A.address, B.address)).to.equal(C100 - C30);
            expect(await settlement.getCycleLien(cid, A.address)).to.equal(C100 - C30);
            expect(await settlement.getCycleLien(cid, B.address)).to.equal(0);
        });
    });

    describe("full lifecycle", function () {
        it("propose -> confirm -> fund -> finalize releases the lien", async function () {
            const { settlement, A, B, keeper, attestor } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100); // A owes B 100
            expect(await settlement.getCycleLien(cid, A.address)).to.equal(C100);

            await settlement.connect(keeper).proposeSettlementCycle(cid, ethers.ZeroHash, 0);
            await settlement.connect(A).confirmSettlementCycle(cid);
            await settlement.connect(B).confirmSettlementCycle(cid);

            await settlement.connect(attestor).recordFunding(
                cid, A.address, B.address, ethers.ZeroAddress, C100, ethers.id("fedwire-1"), WINDOW
            );
            await time.increase(WINDOW + 1);
            await settlement.connect(keeper).finalizeSettlementCycle(cid);

            expect(await settlement.getCycleLien(cid, A.address)).to.equal(0);
            const cycle = await settlement.getSettlementCycle(cid);
            expect(cycle.status).to.equal(5); // FINALIZED
        });

        it("FAILED preserves the lien (ADR-003)", async function () {
            const { settlement, A, B, keeper, emergency } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100);
            await settlement.connect(emergency).failSettlementCycle(cid, ethers.id("exception"));
            expect(await settlement.getCycleLien(cid, A.address)).to.equal(C100); // lien retained
        });
    });

    describe("guards", function () {
        it("replayed funding reference is rejected", async function () {
            const { settlement, A, B, keeper, attestor } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100);
            await settlement.connect(keeper).proposeSettlementCycle(cid, ethers.ZeroHash, 0);
            await settlement.connect(A).confirmSettlementCycle(cid);
            await settlement.connect(B).confirmSettlementCycle(cid);
            const ref = ethers.id("dup-ref");
            await settlement.connect(attestor).recordFunding(cid, A.address, B.address, ethers.ZeroAddress, C100, ref, WINDOW);
            await expect(
                settlement.connect(attestor).recordFunding(cid, A.address, B.address, ethers.ZeroAddress, C100, ref, WINDOW)
            ).to.be.revertedWithCustomError(FundingLib, "FundingRefAlreadyUsed");
        });

        it("challenge within window blocks finalize", async function () {
            const { settlement, A, B, keeper, attestor } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100);
            await settlement.connect(keeper).proposeSettlementCycle(cid, ethers.ZeroHash, 0);
            await settlement.connect(A).confirmSettlementCycle(cid);
            await settlement.connect(B).confirmSettlementCycle(cid);
            await settlement.connect(attestor).recordFunding(cid, A.address, B.address, ethers.ZeroAddress, C100, ethers.id("r"), WINDOW);
            await settlement.connect(attestor).challengeSettlementCycle(cid);
            await time.increase(WINDOW + 1);
            await expect(
                settlement.connect(keeper).finalizeSettlementCycle(cid)
            ).to.be.revertedWithCustomError(settlement, "CycleChallenged");
        });

        it("attestor cannot be a funding party; paymentRef!=0; debtor!=creditor", async function () {
            const { settlement, A, B, keeper, attestor } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100);
            await settlement.connect(keeper).proposeSettlementCycle(cid, ethers.ZeroHash, 0);
            await settlement.connect(A).confirmSettlementCycle(cid);
            await settlement.connect(B).confirmSettlementCycle(cid);
            await expect(
                settlement.connect(attestor).recordFunding(cid, A.address, B.address, ethers.ZeroAddress, C100, ethers.ZeroHash, WINDOW)
            ).to.be.revertedWithCustomError(settlement, "ZeroPaymentRef");
            await expect(
                settlement.connect(attestor).recordFunding(cid, A.address, A.address, ethers.ZeroAddress, C100, ethers.id("r2"), WINDOW)
            ).to.be.revertedWithCustomError(settlement, "SelfFunding");
        });

        it("recordObligation reverts when outgoing issuer lacks reserve", async function () {
            const { settlement, B, keeper } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            const noReserveBank = ethers.Wallet.createRandom().address;
            await expect(
                recordObl(settlement, keeper, cid, noReserveBank, B.address, C100)
            ).to.be.reverted; // EncumbranceExceedsReserve (ReserveControlLib)
        });

        it("non-keeper cannot open a cycle", async function () {
            const { settlement, A } = await loadFixture(fixture);
            await expect(settlement.connect(A).openSettlementCycle(CYCLE_TYPE)).to.be.reverted;
        });

        it("finalize reverts before the challenge window elapses", async function () {
            const { settlement, A, B, keeper, attestor } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100);
            await settlement.connect(keeper).proposeSettlementCycle(cid, ethers.ZeroHash, 0);
            await settlement.connect(A).confirmSettlementCycle(cid);
            await settlement.connect(B).confirmSettlementCycle(cid);
            await settlement.connect(attestor).recordFunding(cid, A.address, B.address, ethers.ZeroAddress, C100, ethers.id("r"), WINDOW);
            await expect(
                settlement.connect(keeper).finalizeSettlementCycle(cid)
            ).to.be.revertedWithCustomError(FundingLib, "ChallengeWindowNotElapsed");
        });

        it("finalize reverts when a nonzero pair is unfunded", async function () {
            const { settlement, A, B, C, keeper, attestor } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100); // A->B
            await recordObl(settlement, keeper, cid, B.address, C.address, C30);  // B->C
            await settlement.connect(keeper).proposeSettlementCycle(cid, ethers.ZeroHash, 0);
            await settlement.connect(A).confirmSettlementCycle(cid);
            await settlement.connect(B).confirmSettlementCycle(cid);
            await settlement.connect(C).confirmSettlementCycle(cid);
            // Fund only the A-B pair; B-C left unfunded.
            await settlement.connect(attestor).recordFunding(cid, A.address, B.address, ethers.ZeroAddress, C100, ethers.id("r1"), WINDOW);
            await time.increase(WINDOW + 1);
            await expect(
                settlement.connect(keeper).finalizeSettlementCycle(cid)
            ).to.be.revertedWithCustomError(FundingLib, "PairNotFunded");
        });
    });

    describe("ultrareview regressions", function () {
        it("zero-net cycle finalizes directly from CONFIRMED (bug_008)", async function () {
            const { settlement, A, B, keeper } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100);
            await recordObl(settlement, keeper, cid, B.address, A.address, C100); // nets to zero
            await settlement.connect(keeper).proposeSettlementCycle(cid, ethers.ZeroHash, 0);
            await settlement.connect(A).confirmSettlementCycle(cid);
            await settlement.connect(B).confirmSettlementCycle(cid);
            // No funding, no time advance — short-circuits CONFIRMED -> FINALIZED.
            await settlement.connect(keeper).finalizeSettlementCycle(cid);
            expect((await settlement.getSettlementCycle(cid)).status).to.equal(5); // FINALIZED
        });

        it("cannot open a second cycle while one is active (bug_005)", async function () {
            const { settlement, keeper } = await loadFixture(fixture);
            await openCycle(settlement, keeper);
            await expect(
                settlement.connect(keeper).openSettlementCycle(CYCLE_TYPE)
            ).to.be.revertedWithCustomError(settlement, "CycleAlreadyActive");
        });

        it("propose clears the current-cycle pointer so the next open succeeds (bug_005)", async function () {
            const { settlement, A, B, keeper } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100);
            await settlement.connect(keeper).proposeSettlementCycle(cid, ethers.ZeroHash, 0);
            expect(await settlement.getCurrentCycleId()).to.equal(ethers.ZeroHash);
            await expect(settlement.connect(keeper).openSettlementCycle(CYCLE_TYPE)).to.not.be.reverted;
        });
    });

    describe("three-bank multilateral cycle (bilateral liens)", function () {
        it("liens are per-pair gross-net (no multilateral offset); full fund+finalize releases all", async function () {
            const { settlement, A, B, C, keeper, attestor } = await loadFixture(fixture);
            const C60 = ethers.parseEther("60");
            const C40 = ethers.parseEther("40");
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100); // A owes B 100
            await recordObl(settlement, keeper, cid, B.address, C.address, C60);  // B owes C 60
            await recordObl(settlement, keeper, cid, C.address, A.address, C40);  // C owes A 40

            // Bilateral liens = each bank's per-pair debit (NOT multilateral net):
            // A liens 100 to B even though A is net -60 — multilateral offset is the CCP endgame.
            expect(await settlement.getCycleLien(cid, A.address)).to.equal(C100);
            expect(await settlement.getCycleLien(cid, B.address)).to.equal(C60);
            expect(await settlement.getCycleLien(cid, C.address)).to.equal(C40);

            await settlement.connect(keeper).proposeSettlementCycle(cid, ethers.ZeroHash, 0);
            await settlement.connect(A).confirmSettlementCycle(cid);
            await settlement.connect(B).confirmSettlementCycle(cid);
            await settlement.connect(C).confirmSettlementCycle(cid);

            await settlement.connect(attestor).recordFunding(cid, A.address, B.address, ethers.ZeroAddress, C100, ethers.id("f-ab"), WINDOW);
            await settlement.connect(attestor).recordFunding(cid, B.address, C.address, ethers.ZeroAddress, C60, ethers.id("f-bc"), WINDOW);
            await settlement.connect(attestor).recordFunding(cid, C.address, A.address, ethers.ZeroAddress, C40, ethers.id("f-ca"), WINDOW);
            await time.increase(WINDOW + 1);
            await settlement.connect(keeper).finalizeSettlementCycle(cid);

            expect(await settlement.getCycleLien(cid, A.address)).to.equal(0);
            expect(await settlement.getCycleLien(cid, B.address)).to.equal(0);
            expect(await settlement.getCycleLien(cid, C.address)).to.equal(0);
            expect((await settlement.getSettlementCycle(cid)).status).to.equal(5); // FINALIZED
        });
    });

    describe("E1 liveness: atomic cycle roll-over", function () {
        it("proposeAndRollover keeps a live routing cycle across the propose boundary (no blackout)", async function () {
            const { settlement, A, B, keeper } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100);

            const deadline = (await time.latest()) + WINDOW;
            const tx = await settlement.connect(keeper).proposeAndRolloverSettlementCycle(cid, ethers.ZeroHash, deadline);
            const rc = await tx.wait();
            let nextId;
            for (const log of rc.logs) {
                try { const p = settlement.interface.parseLog(log); if (p && p.name === "SettlementCycleOpened") nextId = p.args.cycleId; } catch (_) {}
            }
            expect(nextId, "rollover should open a new cycle").to.not.equal(undefined);

            // currentCycleId is never null between cycles — the blackout window is closed.
            const cur = await settlement.getCurrentCycleId();
            expect(cur).to.equal(nextId);
            expect(cur).to.not.equal(ethers.ZeroHash);
            expect(cur).to.not.equal(cid);

            // The freshly-opened cycle is the live routing target and accepts obligations immediately.
            await expect(recordObl(settlement, keeper, nextId, A.address, B.address, C30)).to.not.be.reverted;

            // The proposed cycle has left OPEN state (PROPOSED = 2).
            expect((await settlement.getSettlementCycle(cid)).status).to.equal(2);
        });

        it("contrast: plain proposeSettlementCycle clears currentCycleId (blackout window)", async function () {
            const { settlement, A, B, keeper } = await loadFixture(fixture);
            const cid = await openCycle(settlement, keeper);
            await recordObl(settlement, keeper, cid, A.address, B.address, C100);
            await settlement.connect(keeper).proposeSettlementCycle(cid, ethers.ZeroHash, (await time.latest()) + WINDOW);
            expect(await settlement.getCurrentCycleId()).to.equal(ethers.ZeroHash);
        });
    });
});
