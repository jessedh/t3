#!/usr/bin/env node
"use strict";

/**
 * promote-to-public.js — build a files-only public snapshot of this repo.
 *
 * DEFAULT-DENY: starts from `git ls-files`, keeps only files matching the
 * allowlist in scripts/lib/public-allowlist.js, copies them to a staging dir
 * with NO .git history, then runs safety assertions + a gitleaks scan.
 *
 * Usage:
 *   node scripts/promote-to-public.js [--out <dir>]
 * Default out dir: ../t3-bank-deposit-issuance-staging
 *
 * This script never pushes or creates a repo. It only produces a reviewable
 * staging tree and reports what it would publish.
 */

const { execSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { includePrefixes, includeFiles, hardDeny, contentAssertions } = require("./lib/public-allowlist");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const repoRoot = execSync("git rev-parse --show-toplevel").toString().trim();
const outDir = path.resolve(arg("--out", path.join(repoRoot, "..", "t3-bank-deposit-issuance-staging")));

function isAllowed(file) {
  if (includeFiles.has(file)) return true;
  return includePrefixes.some((p) => file.startsWith(p));
}

function fail(msg) {
  console.error("\n❌ PROMOTION ABORTED: " + msg);
  process.exit(1);
}

function main() {
  const tracked = execSync("git ls-files", { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
    .toString()
    .split("\n")
    .filter(Boolean);

  const selected = tracked.filter(isAllowed);

  // Belt-and-suspenders: nothing selected may match a hard-deny pattern.
  const denied = selected.filter((f) => hardDeny.some((re) => re.test(f)));
  if (denied.length) {
    fail("allowlist selected files matching hardDeny patterns:\n  " + denied.join("\n  "));
  }

  // Fresh staging dir.
  if (fs.existsSync(outDir)) {
    fail(`staging dir already exists: ${outDir}\n  Remove it first (review, then 'rm -rf') so we never silently overwrite.`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  let bytes = 0;
  for (const rel of selected) {
    const src = path.join(repoRoot, rel);
    const dst = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    bytes += fs.statSync(src).size;
  }

  // Overlay: files in scripts/public-overlays/ replace their counterpart in the
  // snapshot (used to ship sanitized, public-safe versions of dev-internal files
  // like CLAUDE.md). Overlaid targets must already be in the allowlisted selection.
  const overlayRoot = path.join(repoRoot, "scripts", "public-overlays");
  const overlays = [];
  if (fs.existsSync(overlayRoot)) {
    const walk = (dir, base) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        const relTo = path.join(base, e.name);
        if (e.isDirectory()) walk(abs, relTo);
        else overlays.push(relTo);
      }
    };
    walk(overlayRoot, "");
  }
  for (const rel of overlays) {
    const dst = path.join(outDir, rel);
    if (!fs.existsSync(dst)) {
      fail(`overlay target not in allowlisted snapshot: ${rel} (add it to the allowlist or remove the overlay)`);
    }
    fs.copyFileSync(path.join(overlayRoot, rel), dst);
    console.log("overlay applied: " + rel);
  }

  // Post-copy assertions.
  const copied = execFileSync("find", [".", "-type", "f"], { cwd: outDir, maxBuffer: 64 * 1024 * 1024 })
    .toString().split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
  const bad = copied.filter((f) => hardDeny.some((re) => re.test(f)));
  if (bad.length) fail("staging tree contains denied files:\n  " + bad.join("\n  "));
  if (fs.existsSync(path.join(outDir, ".git"))) fail("staging tree contains a .git directory (must be files-only)");
  const envLeak = copied.filter((f) => /(^|\/)\.env$/.test(f) || /(^|\/)\.env\.(?!example$)/.test(f));
  if (envLeak.length) fail("staging tree contains real .env files:\n  " + envLeak.join("\n  "));

  // CONTENT assertions — grep the staging tree for leak classes a path allowlist
  // cannot see. gitleaks matches known secret SHAPES and has returned clean on a
  // tree containing a root SSH password (SEC-3); these cover what bit us.
  console.log("\n=== content assertions ===");
  // NOTE: .svg is deliberately NOT skipped — SVG is XML text and can carry an
  // address or credential in plain sight. Only genuinely binary types are skipped.
  const TEXT_SKIP = /\.(png|jpg|jpeg|gif|ico|woff2?|ttf|eot|zip|gz|pdf|docx|pptx)$/i;
  // The allowlist necessarily contains the patterns it searches for; exempting it
  // is a self-reference carve-out, NOT a content exemption for anything else.
  // Files that DEFINE detection patterns necessarily contain them. This is a
  // self-reference carve-out for the two detectors themselves — NOT a content
  // exemption for anything else. Keep this set to detector definitions only.
  const ASSERTION_EXEMPT = new Set([
    "scripts/lib/public-allowlist.js", // defines contentAssertions
    ".gitleaks.toml",                  // defines expect-send-credential et al
  ]);
  const violations = [];
  for (const rel of copied) {
    if (TEXT_SKIP.test(rel) || ASSERTION_EXEMPT.has(rel)) continue;
    let body;
    try { body = fs.readFileSync(path.join(outDir, rel), "utf8"); } catch { continue; }
    for (const a of contentAssertions) {
      const m = body.match(a.re);
      if (!m) continue;
      const line = body.slice(0, m.index).split("\n").length;
      violations.push(`  ${rel}:${line}  [${a.name}] ${a.note}`);
    }
  }
  if (violations.length) {
    fail("content assertions failed — the staging tree leaks internal detail:\n" + violations.join("\n"));
  }
  for (const a of contentAssertions) console.log("  ok: " + a.name);

  // Report what was dropped at the top level, for the reviewer.
  const droppedTop = [...new Set(tracked.filter((f) => !isAllowed(f)).map((f) => (f.includes("/") ? f.split("/")[0] + "/" : f)))].sort();

  console.log("=== promote-to-public report ===");
  console.log("staging dir : " + outDir);
  console.log("included    : " + selected.length + " files, " + (bytes / 1024 / 1024).toFixed(2) + " MB");
  console.log("dropped (top-level entries not in allowlist):");
  for (const d of droppedTop) console.log("  - " + d);

  // gitleaks scan on the staging tree (uses repo .gitleaks.toml which we copy).
  console.log("\n=== gitleaks scan of staging tree ===");
  try {
    execFileSync("gitleaks", ["detect", "--source", outDir, "--no-git", "--no-banner", "-c", path.join(repoRoot, ".gitleaks.toml")], { stdio: "inherit" });
    console.log("✅ gitleaks: no findings in staging tree");
  } catch (e) {
    fail("gitleaks found secrets in the staging tree (see above). Do NOT publish until resolved.");
  }

  console.log("\n✅ Staging tree ready for review at: " + outDir);
  console.log("   Next: review the file list, then create the public repo and push (files-only, no .git).");
}

main();
