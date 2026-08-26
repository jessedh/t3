#!/usr/bin/env bash
# Besu Local QBFT Devnet Genesis Generator
# Generates QBFT genesis + 4 validator key sets via the pinned Besu Docker image.
# NO local Besu install required.
#
# Usage: bash scripts/besu-genesis-local.sh [--force]

set -euo pipefail

OUT_DIR="${OUT_DIR:-besu-local}"
TMP_DIR="${OUT_DIR}/.tmp"
NETWORK_FILES="${TMP_DIR}/networkFiles"
BESU_IMAGE="${BESU_IMAGE:-hyperledger/besu:26.6.0}"

: "${DEPLOYER_ADDR:?Set DEPLOYER_ADDR for the prefunded deployer account}"
: "${RELAYER_ADDR:?Set RELAYER_ADDR for the prefunded relayer account}"
: "${BANK_A_ADDR:?Set BANK_A_ADDR for the prefunded bank A account}"
: "${BANK_B_ADDR:?Set BANK_B_ADDR for the prefunded bank B account}"
: "${BANK_C_ADDR:?Set BANK_C_ADDR for the prefunded bank C account}"

: "${PREFUND_WEI:=$(printf '0x2%063d' 0)}"
ZERO_ADDRESS="$(printf '0x%040d' 0)"
QBFT_MIX_HASH="0x$(printf '63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365')"

# ---------------------------------------------------------------------------

echo "=================================================="
echo "  Besu Local QBFT Devnet Genesis Generator"
echo "  Besu image: ${BESU_IMAGE}"
echo "=================================================="
echo ""

# Idempotency check
if [[ -d "${OUT_DIR}" && -n "$(ls -A "${OUT_DIR}" 2>/dev/null | grep -v '^\.tmp$' || true)" ]]; then
    echo "WARNING: ${OUT_DIR}/ already contains generated files."
    if [[ "${1:-}" != "--force" ]]; then
        echo "Run with --force to overwrite, or rm -rf ${OUT_DIR}/ first."
        exit 1
    fi
    echo "--force passed: clearing previous generated files (keeping .tmp)..."
    find "${OUT_DIR}" -mindepth 1 -not -name '.tmp' -exec rm -rf {} + 2>/dev/null || true
fi

mkdir -p "${TMP_DIR}"

# ---------------------------------------------------------------------------
# 1. Write QBFT config for generate-blockchain-config
# ---------------------------------------------------------------------------
echo "[1/5] Writing QBFT generator config..."
cat > "${TMP_DIR}/qbftConfigFile.json" <<EOF
{
  "genesis": {
    "config": {
      "chainId": 1337,
      "londonBlock": 0,
      "contractSizeLimit": 49152,
      "qbft": {
        "blockperiodseconds": 2,
        "epochlength": 30000,
        "requesttimeoutseconds": 4
      }
    },
    "nonce": "0x0",
    "timestamp": "0x0",
    "gasLimit": "0x1fffffffffffff",
    "difficulty": "0x1",
    "mixHash": "${QBFT_MIX_HASH}",
    "coinbase": "${ZERO_ADDRESS}",
    "alloc": {}
  },
  "blockchain": {
    "nodes": {
      "generate": true,
      "count": 4
    }
  }
}
EOF

# ---------------------------------------------------------------------------
# 2. Run Besu operator generate-blockchain-config via Docker
# ---------------------------------------------------------------------------
echo "[2/5] Running Besu operator generate-blockchain-config (this may pull ${BESU_IMAGE})..."
# NOTE: Besu 26.6.0's generate-blockchain-config writes complete, valid output
# (genesis.json + keys) but still exits non-zero with a spurious
# "Output directory already exists" message. We therefore do NOT treat the
# command's exit code as authoritative; the genesis.json existence check below
# is the real success gate.
docker run --rm \
    -v "$(pwd)/${TMP_DIR}:/config" \
    "${BESU_IMAGE}" \
    operator generate-blockchain-config \
    --config-file=/config/qbftConfigFile.json \
    --to=/config/networkFiles \
    --private-key-file-name=key || echo "  (besu exited non-zero; verifying generated artifacts...)"

if [[ ! -f "${NETWORK_FILES}/genesis.json" ]]; then
    echo "ERROR: genesis.json was not generated. Check Docker output above."
    exit 1
fi

