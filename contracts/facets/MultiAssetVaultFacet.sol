// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol";
import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";
import { StorageLib } from "../lib/StorageLib.sol";
import { AccessControlLib } from "../lib/AccessControlLib.sol";
import { RoleConstants } from "../lib/RoleConstants.sol";
import { ConsortiumEmergencyLib } from "../lib/ConsortiumEmergencyLib.sol";
import { WalletRecoveryStorage } from "../lib/WalletRecoveryStorage.sol";
import { IWalletRecovery } from "../interfaces/IWalletRecovery.sol";
import { ReserveControlStorage } from "../lib/ReserveControlStorage.sol";
import { ReserveControlLib } from "../lib/ReserveControlLib.sol";

/**
 * @title MultiAssetVaultFacet
 * @notice Manages per-bank collateral wallets for consortium collateralization.
 *         Wave 3A: pledge is now two-phase (pending → settled) and release checks
 *         the dynamic floor via ReserveControlLib.
 */
contract MultiAssetVaultFacet is ReentrancyGuardBase {
    using SafeERC20 for IERC20;

    event AssetTypeConfigured(uint256 indexed assetType, address tokenAddress, bool isActive);
    event CollateralPledged(
        address indexed bank,
        uint256 indexed assetType,
        uint256 amount,
        address treasuryWallet,
        address collateralVault
    );
    event CollateralReleased(
        address indexed bank,
        uint256 indexed assetType,
        uint256 amount,
        address collateralVault,
        address recipient
    );
    event AssetPriceSet(uint256 indexed assetType, uint256 price, uint32 stalenessThreshold);
    event IssuerFloorSet(address indexed issuer, uint256 floor);
    event BankCollateralFactorSet(address indexed bank, uint256 factorBps);

    modifier onlyAdmin() {
        AccessControlLib.checkRole(RoleConstants.ADMIN_ROLE, msg.sender);
        _;
    }

    function configureAssetType(uint256 assetType, ConsortiumStorage.AssetTypeConfig calldata config) external onlyAdmin {
        require(assetType != 0, "asset zero");
        require(config.tokenAddress != address(0), "token zero");
        require(config.collateralFactorBps <= 10_000, "factor too high");

        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        cs.assetTypes[assetType] = ConsortiumStorage.AssetTypeConfig({
            tokenAddress: config.tokenAddress,
            decimals: config.decimals,
            collateralFactorBps: config.collateralFactorBps,
            haircutBps: config.haircutBps,
            maxBankExposure: config.maxBankExposure,
            isActive: config.isActive
        });

        emit AssetTypeConfigured(assetType, config.tokenAddress, config.isActive);
    }

    /// @notice Register an asset type for effectiveReserve iteration.
    ///         Call after configureAssetType for any asset type that should
    ///         count toward the issuer's reserve floor calculation.
    function registerAssetTypeForReserve(uint256 assetType) external onlyAdmin {
        require(assetType != 0, "asset zero");
        ReserveControlStorage.Layout storage rc = ReserveControlStorage.layout();
        uint256 len = rc.activeAssetTypes.length;
        for (uint256 i = 0; i < len; i++) {
            if (rc.activeAssetTypes[i] == assetType) return; // already registered
        }
        rc.activeAssetTypes.push(assetType);
    }

    /// @notice Set the oracle price for a reserve asset type.
    function setAssetPrice(
        uint256 assetType,
        uint256 price,
        uint32 stalenessThreshold
    ) external onlyAdmin {
        ReserveControlStorage.Layout storage rc = ReserveControlStorage.layout();
        rc.assetPrices[assetType] = ReserveControlStorage.AssetPrice({
            price: price,
            updatedAt: uint40(block.timestamp),
            stalenessThreshold: stalenessThreshold
        });
        emit AssetPriceSet(assetType, price, stalenessThreshold);
    }

    /// @notice Set the dynamic reserve floor for an issuer (18-decimal T3-equivalent value).
    ///         A floor of 0 disables floor enforcement for that issuer.
    function setIssuerFloor(address issuer, uint256 floor) external onlyAdmin {
        ReserveControlStorage.layout().issuerFloor[issuer] = floor;
        emit IssuerFloorSet(issuer, floor);
    }

    /// @notice Set the effective collateral factor for a bank (basis points, max 10000).
    ///         Set to 0 to restore the default (10_000 = 100%). To block minting entirely,
    ///         use ConsortiumEmergencyFacet — a stored 0 is treated as 10_000 by the mint check.
    ///         Wave 4 sets real sub-100% policy values.
    function setBankCollateralFactor(address bank, uint256 factorBps) external onlyAdmin {
        require(factorBps <= 10_000, "factor exceeds 100%");
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        require(cs.activeBanks[bank], "bank not registered");
        cs.bankCollateralFactorBps[bank] = factorBps;
        emit BankCollateralFactorSet(bank, factorBps);
    }

    /// @notice Get the effective collateral factor for a bank.
    ///         Returns 10000 (100%) if no factor has been explicitly set.
    function getBankCollateralFactor(address bank) external view returns (uint256) {
        uint256 factorBps = ConsortiumStorage.layout().bankCollateralFactorBps[bank];
        return factorBps == 0 ? 10_000 : factorBps;
    }

    /// @notice Two-phase collateral pledge.
    ///         Phase 1: record pending in ReserveControlStorage before token transfer.
    ///         Phase 2: confirm settled in ReserveControlStorage after transfer succeeds.
    ///         ConsortiumStorage.depositAccounts is updated for backward compat with
    ///         mintForConsortiumBank's collateral sufficiency check.
    function pledgeCollateral(uint256 assetType, uint256 amount) external nonReentrant {
        require(amount > 0, "amount zero");
        ConsortiumEmergencyLib.enforceOperationActive(ConsortiumEmergencyLib.OP_PLEDGE);
        if (WalletRecoveryStorage.layout().activeRecoveryCount[msg.sender] > 0) {
            revert IWalletRecovery.WalletInRecovery(msg.sender);
        }
        (ConsortiumStorage.AssetTypeConfig memory asset, ConsortiumStorage.WalletConfig memory wallets) =
            _validateBankAndAsset(msg.sender, assetType);

        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        ConsortiumStorage.BankProfile storage profile = cs.bankProfiles[msg.sender];
        ConsortiumStorage.CollateralPosition storage position = cs.bankCollateralPositions[msg.sender][assetType];
        ConsortiumStorage.AssetTypeConfig memory localAsset = asset;

        if (asset.maxBankExposure > 0) {
            require(position.pledgedAmount + amount <= asset.maxBankExposure, "asset exposure exceeded");
        }

        uint256 normalizedAmount = _normalizeAmount(localAsset, amount);
        if (profile.maxCollateralLimit > 0) {
            uint256 newTotal = cs.bankTotalCollateralValue[msg.sender] + normalizedAmount;
            require(newTotal <= profile.maxCollateralLimit, "global collateral limit exceeded");
            cs.bankTotalCollateralValue[msg.sender] = newTotal;
        } else {
            cs.bankTotalCollateralValue[msg.sender] += normalizedAmount;
        }

        // Phase 1: record pending before transfer
        ReserveControlLib.recordPendingPledge(msg.sender, assetType, amount);

        // Transfer tokens to vault
        IERC20(asset.tokenAddress).safeTransferFrom(wallets.treasuryWallet, wallets.collateralVault, amount);

        // Phase 2: confirm settled after transfer succeeds
        ReserveControlLib.confirmPledge(msg.sender, assetType, amount);

        // Legacy accounting (backward compat with mintForConsortiumBank)
        position.pledgedAmount += amount;
        position.lastUpdated = block.timestamp;
        ConsortiumStorage.DepositTokenAccount storage ledger = cs.depositAccounts[msg.sender];
        ledger.totalDeposits += normalizedAmount;
        cs.aggregateDepositBalance += normalizedAmount;

        emit CollateralPledged(msg.sender, assetType, amount, wallets.treasuryWallet, wallets.collateralVault);
    }

    /// @notice Floor-checked collateral release.
    ///         ReserveControlLib.releaseWithFloorCheck deducts from settled reserve and
    ///         reverts if the post-release effective reserve falls below issuerFloor.
    ///         Only settled (not pending) quantity can be released.
    function releaseCollateral(uint256 assetType, uint256 amount, address recipient) external nonReentrant {
        require(amount > 0, "amount zero");
        ConsortiumEmergencyLib.enforceOperationActive(ConsortiumEmergencyLib.OP_RELEASE);
        if (WalletRecoveryStorage.layout().activeRecoveryCount[msg.sender] > 0) {
            revert IWalletRecovery.WalletInRecovery(msg.sender);
        }
        (ConsortiumStorage.AssetTypeConfig memory asset, ConsortiumStorage.WalletConfig memory wallets) =
            _validateBankAndAsset(msg.sender, assetType);

        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        ConsortiumStorage.CollateralPosition storage position = cs.bankCollateralPositions[msg.sender][assetType];
        require(position.pledgedAmount >= amount, "insufficient collateral");

        address payoutTarget = recipient == address(0) ? wallets.treasuryWallet : recipient;
        ConsortiumStorage.DepositTokenAccount storage ledger = cs.depositAccounts[msg.sender];
        uint256 outstanding = _getOutstandingMinted(ledger);
        uint256 normalizedAmount = _normalizeAmount(asset, amount);
        require(ledger.totalDeposits >= normalizedAmount, "ledger underflow");
        // Wave 4 PRECONDITION: when bankCollateralFactorBps < 10_000 is in use, this check
        // must become (totalDeposits - normalizedAmount) * factorBps / 10_000 >= outstanding
        // to prevent releasing collateral that would leave the bank over-issued relative to
        // its declared factor. Until Wave 4, only set bankCollateralFactorBps = 10_000 (default).
        require(ledger.totalDeposits - normalizedAmount >= outstanding, "insufficient remaining collateral");

        // Floor check: deducts from ReserveControlStorage settled; reverts if below floor
        ReserveControlLib.releaseWithFloorCheck(msg.sender, assetType, amount);

        // Move tokens after floor check passes
        IERC20(asset.tokenAddress).safeTransferFrom(wallets.collateralVault, payoutTarget, amount);

        // Legacy accounting
        position.pledgedAmount -= amount;
        position.lastUpdated = block.timestamp;
        ledger.totalDeposits -= normalizedAmount;
        require(cs.aggregateDepositBalance >= normalizedAmount, "aggregate underflow");
        cs.aggregateDepositBalance -= normalizedAmount;
        require(cs.bankTotalCollateralValue[msg.sender] >= normalizedAmount, "collateral accounting underflow");
        cs.bankTotalCollateralValue[msg.sender] -= normalizedAmount;

        emit CollateralReleased(msg.sender, assetType, amount, wallets.collateralVault, payoutTarget);
    }

    function getCollateralPosition(address bank, uint256 assetType) external view returns (ConsortiumStorage.CollateralPosition memory) {
        return ConsortiumStorage.layout().bankCollateralPositions[bank][assetType];
    }

    function getAssetType(uint256 assetType) external view returns (ConsortiumStorage.AssetTypeConfig memory) {
        return ConsortiumStorage.layout().assetTypes[assetType];
    }

    function getReservePosition(address issuer, uint256 assetType) external view returns (ReserveControlStorage.ReservePosition memory) {
        return ReserveControlStorage.layout().reservePositions[
            ReserveControlStorage.positionKey(issuer, assetType)
        ];
    }

    function getEffectiveReserve(address issuer) external view returns (uint256) {
        return ReserveControlLib.effectiveReserve(issuer);
    }

    function getIssuerFloor(address issuer) external view returns (uint256) {
        return ReserveControlStorage.layout().issuerFloor[issuer];
    }

    /// @notice Pending interbank reimbursement encumbrance (18-decimal) for an issuer.
    ///         Exposed for off-chain settlement reconciliation (Wave 6C): the bilateral-net
    ///         lien total should equal this value across the active cycle.
    function getReimbursementEncumbered(address issuer) external view returns (uint256) {
        return ReserveControlStorage.layout().reimbursementEncumbered[issuer];
    }

    /// @notice Effective reserve net of reimbursement encumbrance (18-decimal), saturating at zero.
    ///         Reconciliation solvency check: a healthy issuer keeps availableReserve > 0.
    function getAvailableReserve(address issuer) external view returns (uint256) {
        return ReserveControlLib.availableReserve(issuer);
    }

    function _validateBankAndAsset(address bank, uint256 assetType)
        internal
        view
        returns (ConsortiumStorage.AssetTypeConfig memory asset, ConsortiumStorage.WalletConfig memory wallets)
    {
        ConsortiumStorage.Layout storage cs = ConsortiumStorage.layout();
        require(cs.activeBanks[bank], "bank inactive");
        asset = cs.assetTypes[assetType];
        require(asset.isActive, "asset inactive");
        wallets = cs.bankWallets[bank][assetType];
        require(wallets.treasuryWallet != address(0), "wallet missing");
        require(wallets.collateralVault != address(0), "vault missing");
    }

    function _getOutstandingMinted(ConsortiumStorage.DepositTokenAccount storage account) internal view returns (uint256) {
        return account.totalMinted > account.totalBurned ? account.totalMinted - account.totalBurned : 0;
    }

    function _normalizeAmount(ConsortiumStorage.AssetTypeConfig memory asset, uint256 amount) internal pure returns (uint256) {
        if (asset.decimals == 18) {
            return amount;
        } else if (asset.decimals < 18) {
            return amount * (10 ** (18 - asset.decimals));
        } else {
            return amount / (10 ** (asset.decimals - 18));
        }
    }
}
