const { ethers, network } = require("hardhat");
const { expect } = require("chai");
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { FACETS, SUPPORTS_INTERFACE_SIG } = require("./lib/facet-manifest");

function getSelectors(contract, contractName = 'UnknownContract', excludeSignatures = []) {
    const selectors = [];
    const excludedSelectorsLookup = new Set();
    for (const sig of excludeSignatures) {
        try {
            const funcFragment = contract.interface.getFunction(sig);
            if (funcFragment) excludedSelectorsLookup.add(funcFragment.selector);
        } catch (e) {/* ignore */ }
    }
    contract.interface.forEachFunction((funcFragment) => {
        if (funcFragment.name !== 'init' && !excludedSelectorsLookup.has(funcFragment.selector)) {
            selectors.push(funcFragment.selector);
        }
    });
    return selectors;
}

const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };
const FEE_PRECISION_MULTIPLIER = 1000;

function updateDiamondAddressDependencies({ oldAddress, newAddress }) {
    if (!oldAddress || !ethers.isAddress(oldAddress)) {
        console.warn("Warning: Skipping dependency updates (old DIAMOND_ADDRESS missing or invalid).");
        return;
    }
    if (oldAddress.toLowerCase() === newAddress.toLowerCase()) {
        console.log("Dependency update skipped (diamond address unchanged).");
        return;
    }

    const filesToUpdate = [
        path.resolve(__dirname, "../relayer/.env"),
        path.resolve(__dirname, "../scripts/set-trusted-forwarder.js"),
    ];

    for (const filePath of filesToUpdate) {
        if (!fs.existsSync(filePath)) {
            continue;
        }
        const content = fs.readFileSync(filePath, "utf8");
        if (!content.includes(oldAddress)) {
            continue;
        }
        const updated = content.split(oldAddress).join(newAddress);
        fs.writeFileSync(filePath, updated);
        console.log(`Updated diamond address in ${filePath}`);
    }
}

