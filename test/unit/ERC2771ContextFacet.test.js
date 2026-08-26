const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");

describe("ERC2771ContextFacet", function () {
    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();

        // ERC2771ContextFacet is included in the base MVP diamond fixture.
        const erc2771 = await ethers.getContractAt("ERC2771ContextFacet", deployment.diamondAddress);
        return { ...deployment, erc2771 };
    }

    it("allows default admin to set and read trusted forwarder", async function () {
        const { erc2771, signers } = await loadFixture(setupFixture);

        await erc2771.connect(signers.owner).setTrustedForwarder(signers.user1.address);
        expect(await erc2771.getTrustedForwarder()).to.equal(signers.user1.address);
        expect(await erc2771.isTrustedForwarder(signers.user1.address)).to.equal(true);
        expect(await erc2771.isTrustedForwarder(signers.user2.address)).to.equal(false);
    });

    it("rejects non-admin attempts to set trusted forwarder", async function () {
        const { erc2771, signers } = await loadFixture(setupFixture);

        await expect(
            erc2771.connect(signers.user1).setTrustedForwarder(signers.user2.address)
        ).to.be.revertedWith("ERC2771: Only admin can set forwarder");
    });

    it("returns msg.sender for direct calls", async function () {
        const { erc2771, signers } = await loadFixture(setupFixture);

        const sender = await erc2771.connect(signers.user2).msgSender();
        expect(sender).to.equal(signers.user2.address);
    });

    it("extracts appended original sender when called by trusted forwarder", async function () {
        const { erc2771, signers, diamondAddress } = await loadFixture(setupFixture);

        await erc2771.connect(signers.owner).setTrustedForwarder(signers.user1.address);

        // ERC-2771 call shape: function selector + appended 20-byte original sender.
        const selector = erc2771.interface.getFunction("msgSender").selector.slice(2);
        const appendedSender = signers.user3.address.slice(2).toLowerCase();
        const calldata = `0x${selector}${appendedSender}`;

        const raw = await ethers.provider.call({
            to: diamondAddress,
            from: signers.user1.address,
            data: calldata
        });

        const [resolvedSender] = erc2771.interface.decodeFunctionResult("msgSender", raw);
        expect(resolvedSender).to.equal(signers.user3.address);
    });
});
