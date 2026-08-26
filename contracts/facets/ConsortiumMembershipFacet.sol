// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { InstitutionLifecycleStorage } from "../lib/InstitutionLifecycleStorage.sol";
import { InstitutionLifecycleFacet } from "./InstitutionLifecycleFacet.sol";

/**
 * @title ConsortiumMembershipFacet
 * @notice Manages onboarding, configuration, and lifecycle of consortium member banks.
 */
contract ConsortiumMembershipFacet {
    event BankRegistered(address indexed bank, string name, address indexed primarySigner);
    event BankProfileUpdated(address indexed bank, string name, address indexed primarySigner, uint256 maxCollateralLimit);
    event BankActivationChanged(address indexed bank, bool isActive);
    event BankWalletConfigured(address indexed bank, uint256 indexed assetType, address treasuryWallet, address collateralVault);

    modifier onlyAdmin() {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        _;
    }

    // M-4: Pause check for state-changing functions
    modifier whenNotPaused() {
        if (StorageLib.diamondStorage()._paused) {
            revert("Pausable: paused");
        }
        _;
    }

    function registerBank(
        address bank,
        string calldata bankName,
        address primarySigner,
        uint256 maxCollateralLimit
    ) external onlyAdmin whenNotPaused {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();

        require(bank != address(0), "bank addr zero");
        require(primarySigner != address(0), "signer zero");
        require(maxCollateralLimit > 0, "limit zero");
        require(!cs.activeBanks[bank], "bank exists");

        cs.bankProfiles[bank] = ConsortiumStorage.BankProfile({
            name: bankName,
            primarySigner: primarySigner,
            maxCollateralLimit: maxCollateralLimit,
            riskRating: 50,
            isActive: true,
            joinedAt: block.timestamp,
            lastActivity: block.timestamp
        });

        cs.activeBanks[bank] = true;
        if (cs.bankIndexPlusOne[bank] == 0) {
            cs.registeredBanks.push(bank);
            cs.bankIndexPlusOne[bank] = cs.registeredBanks.length;
        }

        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        AccessControlLib.grantRole(ds, RoleConstants.CONSORTIUM_MEMBER_ROLE, bank);
        AccessControlLib.grantRole(ds, RoleConstants.BANK_REPRESENTATIVE_ROLE, primarySigner);

        emit BankRegistered(bank, bankName, primarySigner);
        emit BankActivationChanged(bank, true);
    }

    function updateBankProfile(
        address bank,
        string calldata bankName,
        address primarySigner,
        uint256 maxCollateralLimit,
        uint256 riskRating
    ) external onlyAdmin whenNotPaused {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        ConsortiumStorage.BankProfile storage profile = cs.bankProfiles[bank];
        require(cs.activeBanks[bank], "bank missing");
        require(primarySigner != address(0), "signer zero");
        require(maxCollateralLimit > 0, "limit zero");

        profile.name = bankName;
        profile.primarySigner = primarySigner;
        profile.maxCollateralLimit = maxCollateralLimit;
        profile.riskRating = riskRating;
        profile.lastActivity = block.timestamp;

        emit BankProfileUpdated(bank, bankName, primarySigner, maxCollateralLimit);
    }

    function setBankActivation(address bank, bool isActive) external onlyAdmin whenNotPaused {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        require(cs.bankProfiles[bank].joinedAt != 0, "not registered");
        if (!isActive) {
            InstitutionLifecycleStorage.InstitutionMode mode =
                InstitutionLifecycleStorage.layout().institutionMode[bank];
            if (mode != InstitutionLifecycleStorage.InstitutionMode.ORDERLY_EXIT &&
                mode != InstitutionLifecycleStorage.InstitutionMode.DEFAULTED &&
                mode != InstitutionLifecycleStorage.InstitutionMode.RESOLVED) {
                revert InstitutionLifecycleFacet.LifecycleDeactivationBlocked(bank, mode);
            }
        }
        cs.bankProfiles[bank].isActive = isActive;
        cs.activeBanks[bank] = isActive;
        cs.bankProfiles[bank].lastActivity = block.timestamp;

        emit BankActivationChanged(bank, isActive);
    }

    function configureBankWallet(
        address bank,
        uint256 assetType,
        address treasuryWallet,
        address collateralVault
    ) external whenNotPaused {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        require(cs.activeBanks[bank], "bank inactive");
        require(assetType != 0, "asset zero");
        require(treasuryWallet != address(0), "treasury zero");
        require(collateralVault != address(0), "vault zero");
        _requireAdminOrBankActor(bank);

        cs.bankWallets[bank][assetType] = ConsortiumStorage.WalletConfig({
            treasuryWallet: treasuryWallet,
            collateralVault: collateralVault
        });

        emit BankWalletConfigured(bank, assetType, treasuryWallet, collateralVault);
    }

    function getBankProfile(address bank) external view returns (ConsortiumStorage.BankProfile memory) {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        require(cs.bankProfiles[bank].joinedAt != 0, "not registered");
        return cs.bankProfiles[bank];
    }

    function getBankWallet(address bank, uint256 assetType) external view returns (ConsortiumStorage.WalletConfig memory) {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        require(cs.bankProfiles[bank].joinedAt != 0, "not registered");
        return cs.bankWallets[bank][assetType];
    }

    function _requireAdminOrBankActor(address bank) internal view {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        bool isAdmin = AccessControlLib.hasRole(ds, RoleConstants.ADMIN_ROLE, msg.sender);
        bool isPrimarySigner = ConsortiumStorage.layout().bankProfiles[bank].primarySigner == msg.sender;
        require(isAdmin || isPrimarySigner || msg.sender == bank, "unauthorized");
    }
}
