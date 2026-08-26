# Security Policy

> **Status:** This project is a **counsel-pending technical preview / reference
> implementation** for a permissioned Hyperledger Besu bank consortium. It is
> **not** a deployed system and **not** a public/permissionless DeFi protocol.
> See [REGULATORY-STATUS.md](REGULATORY-STATUS.md) and
> [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Please report suspected vulnerabilities privately via GitHub's **Security
Advisories** ("Report a vulnerability" on the repository's *Security* tab). If
that is unavailable, contact the maintainers privately and we will coordinate a
fix and disclosure timeline.

When reporting, please include:
- affected component (smart contract / facet, indexer, relayer, keeper, local Besu devnet),
- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- any suggested remediation.

We aim to acknowledge reports within a few business days. Because this is a
pre-production reference implementation maintained on a best-effort basis, we do
not currently operate a paid bug-bounty program.

## Scope

### In scope
- The Solidity smart contracts under `contracts/` (the EIP-2535 diamond and its
  facets, libraries, and storage layouts).
- The supporting services included in this release: `indexer/`, `relayer/`,
  `keeper/`, and the local Besu devnet under `docker/`.

### Out of scope / by design
This system targets a **permissioned consortium** where the network membership
boundary — not cryptography — is the visibility and access control (see ADR-004).
The following are intentional design choices, **not** vulnerabilities:
- **Plaintext amounts** in storage and events. The permissioned network is the
  confidentiality boundary; there is no cryptographic privacy layer.
- **Raw storage readability** (`eth_getStorageAt`) by consortium node operators.
  Cross-bank confidentiality at the contract-call layer is enforced by
  `ViewACLLib`; node-level read control is a deployment/topology responsibility.
- **Minimal on-chain upgrade governance.** `DiamondCutFacet` is gated by
  `DEFAULT_ADMIN_ROLE` with no on-chain timelock/multisig. This is operationally
  acceptable for a permissioned consortium; adopters on public or semi-public
  networks **must** add timelock/multisig governance before production. See
  [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

## Known issues

Already-identified design limitations and gaps (settlement-cycle liveness window,
single settlement attestor, flat role hierarchy, etc.) are tracked in
[KNOWN-ISSUES.md](KNOWN-ISSUES.md). Reports that merely restate a documented
known issue may be closed as duplicates.

## Supported versions

This is pre-`1.0` software. Only the `main` branch is supported; there are no
backported security fixes for tags or older branches.
