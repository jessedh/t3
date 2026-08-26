// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title IComplianceEvents
 * @notice Compliance-only event interface for the T3 envelope system.
 * @dev These events carry PLAINTEXT amounts and are indexed by custodian address
 *      so institutional webhook listeners can filter to their own envelopes.
 *
 *      Per ADR-004: all events carry plaintext amounts on the permissioned
 *      Besu consortium network. ComplianceTransactionDetail provides
 *      custodian-indexed filtering for institutional webhook listeners.
 *
 *      STATUS: DECLARED BUT NOT YET EMITTED. No facet emits
 *      ComplianceTransactionDetail today; this is a forward declaration for the
 *      Wave 6-7 compliance surface. Do not rely on receiving it.
 *
 *      STABLE INTERFACE: Once emission lands, this signature should not change
 *      without coordinating with downstream consumers (indexers, webhooks,
 *      dashboards).
 */
interface IComplianceEvents {
    /**
     * @notice Emitted alongside every envelope lifecycle event to deliver
     *         plaintext transaction details to compliance infrastructure.
     * @dev Indexed by senderCustodian and recipientCustodian so institutional
     *      listeners can filter to envelopes involving their custodied wallets.
     *
     * @param envelopeId          The envelope this detail belongs to.
     * @param senderCustodian     Custodian of the sender's wallet.
     * @param recipientCustodian  Custodian of the recipient's wallet.
     * @param sender              Originator address.
     * @param recipient           Target address.
     * @param amount              Real plaintext amount (NOT a commitment).
     * @param timestamp           Block timestamp of the operation.
     * @param operationType       "CREATE", "FINALIZE", "REVERSE", "PARTIAL_REVERSE".
     * @param complianceRef       Off-chain compliance reference (e.g. SAR ID).
     * @param settlementType      Settlement path (uint8-encoded SettlementType).
     * @param parentEnvelopeId    Parent envelope ID (bytes32(0) if root).
     */
    event ComplianceTransactionDetail(
        bytes32 indexed envelopeId,
        address indexed senderCustodian,
        address indexed recipientCustodian,
        address sender,
        address recipient,
        uint256 amount,
        uint256 timestamp,
        string  operationType,
        bytes32 complianceRef,
        uint8   settlementType,
        bytes32 parentEnvelopeId
    );
}
