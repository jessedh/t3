const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture, FacetCutAction } = require("../helpers/deployment");
const { setupTestRoles, ROLES, grantRole } = require("../helpers/roles");

/**
 * C-F2 regression (2026-07-04 crossfacet remediation, Task 1.1):
 *
 * Cambio notes escrow under CAMBIO_NOTE_DOMAIN (CambioEnvelopeFacet.createCambioNote),
 * but WalletRecoveryFacet.resolveCambioNotesBulk actions 1/2 released the remaining
 * escrow under ENVELOPE_DOMAIN. With claim attribution initialized, the escrow record
 * keyed (ENVELOPE_DOMAIN, noteId) does not exist, so ClaimAttributionLib._debitEscrow
 * reverted EscrowNotActive — stranding every escrowed Cambio note in a recovery.
 * (Pre-attribution the release silently skipped attribution, corrupting the subledger.)
 *
 * Red on pre-fix code: resolveCambioNotesBulk reverts EscrowNotActive.
 * Green on fixed code: release succeeds under CAMBIO_NOTE_DOMAIN and the
 * claim-attribution subledger conserves.
 */
describe("Security: recovery Cambio-note release uses CAMBIO_NOTE_DOMAIN (C-F2)", function () {
    const supply = ethers.parseEther("1000");
    const noteAmount = ethers.parseEther("10");

    async function fixture() {
        const deployment = await deployT3DiamondFixture();
        const { diamondAddress, facets, signers } = deployment;
        await setupTestRoles(facets, signers);
        const { owner, admin, minter, custodian1, user1 } = signers;

        // Attach the issuance-accounting harness and initialize claim attribution
        // BEFORE any supply exists (initializeClaimAttribution guard).
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
        await facets.diamondCut.connect(owner).diamondCut(
            [{ facetAddress: await harness.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors }],
            ethers.ZeroAddress,
            "0x"
        );
        const harnessAtDiamond = await ethers.getContractAt("IssuanceAccountingHarness", diamondAddress);
        await harnessAtDiamond.initialize();

        // user1 holds attributed supply (issuer = minter).
        await harnessAtDiamond.mintAttributed(minter.address, user1.address, supply);

        // Cambio setup: user1 is a registered issuer; phase + config armed.
        await grantRole(facets.accessControl, ROLES.CAMBIO_ADMIN_ROLE, admin.address, owner);
        await grantRole(facets.accessControl, ROLES.CAMBIO_ISSUER_ROLE, user1.address, owner);
        await facets.cambioIssuer.connect(admin).registerIssuer(user1.address);
        await facets.cambioEnvelope.connect(admin).advanceCambioPhase();
        await facets.cambioAdmin.connect(admin).setCambioEnvelopeConfig(
            ethers.parseEther("1000"), 3600, 86400, 2048, ethers.parseEther("1000"), 7200, false
        );

        // user1 escrows a Cambio note (escrow recorded under CAMBIO_NOTE_DOMAIN).
        const latest = await ethers.provider.getBlock("latest");
        const phraseCommitment = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
                ["string", "bytes32"],
                ["phrase", ethers.hexlify(ethers.randomBytes(32))]
            )
        );
        const txNote = await facets.cambioEnvelope.connect(user1).createCambioNote(
            noteAmount, phraseCommitment, ethers.hexlify(ethers.randomBytes(32)), latest.timestamp + 86400, "meta"
        );
        const receiptNote = await txNote.wait();
        const noteEvent = receiptNote.logs.find(
            (l) => l.fragment && l.fragment.name === "CambioEnvelopeNoteCreated"
        );
        const noteId = noteEvent.args.noteId;

        // Recovery on user1 (the note issuer): register as custodied wallet, initiate,
        // designate custodian1 as successor.
        const futureExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
        await facets.custodian.connect(owner).grantCustodianRole(user1.address);
        await facets.custodian.connect(user1).registerCustodiedWallet(user1.address, 1, futureExpiry);
        await facets.custodian.connect(owner).grantCustodianRole(custodian1.address);
        await facets.custodian.connect(custodian1).registerCustodiedWallet(custodian1.address, 1, futureExpiry);

        const txRec = await facets.walletRecovery.connect(admin).initiateRecovery(user1.address, 0);
        const receiptRec = await txRec.wait();
        const recLog = receiptRec.logs.find((l) => {
            try { return facets.walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
        });
        const recoveryId = facets.walletRecovery.interface.parseLog(recLog).args.recoveryId;
        await facets.walletRecovery.connect(admin).designateSuccessor(recoveryId, custodian1.address);

        return { facets, signers, harnessAtDiamond, diamondAddress, noteId, recoveryId };
    }

    it("resolveCambioNotesBulk action 1 releases escrow and conserves attribution", async function () {
        const { facets, signers, harnessAtDiamond, diamondAddress, noteId, recoveryId } =
            await loadFixture(fixture);
        const { admin, minter, user1, custodian1 } = signers;

        // Note escrow moved user1's claims into the diamond wallet bucket.
        expect(await harnessAtDiamond.getWalletClaimAmount(user1.address, minter.address))
            .to.equal(supply - noteAmount);
        expect(await harnessAtDiamond.getWalletClaimAmount(diamondAddress, minter.address))
            .to.equal(noteAmount);

        // Pre-fix (ENVELOPE_DOMAIN release) this call reverted EscrowNotActive
        // because no escrow record exists under (ENVELOPE_DOMAIN, noteId).
        await expect(
            facets.walletRecovery.connect(admin).resolveCambioNotesBulk(recoveryId, [noteId], [1])
        )
            .to.emit(facets.walletRecovery, "RecoveryCambioNoteResolved")
            .withArgs(recoveryId, noteId, 1, noteAmount, false);

        // Claims and funds go to the resolved recovery payee: designateSuccessor sets
        // recoverySuccessor[oldWallet] immediately, so the payee is custodian1.
        // Diamond escrow bucket drained; attribution totals conserved.
        expect(await harnessAtDiamond.getWalletClaimAmount(custodian1.address, minter.address))
            .to.equal(noteAmount);
        expect(await harnessAtDiamond.getWalletClaimAmount(user1.address, minter.address))
            .to.equal(supply - noteAmount);
        expect(await harnessAtDiamond.getWalletClaimAmount(diamondAddress, minter.address))
            .to.equal(0);
        expect(await harnessAtDiamond.totalAttributedOutstanding()).to.equal(supply);
        expect(await facets.erc20.totalSupply()).to.equal(supply);
        expect(await facets.erc20.balanceOf(custodian1.address)).to.equal(noteAmount);
        expect(await facets.erc20.balanceOf(user1.address)).to.equal(supply - noteAmount);

        const noteAfter = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
        expect(noteAfter.active).to.be.false;
    });
});
