const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES, grantRole } = require("../helpers/roles");

describe("T3MultiSigSettlementFacet Unit Tests", function () {
    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        const multiSig = await ethers.getContractAt(
            "T3MultiSigSettlementFacet",
            deployment.diamondAddress
        );

        // Ensure admin is also a custodian so they can propose settlements
        await grantRole(
            deployment.facets.accessControl,
            ROLES.CUSTODIAN_ROLE,
            deployment.signers.admin.address,
            deployment.signers.owner
        );

        return { ...deployment, multiSig };
    }

    it("executes a multi-sig settlement after approvals", async function () {
        const { multiSig, facets, signers } = await loadFixture(setupFixture);
        const amount = ethers.parseEther("250");

        await multiSig.connect(signers.admin).setApprovalThreshold(2);
        await multiSig.connect(signers.admin).setLargeSettlementThreshold(ethers.parseEther("100"));

        await facets.mintBurn.connect(signers.minter).mint(signers.admin.address, amount);

        const tx = await multiSig
            .connect(signers.admin)
            .proposeSettlement(
                signers.admin.address,
                signers.custodian1.address,
                amount,
                "seed settlement"
            );
        const receipt = await tx.wait();
        const settlementId = receipt.logs
            .map((log) => {
                try {
                    return multiSig.interface.parseLog(log);
                } catch (error) {
                    return null;
                }
            })
            .filter(Boolean)
            .find((parsed) => parsed.name === "SettlementProposed").args.settlementId;

        await expect(
            multiSig.connect(signers.custodian1).approveMultiSigSettlement(settlementId)
        )
            .to.emit(multiSig, "SettlementApproved")
            .withArgs(settlementId, signers.custodian1.address, 1, 2);

        await expect(
            multiSig.connect(signers.custodian2).approveMultiSigSettlement(settlementId)
        )
            .to.emit(multiSig, "SettlementApproved")
            .to.emit(multiSig, "SettlementExecuted");

        const erc20 = await ethers.getContractAt("ERC20BaseFacet", await multiSig.getAddress());
        expect(await erc20.balanceOf(signers.admin.address)).to.equal(0n);
        expect(await erc20.balanceOf(signers.custodian1.address)).to.equal(amount);
    });

    it("supports cancellation by proposer", async function () {
        const { multiSig, facets, signers } = await loadFixture(setupFixture);
        const amount = ethers.parseEther("150");

        await multiSig.connect(signers.admin).setApprovalThreshold(2);
        await multiSig.connect(signers.admin).setLargeSettlementThreshold(ethers.parseEther("100"));
        await facets.mintBurn.connect(signers.minter).mint(signers.admin.address, amount);

        const tx = await multiSig
            .connect(signers.admin)
            .proposeSettlement(
                signers.admin.address,
                signers.custodian2.address,
                amount,
                "cancel me"
            );
        const receipt = await tx.wait();
        const settlementId = receipt.logs
            .map((log) => {
                try {
                    return multiSig.interface.parseLog(log);
                } catch (error) {
                    return null;
                }
            })
            .filter(Boolean)
            .find((parsed) => parsed.name === "SettlementProposed").args.settlementId;

        await expect(
            multiSig
                .connect(signers.admin)
                .cancelMultiSigSettlement(settlementId, "no longer needed")
        )
            .to.emit(multiSig, "SettlementCancelled")
            .withArgs(settlementId, signers.admin.address, "no longer needed");
    });

    it("rejects invalid approvals and threshold violations", async function () {
        const { multiSig, facets, signers } = await loadFixture(setupFixture);
        const amount = ethers.parseEther("80");

        await multiSig.connect(signers.admin).setApprovalThreshold(2);
        await multiSig.connect(signers.admin).setLargeSettlementThreshold(ethers.parseEther("100"));
        await facets.mintBurn.connect(signers.minter).mint(signers.admin.address, amount);

        await expect(
            multiSig
                .connect(signers.admin)
                .proposeSettlement(
                    signers.admin.address,
                    signers.custodian1.address,
                    amount,
                    "below threshold"
                )
        ).to.be.revertedWith("MultiSig: Amount below threshold");
    });
});
