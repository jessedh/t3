const { expect } = require("chai");
const {
    verifyBankingStorageSlots,
    EXPECTED_ANCHORS,
    EXISTING_ANCHORS,
} = require("../../scripts/lib/verify-banking-storage-slots");

describe("verify-banking-storage-slots helper", function () {
    it("verifies six exact hashes, uniqueness, and disjointness from 15 existing anchors", async function () {
        const result = await verifyBankingStorageSlots();

        expect(result.ok).to.be.true;
        expect(result.errors).to.deep.equal([]);
        expect(result.slots.length).to.equal(6);
        expect(result.expected.length).to.equal(6);
        expect(result.slots).to.deep.equal(result.expected);
    });

    it("uses the six expected anchor strings", function () {
        expect(EXPECTED_ANCHORS.length).to.equal(6);
        expect(EXPECTED_ANCHORS).to.include("t3.storage.claim-attribution.v1");
        expect(EXPECTED_ANCHORS).to.include("t3.storage.issuance-capacity.v1");
        expect(EXPECTED_ANCHORS).to.include("t3.storage.issuance-sponsorship.v1");
        expect(EXPECTED_ANCHORS).to.include("t3.storage.reserve-control.v1");
        expect(EXPECTED_ANCHORS).to.include("t3.storage.settlement-cycle.v1");
        expect(EXPECTED_ANCHORS).to.include("t3.storage.institution-lifecycle.v1");
    });

    it("enumerates the complete 15-anchor existing set", function () {
        expect(EXISTING_ANCHORS.length).to.equal(15);
    });
});
