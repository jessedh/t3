const hre = require("hardhat");
require("dotenv").config();

async function main() {
    const accounts = await hre.ethers.getSigners();
    const owner = accounts[0];
    const diamondAddress = process.env.DIAMOND_ADDRESS;

    if (!diamondAddress) {
        console.error("DIAMOND_ADDRESS not found in .env");
        process.exit(1);
    }

    console.log(`Configuring rules on Diamond at ${diamondAddress}...`);

    // Interfaces
    const rulesConfigFacet = await hre.ethers.getContractAt(
        "RulesConfigFacet",
        diamondAddress
    );

    // 1. Configure Fee Schedule (Base 1, Surcharge 0.1, Cap 10)
    // Values in Wei
    const baseFee = hre.ethers.parseEther("1");
    const surcharge = hre.ethers.parseEther("0.1");
    const cap = hre.ethers.parseEther("10");

    console.log("Setting fee schedule...");
    let tx = await rulesConfigFacet.setFeeSchedule(baseFee, surcharge, cap);
    await tx.wait();
    console.log("Fee schedule set.");

    // 2. Configure Max Amount Rule (Rule ID 2)
    // We need to set this on the NETWORK scope
    const networkScope = hre.ethers.keccak256(
        hre.ethers.solidityPacked(["string", "bytes32"], ["NETWORK", hre.ethers.ZeroHash])
    );

    // Rule Config Struct from RulesStorageLib
    // struct RuleSet {
    //   uint256 enabledBits;
    //   uint48 velocityWindowSecs;
    //   uint256 maxAmount;
    //   uint256 maxOutflowAmount;
    //   uint256 maxPerRecipientDaily;
    //   uint256 maxEvalCount;
    //   bool restrictContracts;
    //   bool extendCommitOnWarn;
    //   uint48 warnExtendSeconds;
    //   bool requireKyc;
    //   uint256 kycAmountThreshold;
    //   uint48 kycSoonSeconds;
    //   uint48 effectiveFrom;
    // }

    // We'll read the current one and update it
    const currentSet = await rulesConfigFacet.getRuleSet(networkScope);

    console.log("Current rule set loaded.");

    // Enable Rule 2 (Max Amount) bit if not set
    let enabledBits = BigInt(currentSet.enabledBits);
    const RULE_MAX_PER_TX = 2;
    const RULE_MAX_AMOUNT_BIT = 1n << BigInt(RULE_MAX_PER_TX);

    if ((enabledBits & RULE_MAX_AMOUNT_BIT) === 0n) {
        console.log("Enabling Max Per Tx rule bit...");
        enabledBits = enabledBits | RULE_MAX_AMOUNT_BIT;
    }

    // Set Max Amount to 500,000 T3
    const newMaxAmount = hre.ethers.parseEther("500000");

    console.log(`Updating Network RuleSet with maxAmount = 500,000...`);

    // setRuleSet(bytes32 scopeKey, RuleSet memory rules)
    // Note: We need to reconstruct the struct object carefully for Ethers
    const newRuleSet = {
        enabledBits: enabledBits,
        warnThreshold: currentSet.warnThreshold,
        blockThreshold: currentSet.blockThreshold,
        velocityWindowSecs: currentSet.velocityWindowSecs,
        maxAmount: newMaxAmount, // UPDATED
        maxOutflowAmount: currentSet.maxOutflowAmount,
        maxPerRecipientDaily: currentSet.maxPerRecipientDaily,
        maxEvalCount: currentSet.maxEvalCount,
        restrictContracts: currentSet.restrictContracts,
        extendCommitOnWarn: currentSet.extendCommitOnWarn,
        warnExtendSeconds: currentSet.warnExtendSeconds,
        requireKyc: currentSet.requireKyc,
        kycAmountThreshold: currentSet.kycAmountThreshold,
        kycSoonSeconds: currentSet.kycSoonSeconds,
        createdAt: currentSet.createdAt,
        effectiveFrom: currentSet.effectiveFrom
    };

    tx = await rulesConfigFacet.setRuleSet(networkScope, newRuleSet);
    await tx.wait();
    console.log("Network RuleSet updated.");

    console.log("Configuration complete.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
