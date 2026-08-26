"use strict";

/**
 * Public promotion allowlist (DEFAULT-DENY).
 *
 * The promotion script starts from `git ls-files` (tracked files only, which
 * already excludes everything gitignored — node_modules, .env, dist, artifacts,
 * coverage) and keeps a file ONLY if it matches an entry here. Anything not
 * explicitly listed is dropped. `hardDeny` is a belt-and-suspenders final filter
 * that must never be satisfied by an included file.
 *
 * DESIGN NOTE (2026-08-25): `scripts/` is enumerated PER FILE, not by prefix.
 * A directory prefix is default-deny at the directory boundary but default-ALLOW
 * inside it — a blanket "scripts/" prefix previously shipped 109 files including
 * a privilege-escalation script hardcoding a compromised address (SEC-2). Adding
 * a script to the public release is now a deliberate edit here.
 */

// Top-level directory prefixes (with trailing slash) to INCLUDE.
const includePrefixes = [
  // Smart contracts (active MVP facets/libs/interfaces)
  "contracts/",
  // Test suite
  "test/",
  // Shipping services (source only; their node_modules/dist are gitignored)
  "indexer/",
  "relayer/",
  "keeper/",
  // Local devnet + container config
  "docker/",
  // Canonical architecture/spec docs only
  "Documentation/envelope_besu/",
  // Deprecation trail ONLY — provenance for outside auditors (T8).
  // NOT `archive/` wholesale: `archive/scripts/` holds 25 unmaintained ops
  // scripts (6 call grantRole) that T14 relocated there as a holding pen and
  // that T8 never approved for release.
  "archive/legacy-facets/",
  "archive/legacy-facets-docs/",
  // Interfaces implemented by archived facets. TransferManagementFacet.sol
  // implements ITransferManagement, which T11 removed from contracts/ as dead in
  // the live tree — correct there, but the archived facet still needs it for the
  // deprecation trail to be self-describing.
  "archive/interfaces/",
];
// EXCLUDED BY DECISION (do not re-add without revisiting the plan):
//   ui-management/, gateway/, mcp-server/  — T7: not at release caliber for v1
//   docs/                                  — dead prefix, zero tracked files
//   plans/                                 — internal audits + key fingerprints
//   archive/scripts/                       — see note above
// `.github/` is deliberately NOT a blanket prefix: only the real CI workflow ships.

// Exact file paths to INCLUDE.
const includeFiles = new Set([
  "README.md",
  "LICENSE",
  "NOTICE",
  "CHANGELOG.md",
  "SECURITY.md",
  "REGULATORY-STATUS.md",
  "KNOWN-ISSUES.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "hardhat.config.js",
  "package.json",
  "package-lock.json",
  ".gitignore",
  ".gitleaks.toml",
  ".nvmrc",
  ".npmrc",
  "storage-layout.snapshot.json", // pinned layout for the CI storage-layout gate
  ".env.example",
  ".github/workflows/ci.yml",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/documentation.md",
  ".github/ISSUE_TEMPLATE/config.yml",
  "getSelectors.js",
  "archive/README.md",            // labels the deprecation trail
  // --- scripts/, enumerated per file (see DESIGN NOTE above) ---
  "scripts/analyze-selectors.js",
  "scripts/besu-genesis-local.sh",
  "scripts/check-contract-size.js",
  "scripts/check-doc-claims.js",
  "scripts/check-manifest-abi-parity.js",
  "scripts/check-storage-layout.js",
  "scripts/configure_rules.js",
  "scripts/decode-selectors.js",
  "scripts/deploy-diamond-complete.js",
  "scripts/deploy-forwarder.js",
  "scripts/e2e/besu-smoke.js",
  "scripts/grant-roles-to-wallet.js",
  "scripts/lib/env.js",
  "scripts/lib/facet-manifest.js",
  "scripts/lib/public-allowlist.js",
  "scripts/lib/resolve-addresses.js",
  "scripts/lib/selector-tools.js",
  "scripts/lib/verify-banking-storage-slots.js",
  "scripts/print-verify-commands.js",
  "scripts/promote-to-public.js",
  "scripts/regenerate-indexer-abi.js",
  "scripts/seed-demo-besu.js",
  "scripts/selector-collision-check.js",
  "scripts/set-trusted-forwarder.js",
  "scripts/smoke-redemption-besu.js",
  "scripts/snapshot-selectors.js",
  "scripts/storage-layout-analyzer.js",
  "scripts/verify-deployment.js",
]);

// Hard DENY patterns. An included file matching ANY of these aborts the promotion.
const hardDeny = [
  /(^|\/)\.env$/,                   // real env files (only .env.example is allowed)
  /(^|\/)\.env\.(?!example$)[^/]+$/,// .env.local, .env.besu, etc.
  /\.exp$/,                         // expect scripts (may contain secrets)
  /\.(pem|key|p12|pfx|keystore)$/,  // key material
  /(^|\/)id_(rsa|ed25519|ecdsa)/,   // ssh private keys
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /\.tar\.gz$/,
  /(^|\/)\.forwarder_address$/,
  /(^|\/)__pycache__\//,            // python bytecode dirs
  /\.pyc$/,
  /\.(pptx|docx|pdf)$/,             // binary office/report documents
  /^Working Folder\//,              // internal AI-agent runlogs
  /NotebookLM/,                     // regenerable extract
  /^plans\//,                       // internal audits + key fingerprints
];

/**
 * Content assertions run against the STAGING TREE after copying.
 * These catch leaks that a path-based allowlist cannot see. Each entry is
 * { name, re, note }; any match aborts the promotion.
 *
 * WHY: gitleaks matches known secret SHAPES and returned "no leaks found" on a
 * tree containing a root SSH password 12 times (SEC-3). These assertions cover
 * the classes we have actually been bitten by.
 */
const contentAssertions = [
  {
    name: "personal filesystem paths",
    re: /\/Users\/[a-z]+\//i,
    note: "hardcoded developer home directory",
  },
  {
    name: "server topology",
    re: /\/root\/dist|hstgr\.cloud|srv[0-9]{6,}|Hostinger/i,
    note: "internal deployment host or path",
  },
  {
    name: "compromised SEC-2 address",
    re: /0x19d5Dab464B7C6a4d95f16898f133559C123F253/i,
    note: "address whose private key is recoverable from git history",
  },
  {
    name: "internal working-folder reference",
    re: /Working Folder\//,
    note: "cites an internal artifact a public reader cannot open",
  },
  {
    name: "expect-style password send",
    re: /send\s+"[^"]{6,40}\\r"/,
    note: "expect script credential (the SEC-3 shape gitleaks misses)",
  },
];

module.exports = { includePrefixes, includeFiles, hardDeny, contentAssertions };
