const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Setting trusted forwarder with account:", deployer.address);

    // Contract addresses
    const diamondAddress = process.env.DIAMOND_ADDRESS;
    let forwarderAddress;
    const forwarderFile = path.resolve(__dirname, "../.forwarder_address");

    if (fs.existsSync(forwarderFile)) {
        forwarderAddress = fs.readFileSync(forwarderFile, "utf8").trim();
    } else {
        forwarderAddress = process.env.FORWARDER_ADDRESS;
    }

    if (!diamondAddress || !ethers.isAddress(diamondAddress)) {
        throw new Error("DIAMOND_ADDRESS is missing or invalid in .env");
    }
    if (!forwarderAddress || !ethers.isAddress(forwarderAddress)) {
        throw new Error("FORWARDER_ADDRESS is missing or invalid (set in .env or .forwarder_address)");
    }

    // Connect to the Diamond via ERC2771ContextFacet
    const erc2771Facet = await ethers.getContractAt("ERC2771ContextFacet", diamondAddress);

    console.log("Current trusted forwarder:", await erc2771Facet.getTrustedForwarder());

    // Set the trusted forwarder
    console.log("Setting trusted forwarder to:", forwarderAddress);
    const tx = await erc2771Facet.setTrustedForwarder(forwarderAddress);
    await tx.wait();
    console.log("Transaction hash:", tx.hash);

    // Verify it was set correctly
    const newForwarder = await erc2771Facet.getTrustedForwarder();
    console.log("New trusted forwarder:", newForwarder);

    if (newForwarder.toLowerCase() === forwarderAddress.toLowerCase()) {
        console.log("✅ Trusted forwarder set successfully!");
        console.log("🚀 T3Token Diamond is now ready for gasless transactions!");
    } else {
        console.error("❌ Failed to set trusted forwarder");
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
