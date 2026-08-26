// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { CambioEnvelopeStorage } from "../lib/CambioEnvelopeStorage.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title CambioAdminFacet
 * @notice Admin controls for configuring and pausing Cambio note issuance.
 */
contract CambioAdminFacet is ReentrancyGuardBase {
    using EnumerableSet for EnumerableSet.AddressSet;
    event CambioConfigUpdated(
        uint256 maxNoteValue,
        uint48 minDeadlineBuffer,
        uint48 maxDeadlineWindow,
        uint32 maxMetadataLength
    );
    event CambioPaused(address indexed caller);
    event CambioUnpaused(address indexed caller);

    // Envelope config events
    event CambioEnvelopeConfigUpdated(
        uint256 maxNoteValue,
        uint48 minDeadlineBuffer,
        uint48 maxDeadlineWindow,
        uint32 maxMetadataLength,
        uint256 commitRevealThreshold,
        uint48 maxCommitLifetime,
        bool cambioPaused
    );
    event IssuerMaxOutstandingNoteCountUpdated(address indexed issuer, uint256 count);
    event IssuerMaxOutstandingNoteValueUpdated(address indexed issuer, uint256 value);
    event IssuerDailyRedemptionCeilingUpdated(address indexed issuer, uint256 ceiling);
    event CommitRevealThresholdUpdated(uint256 threshold);
    event MaxCommitLifetimeUpdated(uint48 lifetime);
    event GlobalMaxOutstandingNoteCountUpdated(uint256 count);
    event GlobalMaxOutstandingNoteValueUpdated(uint256 value);

    modifier onlyCambioAdmin() {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[RoleConstants.CAMBIO_ADMIN_ROLE].contains(msg.sender)) {
            revert StorageLib.UnauthorizedRole(msg.sender, RoleConstants.CAMBIO_ADMIN_ROLE);
        }
        _;
    }

    modifier whenNotPaused() {
        if (StorageLib.diamondStorage()._paused) {
            revert("Pausable: paused");
        }
        _;
    }

    function setCambioConfig(
        uint256 maxNoteValue,
        uint48 minDeadlineBuffer,
        uint48 maxDeadlineWindow,
        uint32 maxMetadataLength
    ) external onlyCambioAdmin whenNotPaused {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (maxDeadlineWindow != 0 && maxDeadlineWindow <= minDeadlineBuffer) {
            revert StorageLib.CambioInvalidConfiguration();
        }
        ds.cambioConfig.maxNoteValue = maxNoteValue;
        ds.cambioConfig.minDeadlineBuffer = minDeadlineBuffer;
        ds.cambioConfig.maxDeadlineWindow = maxDeadlineWindow;
        ds.cambioConfig.maxMetadataLength = maxMetadataLength;
        emit CambioConfigUpdated(maxNoteValue, minDeadlineBuffer, maxDeadlineWindow, maxMetadataLength);
    }

    function pauseCambio() external onlyCambioAdmin whenNotPaused {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds.cambioConfig.cambioPaused) {
            ds.cambioConfig.cambioPaused = true;
            emit CambioPaused(msg.sender);
        }
    }

    function unpauseCambio() external onlyCambioAdmin {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (ds.cambioConfig.cambioPaused) {
            ds.cambioConfig.cambioPaused = false;
            emit CambioUnpaused(msg.sender);
        }
    }

    function getCambioConfig()
        external
        view
        returns (uint256 maxNoteValue, uint48 minDeadlineBuffer, uint48 maxDeadlineWindow, uint32 maxMetadataLength, bool cambioPaused)
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        StorageLib.CambioConfig storage cfg = ds.cambioConfig;
        return (cfg.maxNoteValue, cfg.minDeadlineBuffer, cfg.maxDeadlineWindow, cfg.maxMetadataLength, cfg.cambioPaused);
    }

    // --- Envelope Risk Control Setters ---

    function setCambioEnvelopeConfig(
        uint256 maxNoteValue,
        uint48 minDeadlineBuffer,
        uint48 maxDeadlineWindow,
        uint32 maxMetadataLength,
        uint256 commitRevealThreshold,
        uint48 maxCommitLifetime,
        bool cambioPaused
    ) external onlyCambioAdmin whenNotPaused {
        CambioEnvelopeStorage.Layout storage es = CambioEnvelopeStorage.layout();
        if (maxDeadlineWindow != 0 && maxDeadlineWindow <= minDeadlineBuffer) {
            revert StorageLib.CambioInvalidConfiguration();
        }
        es.config.maxNoteValue = maxNoteValue;
        es.config.minDeadlineBuffer = minDeadlineBuffer;
        es.config.maxDeadlineWindow = maxDeadlineWindow;
        es.config.maxMetadataLength = maxMetadataLength;
        es.config.commitRevealThreshold = commitRevealThreshold;
        es.config.maxCommitLifetime = maxCommitLifetime;
        es.config.cambioPaused = cambioPaused;
        emit CambioEnvelopeConfigUpdated(
            maxNoteValue,
            minDeadlineBuffer,
            maxDeadlineWindow,
            maxMetadataLength,
            commitRevealThreshold,
            maxCommitLifetime,
            cambioPaused
        );
    }

    function setIssuerMaxOutstandingNoteCount(address issuer, uint256 count) external onlyCambioAdmin whenNotPaused {
        CambioEnvelopeStorage.layout().issuerProfiles[issuer].maxOutstandingNoteCount = count;
        emit IssuerMaxOutstandingNoteCountUpdated(issuer, count);
    }

    function setIssuerMaxOutstandingNoteValue(address issuer, uint256 value) external onlyCambioAdmin whenNotPaused {
        CambioEnvelopeStorage.layout().issuerProfiles[issuer].maxOutstandingNoteValue = value;
        emit IssuerMaxOutstandingNoteValueUpdated(issuer, value);
    }

    function setIssuerDailyRedemptionCeiling(address issuer, uint256 ceiling) external onlyCambioAdmin whenNotPaused {
        CambioEnvelopeStorage.layout().issuerProfiles[issuer].dailyRedemptionCeiling = ceiling;
        emit IssuerDailyRedemptionCeilingUpdated(issuer, ceiling);
    }

    function setCommitRevealThreshold(uint256 threshold) external onlyCambioAdmin whenNotPaused {
        CambioEnvelopeStorage.layout().config.commitRevealThreshold = threshold;
        emit CommitRevealThresholdUpdated(threshold);
    }

    function setMaxCommitLifetime(uint48 lifetime) external onlyCambioAdmin whenNotPaused {
        CambioEnvelopeStorage.layout().config.maxCommitLifetime = lifetime;
        emit MaxCommitLifetimeUpdated(lifetime);
    }

    function setGlobalMaxOutstandingNoteCount(uint256 count) external onlyCambioAdmin whenNotPaused {
        CambioEnvelopeStorage.layout().config.globalMaxOutstandingNoteCount = count;
        emit GlobalMaxOutstandingNoteCountUpdated(count);
    }

    function setGlobalMaxOutstandingNoteValue(uint256 value) external onlyCambioAdmin whenNotPaused {
        CambioEnvelopeStorage.layout().config.globalMaxOutstandingNoteValue = value;
        emit GlobalMaxOutstandingNoteValueUpdated(value);
    }
}
