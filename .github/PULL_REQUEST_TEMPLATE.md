<!--
  Please read before opening: this repository is a PUBLISHED SNAPSHOT, not the
  development repository. Merged changes are applied upstream in the private
  development repo and appear here in the next release snapshot, rather than as
  commits on this branch. Your contribution is still welcome and still credited —
  it just does not land as a direct commit here. See the "Releases and repository
  model" section of README.md.
-->

## What this changes

<!-- One or two sentences. What behaviour differs after this PR? -->

## Why

<!-- What problem does it solve? Link an issue if there is one. -->

## Verification

Please confirm what you ran locally:

- [ ] `npm ci && npm run compile`
- [ ] `npm test` — state the passing/pending counts you observed
- [ ] `node scripts/selector-collision-check.js`
- [ ] `node scripts/check-manifest-abi-parity.js`
- [ ] `node scripts/check-storage-layout.js`
- [ ] `node scripts/check-contract-size.js`
- [ ] `node scripts/check-doc-claims.js`

Observed test counts: <!-- e.g. 1545 passing / 20 pending -->

## If this touches contracts

- [ ] New/changed facet is registered in `scripts/lib/facet-manifest.js`
- [ ] Storage uses a dedicated diamond-storage slot; no existing struct field was
      reordered or removed
- [ ] The indexer ABI was regenerated if selectors changed
- [ ] Any documentation claim this changes has been updated in the same PR

## Anything reviewers should know

<!-- Trade-offs, things you chose NOT to do, or areas you'd like scrutinised. -->
