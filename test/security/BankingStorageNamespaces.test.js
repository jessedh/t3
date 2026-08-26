const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Banking Storage Namespaces", function () {
    let harness;

    beforeEach(async function () {
        const HarnessFactory = await ethers.getContractFactory("BankingStorageHarness");
        harness = await HarnessFactory.deploy();
        await harness.waitForDeployment();
    });

    // Explicitly enumerated complete set of existing namespaced anchors discovered under contracts/lib.
    // Sources:
    //   StorageLib.sol          -> com.t3programmablefiat.diamond.AppStorage.v1.995ced7e2b6e426f836004bd3a63670d
    //   SponsorBankStorage.sol  -> t3token.storage.sponsorbank.v1
    //   InvestmentStorage.sol   -> t3token.storage.investment.v1
    //   RulesStorageLib.sol     -> t3.rules.storage.v1
    //   CambioEnvelopeStorage.sol   -> t3.storage.cambio.envelope.v1
    //   CambioIssuerStorage.sol     -> t3.storage.cambioissuer.v1
    //   ConsortiumStorage.sol       -> t3.storage.consortium.v1
    //   DepositorIdentityStorage.sol-> t3.storage.depositoridentity.v1
    //   EnvelopeStorage.sol         -> t3.storage.envelope.v1
    //   InstitutionStorage.sol      -> t3.storage.institution.v1
    //   IssuanceControlStorage.sol  -> t3.storage.issuancecontrol.v1
    //   RelayerFallbackStorage.sol  -> t3.storage.relayerfallback.v1
    //   SmartLockEnvelopeStorage.sol-> t3.storage.smartlock.envelope.v1
    //   TransferManagementStorage.sol-> t3.storage.transfermgmt.v1
    //   WalletRecoveryStorage.sol   -> t3.storage.wallet.recovery.v1
    const EXISTING_ANCHORS = [
        "com.t3programmablefiat.diamond.AppStorage.v1.995ced7e2b6e426f836004bd3a63670d",
        "t3token.storage.sponsorbank.v1",
        "t3token.storage.investment.v1",
        "t3.rules.storage.v1",
        "t3.storage.cambio.envelope.v1",
        "t3.storage.cambioissuer.v1",
        "t3.storage.consortium.v1",
        "t3.storage.depositoridentity.v1",
        "t3.storage.envelope.v1",
        "t3.storage.institution.v1",
        "t3.storage.issuancecontrol.v1",
        "t3.storage.relayerfallback.v1",
        "t3.storage.smartlock.envelope.v1",
        "t3.storage.transfermgmt.v1",
        "t3.storage.wallet.recovery.v1",
    ].map((a) => ethers.id(a));

    const NEW_ANCHORS = [
        "t3.storage.claim-attribution.v1",
        "t3.storage.issuance-capacity.v1",
        "t3.storage.issuance-sponsorship.v1",
        "t3.storage.reserve-control.v1",
        "t3.storage.settlement-cycle.v1",
        "t3.storage.institution-lifecycle.v1",
    ].map((a) => ethers.id(a));

    it("uses unique banking storage namespaces, disjoint from all existing anchors", async function () {
        const slots = await harness.getBankingStorageSlots();
        const slotHex = slots.map((s) => s);

        // All six returned slots match the expected deterministic anchors.
        expect(slotHex).to.deep.equal(NEW_ANCHORS);

        // New slots are unique among themselves.
        expect(new Set(slotHex).size).to.equal(slotHex.length);

        // New slots are disjoint from every explicitly enumerated existing anchor.
        const all = [...slotHex, ...EXISTING_ANCHORS];
        expect(new Set(all).size).to.equal(all.length);
    });
});
