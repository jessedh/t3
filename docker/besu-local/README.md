# Besu Local QBFT Devnet

A throwaway local Hyperledger Besu QBFT network (4 validators + 1 RPC node) for T3 diamond development.

## Quickstart

1. **Generate genesis + keys**
   ```bash
   bash scripts/besu-genesis-local.sh
   ```

2. **Start the network**
   ```bash
   docker compose -f docker/besu-local/docker-compose.yml up -d
   ```

3. **Deploy the diamond**
   ```bash
   npx hardhat run scripts/deploy-diamond-complete.js --network besu-local
   ```

4. **Point relayer / indexer at the RPC node**
   ```bash
   # relayer/.env
   RPC_URL=http://127.0.0.1:8545
   NETWORK_LABEL=besu-local
   ```

## Network defaults (local dev only)

These are hardcoded local defaults pending final testnet infrastructure decisions:

| Parameter | Value |
|-----------|-------|
| Chain ID | `1337` |
| Consensus | QBFT (4 validators) |
| Gas model | Zero-gas (`baseFeePerGas: 0`, `gasPrice: 0`) |
| Permissioning | None |
| Validator topology | 4 single-host validators |
| RPC endpoint | `http://127.0.0.1:8545` (ws: `8546`) |

## Well-known local-dev accounts

The genesis prefunds these Hardhat default accounts. **Never use these private keys outside local dev.**

| Role | Address | Private Key |
|------|---------|-------------|
| Deployer | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| Relayer | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| Bank A | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| Bank B | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |
| Bank C | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | `0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a` |

## Regenerating

```bash
rm -rf .besu-local/
bash scripts/besu-genesis-local.sh
```

## Troubleshooting

- **Port 8545 in use?** Stop any other local node (Hardhat node, Anvil, etc.) first.
- **Validators not peering?** Check logs: `docker compose -f docker/besu-local/docker-compose.yml logs -f besu-validator-1`
- **Slow first start?** Docker may need to pull `hyperledger/besu:26.6.0` (~400 MB).
