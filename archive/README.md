# Archive

This directory contains historical design evidence and legacy source code that has been superseded by the current envelope-mode architecture.

**Do not use any file in this directory as current implementation guidance.**

All files are dated to the commit or branch where they were authoritative. See `Documentation/envelope_besu/specs/` for current canonical specifications and `contracts/facets/` for the active MVP facet set.

## These files do not build or run in place

Every file here is frozen at the path it had when it was authoritative, so its relative
imports point at locations it no longer sits next to. Verified 2026-08-25: 86 Solidity
imports and 22 JavaScript imports under `legacy-facets/` do not resolve — for example
`../lib/StorageLib.sol` (now `contracts/lib/`) and `../helpers/deployment` (now
`test/helpers/`).

**This is expected and is not a defect.** `archive/` sits outside both the Hardhat compile
path and the test path (`npm test` runs `test/` only), so nothing here is compiled,
deployed, or executed by CI. Do not attempt to build or run these files, and do not
"repair" the imports — the value of this directory is that the code is preserved exactly as
it stood.

## Contents

- `legacy-facets/` — Solidity source for facets that have been replaced or superseded. Source is preserved for audit evidence only. No entry in `scripts/lib/facet-manifest.js`; none are deployed.
- `legacy-facets-docs/` — Archived specifications and analysis notes for removed facets. These documents are retained for audit evidence only and are not current implementation guidance.