KEY_COUNT=$(find "${NETWORK_FILES}/keys" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
if [[ "${KEY_COUNT}" != "4" ]]; then
    echo "ERROR: expected 4 validator key dirs, found ${KEY_COUNT}."
    exit 1
fi
echo "  Verified: genesis.json + ${KEY_COUNT} validator key dirs present."

# ---------------------------------------------------------------------------
# 3. Copy validator keys into per-node directories
# ---------------------------------------------------------------------------
echo "[3/5] Copying validator keys into ${OUT_DIR}/validator-{1..4}/ ..."
KEY_DIRS=("${NETWORK_FILES}"/keys/*)
# Sort deterministically by address directory name
IFS=$'\n' KEY_DIRS=($(sort <<<"${KEY_DIRS[*]}")); unset IFS

for i in {0..3}; do
    idx=$((i + 1))
    src="${KEY_DIRS[$i]}"
    dst="${OUT_DIR}/validator-${idx}"
    mkdir -p "${dst}"
    cp "${src}/key" "${dst}/key"
    cp "${src}/key.pub" "${dst}/key.pub"
    chmod 600 "${dst}/key"
    addr=$(basename "${src}")
    echo "      validator-${idx} -> ${addr}"
done

# ---------------------------------------------------------------------------
# 4. Augment genesis with alloc + zero base fee
# ---------------------------------------------------------------------------
echo "[4/5] Injecting prefund accounts and zero base fee into genesis..."

GENESIS_TMP="${TMP_DIR}/genesis-augmented.json"
jq \
    --arg deployer  "${DEPLOYER_ADDR}" \
    --arg relayer   "${RELAYER_ADDR}" \
    --arg bankA     "${BANK_A_ADDR}" \
    --arg bankB     "${BANK_B_ADDR}" \
    --arg bankC     "${BANK_C_ADDR}" \
    --arg wei       "${PREFUND_WEI}" \
    '
    .baseFeePerGas = "0x0" |
    .alloc[$deployer] = { balance: $wei } |
    .alloc[$relayer]  = { balance: $wei } |
    .alloc[$bankA]    = { balance: $wei } |
    .alloc[$bankB]    = { balance: $wei } |
    .alloc[$bankC]    = { balance: $wei }
    ' \
    "${NETWORK_FILES}/genesis.json" > "${GENESIS_TMP}"

mv "${GENESIS_TMP}" "${OUT_DIR}/genesis.json"

# ---------------------------------------------------------------------------
# 5. Build static-nodes.json from validator pubkeys
# ---------------------------------------------------------------------------
echo "[5/5] Building static-nodes.json..."

STATIC_NODES="${OUT_DIR}/static-nodes.json"
echo '[' > "${STATIC_NODES}"

for i in {1..4}; do
    pubfile="${OUT_DIR}/validator-${i}/key.pub"
    pubkey=$(cat "${pubfile}" | tr -d '\n' | sed 's/^0x//')
    if [[ ${#pubkey} -ne 128 ]]; then
        echo "WARNING: Unexpected pubkey length (${#pubkey}) for validator-${i}. Using full content as-is."
    fi
    enode="enode://${pubkey}@besu-validator-${i}:30303"
    if [[ $i -lt 4 ]]; then
        echo "  \"${enode}\"," >> "${STATIC_NODES}"
    else
        echo "  \"${enode}\"" >> "${STATIC_NODES}"
    fi
done

echo ']' >> "${STATIC_NODES}"

# ---------------------------------------------------------------------------
# Cleanup temp files (keep networkFiles for inspection during debug)
# ---------------------------------------------------------------------------
echo ""
echo "=================================================="
echo "  Genesis generation complete!"
echo "=================================================="
echo ""
echo "Generated files in ${OUT_DIR}/:"
ls -1 "${OUT_DIR}/" | grep -v '^\.tmp$' | sed 's/^/  - /'
echo ""
echo "--- Prefunded local-dev accounts ---"
echo "  Deployer: ${DEPLOYER_ADDR}"
echo "  Relayer:  ${RELAYER_ADDR}"
echo ""
echo "--- Bank test accounts ---"
echo "  Bank A: ${BANK_A_ADDR}"
echo "  Bank B: ${BANK_B_ADDR}"
echo "  Bank C: ${BANK_C_ADDR}"
echo ""
echo "--- RPC endpoint ---"
echo "  http://127.0.0.1:8545"
echo ""
echo "--- Next command to deploy the diamond ---"
echo "  npx hardhat run scripts/deploy-diamond-complete.js --network besu-local"
echo ""
