import { createConfig } from "ponder";
import { http } from "viem";

import { T3DiamondAbi } from "./abis/T3DiamondAbi";

export default createConfig({
  chains: {
    "besu-local": {
      id: 1337,
      rpc: http(process.env.PONDER_RPC_URL || "http://127.0.0.1:8545"),
    },
  },
  contracts: {
    T3Diamond: {
      chain: "besu-local",
      abi: T3DiamondAbi,
      // Use the env address; fall back to a deterministic local Hardhat/Besu devnet diamond.
      address: (process.env.PONDER_DIAMOND_ADDRESS || "0xCD8a1C3ba11CF5ECfa6267617243239504a98d90") as `0x${string}`,
      startBlock: parseInt(process.env.PONDER_START_BLOCK || "0"),
    },
  },
});
