# SponsorBankCoreFacet (archived — source only, NOT removed from manifest)

**Status: Source copy archived for reference. The facet REMAINS IN THE MANIFEST because CambioIssuerFacet reads SponsorBankStorage to gate issuance.**

## Why it can't be archived from the manifest yet

Three active core facets read or write `SponsorBankStorage`:

1. **`CambioIssuerFacet`** (lines 257–262): reads `SponsorBankStorage.banks[profile.sponsorBank].isRegistered && isActive` in `_getIssuerPauseState`. If no sponsor bank is registered, all Cambio issuers are treated as ISSUANCE_PAUSED. `registerSponsorBank` is the write path that unblocks this.

2. **`AutomatedResponseFacet`** (lines 201, 227, 257, 293, 325, 380): reads SponsorBankStorage emergency state across 6 sites — it reads and updates emergency pause flags for the sponsor-bank domain when coordinating system-wide emergency response.

3. **`WalletRecoveryFacet`** (lines 790–795): **writes** SponsorBankStorage — during wallet recovery it migrates `SponsorBank` structs from the old wallet address to the new wallet address. This is a struct-migration write path, architecturally more significant than the read dependencies above.

## Planned cleanup (Phase G)

The cleanup is more complex than initially documented:
- Move `registerSponsorBank` + `updateBankStatus` into `CambioAdminFacet`
- Move sponsor-bank emergency state into `ConsortiumEmergencyFacet` or `EmergencyCoordinationLib`
- Move the wallet migration write in `WalletRecoveryFacet` to reference the new storage location
- Only after all three consumers are remapped can `SponsorBankCoreFacet` be removed from the manifest

## getAllSponsorBanks bug

`getAllSponsorBanks()` returns an empty array due to an unimplemented enumeration loop (TODO comment at line ~195). This function is not called by any production code. Fix is to maintain an address array in `SponsorBankStorage`.

## Archive date

2026-06-13 (Phase C.4 decision). Manifest entry retained as dependency hold.
