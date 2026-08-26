const fs = require("fs");
const path = require("path");

require("dotenv").config();

function readDiamondAddress() {
  return process.env.DIAMOND_ADDRESS || "";
}

function readForwarderAddress() {
  const forwarderFile = path.resolve(__dirname, "../../.forwarder_address");
  if (fs.existsSync(forwarderFile)) {
    return fs.readFileSync(forwarderFile, "utf8").trim();
  }
  return process.env.FORWARDER_ADDRESS || "";
}

function readTargetAddress(fallback) {
  return process.env.TARGET_ADDRESS || fallback || "";
}

module.exports = {
  readDiamondAddress,
  readForwarderAddress,
  readTargetAddress,
};
