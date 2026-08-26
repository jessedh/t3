const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture, getSelectors, FacetCutAction } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");
const { AMOUNTS } = require("../helpers/constants");

describe("T3TokenDirectTransferFacet — Unit Tests (T0.3)", function () {
    async function setupDirectTransferFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        const { facets, signers, diamondAddress } = deployment;

        // Deploy T3TokenDirectTransferFacet
        const DirectTransferFacet = await ethers.getContractFactory("T3TokenDirectTransferFacet");
        const directTransferFacet = await DirectTransferFacet.deploy();
        await directTransferFacet.waitForDeployment();

        // Replace transfer and transferFrom selectors on the diamond
        const newSelectors = getSelectors(directTransferFacet, []);
        // Filter to only transfer and transferFrom selectors
        const transferSig = "transfer(address,uint256)";
        const transferFromSig = "transferFrom(address,address,uint256)";
        const transferSelector = directTransferFacet.interface.getFunction(transferSig).selector;
        const transferFromSelector = directTransferFacet.interface.getFunction(transferFromSig).selector;

        const cut = [
            {
                facetAddress: await directTransferFacet.getAddress(),
                action: FacetCutAction.Replace,
                functionSelectors: [transferSelector, transferFromSelector]
            }
        ];

        const diamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);
        await diamondCut.connect(signers.owner).diamondCut(cut, ethers.ZeroAddress, "0x");

        // Create interface for the new facet attached to diamond
        const directTransfer = await ethers.getContractAt("T3TokenDirectTransferFacet", diamondAddress);

        // Mint tokens for testing
        await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, AMOUNTS.THOUSAND_TOKENS);
        await facets.mintBurn.connect(signers.minter).mint(signers.user2.address, AMOUNTS.HUNDRED_TOKENS);

        // Attach common logic facet for risk profile reads
        const commonLogic = await ethers.getContractAt("T3TokenCommonLogicFacet", diamondAddress);

        return { ...deployment, directTransfer, directTransferFacet, commonLogic };
    }

    let deployment, facets, signers, directTransfer, commonLogic;

    beforeEach(async function () {
        const result = await loadFixture(setupDirectTransferFixture);
        deployment = result;
        facets = result.facets;
        signers = result.signers;
        directTransfer = result.directTransfer;
        commonLogic = result.commonLogic;
    });

    describe("Direct Transfer — transfer", function () {
        it("moves balance and emits Transfer + DirectTransferExecuted", async function () {
            const sender = signers.user1;
            const recipient = signers.user2;
            const amount = AMOUNTS.TEN_TOKENS;

            const senderBefore = await facets.erc20.balanceOf(sender.address);
            const recipientBefore = await facets.erc20.balanceOf(recipient.address);

            await expect(
                directTransfer.connect(sender).transfer(recipient.address, amount)
            )
                .to.emit(directTransfer, "Transfer")
                .withArgs(sender.address, recipient.address, amount)
                .and.to.emit(directTransfer, "DirectTransferExecuted")
                .withArgs(
                    sender.address, // operator
                    sender.address, // from
                    recipient.address, // to
                    amount,
                    0, // feeAmount
                    0, // transferKind = DIRECT_TRANSFER
                    ethers.ZeroHash // correlationId
                );

            const senderAfter = await facets.erc20.balanceOf(sender.address);
            const recipientAfter = await facets.erc20.balanceOf(recipient.address);

            expect(senderAfter).to.equal(senderBefore - amount);
            expect(recipientAfter).to.equal(recipientBefore + amount);
        });

        it("reverts when paused", async function () {
            await facets.pausable.connect(signers.pauser).pause();

            await expect(
                directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.ONE_TOKEN)
            ).to.be.revertedWith("Pausable: paused");
        });

        it("reverts for zero recipient", async function () {
            await expect(
                directTransfer.connect(signers.user1).transfer(ethers.ZeroAddress, AMOUNTS.ONE_TOKEN)
            ).to.be.revertedWithCustomError(facets.erc20, "TransferToZeroAddress");
        });

        it("reverts for zero amount", async function () {
            await expect(
                directTransfer.connect(signers.user1).transfer(signers.user2.address, 0)
            ).to.be.reverted;
        });

        it("reverts when sender is in wallet recovery quarantine", async function () {
            // Grant CUSTODIAN_ROLE to user1 so they can be put in recovery
            await grantRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, signers.user1.address, signers.owner);
            // Initiate recovery for user1
            await facets.walletRecovery.connect(signers.admin).initiateRecovery(signers.user1.address, 0);

            await expect(
                directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.ONE_TOKEN)
            ).to.be.revertedWithCustomError(facets.walletRecovery, "WalletInRecovery");
        });

        it("reverts when recipient is in wallet recovery quarantine", async function () {
            // Grant CUSTODIAN_ROLE to user2 so they can be put in recovery
            await grantRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, signers.user2.address, signers.owner);
            // Initiate recovery for user2
            await facets.walletRecovery.connect(signers.admin).initiateRecovery(signers.user2.address, 0);

            await expect(
                directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.ONE_TOKEN)
            ).to.be.revertedWithCustomError(facets.walletRecovery, "WalletInRecovery");
        });

        it("does not assess fees", async function () {
            const sender = signers.user1;
            const recipient = signers.user2;
            const amount = AMOUNTS.TEN_TOKENS;

            const senderBefore = await facets.erc20.balanceOf(sender.address);

            await directTransfer.connect(sender).transfer(recipient.address, amount);

            const senderAfter = await facets.erc20.balanceOf(sender.address);
            expect(senderBefore - senderAfter).to.equal(amount);
        });

        it("updates transaction metadata (lastTransactionTime)", async function () {
            const sender = signers.user1;
            const recipient = signers.user2;

            const profileBefore = await commonLogic.getWalletRiskProfile(sender.address);
            const recipientProfileBefore = await commonLogic.getWalletRiskProfile(recipient.address);

            await directTransfer.connect(sender).transfer(recipient.address, AMOUNTS.ONE_TOKEN);

            const profileAfter = await commonLogic.getWalletRiskProfile(sender.address);
            const recipientProfileAfter = await commonLogic.getWalletRiskProfile(recipient.address);

            expect(profileAfter.lastTransactionTime).to.be.gt(profileBefore.lastTransactionTime);
            expect(recipientProfileAfter.lastTransactionTime).to.be.gt(recipientProfileBefore.lastTransactionTime);
        });

        it("does not expose legacy pending transfer queries", async function () {
            const sender = signers.user1;
            const recipient = signers.user2;

            await directTransfer.connect(sender).transfer(recipient.address, AMOUNTS.ONE_TOKEN);

            // Legacy pending transfer functions are removed in Phase 1 cutover.
            // Verify they no longer exist on the diamond by sending raw calldata.
            const getPendingTransfersSelector = ethers
                .id("getPendingTransfers(address)")
                .slice(2, 10);
            const getOutgoingPendingTransfersSelector = ethers
                .id("getOutgoingPendingTransfers(address)")
                .slice(2, 10);

            // Build raw calldata: selector + abi-encoded address argument
            const pendingCalldata = getPendingTransfersSelector + ethers.AbiCoder.defaultAbiCoder()
                .encode(["address"], [recipient.address])
                .slice(2);
            const outgoingCalldata = getOutgoingPendingTransfersSelector + ethers.AbiCoder.defaultAbiCoder()
                .encode(["address"], [sender.address])
                .slice(2);

            // Send raw calls via a signer; should revert with FunctionDoesNotExist
            const tx1 = {
                to: directTransfer.target,
                data: "0x" + pendingCalldata
            };
            await expect(
                sender.sendTransaction(tx1)
            ).to.be.revertedWithCustomError(
                await ethers.getContractAt("Diamond", directTransfer.target),
                "FunctionDoesNotExist"
            );

            const tx2 = {
                to: directTransfer.target,
                data: "0x" + outgoingCalldata
            };
            await expect(
                sender.sendTransaction(tx2)
            ).to.be.revertedWithCustomError(
                await ethers.getContractAt("Diamond", directTransfer.target),
                "FunctionDoesNotExist"
            );
        });
    });

    describe("Delegated Transfer — transferFrom", function () {
        it("spends allowance, moves balance, and emits DirectTransferExecuted with operator != from", async function () {
            const owner = signers.user1;
            const spender = signers.user2;
            const recipient = signers.user3;
            const amount = AMOUNTS.TEN_TOKENS;

            // Approve spender
            await facets.erc20.connect(owner).approve(spender.address, amount);

            const ownerBefore = await facets.erc20.balanceOf(owner.address);
            const recipientBefore = await facets.erc20.balanceOf(recipient.address);

            await expect(
                directTransfer.connect(spender).transferFrom(owner.address, recipient.address, amount)
            )
                .to.emit(directTransfer, "Transfer")
                .withArgs(owner.address, recipient.address, amount)
                .and.to.emit(directTransfer, "DirectTransferExecuted")
                .withArgs(
                    spender.address, // operator (spender)
                    owner.address, // from
                    recipient.address, // to
                    amount,
                    0, // feeAmount
                    1, // transferKind = DELEGATED_TRANSFER_FROM
                    ethers.ZeroHash // correlationId
                );

            const ownerAfter = await facets.erc20.balanceOf(owner.address);
            const recipientAfter = await facets.erc20.balanceOf(recipient.address);

            expect(ownerAfter).to.equal(ownerBefore - amount);
            expect(recipientAfter).to.equal(recipientBefore + amount);

            // Allowance should be consumed
            const remainingAllowance = await facets.erc20.allowance(owner.address, spender.address);
            expect(remainingAllowance).to.equal(0);
        });

        it("reverts when allowance is insufficient", async function () {
            const owner = signers.user1;
            const spender = signers.user2;
            const recipient = signers.user3;

            // No approval given
            await expect(
                directTransfer.connect(spender).transferFrom(owner.address, recipient.address, AMOUNTS.ONE_TOKEN)
            ).to.be.reverted;
        });

        it("reverts when operator is in wallet recovery quarantine", async function () {
            const owner = signers.user1;
            const spender = signers.user2;
            const recipient = signers.user3;

            await facets.erc20.connect(owner).approve(spender.address, AMOUNTS.ONE_TOKEN);

            // Grant CUSTODIAN_ROLE to spender so they can be put in recovery
            await grantRole(facets.accessControl, ROLES.CUSTODIAN_ROLE, spender.address, signers.owner);
            // Initiate recovery for spender (operator)
            await facets.walletRecovery.connect(signers.admin).initiateRecovery(spender.address, 0);

            await expect(
                directTransfer.connect(spender).transferFrom(owner.address, recipient.address, AMOUNTS.ONE_TOKEN)
            ).to.be.revertedWithCustomError(facets.walletRecovery, "WalletInRecovery");
        });
    });

    describe("Rules Engine Integration", function () {
        it("allows transfer under normal conditions (rules engine returns ALLOW)", async function () {
            // Default rules engine config should allow transfers
            await expect(
                directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.ONE_TOKEN)
            ).to.not.be.reverted;
        });

        it("reverts with 'Rules: denied by policy' when rules engine returns DENY", async function () {
            if (!facets.rulesConfig || !facets.rulesEngine) {
                console.log("Rules engine facets not available, skipping DENY test");
                this.skip();
            }

            // Configure rules to deny non-KYC senders
            const scopeNetwork = await facets.rulesConfig.scopeKeyForNetwork();
            const RuleSet = {
                enabledBits: 0,
                warnThreshold: 400,
                blockThreshold: 800,
                velocityWindowSecs: 0,
                maxAmount: 0,
                maxOutflowAmount: 0,
                maxPerRecipientDaily: 0,
                maxEvalCount: 10,
                restrictContracts: false,
                extendCommitOnWarn: false,
                warnExtendSeconds: 0,
                requireKyc: true,
                kycAmountThreshold: 0,
                kycSoonSeconds: 0,
                createdAt: 0,
                effectiveFrom: 0
            };

            // Enable enforcement mode (not observation mode) so DENY actions block transfers.
            // T3TokenDirectTransferFacet always enforces rules engine DENY results;
            // observation mode is a telemetry flag for the engine, not an enforcement bypass.
            await facets.rulesConfig.connect(signers.owner).setObservationMode(false, 400, 800);
            await facets.rulesConfig.connect(signers.owner).setRuleSet(scopeNetwork, RuleSet);
            await facets.rulesConfig.connect(signers.owner).setRuleWeight(scopeNetwork, 10, 900); // RULE_KYC_SENDER_MISSING

            await expect(
                directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.ONE_TOKEN)
            ).to.be.revertedWith("Rules: denied by policy");
        });
    });

    describe("Facet Interface Verification", function () {
        it("does not expose transferWithLock on the new facet", async function () {
            // The facet contract itself should not have transferWithLock
            const abi = deployment.directTransferFacet.interface;
            const hasTransferWithLock = abi.fragments.some(f => f.name === "transferWithLock");
            expect(hasTransferWithLock).to.be.false;
        });

        it("standard ERC-20 selectors are owned by the new facet after replacement", async function () {
            const diamondLoupe = await ethers.getContractAt("DiamondLoupeFacet", deployment.diamondAddress);
            const transferSig = "transfer(address,uint256)";
            const transferFromSig = "transferFrom(address,address,uint256)";
            const transferSelector = deployment.directTransferFacet.interface.getFunction(transferSig).selector;
            const transferFromSelector = deployment.directTransferFacet.interface.getFunction(transferFromSig).selector;

            const transferOwner = await diamondLoupe.facetAddress(transferSelector);
            const transferFromOwner = await diamondLoupe.facetAddress(transferFromSelector);

            expect(transferOwner).to.equal(await deployment.directTransferFacet.getAddress());
            expect(transferFromOwner).to.equal(await deployment.directTransferFacet.getAddress());
        });
    });

    describe("Obs-4 / E2 — DIRECT_TRANSFER_ROLE gate", function () {
        it("transfer reverts UnauthorizedRole when the sender lacks DIRECT_TRANSFER_ROLE", async function () {
            const { accessControl } = facets;
            await accessControl.connect(signers.owner)
                .revokeRole(ROLES.DIRECT_TRANSFER_ROLE, signers.user1.address);

            await expect(
                directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.TEN_TOKENS)
            ).to.be.revertedWithCustomError(directTransfer, "UnauthorizedRole")
                .withArgs(signers.user1.address, ROLES.DIRECT_TRANSFER_ROLE);
        });

        it("transferFrom reverts when the spender lacks the role, even with allowance", async function () {
            const { accessControl } = facets;
            await facets.erc20.connect(signers.user1)
                .approve(signers.user3.address, AMOUNTS.TEN_TOKENS);
            await accessControl.connect(signers.owner)
                .revokeRole(ROLES.DIRECT_TRANSFER_ROLE, signers.user3.address);

            await expect(
                directTransfer.connect(signers.user3)
                    .transferFrom(signers.user1.address, signers.user2.address, AMOUNTS.TEN_TOKENS)
            ).to.be.revertedWithCustomError(directTransfer, "UnauthorizedRole")
                .withArgs(signers.user3.address, ROLES.DIRECT_TRANSFER_ROLE);
        });

        it("transferFrom reverts when the debited wallet lacks the role (customer-allowance drain is closed)", async function () {
            const { accessControl } = facets;
            // user1 plays a customer wallet: it approves a role-holding spender
            // but does not itself hold DIRECT_TRANSFER_ROLE.
            await facets.erc20.connect(signers.user1)
                .approve(signers.user3.address, AMOUNTS.TEN_TOKENS);
            await accessControl.connect(signers.owner)
                .revokeRole(ROLES.DIRECT_TRANSFER_ROLE, signers.user1.address);

            await expect(
                directTransfer.connect(signers.user3)
                    .transferFrom(signers.user1.address, signers.user2.address, AMOUNTS.TEN_TOKENS)
            ).to.be.revertedWithCustomError(directTransfer, "UnauthorizedRole")
                .withArgs(signers.user1.address, ROLES.DIRECT_TRANSFER_ROLE);
        });

        it("forwarder path: the gate applies to the resolved sender, not the relayer (kimi LOW)", async function () {
            const { accessControl } = facets;
            const erc2771 = await ethers.getContractAt("ERC2771ContextFacet", deployment.diamondAddress);
            await erc2771.connect(signers.owner).setTrustedForwarder(signers.user3.address);

            // ERC-2771: original sender is appended as the last 20 bytes of calldata
            const calldata = directTransfer.interface.encodeFunctionData(
                "transfer", [signers.user2.address, AMOUNTS.TEN_TOKENS]
            ) + signers.user1.address.slice(2).toLowerCase();

            // (a) role-holding resolved sender succeeds through the forwarder
            await expect(
                signers.user3.sendTransaction({ to: deployment.diamondAddress, data: calldata })
            ).to.emit(directTransfer, "Transfer")
                .withArgs(signers.user1.address, signers.user2.address, AMOUNTS.TEN_TOKENS);

            // (b) revoking the RESOLVED sender's role blocks the forwarded call,
            // even though the relayer (user3) still holds the role itself
            await accessControl.connect(signers.owner)
                .revokeRole(ROLES.DIRECT_TRANSFER_ROLE, signers.user1.address);
            await expect(
                signers.user3.sendTransaction({ to: deployment.diamondAddress, data: calldata })
            ).to.be.revertedWithCustomError(directTransfer, "UnauthorizedRole")
                .withArgs(signers.user1.address, ROLES.DIRECT_TRANSFER_ROLE);
        });

        it("transfer succeeds again after the role is re-granted", async function () {
            const { accessControl } = facets;
            await accessControl.connect(signers.owner)
                .revokeRole(ROLES.DIRECT_TRANSFER_ROLE, signers.user1.address);
            await expect(
                directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.TEN_TOKENS)
            ).to.be.revertedWithCustomError(directTransfer, "UnauthorizedRole");

            await accessControl.connect(signers.owner)
                .grantRole(ROLES.DIRECT_TRANSFER_ROLE, signers.user1.address);
            await expect(
                directTransfer.connect(signers.user1).transfer(signers.user2.address, AMOUNTS.TEN_TOKENS)
            ).to.emit(directTransfer, "Transfer");
        });
    });
});
