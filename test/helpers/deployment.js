const { ethers } = require("hardhat");

const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

function getSelectors(contract, excludeSignatures = []) {
    const selectors = [];
    const excluded = new Set();

    for (const sig of excludeSignatures) {
        try {
            const fn = contract.interface.getFunction(sig);
            if (fn) excluded.add(fn.selector);
        } catch (_) {}
    }

    contract.interface.forEachFunction((fn) => {
        if (fn.name !== "init" && !excluded.has(fn.selector)) {
            selectors.push(fn.selector);
        }
    });

    return selectors;
}

/**
 * Merge two ABI arrays, dropping non-runtime fragments (constructor, etc.) and
 * deduplicating functions/events/errors by signature. Used after the EIP-170
 * split so `facets.envelope` exposes selectors from both TransferEnvelopeFacet
 * and TransferEnvelopeAdminFacet without requiring test changes.
 */
function mergeUniqueAbi(...jsonAbis) {
    const seen = new Set();
    const merged = [];
    for (const json of jsonAbis) {
        const abi = typeof json === "string" ? JSON.parse(json) : json;
        for (const item of abi) {
            if (item.type !== "function" && item.type !== "event" && item.type !== "error") {
                continue;
            }
            const key = JSON.stringify({
                type: item.type,
                name: item.name || "",
                inputs: item.inputs,
            });
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(item);
            }
        }
    }
    return merged;
}

// MVP facet list — mirrors scripts/lib/facet-manifest.js.
// C.4-pending items are kept in both places until the user makes a product decision.
// Legacy/deprecated facets and removed optional facets are NOT here.
const MVP_FACETS = [
    // Diamond infrastructure
    "DiamondLoupeFacet",
    "ERC165Facet",
    // Access control & context
    "AccessControlFacet",
    "ERC2771ContextFacet",
    // ERC-20 core
    "ERC20BaseFacet",
    "ERC20PausableFacet",
    // T3 token core
    "T3TokenAdminFacet",
    "T3TokenDirectTransferFacet",
    "T3TokenMintBurnFacet",
    "IssuanceControlFacet",
    "T3TokenFeeLogicFacet",
    "T3TokenCommonLogicFacet",
    // Custodian / institution registries
    "CustodianRegistryFacet",
    "InstitutionRegistryFacet",
    "InstitutionPolicyFacet",
    "InstitutionLifecycleFacet",
    // Consortium core
    "ConsortiumMembershipFacet",
    "MultiAssetVaultFacet",
    "BankDepositTokenFacet",
    "ConsortiumEmergencyFacet",
    "ConsortiumComplianceFacet",
    // SponsorBankCoreFacet: stays in core — CambioIssuerFacet reads SponsorBankStorage
    "SponsorBankCoreFacet",
    // Rules / compliance
    "AutomatedResponseFacet",
    "RulesConfigFacet",
    "RulesEngineFacet",
    "ComplianceConfigFacet",
    "ComplianceGateFacet",
    "ComplianceScreeningFacet",
    "ComplianceTravelRuleFacet",
    // Cambio (CambioAdminFacet has no manifest entry yet — tracked as B.1 gap)
    "CambioAdminFacet",
    "CambioIssuerFacet",
    "CambioEnvelopeFacet",
    // Envelope system
    "TransferEnvelopeFacet",
    "TransferEnvelopeAdminFacet",
    "EnvelopeInheritanceFacet",
    "WalletRecoveryFacet",
    "SmartLockEnvelopeFacet",
    "RelayerFallbackFacet",
    "SettlementCycleFacet",
    "DepositorIdentityFacet",
];

const PAUSABLE_SIGS = ["pause()", "paused()", "unpause()"];
const SUPPORTS_INTERFACE_SIG = "supportsInterface(bytes4)";
const ERC20_TRANSFER_SIGS = ["transfer(address,uint256)", "transferFrom(address,address,uint256)"];

