# Legacy Facets

These facets have been removed from the active manifest as part of the 2026-06-13 cutover-first cleanup. Source is preserved here for audit evidence. None are deployed; none appear in `scripts/lib/facet-manifest.js`.

## Replacement Table

| Facet | Last Active Commit | Why Deprecated | Replaced By |
|---|---|---|---|
| T3TokenTransferFacet | main@9b4025a | Superseded by envelope-mode transfer architecture | T3TokenDirectTransferFacet + TransferEnvelopeFacet |
| T3TokenReversalExpiryFacet | main@9b4025a | Expiry handled by envelope policy | SmartLockEnvelopeFacet expiry |
| T3BatchHalfLifeFacet | main@9b4025a | Batch logic superseded by envelope-mode | Envelope-mode batching |
| T3TokenPrefundedFeesFacet | main@9b4025a | Fee prefunding consolidated | T3TokenFeeLogicFacet |
| T3TokenInterbankLiabilityFacet | main@9b4025a | Bilateral liability model replaced | Wave 5 SettlementCycleFacet (not yet built) |
| T3MultiSigSettlementFacet | main@9b4025a | Multi-sig settlement replaced | Wave 5 SettlementCycleFacet (not yet built) |
| T3ComplianceMonitoringFacet | main@9b4025a | On-chain monitoring replaced by indexer | Indexer-derived compliance reporting |
| T3TokenEnhancedFeeFacet | main@9b4025a | Permissionless fee mutation (Tier-0 A.1); never safe to deploy | T3TokenFeeLogicFacet |
| SecureSettleFacet | main@9b4025a | Ghost execution on external assets (Tier-0 A.3); never safe to deploy | Wave 5 SettlementCycleFacet (not yet built) |
| T3AuditTrailsFacet | main@9b4025a | Permissionless audit log (Tier-0 A.6); never safe to deploy | Indexer-derived audit trail |
| LockedTransferManagerFacet | main@9b4025a | Locked transfer superseded | SmartLockEnvelopeFacet |
| TransferManagementFacet | main@9b4025a | Transfer management superseded | Envelope reverse/dispute flows |
| CambioEscrowFacet | main@9b4025a | Cambio escrow superseded | CambioEnvelopeFacet |
| CambioRedemptionFacet | main@9b4025a | Cambio redemption superseded | CambioEnvelopeFacet |
| DiamondLoupeFacetV2 | main@9b4025a | V2 loupe not needed; V1 is standard-compliant | DiamondLoupeFacet (V1, EIP-2535 compliant) |

## Revival Policy

These facets are NOT candidates for revival. The Tier-0 items (T3TokenEnhancedFeeFacet, SecureSettleFacet, T3AuditTrailsFacet) have active security vulnerabilities and must not be redeployed. The remainder are functionally superseded — reactivating them would require rebuilding the storage migration path that no longer exists.
