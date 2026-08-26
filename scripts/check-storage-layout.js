#!/usr/bin/env node
"use strict";

/**
 * Storage-layout gate for diamond-storage libraries.
 *
 * The diamond pattern stores each module's state in a `struct Layout` accessed via
 * an assembly-pinned keccak256 slot. Because these structs are NOT contract-level
 * state variables, solc's `storageLayout` output is empty for them — so we snapshot
 * the *struct field order* directly from source instead.
 *
 * Reordering or inserting a field in the middle of a `struct Layout` shifts every
 * subsequent slot and corrupts live state on an upgraded diamond. This gate makes
 * any such change a deliberate, reviewed action: it diffs the current field order
 * against a committed snapshot and fails on mismatch.
 *
 * Append-only changes (new fields at the end, or shrinking a trailing `__gap`) are
 * still flagged — that is intentional: you update the snapshot in the same PR so a
 * reviewer sees the layout change.
 *
 * Usage:
 *   node scripts/check-storage-layout.js            # verify against snapshot
 *   node scripts/check-storage-layout.js --update   # (re)write the snapshot
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LIB_DIR = path.join(ROOT, "contracts", "lib");
const SNAPSHOT = path.join(ROOT, "storage-layout.snapshot.json");

// Extract the body of the first `struct Layout { ... }` and return its ordered
// field declarations (type + name), ignoring comments and blank lines.
function extractLayoutFields(source) {
  const start = source.search(/struct\s+Layout\s*\{/);
  if (start === -1) return null;
  let i = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let j = i; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}") {
      depth--;
      if (depth === 0) { end = j; break; }
    }
  }
  if (end === -1) return null;
  const body = source.slice(i + 1, end);
  // strip /* */ and // comments
  const cleaned = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const fields = [];
  for (const stmt of cleaned.split(";")) {
    const decl = stmt.trim().replace(/\s+/g, " ");
    if (!decl) continue;
    // field decl is "<type...> <name>"; name is the last whitespace-delimited token
    const sp = decl.lastIndexOf(" ");
    if (sp === -1) continue;
    const name = decl.slice(sp + 1);
    const type = decl.slice(0, sp);
    fields.push({ type, name });
  }
  return fields;
}

function buildCurrent() {
  const out = {};
  for (const file of fs.readdirSync(LIB_DIR)) {
    if (!file.endsWith("Storage.sol")) continue;
    const src = fs.readFileSync(path.join(LIB_DIR, file), "utf8");
    const fields = extractLayoutFields(src);
    if (fields) out[file.replace(/\.sol$/, "")] = fields;
  }
  return out;
}

function main() {
  const update = process.argv.includes("--update");
  const current = buildCurrent();

  if (update || !fs.existsSync(SNAPSHOT)) {
    fs.writeFileSync(SNAPSHOT, JSON.stringify(current, null, 2) + "\n");
    console.log(
      `[storage-layout] ${update ? "updated" : "created"} snapshot for ` +
      `${Object.keys(current).length} storage libs -> ${path.relative(ROOT, SNAPSHOT)}`
    );
    return;
  }

  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const problems = [];

  for (const lib of Object.keys(snapshot)) {
    const before = snapshot[lib];
    const after = current[lib];
    if (!after) { problems.push(`  - ${lib}: struct Layout no longer found`); continue; }
    // Prefix check: existing slots must be unchanged (append-only is allowed only
    // when the snapshot is intentionally updated; here we require exact match).
    const max = Math.max(before.length, after.length);
    for (let k = 0; k < max; k++) {
      const b = before[k], a = after[k];
      if (!b) { problems.push(`  - ${lib}[slot ${k}]: NEW field ${a.type} ${a.name} (update snapshot if intended)`); continue; }
      if (!a) { problems.push(`  - ${lib}[slot ${k}]: REMOVED field ${b.type} ${b.name}`); continue; }
      if (a.name !== b.name || a.type !== b.type) {
        problems.push(`  - ${lib}[slot ${k}]: ${b.type} ${b.name}  ->  ${a.type} ${a.name}`);
      }
    }
  }
  for (const lib of Object.keys(current)) {
    if (!snapshot[lib]) problems.push(`  - ${lib}: new storage lib not in snapshot (run --update)`);
  }

  if (problems.length) {
    console.error("[storage-layout] FAIL — diamond-storage layout changed:");
    console.error(problems.join("\n"));
    console.error("\nIf this change is intentional and append-only, re-run with --update and commit the snapshot.");
    process.exit(1);
  }
  console.log(`[storage-layout] OK — ${Object.keys(snapshot).length} storage libs match snapshot.`);
}

main();
