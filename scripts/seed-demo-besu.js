const hre = require("hardhat");

async function main() {
    const DIAMOND_ADDRESS = process.env.DIAMOND_ADDRESS;
    if (!DIAMOND_ADDRESS) throw new Error("Set DIAMOND_ADDRESS in env");

    const [deployer, , acct2] = await hre.ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("Target (acct2):", acct2.address);
    console.log("Diamond:", DIAMOND_ADDRESS);

    // Minimal ABIs
    const accessControlAbi = [
        "function grantRole(bytes32 role, address account)",
        "function hasRole(bytes32 role, address account) view returns (bool)"
    ];
    const custodianRegistryAbi = [
        "function registerCustodiedWallet(address userAddress, uint256 kycValidatedTimestamp, uint256 kycExpiresTimestamp)"
    ];
    const mintBurnAbi = [
        "function mint(address to, uint256 amount)"
    ];
    const erc20Abi = [
        "function balanceOf(address account) view returns (uint256)"
    ];

    const accessControl = await hre.ethers.getContractAt(accessControlAbi, DIAMOND_ADDRESS);
    const custodianRegistry = await hre.ethers.getContractAt(custodianRegistryAbi, DIAMOND_ADDRESS);
    const mintBurn = await hre.ethers.getContractAt(mintBurnAbi, DIAMOND_ADDRESS);
    const erc20 = await hre.ethers.getContractAt(erc20Abi, DIAMOND_ADDRESS);

    // Role constants
    const CUSTODIAN_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("CUSTODIAN_ROLE"));
    const MINTER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("MINTER_ROLE"));

    console.log("\nCUSTODIAN_ROLE:", CUSTODIAN_ROLE);
    console.log("MINTER_ROLE:", MINTER_ROLE);

    // a. Grant CUSTODIAN_ROLE to acct2 if not already granted
    console.log("\n--- Step A: Check / Grant CUSTODIAN_ROLE ---");
    const hasCustodianRole = await accessControl.hasRole(CUSTODIAN_ROLE, acct2.address);
    console.log("Has CUSTODIAN_ROLE:", hasCustodianRole);
    if (!hasCustodianRole) {
        const tx = await accessControl.connect(deployer).grantRole(CUSTODIAN_ROLE, acct2.address);
        await tx.wait();
        console.log("Granted CUSTODIAN_ROLE. Tx hash:", tx.hash);
    } else {
        console.log("CUSTODIAN_ROLE already held, skipping grant.");
    }

    // b. Register wallet
    console.log("\n--- Step B: Register Wallet ---");
    const kycValidated = Math.floor(Date.now() / 1000) - 86400;
    const kycExpires = Math.floor(Date.now() / 1000) + 365 * 86400;
    console.log("kycValidated:", kycValidated, "kycExpires:", kycExpires);
    // registerCustodiedWallet requires CUSTODIAN_ROLE on msg.sender — call from acct2
    try {
        const tx = await custodianRegistry.connect(acct2).registerCustodiedWallet(acct2.address, kycValidated, kycExpires);
        await tx.wait();
        console.log("Wallet registered. Tx hash:", tx.hash);
    } catch (err) {
        console.log("registerCustodiedWallet reverted (likely already registered):", err.message.split("\n")[0]);
    }

    // LOCAL DEV ONLY: unlock legacy mint path so seeding can use generic mint().
    const issuanceControl = await hre.ethers.getContractAt("IssuanceControlFacet", DIAMOND_ADDRESS);
    await issuanceControl.connect(deployer).setLegacyMintUnlocked(true);

    // c. Mint 10,000 T3USD to acct2
    console.log("\n--- Step C: Mint T3USD ---");
    const mintAmount = hre.ethers.parseUnits("10000", 18);
    console.log("Mint amount:", mintAmount.toString());
    const mintTx = await mintBurn.connect(deployer).mint(acct2.address, mintAmount);
    await mintTx.wait();
    console.log("Mint complete. Tx hash:", mintTx.hash);

    // d. Read back balance
    console.log("\n--- Step D: Verify Balance ---");
    const balance = await erc20.balanceOf(acct2.address);
    console.log("Final balance of acct2:", hre.ethers.formatUnits(balance, 18), "T3USD");

    console.log("\n✅ Seed complete.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
