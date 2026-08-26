# Single-Key Administrative Exposure (Obs 6 / K-F11)

> Status: **DEFERRED-BLOCKS-ARMING** (product-owner decision D3, 2026-07-04).
> Quorum/timelock governance is the committed next major work item; it is NOT
> part of the `wave/crossfacet-remediation` scope. This document is the
> authoritative inventory of the exposure until that work lands.

## GATING PRECONDITION

**No compliance control is armed in production before the quorum/timelock work
item completes, or — if an arming decision is taken earlier — each individual
arming decision carries explicit counsel sign-off acknowledging the single-key
exposure inventoried below.** This precondition binds every gate in the merged
gate-arming blocker matrix from the 2026-07-02 cross-facet review:
sanctions, travel rule, KYC/CIP, capacity model, and settlement model. In the
remediation closure matrix, Obs 6 and K-F11 close as **DEFERRED-BLOCKS-ARMING**,
never CLOSED, until the governance work ships.

## Why this matters

Every authority below is exercisable by a single externally-owned key holding
one role. There is no second signature, no delay, and no on-chain veto between
a key compromise (or a mistaken/coerced operator action) and network-wide
effect. On a permissioned Besu consortium the blast radius is bounded by
membership, but within the network these actions take effect in one
transaction.

## Inventory of single-key authorities

Verified against the code tree on branch `wave/crossfacet-remediation`,
2026-07-05. Line numbers drift; function names are the stable citation.

| # | Authority | Role | Location | Single-tx effect |
|---|---|---|---|---|
| 1 | Network sanctions screening state | `NETWORK_SCREENING_AUTHORITY_ROLE` | `ComplianceScreeningFacet.sol` — `recordNetworkScreening` (:127), `recordScopedScreening` (:88), `setScreeningStaleAfter` (:136), `setInstitutionSanctionsEnabled` (:195), `clearDefunctInstitutionBlocks` | Block/clear any wallet network-wide; change staleness policy; flip an institution's sanctions regime |
| 2 | Depositor-identity salt rotation | admin | `DepositorIdentityFacet.sol` — `rotateSalt` (:253), `emergencySaltCompromise` (:295), `expireSaltEpoch` (:331) | Invalidate/rotate the TIN-hash correlation basis for the whole registry |
| 3 | KYC / CIP attestation | `CUSTODIAN_ROLE` per wallet | `CustodianRegistryFacet.sol` — `updateKYCStatus` (:150), `revokeKYC` (:227), `recordCIP` (:261), `revokeCIP` (:283) | Create or destroy the attestation state that armed KYC/CIP gates enforce |
| 4 | Institution lifecycle mode (**K-F11**) | `ADMIN_ROLE` (`onlyAdmin`) | `InstitutionLifecycleFacet.sol` — `setInstitutionMode` (:109-122) | Suspend/default/restore a member bank; instant compliance impact (mode is read by issuance eligibility and attestation guards) |
| 5 | Issuance / settlement model toggles | admin-class roles | `IssuanceControlFacet.setCapacityModelActive` (:89), `setLegacyMintUnlocked` (:46), `setBankDailyCap` (:100); `SettlementCycleFacet.setSettlementModelActive` (:39) | Switch the capacity and settlement models on/off network-wide; open/close the legacy mint path; set any bank's daily issuance cap |
| 6 | Compliance policy + arming keys | admin/policy roles | `InstitutionPolicyFacet` — `setNetworkPolicy` / `setInstitutionPolicy` / `setWalletPolicy` (per-control counters, D1) | Arm/disarm sanctions, KYC, travel-rule, CIP enforcement at any scope |
| 7 | Diamond upgrade + role administration | `DEFAULT_ADMIN_ROLE` | `DiamondCutFacet`, `AccessControlFacet` | Replace any facet code; grant/revoke every role above (documented flat in `KNOWN-ISSUES.md`) |
| 8 | Cambio issuer-state toggles | `CAMBIO_ADMIN_ROLE` (`onlyCambioAdmin`) | `CambioIssuerFacet.sol` — `deactivateIssuer` (:84), `setIssuerOpenRedemption` (:111), `setIssuerPauseState` (:189) | Pause, deactivate, or change the redemption posture of any registered issuer with one transaction |

## Unconsumed governance scaffolding

The storage layer already carries multi-signature and timelock structures that
**nothing consumes**:

- `StorageLib.sol:589-597` — `multiSigProposals` (`MultiSigProposal`),
  `multiSigConfig` (`MultiSigConfig`), `signerProfiles`, `proposalCounter`,
  `signerProposalHistory`, `proposalExecutionTime`, and
  `timeLockedOperations` (`TimeLockedOperation`) + `operationCounter`.
- `DiamondInit.sol:123-127` — initializes `multiSigConfig.threshold = 0`
  ("No threshold until multi-sig is activated"), 7-day proposal timeout,
  max 10 signers, emergency mode off.

No facet reads or writes these mappings on any execution path; a key holder
today bypasses them entirely because there is nothing to bypass — the
enforcement layer was never built.

## Committed next step (D3)

Product-owner decision D3 (2026-07-04): quorum/timelock governance is
**deferred out of the cross-facet remediation wave and committed as the next
major work item**. The design should decide, per authority class above,
between (a) M-of-N proposal flow using the existing `MultiSigProposal`
scaffolding, (b) timelock-with-veto using `TimeLockedOperation`, or (c) both
(quorum for role/upgrade actions, timelock for parameter/arming actions) —
and must cover authority #7 (upgrade + role admin) first, since it subsumes
all the others.

## Related findings

- Consolidated review Obs 6 (single-key network screening authority) — this doc.
- K-F11 (lifecycle mode single-key, instant compliance impact) — row 4 above.
- Counsel cover memo cross-cutting finding 6.
- G7 counsel brief §3.1 (screening authority governance questions Q1-Q3).
