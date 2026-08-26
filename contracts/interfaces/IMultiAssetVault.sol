// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { ConsortiumStorage } from "../lib/ConsortiumStorage.sol";

interface IMultiAssetVault {
    event AssetTypeConfigured(uint256 indexed assetType, address tokenAddress, bool isActive);
    event BankCollateralFactorSet(address indexed bank, uint256 factorBps);
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

    function configureAssetType(uint256 assetType, ConsortiumStorage.AssetTypeConfig calldata config) external;

    function pledgeCollateral(uint256 assetType, uint256 amount) external;

    function releaseCollateral(uint256 assetType, uint256 amount, address recipient) external;

    function getCollateralPosition(address bank, uint256 assetType) external view returns (ConsortiumStorage.CollateralPosition memory);

    function getAssetType(uint256 assetType) external view returns (ConsortiumStorage.AssetTypeConfig memory);

    function setBankCollateralFactor(address bank, uint256 factorBps) external;

    function getBankCollateralFactor(address bank) external view returns (uint256);

    function getReimbursementEncumbered(address issuer) external view returns (uint256);

    function getAvailableReserve(address issuer) external view returns (uint256);
}
