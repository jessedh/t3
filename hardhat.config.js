require("@nomicfoundation/hardhat-ethers");
require("@openzeppelin/hardhat-upgrades"); // For upgradeable contracts
require("dotenv").config(); // To load .env variables
require("@nomicfoundation/hardhat-chai-matchers");
//added for coverage reports
require('solidity-coverage');
//added for gas reports
require('hardhat-gas-reporter');
require("hardhat-contract-sizer");
require("hardhat-storage-layout"); // For storage layout analysis

const BESU_LOCAL_PRIVATE_KEY_ENV = "BESU_LOCAL_PRIVATE_KEY";

function isBesuLocalNetworkSelected() {
  const networkFlagIndex = process.argv.indexOf("--network");
  return (
    (networkFlagIndex !== -1 && process.argv[networkFlagIndex + 1] === "besu-local") ||
    process.argv.includes("--network=besu-local")
  );
}

function getBesuLocalAccounts() {
  const privateKey = process.env[BESU_LOCAL_PRIVATE_KEY_ENV];
  if (!privateKey && isBesuLocalNetworkSelected()) {
    throw new Error(
      `${BESU_LOCAL_PRIVATE_KEY_ENV} is required for --network besu-local. ` +
      "Set it in your environment or copy .env.example to .env and fill the Besu local key."
    );
  }
  return privateKey ? [privateKey] : [];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24", // Ensure this matches your contract's pragma
    settings: {
      optimizer: {
        enabled: true,
        runs: process.env.OPT_RUNS ? Number(process.env.OPT_RUNS) : 100
      },
      viaIR: process.env.VIA_IR ? process.env.VIA_IR === 'true' : true, // Allow override via env
      evmVersion: process.env.EVM_VERSION || 'paris'
    },
  },
  hardhatStorageLayout: {
  showInConsole: true,
  outputFile: "storage-layout.json",
  runOnCompile: true // Automatically run after compilation
  },

  contractSizer: {
    alphaSort: true, // Sort contracts alphabetically
    runOnCompile: true, // Automatically run after compilation
    disambiguatePaths: false, // Don't show full path if contract name is unique
    strict: false, // Don't throw an error if contracts exceed limit
    outputFile: "contract-size-report.txt", // Output to a file
    // Substring match: reports every active facet + the Diamond proxy/loupe set.
    // (Previously pinned a stale list that included archived/optional facets.)
    only: ["Facet", "Diamond"],
     unit: "KiB" // Display in Kibibytes (KiB) or Bytes (B)
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      hostname: "0.0.0.0",
      allowUnlimitedContractSize: true,
      blockGasLimit: 30000000
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    "besu-local": {
      url: process.env.BESU_LOCAL_RPC_URL || "http://127.0.0.1:8545",
      // LOCAL-DEV-ONLY: set BESU_LOCAL_PRIVATE_KEY to the prefunded local Besu
      // account from .env.example. Do not silently fall back when this network
      // is selected, because besu-local can also point at a real node.
      accounts: getBesuLocalAccounts(),
      chainId: 1337,
      gas: "auto",
      gasPrice: 0,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    reportFormat: "markdown",
    outputFile: "gasReport.md"
    //,
    //forceTerminalOutput: false,
    //forceTerminalOutputFormat: "terminal"
  }
};
