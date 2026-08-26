const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture, FacetCutAction } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

/**
 * G.0.b runtime tests: verifies that finalizeEnvelopeClaims + substituteLiability
 * are correctly wired into TransferEnvelopeFacet._settleAmount.
 *
 * Uses IssuanceAccountingHarness (test-only facet) to bootstrap attributed supply
 * without going through the full consortium bank pledge setup.
 * Production path tested: createEnvelope → finalizeEnvelope → recipient claims.
 */
describe("EnvelopeClaimWiring", function () {
    const amount = ethers.parseEther("1000");
    const envelopeAmount = ethers.parseEther("400");

    // Fixture: attribution initialized, user1 holds attributed supply from minter (issuer=minter)
    async function claimWiringFixture() {
        const { diamondAddress, facets, signers } = await loadFixture(deployT3DiamondFixture);
        await setupTestRoles(facets, signers);

        const Harness = await ethers.getContractFactory("IssuanceAccountingHarness");
        const harness = await Harness.deploy();
        await harness.waitForDeployment();

        const neededSigs = [
            "initialize()",
            "mintAttributed(address,address,uint256)",
            "totalAttributedOutstanding()",
            "getWalletClaimAmount(address,address)",
        ];
        const selectors = neededSigs.map((sig) => harness.interface.getFunction(sig).selector);
        const cut = [
            {
                facetAddress: await harness.getAddress(),
                action: FacetCutAction.Add,
                functionSelectors: selectors,
            },
        ];
        await facets.diamondCut.connect(signers.owner).diamondCut(cut, ethers.ZeroAddress, "0x");

        const harnessAtDiamond = await ethers.getContractAt("IssuanceAccountingHarness", diamondAddress);
        await harnessAtDiamond.initialize();

        // Bootstrap: minter issues amount to user1 via attributed path
        await harnessAtDiamond.mintAttributed(signers.minter.address, signers.user1.address, amount);

        // Register the cross-institution receiving issuer (user3 = "bank2") as an active
        // consortium bank so the S1 receiving-issuer-must-be-ACTIVE guard (bug_030) passes.
        await facets.consortiumMembership.connect(signers.admin).registerBank(
            signers.user3.address, "Bank2", signers.user3.address, ethers.parseEther("100000000")
        );

        return { facets, signers, harnessAtDiamond, diamondAddress };
    }

    // Helper: create a CRYPTO_DIRECT envelope from user1 to user2
    async function createCryptoEnvelope(facets, signers, envelopeAmt) {
        const latest = await ethers.provider.getBlock("latest");
        const commitWindowEnd = latest.timestamp + 3600;
        const tx = await facets.envelope
            .connect(signers.user1)
            .createEnvelope(signers.user2.address, envelopeAmt, commitWindowEnd, 0, 0, "0x");
        const receipt = await tx.wait();
        const event = receipt.logs.find((l) => l.fragment?.name === "EnvelopeCreated");
        return event.args[0]; // envelopeId
    }

    describe("same-institution CRYPTO_DIRECT finalization", function () {
        it("recipient inherits original issuer composition (no receivingIssuer set)", async function () {
            const { facets, signers, harnessAtDiamond } = await loadFixture(claimWiringFixture);

            const envelopeId = await createCryptoEnvelope(facets, signers, envelopeAmount);

            // Finalize: no receivingIssuer set → same-institution path
            await facets.envelope.connect(signers.user1).finalizeEnvelope(envelopeId);

            // user2 should now hold envelopeAmount attributed to minter
            expect(
                await harnessAtDiamond.getWalletClaimAmount(signers.user2.address, signers.minter.address)
            ).to.equal(envelopeAmount);

            // user1 retains the remainder attributed to minter
            expect(
                await harnessAtDiamond.getWalletClaimAmount(signers.user1.address, signers.minter.address)
            ).to.equal(amount - envelopeAmount);

            // Total attributed outstanding stays at amount (no supply created/destroyed)
            expect(await harnessAtDiamond.totalAttributedOutstanding()).to.equal(amount);
            expect(await facets.erc20.totalSupply()).to.equal(amount);
        });
    });

    describe("cross-institution CRYPTO_DIRECT finalization", function () {
        it("recipient gets receiving issuer claims and substituteLiability fires", async function () {
            const { facets, signers, harnessAtDiamond } = await loadFixture(claimWiringFixture);

            const envelopeId = await createCryptoEnvelope(facets, signers, envelopeAmount);

            // Admin routes this envelope to bank2 (receiving issuer)
            const bank2 = signers.user3;
            await facets.envelope
                .connect(signers.admin)
                .setEnvelopeReceivingIssuer(envelopeId, bank2.address);

            await facets.envelope.connect(signers.user1).finalizeEnvelope(envelopeId);

            // user2 should be credited with bank2 as issuer (not original minter)
            expect(
                await harnessAtDiamond.getWalletClaimAmount(signers.user2.address, bank2.address)
            ).to.equal(envelopeAmount);
            expect(
                await harnessAtDiamond.getWalletClaimAmount(signers.user2.address, signers.minter.address)
            ).to.equal(0);

            // substituteLiability: minter's outstanding decreases, bank2's increases
            expect(
                await facets.issuanceControl.getIssuerAttributedOutstanding(signers.minter.address)
            ).to.equal(amount - envelopeAmount);
            expect(
                await facets.issuanceControl.getIssuerAttributedOutstanding(bank2.address)
            ).to.equal(envelopeAmount);

            // Conservation: total unchanged
            expect(await harnessAtDiamond.totalAttributedOutstanding()).to.equal(amount);
            expect(await facets.erc20.totalSupply()).to.equal(amount);
        });

        it("setEnvelopeReceivingIssuer reverts when envelope is not in Created state", async function () {
            const { facets, signers } = await loadFixture(claimWiringFixture);

            const envelopeId = await createCryptoEnvelope(facets, signers, envelopeAmount);

            // Finalize first → moves to Finalized
            await facets.envelope.connect(signers.user1).finalizeEnvelope(envelopeId);

            // Now attempt to set receiving issuer on Finalized envelope — should revert
            await expect(
                facets.envelope
                    .connect(signers.admin)
                    .setEnvelopeReceivingIssuer(envelopeId, signers.user3.address)
            ).to.be.revertedWithCustomError(facets.envelope, "EnvelopeNotInState");
        });

        it("setEnvelopeReceivingIssuer reverts when caller is not admin", async function () {
            const { facets, signers } = await loadFixture(claimWiringFixture);

            const envelopeId = await createCryptoEnvelope(facets, signers, envelopeAmount);

            await expect(
                facets.envelope
                    .connect(signers.user1)
                    .setEnvelopeReceivingIssuer(envelopeId, signers.user3.address)
            ).to.be.revertedWithCustomError(facets.envelope, "UnauthorizedCaller");
        });
    });

    describe("reversal path — attribution returned to sender unchanged", function () {
        it("full reversal after setEnvelopeReceivingIssuer returns claims to sender with original issuer", async function () {
            const { facets, signers, harnessAtDiamond } = await loadFixture(claimWiringFixture);

            const envelopeId = await createCryptoEnvelope(facets, signers, envelopeAmount);

            // Set cross-institution routing — but then reverse before finalization
            await facets.envelope
                .connect(signers.admin)
                .setEnvelopeReceivingIssuer(envelopeId, signers.user3.address);

            await facets.envelope.connect(signers.user1).reverseEnvelope(envelopeId, envelopeAmount);

            // user1 should have all claims back under original minter issuer
            expect(
                await harnessAtDiamond.getWalletClaimAmount(signers.user1.address, signers.minter.address)
            ).to.equal(amount);

            // user2 gets nothing
            expect(
                await harnessAtDiamond.getWalletClaimAmount(signers.user2.address, signers.minter.address)
            ).to.equal(0);

            // substituteLiability NOT called — minter outstanding unchanged
            expect(
                await facets.issuanceControl.getIssuerAttributedOutstanding(signers.minter.address)
            ).to.equal(amount);

            expect(await harnessAtDiamond.totalAttributedOutstanding()).to.equal(amount);
        });
    });

    describe("PARTIAL_SPLIT with cross-institution routing", function () {
        it("split credits recipient with receivingIssuer claims and returns remainder to sender with original issuer", async function () {
            const { facets, signers, harnessAtDiamond } = await loadFixture(claimWiringFixture);

            const envelopeId = await createCryptoEnvelope(facets, signers, envelopeAmount);

            // Set cross-institution routing
            const bank2 = signers.user3;
            await facets.envelope
                .connect(signers.admin)
                .setEnvelopeReceivingIssuer(envelopeId, bank2.address);

            // Raise a dispute and resolve with PARTIAL_SPLIT
            await facets.envelope.connect(signers.user2).raiseDispute(envelopeId, "0x");

            const splitAmount = ethers.parseEther("100");
            const senderPortion = envelopeAmount - splitAmount;

            await facets.envelope
                .connect(signers.admin)
                .resolveDispute(envelopeId, 2 /* PARTIAL_SPLIT */, splitAmount);

            // Recipient gets splitAmount attributed to bank2 (receiving issuer)
            expect(
                await harnessAtDiamond.getWalletClaimAmount(signers.user2.address, bank2.address)
            ).to.equal(splitAmount);
            expect(
                await harnessAtDiamond.getWalletClaimAmount(signers.user2.address, signers.minter.address)
            ).to.equal(0);

            // Sender gets senderPortion back attributed to original minter
            expect(
                await harnessAtDiamond.getWalletClaimAmount(signers.user1.address, signers.minter.address)
            ).to.equal(amount - envelopeAmount + senderPortion);

            // substituteLiability: minter outstanding drops by splitAmount; bank2 gains splitAmount
            expect(
                await facets.issuanceControl.getIssuerAttributedOutstanding(signers.minter.address)
            ).to.equal(amount - splitAmount);
            expect(
                await facets.issuanceControl.getIssuerAttributedOutstanding(bank2.address)
            ).to.equal(splitAmount);

            // Conservation
            expect(await harnessAtDiamond.totalAttributedOutstanding()).to.equal(amount);
            expect(await facets.erc20.totalSupply()).to.equal(amount);
        });
    });

    describe("initialization guard — initializeClaimAttribution reverts when supply > 0", function () {
        it("reverts with ClaimAttributionMustInitAtZeroSupply when tokens already exist", async function () {
            const { diamondAddress, facets, signers } = await loadFixture(deployT3DiamondFixture);
            await setupTestRoles(facets, signers);

            // Mint via legacy path (unattributed) — supply is now > 0
            await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, amount);
            expect(await facets.erc20.totalSupply()).to.equal(amount);

            // Attempt to initialize attribution — must revert because supply > 0
            // (existing unattributed envelopes would be permanently stuck if this succeeded)
            await expect(
                facets.issuanceControl.connect(signers.owner).initializeClaimAttribution()
            ).to.be.revertedWithCustomError(facets.issuanceControl, "ClaimAttributionMustInitAtZeroSupply");
        });
    });

    describe("settlement-cycle liveness across rollover", function () {
        it("cross-bank finalize stays live through proposeAndRolloverSettlementCycle", async function () {
            const { facets, signers, harnessAtDiamond, diamondAddress } = await loadFixture(claimWiringFixture);
            const bank2 = signers.user3;
            const keeper = signers.minter;
            const CYCLE_TYPE = 0;
            const ASSET_TYPE = 1;
            const PLEDGE = ethers.parseUnits("10000", 6);

            // Activate settlement-cycle recording and grant keeper role
            await facets.settlementCycle.connect(signers.owner).setSettlementModelActive(true);
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.SETTLEMENT_KEEPER_ROLE, keeper.address);

            // Pledge USDC collateral for the outgoing issuer (minter) so the bilateral-net
            // lien created during cross-bank finalize can be encumbered against reserve.
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const usdc = await MockERC20.deploy("Mock USDC", "mUSDC", ethers.parseUnits("10000000", 6));
            await usdc.waitForDeployment();
            await facets.multiAssetVault.connect(signers.admin).configureAssetType(ASSET_TYPE, {
                tokenAddress: await usdc.getAddress(),
                decimals: 6,
                collateralFactorBps: 10000,
                haircutBps: 0,
                maxBankExposure: 0,
                isActive: true,
            });
            await facets.multiAssetVault.connect(signers.admin).registerAssetTypeForReserve(ASSET_TYPE);
            await facets.consortiumMembership.connect(signers.admin).registerBank(
                signers.minter.address,
                "MinterBank",
                signers.minter.address,
                ethers.parseEther("100000000")
            );
            await facets.consortiumMembership.connect(signers.admin).configureBankWallet(
                signers.minter.address,
                ASSET_TYPE,
                signers.minter.address,
                signers.minter.address
            );
            await usdc.connect(signers.owner).transfer(signers.minter.address, PLEDGE);
            await usdc.connect(signers.minter).approve(diamondAddress, PLEDGE);
            await facets.multiAssetVault.connect(signers.minter).pledgeCollateral(ASSET_TYPE, PLEDGE);

            // Open first routing cycle
            await facets.settlementCycle.connect(keeper).openSettlementCycle(CYCLE_TYPE);
            const firstCycleId = await facets.settlementCycle.getCurrentCycleId();
            expect(firstCycleId).to.not.equal(ethers.ZeroHash);

            // First cross-bank finalize records into the open cycle
            const envelopeId1 = await createCryptoEnvelope(facets, signers, envelopeAmount);
            await facets.envelope
                .connect(signers.admin)
                .setEnvelopeReceivingIssuer(envelopeId1, bank2.address);
            await facets.envelope.connect(signers.user1).finalizeEnvelope(envelopeId1);

            expect(
                await facets.settlementCycle.getPairNet(firstCycleId, signers.minter.address, bank2.address)
            ).to.equal(envelopeAmount);
            expect(
                await harnessAtDiamond.getWalletClaimAmount(signers.user2.address, bank2.address)
            ).to.equal(envelopeAmount);

            // Rollover: propose first cycle and atomically open the next routing cycle
            const latest = await ethers.provider.getBlock("latest");
            const tx = await facets.settlementCycle
                .connect(keeper)
                .proposeAndRolloverSettlementCycle(firstCycleId, ethers.ZeroHash, latest.timestamp + 3600);
            const receipt = await tx.wait();
            const openedEvent = receipt.logs.find((l) => l.fragment?.name === "SettlementCycleOpened");
            const secondCycleId = openedEvent.args[0];
            expect(await facets.settlementCycle.getCurrentCycleId()).to.equal(secondCycleId);
            expect(secondCycleId).to.not.equal(firstCycleId);

            // Second cross-bank finalize must NOT revert NoOpenSettlementCycle; it lands in the new cycle
            const envelopeId2 = await createCryptoEnvelope(facets, signers, envelopeAmount);
            await facets.envelope
                .connect(signers.admin)
                .setEnvelopeReceivingIssuer(envelopeId2, bank2.address);
            await expect(facets.envelope.connect(signers.user1).finalizeEnvelope(envelopeId2)).to.not.be.reverted;

            expect(
                await facets.settlementCycle.getPairNet(secondCycleId, signers.minter.address, bank2.address)
            ).to.equal(envelopeAmount);
            // First cycle is untouched after rollover
            expect(
                await facets.settlementCycle.getPairNet(firstCycleId, signers.minter.address, bank2.address)
            ).to.equal(envelopeAmount);
        });
    });

    describe("pre-activation (initialized=false) — no change to existing finalization behavior", function () {
        async function preFixture() {
            const { diamondAddress, facets, signers } = await loadFixture(deployT3DiamondFixture);
            await setupTestRoles(facets, signers);
            return { facets, signers };
        }

        it("CRYPTO_DIRECT finalizeEnvelope still transfers tokens when attribution not initialized", async function () {
            const { facets, signers } = await loadFixture(preFixture);

            await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, amount);

            const latest = await ethers.provider.getBlock("latest");
            const commitWindowEnd = latest.timestamp + 3600;
            const tx = await facets.envelope
                .connect(signers.user1)
                .createEnvelope(signers.user2.address, envelopeAmount, commitWindowEnd, 0, 0, "0x");
            const receipt = await tx.wait();
            const event = receipt.logs.find((l) => l.fragment?.name === "EnvelopeCreated");
            const envelopeId = event.args[0];

            await expect(
                facets.envelope.connect(signers.user1).finalizeEnvelope(envelopeId)
            ).to.not.be.reverted;

            expect(await facets.erc20.balanceOf(signers.user2.address)).to.equal(envelopeAmount);
            expect(await facets.erc20.totalSupply()).to.equal(amount);
        });
    });
});
