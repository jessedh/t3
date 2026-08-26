"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const {
  canonicalPair,
  deriveNets,
  pairNetOf,
  deriveLiens,
  computeObligationRoot,
} = require("../src/settlement-math");

const A = "0x" + "a".repeat(40);
const B = "0x" + "b".repeat(40);
const C = "0x" + "c".repeat(40);

test("canonicalPair orders by address", () => {
  assert.deepEqual(canonicalPair(B, A), [A, B]);
  assert.deepEqual(canonicalPair(A, B), [A, B]);
});

test("deriveNets: A owes B 100, B owes A 30 => net A->B 70", () => {
  const obs = [
    { outgoingIssuer: A, receivingIssuer: B, amount: 100n },
    { outgoingIssuer: B, receivingIssuer: A, amount: 30n },
  ];
  const nets = deriveNets(obs);
  // canonical pair is (A,B); positive means A (lo) owes B (hi)
  assert.equal(pairNetOf(nets, A, B), 70n);
  assert.equal(pairNetOf(nets, B, A), -70n);
});

test("deriveLiens: bilateral-net debit per bank", () => {
  // A owes B 70 (net), B owes C 40 (net). Liens: A=70, B=40, C=0(dropped)
  const obs = [
    { outgoingIssuer: A, receivingIssuer: B, amount: 100n },
    { outgoingIssuer: B, receivingIssuer: A, amount: 30n },
    { outgoingIssuer: B, receivingIssuer: C, amount: 40n },
  ];
  const liens = deriveLiens(obs);
  assert.equal(liens.get(A.toLowerCase()), 70n);
  assert.equal(liens.get(B.toLowerCase()), 40n);
  assert.equal(liens.has(C.toLowerCase()), false); // zero lien dropped (C is net creditor)
});

test("deriveLiens: fully netting pair leaves zero liens", () => {
  const obs = [
    { outgoingIssuer: A, receivingIssuer: B, amount: 100n },
    { outgoingIssuer: B, receivingIssuer: A, amount: 100n },
  ];
  const liens = deriveLiens(obs);
  assert.equal(liens.size, 0);
});

test("computeObligationRoot is deterministic + order-independent", () => {
  const id1 = ethers.id("ob1");
  const id2 = ethers.id("ob2");
  const r1 = computeObligationRoot([id1, id2]);
  const r2 = computeObligationRoot([id2, id1]);
  assert.equal(r1, r2);
  assert.notEqual(r1, ethers.ZeroHash);
});

test("computeObligationRoot empty => ZeroHash", () => {
  assert.equal(computeObligationRoot([]), ethers.ZeroHash);
});
