"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const { decideAction } = require("../src/loop");

test("rollover when a cycle is open", () => {
  assert.equal(decideAction(ethers.id("cycle"), "OPEN"), "rollover");
});

test("open on fresh start (no current cycle, no prior)", () => {
  assert.equal(decideAction(ethers.ZeroHash, null), "open");
});

test("open after a clean finalize", () => {
  assert.equal(decideAction(ethers.ZeroHash, "FINALIZED"), "open");
});

test("HALT after a failure — never auto-open (MF-5)", () => {
  assert.equal(decideAction(ethers.ZeroHash, "FAILED"), "halt");
});
