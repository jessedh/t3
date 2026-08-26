const hre = require("hardhat");
const { readDiamondAddress, readTargetAddress } = require("./lib/resolve-addresses");

async function main() {
  const testWallet = readTargetAddress();
  const diamondAddress = readDiamondAddress();

  if (!testWallet || !hre.ethers.isAddress(testWallet)) {
    throw new Error("Set TARGET_ADDRESS to the wallet that should receive roles.");
  }
  if (!diamondAddress) {
    throw new Error("DIAMOND_ADDRESS not found. Make sure to run deployments first.");
  }

  console.log(`Granting roles to: ${testWallet}`);
  console.log(`Diamond: ${diamondAddress}`);

  // Get Facets
  const AccessControlFacet = await hre.ethers.getContractAt("AccessControlFacet", diamondAddress);
  const MintFacet = await hre.ethers.getContractAt("T3TokenMintBurnFacet", diamondAddress);

  // Role constants (ethers v6 syntax)
  const ADMIN_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("ADMIN_ROLE"));
  const MINTER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("MINTER_ROLE"));
  const CUSTODIAN_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("CUSTODIAN_ROLE"));
  const CAMBIO_ADMIN_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("CAMBIO_ADMIN_ROLE"));
  const CAMBIO_ISSUER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("CAMBIO_ISSUER_ROLE"));
  const REVENUE_MANAGER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("REVENUE_MANAGER_ROLE"));
  const CONSORTIUM_MEMBER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("CONSORTIUM_MEMBER_ROLE"));
  const PAUSER_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("PAUSER_ROLE"));

  console.log("\nGranting comprehensive roles for testing...");

  // Grant all major roles
  await (await AccessControlFacet.grantRole(ADMIN_ROLE, testWallet)).wait();
  console.log("✓ ADMIN_ROLE");

  await (await AccessControlFacet.grantRole(MINTER_ROLE, testWallet)).wait();
  console.log("✓ MINTER_ROLE");

  await (await AccessControlFacet.grantRole(CUSTODIAN_ROLE, testWallet)).wait();
  console.log("✓ CUSTODIAN_ROLE");

  await (await AccessControlFacet.grantRole(CAMBIO_ADMIN_ROLE, testWallet)).wait();
  console.log("✓ CAMBIO_ADMIN_ROLE");

  await (await AccessControlFacet.grantRole(CAMBIO_ISSUER_ROLE, testWallet)).wait();
  console.log("✓ CAMBIO_ISSUER_ROLE");

  await (await AccessControlFacet.grantRole(REVENUE_MANAGER_ROLE, testWallet)).wait();
  console.log("✓ REVENUE_MANAGER_ROLE");

  await (await AccessControlFacet.grantRole(CONSORTIUM_MEMBER_ROLE, testWallet)).wait();
  console.log("✓ CONSORTIUM_MEMBER_ROLE");

  await (await AccessControlFacet.grantRole(PAUSER_ROLE, testWallet)).wait();
  console.log("✓ PAUSER_ROLE");

  console.log("\n=== Role Grant Complete ===");

  // Mint tokens
  console.log("\nMinting test tokens...");
  try {
    const amount = hre.ethers.parseUnits("1000000", 18);
    await (await MintFacet.mint(testWallet, amount)).wait();
    console.log(`✓ Minted 1,000,000 T3USD to ${testWallet}`);
  } catch (error) {
    console.error("Error minting tokens:", error.message);
  }

  // Verify
  console.log("\nVerifying roles:");
  console.log(`Has ADMIN_ROLE: ${await AccessControlFacet.hasRole(ADMIN_ROLE, testWallet)}`);
  console.log(`Has MINTER_ROLE: ${await AccessControlFacet.hasRole(MINTER_ROLE, testWallet)}`);
  console.log(`Has CAMBIO_ADMIN_ROLE: ${await AccessControlFacet.hasRole(CAMBIO_ADMIN_ROLE, testWallet)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
