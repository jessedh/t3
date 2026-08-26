const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");
const { deriveNets, deriveLiens, pairNetOf } = require("../../keeper/src/settlement-math");

/**
 * Wave 6C: validates the new reserve getters (getReimbursementEncumbered / getAvailableReserve)
 * and proves the off-chain reconciler math (keeper/src/settlement-math) reproduces the on-chain
 * bilateral-net pairNet/lien and the reimbursement encumbrance exactly.
 */
describe("Settlement reconciliation (Wave 6C)", function () {
    const ASSET_TYPE = 1;
    const USDC_PLEDGE = ethers.parseUnits("1000", 6);
    const C100 = ethers.parseEther("100");
    const C30 = ethers.parseEther("30");
    const C40 = ethers.parseEther("40");
    const CYCLE_TYPE = 0;
    let nonce = 0;
    const rid = () => ethers.id("transfer-" + nonce++);

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

        const A = signers.user1, B = signers.user2, C = signers.user3;
        for (const bank of [A, B, C]) {
            await facets.consortiumMembership.connect(signers.admin).registerBank(
                bank.address, "Bank", bank.address, ethers.parseEther("100000000"));
            await facets.consortiumMembership.connect(signers.admin).configureBankWallet(
                bank.address, ASSET_TYPE, bank.address, bank.address);
            await usdc.connect(signers.owner).transfer(bank.address, USDC_PLEDGE);
            await usdc.connect(bank).approve(diamondAddress, USDC_PLEDGE);
            await facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, USDC_PLEDGE);
        }

        const keeper = signers.minter;
        await facets.accessControl.connect(signers.owner).grantRole(ROLES.SETTLEMENT_KEEPER_ROLE, keeper.address);

        const cid = await openCycle(settlement, keeper);
        return { ...dep, settlement, A, B, C, keeper, cid };
    }

    async function openCycle(settlement, keeper) {
        const rc = await (await settlement.connect(keeper).openSettlementCycle(CYCLE_TYPE)).wait();
        for (const log of rc.logs) {
            try { const p = settlement.interface.parseLog(log); if (p?.name === "SettlementCycleOpened") return p.args.cycleId; } catch (_) {}
        }
        throw new Error("no SettlementCycleOpened");
    }
    async function recordObl(settlement, keeper, cid, out, recv, amount) {
        await settlement.connect(keeper).recordObligation(cid, out, recv, out, recv, amount, rid());
    }

    it("off-chain deriveNets/deriveLiens reproduce on-chain pairNet/lien exactly", async function () {
        const { settlement, A, B, C, keeper, cid } = await loadFixture(fixture);
        // A owes B 70 net; B owes C 40 net.
        const obs = [
            { outgoingIssuer: A.address, receivingIssuer: B.address, amount: C100 },
            { outgoingIssuer: B.address, receivingIssuer: A.address, amount: C30 },
            { outgoingIssuer: B.address, receivingIssuer: C.address, amount: C40 },
        ];
        for (const o of obs) await recordObl(settlement, keeper, cid, o.outgoingIssuer, o.receivingIssuer, o.amount);

        const nets = deriveNets(obs);
        const liens = deriveLiens(obs);

        // pairNet parity
        expect(await settlement.getPairNet(cid, A.address, B.address)).to.equal(pairNetOf(nets, A.address, B.address));
        expect(await settlement.getPairNet(cid, B.address, C.address)).to.equal(pairNetOf(nets, B.address, C.address));
        // lien parity
        expect(await settlement.getCycleLien(cid, A.address)).to.equal(liens.get(A.address.toLowerCase()) ?? 0n);
        expect(await settlement.getCycleLien(cid, B.address)).to.equal(liens.get(B.address.toLowerCase()) ?? 0n);
        expect(await settlement.getCycleLien(cid, C.address)).to.equal(liens.get(C.address.toLowerCase()) ?? 0n);
    });

    it("getReimbursementEncumbered == cycle lien sum; getAvailableReserve nets it out", async function () {
        const { settlement, facets, A, B, keeper, cid } = await loadFixture(fixture);
        await recordObl(settlement, keeper, cid, A.address, B.address, C100); // A owes B 100

        const vault = facets.multiAssetVault;
        const lien = await settlement.getCycleLien(cid, A.address);
        expect(lien).to.equal(C100);

        // invariant 4a: encumbrance == lien (single cycle in flight)
        const enc = await vault.getReimbursementEncumbered(A.address);
        expect(enc).to.equal(lien);

        // invariant 4b: available = effective - encumbered, and stays solvent (>0)
        const eff = await vault.getEffectiveReserve(A.address);
        const avail = await vault.getAvailableReserve(A.address);
        expect(avail).to.equal(eff - enc);
        expect(avail).to.be.gt(0n);

        // creditor B has no encumbrance
        expect(await vault.getReimbursementEncumbered(B.address)).to.equal(0n);
    });
});
