"use strict";

// Minimal ABI fragments the keeper / reconciler need. Human-readable (ethers v6 parses these).
// Mirrors SettlementCycleFacet + MultiAssetVaultFacet getters + AccessControl.

const SETTLEMENT_CYCLE_ABI = [
  // activation
  "function isSettlementModelActive() view returns (bool)",
  // keeper lifecycle
  "function openSettlementCycle(uint8 cycleType) returns (bytes32)",
  "function proposeSettlementCycle(bytes32 cycleId, bytes32 obligationRoot, uint40 confirmationDeadline)",
  "function proposeAndRolloverSettlementCycle(bytes32 cycleId, bytes32 obligationRoot, uint40 confirmationDeadline) returns (bytes32)",
  "function finalizeSettlementCycle(bytes32 cycleId)",
  // member / attestor (manual CLI only)
  "function confirmSettlementCycle(bytes32 cycleId)",
  "function recordFunding(bytes32 cycleId, address debtor, address creditor, address settlementAsset, uint256 amount, bytes32 paymentRef, uint40 challengeWindow)",
  "function challengeSettlementCycle(bytes32 cycleId)",
  "function failSettlementCycle(bytes32 cycleId, bytes32 exceptionRoot)",
  // views
  "function getCurrentCycleId() view returns (bytes32)",
  "function getSettlementCycle(bytes32 cycleId) view returns (tuple(uint8 status, uint8 cycleType, uint40 openedAt, uint40 proposalDeadline, uint40 confirmationDeadline, uint40 fundingDeadline, uint40 challengeDeadline, bytes32 obligationRoot, bytes32 exceptionRoot))",
  "function getSettlementObligation(bytes32 obligationId) view returns (tuple(address outgoingIssuer, address receivingIssuer, address senderInstitution, address recipientInstitution, uint256 amount, bytes32 cycleId, bytes32 sourceTransferId, uint8 status))",
  "function getPairNet(bytes32 cycleId, address a, address b) view returns (int256)",
  "function getCycleLien(bytes32 cycleId, address bank) view returns (uint256)",
];

const VAULT_ABI = [
  "function getReimbursementEncumbered(address issuer) view returns (uint256)",
  "function getAvailableReserve(address issuer) view returns (uint256)",
  "function getEffectiveReserve(address issuer) view returns (uint256)",
];

const ACCESS_CONTROL_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
];

// keccak256("SETTLEMENT_KEEPER_ROLE") — must match RoleConstants.SETTLEMENT_KEEPER_ROLE.
const { ethers } = require("ethers");
const SETTLEMENT_KEEPER_ROLE = ethers.id("SETTLEMENT_KEEPER_ROLE");

// Cycle status enum (ISettlementCycle.CycleState)
const CycleState = {
  NONE: 0,
  OPEN: 1,
  PROPOSED: 2,
  CONFIRMED: 3,
  FUNDING: 4,
  FINALIZED: 5,
  FAILED: 6,
};
const CycleStateLabel = Object.fromEntries(Object.entries(CycleState).map(([k, v]) => [v, k]));

module.exports = {
  SETTLEMENT_CYCLE_ABI,
  VAULT_ABI,
  ACCESS_CONTROL_ABI,
  SETTLEMENT_KEEPER_ROLE,
  CycleState,
  CycleStateLabel,
};
