"use strict";

const { ethers } = require("ethers");
const {
  SETTLEMENT_CYCLE_ABI,
  VAULT_ABI,
  ACCESS_CONTROL_ABI,
  SETTLEMENT_KEEPER_ROLE,
} = require("./abi");

// Thin ethers v6 wrapper over the diamond. The diamond exposes every facet at one address,
// so all fragments target the same contract instance.
function makeChain(cfg) {
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const abi = [...SETTLEMENT_CYCLE_ABI, ...VAULT_ABI, ...ACCESS_CONTROL_ABI];

  let wallet = null;
  let signerContract = null;
  if (cfg.privateKey) {
    wallet = new ethers.Wallet(cfg.privateKey, provider);
    signerContract = new ethers.Contract(cfg.diamondAddress, abi, wallet);
  }
  const readContract = new ethers.Contract(cfg.diamondAddress, abi, provider);

  return {
    provider,
    wallet,
    read: readContract,
    write: signerContract,
    keeperAddress: wallet ? wallet.address : null,

    async isSettlementModelActive() {
      return readContract.isSettlementModelActive();
    },
    async keeperHasRole() {
      if (!wallet) return false;
      return readContract.hasRole(SETTLEMENT_KEEPER_ROLE, wallet.address);
    },
    async getCurrentCycleId() {
      return readContract.getCurrentCycleId();
    },
    async getCycle(cycleId) {
      return readContract.getSettlementCycle(cycleId);
    },
    async getObligation(obligationId) {
      return readContract.getSettlementObligation(obligationId);
    },
    async getPairNet(cycleId, a, b) {
      return readContract.getPairNet(cycleId, a, b);
    },
    async getCycleLien(cycleId, bank) {
      return readContract.getCycleLien(cycleId, bank);
    },
    async getReimbursementEncumbered(bank) {
      return readContract.getReimbursementEncumbered(bank);
    },
    async getEffectiveReserve(bank) {
      return readContract.getEffectiveReserve(bank);
    },
  };
}

module.exports = { makeChain };
