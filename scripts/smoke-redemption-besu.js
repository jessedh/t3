const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

/* ═══════════════════════════════════════════════════════════════════
   Wave E′.5 — Redemption Smoke Test (Besu Local Devnet)
   Executes real redeemByPhrase + commit-reveal against live diamond.
   ═══════════════════════════════════════════════════════════════════ */

// Required local-dev environment
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in env`);
  return value;
}

const DIAMOND = requiredEnv("DIAMOND_ADDRESS");
const FORWARDER = requiredEnv("FORWARDER_ADDRESS");
const RELAYER_URL = process.env.RELAYER_URL || "http://127.0.0.1:8080/relay";

const KEYS = {
  acct2: requiredEnv("ISSUER_KEY"),
  acct3: requiredEnv("BEARER_A_KEY"),
  acct4: requiredEnv("BEARER_B_KEY"),
  acct5: requiredEnv("BEARER_C_KEY"),
};

const ADDR = {
  acct2: new hre.ethers.Wallet(KEYS.acct2).address,
  acct3: new hre.ethers.Wallet(KEYS.acct3).address,
  acct4: new hre.ethers.Wallet(KEYS.acct4).address,
  acct5: new hre.ethers.Wallet(KEYS.acct5).address,
};

// Minimal ABIs (mirror seed-demo-besu.js style)
const ABIS = {
  accessControl: [
    "function grantRole(bytes32 role, address account)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
  ],
  erc20: ["function balanceOf(address account) view returns (uint256)"],
  mintBurn: ["function mint(address to, uint256 amount)"],
  custodianRegistry: [
    "function registerCustodiedWallet(address userAddress, uint256 kycValidatedTimestamp, uint256 kycExpiresTimestamp)",
  ],
  cambioIssuer: [
    "function registerIssuer(address issuer)",
    "function registerIssuer(address issuer, address sponsorBank)",
    "function endorseNonBankIssuer(address issuer)",
    "function setIssuerOpenRedemption(address issuer, bool open)",
    "function setIssuerPauseState(address issuer, uint8 state)",
    "function issuerEffectiveState(address issuer) view returns (uint8)",
    "function getIssuerProfile(address issuer) view returns (bool isActive, bool openRedemption, uint256 registeredAt)",
    "function getPendingEndorsement(address sponsorBank, address issuer) view returns (bool)",
  ],
  sponsorBank: [
    "function registerSponsorBank(address bankAddress, string identifier, uint256 feeRate)",
    "function getSponsorBankInfo(address bankAddress) view returns (address bankAddr, string identifier, uint256 feeRate, bool isActive, uint256 totalAssets, uint256 totalLiabilities, uint256 registeredAt, bool isRegistered)",
  ],
  cambioAdmin: [
    "function setCommitRevealThreshold(uint256 threshold)",
    "function setMaxCommitLifetime(uint48 lifetime)",
    "function setCambioEnvelopeConfig(uint256 maxNoteValue, uint48 minDeadlineBuffer, uint48 maxDeadlineWindow, uint32 maxMetadataLength, uint256 commitRevealThreshold, uint48 maxCommitLifetime, bool cambioPaused)",
    "function getCambioEnvelopeConfig() view returns (uint256 maxNoteValue, uint48 minDeadlineBuffer, uint48 maxDeadlineWindow, uint32 maxMetadataLength, uint256 commitRevealThreshold, uint48 maxCommitLifetime, bool cambioPaused)",
  ],
  cambioEnvelope: [
    "function advanceCambioPhase()",
    "function getCambioEnvelopePhase() view returns (uint8)",
    "function createCambioNote(uint256 amount, bytes32 phraseCommitment, bytes32 noteSalt, uint48 deadline, string metadata) returns (bytes32 noteId)",
    "function redeemByPhrase(bytes32 noteId, string phrase, uint256 amount, uint256 nonce, string metadata)",
    "function commitRedemption(bytes32 commitmentHash, uint256 expiresAt)",
    "function revealRedemption(bytes32 noteId, string phrase, uint256 amount, uint256 nonce)",
    "function getCambioEnvelopeNote(bytes32 noteId) view returns (tuple(address issuer,uint256 escrowedAmount,uint256 spent,uint48 createdAt,uint48 deadline,bool active,bytes32 phraseCommitment,bytes32 noteSalt,bool openRedemptionSnapshot,bool requiresCommitReveal))",
    "function getCambioEnvelopeConfig() view returns (uint256 maxNoteValue, uint48 minDeadlineBuffer, uint48 maxDeadlineWindow, uint32 maxMetadataLength, uint256 commitRevealThreshold, uint48 maxCommitLifetime, bool cambioPaused)",
    "function getIssuerEnvelopeProfile(address issuer) view returns (tuple(address sponsorBank,bool isActive,bool openRedemption,uint256 registeredAt,uint256 maxOutstandingNoteCount,uint256 maxOutstandingNoteValue,uint256 dailyRedemptionCeiling,uint8 pauseState,uint256 notesIssued,uint256 notesOutstanding,uint256 t3usdEscrowed,uint256 t3usdRedeemed,uint256 t3usdCancelled,uint256 valueOutstanding))",
    "event CambioEnvelopeNoteCreated(bytes32 indexed noteId, address indexed issuer, uint256 amount, uint48 deadline, bytes32 phraseCommitment, bool openRedemptionSnapshot, bool requiresCommitReveal)",
    "event CambioEnvelopeNoteRedeemed(bytes32 indexed noteId, address indexed redeemer, uint256 amount, uint256 remaining, bytes32 receiptId)",
  ],
  forwarder: [
    "function nonces(address from) view returns (uint256)",
    "function verify(tuple(address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) view returns (bool)",
  ],
  diamondLoupe: [
    "function facetAddress(bytes4 _functionSelector) external view returns (address facetAddress_)",
  ],
  diamondCut: [
    "function diamondCut(tuple(address facetAddress,uint8 action,bytes4[] functionSelectors)[] calldata _diamondCut,address _init,bytes calldata _calldata) external",
  ],
};

// ── Helpers ──

function getRoles(ethers) {
  return {
    DEFAULT_ADMIN_ROLE: ethers.ZeroHash,
    ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("ADMIN_ROLE")),
    MINTER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE")),
    CUSTODIAN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("CUSTODIAN_ROLE")),
    CAMBIO_ADMIN_ROLE: ethers.keccak256(ethers.toUtf8Bytes("CAMBIO_ADMIN_ROLE")),
    CAMBIO_ISSUER_ROLE: ethers.keccak256(ethers.toUtf8Bytes("CAMBIO_ISSUER_ROLE")),
  };
}

async function getBalance(erc20, who) {
  return erc20.balanceOf(who);
}

async function assertEq(actual, expected, msg) {
  const a = typeof actual === "bigint" ? actual.toString() : actual;
  const e = typeof expected === "bigint" ? expected.toString() : expected;
  if (a !== e) {
    throw new Error(`${msg}: expected ${e}, got ${a}`);
  }
}

async function assertBalanceDelta(erc20, who, before, expectedDelta, msg) {
  const after = await getBalance(erc20, who);
  const actualDelta = after - before;
  if (actualDelta !== expectedDelta) {
    throw new Error(`${msg}: expected delta ${expectedDelta}, got ${actualDelta} (before ${before}, after ${after})`);
  }
  return after;
}

// Compute error selector for common custom errors
function errorSelector(name) {
  return hre.ethers.id(name).slice(0, 10);
}
const ERROR_SELECTORS = {
  RelayerRequired: errorSelector("RelayerRequired(bytes32)"),
  CommitRevealRequired: errorSelector("CommitRevealRequired(bytes32)"),
  InvalidPhrase: errorSelector("InvalidPhrase(bytes32)"),
  NoteNotActive: errorSelector("NoteNotActive(bytes32)"),
  CambioNoteExpired: errorSelector("CambioNoteExpired(bytes32)"),
  IssuerFullyPaused: errorSelector("IssuerFullyPaused(address)"),
  IssuerNotRegistered: errorSelector("IssuerNotRegistered(address)"),
  UserAlreadyRegistered: errorSelector("UserAlreadyRegistered(address)"),
  CambioEnvelopeDisabled: errorSelector("CambioEnvelopeDisabled()"),
};

function errorMatches(err, expectedReason) {
  const msg = err?.reason || err?.message || "";
  const data = err?.data || "";
  if (msg.includes(expectedReason)) return true;
  const sel = ERROR_SELECTORS[expectedReason];
  if (sel && typeof data === "string" && data.includes(sel)) return true;
  return false;
}

// Wrap a contract call that is expected to revert; validates the reason.
async function expectRevert(signer, contract, method, args, expectedReason, opts = {}) {
  let tx;
  try {
    tx = await contract.connect(signer)[method](...args, opts);
  } catch (sendErr) {
    if (errorMatches(sendErr, expectedReason)) return { ok: true, detail: `send-revert: ${expectedReason}` };
    return { ok: false, detail: `send-revert unexpected: ${sendErr?.message || ""}` };
  }
  try {
    const receipt = await tx.wait();
    if (receipt.status === 0) {
      // Try static call to extract reason
      try {
        await contract.connect(signer)[method].staticCall(...args);
      } catch (staticErr) {
        if (errorMatches(staticErr, expectedReason)) return { ok: true, detail: `mined-revert: ${expectedReason}` };
        return { ok: false, detail: `mined-revert unexpected: ${staticErr?.message || ""}` };
      }
      return { ok: false, detail: "mined status 0 but staticCall did not revert" };
    }
    return { ok: false, detail: "tx succeeded (status 1)" };
  } catch (waitErr) {
    if (errorMatches(waitErr, expectedReason)) return { ok: true, detail: `wait-revert: ${expectedReason}` };
    return { ok: false, detail: `wait-revert unexpected: ${waitErr?.message || ""}` };
  }
}

// ── Report accumulator ──
const reportRows = [];
let relayerPhase2Response = null;

function record(phase, path, expectation, result, detail) {
  const icon = result === "PASS" ? "✅" : "❌";
  console.log(`${icon} [${phase}] ${path}: ${expectation} => ${result} | ${detail}`);
  reportRows.push({ phase, path, expectation, result, detail });
}

// ── Main ──
async function main() {
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("  Wave E′.5 — Redemption Smoke Test (Besu Local)");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  const provider = hre.ethers.provider;
  const [deployerSigner] = await hre.ethers.getSigners();
  ADDR.acct0 = deployerSigner.address;

  // Construct extra wallets manually (besu-local hardhat network exposes only one account)
  const issuer = new hre.ethers.Wallet(KEYS.acct2, provider);
  const bearerA = new hre.ethers.Wallet(KEYS.acct3, provider);
  const bearerB = new hre.ethers.Wallet(KEYS.acct4, provider);
  const bearerC = new hre.ethers.Wallet(KEYS.acct5, provider);

  console.log("Accounts:");
  console.log("  admin   (acct0):", deployerSigner.address);
  console.log("  issuer  (acct2):", issuer.address);
  console.log("  bearerA (acct3):", bearerA.address);
  console.log("  bearerB (acct4):", bearerB.address);
  console.log("  bearerC (acct5):", bearerC.address);

  const roles = getRoles(hre.ethers);

  // Contract handles
  const accessControl = await hre.ethers.getContractAt(ABIS.accessControl, DIAMOND);
  const erc20 = await hre.ethers.getContractAt(ABIS.erc20, DIAMOND);
  const mintBurn = await hre.ethers.getContractAt(ABIS.mintBurn, DIAMOND);
  const custodianRegistry = await hre.ethers.getContractAt(ABIS.custodianRegistry, DIAMOND);
  const cambioIssuer = await hre.ethers.getContractAt(ABIS.cambioIssuer, DIAMOND);
  const cambioEnvelope = await hre.ethers.getContractAt(ABIS.cambioEnvelope, DIAMOND);
  const forwarder = await hre.ethers.getContractAt(ABIS.forwarder, FORWARDER);
  const loupe = await hre.ethers.getContractAt(ABIS.diamondLoupe, DIAMOND);

  // ── PHASE 0: SETUP ──
  console.log("\n── PHASE 0: SETUP ────────────────────────────────────────────────");

  // 0.1 Resolve forwarder
  let resolvedForwarder;
  try {
    const iface = new hre.ethers.Interface(["function getTrustedForwarder() view returns (address)"]);
    const data = iface.encodeFunctionData("getTrustedForwarder");
    const result = await provider.call({ to: DIAMOND, data });
    resolvedForwarder = iface.decodeFunctionResult("getTrustedForwarder", result)[0];
  } catch (e) {
    throw new Error(`Failed to resolve forwarder: ${e.message}`);
  }
  await assertEq(resolvedForwarder, FORWARDER, "Trusted forwarder mismatch");
  record("0", "resolveForwarder", "equals 0x4EE6...d07B", "PASS", resolvedForwarder);

  // 0.2 Grant roles (idempotent)
  const neededRoles = [
    { role: roles.CAMBIO_ADMIN_ROLE, who: ADDR.acct0, name: "CAMBIO_ADMIN_ROLE" },
    { role: roles.MINTER_ROLE, who: ADDR.acct0, name: "MINTER_ROLE" },
    { role: roles.CUSTODIAN_ROLE, who: ADDR.acct0, name: "CUSTODIAN_ROLE" },
  ];
  for (const nr of neededRoles) {
    const has = await accessControl.hasRole(nr.role, nr.who);
    if (!has) {
      const tx = await accessControl.connect(deployerSigner).grantRole(nr.role, nr.who);
      await tx.wait();
      record("0", `grantRole(${nr.name})`, `granted to ${nr.who}`, "PASS", tx.hash);
    } else {
      record("0", `grantRole(${nr.name})`, `already held by ${nr.who}`, "PASS", "skipped");
    }
  }

  // 0.3 Advance envelope phase from DISABLED to ENABLED if needed
  const phaseBefore = await cambioEnvelope.getCambioEnvelopePhase();
  if (phaseBefore.toString() === "0") {
    const txPhase = await cambioEnvelope.connect(deployerSigner).advanceCambioPhase();
    await txPhase.wait();
    record("0", "advanceCambioPhase", "DISABLED → ENABLED", "PASS", txPhase.hash);
  } else {
    record("0", "advanceCambioPhase", `already phase ${phaseBefore}`, "PASS", "skipped");
  }

  // 0.4 Ensure CambioAdminFacet is registered (deploy + diamondCut if missing)
  const setCommitRevealSelector = hre.ethers.id("setCommitRevealThreshold(uint256)").slice(0, 10);
  const facetForSetter = await loupe.facetAddress(setCommitRevealSelector);
  if (facetForSetter === hre.ethers.ZeroAddress) {
    console.log("  CambioAdminFacet not registered on diamond. Deploying + diamondCutting...");
    const CambioAdminFactory = await hre.ethers.getContractFactory("CambioAdminFacet");
    const cambioAdminFacet = await CambioAdminFactory.connect(deployerSigner).deploy();
    await cambioAdminFacet.waitForDeployment();
    const facetAddr = await cambioAdminFacet.getAddress();
    console.log("  Deployed CambioAdminFacet at:", facetAddr);

    // Collect selectors (exclude any that already exist on diamond to avoid collision)
    const existingSels = new Set();
    const allFacetAddrs = await (await hre.ethers.getContractAt(["function facetAddresses() view returns (address[])"], DIAMOND)).facetAddresses();
    for (const addr of allFacetAddrs) {
      const sels = await (await hre.ethers.getContractAt(["function facetFunctionSelectors(address) view returns (bytes4[])"], DIAMOND)).facetFunctionSelectors(addr);
      for (const s of sels) existingSels.add(s);
    }

    const newSelectors = [];
    CambioAdminFactory.interface.forEachFunction((frag) => {
      if (frag.name !== "init" && !existingSels.has(frag.selector)) {
        newSelectors.push(frag.selector);
      }
    });

    if (newSelectors.length > 0) {
      const diamondCutContract = await hre.ethers.getContractAt(ABIS.diamondCut, DIAMOND);
      const tx = await diamondCutContract.connect(deployerSigner).diamondCut(
        [{ facetAddress: facetAddr, action: 0, functionSelectors: newSelectors }],
        hre.ethers.ZeroAddress,
        "0x"
      );
      await tx.wait();
      record("0", "diamondCut CambioAdminFacet", `added ${newSelectors.length} selectors`, "PASS", tx.hash);
    } else {
      record("0", "diamondCut CambioAdminFacet", "no new selectors to add", "PASS", "skipped");
    }
  } else {
    record("0", "CambioAdminFacet check", "already registered", "PASS", facetForSetter);
  }

  // Re-instantiate cambioAdmin now that selectors should exist
  const cambioAdmin = await hre.ethers.getContractAt(ABIS.cambioAdmin, DIAMOND);

  // 0.4 Set commit-reveal threshold and max commit lifetime
  const cfgBefore = await cambioEnvelope.getCambioEnvelopeConfig();
  const desiredThreshold = hre.ethers.parseUnits("1000", 18);
  if (cfgBefore.commitRevealThreshold.toString() !== desiredThreshold.toString()) {
    const tx = await cambioAdmin.connect(deployerSigner).setCommitRevealThreshold(desiredThreshold);
    await tx.wait();
    record("0", "setCommitRevealThreshold", "1000e18", "PASS", tx.hash);
  } else {
    record("0", "setCommitRevealThreshold", "already 1000e18", "PASS", "skipped");
  }
  if (cfgBefore.maxCommitLifetime.toString() === "0") {
    const tx = await cambioAdmin.connect(deployerSigner).setMaxCommitLifetime(86400);
    await tx.wait();
    record("0", "setMaxCommitLifetime", "86400", "PASS", tx.hash);
  } else {
    record("0", "setMaxCommitLifetime", `already ${cfgBefore.maxCommitLifetime}`, "PASS", "skipped");
  }

  // 0.5 Register sponsor bank (acct0) if needed
  const sponsorBank = await hre.ethers.getContractAt(ABIS.sponsorBank, DIAMOND);
  const sbInfo = await sponsorBank.getSponsorBankInfo(ADDR.acct0);
  if (!sbInfo[7]) {
    const SPONSOR_BANK_ADMIN_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("SPONSOR_BANK_ADMIN_ROLE"));
    const hasSbaRole = await accessControl.hasRole(SPONSOR_BANK_ADMIN_ROLE, ADDR.acct0);
    if (!hasSbaRole) {
      const tx = await accessControl.connect(deployerSigner).grantRole(SPONSOR_BANK_ADMIN_ROLE, ADDR.acct0);
      await tx.wait();
      record("0", "grant SPONSOR_BANK_ADMIN_ROLE", "granted to acct0", "PASS", tx.hash);
    }
    const tx2 = await sponsorBank.connect(deployerSigner).registerSponsorBank(ADDR.acct0, "smoke-sponsor", 0);
    await tx2.wait();
    record("0", "registerSponsorBank", "acct0 registered as sponsor bank", "PASS", tx2.hash);
  } else {
    record("0", "registerSponsorBank", "already registered", "PASS", "skipped");
  }

  // 0.6 Register issuer (legacy single-arg) + envelope profile + grant role + set active
  const issuerProfile = await cambioIssuer.getIssuerProfile(ADDR.acct2);
  if (issuerProfile.registeredAt.toString() === "0") {
    const tx = await cambioIssuer.connect(deployerSigner).registerIssuer(ADDR.acct2);
    await tx.wait();
    record("0", "registerIssuer(acct2)", "legacy registered", "PASS", tx.hash);
  } else {
    record("0", "registerIssuer(acct2)", "already legacy registered", "PASS", "skipped");
  }

  // Ensure envelope profile exists (required for openRedemptionSnapshot to work)
  const envelopeProfile = await cambioEnvelope.getIssuerEnvelopeProfile(ADDR.acct2);
  if (envelopeProfile.registeredAt.toString() === "0") {
    const SPONSOR_BANK_OPERATOR_ROLE = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("SPONSOR_BANK_OPERATOR_ROLE"));
    const hasSboRole = await accessControl.hasRole(SPONSOR_BANK_OPERATOR_ROLE, ADDR.acct0);
    if (!hasSboRole) {
      const tx = await accessControl.connect(deployerSigner).grantRole(SPONSOR_BANK_OPERATOR_ROLE, ADDR.acct0);
      await tx.wait();
      record("0", "grant SPONSOR_BANK_OPERATOR_ROLE", "granted to acct0", "PASS", tx.hash);
    }
    const pending = await cambioIssuer.getPendingEndorsement(ADDR.acct0, ADDR.acct2);
    if (!pending) {
      const tx1 = await cambioIssuer.connect(deployerSigner).endorseNonBankIssuer(ADDR.acct2);
      await tx1.wait();
      record("0", "endorseNonBankIssuer", "endorsed acct2", "PASS", tx1.hash);
    }
    const tx2 = await cambioIssuer.connect(deployerSigner)["registerIssuer(address,address)"](ADDR.acct2, ADDR.acct0);
    await tx2.wait();
    record("0", "registerIssuer(acct2,acct0)", "envelope profile created", "PASS", tx2.hash);
  } else {
    record("0", "registerIssuer(acct2,acct0)", "envelope profile already exists", "PASS", "skipped");
  }

  const hasIssuerRole = await accessControl.hasRole(roles.CAMBIO_ISSUER_ROLE, ADDR.acct2);
  if (!hasIssuerRole) {
    const tx = await accessControl.connect(deployerSigner).grantRole(roles.CAMBIO_ISSUER_ROLE, ADDR.acct2);
    await tx.wait();
    record("0", "grant CAMBIO_ISSUER_ROLE", "granted to acct2", "PASS", tx.hash);
  } else {
    record("0", "grant CAMBIO_ISSUER_ROLE", "already held by acct2", "PASS", "skipped");
  }

  // Set pause state to ACTIVE (0)
  const txPause = await cambioIssuer.connect(deployerSigner).setIssuerPauseState(ADDR.acct2, 0);
  await txPause.wait();
  record("0", "setIssuerPauseState ACTIVE", "set to ACTIVE", "PASS", txPause.hash);

  // 0.6 Register custodied wallets (idempotent)
  const nowSec = Math.floor(Date.now() / 1000);
  const kycValidated = nowSec - 86400;
  const kycExpires = nowSec + 365 * 86400;
  const toRegister = [ADDR.acct2, ADDR.acct3, ADDR.acct4, ADDR.acct5];
  for (const who of toRegister) {
    try {
      const tx = await custodianRegistry.connect(deployerSigner).registerCustodiedWallet(who, kycValidated, kycExpires);
      await tx.wait();
      record("0", `registerCustodiedWallet(${who.slice(0, 10)}...)`, "registered", "PASS", tx.hash);
    } catch (err) {
      const msg = err?.reason || err?.message || "";
      if (msg.includes("UserAlreadyRegistered")) {
        record("0", `registerCustodiedWallet(${who.slice(0, 10)}...)`, "already registered", "PASS", "skipped");
      } else {
        throw err;
      }
    }
  }

  // 0.7 Mint plenty to issuer
  const mintAmount = hre.ethers.parseUnits("1000000", 18);
  const issuerBalBeforeMint = await getBalance(erc20, ADDR.acct2);
  if (issuerBalBeforeMint < mintAmount) {
    const tx = await mintBurn.connect(deployerSigner).mint(ADDR.acct2, mintAmount);
    await tx.wait();
    record("0", "mint T3USD to issuer", "1_000_000e18", "PASS", tx.hash);
  } else {
    record("0", "mint T3USD to issuer", "already sufficient", "PASS", "skipped");
  }

  // ── PHASE 1: DIRECT redeemByPhrase (non-open, low-value) ──
  console.log("\n── PHASE 1: DIRECT redeemByPhrase ────────────────────────────────");

  // Ensure issuer openRedemption = false
  const txOpenOff = await cambioIssuer.connect(deployerSigner).setIssuerOpenRedemption(ADDR.acct2, false);
  await txOpenOff.wait();
  record("1", "setIssuerOpenRedemption(false)", "disabled open redemption", "PASS", txOpenOff.hash);

  // Generate phrase/salt for note 1
  const phraseA = "smoke-direct-phrase-" + Math.random().toString(36).slice(2);
  const saltA = hre.ethers.randomBytes(32);
  const commitmentA = hre.ethers.keccak256(hre.ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [phraseA, saltA]));
  const amountLow = hre.ethers.parseUnits("100", 18);
  const deadline1 = nowSec + 86400;

  const txCreate1 = await cambioEnvelope.connect(issuer).createCambioNote(amountLow, commitmentA, saltA, deadline1, "smoke-direct");
  const receipt1 = await txCreate1.wait();
  const event1 = receipt1.logs
    .map((l) => {
      try {
        return cambioEnvelope.interface.parseLog(l);
      } catch { return null; }
    })
    .filter((p) => p && p.name === "CambioEnvelopeNoteCreated")
    .pop();
  if (!event1) throw new Error("CambioEnvelopeNoteCreated event not found in tx " + txCreate1.hash);
  const noteId1 = event1.args.noteId;
  record("1", "createCambioNote", "note created", "PASS", `tx=${txCreate1.hash} noteId=${noteId1}`);

  // Verify requiresCommitReveal is false for low-value
  const note1Pre = await cambioEnvelope.getCambioEnvelopeNote(noteId1);
  if (note1Pre.requiresCommitReveal) throw new Error("Phase 1 low-value note unexpectedly requires commit-reveal");

  // BearerA redeems directly
  const balA_before = await getBalance(erc20, ADDR.acct3);
  const nonce1 = Date.now();
  const txRedeem1 = await cambioEnvelope.connect(bearerA).redeemByPhrase(noteId1, phraseA, amountLow, nonce1, "smoke-direct");
  await txRedeem1.wait();
  await assertBalanceDelta(erc20, ADDR.acct3, balA_before, amountLow, "Phase 1 bearerA balance delta");

  const note1After = await cambioEnvelope.getCambioEnvelopeNote(noteId1);
  if (note1After.active) throw new Error("Phase 1 note still active after full redemption");
  await assertEq(note1After.spent, amountLow, "Phase 1 note spent amount");
  record("1", "redeemByPhrase direct", "acct3 redeemed 100e18, note spent", "PASS", txRedeem1.hash);

  // ── PHASE 2: GASLESS redeemByPhrase via relayer (open bearer, low-value) ──
  console.log("\n── PHASE 2: GASLESS redeemByPhrase via relayer ───────────────────");

  // Enable open redemption
  const txOpenOn = await cambioIssuer.connect(deployerSigner).setIssuerOpenRedemption(ADDR.acct2, true);
  await txOpenOn.wait();
  record("2", "setIssuerOpenRedemption(true)", "enabled open redemption", "PASS", txOpenOn.hash);

  // Create open note
  const phraseB = "smoke-gasless-phrase-" + Math.random().toString(36).slice(2);
  const saltB = hre.ethers.randomBytes(32);
  const commitmentB = hre.ethers.keccak256(hre.ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [phraseB, saltB]));
  const deadline2 = nowSec + 86400;

  const txCreate2 = await cambioEnvelope.connect(issuer).createCambioNote(amountLow, commitmentB, saltB, deadline2, "smoke-gasless");
  const receipt2 = await txCreate2.wait();
  const event2 = receipt2.logs
    .map((l) => {
      try {
        return cambioEnvelope.interface.parseLog(l);
      } catch { return null; }
    })
    .filter((p) => p && p.name === "CambioEnvelopeNoteCreated")
    .pop();
  if (!event2) throw new Error("CambioEnvelopeNoteCreated event not found in tx " + txCreate2.hash);
  const noteId2 = event2.args.noteId;
  record("2", "createCambioNote (open)", "note created", "PASS", `tx=${txCreate2.hash} noteId=${noteId2}`);

  // Verify requiresCommitReveal is false for low-value
  const note2Pre = await cambioEnvelope.getCambioEnvelopeNote(noteId2);
  if (note2Pre.requiresCommitReveal) throw new Error("Phase 2 low-value note unexpectedly requires commit-reveal");

  // Negative: direct redeem must revert with RelayerRequired
  const negDirect = await expectRevert(bearerB, cambioEnvelope, "redeemByPhrase", [noteId2, phraseB, amountLow, Date.now() + 1, "smoke-gasless"], "RelayerRequired");
  if (!negDirect.ok) throw new Error(`Phase 2 negative check failed: ${negDirect.detail}`);
  record("2", "NEGATIVE direct redeemByPhrase", "reverts RelayerRequired", "PASS", negDirect.detail);

  // Gasless path: build EIP-712 ForwardRequest, sign with bearerB key, POST to relayer
  const ifaceRedeem = new hre.ethers.Interface(["function redeemByPhrase(bytes32 noteId, string phrase, uint256 amount, uint256 nonce, string metadata)"]);
  const redeemData = ifaceRedeem.encodeFunctionData("redeemByPhrase", [noteId2, phraseB, amountLow, Date.now() + 2, "smoke-gasless"]);

  const forwarderNonce = await forwarder.nonces(ADDR.acct4);
  const deadlineRelay = Math.floor(Date.now() / 1000) + 600;

  const domain = {
    name: "T3Forwarder",
    version: "1",
    chainId: 1337,
    verifyingContract: FORWARDER,
  };

  const types = {
    ForwardRequest: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "gas", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint48" },
      { name: "data", type: "bytes" },
    ],
  };

  const message = {
    from: ADDR.acct4,
    to: DIAMOND,
    value: 0n,
    gas: 600000n,
    nonce: forwarderNonce,
    deadline: deadlineRelay,
    data: redeemData,
  };

  const signature = await bearerB.signTypedData(domain, types, message);

  // On-chain verify before relaying
  const verifyReq = {
    from: message.from,
    to: message.to,
    value: message.value,
    gas: message.gas,
    deadline: message.deadline,
    data: message.data,
    signature,
  };
  const onChainValid = await forwarder.verify(verifyReq);
  if (!onChainValid) throw new Error("Forwarder on-chain verify() returned false before relaying");
  record("2", "forwarder.verify()", "returns true", "PASS", "on-chain preflight OK");

  // POST to relayer
  const relayBody = {
    request: {
      from: message.from,
      to: message.to,
      value: String(message.value),
      gas: String(message.gas),
      deadline: message.deadline,
      data: message.data,
      signature,
    },
  };

  const resp = await fetch(RELAYER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(relayBody),
  });

  let relayJson;
  try {
    relayJson = await resp.json();
  } catch (e) {
    const text = await resp.text();
    throw new Error(`Relayer returned non-JSON: ${resp.status} ${text}`);
  }
  relayerPhase2Response = relayJson;

  if (resp.status !== 200 || !relayJson.txHash) {
    throw new Error(`Relayer error: status=${resp.status} body=${JSON.stringify(relayJson)}`);
  }
  record("2", "POST /relay", "returns 200 + txHash", "PASS", relayJson.txHash);

  // Wait for the relayed tx to be mined (poll for receipt)
  const balB_before = await getBalance(erc20, ADDR.acct4);
  let relayReceipt = null;
  const start = Date.now();
  while (Date.now() - start < 30000) {
    relayReceipt = await provider.getTransactionReceipt(relayJson.txHash);
    if (relayReceipt && relayReceipt.blockNumber) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!relayReceipt) throw new Error("Relayed tx not mined within 30s");
  if (relayReceipt.status !== 1) throw new Error("Relayed tx reverted on-chain");

  await assertBalanceDelta(erc20, ADDR.acct4, balB_before, amountLow, "Phase 2 bearerB balance delta");

  const note2After = await cambioEnvelope.getCambioEnvelopeNote(noteId2);
  if (note2After.active) throw new Error("Phase 2 note still active after full redemption");
  await assertEq(note2After.spent, amountLow, "Phase 2 note spent amount");
  record("2", "redeemByPhrase gasless", "acct4 redeemed 100e18 via relayer", "PASS", relayJson.txHash);

  // ── PHASE 3: COMMIT-REVEAL (high-value) ──
  console.log("\n── PHASE 3: COMMIT-REVEAL (high-value) ───────────────────────────");

  const phraseC = "smoke-commitreveal-phrase-" + Math.random().toString(36).slice(2);
  const saltC = hre.ethers.randomBytes(32);
  const commitmentC = hre.ethers.keccak256(hre.ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [phraseC, saltC]));
  const amountHigh = hre.ethers.parseUnits("5000", 18);
  const deadline3 = nowSec + 86400;

  const txCreate3 = await cambioEnvelope.connect(issuer).createCambioNote(amountHigh, commitmentC, saltC, deadline3, "smoke-commitreveal");
  const receipt3 = await txCreate3.wait();
  const event3 = receipt3.logs
    .map((l) => {
      try {
        return cambioEnvelope.interface.parseLog(l);
      } catch { return null; }
    })
    .filter((p) => p && p.name === "CambioEnvelopeNoteCreated")
    .pop();
  if (!event3) throw new Error("CambioEnvelopeNoteCreated event not found in tx " + txCreate3.hash);
  const noteId3 = event3.args.noteId;
  record("3", "createCambioNote (high)", "note created >= threshold", "PASS", `tx=${txCreate3.hash} noteId=${noteId3}`);

  // Verify requiresCommitReveal
  const note3Pre = await cambioEnvelope.getCambioEnvelopeNote(noteId3);
  if (!note3Pre.requiresCommitReveal) throw new Error("High-value note does not require commit-reveal");

  // Negative: direct redeemByPhrase must revert with CommitRevealRequired
  const negCommitReveal = await expectRevert(bearerC, cambioEnvelope, "redeemByPhrase", [noteId3, phraseC, amountHigh, Date.now() + 3, "smoke-commitreveal"], "CommitRevealRequired");
  if (!negCommitReveal.ok) throw new Error(`Phase 3 negative check failed: ${negCommitReveal.detail}`);
  record("3", "NEGATIVE direct redeemByPhrase", "reverts CommitRevealRequired", "PASS", negCommitReveal.detail);

  // Build commitment hash
  const nonceCommit = Date.now() + 4;
  const commitmentHash = hre.ethers.keccak256(
    hre.ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "bytes32", "string", "address", "uint256", "uint256"],
      [1337, DIAMOND, noteId3, phraseC, ADDR.acct5, amountHigh, nonceCommit]
    )
  );

  // Read maxCommitLifetime and cap expiresAt
  const cfg = await cambioEnvelope.getCambioEnvelopeConfig();
  const maxLifetime = Number(cfg.maxCommitLifetime);
  const desiredExpires = nowSec + 86400;
  const expiresAt = maxLifetime > 0 ? Math.min(desiredExpires, nowSec + maxLifetime) : desiredExpires;

  const txCommit = await cambioEnvelope.connect(bearerC).commitRedemption(commitmentHash, expiresAt);
  await txCommit.wait();
  record("3", "commitRedemption", "commit stored", "PASS", txCommit.hash);

  const balC_before = await getBalance(erc20, ADDR.acct5);
  const txReveal = await cambioEnvelope.connect(bearerC).revealRedemption(noteId3, phraseC, amountHigh, nonceCommit);
  await txReveal.wait();

  await assertBalanceDelta(erc20, ADDR.acct5, balC_before, amountHigh, "Phase 3 bearerC balance delta");

  const note3After = await cambioEnvelope.getCambioEnvelopeNote(noteId3);
  if (note3After.active) throw new Error("Phase 3 note still active after full reveal redemption");
  await assertEq(note3After.spent, amountHigh, "Phase 3 note spent amount");
  record("3", "revealRedemption", "acct5 redeemed 5000e18", "PASS", txReveal.hash);

  // ── PHASE 4: NEGATIVE — wrong phrase ──
  console.log("\n── PHASE 4: NEGATIVE — wrong phrase ──────────────────────────────");

  const phraseD = "correct-phrase-" + Math.random().toString(36).slice(2);
  const saltD = hre.ethers.randomBytes(32);
  const commitmentD = hre.ethers.keccak256(hre.ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [phraseD, saltD]));
  const deadline4 = nowSec + 86400;

  // Ensure openRedemption is false for direct path
  await (await cambioIssuer.connect(deployerSigner).setIssuerOpenRedemption(ADDR.acct2, false)).wait();

  const txCreate4 = await cambioEnvelope.connect(issuer).createCambioNote(amountLow, commitmentD, saltD, deadline4, "smoke-wrongphrase");
  const receipt4 = await txCreate4.wait();
  const event4 = receipt4.logs
    .map((l) => {
      try {
        return cambioEnvelope.interface.parseLog(l);
      } catch { return null; }
    })
    .filter((p) => p && p.name === "CambioEnvelopeNoteCreated")
    .pop();
  const noteId4 = event4.args.noteId;
  record("4", "createCambioNote", "note created for negative test", "PASS", `tx=${txCreate4.hash} noteId=${noteId4}`);

  const negPhrase = await expectRevert(bearerA, cambioEnvelope, "redeemByPhrase", [noteId4, "wrong-phrase-123", amountLow, Date.now() + 5, "smoke-wrongphrase"], "InvalidPhrase");
  if (!negPhrase.ok) throw new Error(`Phase 4 negative check failed: ${negPhrase.detail}`);
  record("4", "NEGATIVE wrong phrase", "reverts InvalidPhrase", "PASS", negPhrase.detail);

  // ── Summary ──
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════");

  const fails = reportRows.filter((r) => r.result === "FAIL");
  const overall = fails.length === 0 ? "PASS" : "FAIL";

  console.log(`\nTotal checks: ${reportRows.length}`);
  console.log(`Failed:       ${fails.length}`);
  console.log(`Overall:      ${overall}`);

  // Write report
  const reportDir = path.join(process.cwd(), "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "wave-e5-redemption-smoke-report.md");
  const reportLines = [
    "# Wave E′.5 — Redemption Smoke Test Report",
    "",
    `**Date:** ${new Date().toISOString()}`,
    `**Network:** besu-local (chainId 1337)`,
    `**Diamond:** \`${DIAMOND}\``,
    `**Forwarder:** \`${FORWARDER}\``,
    `**Relayer:** \`${RELAYER_URL}\``,
    "",
    "## Results Table",
    "",
    "| Phase | Path | Expectation | Result | Detail |",
    "|-------|------|-------------|--------|--------|",
  ];

  for (const r of reportRows) {
    reportLines.push(`| ${r.phase} | ${r.path} | ${r.expectation} | ${r.result} | ${r.detail} |`);
  }

  reportLines.push("");
  reportLines.push("## Relayer Response (Phase 2)");
  reportLines.push("");
  reportLines.push("```json");
  reportLines.push(JSON.stringify(relayerPhase2Response, null, 2));
  reportLines.push("```");
  reportLines.push("");
  reportLines.push(`## Final Verdict: ${overall}`);
  reportLines.push("");
  if (overall === "PASS") {
    reportLines.push("All positive assertions passed and all negative checks reverted with the expected errors.");
  } else {
    reportLines.push("**FAILURES DETECTED** — see table above.");
  }

  fs.writeFileSync(reportPath, reportLines.join("\n"));

  console.log(`\n📄 Report written to: ${reportPath}`);
  console.log("\n6-line summary:");
  console.log(`  Phase 0 Setup        : ${reportRows.filter((r) => r.phase === "0").every((r) => r.result === "PASS") ? "PASS" : "FAIL"}`);
  console.log(`  Phase 1 Direct       : ${reportRows.filter((r) => r.phase === "1").every((r) => r.result === "PASS") ? "PASS" : "FAIL"}`);
  console.log(`  Phase 2 Gasless      : ${reportRows.filter((r) => r.phase === "2").every((r) => r.result === "PASS") ? "PASS" : "FAIL"}`);
  console.log(`  Phase 3 Commit-Reveal: ${reportRows.filter((r) => r.phase === "3").every((r) => r.result === "PASS") ? "PASS" : "FAIL"}`);
  console.log(`  Phase 4 Negative     : ${reportRows.filter((r) => r.phase === "4").every((r) => r.result === "PASS") ? "PASS" : "FAIL"}`);
  console.log(`  Overall              : ${overall}`);

  if (overall !== "PASS") {
    console.error("\n❌ SMOKE TEST FAILED — see report for details.");
    process.exit(1);
  }

  console.log("\n✅ SMOKE TEST PASSED.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\n💥 FATAL ERROR:", err.message);
  console.error(err.stack);
  process.exit(1);
});
