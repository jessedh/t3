const { ethers } = require("hardhat");

const EXPECTED_ANCHORS = [
    "t3.storage.claim-attribution.v1",
    "t3.storage.issuance-capacity.v1",
    "t3.storage.issuance-sponsorship.v1",
    "t3.storage.reserve-control.v1",
    "t3.storage.settlement-cycle.v1",
    "t3.storage.institution-lifecycle.v1",
];

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
];

async function verifyBankingStorageSlots() {
    const HarnessFactory = await ethers.getContractFactory("BankingStorageHarness");
    const harness = await HarnessFactory.deploy();
    await harness.waitForDeployment();

    const slots = await harness.getBankingStorageSlots();
    const slotHex = slots.map((s) => s);
    const expected = EXPECTED_ANCHORS.map((a) => ethers.id(a));

    const errors = [];

    for (let i = 0; i < expected.length; i++) {
        if (slotHex[i] !== expected[i]) {
            errors.push(`slot ${i} mismatch: expected ${expected[i]}, got ${slotHex[i]}`);
        }
    }

    if (new Set(slotHex).size !== slotHex.length) {
        errors.push("new slots are not unique among themselves");
    }

    const existingHashes = EXISTING_ANCHORS.map((a) => ethers.id(a));
    const all = [...slotHex, ...existingHashes];
    if (new Set(all).size !== all.length) {
        errors.push("new slots overlap with existing anchors");
    }

    return { ok: errors.length === 0, errors, slots: slotHex, expected };
}

async function main() {
    const { ok, errors } = await verifyBankingStorageSlots();

    if (!ok) {
        for (const err of errors) {
            console.error(`FAIL: ${err}`);
        }
        process.exit(1);
    }

    console.log("PASS: all 6 banking storage slots verified");
    process.exit(0);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { main, verifyBankingStorageSlots, EXPECTED_ANCHORS, EXISTING_ANCHORS };
