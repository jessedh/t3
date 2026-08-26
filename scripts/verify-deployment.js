const { ethers } = require("hardhat");
const fs = require('fs');
const path = require('path');
const { getBesuLocalRpcUrl } = require("./lib/env");

async function main() {
    console.log("🔍 T3Token Deployment Verification");
    console.log("=" .repeat(50));

    const [deployer] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();
    
    console.log(`Network: ${network.name} (${network.chainId})`);
    console.log(`Deployer: ${await deployer.getAddress()}`);
    console.log("");

    // Load deployment data
    const deploymentsDir = path.join(__dirname, '..', 'deployments');
    if (!fs.existsSync(deploymentsDir)) {
        console.log("❌ No deployments found. Run scripts/deploy-diamond-complete.js first.");
        return;
    }

    const deploymentFiles = fs.readdirSync(deploymentsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse(); // Latest first

    if (deploymentFiles.length === 0) {
        console.log("❌ No deployments found.");
        return;
    }

    const latestDeployment = deploymentFiles[0];
    const deploymentData = JSON.parse(
        fs.readFileSync(path.join(deploymentsDir, latestDeployment), 'utf8')
    );

    console.log(`📋 Latest Deployment: ${latestDeployment}`);
    console.log(`⏰ Deployed: ${deploymentData.timestamp}`);
    console.log("");

    const diamondAddress = deploymentData.contracts.Diamond;
    if (!diamondAddress) {
        console.log("❌ Diamond address not found in deployment data.");
        return;
    }

    console.log(`💎 Diamond Address: ${diamondAddress}`);
    console.log("");

    // Verify Core Functionality
    console.log("🔍 Verifying Core Functionality...");
    
    try {
        // ERC20 Basic Info
        const diamondAsERC20 = await ethers.getContractAt("ERC20BaseFacet", diamondAddress);
        const name = await diamondAsERC20.name();
        const symbol = await diamondAsERC20.symbol();
        const totalSupply = await diamondAsERC20.totalSupply();
        const decimals = await diamondAsERC20.decimals();
        
        console.log(`   ✅ Token: ${name} (${symbol})`);
        console.log(`   ✅ Decimals: ${decimals}`);
        console.log(`   ✅ Total Supply: ${ethers.formatEther(totalSupply)} tokens`);

        // Balance check
        const deployerBalance = await diamondAsERC20.balanceOf(await deployer.getAddress());
        console.log(`   ✅ Deployer Balance: ${ethers.formatEther(deployerBalance)} tokens`);

    } catch (error) {
        console.log(`   ❌ ERC20 verification failed: ${error.message}`);
    }

    // Verify Admin Functions
    console.log("\n🔍 Verifying Admin Functions...");
    
    try {
        const diamondAsAdmin = await ethers.getContractAt("T3TokenAdminFacet", diamondAddress);
        
        // Check treasury address
        const treasuryAddress = await diamondAsAdmin.treasuryAddress();
        console.log(`   ✅ Treasury Address: ${treasuryAddress}`);
        
        // Check half-life settings
        const halfLifeDuration = await diamondAsAdmin.halfLifeDuration();
        console.log(`   ✅ Half-life Duration: ${halfLifeDuration} seconds`);

    } catch (error) {
        console.log(`   ❌ Admin verification failed: ${error.message}`);
    }

    // Verify Access Control
    console.log("\n🔍 Verifying Access Control...");
    
    try {
        const diamondAsAccessControl = await ethers.getContractAt("AccessControlFacet", diamondAddress);
        const deployerAddr = await deployer.getAddress();
        
        const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
        const ADMIN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE"));
        const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
        const CUSTODIAN_ROLE = ethers.keccak256(ethers.toUtf8Bytes("CUSTODIAN_ROLE"));
        
        const hasDefaultAdmin = await diamondAsAccessControl.hasRole(DEFAULT_ADMIN_ROLE, deployerAddr);
        const hasAdmin = await diamondAsAccessControl.hasRole(ADMIN_ROLE, deployerAddr);
        const hasMinter = await diamondAsAccessControl.hasRole(MINTER_ROLE, deployerAddr);
        const hasCustodian = await diamondAsAccessControl.hasRole(CUSTODIAN_ROLE, deployerAddr);
        
        console.log(`   ${hasDefaultAdmin ? '✅' : '❌'} DEFAULT_ADMIN_ROLE`);
        console.log(`   ${hasAdmin ? '✅' : '❌'} ADMIN_ROLE`);
        console.log(`   ${hasMinter ? '✅' : '❌'} MINTER_ROLE`);
        console.log(`   ${hasCustodian ? '✅' : '❌'} CUSTODIAN_ROLE`);

    } catch (error) {
        console.log(`   ❌ Access control verification failed: ${error.message}`);
    }

    // Verify Diamond Pattern
    console.log("\n🔍 Verifying Diamond Pattern...");
    
    try {
        const diamondAsLoupe = await ethers.getContractAt("DiamondLoupeFacet", diamondAddress);
        const facets = await diamondAsLoupe.facets();
        
        console.log(`   ✅ Total Facets: ${facets.length}`);
        
        for (const facet of facets) {
            const facetName = Object.entries(deploymentData.contracts).find(
                ([name, addr]) => addr.toLowerCase() === facet.facetAddress.toLowerCase()
            )?.[0] || 'Unknown';
            
            console.log(`      ${facetName}: ${facet.functionSelectors.length} functions`);
        }

    } catch (error) {
        console.log(`   ❌ Diamond pattern verification failed: ${error.message}`);
    }

    // Test a Transfer
    console.log("\n🔍 Testing Transfer Functionality...");
    
    try {
        // Phase 1 cutover: using T3TokenDirectTransferFacet
        const diamondAsTransfer = await ethers.getContractAt("T3TokenDirectTransferFacet", diamondAddress);
        const testRecipient = ethers.Wallet.createRandom().address;
        const transferAmount = ethers.parseEther("100");
        
        // Get initial balance
        const initialBalance = await diamondAsTransfer.balanceOf(await deployer.getAddress());
        
        if (initialBalance >= transferAmount) {
            console.log(`   Testing transfer of ${ethers.formatEther(transferAmount)} tokens...`);
            
            // Estimate gas for transfer
            const gasEstimate = await diamondAsTransfer.transfer.estimateGas(testRecipient, transferAmount);
            console.log(`   ✅ Transfer Gas Estimate: ${gasEstimate.toString()}`);
            
            // Note: We don't actually execute the transfer in verification
            console.log(`   ✅ Transfer functionality verified (gas estimation successful)`);
        } else {
            console.log(`   ⚠️  Insufficient balance for transfer test`);
        }

    } catch (error) {
        console.log(`   ❌ Transfer verification failed: ${error.message}`);
    }

    // Generate Public Demo Info
    console.log("\n📋 Public Demo Information");
    console.log("=" .repeat(50));
    
    const demoInfo = {
        network: network.name || "besu-local",
        chainId: network.chainId.toString(),
        diamond: diamondAddress,
        token: {
            name: deploymentData.verification?.name || "Unknown",
            symbol: deploymentData.verification?.symbol || "Unknown",
            supply: deploymentData.verification ? ethers.formatEther(deploymentData.verification.totalSupply) : "Unknown"
        },
        features: {
            coreToken: "✅ ERC20 direct transfer compatibility",
            diamondLoupe: "✅ Facet inspection compatibility"
        },
        rpcUrl: getBesuLocalRpcUrl()
    };

    console.log(`🌐 Network: ${demoInfo.network}`);
    console.log(`🔗 RPC URL: ${demoInfo.rpcUrl}`);
    console.log(`💎 Diamond: ${demoInfo.diamond}`);
    console.log(`🪙 Token: ${demoInfo.token.name} (${demoInfo.token.symbol})`);
    console.log(`📊 Supply: ${demoInfo.token.supply} tokens`);
    console.log("");
    console.log("🚀 Enhanced Features:");
    for (const [feature, status] of Object.entries(demoInfo.features)) {
        console.log(`   ${status} ${feature}`);
    }

    // Save demo info
    const demoInfoFile = path.join(__dirname, '..', 'demo-info.json');
    fs.writeFileSync(demoInfoFile, JSON.stringify(demoInfo, null, 2));
    console.log(`\n💾 Demo info saved to: demo-info.json`);

    console.log("\n✅ Verification Complete!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("❌ Verification failed:", error);
        process.exit(1);
    });
