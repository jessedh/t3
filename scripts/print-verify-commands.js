#!/usr/bin/env node
const { ethers } = require('hardhat');

async function main() {
  const diamond = process.env.DIAMOND_ADDRESS || process.env.ALLOWED_TO;
  if (!diamond) throw new Error('Set DIAMOND_ADDRESS');
  const loupe = await ethers.getContractAt('DiamondLoupeFacet', diamond);
  const facets = await loupe.facets();
  console.log(`# Facets on ${diamond}`);
  for (const f of facets) {
    console.log(`npx hardhat verify --network besu-local ${f.facetAddress}   # selectors=${f.functionSelectors.length} (edit ContractName if needed)`);
  }
  console.log('\n# Example specific facets to verify:');
  console.log('# npx hardhat verify --network besu-local <RulesEngineFacet_address>');
  console.log('# npx hardhat verify --network besu-local <RulesConfigFacet_address>');
}

main().catch((e)=>{ console.error(e); process.exit(1); });