async function deployT3DiamondFixture(skipLegacyMintUnlock = false) {
    const [owner, admin, user1, user2, user3, pauser, minter, custodian1, custodian2, treasury] =
        await ethers.getSigners();

    // Deploy Diamond infrastructure
    const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
    const diamondCutFacet = await DiamondCutFacet.deploy();
    await diamondCutFacet.waitForDeployment();

    const DiamondLoupeFacet = await ethers.getContractFactory("DiamondLoupeFacet");
    const diamondLoupeFacet = await DiamondLoupeFacet.deploy();
    await diamondLoupeFacet.waitForDeployment();

    // Deploy external libraries needed by WalletRecoveryFacet (EIP-170 size mitigation).
    const WalletRecoveryDepositorIdentityLib = await ethers.getContractFactory(
        "WalletRecoveryDepositorIdentityLib"
    );
    const depositorIdentityLib = await WalletRecoveryDepositorIdentityLib.deploy();
    await depositorIdentityLib.waitForDeployment();

    // Snapshot journal lib (Task 5.3) — linked into the sanctions lib (which calls
    // snapshotBothSides before its moves) AND the facet (restore/markStateMigrated).
    const WalletRecoverySnapshotLib = await ethers.getContractFactory(
        "WalletRecoverySnapshotLib"
    );
    const snapshotLib = await WalletRecoverySnapshotLib.deploy();
    await snapshotLib.waitForDeployment();

    const WalletRecoverySanctionsLib = await ethers.getContractFactory(
        "WalletRecoverySanctionsLib",
        { libraries: { WalletRecoverySnapshotLib: await snapshotLib.getAddress() } }
    );
    const sanctionsLib = await WalletRecoverySanctionsLib.deploy();
    await sanctionsLib.waitForDeployment();

    // External library for compliance payout holds (Sprint 4, D2) — linked
    // into TransferEnvelopeAdminFacet (admin disposition surface) and the
    // facets whose refund legs call checkOrHold (Task 4.2).
    const ComplianceHoldLib = await ethers.getContractFactory("ComplianceHoldLib");
    const complianceHoldLib = await ComplianceHoldLib.deploy();
    await complianceHoldLib.waitForDeployment();
    const COMPLIANCE_HOLD_LINKED_FACETS = new Set([
        "TransferEnvelopeAdminFacet",
        "TransferEnvelopeFacet",
        "SmartLockEnvelopeFacet",
        "CambioEnvelopeFacet",
    ]);

    // Deploy MVP facets
    const deployed = {};
    for (const facetName of MVP_FACETS) {
        if (facetName === "DiamondLoupeFacet") {
            deployed[facetName] = diamondLoupeFacet;
            continue;
        }
        let factoryOptions = {};
        if (facetName === "WalletRecoveryFacet") {
            factoryOptions = {
                libraries: {
                    WalletRecoveryDepositorIdentityLib: await depositorIdentityLib.getAddress(),
                    WalletRecoverySanctionsLib: await sanctionsLib.getAddress(),
                    WalletRecoverySnapshotLib: await snapshotLib.getAddress(),
                    ComplianceHoldLib: await complianceHoldLib.getAddress(),
                },
            };
        } else if (COMPLIANCE_HOLD_LINKED_FACETS.has(facetName)) {
            factoryOptions = {
                libraries: {
                    ComplianceHoldLib: await complianceHoldLib.getAddress(),
                },
            };
        }
        const Factory = await ethers.getContractFactory(facetName, factoryOptions);
        const facet = await Factory.deploy();
        await facet.waitForDeployment();
        deployed[facetName] = facet;
    }

    // Deploy Diamond + DiamondInit
    const Diamond = await ethers.getContractFactory("Diamond");
    const diamond = await Diamond.deploy(owner.address, await diamondCutFacet.getAddress());
    await diamond.waitForDeployment();
    const diamondAddress = await diamond.getAddress();

    const DiamondInit = await ethers.getContractFactory("DiamondInit");
    const diamondInit = await DiamondInit.deploy();
    await diamondInit.waitForDeployment();

    // Build diamond cut
    const cut = [];
    const loupeSelectors = ["0x7a0ed627", "0xadfca15e", "0x52ef6b2c", "0xcdffacc6"];
    cut.push({
        facetAddress: await diamondLoupeFacet.getAddress(),
        action: FacetCutAction.Add,
        functionSelectors: loupeSelectors,
    });

    for (const [name, facet] of Object.entries(deployed)) {
        if (name === "DiamondLoupeFacet") continue;

        const excludeSigs = name === "ERC165Facet" ? [] : [SUPPORTS_INTERFACE_SIG];
        if (name === "ERC20BaseFacet") excludeSigs.push(...ERC20_TRANSFER_SIGS);
        if (name !== "ERC20PausableFacet") {
            for (const sig of PAUSABLE_SIGS) {
                try { facet.interface.getFunction(sig); excludeSigs.push(sig); } catch (_) {}
            }
        }

        const selectors = getSelectors(facet, excludeSigs);
        if (selectors.length > 0) {
            cut.push({ facetAddress: await facet.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors });
        }
    }

    // Collision check
    const seen = new Map();
    const addrToName = {};
    for (const [name, f] of Object.entries(deployed)) addrToName[await f.getAddress()] = name;
    for (const entry of cut) {
        const owner_ = addrToName[entry.facetAddress] || entry.facetAddress;
        for (const sel of entry.functionSelectors) {
            if (seen.has(sel)) throw new Error(`Selector collision: ${sel} between ${seen.get(sel)} and ${owner_}`);
            seen.set(sel, owner_);
        }
    }

    // Execute cut
    const initParams = {
        tokenName: "T3Token",
        tokenSymbol: "T3T",
        treasuryAddress: treasury.address,
        ownerAddress: owner.address,
        halfLifeDurationSeconds: BigInt(86400),
        minHalfLifeDurationSeconds: BigInt(3600),
        maxHalfLifeDurationSeconds: BigInt(604800),
        inactivityResetPeriodSeconds: BigInt(2592000),
        minFeeWei: ethers.parseEther("0.001"),
        maxFeePercentBps: 1000,
        baseRiskScalerBpsScaled: 100,
        maxRiskScalerBpsScaled: 1000,
        feeTierThresholdsWei: [ethers.parseEther("1"), ethers.parseEther("10"), ethers.parseEther("100")],
        feeTierRatesBpsScaled: [50, 25, 10],
    };

    const diamondCutProxy = await ethers.getContractAt("IDiamondCut", diamondAddress);
    const initData = diamondInit.interface.encodeFunctionData("init", [initParams]);
    await diamondCutProxy.diamondCut(cut, await diamondInit.getAddress(), initData);

    // Build facet interface map attached to diamond
    const facets = {
        diamondCut:            await ethers.getContractAt("DiamondCutFacet",            diamondAddress),
        diamondLoupe:          await ethers.getContractAt("DiamondLoupeFacet",           diamondAddress),
        accessControl:         await ethers.getContractAt("AccessControlFacet",          diamondAddress),
        erc20:                 await ethers.getContractAt("ERC20BaseFacet",              diamondAddress),
        erc20Pausable:         await ethers.getContractAt("ERC20PausableFacet",          diamondAddress),
        admin:                 await ethers.getContractAt("T3TokenAdminFacet",           diamondAddress),
        directTransfer:        await ethers.getContractAt("T3TokenDirectTransferFacet",  diamondAddress),
        mintBurn:              await ethers.getContractAt("T3TokenMintBurnFacet",        diamondAddress),
        issuanceControl:       await ethers.getContractAt("IssuanceControlFacet",        diamondAddress),
        feeLogic:              await ethers.getContractAt("T3TokenFeeLogicFacet",        diamondAddress),
        custodian:             await ethers.getContractAt("CustodianRegistryFacet",      diamondAddress),
        erc165:                await ethers.getContractAt("ERC165Facet",                 diamondAddress),
        consortiumMembership:  await ethers.getContractAt("ConsortiumMembershipFacet",   diamondAddress),
        institutionLifecycle:  await ethers.getContractAt("InstitutionLifecycleFacet",   diamondAddress),
        multiAssetVault:       await ethers.getContractAt("MultiAssetVaultFacet",        diamondAddress),
        bankDepositToken:      await ethers.getContractAt("BankDepositTokenFacet",       diamondAddress),
        consortiumEmergency:   await ethers.getContractAt("ConsortiumEmergencyFacet",    diamondAddress),
        consortiumCompliance:  await ethers.getContractAt("ConsortiumComplianceFacet",   diamondAddress),
        institutionRegistry:   await ethers.getContractAt("InstitutionRegistryFacet",    diamondAddress),
        institutionPolicy:     await ethers.getContractAt("InstitutionPolicyFacet",      diamondAddress),
        sponsorBank:           await ethers.getContractAt("SponsorBankCoreFacet",        diamondAddress),
        automatedResponse:     await ethers.getContractAt("AutomatedResponseFacet",      diamondAddress),
        rulesConfig:           await ethers.getContractAt("RulesConfigFacet",            diamondAddress),
        rulesEngine:           await ethers.getContractAt("RulesEngineFacet",            diamondAddress),
        complianceConfig:      await ethers.getContractAt("ComplianceConfigFacet",       diamondAddress),
        complianceGate:        await ethers.getContractAt("ComplianceGateFacet",         diamondAddress),
        complianceScreening:   await ethers.getContractAt("ComplianceScreeningFacet",    diamondAddress),
        complianceTravelRule:  await ethers.getContractAt("ComplianceTravelRuleFacet",   diamondAddress),
        cambioAdmin:           await ethers.getContractAt("CambioAdminFacet",            diamondAddress),
        cambioIssuer:          await ethers.getContractAt("CambioIssuerFacet",           diamondAddress),
        cambioEnvelope:        await ethers.getContractAt("CambioEnvelopeFacet",         diamondAddress),
        envelope:              await ethers.getContractAt(
            mergeUniqueAbi(
                deployed.TransferEnvelopeFacet.interface.formatJson(),
                deployed.TransferEnvelopeAdminFacet.interface.formatJson()
            ),
            diamondAddress
        ),
        envelopeInheritance:   await ethers.getContractAt("EnvelopeInheritanceFacet",    diamondAddress),
        walletRecovery:        await ethers.getContractAt("WalletRecoveryFacet",         diamondAddress),
        smartLockEnvelope:     await ethers.getContractAt("SmartLockEnvelopeFacet",      diamondAddress),
        relayerFallback:       await ethers.getContractAt("RelayerFallbackFacet",        diamondAddress),
        settlementCycle:       await ethers.getContractAt("SettlementCycleFacet",        diamondAddress),
        depositorIdentity:     await ethers.getContractAt("DepositorIdentityFacet",      diamondAddress),
    };

    // Convenience aliases
    facets.pausable = facets.erc20Pausable;
    facets.erc20Transfer = facets.directTransfer;

    // Unlock legacy mint paths for the test suite. The default is locked (fail-safe);
    // this preserves existing tests without altering their assertions.
    if (!skipLegacyMintUnlock) {
        await facets.issuanceControl.connect(owner).setLegacyMintUnlocked(true);
    }

    // Obs-4 / E2 — direct ERC-20 transfers are gated on DIRECT_TRANSFER_ROLE
    // (institution-only in prod). The suite uses transfer() pervasively for
    // balance setup, so grant it to every named signer here; role-gate
    // negative tests revoke it or use an unnamed signer.
    const DIRECT_TRANSFER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DIRECT_TRANSFER_ROLE"));
    for (const s of [owner, admin, user1, user2, user3, pauser, minter, custodian1, custodian2, treasury]) {
        await facets.accessControl.connect(owner).grantRole(DIRECT_TRANSFER_ROLE, s.address);
    }

    return {
        diamond,
        diamondAddress,
        facets,
        signers: { owner, admin, user1, user2, user3, pauser, minter, custodian1, custodian2, treasury },
        deployedFacets: deployed,
        diamondCutSucceeded: true,
    };
}

module.exports = { deployT3DiamondFixture, getSelectors, FacetCutAction };
