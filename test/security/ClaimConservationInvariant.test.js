const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture, FacetCutAction } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");

describe("ClaimConservationInvariant", function () {
    const amount = ethers.parseEther("1000");
    const envelopeAmount = ethers.parseEther("300");
    const fiatBurnAmount = ethers.parseEther("200");

    // When initialized == false (default), all existing operations pass unchanged
    describe("pre-activation (initialized=false)", function () {
        async function preFixture() {
            const { diamondAddress, facets, signers } = await loadFixture(deployT3DiamondFixture);
            await setupTestRoles(facets, signers);
            return { diamondAddress, facets, signers };
        }

        it("ordinary mint does not revert", async function () {
            const { facets, signers } = await loadFixture(preFixture);
            await expect(
                facets.mintBurn.connect(signers.minter).mint(signers.user1.address, amount)
            ).to.not.be.reverted;
            expect(await facets.erc20.balanceOf(signers.user1.address)).to.equal(amount);
        });

        it("ordinary transfer does not revert", async function () {
            const { facets, signers } = await loadFixture(preFixture);
            await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, amount);
            await expect(
                facets.directTransfer.connect(signers.user1).transfer(signers.user2.address, amount)
            ).to.not.be.reverted;
            expect(await facets.erc20.balanceOf(signers.user2.address)).to.equal(amount);
        });

        it("escrow and release do not revert", async function () {
            const { facets, signers } = await loadFixture(preFixture);
            await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, amount);

            const latest = await ethers.provider.getBlock("latest");
            const commitWindowEnd = latest.timestamp + 3600;
            const tx = await facets.envelope
                .connect(signers.user1)
                .createEnvelope(signers.user2.address, envelopeAmount, commitWindowEnd, 0, 0, "0x");
            const receipt = await tx.wait();
            const envCreatedEvent = receipt.logs.find((l) => l.fragment?.name === "EnvelopeCreated");
            expect(envCreatedEvent).to.not.be.undefined;
            const envelopeId = envCreatedEvent.args[0];

            await expect(
                facets.envelope.connect(signers.user1).reverseEnvelope(envelopeId, envelopeAmount)
            ).to.not.be.reverted;
        });
    });

    // When initialized == true (set via harness in test), attribution is enforced
    describe("post-activation (initialized=true)", function () {
        async function postFixture() {
            const { diamondAddress, facets, signers } = await loadFixture(deployT3DiamondFixture);
            await setupTestRoles(facets, signers);

            // Deploy IssuanceAccountingHarness and add it to the diamond so its
            // functions operate on the diamond's namespaced storage.
            const Harness = await ethers.getContractFactory("IssuanceAccountingHarness");
            const harness = await Harness.deploy();
            await harness.waitForDeployment();

            // Avoid selectors that collide with ERC20BaseFacet (balanceOf/totalSupply)
            // and IssuanceControlFacet (getIssuerAttributedOutstanding now in production).
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

            // Create attributed supply: minter issues to user1 through the attributed path
            await harnessAtDiamond.mintAttributed(signers.minter.address, signers.user1.address, amount);

            return { facets, signers, harnessAtDiamond };
        }

        it("legacy mint reverts with LegacyIssuanceDisabled", async function () {
            const { facets, signers } = await loadFixture(postFixture);
            await facets.issuanceControl.connect(signers.owner).setLegacyMintUnlocked(false);
            await expect(
                facets.mintBurn.connect(signers.minter).mint(signers.user2.address, amount)
            ).to.be.revertedWithCustomError(facets.mintBurn, "LegacyIssuanceDisabled");
        });

        it("legacy burn reverts with LegacyIssuanceDisabled", async function () {
            const { facets, signers } = await loadFixture(postFixture);
            await facets.issuanceControl.connect(signers.owner).setLegacyMintUnlocked(false);
            await expect(
                facets.mintBurn.connect(signers.user1).burn(1)
            ).to.be.revertedWithCustomError(facets.mintBurn, "LegacyIssuanceDisabled");
        });

        it("transfer moves claims and conserves attributed supply", async function () {
            const { facets, signers, harnessAtDiamond } = await loadFixture(postFixture);

            await facets.directTransfer.connect(signers.user1).transfer(signers.user2.address, envelopeAmount);

            expect(await harnessAtDiamond.getWalletClaimAmount(signers.user2.address, signers.minter.address))
                .to.equal(envelopeAmount);

            expect(await harnessAtDiamond.totalAttributedOutstanding()).to.equal(amount);
            expect(await facets.erc20.totalSupply()).to.equal(amount);
        });

        it("escrowFrom followed by releaseEscrow conserves supply", async function () {
            const { facets, signers, harnessAtDiamond } = await loadFixture(postFixture);

            const latest = await ethers.provider.getBlock("latest");
            const commitWindowEnd = latest.timestamp + 3600;
            const tx = await facets.envelope
                .connect(signers.user1)
                .createEnvelope(signers.user2.address, envelopeAmount, commitWindowEnd, 0, 0, "0x");
            const receipt = await tx.wait();
            const envCreatedEvent = receipt.logs.find((l) => l.fragment?.name === "EnvelopeCreated");
            const envelopeId = envCreatedEvent.args[0];

            expect(await harnessAtDiamond.totalAttributedOutstanding()).to.equal(amount);
            expect(await facets.erc20.totalSupply()).to.equal(amount);

            await facets.envelope.connect(signers.user1).reverseEnvelope(envelopeId, envelopeAmount);

            expect(await harnessAtDiamond.totalAttributedOutstanding()).to.equal(amount);
            expect(await facets.erc20.totalSupply()).to.equal(amount);
        });

        it("escrowFrom followed by burnEscrow conserves supply", async function () {
            const { facets, signers, harnessAtDiamond } = await loadFixture(postFixture);

            const latest = await ethers.provider.getBlock("latest");
            const commitWindowEnd = latest.timestamp + 3600;
            const tx = await facets.envelope
                .connect(signers.user1)
                .createEnvelope(signers.user2.address, fiatBurnAmount, commitWindowEnd, 1, 0, "0x");
            const receipt = await tx.wait();
            const envCreatedEvent = receipt.logs.find((l) => l.fragment?.name === "EnvelopeCreated");
            const envelopeId = envCreatedEvent.args[0];

            // Move to PENDING_FIAT and confirm off-chain fiat delivery
            await facets.envelope.connect(signers.admin).finalizeEnvelope(envelopeId);
            await facets.envelope.connect(signers.admin).confirmFiatDelivery(envelopeId);

            expect(await facets.erc20.totalSupply()).to.equal(amount - fiatBurnAmount);
            expect(await harnessAtDiamond.totalAttributedOutstanding()).to.equal(amount - fiatBurnAmount);
        });
    });
});
