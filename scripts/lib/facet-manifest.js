// scripts/lib/facet-manifest.js
//
// Single source of truth for the facets that get deployed and registered on
// the T3 diamond. This manifest drives deploy scripts, ABI generation, selector
// collision checks, and test fixtures.
//
// To add a facet:
//   1. Add an entry below with name and optional excludes.
//   2. The deploy script picks it up automatically.
//
// To remove a facet: move the source to archive/legacy-facets/ or delete it,
// then delete the entry here. Do not comment out — absent entries are absent.
//
// Collision-handling excludes: list the function signature in `excludes`. The
// getSelectors helper omits those selectors when building the cut for this facet.
//
// supportsInterface(bytes4) is excluded globally from all facets except ERC165Facet
// (controlled by the deploy script's global-exclude logic).

const SUPPORTS_INTERFACE_SIG = "supportsInterface(bytes4)";

const FACETS = [
    // ── Diamond infrastructure ──────────────────────────────────────────────
    // DiamondCutFacet is registered by the Diamond constructor; skipCut = true.
    { name: "DiamondCutFacet", skipCut: true },
    { name: "DiamondLoupeFacet" },
    { name: "ERC165Facet", excludeSupportsInterface: false },

    // ── Access control & context ────────────────────────────────────────────
    { name: "AccessControlFacet" },
    { name: "ERC2771ContextFacet" },

    // ── ERC-20 core ─────────────────────────────────────────────────────────
    // ERC20BaseFacet's transfer/transferFrom are excluded because
    // T3TokenDirectTransferFacet handles them (collision resolution).
    {
        name: "ERC20BaseFacet",
        excludes: ["transfer(address,uint256)", "transferFrom(address,address,uint256)"],
    },
    { name: "ERC20PausableFacet" },

    // ── T3 token core ───────────────────────────────────────────────────────
    { name: "T3TokenAdminFacet" },
    { name: "T3TokenDirectTransferFacet" },
    { name: "T3TokenMintBurnFacet" },
    { name: "IssuanceControlFacet" },
    { name: "T3TokenFeeLogicFacet" },
    { name: "T3TokenCommonLogicFacet" },

    // ── Custodian / institution registries ──────────────────────────────────
    { name: "CustodianRegistryFacet" },
    { name: "InstitutionRegistryFacet" },
    { name: "InstitutionPolicyFacet" },
    { name: "InstitutionLifecycleFacet" },

    // ── Consortium core ─────────────────────────────────────────────────────
    { name: "ConsortiumMembershipFacet" },
    { name: "MultiAssetVaultFacet" },
    { name: "BankDepositTokenFacet" },
    { name: "ConsortiumEmergencyFacet" },
    { name: "ConsortiumComplianceFacet" },

    // SponsorBankCoreFacet: kept in core because CambioIssuerFacet reads SponsorBankStorage
    // to check isRegistered/isActive before allowing issuance. Proper fix (Phase G):
    // move registerSponsorBank into CambioAdminFacet and remove this facet.
    { name: "SponsorBankCoreFacet" },

    // ── Rules / compliance ──────────────────────────────────────────────────
    {
        name: "AutomatedResponseFacet",
        excludes: ["pause()", "paused()", "unpause()"],
    },
    { name: "RulesConfigFacet" },
    { name: "RulesEngineFacet" },
    { name: "ComplianceConfigFacet" },
    { name: "ComplianceGateFacet" },
    { name: "ComplianceScreeningFacet" },
    { name: "ComplianceTravelRuleFacet" },

    // ── Cambio (envelope-era) ───────────────────────────────────────────────
    { name: "CambioIssuerFacet" },
    { name: "CambioEnvelopeFacet" },
    { name: "CambioAdminFacet" },

    // ── Envelope system ─────────────────────────────────────────────────────
    { name: "TransferEnvelopeFacet" },
    { name: "TransferEnvelopeAdminFacet" },
    { name: "EnvelopeInheritanceFacet" },
    { name: "WalletRecoveryFacet" },
    { name: "SmartLockEnvelopeFacet" },
    { name: "RelayerFallbackFacet" },
    { name: "SettlementCycleFacet" },

    // ── Depositor identity (FDIC 12 CFR 370 pass-through recordkeeping) ───────
    { name: "DepositorIdentityFacet" },
];

module.exports = {
    FACETS,
    SUPPORTS_INTERFACE_SIG,
};
