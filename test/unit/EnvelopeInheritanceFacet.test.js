const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles } = require("../helpers/roles");

describe("EnvelopeInheritanceFacet", function () {
    async function setup() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        const { facets, signers } = deployment;

        // Mint tokens to sender for escrow
        await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, ethers.parseEther("100"));

        // Approve diamond to spend tokens
        const diamondAddress = await facets.erc20.getAddress();
        await facets.erc20.connect(signers.user1).approve(diamondAddress, ethers.parseEther("100"));

        return { facets, signers };
    }

    async function createParentEnvelope(facets, signers) {
        const now = await time.latest();
        const commitWindowEnd = now + 3600;
        const tx = await facets.envelope.connect(signers.user1).createEnvelope(
            signers.user2.address,
            ethers.parseEther("10"),
            commitWindowEnd,
            0, // CRYPTO_DIRECT
            0, // EXPIRE_REVERSE
            "0x"
        );
        const receipt = await tx.wait();
        const event = receipt.logs.find(l => {
            try { return facets.envelope.interface.parseLog(l)?.name === "EnvelopeCreated"; }
            catch { return false; }
        });
        const parsed = facets.envelope.interface.parseLog(event);
        return { parentId: parsed.args.envelopeId, commitWindowEnd };
    }

    it("creates a child envelope linked to a parent", async function () {
        const { facets, signers } = await loadFixture(setup);
        const { parentId, commitWindowEnd } = await createParentEnvelope(facets, signers);

        const childTx = await facets.envelopeInheritance.connect(signers.user1).createChildEnvelope(
            parentId,
            signers.user3.address,
            ethers.parseEther("5"),
            commitWindowEnd - 100
        );
        const receipt = await childTx.wait();
        const event = receipt.logs.find(l => {
            try { return facets.envelopeInheritance.interface.parseLog(l)?.name === "ChildEnvelopeCreated"; }
            catch { return false; }
        });
        expect(event).to.not.be.undefined;
        const parsed = facets.envelopeInheritance.interface.parseLog(event);
        const childId = parsed.args.childEnvelopeId;

        expect(await facets.envelopeInheritance.getParentEnvelope(childId)).to.equal(parentId);
        const children = await facets.envelopeInheritance.getChildEnvelopes(parentId);
        expect(children).to.include(childId);
    });

    it("rejects child with commitWindowEnd exceeding parent", async function () {
        const { facets, signers } = await loadFixture(setup);
        const { parentId, commitWindowEnd } = await createParentEnvelope(facets, signers);

        await expect(
            facets.envelopeInheritance.connect(signers.user1).createChildEnvelope(
                parentId,
                signers.user3.address,
                ethers.parseEther("1"),
                commitWindowEnd + 1
            )
        ).to.be.revertedWithCustomError(facets.envelopeInheritance, "CommitWindowExceedsParent");
    });

    it("rejects child creation from non-parent-sender", async function () {
        const { facets, signers } = await loadFixture(setup);
        const { parentId, commitWindowEnd } = await createParentEnvelope(facets, signers);

        // Fund user2 so escrow doesn't fail first
        await facets.mintBurn.connect(signers.minter).mint(signers.user2.address, ethers.parseEther("10"));
        const diamondAddress = await facets.erc20.getAddress();
        await facets.erc20.connect(signers.user2).approve(diamondAddress, ethers.parseEther("10"));

        await expect(
            facets.envelopeInheritance.connect(signers.user2).createChildEnvelope(
                parentId,
                signers.user3.address,
                ethers.parseEther("1"),
                commitWindowEnd - 100
            )
        ).to.be.revertedWithCustomError(facets.envelopeInheritance, "CallerNotParentSender");
    });

    it("rejects child of a child (max depth 1)", async function () {
        const { facets, signers } = await loadFixture(setup);
        const { parentId, commitWindowEnd } = await createParentEnvelope(facets, signers);

        const childTx = await facets.envelopeInheritance.connect(signers.user1).createChildEnvelope(
            parentId,
            signers.user3.address,
            ethers.parseEther("2"),
            commitWindowEnd - 100
        );
        const receipt = await childTx.wait();
        const event = receipt.logs.find(l => {
            try { return facets.envelopeInheritance.interface.parseLog(l)?.name === "ChildEnvelopeCreated"; }
            catch { return false; }
        });
        const childId = facets.envelopeInheritance.interface.parseLog(event).args.childEnvelopeId;

        await expect(
            facets.envelopeInheritance.connect(signers.user1).createChildEnvelope(
                childId,
                signers.user3.address,
                ethers.parseEther("1"),
                commitWindowEnd - 200
            )
        ).to.be.revertedWithCustomError(facets.envelopeInheritance, "MaxInheritanceDepthExceeded");
    });

    it("rejects child when parent envelope does not exist", async function () {
        const { facets, signers } = await loadFixture(setup);
        const fakeId = ethers.keccak256(ethers.toUtf8Bytes("nonexistent"));
        const now = await time.latest();

        await expect(
            facets.envelopeInheritance.connect(signers.user1).createChildEnvelope(
                fakeId,
                signers.user3.address,
                ethers.parseEther("1"),
                now + 3600
            )
        ).to.be.revertedWithCustomError(facets.envelopeInheritance, "ParentEnvelopeNotFound");
    });

    it("returns empty array for a parent with no children", async function () {
        const { facets, signers } = await loadFixture(setup);
        const { parentId } = await createParentEnvelope(facets, signers);
        const children = await facets.envelopeInheritance.getChildEnvelopes(parentId);
        expect(children).to.deep.equal([]);
    });

    it("returns zero bytes32 for an envelope with no parent", async function () {
        const { facets, signers } = await loadFixture(setup);
        const { parentId } = await createParentEnvelope(facets, signers);
        const parent = await facets.envelopeInheritance.getParentEnvelope(parentId);
        expect(parent).to.equal(ethers.ZeroHash);
    });
});
