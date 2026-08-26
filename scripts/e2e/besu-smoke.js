const { ethers } = require("ethers");

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in env`);
  return value;
}

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const DIAMOND = requiredEnv("DIAMOND_ADDRESS");
const PONDER_URL = process.env.PONDER_URL || "http://localhost:42070/";

const MINTER_KEY = requiredEnv("MINTER_KEY");
const USER_KEY = requiredEnv("USER_KEY");
const RECIPIENT_ADDR = requiredEnv("RECIPIENT_ADDR");

const MINTER_ADDR = new ethers.Wallet(MINTER_KEY).address;
const USER_ADDR = new ethers.Wallet(USER_KEY).address;

// ---------------------------------------------------------------------------
// Minimal inline ABI (human-readable)
// ---------------------------------------------------------------------------
const ABI = [
  "function mint(address recipient, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function createEnvelope(address recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior, bytes conditionData) returns (bytes32 envelopeId)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event EnvelopeCreated(bytes32 indexed envelopeId, address indexed sender, address indexed recipient, uint256 amount, uint40 commitWindowEnd, uint8 settlementType, uint8 expirationBehavior)",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollPonder(query, checkFn, label) {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const res = await fetch(PONDER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const json = await res.json();

      if (json.errors) {
        console.log(
          `[STEP 5] GraphQL errors for ${label} (attempt ${attempt}): ${JSON.stringify(json.errors, null, 2)}`
        );
      }

      if (json.data && checkFn(json.data)) {
        console.log(`[STEP 5] ${label} indexed after ${attempt} attempt(s)`);
        return true;
      }
    } catch (err) {
      console.log(`[STEP 5] ${label} poll attempt ${attempt} network error: ${err.message}`);
    }

    if (attempt < 30) {
      await sleep(2000);
    }
  }
  throw new Error(`${label} not indexed by Ponder after 30 attempts`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  let mintTxHash = null;
  let transferTxHash = null;
  let transferBlockNumber = null;
  let envelopeId = null;
  let envelopeBlockNumber = null;
  let transferConfirmed = false;
  let envelopeConfirmed = false;

  try {
    // =====================================================================
    // STEP 1 – Connect provider and sanity-check chain
    // =====================================================================
    console.log("[STEP 1] Connecting to RPC...");
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    if (chainId !== 1337) {
      throw new Error(`Expected chainId 1337, got ${chainId}`);
    }
    const latestBlock = await provider.getBlockNumber();
    console.log(`[STEP 1] Connected | chainId=${chainId} | latestBlock=${latestBlock}`);

    // =====================================================================
    // STEP 2 – Seed T3USD
    // =====================================================================
    console.log("[STEP 2] Seeding T3USD...");
    const minter = new ethers.Wallet(MINTER_KEY, provider);
    const user = new ethers.Wallet(USER_KEY, provider);
    const diamondAsMinter = new ethers.Contract(DIAMOND, ABI, minter);
    const diamondAsUser = new ethers.Contract(DIAMOND, ABI, user);
    const diamondView = new ethers.Contract(DIAMOND, ABI, provider);

    const mintAmount = 1000n * 10n ** 18n;
    const mintTx = await diamondAsMinter.mint(USER_ADDR, mintAmount);
    const mintReceipt = await mintTx.wait();
    if (mintReceipt.status !== 1) {
      throw new Error(`Mint transaction failed with status ${mintReceipt.status}`);
    }
    mintTxHash = mintReceipt.hash;

    const userBal = await diamondView.balanceOf(USER_ADDR);
    if (userBal < mintAmount) {
      throw new Error(
        `USER balance ${userBal.toString()} is less than expected ${mintAmount.toString()}`
      );
    }
    console.log(`[STEP 2] Mint txHash: ${mintTxHash}`);
    console.log(`[STEP 2] USER balance: ${ethers.formatEther(userBal)} T3USD`);

    // =====================================================================
    // STEP 3 – Direct zero-gas transfer
    // =====================================================================
    console.log("[STEP 3] Direct zero-gas transfer...");
    const transferAmount = 10n * 10n ** 18n;
    const recipientBalBefore = await diamondView.balanceOf(RECIPIENT_ADDR);

    const transferTx = await diamondAsUser.transfer(RECIPIENT_ADDR, transferAmount);
    const transferReceipt = await transferTx.wait();
    if (transferReceipt.status !== 1) {
      throw new Error(`Transfer transaction failed with status ${transferReceipt.status}`);
    }
    transferTxHash = transferReceipt.hash;
    transferBlockNumber = transferReceipt.blockNumber;

    // Parse Transfer event
    let transferEvent = null;
    for (const log of transferReceipt.logs) {
      try {
        const parsed = diamondAsUser.interface.parseLog(log);
        if (parsed && parsed.name === "Transfer") {
          transferEvent = parsed;
          break;
        }
      } catch (_) {
        // ignore non-matching logs
      }
    }
    if (!transferEvent) {
      throw new Error("Transfer event not found in receipt logs");
    }
    if (
      transferEvent.args.from !== USER_ADDR ||
      transferEvent.args.to !== RECIPIENT_ADDR ||
      transferEvent.args.value !== transferAmount
    ) {
      throw new Error(
        `Transfer event mismatch: from=${transferEvent.args.from}, to=${transferEvent.args.to}, value=${transferEvent.args.value.toString()}`
      );
    }

    const recipientBalAfter = await diamondView.balanceOf(RECIPIENT_ADDR);
    if (recipientBalAfter - recipientBalBefore !== transferAmount) {
      throw new Error(
        `Recipient balance increase mismatch: expected ${transferAmount.toString()}, got ${(recipientBalAfter - recipientBalBefore).toString()}`
      );
    }

    console.log(`[STEP 3] Transfer txHash: ${transferTxHash} | blockNumber: ${transferBlockNumber}`);
    console.log(
      `[STEP 3] Transfer event: from=${transferEvent.args.from} to=${transferEvent.args.to} value=${transferEvent.args.value.toString()}`
    );

    // =====================================================================
    // STEP 4 – Envelope create
    // =====================================================================
    console.log("[STEP 4] Creating envelope...");
    const latest = await provider.getBlock("latest");
    const commitWindowEnd = BigInt(latest.timestamp + 3600);
    const envelopeAmount = 5n * 10n ** 18n;

    const createTx = await diamondAsUser.createEnvelope(
      RECIPIENT_ADDR,
      envelopeAmount,
      commitWindowEnd,
      0, // settlementType
      0, // expirationBehavior
      "0x" // conditionData
    );
    const createReceipt = await createTx.wait();
    if (createReceipt.status !== 1) {
      throw new Error(`CreateEnvelope transaction failed with status ${createReceipt.status}`);
    }
    envelopeBlockNumber = createReceipt.blockNumber;

    // Parse EnvelopeCreated event
    let envelopeEvent = null;
    for (const log of createReceipt.logs) {
      try {
        const parsed = diamondAsUser.interface.parseLog(log);
        if (parsed && parsed.name === "EnvelopeCreated") {
          envelopeEvent = parsed;
          break;
        }
      } catch (_) {
        // ignore non-matching logs
      }
    }
    if (!envelopeEvent) {
      throw new Error("EnvelopeCreated event not found in receipt logs");
    }
    if (
      envelopeEvent.args.sender !== USER_ADDR ||
      envelopeEvent.args.recipient !== RECIPIENT_ADDR ||
      envelopeEvent.args.amount !== envelopeAmount
    ) {
      throw new Error(
        `EnvelopeCreated event mismatch: sender=${envelopeEvent.args.sender}, recipient=${envelopeEvent.args.recipient}, amount=${envelopeEvent.args.amount.toString()}`
      );
    }
    envelopeId = envelopeEvent.args.envelopeId;
    console.log(`[STEP 4] EnvelopeCreated txHash: ${createReceipt.hash} | blockNumber: ${envelopeBlockNumber}`);
    console.log(`[STEP 4] envelopeId: ${envelopeId}`);

    // =====================================================================
    // STEP 5 – Indexer catch-up
    // =====================================================================
    console.log("[STEP 5] Waiting for Ponder indexer...");
    const userLower = USER_ADDR.toLowerCase();
    const recipientLower = RECIPIENT_ADDR.toLowerCase();

    const transferQuery = `query { transferEvents(where: { from: "${userLower}", to: "${recipientLower}" }, limit: 50) { items { id from to amount } } }`;
    await pollPonder(
      transferQuery,
      (data) => {
        const items = data?.transferEvents?.items || [];
        return items.some((item) => item.amount === "10000000000000000000");
      },
      "DirectTransfer"
    );
    transferConfirmed = true;

    const envelopeQuery = `query { envelopeEvents(where: { sender: "${userLower}" }, limit: 50) { items { id sender recipient amount } } }`;
    await pollPonder(
      envelopeQuery,
      (data) => {
        const items = data?.envelopeEvents?.items || [];
        return items.some(
          (item) =>
            item.amount === "5000000000000000000" && item.recipient === recipientLower
        );
      },
      "EnvelopeCreate"
    );
    envelopeConfirmed = true;

    // =====================================================================
    // STEP 6 – Summary
    // =====================================================================
    console.log("\n========== E2E SMOKE SUMMARY ==========");
    console.log(`Mint txHash:            ${mintTxHash}`);
    console.log(`Direct transfer txHash: ${transferTxHash} | indexer-confirmed: ${transferConfirmed ? "yes" : "no"}`);
    console.log(`Envelope ID:            ${envelopeId} | indexer-confirmed: ${envelopeConfirmed ? "yes" : "no"}`);

    if (transferConfirmed && envelopeConfirmed) {
      console.log("E2E SMOKE: PASS");
      process.exit(0);
    } else {
      throw new Error("One or more indexer confirmations failed");
    }
  } catch (err) {
    console.error(`\nE2E SMOKE: FAIL - ${err.message || err}`);
    console.error(err);
    process.exit(1);
  }
}

main();
