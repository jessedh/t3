const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BankingRoleConstants", function () {
    let harness;

    // Ordered list of all 33 total role constants (DEFAULT_ADMIN_ROLE is the zero hash)
    const ROLE_NAMES = [
        "DEFAULT_ADMIN_ROLE",
        "ADMIN_ROLE",
        "MINTER_ROLE",
        "BURNER_ROLE",
        "PAUSER_ROLE",
        "CUSTODIAN_ROLE",
        "VALIDATOR_ROLE",
        "CONSORTIUM_MEMBER_ROLE",
        "BANK_REPRESENTATIVE_ROLE",
        "EMERGENCY_COORDINATOR_ROLE",
        "ORACLE_ATTESTOR_ROLE",
        "CONSORTIUM_AUDITOR_ROLE",
        "DEPOSIT_TOKEN_ISSUER_ROLE",
        "SPONSOR_BANK_ADMIN_ROLE",
        "SPONSOR_BANK_OPERATOR_ROLE",
        "REVENUE_MANAGER_ROLE",
        "INVESTMENT_MANAGER_ROLE",
        "PROPERTY_MANAGER_ROLE",
        "COMPLIANCE_OFFICER_ROLE",
        "ORACLE_ROLE",
        "EMERGENCY_ROLE",
        "CAMBIO_ADMIN_ROLE",
        "CAMBIO_ISSUER_ROLE",
        "CAMBIO_REDEEMER_ROLE",
        "COMPLIANCE_ROLE",
        "FEE_EXEMPT_ROLE",
        "INSTITUTION_ADMIN_ROLE",
        // Wave 1 Task 1.3 additions
        "ISSUER_OPERATOR_ROLE",
        "SETTLEMENT_KEEPER_ROLE",
        "SETTLEMENT_ATTESTOR_ROLE",
        "RISK_ADMIN_ROLE",
        "LIFECYCLE_ADMIN_ROLE",
        "EMERGENCY_SETTLEMENT_ROLE",
    ];

    before(async function () {
        const Harness = await ethers.getContractFactory("BankingRoleConstantsHarness");
        harness = await Harness.deploy();
        await harness.waitForDeployment();
    });

    it("all 33 total role constants are unique", async function () {
        const hashes = [];
        for (const name of ROLE_NAMES) {
            const hash = await harness[name]();
            hashes.push(hash);
        }
        const unique = new Set(hashes);
        expect(unique.size).to.equal(
            ROLE_NAMES.length,
            `Expected ${ROLE_NAMES.length} unique roles, found ${unique.size}`
        );
    });

    it("exactly 32 role hashes are non-zero", async function () {
        let nonZeroCount = 0;
        for (const name of ROLE_NAMES) {
            const hash = await harness[name]();
            if (hash !== ethers.ZeroHash) {
                nonZeroCount++;
            }
        }
        expect(nonZeroCount).to.equal(
            32,
            `Expected 32 non-zero role hashes, found ${nonZeroCount}`
        );
    });

    it("each Solidity role matches its JS keccak256 hash", async function () {
        for (const name of ROLE_NAMES) {
            const solHash = await harness[name]();
            const jsHash = name === "DEFAULT_ADMIN_ROLE"
                ? "0x0000000000000000000000000000000000000000000000000000000000000000"
                : ethers.keccak256(ethers.toUtf8Bytes(name));
            expect(solHash).to.equal(
                jsHash,
                `Hash mismatch for ${name}: Solidity=${solHash}, JS=${jsHash}`
            );
        }
    });

    it("contains the six Wave 1 banking control roles", async function () {
        const wave1Roles = [
            "ISSUER_OPERATOR_ROLE",
            "SETTLEMENT_KEEPER_ROLE",
            "SETTLEMENT_ATTESTOR_ROLE",
            "RISK_ADMIN_ROLE",
            "LIFECYCLE_ADMIN_ROLE",
            "EMERGENCY_SETTLEMENT_ROLE",
        ];
        for (const name of wave1Roles) {
            const hash = await harness[name]();
            expect(hash).to.not.equal(ethers.ZeroHash, `${name} must not be zero`);
        }
    });

    it("does not duplicate any pre-Wave-1 role hash", async function () {
        // 27 pre-Wave-1 constants including DEFAULT_ADMIN_ROLE (26 non-zero)
        const preWave1Names = ROLE_NAMES.filter(
            n => !["ISSUER_OPERATOR_ROLE", "SETTLEMENT_KEEPER_ROLE",
                   "SETTLEMENT_ATTESTOR_ROLE", "RISK_ADMIN_ROLE",
                   "LIFECYCLE_ADMIN_ROLE", "EMERGENCY_SETTLEMENT_ROLE"].includes(n)
        );
        const preWave1Hashes = new Set();
        for (const name of preWave1Names) {
            preWave1Hashes.add(await harness[name]());
        }

        const wave1Names = [
            "ISSUER_OPERATOR_ROLE",
            "SETTLEMENT_KEEPER_ROLE",
            "SETTLEMENT_ATTESTOR_ROLE",
            "RISK_ADMIN_ROLE",
            "LIFECYCLE_ADMIN_ROLE",
            "EMERGENCY_SETTLEMENT_ROLE",
        ];
        for (const name of wave1Names) {
            const hash = await harness[name]();
            expect(preWave1Hashes.has(hash)).to.equal(
                false,
                `${name} collides with a pre-Wave-1 role hash`
            );
        }
    });
});
