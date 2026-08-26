const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../../helpers/roles");

describe("Consortium Phase 1 Foundations", function () {
    async function setupConsortiumFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const mockAsset18 = await MockERC20.deploy("MockAsset", "MA", ethers.parseEther("1000000"));
        await mockAsset18.waitForDeployment();
        const MockERC20Decimals = await ethers.getContractFactory("MockERC20Decimals");
        const mockAsset6 = await MockERC20Decimals.deploy("MockUSDC", "mUSDC", 6, ethers.parseUnits("5000000", 6));
        await mockAsset6.waitForDeployment();

        const { accessControl } = deployment.facets;
        const { owner, user1, minter } = deployment.signers;

        await grantRole(accessControl, ROLES.BANK_REPRESENTATIVE_ROLE, user1.address, owner);
        await grantRole(accessControl, ROLES.CONSORTIUM_MEMBER_ROLE, user1.address, owner);
        await grantRole(accessControl, ROLES.DEPOSIT_TOKEN_ISSUER_ROLE, minter.address, owner);

        return { ...deployment, mockAsset18, mockAsset6 };
    }

    let deployment;

    beforeEach(async function () {
        deployment = await loadFixture(setupConsortiumFixture);
    });

    it("registers bank, configures wallets, and maintains collateral accounting", async function () {
        const { facets, signers, mockAsset18, diamondAddress } = deployment;
        const bank = signers.user1;
        const collateralVault = signers.user2;
        const assetType = 1;
        const pledgeAmount = ethers.parseEther("1000");
        const mintAmount = ethers.parseEther("400");

        await facets.consortiumMembership
            .connect(signers.admin)
            .registerBank(bank.address, "Bank One", bank.address, ethers.parseEther("5000"));

        let profile = await facets.consortiumMembership.getBankProfile(bank.address);
        expect(profile.isActive).to.equal(true);
        expect(profile.primarySigner).to.equal(bank.address);

        await facets.consortiumMembership
            .connect(signers.admin)
            .configureBankWallet(bank.address, assetType, bank.address, collateralVault.address);

        const walletConfig = await facets.consortiumMembership.getBankWallet(bank.address, assetType);
        expect(walletConfig.treasuryWallet).to.equal(bank.address);
        expect(walletConfig.collateralVault).to.equal(collateralVault.address);

        await facets.multiAssetVault.connect(signers.admin).configureAssetType(assetType, {
            tokenAddress: await mockAsset18.getAddress(),
            decimals: 18,
            collateralFactorBps: 9000,
            haircutBps: 100,
            maxBankExposure: ethers.parseEther("1000000"),
            isActive: true
        });

        await mockAsset18.connect(signers.owner).transfer(bank.address, pledgeAmount);
        await mockAsset18.connect(bank).approve(diamondAddress, pledgeAmount);

        await facets.multiAssetVault.connect(bank).pledgeCollateral(assetType, pledgeAmount);
        const position = await facets.multiAssetVault.getCollateralPosition(bank.address, assetType);
        expect(position.pledgedAmount).to.equal(pledgeAmount);

        await mockAsset18.connect(collateralVault).approve(diamondAddress, pledgeAmount);

        let depositLedger = await facets.bankDepositToken.getDepositAccount(bank.address);
        expect(depositLedger.totalDeposits).to.equal(pledgeAmount);

        await facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, mintAmount);
        depositLedger = await facets.bankDepositToken.getDepositAccount(bank.address);
        expect(depositLedger.totalMinted).to.equal(mintAmount);

        const disallowedRelease = ethers.parseEther("700");
        await expect(
            facets.multiAssetVault.connect(bank).releaseCollateral(assetType, disallowedRelease, bank.address)
        ).to.be.revertedWith("insufficient remaining collateral");

        await facets.mintBurn.connect(signers.minter).burnForConsortiumBank(bank.address, mintAmount);
        depositLedger = await facets.bankDepositToken.getDepositAccount(bank.address);
        expect(depositLedger.totalBurned).to.equal(mintAmount);

        await facets.multiAssetVault.connect(bank).releaseCollateral(assetType, mintAmount, bank.address);

        const finalPosition = await facets.multiAssetVault.getCollateralPosition(bank.address, assetType);
        expect(finalPosition.pledgedAmount).to.equal(pledgeAmount - mintAmount);

        const finalLedger = await facets.bankDepositToken.getDepositAccount(bank.address);
        expect(finalLedger.totalDeposits).to.equal(pledgeAmount - mintAmount);
    });

    it("enforces asset/global limits and normalizes mixed decimals", async function () {
        const { facets, signers, mockAsset18, mockAsset6, diamondAddress } = deployment;
        const bank = signers.user1;
        const admin = signers.admin;
        const assetTypeUsdc = 2;
        const assetTypeAlt = 3;

        await facets.consortiumMembership
            .connect(admin)
            .registerBank(bank.address, "Bank Two", bank.address, ethers.parseEther("1000"));

        await facets.consortiumMembership
            .connect(admin)
            .configureBankWallet(bank.address, assetTypeUsdc, bank.address, bank.address);
        await facets.consortiumMembership
            .connect(admin)
            .configureBankWallet(bank.address, assetTypeAlt, bank.address, bank.address);

        await facets.multiAssetVault.connect(admin).configureAssetType(assetTypeUsdc, {
            tokenAddress: await mockAsset6.getAddress(),
            decimals: 6,
            collateralFactorBps: 9000,
            haircutBps: 0,
            maxBankExposure: ethers.parseUnits("1000", 6),
            isActive: true
        });

        await facets.multiAssetVault.connect(admin).configureAssetType(assetTypeAlt, {
            tokenAddress: await mockAsset18.getAddress(),
            decimals: 18,
            collateralFactorBps: 9000,
            haircutBps: 0,
            maxBankExposure: 0,
            isActive: true
        });

        const usdcAmount = ethers.parseUnits("1000", 6);
        await mockAsset6.connect(signers.owner).transfer(bank.address, usdcAmount * 2n);
        await mockAsset6.connect(bank).approve(diamondAddress, usdcAmount * 2n);

        await facets.multiAssetVault.connect(bank).pledgeCollateral(assetTypeUsdc, usdcAmount);

        await expect(
            facets.multiAssetVault.connect(bank).pledgeCollateral(assetTypeUsdc, usdcAmount)
        ).to.be.revertedWith("asset exposure exceeded");

        const mintAmount = ethers.parseEther("1000");
        await facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, mintAmount);

        await expect(
            facets.multiAssetVault.connect(bank).pledgeCollateral(assetTypeAlt, ethers.parseEther("1"))
        ).to.be.revertedWith("global collateral limit exceeded");

        await facets.mintBurn.connect(signers.minter).burnForConsortiumBank(bank.address, mintAmount);
    });

    describe("Collateral invariants", function () {
        it("Case 1: mintForConsortiumBank reverts when amount exceeds available collateral", async function () {
            const { facets, signers, mockAsset18, diamondAddress } = deployment;
            const bank = signers.user1;
            const collateralVault = signers.user2;
            const assetType = 1;
            const pledgeAmount = ethers.parseEther("1000");
            const mintAmount = ethers.parseEther("400");

            await facets.consortiumMembership
                .connect(signers.admin)
                .registerBank(bank.address, "Bank One", bank.address, ethers.parseEther("5000"));
            await facets.consortiumMembership
                .connect(signers.admin)
                .configureBankWallet(bank.address, assetType, bank.address, collateralVault.address);
            await facets.multiAssetVault.connect(signers.admin).configureAssetType(assetType, {
                tokenAddress: await mockAsset18.getAddress(),
                decimals: 18,
                collateralFactorBps: 9000,
                haircutBps: 100,
                maxBankExposure: ethers.parseEther("1000000"),
                isActive: true
            });

            await mockAsset18.connect(signers.owner).transfer(bank.address, pledgeAmount);
            await mockAsset18.connect(bank).approve(diamondAddress, pledgeAmount);
            await facets.multiAssetVault.connect(bank).pledgeCollateral(assetType, pledgeAmount);

            await facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, mintAmount);

            const excessAmount = ethers.parseEther("700"); // 400 + 700 > 1000
            await expect(
                facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, excessAmount)
            ).to.be.revertedWith("insufficient collateral");
        });

        it("Case 2: mintForConsortiumBank and burnForConsortiumBank revert for a wallet in recovery", async function () {
            const { facets, signers, mockAsset18, diamondAddress } = deployment;
            const bank = signers.user1;
            const assetType = 1;
            const pledgeAmount = ethers.parseEther("1000");
            const mintAmount = ethers.parseEther("400");

            await facets.consortiumMembership
                .connect(signers.admin)
                .registerBank(bank.address, "Bank One", bank.address, bank.address);
            await facets.consortiumMembership
                .connect(signers.admin)
                .configureBankWallet(bank.address, assetType, bank.address, bank.address);
            await facets.multiAssetVault.connect(signers.admin).configureAssetType(assetType, {
                tokenAddress: await mockAsset18.getAddress(),
                decimals: 18,
                collateralFactorBps: 9000,
                haircutBps: 100,
                maxBankExposure: ethers.parseEther("1000000"),
                isActive: true
            });

            await mockAsset18.connect(signers.owner).transfer(bank.address, pledgeAmount);
            await mockAsset18.connect(bank).approve(diamondAddress, pledgeAmount);
            await facets.multiAssetVault.connect(bank).pledgeCollateral(assetType, pledgeAmount);

            // Mint succeeds before recovery.
            await facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, mintAmount);

            // initiateRecovery requires the target wallet to hold CUSTODIAN_ROLE (it's a bank wallet gate).
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.CUSTODIAN_ROLE, bank.address);
            await facets.walletRecovery.connect(signers.admin).initiateRecovery(bank.address, 0);

            // Both consortium issuance paths are now blocked while the bank is in recovery.
            await expect(
                facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, mintAmount)
            ).to.be.revertedWithCustomError(facets.mintBurn, "WalletInRecovery");

            await expect(
                facets.mintBurn.connect(signers.minter).burnForConsortiumBank(bank.address, mintAmount)
            ).to.be.revertedWithCustomError(facets.mintBurn, "WalletInRecovery");
        });

        it("Case 3: burnForConsortiumBank reverts when amount exceeds outstanding", async function () {
            const { facets, signers, mockAsset18, diamondAddress } = deployment;
            const bank = signers.user1;
            const assetType = 1;
            const pledgeAmount = ethers.parseEther("1000");
            const mintAmount = ethers.parseEther("400");

            await facets.consortiumMembership
                .connect(signers.admin)
                .registerBank(bank.address, "Bank One", bank.address, bank.address);
            await facets.consortiumMembership
                .connect(signers.admin)
                .configureBankWallet(bank.address, assetType, bank.address, bank.address);
            await facets.multiAssetVault.connect(signers.admin).configureAssetType(assetType, {
                tokenAddress: await mockAsset18.getAddress(),
                decimals: 18,
                collateralFactorBps: 9000,
                haircutBps: 100,
                maxBankExposure: ethers.parseEther("1000000"),
                isActive: true
            });

            await mockAsset18.connect(signers.owner).transfer(bank.address, pledgeAmount);
            await mockAsset18.connect(bank).approve(diamondAddress, pledgeAmount);
            await facets.multiAssetVault.connect(bank).pledgeCollateral(assetType, pledgeAmount);

            await facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, mintAmount);

            const excessBurn = ethers.parseEther("500");
            await expect(
                facets.mintBurn.connect(signers.minter).burnForConsortiumBank(bank.address, excessBurn)
            ).to.be.revertedWith("insufficient outstanding");
        });

        it("Case 4: burnForConsortiumBank reverts when bank ERC20 balance < amount (stranded outstanding)", async function () {
            const { facets, signers, mockAsset18, diamondAddress } = deployment;
            const bank = signers.user1;
            const assetType = 1;
            const pledgeAmount = ethers.parseEther("1000");
            const mintAmount = ethers.parseEther("400");

            await facets.consortiumMembership
                .connect(signers.admin)
                .registerBank(bank.address, "Bank One", bank.address, bank.address);
            await facets.consortiumMembership
                .connect(signers.admin)
                .configureBankWallet(bank.address, assetType, bank.address, bank.address);
            await facets.multiAssetVault.connect(signers.admin).configureAssetType(assetType, {
                tokenAddress: await mockAsset18.getAddress(),
                decimals: 18,
                collateralFactorBps: 9000,
                haircutBps: 100,
                maxBankExposure: ethers.parseEther("1000000"),
                isActive: true
            });

            await mockAsset18.connect(signers.owner).transfer(bank.address, pledgeAmount);
            await mockAsset18.connect(bank).approve(diamondAddress, pledgeAmount);
            await facets.multiAssetVault.connect(bank).pledgeCollateral(assetType, pledgeAmount);

            await facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, mintAmount);

            // Bank destroys its own ERC20 balance (intentional divergence: ledger unchanged)
            await facets.mintBurn.connect(bank).burn(mintAmount);

            await expect(
                facets.mintBurn.connect(signers.minter).burnForConsortiumBank(bank.address, mintAmount)
            ).to.be.revertedWithCustomError(facets.mintBurn, "ERC20InsufficientBalance");
        });

        it("Case 7: releaseCollateral reverts when it would drop totalDeposits below outstanding", async function () {
            const { facets, signers, mockAsset18, diamondAddress } = deployment;
            const bank = signers.user1;
            const collateralVault = signers.user2;
            const assetType = 1;
            const pledgeAmount = ethers.parseEther("1000");
            const mintAmount = ethers.parseEther("400");

            await facets.consortiumMembership
                .connect(signers.admin)
                .registerBank(bank.address, "Bank One", bank.address, ethers.parseEther("5000"));
            await facets.consortiumMembership
                .connect(signers.admin)
                .configureBankWallet(bank.address, assetType, bank.address, collateralVault.address);
            await facets.multiAssetVault.connect(signers.admin).configureAssetType(assetType, {
                tokenAddress: await mockAsset18.getAddress(),
                decimals: 18,
                collateralFactorBps: 9000,
                haircutBps: 100,
                maxBankExposure: ethers.parseEther("1000000"),
                isActive: true
            });

            await mockAsset18.connect(signers.owner).transfer(bank.address, pledgeAmount);
            await mockAsset18.connect(bank).approve(diamondAddress, pledgeAmount);
            await facets.multiAssetVault.connect(bank).pledgeCollateral(assetType, pledgeAmount);

            await facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, mintAmount);

            const releaseAmount = ethers.parseEther("700"); // 1000 - 700 = 300 < 400 outstanding
            await expect(
                facets.multiAssetVault.connect(bank).releaseCollateral(assetType, releaseAmount, bank.address)
            ).to.be.revertedWith("insufficient remaining collateral");
        });

        it("Case 8: end-user burn does not change the bank ledger", async function () {
            const { facets, signers, mockAsset18, diamondAddress } = deployment;
            const bank = signers.user1;
            const user = signers.user2;
            const assetType = 1;
            const pledgeAmount = ethers.parseEther("1000");
            const mintAmount = ethers.parseEther("400");

            await facets.consortiumMembership
                .connect(signers.admin)
                .registerBank(bank.address, "Bank One", bank.address, bank.address);
            await facets.consortiumMembership
                .connect(signers.admin)
                .configureBankWallet(bank.address, assetType, bank.address, bank.address);
            await facets.multiAssetVault.connect(signers.admin).configureAssetType(assetType, {
                tokenAddress: await mockAsset18.getAddress(),
                decimals: 18,
                collateralFactorBps: 9000,
                haircutBps: 100,
                maxBankExposure: ethers.parseEther("1000000"),
                isActive: true
            });

            await mockAsset18.connect(signers.owner).transfer(bank.address, pledgeAmount);
            await mockAsset18.connect(bank).approve(diamondAddress, pledgeAmount);
            await facets.multiAssetVault.connect(bank).pledgeCollateral(assetType, pledgeAmount);

            // Mint to bank, then bank distributes to user via standard ERC-20 transfer.
            await facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, mintAmount);
            await facets.directTransfer.connect(bank).transfer(user.address, mintAmount);

            const supplyBefore = await facets.erc20.totalSupply();
            const ledgerBefore = await facets.bankDepositToken.getDepositAccount(bank.address);
            expect(ledgerBefore.totalBurned).to.equal(0n);

            await facets.mintBurn.connect(user).burn(mintAmount);

            const supplyAfter = await facets.erc20.totalSupply();
            const ledgerAfter = await facets.bankDepositToken.getDepositAccount(bank.address);

            expect(supplyAfter).to.equal(supplyBefore - mintAmount);
            expect(ledgerAfter.totalBurned).to.equal(ledgerBefore.totalBurned);
        });

        it("Case 10: outstanding underflow protection returns 0 when totalBurned >= totalMinted", async function () {
            const { facets, signers, mockAsset18, diamondAddress } = deployment;
            const bank = signers.user1;
            const assetType = 1;
            const pledgeAmount = ethers.parseEther("1000");

            await facets.consortiumMembership
                .connect(signers.admin)
                .registerBank(bank.address, "Bank One", bank.address, bank.address);
            await facets.consortiumMembership
                .connect(signers.admin)
                .configureBankWallet(bank.address, assetType, bank.address, bank.address);
            await facets.multiAssetVault.connect(signers.admin).configureAssetType(assetType, {
                tokenAddress: await mockAsset18.getAddress(),
                decimals: 18,
                collateralFactorBps: 9000,
                haircutBps: 100,
                maxBankExposure: ethers.parseEther("1000000"),
                isActive: true
            });

            await mockAsset18.connect(signers.owner).transfer(bank.address, pledgeAmount);
            await mockAsset18.connect(bank).approve(diamondAddress, pledgeAmount);
            await facets.multiAssetVault.connect(bank).pledgeCollateral(assetType, pledgeAmount);

            // Legacy paths are already unlocked by default fixture
            await facets.bankDepositToken.connect(signers.minter).recordMintBurn(bank.address, 50n, 0n);
            await facets.bankDepositToken.connect(signers.minter).recordMintBurn(bank.address, 0n, 50n);

            const ledgerBeforeMint = await facets.bankDepositToken.getDepositAccount(bank.address);
            expect(ledgerBeforeMint.totalMinted).to.equal(50n);
            expect(ledgerBeforeMint.totalBurned).to.equal(50n);

            // Outstanding is 0 (capped), so full deposits should be available again
            await expect(
                facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, pledgeAmount)
            ).to.not.be.reverted;
        });
    });
});
