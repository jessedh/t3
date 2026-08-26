const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../helpers/roles");
const { setupTestBalances } = require("../helpers/tokens");

const SCREENING_CLEAR = 1;
const SCREENING_BLOCKED = 3;

const KYC_ENFORCE_ACTIVE = ethers.keccak256(ethers.toUtf8Bytes("kyc_enforce_active"));
const TRAVEL_RULE_ENFORCE_ACTIVE = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_enforce_active"));
const TRAVEL_RULE_THRESHOLD_USD = ethers.keccak256(ethers.toUtf8Bytes("travel_rule_threshold_usd"));

describe("ComplianceEnforcement (Wave 8B)", function () {
    const ASSET_TYPE = 1;
    const USDC_PLEDGE = ethers.parseUnits("1000", 6);
    const NORMALIZED_DEPOSITS = ethers.parseEther("1000");
    const ONE_HOUR = 3600;

    function kycData(future = true) {
        const validated = 1;
        const expires = future ? Math.floor(Date.now() / 1000) + 86400 : 0;
        return { validated, expires };
    }

    async function setupFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);
        await setupTestBalances(deployment.facets, deployment.signers);

        const { facets, signers, diamondAddress } = deployment;
        const { owner, admin, custodian1, custodian2, user1, user2, user3, minter } = signers;

        // Deploy mock USDC and configure a bank for BANK_MINT tests
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20.deploy("Mock USDC", "mUSDC", ethers.parseUnits("1000000", 6));
        await usdc.waitForDeployment();

        await facets.multiAssetVault.connect(admin).configureAssetType(ASSET_TYPE, {
            tokenAddress: await usdc.getAddress(),
            decimals: 6,
            collateralFactorBps: 10000,
            haircutBps: 0,
            maxBankExposure: 0,
            isActive: true,
        });

        const bank = user3;
        await facets.consortiumMembership.connect(admin).registerBank(
            bank.address, "Test Bank", bank.address, ethers.parseEther("10000000")
        );
        await facets.consortiumMembership.connect(admin).configureBankWallet(
            bank.address, ASSET_TYPE, bank.address, bank.address
        );
        await usdc.connect(owner).transfer(bank.address, USDC_PLEDGE);
        await usdc.connect(bank).approve(diamondAddress, USDC_PLEDGE);
        await facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, USDC_PLEDGE);

        // Approve diamond to spend user1/user2 tokens for envelope creates
        await facets.erc20.connect(user1).approve(diamondAddress, ethers.parseEther("10000"));
        await facets.erc20.connect(user2).approve(diamondAddress, ethers.parseEther("10000"));

        return { ...deployment, usdc, bank };
    }

    describe("Gate OFF = no-op", function () {
        it("direct transfer to a non-KYC'd recipient succeeds", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { user1, user3 } = signers;

            expect(await facets.complianceConfig.isKycEnforceActive()).to.equal(false);
            await expect(
                facets.directTransfer.connect(user1).transfer(user3.address, ethers.parseEther("10"))
            ).not.to.be.reverted;
        });

        it("envelope create from a non-KYC'd sender succeeds", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { user3, user2 } = signers;

            const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR);
            await expect(
                facets.envelope.connect(user3).createEnvelope(
                    user2.address,
                    ethers.parseEther("10"),
                    commitWindowEnd,
                    0, // CRYPTO_DIRECT
                    0, // IMMEDIATE_FINALIZE
                    "0x"
                )
            ).not.to.be.reverted;
        });

        it("mintForConsortiumBank to a non-KYC'd bank succeeds", async function () {
            const { facets, signers, bank } = await loadFixture(setupFixture);
            const { minter } = signers;

            await expect(
                facets.mintBurn.connect(minter).mintForConsortiumBank(bank.address, NORMALIZED_DEPOSITS)
            ).not.to.be.reverted;
        });
    });

    describe("Gate ON blocks non-compliant forward legs", function () {
        it("WALLET_TRANSFER to a non-KYC'd recipient reverts ComplianceKycRequired", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, user3, custodian1 } = signers;

            const kyc = kycData();
            await facets.custodian.connect(custodian1).registerCustodiedWallet(user1.address, kyc.validated, kyc.expires);
            await facets.custodian.connect(custodian1).registerCustodiedWallet(user2.address, kyc.validated, kyc.expires);
            // user3 has no KYC

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            await expect(
                facets.directTransfer.connect(user1).transfer(user3.address, ethers.parseEther("10"))
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired")
                .withArgs(user3.address, 0); // Context.WALLET_TRANSFER = 0
        });

        it("ESCROW_IN create from a non-KYC'd sender reverts ComplianceKycRequired", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, user3, custodian1 } = signers;

            const kyc = kycData();
            await facets.custodian.connect(custodian1).registerCustodiedWallet(user1.address, kyc.validated, kyc.expires);
            await facets.custodian.connect(custodian1).registerCustodiedWallet(user2.address, kyc.validated, kyc.expires);
            // user3 has no KYC

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR);
            await expect(
                facets.envelope.connect(user3).createEnvelope(
                    user2.address,
                    ethers.parseEther("10"),
                    commitWindowEnd,
                    0,
                    0,
                    "0x"
                )
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired")
                .withArgs(user3.address, 1); // Context.ESCROW_IN = 1
        });

        it("BANK_MINT to a DEFAULTED-institution bank reverts ComplianceBankNotEligible", async function () {
            const { facets, signers, bank } = await loadFixture(setupFixture);
            const { owner, admin, minter } = signers;

            // Default the bank's institution mode
            await facets.institutionLifecycle.connect(admin).setInstitutionMode(
                bank.address,
                3 // DEFAULTED
            );

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            await expect(
                facets.mintBurn.connect(minter).mintForConsortiumBank(bank.address, NORMALIZED_DEPOSITS)
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceBankNotEligible")
                .withArgs(bank.address);
        });
    });

    describe("Gate ON allows compliant path", function () {
        it("KYC'd parties can transfer and create envelopes", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, custodian1 } = signers;

            const kyc = kycData();
            await facets.custodian.connect(custodian1).registerCustodiedWallet(user1.address, kyc.validated, kyc.expires);
            await facets.custodian.connect(custodian1).registerCustodiedWallet(user2.address, kyc.validated, kyc.expires);

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            await expect(
                facets.directTransfer.connect(user1).transfer(user2.address, ethers.parseEther("10"))
            ).not.to.be.reverted;

            const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR);
            await expect(
                facets.envelope.connect(user1).createEnvelope(
                    user2.address,
                    ethers.parseEther("10"),
                    commitWindowEnd,
                    0,
                    0,
                    "0x"
                )
            ).not.to.be.reverted;
        });
    });

    describe("Made-Whole non-regression: refunds exempt", function () {
        it("reverseEnvelope returns funds to a non-KYC'd sender with gate ON", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, custodian1 } = signers;

            // Create the envelope while gate is OFF so a non-KYC'd sender can escrow in
            const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR);
            await facets.envelope.connect(user1).createEnvelope(
                user2.address,
                ethers.parseEther("10"),
                commitWindowEnd,
                0,
                0,
                "0x"
            );
            const envelopeIds = await facets.envelope.getEnvelopesBySender(user1.address);
            const envelopeId = envelopeIds[envelopeIds.length - 1];

            // Now turn gate ON. user1 remains non-KYC'd; user2 is KYC'd.
            const kyc = kycData();
            await facets.custodian.connect(custodian1).registerCustodiedWallet(user2.address, kyc.validated, kyc.expires);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            // Reverse returns funds to sender without KYC check (refund leg is exempt)
            await expect(
                facets.envelope.connect(user1).reverseEnvelope(envelopeId, ethers.parseEther("10"))
            ).not.to.be.reverted;
        });
    });

    // -------------------------------------------------------------------------
    // Helper functions for the newly-relevant forward-leg tests below.
    // -------------------------------------------------------------------------
    async function kycWallet(facets, custodian, wallet) {
        const kyc = kycData();
        await facets.custodian.connect(custodian).registerCustodiedWallet(wallet.address, kyc.validated, kyc.expires);
    }

    async function enableScreening(facets, signers) {
        // DP-A: arm sanctions for an active institution so activeScopeCount > 0.
        const tx = await facets.institutionRegistry.connect(signers.admin).registerInstitution(
            "Sanctions Test Institution",
            ethers.ZeroHash,
            "",
            signers.admin.address
        );
        await tx.wait();
        const count = await facets.institutionRegistry.getInstitutionCount();
        const institutionId = await facets.institutionRegistry.getInstitutionAtIndex(count - 1n);
        await facets.complianceScreening.connect(signers.owner).setInstitutionSanctionsEnabled(institutionId, true);
        return institutionId;
    }

    async function createStandardEnvelope(facets, sender, recipient, amount, settlementType = 0, expirationBehavior = 0) {
        const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR);
        await facets.envelope.connect(sender).createEnvelope(
            recipient.address,
            amount,
            commitWindowEnd,
            settlementType,
            expirationBehavior,
            "0x"
        );
        const envelopeIds = await facets.envelope.getEnvelopesBySender(sender.address);
        return envelopeIds[envelopeIds.length - 1];
    }

    async function createChildEnvelope(facets, sender, recipient, amount, parentEnvelopeId) {
        // Child window must not exceed the parent's commit window.
        const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR / 2);
        await facets.envelopeInheritance.connect(sender).createChildEnvelope(
            parentEnvelopeId,
            recipient.address,
            amount,
            commitWindowEnd
        );
        const envelopeIds = await facets.envelope.getEnvelopesBySender(sender.address);
        return envelopeIds[envelopeIds.length - 1];
    }

    async function createSmartLockEnvelope(facets, sender, recipient, amount) {
        const fragment = ethers.hexlify(ethers.randomBytes(32));
        const nonce = ethers.hexlify(ethers.randomBytes(32));
        const hashCommitment = ethers.keccak256(ethers.concat([fragment, nonce]));
        const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR);
        await facets.smartLockEnvelope.connect(sender).createSmartLockEnvelope(
            recipient.address,
            amount,
            hashCommitment,
            nonce,
            commitWindowEnd,
            ethers.ZeroAddress
        );
        const envelopeIds = await facets.envelope.getEnvelopesBySender(sender.address);
        return { envelopeId: envelopeIds[envelopeIds.length - 1], fragment, nonce };
    }

    async function setupCambioIssuer(facets, signers, issuer) {
        await grantRole(facets.accessControl, ROLES.CAMBIO_ADMIN_ROLE, signers.admin.address, signers.owner);
        await grantRole(facets.accessControl, ROLES.CAMBIO_ISSUER_ROLE, issuer.address, signers.owner);
        await facets.cambioIssuer.connect(signers.admin).registerIssuer(issuer.address);
        await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
        // Raise commit-reveal threshold so small test notes can use direct redeemByNoteId
        await facets.cambioAdmin.connect(signers.admin).setCommitRevealThreshold(ethers.parseEther("1000"));
    }

    async function createCambioNote(facets, issuer, amount) {
        const phrase = "secret phrase";
        const noteSalt = ethers.hexlify(ethers.randomBytes(32));
        const phraseCommitment = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [phrase, noteSalt])
        );
        const deadline = (await time.latest()) + 86400;
        const tx = await facets.cambioEnvelope.connect(issuer).createCambioNote(
            amount,
            phraseCommitment,
            noteSalt,
            deadline,
            ""
        );
        const receipt = await tx.wait();
        const parsed = receipt.logs
            .map((l) => { try { return facets.cambioEnvelope.interface.parseLog(l); } catch { return null; } })
            .filter(Boolean)
            .find((l) => l.name === "CambioEnvelopeNoteCreated");
        return { noteId: parsed.args.noteId, phrase, noteSalt };
    }

    async function activateRecovery(facets, signers, oldWallet, newWallet) {
        const tx = await facets.walletRecovery.connect(signers.admin).initiateRecovery(oldWallet.address, 0);
        const receipt = await tx.wait();
        const parsed = receipt.logs
            .map((l) => { try { return facets.walletRecovery.interface.parseLog(l); } catch { return null; } })
            .filter(Boolean)
            .find((l) => l.name === "RecoveryInitiated");
        const recoveryId = parsed.args.recoveryId;
        await facets.walletRecovery.connect(signers.admin).designateSuccessor(recoveryId, newWallet.address);
        return recoveryId;
    }

    describe("Gate ON blocks newly-relevant forward release legs", function () {
        it("finalizeEnvelope recipient-release reverts when recipient is non-KYC'd", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, custodian1 } = signers;

            await kycWallet(facets, custodian1, user1);
            const envelopeId = await createStandardEnvelope(facets, user1, user2, ethers.parseEther("10"));

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            await expect(
                facets.envelope.connect(user1).finalizeEnvelope(envelopeId)
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired")
                .withArgs(user2.address, 2); // Context.ESCROW_RELEASE = 2
        });

        it("processExpiration auto-finalize (PENDING_FIAT) reverts when recipient is non-KYC'd", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, admin, user1, user2, custodian1 } = signers;

            await kycWallet(facets, custodian1, user1);
            const envelopeId = await createStandardEnvelope(
                facets, user1, user2, ethers.parseEther("10"), 1 /* FIAT_INSTITUTIONAL */, 0
            );

            // Move past commit window and finalize into PENDING_FIAT while gate is OFF
            await time.increase(ONE_HOUR + 1);
            await facets.envelope.connect(user1).finalizeEnvelope(envelopeId);
            const [,,,,,, state] = await facets.envelope.getEnvelope(envelopeId);
            expect(state).to.equal(6); // ES_PENDING_FIAT

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            // Move past the clawback window so processExpiration auto-confirms
            await time.increase(ONE_HOUR * 48 + 1);

            await expect(
                facets.envelope.connect(admin).processExpiration(envelopeId)
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired")
                .withArgs(user2.address, 2);
        });

        it("confirmFiatDelivery reverts when recipient is non-KYC'd", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, admin, user1, user2, custodian1 } = signers;

            await kycWallet(facets, custodian1, user1);
            const envelopeId = await createStandardEnvelope(
                facets, user1, user2, ethers.parseEther("10"), 1 /* FIAT_INSTITUTIONAL */, 0
            );

            await time.increase(ONE_HOUR + 1);
            await facets.envelope.connect(user1).finalizeEnvelope(envelopeId);

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            await expect(
                facets.envelope.connect(admin).confirmFiatDelivery(envelopeId)
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired")
                .withArgs(user2.address, 2);
        });

        it("SmartLock release reverts when recipient is non-KYC'd", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, custodian1 } = signers;

            await kycWallet(facets, custodian1, user1);
            const { envelopeId, fragment, nonce } = await createSmartLockEnvelope(
                facets, user1, user2, ethers.parseEther("10")
            );

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            await expect(
                facets.smartLockEnvelope.connect(user2).releaseSmartLockEnvelope(envelopeId, fragment)
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired")
                .withArgs(user2.address, 2);
        });

        it("Cambio redeem parks a compliance hold when redeemer is non-KYC'd (Task 4.3)", async function () {
            const { facets, signers, diamondAddress } = await loadFixture(setupFixture);
            const { owner, user1, user2, custodian1 } = signers;

            await setupCambioIssuer(facets, signers, user1);
            await kycWallet(facets, custodian1, user1);
            const { noteId } = await createCambioNote(facets, user1, ethers.parseEther("10"));

            await grantRole(facets.accessControl, ROLES.CAMBIO_REDEEMER_ROLE, user2.address, owner);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            // Task 4.3 (D2): a screened-out redeemer no longer reverts the leg —
            // the payout parks in an admin compliance hold instead.
            const holdLib = await ethers.getContractAt("ComplianceHoldLib", diamondAddress);
            const balBefore = await facets.erc20.balanceOf(user2.address);
            await expect(
                facets.cambioEnvelope.connect(user2).redeemByNoteId(noteId, ethers.parseEther("10"), 1, "")
            ).to.emit(holdLib, "CompliancePayoutHeld");

            expect(await facets.erc20.balanceOf(user2.address)).to.equal(balBefore);
            const note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(note.spent).to.equal(0);
            expect(note.active).to.equal(true);
        });

        it("WalletRecovery applyBulkPolicy choice-0 finalize reverts when recipient is non-KYC'd", async function () {
            const { facets, signers, diamondAddress } = await loadFixture(setupFixture);
            const { owner, admin, custodian1, custodian2, user2 } = signers;

            await facets.custodian.connect(owner).grantCustodianRole(custodian1.address);
            await facets.custodian.connect(owner).grantCustodianRole(custodian2.address);
            await kycWallet(facets, custodian1, custodian1);
            await kycWallet(facets, custodian1, custodian2);
            await facets.erc20.connect(custodian1).approve(diamondAddress, ethers.parseEther("10000"));

            const envelopeId = await createStandardEnvelope(
                facets, custodian1, user2, ethers.parseEther("10")
            );
            const recoveryId = await activateRecovery(facets, signers, custodian1, custodian2);

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            await expect(
                facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId])
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired")
                .withArgs(user2.address, 2);
        });

        it("screening hard-deny is recovery-aware: BLOCKED successor blocks the recovery finalize", async function () {
            const { facets, signers, diamondAddress } = await loadFixture(setupFixture);
            const { owner, admin, custodian1, custodian2, user2 } = signers;

            await facets.custodian.connect(owner).grantCustodianRole(custodian1.address);
            await facets.custodian.connect(owner).grantCustodianRole(custodian2.address);
            await facets.custodian.connect(owner).grantCustodianRole(user2.address);
            await kycWallet(facets, custodian1, custodian1);
            await kycWallet(facets, custodian1, custodian2);
            await kycWallet(facets, custodian1, user2);
            await facets.erc20.connect(custodian1).approve(diamondAddress, ethers.parseEther("10000"));

            const envelopeId = await createStandardEnvelope(
                facets, custodian1, user2, ethers.parseEther("10")
            );
            const recoveryId = await activateRecovery(facets, signers, user2, custodian2);

            await grantRole(facets.accessControl, ROLES.SCREENING_ATTESTOR_ROLE, owner.address, owner);
            await facets.complianceScreening.connect(owner).recordScreening(
                custodian2.address, SCREENING_BLOCKED, ethers.ZeroHash
            );

            await enableScreening(facets, signers);

            await expect(
                facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId])
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceSanctioned")
                .withArgs(custodian2.address);
        });

        it("legacy mint reverts when recipient is non-KYC'd", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user3, minter } = signers;

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            await expect(
                facets.mintBurn.connect(minter).mint(user3.address, ethers.parseEther("10"))
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired")
                .withArgs(user3.address, 2);
        });

        it("screening gate denies BLOCKED sender in WALLET_TRANSFER", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            await grantRole(facets.accessControl, ROLES.SCREENING_ATTESTOR_ROLE, owner.address, owner);
            await facets.complianceScreening.connect(owner).recordScreening(user1.address, SCREENING_BLOCKED, ethers.ZeroHash);

            await enableScreening(facets, signers);

            await expect(
                facets.directTransfer.connect(user1).transfer(user2.address, ethers.parseEther("1"))
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceSanctioned")
                .withArgs(user1.address);
        });

        it("screening gate denies BLOCKED recipient in WALLET_TRANSFER", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            await grantRole(facets.accessControl, ROLES.SCREENING_ATTESTOR_ROLE, owner.address, owner);
            await facets.complianceScreening.connect(owner).recordScreening(user2.address, SCREENING_BLOCKED, ethers.ZeroHash);

            await enableScreening(facets, signers);

            await expect(
                facets.directTransfer.connect(user1).transfer(user2.address, ethers.parseEther("1"))
            )
                .to.be.revertedWithCustomError(facets.complianceGate, "ComplianceSanctioned")
                .withArgs(user2.address);
        });

        it("screening gate allows CLEAR and NONE parties", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            await grantRole(facets.accessControl, ROLES.SCREENING_ATTESTOR_ROLE, owner.address, owner);
            await facets.complianceScreening.connect(owner).recordScreening(user1.address, SCREENING_CLEAR, ethers.ZeroHash);
            // user2 remains NONE (default)

            await enableScreening(facets, signers);

            await expect(
                facets.directTransfer.connect(user1).transfer(user2.address, ethers.parseEther("1"))
            ).not.to.be.reverted;
        });

        it("screening gate no longer fail-closes all hooked paths", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            await grantRole(facets.accessControl, ROLES.SCREENING_ATTESTOR_ROLE, owner.address, owner);
            await enableScreening(facets, signers);

            await expect(
                facets.directTransfer.connect(user1).transfer(user2.address, ethers.parseEther("1"))
            ).not.to.be.reverted;
        });
    });

    describe("Made-Whole non-regression: refund and cancel legs remain exempt", function () {
        it("reverseEnvelope still succeeds after a blocked finalizeEnvelope", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, custodian1 } = signers;

            await kycWallet(facets, custodian1, user1);
            const envelopeId = await createStandardEnvelope(facets, user1, user2, ethers.parseEther("10"));

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);
            await expect(
                facets.envelope.connect(user1).finalizeEnvelope(envelopeId)
            ).to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired");

            await expect(
                facets.envelope.connect(user1).reverseEnvelope(envelopeId, ethers.parseEther("10"))
            ).not.to.be.reverted;
        });

        it("clawbackSettlement refund leg still succeeds with gate ON", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, admin, user1, user2, custodian1 } = signers;

            await kycWallet(facets, custodian1, user1);
            const envelopeId = await createStandardEnvelope(
                facets, user1, user2, ethers.parseEther("10"), 1, 0
            );

            await time.increase(ONE_HOUR + 1);
            await facets.envelope.connect(user1).finalizeEnvelope(envelopeId);

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            // Refund leg (clawback within window) remains available and is exempt from KYC
            await expect(
                facets.envelope.connect(admin).clawbackSettlement(envelopeId)
            ).not.to.be.reverted;
        });

        it("clawbackSettlement still succeeds after a blocked confirmFiatDelivery", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, admin, user1, user2, custodian1 } = signers;

            await kycWallet(facets, custodian1, user1);
            const envelopeId = await createStandardEnvelope(
                facets, user1, user2, ethers.parseEther("10"), 1, 0
            );

            await time.increase(ONE_HOUR + 1);
            await facets.envelope.connect(user1).finalizeEnvelope(envelopeId);

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);
            await expect(
                facets.envelope.connect(admin).confirmFiatDelivery(envelopeId)
            ).to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired");

            await expect(
                facets.envelope.connect(admin).clawbackSettlement(envelopeId)
            ).not.to.be.reverted;
        });

        it("cancelSmartLockEnvelope still succeeds after a blocked release", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, custodian1 } = signers;

            await kycWallet(facets, custodian1, user1);
            const { envelopeId, fragment } = await createSmartLockEnvelope(
                facets, user1, user2, ethers.parseEther("10")
            );

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);
            await expect(
                facets.smartLockEnvelope.connect(user2).releaseSmartLockEnvelope(envelopeId, fragment)
            ).to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired");

            await expect(
                facets.smartLockEnvelope.connect(user1).cancelSmartLockEnvelope(envelopeId)
            ).not.to.be.reverted;
        });

        it("held note blocks cancel; admin pay-to-alternate makes the issuer whole (Task 4.3)", async function () {
            const { facets, signers, diamondAddress } = await loadFixture(setupFixture);
            const { owner, user1, user2, custodian1 } = signers;

            await setupCambioIssuer(facets, signers, user1);
            await kycWallet(facets, custodian1, user1);
            const { noteId } = await createCambioNote(facets, user1, ethers.parseEther("10"));

            await grantRole(facets.accessControl, ROLES.CAMBIO_REDEEMER_ROLE, user2.address, owner);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            // Task 4.3 (D2): the blocked redemption parks in a compliance hold …
            const holdLib = await ethers.getContractAt("ComplianceHoldLib", diamondAddress);
            await expect(
                facets.cambioEnvelope.connect(user2).redeemByNoteId(noteId, ethers.parseEther("10"), 1, "")
            ).to.emit(holdLib, "CompliancePayoutHeld");

            // … which freezes the note against cancel until the admin disposes it.
            await expect(
                facets.cambioEnvelope.connect(user1).cancelEnvelopeNote(noteId)
            ).to.be.revertedWithCustomError(holdLib, "ComplianceHoldActive");

            // Made-Whole: pay-to-alternate routes the escrow to the KYC'd issuer.
            const CAMBIO_NOTE_DOMAIN = ethers.keccak256(ethers.toUtf8Bytes("T3_CAMBIO_NOTE_V1"));
            const balBefore = await facets.erc20.balanceOf(user1.address);
            await expect(
                facets.envelope.connect(owner).resolveComplianceHold(
                    CAMBIO_NOTE_DOMAIN, noteId, 2 /* OUTCOME_PAY_ALTERNATE */, user1.address
                )
            ).to.emit(holdLib, "ComplianceHoldResolved");
            expect(await facets.erc20.balanceOf(user1.address)).to.equal(balBefore + ethers.parseEther("10"));
        });

        it("applyBulkPolicy reverse override still succeeds after a blocked finalize", async function () {
            const { facets, signers, diamondAddress } = await loadFixture(setupFixture);
            const { owner, admin, custodian1, custodian2, user2 } = signers;

            await facets.custodian.connect(owner).grantCustodianRole(custodian1.address);
            await facets.custodian.connect(owner).grantCustodianRole(custodian2.address);
            await kycWallet(facets, custodian1, custodian1);
            await kycWallet(facets, custodian1, custodian2);
            await facets.erc20.connect(custodian1).approve(diamondAddress, ethers.parseEther("10000"));

            const envelopeId = await createStandardEnvelope(
                facets, custodian1, user2, ethers.parseEther("10")
            );
            const recoveryId = await activateRecovery(facets, signers, custodian1, custodian2);

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);
            await expect(
                facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId])
            ).to.be.revertedWithCustomError(facets.complianceGate, "ComplianceKycRequired");

            await facets.walletRecovery.connect(admin).overrideEnvelopeChoice(recoveryId, envelopeId, 1); // Reverse
            await expect(
                facets.walletRecovery.connect(admin).applyBulkPolicy(recoveryId, [envelopeId])
            ).not.to.be.reverted;
        });

        it("legacy mint still succeeds for a KYC'd recipient with gate ON", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, minter, custodian1 } = signers;

            await kycWallet(facets, custodian1, user1);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(KYC_ENFORCE_ACTIVE, 1);

            await expect(
                facets.mintBurn.connect(minter).mint(user1.address, ethers.parseEther("10"))
            ).not.to.be.reverted;
        });
    });

    describe("Travel Rule (Wave 8D)", function () {
        it("gate OFF = create succeeds regardless of pending ref", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { user1, user2 } = signers;

            expect(await facets.complianceConfig.isTravelRuleEnforceActive()).to.equal(false);

            const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR);
            await expect(
                facets.envelope.connect(user1).createEnvelope(
                    user2.address,
                    ethers.parseEther("10"),
                    commitWindowEnd,
                    0,
                    0,
                    "0x"
                )
            ).not.to.be.reverted;
        });

        it("gate ON without pending ref reverts TravelRuleRequired for amount >= threshold", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR);
            await expect(
                facets.envelope.connect(user1).createEnvelope(
                    user2.address,
                    threshold,
                    commitWindowEnd,
                    0,
                    0,
                    "0x"
                )
            )
                .to.be.revertedWithCustomError(facets.envelope, "TravelRuleRequired")
                .withArgs(user1.address, threshold, threshold);
        });

        it("gate ON with pending ref binds ref to envelope and emits TravelRuleAttached", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            const ref = ethers.keccak256(ethers.toUtf8Bytes("travel-rule-ref-ok"));
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);
            await facets.complianceTravelRule.connect(user1).setPendingTravelRule(
                ref, user2.address, threshold, 1, uint40((await time.latest()) + ONE_HOUR)
            );

            const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR);
            const tx = await facets.envelope.connect(user1).createEnvelope(
                user2.address,
                threshold,
                commitWindowEnd,
                0,
                0,
                "0x"
            );
            const envelopeIds = await facets.envelope.getEnvelopesBySender(user1.address);
            const envelopeId = envelopeIds[envelopeIds.length - 1];

            const receipt = await tx.wait();
            const parsed = receipt.logs
                .map((l) => { try { return facets.envelope.interface.parseLog(l); } catch { return null; } })
                .filter(Boolean)
                .find((l) => l.name === "TravelRuleAttached");

            expect(parsed).to.not.be.undefined;
            expect(parsed.args.envelopeId).to.equal(envelopeId);
            expect(parsed.args.sender).to.equal(user1.address);
            expect(parsed.args.ref).to.equal(ref);

            const rule = await facets.complianceTravelRule.getTravelRule(envelopeId);
            expect(rule.ref).to.equal(ref);
            expect(rule.satisfied).to.equal(true);
            expect(rule.attachedAt).to.be.gt(0);

            expect((await facets.complianceTravelRule.getPendingTravelRule(user1.address)).ref).to.equal(ethers.ZeroHash);
        });

        it("gate ON with amount < threshold succeeds without pending ref", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("10");
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR);
            await expect(
                facets.envelope.connect(user1).createEnvelope(
                    user2.address,
                    ethers.parseEther("1"),
                    commitWindowEnd,
                    0,
                    0,
                    "0x"
                )
            ).not.to.be.reverted;
        });

        it("Made-Whole: reverseEnvelope still works with gate ON", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            const ref = ethers.keccak256(ethers.toUtf8Bytes("travel-rule-ref-reverse"));
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);
            await facets.complianceTravelRule.connect(user1).setPendingTravelRule(
                ref, user2.address, threshold, 1, uint40((await time.latest()) + ONE_HOUR)
            );

            const envelopeId = await createStandardEnvelope(facets, user1, user2, threshold);

            // Refund/reverse legs are exempt from Travel Rule re-check (bound at create only).
            await expect(
                facets.envelope.connect(user1).reverseEnvelope(envelopeId, threshold)
            ).not.to.be.reverted;
        });

        it("createChildEnvelope requires and binds pending ref when gate ON", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            // Create parent while gate is OFF so the sender can escrow without a ref.
            const parentId = await createStandardEnvelope(facets, user1, user2, ethers.parseEther("10"));

            const threshold = ethers.parseEther("1");
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            await expect(
                createChildEnvelope(facets, user1, user2, threshold, parentId)
            )
                .to.be.revertedWithCustomError(facets.envelopeInheritance, "TravelRuleRequired")
                .withArgs(user1.address, threshold, threshold);

            const ref = ethers.keccak256(ethers.toUtf8Bytes("travel-rule-ref-child"));
            await facets.complianceTravelRule.connect(user1).setPendingTravelRule(
                ref, user2.address, threshold, 1, uint40((await time.latest()) + ONE_HOUR)
            );
            const childId = await createChildEnvelope(facets, user1, user2, threshold, parentId);

            const rule = await facets.complianceTravelRule.getTravelRule(childId);
            expect(rule.ref).to.equal(ref);
            expect(rule.satisfied).to.equal(true);
        });

        it("createSmartLockEnvelope requires and binds pending ref when gate ON", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            await expect(
                createSmartLockEnvelope(facets, user1, user2, threshold)
            )
                .to.be.revertedWithCustomError(facets.smartLockEnvelope, "TravelRuleRequired")
                .withArgs(user1.address, threshold, threshold);

            const ref = ethers.keccak256(ethers.toUtf8Bytes("travel-rule-ref-smartlock"));
            await facets.complianceTravelRule.connect(user1).setPendingTravelRule(
                ref, user2.address, threshold, 2, uint40((await time.latest()) + ONE_HOUR)
            );
            const { envelopeId } = await createSmartLockEnvelope(facets, user1, user2, threshold);

            const rule = await facets.complianceTravelRule.getTravelRule(envelopeId);
            expect(rule.ref).to.equal(ref);
            expect(rule.satisfied).to.equal(true);
        });

        it("Cambio note create requires and binds pending ref when gate ON", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1 } = signers;

            await setupCambioIssuer(facets, signers, user1);

            const threshold = ethers.parseEther("1");
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            await expect(
                createCambioNote(facets, user1, threshold)
            )
                .to.be.revertedWithCustomError(facets.cambioEnvelope, "TravelRuleRequired")
                .withArgs(user1.address, threshold, threshold);

            const ref = ethers.keccak256(ethers.toUtf8Bytes("travel-rule-ref-cambio"));
            // Bearer note: commitment recipient is address(0), matching the facet's precheckGated.
            await facets.complianceTravelRule.connect(user1).setPendingTravelRule(
                ref, ethers.ZeroAddress, threshold, 3, uint40((await time.latest()) + ONE_HOUR)
            );
            const { noteId } = await createCambioNote(facets, user1, threshold);

            const rule = await facets.complianceTravelRule.getTravelRule(noteId);
            expect(rule.ref).to.equal(ref);
            expect(rule.satisfied).to.equal(true);
        });

        it("C-F3 mismatch on child-envelope, SmartLock, and Cambio paths", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2, user3 } = signers;

            await setupCambioIssuer(facets, signers, user1);
            const parentId = await createStandardEnvelope(facets, user1, user2, ethers.parseEther("10"));

            const threshold = ethers.parseEther("1");
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            const ref = ethers.keccak256(ethers.toUtf8Bytes("travel-rule-ref-xpath"));
            const stage = async (recipient, objectType) =>
                facets.complianceTravelRule.connect(user1).setPendingTravelRule(
                    ref, recipient, threshold, objectType, uint40((await time.latest()) + ONE_HOUR)
                );

            // child envelope: recipient mismatch (staged for user3)
            await stage(user3.address, 1);
            await expect(createChildEnvelope(facets, user1, user2, threshold, parentId))
                .to.be.revertedWithCustomError(facets.envelopeInheritance, "TravelRuleCommitmentMismatch")
                .withArgs(user1.address, ref);

            // SmartLock: objectType mismatch (staged as plain envelope)
            await stage(user2.address, 1);
            await expect(createSmartLockEnvelope(facets, user1, user2, threshold))
                .to.be.revertedWithCustomError(facets.smartLockEnvelope, "TravelRuleCommitmentMismatch")
                .withArgs(user1.address, ref);

            // Cambio bearer note: recipient must be address(0) — a named recipient mismatches
            await stage(user2.address, 3);
            await expect(createCambioNote(facets, user1, threshold))
                .to.be.revertedWithCustomError(facets.cambioEnvelope, "TravelRuleCommitmentMismatch")
                .withArgs(user1.address, ref);
        });

        it("pending ref is consumed per create, allowing unique ref per transfer", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            const threshold = ethers.parseEther("1");
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_THRESHOLD_USD, threshold);
            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);

            const refA = ethers.keccak256(ethers.toUtf8Bytes("travel-rule-ref-a"));
            const refB = ethers.keccak256(ethers.toUtf8Bytes("travel-rule-ref-b"));

            await facets.complianceTravelRule.connect(user1).setPendingTravelRule(
                refA, user2.address, threshold, 1, uint40((await time.latest()) + ONE_HOUR)
            );
            const id1 = await createStandardEnvelope(facets, user1, user2, threshold);

            await facets.complianceTravelRule.connect(user1).setPendingTravelRule(
                refB, user2.address, threshold, 1, uint40((await time.latest()) + ONE_HOUR)
            );
            const id2 = await createStandardEnvelope(facets, user1, user2, threshold);

            const rule1 = await facets.complianceTravelRule.getTravelRule(id1);
            const rule2 = await facets.complianceTravelRule.getTravelRule(id2);
            expect(rule1.ref).to.equal(refA);
            expect(rule2.ref).to.equal(refB);
        });

        it("threshold 0 + gate ON enforces every create fail-closed", async function () {
            const { facets, signers } = await loadFixture(setupFixture);
            const { owner, user1, user2 } = signers;

            await facets.institutionPolicy.connect(owner).setNetworkPolicy(TRAVEL_RULE_ENFORCE_ACTIVE, 1);
            // threshold defaults to 0

            const amount = ethers.parseEther("0.01");
            const commitWindowEnd = uint40((await time.latest()) + ONE_HOUR);
            await expect(
                facets.envelope.connect(user1).createEnvelope(
                    user2.address,
                    amount,
                    commitWindowEnd,
                    0,
                    0,
                    "0x"
                )
            )
                .to.be.revertedWithCustomError(facets.envelope, "TravelRuleRequired")
                .withArgs(user1.address, amount, 0);
        });
    });
});

function uint40(value) {
    return BigInt.asUintN(40, BigInt(value));
}
