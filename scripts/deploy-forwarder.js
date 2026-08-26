
const { ethers } = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("Deploying ERC2771Forwarder...");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // The constructor for the forwarder takes a name for the EIP-712 domain.
  const forwarderName = "T3Forwarder";

  const ForwarderFactory = await ethers.getContractFactory("T3Forwarder");
  const forwarder = await ForwarderFactory.deploy(forwarderName);

  await forwarder.waitForDeployment();

  const forwarderAddress = await forwarder.getAddress();

  console.log("\n✅ T3Forwarder deployed successfully!");
  console.log(`   Address: ${forwarderAddress}`);
  console.log(`   Deployer: ${deployer.address}`);
  console.log(`   EIP-712 Domain Name: ${forwarderName}`);

  // Save the address to a file for other scripts to use
  fs.writeFileSync(".forwarder_address", forwarderAddress);
  console.log("\nForwarder address saved to ./.forwarder_address file.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
