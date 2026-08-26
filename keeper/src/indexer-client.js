"use strict";

// Reads obligation data from the Wave 6A indexer banking API. The indexer is the off-chain
// system of record for what was recorded on-chain; the keeper does not run a second chain scan.

async function fetchAllObligations(indexerUrl, { from } = {}) {
  const out = [];
  const limit = 200;
  let offset = 0;
  for (;;) {
    const url = new URL("/banking/settlement-obligations", indexerUrl);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    if (from != null) url.searchParams.set("from", String(from));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`indexer ${res.status} for ${url}`);
    const body = await res.json();
    const rows = body.data || [];
    out.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return out;
}

module.exports = { fetchAllObligations };
