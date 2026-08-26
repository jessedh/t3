# Indexer ABIs

These files are **generated artifacts**, not hand-maintained source.

- `T3DiamondAbi.ts` and `T3Diamond.json` are produced by `scripts/regenerate-indexer-abi.js`
  (run from the repo root: `node scripts/regenerate-indexer-abi.js`). The script merges the ABIs
  of the facets listed in `scripts/lib/facet-manifest.js` plus the Diamond proxy, so harness,
  mock, and test contracts do not pollute the indexer ABI.
- They are committed to the repo so the indexer can be installed and run standalone
  (`npm ci && npm run dev`) without first compiling the contracts. Regenerate and re-commit them
  whenever facet interfaces change.
- `ExampleContractAbi.ts` is an empty placeholder kept for Ponder scaffolding compatibility.

Do not edit these files manually — changes will be overwritten on regeneration.
