const hre = require("hardhat");
async function main() {
  const DIAMOND = process.env.DIAMOND_ADDRESS;
  if (!DIAMOND) throw new Error("Set DIAMOND_ADDRESS in env");
  const loupe = await hre.ethers.getContractAt([
    "function facetAddresses() view returns (address[])",
    "function facetFunctionSelectors(address) view returns (bytes4[])"
  ], DIAMOND);
  
  // Known selectors from CambioAdminFacet
  const known = {
    "setCambioConfig(uint256,uint48,uint48,uint32)": hre.ethers.id("setCambioConfig(uint256,uint48,uint48,uint32)").slice(0,10),
    "setCambioEnvelopeConfig(uint256,uint48,uint48,uint32,uint256,uint48,bool)": hre.ethers.id("setCambioEnvelopeConfig(uint256,uint48,uint48,uint32,uint256,uint48,bool)").slice(0,10),
    "setCommitRevealThreshold(uint256)": hre.ethers.id("setCommitRevealThreshold(uint256)").slice(0,10),
    "setMaxCommitLifetime(uint48)": hre.ethers.id("setMaxCommitLifetime(uint48)").slice(0,10),
    "advanceCambioPhase()": hre.ethers.id("advanceCambioPhase()").slice(0,10),
    "getCambioEnvelopePhase()": hre.ethers.id("getCambioEnvelopePhase()").slice(0,10),
    "createCambioNote(uint256,bytes32,bytes32,uint48,string)": hre.ethers.id("createCambioNote(uint256,bytes32,bytes32,uint48,string)").slice(0,10),
    "redeemByPhrase(bytes32,string,uint256,uint256,string)": hre.ethers.id("redeemByPhrase(bytes32,string,uint256,uint256,string)").slice(0,10),
    "commitRedemption(bytes32,uint256)": hre.ethers.id("commitRedemption(bytes32,uint256)").slice(0,10),
    "revealRedemption(bytes32,string,uint256,uint256)": hre.ethers.id("revealRedemption(bytes32,string,uint256,uint256)").slice(0,10),
    "getCambioEnvelopeNote(bytes32)": hre.ethers.id("getCambioEnvelopeNote(bytes32)").slice(0,10),
    "setIssuerOpenRedemption(address,bool)": hre.ethers.id("setIssuerOpenRedemption(address,bool)").slice(0,10),
    "setIssuerPauseState(address,uint8)": hre.ethers.id("setIssuerPauseState(address,uint8)").slice(0,10),
    "registerIssuer(address)": hre.ethers.id("registerIssuer(address)").slice(0,10),
    "registerIssuer(address,address)": hre.ethers.id("registerIssuer(address,address)").slice(0,10),
    "getIssuerEnvelopeProfile(address)": hre.ethers.id("getIssuerEnvelopeProfile(address)").slice(0,10),
    "getCambioEnvelopeConfig()": hre.ethers.id("getCambioEnvelopeConfig()").slice(0,10),
  };
  
  const addrs = await loupe.facetAddresses();
  const allSels = new Set();
  for (const addr of addrs) {
    const sels = await loupe.facetFunctionSelectors(addr);
    for (const s of sels) allSels.add(s);
  }
  
  for (const [name, sel] of Object.entries(known)) {
    const has = allSels.has(sel);
    console.log(`${has ? "✅" : "❌"} ${name} => ${sel}`);
  }
}
main().catch(console.error);
