const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

// Import our test infrastructure
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");
const { getFormattedBalance } = require("../helpers/tokens");
const { AMOUNTS } = require("../helpers/constants");
const { expectEvent, expectRevert } = require("../helpers/assertions");

/**
 * T3TokenMintBurnFacet Unit Tests
 * 
 * Tests minting and burning functionality with proper role-based access control.
 */
describe("T3TokenMintBurnFacet Unit Tests", function () {
    let deployment;
    
    async function setupMintBurnFixture() {
        // Deploy diamond with all facets
        deployment = await deployT3DiamondFixture();
        
        // Setup roles only (no initial token balances for these tests)
        await setupTestRoles(deployment.facets, deployment.signers);
        
        return deployment;
    }
    
    beforeEach(async function () {
        deployment = await loadFixture(setupMintBurnFixture);
    });

    describe("Minting Operations", function () {
        it("should mint tokens to user with MINTER_ROLE", async function () {
            const { facets, signers } = deployment;
            const mintAmount = AMOUNTS.THOUSAND_TOKENS;
            
            await expectEvent(
                facets.mintBurn.connect(signers.minter).mint(signers.user1.address, mintAmount),
                facets.erc20,
                "Transfer",
                [ethers.ZeroAddress, signers.user1.address, mintAmount]
            );
            
            const balance = await facets.erc20.balanceOf(signers.user1.address);
            expect(balance).to.equal(mintAmount);
        });

        it("should increase total supply when minting", async function () {
            const { facets, signers } = deployment;
            const mintAmount = AMOUNTS.THOUSAND_TOKENS;
            
            const totalSupplyBefore = await facets.erc20.totalSupply();
            await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, mintAmount);
            const totalSupplyAfter = await facets.erc20.totalSupply();
            
            expect(totalSupplyAfter).to.equal(totalSupplyBefore + mintAmount);
        });

        it("should allow minting to multiple users", async function () {
            const { facets, signers } = deployment;
            const mintAmount = AMOUNTS.HUNDRED_TOKENS;
            
            await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, mintAmount);
            await facets.mintBurn.connect(signers.minter).mint(signers.user2.address, mintAmount);
            
            const user1Balance = await facets.erc20.balanceOf(signers.user1.address);
            const user2Balance = await facets.erc20.balanceOf(signers.user2.address);
            
            expect(user1Balance).to.equal(mintAmount);
            expect(user2Balance).to.equal(mintAmount);
        });

        it("should allow minting large amounts", async function () {
            const { facets, signers } = deployment;
            const largeAmount = ethers.parseEther("1000000"); // 1 million tokens
            
            await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, largeAmount);
            
            const balance = await facets.erc20.balanceOf(signers.user1.address);
            expect(balance).to.equal(largeAmount);
        });

        it("should reject minting with zero amount", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.mintBurn.connect(signers.minter).mint(signers.user1.address, 0)
            ).to.be.revertedWithCustomError(facets.mintBurn, "MintAmountZero");
        });

        it("should reject minting to zero address", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.mintBurn.connect(signers.minter).mint(ethers.ZeroAddress, AMOUNTS.HUNDRED_TOKENS)
            ).to.be.revertedWithCustomError(facets.mintBurn, "MintToZeroAddress");
        });

        it("should reject minting from non-minter", async function () {
            const { facets, signers } = deployment;

            await expect(
                facets.mintBurn.connect(signers.user1).mint(signers.user2.address, AMOUNTS.HUNDRED_TOKENS)
            ).to.be.revertedWithCustomError(facets.mintBurn, "UnauthorizedRole");
        });

        it("should reject minting to a wallet in recovery (H-02 quarantine)", async function () {
            const { facets, signers } = deployment;

            // custodian1 has CUSTODIAN_ROLE; admin has ADMIN_ROLE — both required for non-KeyRotation recovery
            await facets.walletRecovery.connect(signers.admin).initiateRecovery(signers.custodian1.address, 0);

            await expect(
                facets.mintBurn.connect(signers.minter).mint(signers.custodian1.address, AMOUNTS.HUNDRED_TOKENS)
            ).to.be.revertedWithCustomError(facets.mintBurn, "WalletInRecovery")
             .withArgs(signers.custodian1.address);
        });
    });

    describe("Burning Operations", function () {
        beforeEach(async function () {
            // Setup some tokens to burn in each test
            const { facets, signers } = deployment;
            await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, AMOUNTS.THOUSAND_TOKENS);
            await facets.mintBurn.connect(signers.minter).mint(signers.user2.address, AMOUNTS.HUNDRED_TOKENS);
        });

        it("should allow user to burn their own tokens", async function () {
            const { facets, signers } = deployment;
            const burnAmount = AMOUNTS.HUNDRED_TOKENS;
            
            await expectEvent(
                facets.mintBurn.connect(signers.user1).burn(burnAmount),
                facets.erc20,
                "Transfer",
                [signers.user1.address, ethers.ZeroAddress, burnAmount]
            );
            
            const balance = await facets.erc20.balanceOf(signers.user1.address);
            expect(balance).to.equal(AMOUNTS.THOUSAND_TOKENS - burnAmount);
        });

        it("should decrease total supply when burning", async function () {
            const { facets, signers } = deployment;
            const burnAmount = AMOUNTS.HUNDRED_TOKENS;
            
            const totalSupplyBefore = await facets.erc20.totalSupply();
            await facets.mintBurn.connect(signers.user1).burn(burnAmount);
            const totalSupplyAfter = await facets.erc20.totalSupply();
            
            expect(totalSupplyAfter).to.equal(totalSupplyBefore - burnAmount);
        });

        it("should allow burning all user tokens", async function () {
            const { facets, signers } = deployment;
            const userBalance = await facets.erc20.balanceOf(signers.user2.address);
            
            await facets.mintBurn.connect(signers.user2).burn(userBalance);
            
            const balanceAfter = await facets.erc20.balanceOf(signers.user2.address);
            expect(balanceAfter).to.equal(0);
        });

        it("should reject burning more than balance", async function () {
            const { facets, signers } = deployment;
            const userBalance = await facets.erc20.balanceOf(signers.user2.address);
            const excessiveAmount = userBalance + AMOUNTS.ONE_TOKEN;
            
            await expect(
                facets.mintBurn.connect(signers.user2).burn(excessiveAmount)
            ).to.be.revertedWithCustomError(facets.mintBurn, "ERC20InsufficientBalance");
        });

        it("should reject burning zero amount", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.mintBurn.connect(signers.user1).burn(0)
            ).to.be.revertedWithCustomError(facets.mintBurn, "BurnAmountZero");
        });

        it("should reject burning from zero balance", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.mintBurn.connect(signers.user3).burn(AMOUNTS.ONE_TOKEN)
            ).to.be.revertedWithCustomError(facets.mintBurn, "ERC20InsufficientBalance");
        });
    });

    describe("Admin Burn Operations", function () {
        beforeEach(async function () {
            // Setup tokens for admin burn tests
            const { facets, signers } = deployment;
            await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, AMOUNTS.THOUSAND_TOKENS);
            await facets.mintBurn.connect(signers.minter).mint(signers.user2.address, AMOUNTS.HUNDRED_TOKENS);
        });

        it("should allow owner (BURNER_ROLE) to burn from any address", async function () {
            const { facets, signers } = deployment;
            const burnAmount = AMOUNTS.HUNDRED_TOKENS;

            await expectEvent(
                facets.mintBurn.connect(signers.owner).burnFrom(signers.user1.address, burnAmount),
                facets.erc20,
                "Transfer",
                [signers.user1.address, ethers.ZeroAddress, burnAmount]
            );
            
            const balance = await facets.erc20.balanceOf(signers.user1.address);
            expect(balance).to.equal(AMOUNTS.THOUSAND_TOKENS - burnAmount);
        });

        it("should reject burnFrom from non-admin", async function () {
            const { facets, signers } = deployment;
            
            await expect(
                facets.mintBurn.connect(signers.user1).burnFrom(signers.user2.address, AMOUNTS.TEN_TOKENS)
            ).to.be.revertedWithCustomError(facets.mintBurn, "UnauthorizedRole");
        });

        it("should reject burnFrom with insufficient balance", async function () {
            const { facets, signers } = deployment;
            const userBalance = await facets.erc20.balanceOf(signers.user2.address);
            const excessiveAmount = userBalance + AMOUNTS.ONE_TOKEN;

            await expect(
                facets.mintBurn.connect(signers.owner).burnFrom(signers.user2.address, excessiveAmount)
            ).to.be.revertedWithCustomError(facets.mintBurn, "ERC20InsufficientBalance");
        });
    });

    describe("Role-Based Access Control", function () {
        it("should allow only MINTER_ROLE to mint", async function () {
            const { facets, signers } = deployment;
            
            // Admin should not be able to mint (doesn't have MINTER_ROLE)
            await expect(
                facets.mintBurn.connect(signers.admin).mint(signers.user1.address, AMOUNTS.HUNDRED_TOKENS)
            ).to.be.revertedWithCustomError(facets.mintBurn, "UnauthorizedRole");
            
            // Regular user should not be able to mint (doesn't have MINTER_ROLE)
            await expect(
                facets.mintBurn.connect(signers.user1).mint(signers.user2.address, AMOUNTS.HUNDRED_TOKENS)
            ).to.be.revertedWithCustomError(facets.mintBurn, "UnauthorizedRole");
        });

        it("should allow only BURNER_ROLE to burnFrom", async function () {
            const { facets, signers } = deployment;
            await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, AMOUNTS.HUNDRED_TOKENS);
            
            // Minter should not be able to burnFrom (doesn't have BURNER_ROLE)
            await expect(
                facets.mintBurn.connect(signers.minter).burnFrom(signers.user1.address, AMOUNTS.TEN_TOKENS)
            ).to.be.revertedWithCustomError(facets.mintBurn, "UnauthorizedRole");

            // Regular user should not be able to burnFrom (doesn't have BURNER_ROLE)
            await expect(
                facets.mintBurn.connect(signers.user2).burnFrom(signers.user1.address, AMOUNTS.TEN_TOKENS)
            ).to.be.revertedWithCustomError(facets.mintBurn, "UnauthorizedRole");
        });
    });

    describe("mintForConsortiumBank", function () {
        const ASSET_TYPE = 1;
        const USDC_PLEDGE = ethers.parseUnits("1000", 6); // 1000 USDC (6 decimals)
        const NORMALIZED_DEPOSITS = ethers.parseEther("1000"); // 1000e18 after normalization

        async function setupConsortiumMintFixture() {
            const dep = await deployT3DiamondFixture();
            const { facets, signers, diamondAddress } = dep;
            await setupTestRoles(facets, signers);

            // Deploy mock USDC (6 decimals)
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            const usdc = await MockERC20.deploy("Mock USDC", "mUSDC", ethers.parseUnits("1000000", 6));
            await usdc.waitForDeployment();

            // Configure asset type
            await facets.multiAssetVault.connect(signers.admin).configureAssetType(ASSET_TYPE, {
                tokenAddress: await usdc.getAddress(),
                decimals: 6,
                collateralFactorBps: 10000,
                haircutBps: 0,
                maxBankExposure: 0,
                isActive: true,
            });

            // Register bank (user1); treasury = vault = bank for test simplicity
            const bank = signers.user1;
            await facets.consortiumMembership.connect(signers.admin).registerBank(
                bank.address, "Test Bank", bank.address, ethers.parseEther("10000000")
            );
            await facets.consortiumMembership.connect(signers.admin).configureBankWallet(
                bank.address, ASSET_TYPE, bank.address, bank.address
            );

            // Fund bank and approve diamond
            await usdc.connect(signers.owner).transfer(bank.address, USDC_PLEDGE);
            await usdc.connect(bank).approve(diamondAddress, USDC_PLEDGE);

            return { ...dep, usdc, bank };
        }

        async function setupWithPledgeFixture() {
            const base = await loadFixture(setupConsortiumMintFixture);
            await base.facets.multiAssetVault.connect(base.bank).pledgeCollateral(ASSET_TYPE, USDC_PLEDGE);
            return base;
        }

        it("default factor (unset → 10000): mint succeeds at exact collateral", async function () {
            const { facets, signers, bank } = await loadFixture(setupWithPledgeFixture);
            await expect(
                facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, NORMALIZED_DEPOSITS)
            ).to.emit(facets.mintBurn, "ConsortiumTokensMinted")
              .withArgs(bank.address, bank.address, NORMALIZED_DEPOSITS);
            expect(await facets.erc20.balanceOf(bank.address)).to.equal(NORMALIZED_DEPOSITS);
        });

        it("default factor: mint fails when amount exceeds deposits", async function () {
            const { facets, signers, bank } = await loadFixture(setupWithPledgeFixture);
            await expect(
                facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, NORMALIZED_DEPOSITS + 1n)
            ).to.be.revertedWith("insufficient collateral");
        });

        it("explicit factor=10000: same as default", async function () {
            const { facets, signers, bank } = await loadFixture(setupWithPledgeFixture);
            await facets.multiAssetVault.connect(signers.admin).setBankCollateralFactor(bank.address, 10000);
            await expect(
                facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, NORMALIZED_DEPOSITS)
            ).to.emit(facets.mintBurn, "ConsortiumTokensMinted");
        });

        it("factor=8000: blocks mint above adjusted capacity", async function () {
            const { facets, signers, bank } = await loadFixture(setupWithPledgeFixture);
            await facets.multiAssetVault.connect(signers.admin).setBankCollateralFactor(bank.address, 8000);
            const adjustedCapacity = NORMALIZED_DEPOSITS * 8000n / 10000n; // 800e18
            await expect(
                facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, adjustedCapacity + 1n)
            ).to.be.revertedWith("insufficient collateral");
        });

        it("factor=8000: allows mint within adjusted capacity", async function () {
            const { facets, signers, bank } = await loadFixture(setupWithPledgeFixture);
            await facets.multiAssetVault.connect(signers.admin).setBankCollateralFactor(bank.address, 8000);
            const adjustedCapacity = NORMALIZED_DEPOSITS * 8000n / 10000n; // 800e18
            await expect(
                facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, adjustedCapacity)
            ).to.emit(facets.mintBurn, "ConsortiumTokensMinted");
            expect(await facets.erc20.balanceOf(bank.address)).to.equal(adjustedCapacity);
        });

        it("getBankCollateralFactor returns 10000 when unset", async function () {
            const { facets, bank } = await loadFixture(setupConsortiumMintFixture);
            expect(await facets.multiAssetVault.getBankCollateralFactor(bank.address)).to.equal(10000n);
        });

        it("factor=0 restores default 1:1 (NOT a lockdown — stored 0 == unset)", async function () {
            const { facets, signers, bank } = await loadFixture(setupWithPledgeFixture);
            // Set to 8000, then clear to 0 (restore default)
            await facets.multiAssetVault.connect(signers.admin).setBankCollateralFactor(bank.address, 8000);
            await facets.multiAssetVault.connect(signers.admin).setBankCollateralFactor(bank.address, 0);
            // Getter reflects default
            expect(await facets.multiAssetVault.getBankCollateralFactor(bank.address)).to.equal(10000n);
            // Mint at full 1:1 capacity succeeds (would fail at 8000 factor)
            await expect(
                facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, NORMALIZED_DEPOSITS)
            ).to.emit(facets.mintBurn, "ConsortiumTokensMinted");
        });

        it("setBankCollateralFactor reverts for unregistered bank", async function () {
            const { facets, signers } = await loadFixture(setupConsortiumMintFixture);
            await expect(
                facets.multiAssetVault.connect(signers.admin).setBankCollateralFactor(signers.user2.address, 9000)
            ).to.be.revertedWith("bank not registered");
        });

        describe("attribution conservation — G.0.a production path", function () {
            // Production manifest only — no IssuanceAccountingHarness or test-only facets.
            // R-06/R-12: runtime conservation test that exercises the real mintAttributed wiring.

            it("totalAttributedOutstanding equals totalSupply after mint when attribution initialized", async function () {
                const { facets, signers, bank } = await loadFixture(setupWithPledgeFixture);
                // legacyMintUnlocked=true from setupTestRoles — _guardLegacyMint bypassed
                // DEFAULT_ADMIN_ROLE is held by signers.owner (deployer), not signers.admin
                await facets.issuanceControl.connect(signers.owner).initializeClaimAttribution();

                const mintAmount = NORMALIZED_DEPOSITS / 2n;
                await facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, mintAmount);

                const totalSupply = await facets.erc20.totalSupply();
                const attributed = await facets.issuanceControl.getTotalAttributedOutstanding();
                const issuerOutstanding = await facets.issuanceControl.getIssuerAttributedOutstanding(bank.address);

                expect(attributed).to.equal(totalSupply);
                expect(issuerOutstanding).to.equal(mintAmount);
            });

            it("LegacyIssuanceDisabled: reverts when initialized and legacyMintUnlocked=false", async function () {
                // Confirms the guard design: once attribution is initialized, Wave 4 path
                // must be used (not the legacy consortium mint path).
                const { facets, signers, bank } = await loadFixture(setupWithPledgeFixture);
                await facets.issuanceControl.connect(signers.owner).setLegacyMintUnlocked(false);
                await facets.issuanceControl.connect(signers.owner).initializeClaimAttribution();

                await expect(
                    facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, NORMALIZED_DEPOSITS)
                ).to.be.revertedWithCustomError(facets.mintBurn, "LegacyIssuanceDisabled");
            });

            it("ConsortiumBurnRequiresAttributedPath: burnForConsortiumBank reverts when attribution initialized", async function () {
                // Guard prevents _internal_burn from decrementing totalSupply without
                // updating totalAttributedOutstanding, which would permanently brick
                // all future mintForConsortiumBank calls.
                // Init must happen at supply==0; mint after initialization uses mintAttributed.
                const { facets, signers, bank } = await loadFixture(setupWithPledgeFixture);
                await facets.issuanceControl.connect(signers.owner).initializeClaimAttribution();
                await facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, NORMALIZED_DEPOSITS / 2n);

                await expect(
                    facets.mintBurn.connect(signers.minter).burnForConsortiumBank(bank.address, NORMALIZED_DEPOSITS / 4n)
                ).to.be.revertedWithCustomError(facets.mintBurn, "ConsortiumBurnRequiresAttributedPath");
            });

            it("ClaimAttributionMustInitAtZeroSupply: initializeClaimAttribution reverts when supply > 0", async function () {
                // Pre-condition: any supply minted before initializeClaimAttribution() creates
                // unattributed supply that would permanently desync the attribution subledger.
                // The guard now blocks initialization itself, preventing the footgun entirely.
                const { facets, signers } = await loadFixture(setupWithPledgeFixture);
                await facets.mintBurn.connect(signers.minter).mint(signers.user2.address, NORMALIZED_DEPOSITS / 4n);

                await expect(
                    facets.issuanceControl.connect(signers.owner).initializeClaimAttribution()
                ).to.be.revertedWithCustomError(facets.issuanceControl, "ClaimAttributionMustInitAtZeroSupply");
            });
        });
    });

    describe("Supply Tracking", function () {
        it("should maintain accurate total supply through mint/burn cycles", async function () {
            const { facets, signers } = deployment;
            
            const initialSupply = await facets.erc20.totalSupply();
            
            // Mint tokens
            await facets.mintBurn.connect(signers.minter).mint(signers.user1.address, AMOUNTS.THOUSAND_TOKENS);
            const afterMint = await facets.erc20.totalSupply();
            expect(afterMint).to.equal(initialSupply + AMOUNTS.THOUSAND_TOKENS);
            
            // Burn half
            await facets.mintBurn.connect(signers.user1).burn(AMOUNTS.HUNDRED_TOKENS);
            const afterBurn = await facets.erc20.totalSupply();
            expect(afterBurn).to.equal(afterMint - AMOUNTS.HUNDRED_TOKENS);
            
            // Burner-role burn the rest
            await facets.mintBurn.connect(signers.owner).burnFrom(signers.user1.address, AMOUNTS.THOUSAND_TOKENS - AMOUNTS.HUNDRED_TOKENS);
            const finalSupply = await facets.erc20.totalSupply();
            expect(finalSupply).to.equal(initialSupply);
        });
    });
});