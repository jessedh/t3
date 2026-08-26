const { ethers } = require("hardhat");

/**
 * Token utilities for testing
 */

/**
 * Mint tokens to specified addresses
 * @param {Contract} diamond - Diamond contract or T3TokenMintBurnFacet
 * @param {Array|Object} recipients - Array of objects with {address, amount} OR object with {address: amount}
 * @param {Signer} minter - Signer with MINTER_ROLE (optional if diamond contract is passed)
 */
async function mintTokens(diamond, recipients, minter) {
    console.log("\n🪙 Minting test tokens...");
    
    // Get the mint facet
    let mintBurnFacet;
    let mintSigner;
    
    if (typeof diamond.getAddress === 'function') {
        // Diamond contract passed - get facet interface
        const diamondAddress = await diamond.getAddress();
        mintBurnFacet = await ethers.getContractAt("T3TokenMintBurnFacet", diamondAddress);
        
        // Use first signer with MINTER_ROLE as default
        if (!minter) {
            const [, admin] = await ethers.getSigners();
            mintSigner = admin; // Admin typically has MINTER_ROLE
        } else {
            mintSigner = minter;
        }
    } else {
        // Facet contract passed directly
        mintBurnFacet = diamond;
        mintSigner = minter;
    }
    
    // Handle different recipient formats
    let recipientList;
    if (Array.isArray(recipients)) {
        // Array format: [{address, amount}, ...]
        recipientList = recipients;
    } else {
        // Object format: {address1: amount1, address2: amount2, ...}
        recipientList = Object.entries(recipients).map(([address, amount]) => ({
            address,
            amount
        }));
    }
    
    for (const recipient of recipientList) {
        const amount = typeof recipient.amount === 'string' 
            ? ethers.parseEther(recipient.amount)
            : recipient.amount;
            
        const tx = await mintBurnFacet.connect(mintSigner).mint(recipient.address, amount);
        await tx.wait();
        
        console.log(`  ✅ Minted ${ethers.formatEther(amount)} tokens to ${recipient.address}`);
    }
}

/**
 * Setup standard test token balances
 * @param {Object} facets - Facet contracts object
 * @param {Object} signers - Signers object
 */
async function setupTestBalances(facets, signers) {
    const { mintBurn } = facets;
    const { minter, user1, user2, user3, admin, custodian1, custodian2 } = signers;
    
    const testBalances = [
        { address: user1.address, amount: "1000" },
        { address: user2.address, amount: "500" },
        { address: user3.address, amount: "250" },
        { address: admin.address, amount: "10000" },
        { address: custodian1.address, amount: "2000000" }, // 2M for settlement tests  
        { address: custodian2.address, amount: "200000" }  // 200K for settlement tests
    ];
    
    await mintTokens(mintBurn, testBalances, minter);
    console.log("✅ Test balances configured");
}

/**
 * Get token balance for an address
 * @param {Contract} erc20Facet - ERC20BaseFacet attached to diamond
 * @param {string} address - Address to check balance for
 * @returns {BigInt} Token balance
 */
async function getBalance(erc20Facet, address) {
    return await erc20Facet.balanceOf(address);
}

/**
 * Get formatted balance (in ether units)
 * @param {Contract} erc20Facet - ERC20BaseFacet attached to diamond
 * @param {string} address - Address to check balance for
 * @returns {string} Formatted balance
 */
async function getFormattedBalance(erc20Facet, address) {
    const balance = await getBalance(erc20Facet, address);
    return ethers.formatEther(balance);
}

/**
 * Transfer tokens between addresses
 * @param {Contract} transferFacet - T3TokenDirectTransferFacet attached to diamond
 * @param {string} to - Recipient address
 * @param {BigInt|string} amount - Amount to transfer (BigInt or ether string)
 * @param {Signer} from - Sender signer
 */
async function transferTokens(transferFacet, to, amount, from) {
    const transferAmount = typeof amount === 'string' 
        ? ethers.parseEther(amount)
        : amount;
        
    const tx = await transferFacet.connect(from).transfer(to, transferAmount);
    await tx.wait();
    
    console.log(`✅ Transferred ${ethers.formatEther(transferAmount)} tokens from ${from.address} to ${to}`);
}

/**
 * Approve token spending
 * @param {Contract} erc20Facet - ERC20BaseFacet attached to diamond
 * @param {string} spender - Spender address
 * @param {BigInt|string} amount - Amount to approve
 * @param {Signer} owner - Token owner signer
 */
async function approveTokens(erc20Facet, spender, amount, owner) {
    const approveAmount = typeof amount === 'string'
        ? ethers.parseEther(amount)
        : amount;
        
    const tx = await erc20Facet.connect(owner).approve(spender, approveAmount);
    await tx.wait();
    
    console.log(`✅ Approved ${ethers.formatEther(approveAmount)} tokens for ${spender}`);
}

/**
 * Get allowance between owner and spender
 * @param {Contract} erc20Facet - ERC20BaseFacet attached to diamond
 * @param {string} owner - Token owner address
 * @param {string} spender - Spender address
 * @returns {BigInt} Allowance amount
 */
async function getAllowance(erc20Facet, owner, spender) {
    return await erc20Facet.allowance(owner, spender);
}

/**
 * Burn tokens from an address
 * @param {Contract} mintBurnFacet - T3TokenMintBurnFacet attached to diamond
 * @param {string} from - Address to burn from
 * @param {BigInt|string} amount - Amount to burn
 * @param {Signer} burner - Signer with burn permissions
 */
async function burnTokens(mintBurnFacet, from, amount, burner) {
    const burnAmount = typeof amount === 'string'
        ? ethers.parseEther(amount)
        : amount;
        
    const tx = await mintBurnFacet.connect(burner).burnFrom(from, burnAmount);
    await tx.wait();
    
    console.log(`✅ Burned ${ethers.formatEther(burnAmount)} tokens from ${from}`);
}

/**
 * Check token metadata
 * @param {Contract} erc20Facet - ERC20BaseFacet attached to diamond
 * @returns {Object} Token metadata {name, symbol, decimals, totalSupply}
 */
async function getTokenMetadata(erc20Facet) {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
        erc20Facet.name(),
        erc20Facet.symbol(),
        erc20Facet.decimals(),
        erc20Facet.totalSupply()
    ]);
    
    return {
        name,
        symbol,
        decimals,
        totalSupply,
        formattedTotalSupply: ethers.formatEther(totalSupply)
    };
}

/**
 * Wait for transaction and verify balance change
 * @param {Contract} erc20Facet - ERC20BaseFacet attached to diamond
 * @param {string} address - Address to monitor
 * @param {BigInt} expectedChange - Expected balance change (positive or negative)
 * @param {Function} txFunction - Function that returns a transaction promise
 */
async function expectBalanceChange(erc20Facet, address, expectedChange, txFunction) {
    const balanceBefore = await getBalance(erc20Facet, address);
    await txFunction();
    const balanceAfter = await getBalance(erc20Facet, address);
    
    const actualChange = balanceAfter - balanceBefore;
    
    if (actualChange !== expectedChange) {
        throw new Error(
            `Balance change mismatch for ${address}: expected ${expectedChange}, got ${actualChange}`
        );
    }
    
    console.log(`✅ Verified balance change of ${ethers.formatEther(actualChange)} for ${address}`);
}

module.exports = {
    mintTokens,
    setupTestBalances,
    getBalance,
    getFormattedBalance,
    transferTokens,
    approveTokens,
    getAllowance,
    burnTokens,
    getTokenMetadata,
    expectBalanceChange
};