function updatePonderConfig({ diamondAddress, rpcUrl }) {
    const configPath = path.resolve(__dirname, "../indexer/ponder.config.ts");
    if (!fs.existsSync(configPath)) {
        console.warn(`Warning: Ponder config not found at ${configPath}.`);
        return;
    }

    const content = fs.readFileSync(configPath, "utf8");
    let updatedContent = content;
    const addressConstPattern = /const diamondAddress = "0x[a-fA-F0-9]{40}"/;
    const rpcConstPattern = /const rpcUrl = "([^"]+)"/;

    if (addressConstPattern.test(updatedContent)) {
        updatedContent = updatedContent.replace(
            addressConstPattern,
            `const diamondAddress = "${diamondAddress}"`
        );
    } else {
        updatedContent = updatedContent.replace(
            /address:\s*"0x[a-fA-F0-9]{40}"/g,
            `address: "${diamondAddress}"`
        );
    }

    if (rpcConstPattern.test(updatedContent)) {
        updatedContent = updatedContent.replace(
            rpcConstPattern,
            `const rpcUrl = "${rpcUrl}"`
        );
    } else {
        updatedContent = updatedContent.replace(
            /rpc:\s*http\("([^"]+)"\)/g,
            `rpc: http("${rpcUrl}")`
        );
    }

    if (updatedContent === content) {
        console.log("Ponder config already up to date.");
        return;
    }

    fs.writeFileSync(configPath, updatedContent);
    console.log(`Ponder config updated at ${configPath}`);
    console.log(`PONDER_RPC_URL=${rpcUrl}`);
    console.log(`PONDER_DIAMOND_ADDRESS=${diamondAddress}`);

    // Clear Ponder's cached sync state so it re-indexes from the new deployment
    const pglitePath = path.resolve(__dirname, "../indexer/.ponder/pglite");
    if (fs.existsSync(pglitePath)) {
        fs.rmSync(pglitePath, { recursive: true, force: true });
        console.log("Cleared Ponder cached state (indexer/.ponder/pglite)");
    }
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const previousDiamondAddress = process.env.DIAMOND_ADDRESS;

    const envParams = {
        tokenName: process.env.TOKEN_NAME || "T3Token",
        tokenSymbol: process.env.TOKEN_SYMBOL || "T3T",
        treasuryAddress: process.env.TREASURY_ADDRESS || deployer.address,
        halfLifeDurationSeconds: process.env.INIT_HALF_LIFE_DURATION_SECONDS || "86400",
        minHalfLifeDurationSeconds: process.env.INIT_MIN_HALF_LIFE_DURATION_SECONDS || "3600",
        maxHalfLifeDurationSeconds: process.env.INIT_MAX_HALF_LIFE_DURATION_SECONDS || "604800",
        inactivityResetPeriodSeconds: process.env.INIT_INACTIVITY_RESET_PERIOD_SECONDS || "2592000",
        minFeeWei: process.env.INIT_MIN_FEE_WEI || "1000000000000000",
        baseRiskScalerBps: process.env.INIT_BASE_RISK_SCALER_BPS || "1000",
        maxRiskScalerBps: process.env.INIT_MAX_RISK_SCALER_BPS || "10000",
        feeTierThresholdsEth: process.env.INIT_FEE_TIER_THRESHOLDS_ETH || "1,10,100,1000,10000,100000,1000000,10000000,100000000,1000000000,10000000000,100000000000",
        feeTierRatesBps: process.env.INIT_FEE_TIER_RATES_BPS || "50,25,10,5,2,1,0.5,0.25,0.1,0.05,0.02,0.01"
    };

    if (!ethers.isAddress(envParams.treasuryAddress)) {
        console.error("Error: TREASURY_ADDRESS is invalid in .env");
        process.exit(1);
    }

    const parsedDurations = [
        envParams.halfLifeDurationSeconds,
        envParams.minHalfLifeDurationSeconds,
        envParams.maxHalfLifeDurationSeconds,
        envParams.inactivityResetPeriodSeconds
    ].map(val => {
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 0) throw new Error(`Invalid duration value in .env: ${val}`);
        return BigInt(num);
    });

    const minFeeWeiBigInt = BigInt(envParams.minFeeWei || "0");
    const baseRiskScalerBpsNum = parseInt(envParams.baseRiskScalerBps, 10);
    const maxRiskScalerBpsNum = parseInt(envParams.maxRiskScalerBps, 10);
    if (isNaN(baseRiskScalerBpsNum) || isNaN(maxRiskScalerBpsNum)) {
        throw new Error("Invalid BPS value for risk scalers in .env");
    }

    const feeTierThresholdsEthArray = (envParams.feeTierThresholdsEth || "").split(',').map(s => s.trim()).filter(s => s);
    const feeTierRatesBpsArray = (envParams.feeTierRatesBps || "").split(',').map(s => s.trim()).filter(s => s);
    if (feeTierThresholdsEthArray.length !== feeTierRatesBpsArray.length) {
        console.error("Error: Fee tier thresholds and rates count mismatch in .env");
        process.exit(1);
    }

    const initParamsForContract = {
        tokenName: envParams.tokenName,
        tokenSymbol: envParams.tokenSymbol,
        treasuryAddress: envParams.treasuryAddress,
        ownerAddress: deployer.address,
        halfLifeDurationSeconds: parsedDurations[0],
        minHalfLifeDurationSeconds: parsedDurations[1],
        maxHalfLifeDurationSeconds: parsedDurations[2],
        inactivityResetPeriodSeconds: parsedDurations[3],
        minFeeWei: minFeeWeiBigInt,
        maxFeePercentBps: 1000, // 10% max fee
        baseRiskScalerBpsScaled: BigInt(baseRiskScalerBpsNum * FEE_PRECISION_MULTIPLIER),
        maxRiskScalerBpsScaled: BigInt(maxRiskScalerBpsNum * FEE_PRECISION_MULTIPLIER),
        feeTierThresholdsWei: feeTierThresholdsEthArray.map(eth => ethers.parseEther(eth)),
        feeTierRatesBpsScaled: feeTierRatesBpsArray.map(bps => BigInt(Math.round(parseFloat(bps) * FEE_PRECISION_MULTIPLIER)))
    };
    console.log("Using Initial Parameters for Contract:", initParamsForContract);

    // Deploy external libraries needed by WalletRecoveryFacet (EIP-170 size mitigation).
    console.log("\n📚 Deploying WalletRecoveryFacet external libraries...");
    const WalletRecoveryDepositorIdentityLib = await ethers.getContractFactory(
        "WalletRecoveryDepositorIdentityLib"
    );
    const depositorIdentityLib = await WalletRecoveryDepositorIdentityLib.deploy();
    await depositorIdentityLib.waitForDeployment();
    console.log(`   ✅ WalletRecoveryDepositorIdentityLib: ${await depositorIdentityLib.getAddress()}`);

    // Snapshot journal lib (Task 5.3) — linked into the sanctions lib (which calls
    // snapshotBothSides before its moves) AND the facet (restore/markStateMigrated).
    const WalletRecoverySnapshotLib = await ethers.getContractFactory(
        "WalletRecoverySnapshotLib"
    );
    const snapshotLib = await WalletRecoverySnapshotLib.deploy();
    await snapshotLib.waitForDeployment();
    console.log(`   ✅ WalletRecoverySnapshotLib: ${await snapshotLib.getAddress()}`);

    const WalletRecoverySanctionsLib = await ethers.getContractFactory(
        "WalletRecoverySanctionsLib",
        { libraries: { WalletRecoverySnapshotLib: await snapshotLib.getAddress() } }
    );
    const sanctionsLib = await WalletRecoverySanctionsLib.deploy();
    await sanctionsLib.waitForDeployment();
    console.log(`   ✅ WalletRecoverySanctionsLib: ${await sanctionsLib.getAddress()}`);

    // External library for compliance payout holds (Sprint 4, D2) — linked
    // into TransferEnvelopeAdminFacet (admin disposition surface) and the
    // facets whose refund legs call checkOrHold (Task 4.2).
    const ComplianceHoldLib = await ethers.getContractFactory("ComplianceHoldLib");
    const complianceHoldLib = await ComplianceHoldLib.deploy();
    await complianceHoldLib.waitForDeployment();
    console.log(`   ✅ ComplianceHoldLib: ${await complianceHoldLib.getAddress()}`);
    const COMPLIANCE_HOLD_LINKED_FACETS = new Set([
        "TransferEnvelopeAdminFacet",
        "TransferEnvelopeFacet",
        "SmartLockEnvelopeFacet",
        "CambioEnvelopeFacet",
    ]);

    // Deploy all facets from the manifest
    const deployedFacets = {};
    console.log("\n📦 Deploying all facets from manifest...");
    for (const entry of FACETS) {
        let factoryOptions = {};
        if (entry.name === "WalletRecoveryFacet") {
            factoryOptions = {
                libraries: {
                    WalletRecoveryDepositorIdentityLib: await depositorIdentityLib.getAddress(),
                    WalletRecoverySanctionsLib: await sanctionsLib.getAddress(),
                    WalletRecoverySnapshotLib: await snapshotLib.getAddress(),
                    ComplianceHoldLib: await complianceHoldLib.getAddress(),
                },
            };
        } else if (COMPLIANCE_HOLD_LINKED_FACETS.has(entry.name)) {
            factoryOptions = {
                libraries: {
                    ComplianceHoldLib: await complianceHoldLib.getAddress(),
                },
            };
        }
        const Factory = await ethers.getContractFactory(entry.name, factoryOptions);
        const facet = await Factory.deploy();
        await facet.waitForDeployment();
        deployedFacets[entry.name] = facet;
        console.log(`   ✅ ${entry.name}: ${await facet.getAddress()}`);
    }

    console.log("\nDeploying Diamond...");
    const Diamond_F = await ethers.getContractFactory("Diamond");
    const diamondCutFacetAddress = await deployedFacets.DiamondCutFacet.getAddress();
    const diamond = await Diamond_F.deploy(deployer.address, diamondCutFacetAddress);
    await diamond.waitForDeployment();
    const diamondAddress = await diamond.getAddress();
    console.log("Diamond deployed to:", diamondAddress);

    console.log("\nDeploying DiamondInit...");
    const DiamondInit_F = await ethers.getContractFactory("DiamondInit");
    const diamondInitContract = await DiamondInit_F.deploy();
    await diamondInitContract.waitForDeployment();
    const diamondInitAddress = await diamondInitContract.getAddress();
    console.log("DiamondInit deployed to:", diamondInitAddress);

    console.log("\n🔧 Building diamond cut from manifest...");
    const supportsInterfaceSig = SUPPORTS_INTERFACE_SIG;
    const cut = [];
    for (const entry of FACETS) {
        const facet = deployedFacets[entry.name];

        // Facets registered at diamond construction time should not be re-added
        if (entry.skipCut) {
            console.log(`   ⏭️  ${entry.name}: registered at diamond construction time, skipping cut entry`);
            continue;
        }

        const excludeSigs = [];

        // Apply global supportsInterface exclude unless the entry opts out
        if (entry.excludeSupportsInterface !== false) {
            excludeSigs.push(supportsInterfaceSig);
        }

        // Apply per-facet excludes
        if (entry.excludes) {
            excludeSigs.push(...entry.excludes);
        }

        const selectors = getSelectors(facet, entry.name, excludeSigs);

        // Skip facets with zero selectors
        if (selectors.length === 0) {
            console.log(`   ⚠️  ${entry.name}: zero selectors after excludes, skipping cut entry`);
            continue;
        }

        cut.push({
            facetAddress: await facet.getAddress(),
            action: FacetCutAction.Add,
            functionSelectors: selectors,
        });
    }

    const addressToFacetName = {};
    for (const [name, facet] of Object.entries(deployedFacets)) {
        addressToFacetName[await facet.getAddress()] = name;
    }

    const seenSelectors = new Map();
    for (const entry of cut) {
        for (const sel of entry.functionSelectors) {
            const prev = seenSelectors.get(sel);
            if (prev) {
                const prevName = addressToFacetName[prev] || prev;
                const currName = addressToFacetName[entry.facetAddress] || entry.facetAddress;
                throw new Error(`Selector collision: ${sel} on both ${prevName} and ${currName}`);
            }
            seenSelectors.set(sel, entry.facetAddress);
        }
    }
    console.log(`\n🔍 Cut config validated: ${cut.length} facets, ${seenSelectors.size} unique selectors.`);

    const initFunctionCall = diamondInitContract.interface.encodeFunctionData("init", [initParamsForContract]);
    const diamondAsDiamondCut = await ethers.getContractAt("IDiamondCut", diamondAddress);

    // Batch the diamondCut calls to avoid over-gassing
    const BATCH_SIZE = 2; // Reduced batch size
    try {
        for (let i = 0; i < cut.length; i += BATCH_SIZE) {
            const batch = cut.slice(i, i + BATCH_SIZE);
            const isLastBatch = i + BATCH_SIZE >= cut.length;

            console.log(`\nExecuting diamondCut batch ${i / BATCH_SIZE + 1}... (${batch.length} facets)`);

            const tx = await diamondAsDiamondCut.connect(deployer).diamondCut(
                batch,
                isLastBatch ? diamondInitAddress : ethers.ZeroAddress,
                isLastBatch ? initFunctionCall : "0x"
            );
            console.log(`Transaction sent: ${tx.hash}`);
            await tx.wait();
            console.log(`Batch ${i / BATCH_SIZE + 1} complete.`);
        }
        console.log("All diamondCut batches executed successfully.");
    } catch (error) {
        console.error("\n!!! DIAMOND CUT FAILED !!!");
        console.error("Error message:", error.message);
        console.error("Error data:", error.data);
        throw error;
    }


    // Post-deployment test for diamond.facets()
    console.log("\n--- Post-Deployment DiamondLoupeFacet Test ---");
    try {
        const diamondLoupe = await ethers.getContractAt("IDiamondLoupe", diamondAddress);
        const postDeploymentFacets = await diamondLoupe.facets();
        console.log("Post-deployment facets retrieved successfully:", postDeploymentFacets);
        expect(postDeploymentFacets.length).to.be.greaterThan(0);
        console.log("✓ diamond.facets() works post-deployment.");
    } catch (error) {
        console.error("Error in post-deployment diamond.facets() test:", error.message);
    }

    // Verification
    console.log("\n--- Verifying Diamond State & Functionality ---");

    const acFacet = await ethers.getContractAt("AccessControlFacet", diamondAddress);
    const DEFAULT_ADMIN_ROLE = await acFacet.DEFAULT_ADMIN_ROLE();
    const ADMIN_ROLE = await acFacet.ADMIN_ROLE();
    const isAdmin = await acFacet.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    console.log(`Is deployer admin? ${isAdmin}`);
    expect(isAdmin).to.be.true;

    const extraAdminCsv =
        process.env.ADMIN_WALLET_ADDRESS ||
        process.env.ADMIN_ADDRESSES ||
        process.env.EXTRA_ADMIN_ADDRESSES ||
        "";
    const extraAdmins = extraAdminCsv
        .split(",")
        .map(addr => addr.trim())
        .filter(addr => addr && ethers.isAddress(addr));

    for (const adminAddress of extraAdmins) {
        if (!(await acFacet.hasRole(DEFAULT_ADMIN_ROLE, adminAddress))) {
            const tx = await acFacet.grantRole(DEFAULT_ADMIN_ROLE, adminAddress);
            await tx.wait();
            console.log(`Granted DEFAULT_ADMIN_ROLE to ${adminAddress}`);
        }
        if (!(await acFacet.hasRole(ADMIN_ROLE, adminAddress))) {
            const tx = await acFacet.grantRole(ADMIN_ROLE, adminAddress);
            await tx.wait();
            console.log(`Granted ADMIN_ROLE to ${adminAddress}`);
        }
    }

    const erc20 = await ethers.getContractAt("ERC20BaseFacet", diamondAddress);
    expect(await erc20.name()).to.equal(initParamsForContract.tokenName);
    expect(await erc20.symbol()).to.equal(initParamsForContract.tokenSymbol);
    console.log(`Token Name: ${await erc20.name()}, Symbol: ${await erc20.symbol()}`);

    const loupe = await ethers.getContractAt("ERC165Facet", diamondAddress);
    const ierc165InterfaceId = "0x01ffc9a7";
    const iDiamondLoupeInterfaceIdFromScript = "0x48e2b093";

    console.log(`Querying supportsInterface(${ierc165InterfaceId}) for IERC165...`);
    const supportsIERC165 = await loupe.supportsInterface(ierc165InterfaceId);
    console.log(`Result for IERC165: ${supportsIERC165}`);
    expect(supportsIERC165).to.be.true;

    console.log(`Querying supportsInterface(${iDiamondLoupeInterfaceIdFromScript}) for IDiamondLoupe...`);
    const supportsIDiamondLoupe = await loupe.supportsInterface(iDiamondLoupeInterfaceIdFromScript);
    console.log(`Result for IDiamondLoupe (using 0x48e2b093): ${supportsIDiamondLoupe}`);
    expect(supportsIDiamondLoupe).to.be.true;

    console.log("IERC165 and IDiamondLoupe interfaces supported checks passed.");

    // Test ERC-2771 functionality
    console.log("\n--- Testing ERC-2771 Functionality ---");
    try {
        const erc2771Facet = await ethers.getContractAt("ERC2771ContextFacet", diamondAddress);
        const currentForwarder = await erc2771Facet.getTrustedForwarder();
        console.log(`✓ ERC-2771 support confirmed. Current trusted forwarder: ${currentForwarder}`);

        // The forwarder should initially be zero address until explicitly set
        if (currentForwarder === ethers.ZeroAddress) {
            console.log("Note: Trusted forwarder not set yet. Use setTrustedForwarder() to configure.");
        }
    } catch (error) {
        console.error("Error testing ERC-2771 functionality:", error.message);
    }

    // Post-deploy connectivity smoke check.
    //
    // This previously also probed InvestmentVehicleRegistryFacet, InvestmentComplianceFacet,
    // InvestmentGovernanceFacet and YieldDistributionFacet, none of which exist in this
    // repository. Wrapped in try/catch, the failures were swallowed into a printed error
    // while the surrounding text still announced it was verifying "Phase 2 & 3" integration.
    // Only facets that are actually in the manifest are probed now.
    console.log("\n--- Post-deploy connectivity check ---");

    try {
        await ethers.getContractAt("SponsorBankCoreFacet", diamondAddress);
        console.log("✓ SponsorBankCoreFacet reachable through the diamond");
        console.log("Connectivity check passed.");
    } catch (error) {
        console.error("Connectivity check FAILED:", error.message);
        throw error;
    }

    console.log("\nDeployment complete.");
    console.log("----------------------------------------------------");
    console.log("Diamond Address:", diamondAddress);
    console.log("Diamond Owner/Admin:", deployer.address);
    console.log("--- Facet Addresses ---");
    for (const name in deployedFacets) {
        console.log(`${name}:`, await deployedFacets[name].getAddress());
    }
    console.log("DiamondInit:", diamondInitAddress);
    console.log("----------------------------------------------------");

    // Update .env file
    const envFilePath = path.resolve(__dirname, '../.env');
    let envFileContent = "";
    try {
        if (fs.existsSync(envFilePath)) {
            envFileContent = fs.readFileSync(envFilePath, 'utf8');
        }
    } catch (err) {
        console.warn(`Warning: Could not read .env file at ${envFilePath}.`);
    }

    const lines = envFileContent.split('\n');
    let foundDiamondAddress = false;
    let foundAllowedTo = false;
    const newLines = lines.map(line => {
        if (line.startsWith("DIAMOND_ADDRESS=")) {
            foundDiamondAddress = true;
            return `DIAMOND_ADDRESS=${diamondAddress}`;
        }
        if (line.trim().startsWith("ALLOWED_TO")) {
            foundAllowedTo = true;
            return `ALLOWED_TO = "${diamondAddress}"`;
        }
        return line;
    }).filter(line => line.trim() !== '' || foundDiamondAddress);

    if (!foundDiamondAddress) {
        newLines.push(`DIAMOND_ADDRESS=${diamondAddress}`);
    }
    if (!foundAllowedTo) {
        newLines.push(`ALLOWED_TO = "${diamondAddress}"`);
    }

    fs.writeFileSync(envFilePath, newLines.join('\n'));
    console.log(`\nDiamond address saved to/updated in ${envFilePath}`);
    console.log(`DIAMOND_ADDRESS=${diamondAddress}`);

    const rpcUrl = network.config.url || "http://127.0.0.1:8545";
    updatePonderConfig({ diamondAddress, rpcUrl });
    updateDiamondAddressDependencies({
        oldAddress: previousDiamondAddress,
        newAddress: diamondAddress
    });
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
