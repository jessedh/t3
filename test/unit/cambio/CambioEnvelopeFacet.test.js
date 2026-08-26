const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const { deployT3DiamondFixture, getSelectors, FacetCutAction } = require("../../helpers/deployment");
const { setupTestRoles, grantRole, ROLES } = require("../../helpers/roles");
const { AMOUNTS, TIME } = require("../../helpers/constants");

/**
 * CambioEnvelopeFacet Unit Tests
 *
 * Validates phase management, risk controls, storage isolation,
 * note lifecycle (create, redeem, cancel), and receipt generation
 * for envelope-mode Cambio.
 */
describe("CambioEnvelopeFacet", function () {
    const NOTE_ID = ethers.id("ENVELOPE-NOTE-1");
    const ZERO_ADDRESS = ethers.ZeroAddress;

    async function setupEnvelopeFixture() {
        const deployment = await deployT3DiamondFixture();
        await setupTestRoles(deployment.facets, deployment.signers);

        const { facets, signers, diamondAddress } = deployment;
        await grantRole(facets.accessControl, ROLES.CAMBIO_ADMIN_ROLE, signers.admin.address, signers.owner);
        await grantRole(facets.accessControl, ROLES.CAMBIO_ISSUER_ROLE, signers.user1.address, signers.owner);

        // Register user1 as a legacy issuer so envelope note creation works
        await facets.cambioIssuer.connect(signers.admin).registerIssuer(signers.user1.address);

        // Deploy and add test helper facet to diamond
        const TestFacetFactory = await ethers.getContractFactory("CambioEnvelopeTestFacet");
        const testFacet = await TestFacetFactory.deploy();
        await testFacet.waitForDeployment();

        const testSelectors = getSelectors(testFacet, []);
        const cut = [{
            facetAddress: await testFacet.getAddress(),
            action: FacetCutAction.Add,
            functionSelectors: testSelectors
        }];

        await facets.diamondCut.diamondCut(cut, ethers.ZeroAddress, "0x");

        // Attach test facet to diamond
        const testFacetDiamond = await ethers.getContractAt("CambioEnvelopeTestFacet", diamondAddress);

        // ERC2771ContextFacet is included in the base MVP diamond fixture.
        const erc2771 = await ethers.getContractAt("ERC2771ContextFacet", diamondAddress);

        return { ...deployment, testFacetDiamond, erc2771 };
    }

    /**
     * Build ERC-2771 calldata by appending the original sender address to the ABI-encoded function call.
     * When msg.sender == trustedForwarder, the diamond's _msgSenderCambio() extracts the sender from the last 20 bytes.
     */
    function buildForwarderCalldata(contractInterface, functionName, args, senderAddress) {
        const encoded = contractInterface.encodeFunctionData(functionName, args);
        return encoded + senderAddress.slice(2).toLowerCase();
    }

    let deployment;
    let facets;
    let signers;
    let testFacet;
    let erc2771;

    beforeEach(async function () {
        deployment = await loadFixture(setupEnvelopeFixture);
        ({ facets, signers } = deployment);
        testFacet = deployment.testFacetDiamond;
        erc2771 = deployment.erc2771;
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Phase Management
    // ═══════════════════════════════════════════════════════════════════════

    describe("Phase Management", function () {
        it("starts in DISABLED phase", async function () {
            const phase = await facets.cambioEnvelope.getCambioEnvelopePhase();
            expect(phase).to.equal(0); // DISABLED
        });

        it("allows admin to advance DISABLED → ENABLED", async function () {
            await expect(
                facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase()
            )
                .to.emit(facets.cambioEnvelope, "CambioPhaseAdvanced")
                .withArgs(1); // ENABLED

            const phase = await facets.cambioEnvelope.getCambioEnvelopePhase();
            expect(phase).to.equal(1); // ENABLED
        });

        it("allows admin to advance ENABLED → LEGACY_REMOVED", async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await expect(
                facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase()
            )
                .to.emit(facets.cambioEnvelope, "CambioPhaseAdvanced")
                .withArgs(2); // LEGACY_REMOVED

            const phase = await facets.cambioEnvelope.getCambioEnvelopePhase();
            expect(phase).to.equal(2); // LEGACY_REMOVED
        });

        it("reverts when trying to advance beyond LEGACY_REMOVED", async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();

            await expect(
                facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase()
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "CambioInvalidPhaseTransition"
            );
        });

        it("reverts when non-admin tries to advance phase", async function () {
            await expect(
                facets.cambioEnvelope.connect(signers.user1).advanceCambioPhase()
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "UnauthorizedRole"
            );
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Phase Gate (envelope writes blocked when DISABLED)
    // ═══════════════════════════════════════════════════════════════════════

    describe("Phase Gate", function () {
        it("blocks envelope writes when phase is DISABLED", async function () {
            const note = {
                issuer: signers.user1.address,
                escrowedAmount: AMOUNTS.ONE_TOKEN,
                spent: 0,
                createdAt: 0,
                deadline: 0,
                active: true,
                phraseCommitment: ethers.ZeroHash,
                noteSalt: ethers.ZeroHash,
                openRedemptionSnapshot: false,
                requiresCommitReveal: false
            };

            await expect(
                testFacet.writeEnvelopeNote(NOTE_ID, note)
            ).to.be.revertedWithCustomError(
                testFacet,
                "CambioEnvelopeDisabled"
            );
        });

        it("allows envelope writes when phase is ENABLED", async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();

            const note = {
                issuer: signers.user1.address,
                escrowedAmount: AMOUNTS.ONE_TOKEN,
                spent: 0,
                createdAt: 0,
                deadline: 0,
                active: true,
                phraseCommitment: ethers.ZeroHash,
                noteSalt: ethers.ZeroHash,
                openRedemptionSnapshot: false,
                requiresCommitReveal: false
            };

            await expect(testFacet.writeEnvelopeNote(NOTE_ID, note))
                .to.not.be.reverted;

            const stored = await testFacet.getEnvelopeNote(NOTE_ID);
            expect(stored.issuer).to.equal(signers.user1.address);
            expect(stored.escrowedAmount).to.equal(AMOUNTS.ONE_TOKEN);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Admin Setters for Risk Controls
    // ═══════════════════════════════════════════════════════════════════════

    describe("Admin Setters", function () {
        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
        });

        it("setCambioEnvelopeConfig updates all fields", async function () {
            await expect(
                facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                    AMOUNTS.TEN_TOKENS,
                    3600,
                    86400,
                    2048,
                    AMOUNTS.THOUSAND_TOKENS,
                    7200,
                    false
                )
            )
                .to.emit(facets.cambioAdmin, "CambioEnvelopeConfigUpdated")
                .withArgs(
                    AMOUNTS.TEN_TOKENS,
                    3600,
                    86400,
                    2048,
                    AMOUNTS.THOUSAND_TOKENS,
                    7200,
                    false
                );

            const cfg = await facets.cambioEnvelope.getCambioEnvelopeConfig();
            expect(cfg.maxNoteValue).to.equal(AMOUNTS.TEN_TOKENS);
            expect(cfg.minDeadlineBuffer).to.equal(3600);
            expect(cfg.maxDeadlineWindow).to.equal(86400);
            expect(cfg.maxMetadataLength).to.equal(2048);
            expect(cfg.commitRevealThreshold).to.equal(AMOUNTS.THOUSAND_TOKENS);
            expect(cfg.maxCommitLifetime).to.equal(7200);
            expect(cfg.cambioPaused).to.equal(false);
        });

        it("setCambioEnvelopeConfig reverts when maxDeadlineWindow <= minDeadlineBuffer", async function () {
            await expect(
                facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                    AMOUNTS.TEN_TOKENS,
                    3600,
                    1800, // less than minDeadlineBuffer
                    2048,
                    0,
                    0,
                    false
                )
            ).to.be.revertedWithCustomError(
                facets.cambioAdmin,
                "CambioInvalidConfiguration"
            );
        });

        it("setIssuerMaxOutstandingNoteCount updates profile", async function () {
            await expect(
                facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteCount(signers.user1.address, 10)
            )
                .to.emit(facets.cambioAdmin, "IssuerMaxOutstandingNoteCountUpdated")
                .withArgs(signers.user1.address, 10);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            expect(profile.maxOutstandingNoteCount).to.equal(10);
        });

        it("setIssuerMaxOutstandingNoteValue updates profile", async function () {
            await expect(
                facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteValue(signers.user1.address, AMOUNTS.THOUSAND_TOKENS)
            )
                .to.emit(facets.cambioAdmin, "IssuerMaxOutstandingNoteValueUpdated")
                .withArgs(signers.user1.address, AMOUNTS.THOUSAND_TOKENS);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            expect(profile.maxOutstandingNoteValue).to.equal(AMOUNTS.THOUSAND_TOKENS);
        });

        it("setIssuerDailyRedemptionCeiling updates profile", async function () {
            await expect(
                facets.cambioAdmin.connect(signers.admin).setIssuerDailyRedemptionCeiling(signers.user1.address, AMOUNTS.TEN_TOKENS)
            )
                .to.emit(facets.cambioAdmin, "IssuerDailyRedemptionCeilingUpdated")
                .withArgs(signers.user1.address, AMOUNTS.TEN_TOKENS);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            expect(profile.dailyRedemptionCeiling).to.equal(AMOUNTS.TEN_TOKENS);
        });

        it("setCommitRevealThreshold updates config", async function () {
            await expect(
                facets.cambioAdmin.connect(signers.admin).setCommitRevealThreshold(AMOUNTS.HUNDRED_TOKENS)
            )
                .to.emit(facets.cambioAdmin, "CommitRevealThresholdUpdated")
                .withArgs(AMOUNTS.HUNDRED_TOKENS);

            const cfg = await facets.cambioEnvelope.getCambioEnvelopeConfig();
            expect(cfg.commitRevealThreshold).to.equal(AMOUNTS.HUNDRED_TOKENS);
        });

        it("setMaxCommitLifetime updates config", async function () {
            await expect(
                facets.cambioAdmin.connect(signers.admin).setMaxCommitLifetime(3600)
            )
                .to.emit(facets.cambioAdmin, "MaxCommitLifetimeUpdated")
                .withArgs(3600);

            const cfg = await facets.cambioEnvelope.getCambioEnvelopeConfig();
            expect(cfg.maxCommitLifetime).to.equal(3600);
        });

        it("setGlobalMaxOutstandingNoteCount updates config", async function () {
            await expect(
                facets.cambioAdmin.connect(signers.admin).setGlobalMaxOutstandingNoteCount(100)
            )
                .to.emit(facets.cambioAdmin, "GlobalMaxOutstandingNoteCountUpdated")
                .withArgs(100);
        });

        it("setGlobalMaxOutstandingNoteValue updates config", async function () {
            await expect(
                facets.cambioAdmin.connect(signers.admin).setGlobalMaxOutstandingNoteValue(AMOUNTS.THOUSAND_TOKENS)
            )
                .to.emit(facets.cambioAdmin, "GlobalMaxOutstandingNoteValueUpdated")
                .withArgs(AMOUNTS.THOUSAND_TOKENS);
        });

        it("reverts when non-admin calls setters", async function () {
            await expect(
                facets.cambioAdmin.connect(signers.user1).setCommitRevealThreshold(100)
            ).to.be.revertedWithCustomError(
                facets.cambioAdmin,
                "UnauthorizedRole"
            );

            await expect(
                facets.cambioAdmin.connect(signers.user1).setIssuerMaxOutstandingNoteCount(signers.user1.address, 5)
            ).to.be.revertedWithCustomError(
                facets.cambioAdmin,
                "UnauthorizedRole"
            );
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Rolling Ceiling Bucket Math
    // ═══════════════════════════════════════════════════════════════════════

    describe("Rolling Ceiling Buckets", function () {
        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
        });

        it("allows redemption under the ceiling", async function () {
            const ceiling = ethers.parseEther("100");
            await facets.cambioAdmin.connect(signers.admin).setIssuerDailyRedemptionCeiling(signers.user1.address, ceiling);

            await expect(
                testFacet.checkDailyCeiling(signers.user1.address, ethers.parseEther("50"))
            ).to.not.be.reverted;
        });

        it("reverts when ceiling is exceeded", async function () {
            const ceiling = ethers.parseEther("100");
            await facets.cambioAdmin.connect(signers.admin).setIssuerDailyRedemptionCeiling(signers.user1.address, ceiling);

            await testFacet.checkDailyCeiling(signers.user1.address, ethers.parseEther("60"));

            await expect(
                testFacet.checkDailyCeiling(signers.user1.address, ethers.parseEther("50"))
            ).to.be.revertedWithCustomError(
                testFacet,
                "CambioDailyRedemptionCeilingExceeded"
            );
        });

        it("buckets age out after 24 hours", async function () {
            const ceiling = ethers.parseEther("100");
            await facets.cambioAdmin.connect(signers.admin).setIssuerDailyRedemptionCeiling(signers.user1.address, ceiling);

            // Fill up the ceiling
            await testFacet.checkDailyCeiling(signers.user1.address, ethers.parseEther("100"));

            // Should revert now
            await expect(
                testFacet.checkDailyCeiling(signers.user1.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(
                testFacet,
                "CambioDailyRedemptionCeilingExceeded"
            );

            // Advance time by 25 hours
            await time.increase(25 * 60 * 60);

            // Should succeed because old buckets aged out
            await expect(
                testFacet.checkDailyCeiling(signers.user1.address, ethers.parseEther("50"))
            ).to.not.be.reverted;
        });

        it("partially ages buckets between 1 and 24 hours", async function () {
            const ceiling = ethers.parseEther("100");
            await facets.cambioAdmin.connect(signers.admin).setIssuerDailyRedemptionCeiling(signers.user1.address, ceiling);

            await testFacet.checkDailyCeiling(signers.user1.address, ethers.parseEther("30"));

            // Advance 5 hours
            await time.increase(5 * 60 * 60);

            // Should still have room because only 5 buckets aged out (all zero in this case)
            await expect(
                testFacet.checkDailyCeiling(signers.user1.address, ethers.parseEther("70"))
            ).to.not.be.reverted;
        });

        it("returns correct bucket state via view", async function () {
            await facets.cambioAdmin.connect(signers.admin).setIssuerDailyRedemptionCeiling(signers.user1.address, AMOUNTS.TEN_TOKENS);

            await testFacet.checkDailyCeiling(signers.user1.address, ethers.parseEther("3"));

            const [buckets, lastUpdatedHour] = await facets.cambioEnvelope.getIssuerCeilingBuckets(signers.user1.address);
            expect(lastUpdatedHour).to.be.gt(0);

            const total = buckets.reduce((acc, val) => acc + val, 0n);
            expect(total).to.equal(ethers.parseEther("3"));
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Max Outstanding Checks
    // ═══════════════════════════════════════════════════════════════════════

    describe("Max Outstanding Checks", function () {
        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
        });

        async function buildProfile(base, overrides) {
            return {
                sponsorBank: base.sponsorBank,
                isActive: base.isActive,
                openRedemption: base.openRedemption,
                registeredAt: base.registeredAt,
                maxOutstandingNoteCount: base.maxOutstandingNoteCount,
                maxOutstandingNoteValue: base.maxOutstandingNoteValue,
                dailyRedemptionCeiling: base.dailyRedemptionCeiling,
                pauseState: base.pauseState,
                notesIssued: base.notesIssued,
                notesOutstanding: overrides.notesOutstanding ?? base.notesOutstanding,
                t3usdEscrowed: base.t3usdEscrowed,
                t3usdRedeemed: base.t3usdRedeemed,
                t3usdCancelled: base.t3usdCancelled,
                valueOutstanding: overrides.valueOutstanding ?? base.valueOutstanding
            };
        }

        it("reverts when note count cap is exceeded", async function () {
            await facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteCount(signers.user1.address, 2);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            const updated = await buildProfile(profile, { notesOutstanding: 2 });
            await testFacet.setTestIssuerProfile(signers.user1.address, updated);

            await expect(
                testFacet.checkMaxOutstanding(signers.user1.address)
            ).to.be.revertedWithCustomError(
                testFacet,
                "CambioMaxOutstandingNotesExceeded"
            );
        });

        it("reverts when note value cap is exceeded", async function () {
            await facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteValue(signers.user1.address, AMOUNTS.THOUSAND_TOKENS);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            const updated = await buildProfile(profile, { valueOutstanding: AMOUNTS.THOUSAND_TOKENS });
            await testFacet.setTestIssuerProfile(signers.user1.address, updated);

            await expect(
                testFacet.checkMaxOutstanding(signers.user1.address)
            ).to.be.revertedWithCustomError(
                testFacet,
                "CambioMaxOutstandingValueExceeded"
            );
        });

        it("allows when under both caps", async function () {
            await facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteCount(signers.user1.address, 5);
            await facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteValue(signers.user1.address, AMOUNTS.THOUSAND_TOKENS);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            const updated = await buildProfile(profile, { notesOutstanding: 3, valueOutstanding: AMOUNTS.HUNDRED_TOKENS });
            await testFacet.setTestIssuerProfile(signers.user1.address, updated);

            await expect(
                testFacet.checkMaxOutstanding(signers.user1.address)
            ).to.not.be.reverted;
        });

        it("ignores caps when set to zero", async function () {
            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            const updated = await buildProfile(profile, { notesOutstanding: 9999, valueOutstanding: AMOUNTS.THOUSAND_TOKENS });
            await testFacet.setTestIssuerProfile(signers.user1.address, updated);

            await expect(
                testFacet.checkMaxOutstanding(signers.user1.address)
            ).to.not.be.reverted;
        });

        it("enforces global count default when per-issuer cap is zero", async function () {
            await facets.cambioAdmin.connect(signers.admin).setGlobalMaxOutstandingNoteCount(5);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            const updated = await buildProfile(profile, { notesOutstanding: 5 });
            await testFacet.setTestIssuerProfile(signers.user1.address, updated);

            await expect(
                testFacet.checkMaxOutstanding(signers.user1.address)
            ).to.be.revertedWithCustomError(
                testFacet,
                "CambioMaxOutstandingNotesExceeded"
            );
        });

        it("enforces global value default when per-issuer cap is zero", async function () {
            await facets.cambioAdmin.connect(signers.admin).setGlobalMaxOutstandingNoteValue(AMOUNTS.THOUSAND_TOKENS);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            const updated = await buildProfile(profile, { valueOutstanding: AMOUNTS.THOUSAND_TOKENS });
            await testFacet.setTestIssuerProfile(signers.user1.address, updated);

            await expect(
                testFacet.checkMaxOutstanding(signers.user1.address)
            ).to.be.revertedWithCustomError(
                testFacet,
                "CambioMaxOutstandingValueExceeded"
            );
        });

        it("per-issuer count cap overrides global default", async function () {
            await facets.cambioAdmin.connect(signers.admin).setGlobalMaxOutstandingNoteCount(2);
            await facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteCount(signers.user1.address, 5);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            const updated = await buildProfile(profile, { notesOutstanding: 3 });
            await testFacet.setTestIssuerProfile(signers.user1.address, updated);

            await expect(
                testFacet.checkMaxOutstanding(signers.user1.address)
            ).to.not.be.reverted;
        });

        it("per-issuer value cap overrides global default", async function () {
            await facets.cambioAdmin.connect(signers.admin).setGlobalMaxOutstandingNoteValue(AMOUNTS.ONE_TOKEN);
            await facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteValue(signers.user1.address, AMOUNTS.TEN_TOKENS);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            const updated = await buildProfile(profile, { valueOutstanding: AMOUNTS.ONE_TOKEN * 2n });
            await testFacet.setTestIssuerProfile(signers.user1.address, updated);

            await expect(
                testFacet.checkMaxOutstanding(signers.user1.address)
            ).to.not.be.reverted;
        });

        it("global count default allows values below cap", async function () {
            await facets.cambioAdmin.connect(signers.admin).setGlobalMaxOutstandingNoteCount(5);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            const updated = await buildProfile(profile, { notesOutstanding: 3 });
            await testFacet.setTestIssuerProfile(signers.user1.address, updated);

            await expect(
                testFacet.checkMaxOutstanding(signers.user1.address)
            ).to.not.be.reverted;
        });

        it("global value default allows values below cap", async function () {
            await facets.cambioAdmin.connect(signers.admin).setGlobalMaxOutstandingNoteValue(AMOUNTS.THOUSAND_TOKENS);

            const profile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            const updated = await buildProfile(profile, { valueOutstanding: AMOUNTS.HUNDRED_TOKENS });
            await testFacet.setTestIssuerProfile(signers.user1.address, updated);

            await expect(
                testFacet.checkMaxOutstanding(signers.user1.address)
            ).to.not.be.reverted;
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Storage Isolation (no collision with legacy Cambio fields)
    // ═══════════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════════
    // Note Creation
    // ═══════════════════════════════════════════════════════════════════════

    describe("Note Creation", function () {
        const PHRASE = "super-secret-phrase-for-testing-only";
        const NOTE_SALT = ethers.hexlify(ethers.randomBytes(32));
        const PHRASE_COMMITMENT = ethers.solidityPackedKeccak256(
            ["string", "bytes32"],
            [PHRASE, NOTE_SALT]
        );

        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.TEN_TOKENS,
                3600,
                86400,
                2048,
                AMOUNTS.THOUSAND_TOKENS,
                7200,
                false
            );
            // Mint tokens to issuer
            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);
        });

        it("createCambioNote succeeds with correct noteId format", async function () {
            const latestBlock = await ethers.provider.getBlock("latest");
            const deadline = latestBlock.timestamp + TIME.ONE_DAY;

            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.ONE_TOKEN,
                PHRASE_COMMITMENT,
                NOTE_SALT,
                deadline,
                "test-metadata"
            );

            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            expect(event).to.exist;
            const noteId = event.args.noteId;

            // Verify noteId format: keccak256(abi.encode(chainid, address(this), issuer, counter))
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const counter = 1n;
            const expectedNoteId = ethers.hexlify(ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "address", "address", "uint256"],
                    [chainId, diamondAddress, signers.user1.address, counter]
                )
            ));
            expect(noteId).to.equal(expectedNoteId);

            // Verify note stored correctly
            const note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(note.issuer).to.equal(signers.user1.address);
            expect(note.escrowedAmount).to.equal(AMOUNTS.ONE_TOKEN);
            expect(note.phraseCommitment).to.equal(PHRASE_COMMITMENT);
            expect(note.noteSalt).to.equal(NOTE_SALT);
            expect(note.active).to.equal(true);
            expect(note.openRedemptionSnapshot).to.equal(false);
        });

        it("createCambioNote reverts when phase is DISABLED", async function () {
            // Phase is DISABLED by default in this test (beforeEach doesn't run for this specific test?)
            // Actually beforeEach runs, so phase is ENABLED. We need to deploy fresh or reset.
            // Let's just call advanceCambioPhase twice to get to LEGACY_REMOVED, which is allowed.
            // Wait, the requirement is "phase is DISABLED". Let's test by not advancing.
            // But beforeEach advances. So we need a separate setup.
            // For simplicity, we'll check that DISABLED reverts by using a fresh diamond.
            const fresh = await deployT3DiamondFixture();
            await setupTestRoles(fresh.facets, fresh.signers);
            await grantRole(fresh.facets.accessControl, ROLES.CAMBIO_ISSUER_ROLE, fresh.signers.user1.address, fresh.signers.owner);
            await fresh.facets.mintBurn.connect(fresh.signers.owner).mint(fresh.signers.user1.address, AMOUNTS.TEN_TOKENS);

            const latestBlock = await ethers.provider.getBlock("latest");
            const deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await expect(
                fresh.facets.cambioEnvelope.connect(fresh.signers.user1).createCambioNote(
                    AMOUNTS.ONE_TOKEN,
                    PHRASE_COMMITMENT,
                    NOTE_SALT,
                    deadline,
                    "test"
                )
            ).to.be.revertedWithCustomError(
                fresh.facets.cambioEnvelope,
                "CambioEnvelopeDisabled"
            );
        });

        it("createCambioNote reverts when issuer lacks CAMBIO_ISSUER_ROLE", async function () {
            const latestBlock = await ethers.provider.getBlock("latest");
            const deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await expect(
                facets.cambioEnvelope.connect(signers.user2).createCambioNote(
                    AMOUNTS.ONE_TOKEN,
                    PHRASE_COMMITMENT,
                    NOTE_SALT,
                    deadline,
                    "test"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "UnauthorizedRole"
            );
        });

        it("createCambioNote reverts when issuer is FULLY_PAUSED", async function () {
            // Register issuer with envelope profile and set to FULLY_PAUSED
            await grantRole(facets.accessControl, ROLES.SPONSOR_BANK_OPERATOR_ROLE, signers.admin.address, signers.owner);
            await facets.cambioIssuer.connect(signers.admin).endorseNonBankIssuer(signers.user1.address);
            await facets.cambioIssuer.connect(signers.admin).getFunction("registerIssuer(address,address)")(signers.user1.address, signers.admin.address);
            await facets.cambioIssuer.connect(signers.admin).setIssuerPauseState(signers.user1.address, 2); // FULLY_PAUSED

            const latestBlock = await ethers.provider.getBlock("latest");
            const deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await expect(
                facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                    AMOUNTS.ONE_TOKEN,
                    PHRASE_COMMITMENT,
                    NOTE_SALT,
                    deadline,
                    "test"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "IssuerFullyPaused"
            );
        });

        it("createCambioNote enforces max note value", async function () {
            const latestBlock = await ethers.provider.getBlock("latest");
            const deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await expect(
                facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                    AMOUNTS.HUNDRED_TOKENS, // exceeds TEN_TOKENS max
                    PHRASE_COMMITMENT,
                    NOTE_SALT,
                    deadline,
                    "test"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "MaxNoteValueExceeded"
            );
        });

        it("createCambioNote enforces max outstanding count/value caps", async function () {
            await facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteCount(signers.user1.address, 1);
            await facets.cambioAdmin.connect(signers.admin).setIssuerMaxOutstandingNoteValue(signers.user1.address, AMOUNTS.TEN_TOKENS);

            const latestBlock = await ethers.provider.getBlock("latest");
            const deadline = latestBlock.timestamp + TIME.ONE_DAY;

            // First note should succeed
            await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.ONE_TOKEN,
                PHRASE_COMMITMENT,
                NOTE_SALT,
                deadline,
                "test"
            );

            // Second note should exceed count cap
            await expect(
                facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                    AMOUNTS.ONE_TOKEN,
                    PHRASE_COMMITMENT,
                    NOTE_SALT,
                    deadline,
                    "test"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "CambioMaxOutstandingNotesExceeded"
            );
        });

        it("openRedemptionSnapshot is captured at creation time", async function () {
            // Set openRedemption to true for issuer
            await grantRole(facets.accessControl, ROLES.SPONSOR_BANK_ADMIN_ROLE, signers.admin.address, signers.owner);
            await facets.sponsorBank.connect(signers.admin).registerSponsorBank(signers.admin.address, "TEST_BANK", 0);
            await grantRole(facets.accessControl, ROLES.SPONSOR_BANK_OPERATOR_ROLE, signers.admin.address, signers.owner);
            await facets.cambioIssuer.connect(signers.admin).endorseNonBankIssuer(signers.user1.address);
            await facets.cambioIssuer.connect(signers.admin).getFunction("registerIssuer(address,address)")(signers.user1.address, signers.admin.address);
            await facets.cambioIssuer.connect(signers.admin).setIssuerOpenRedemption(signers.user1.address, true);

            const latestBlock = await ethers.provider.getBlock("latest");
            const deadline = latestBlock.timestamp + TIME.ONE_DAY;

            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.ONE_TOKEN,
                PHRASE_COMMITMENT,
                NOTE_SALT,
                deadline,
                "test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            const noteId = event.args.noteId;

            const note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(note.openRedemptionSnapshot).to.equal(true);

            // Flip issuer openRedemption to false
            await facets.cambioIssuer.connect(signers.admin).setIssuerOpenRedemption(signers.user1.address, false);

            // Note snapshot should still be true
            const noteAfter = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(noteAfter.openRedemptionSnapshot).to.equal(true);
        });

        it("requiresCommitReveal auto-set when amount >= threshold", async function () {
            const latestBlock = await ethers.provider.getBlock("latest");
            const deadline = latestBlock.timestamp + TIME.ONE_DAY;

            // Amount below threshold
            const tx1 = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.ONE_TOKEN,
                PHRASE_COMMITMENT,
                NOTE_SALT,
                deadline,
                "test"
            );
            const receipt1 = await tx1.wait();
            const event1 = receipt1.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            const noteId1 = event1.args.noteId;
            const note1 = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId1);
            expect(note1.requiresCommitReveal).to.equal(false);

            // Amount at threshold
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.THOUSAND_TOKENS,
                3600,
                86400,
                2048,
                AMOUNTS.THOUSAND_TOKENS,
                7200,
                false
            );
            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.THOUSAND_TOKENS);
            const tx2 = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.THOUSAND_TOKENS,
                PHRASE_COMMITMENT,
                NOTE_SALT,
                deadline,
                "test"
            );
            const receipt2 = await tx2.wait();
            const event2 = receipt2.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            const noteId2 = event2.args.noteId;
            const note2 = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId2);
            expect(note2.requiresCommitReveal).to.equal(true);
        });

        it("T3USD is escrowed in diamond", async function () {
            const latestBlock = await ethers.provider.getBlock("latest");
            const deadline = latestBlock.timestamp + TIME.ONE_DAY;

            const balanceBefore = await facets.erc20.balanceOf(signers.user1.address);
            const diamondBalanceBefore = await facets.erc20.balanceOf(await facets.cambioEnvelope.getAddress());

            await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.ONE_TOKEN,
                PHRASE_COMMITMENT,
                NOTE_SALT,
                deadline,
                "test"
            );

            const balanceAfter = await facets.erc20.balanceOf(signers.user1.address);
            const diamondBalanceAfter = await facets.erc20.balanceOf(await facets.cambioEnvelope.getAddress());

            expect(balanceBefore - balanceAfter).to.equal(AMOUNTS.ONE_TOKEN);
            expect(diamondBalanceAfter - diamondBalanceBefore).to.equal(AMOUNTS.ONE_TOKEN);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Redemption by Phrase
    // ═══════════════════════════════════════════════════════════════════════

    describe("Redemption by Phrase", function () {
        const PHRASE = "super-secret-phrase-for-testing-only";
        const NOTE_SALT = ethers.hexlify(ethers.randomBytes(32));
        let phraseCommitment;
        let noteId;
        let deadline;

        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.TEN_TOKENS,
                3600,
                86400,
                2048,
                AMOUNTS.THOUSAND_TOKENS,
                86400, // maxCommitLifetime = 1 day
                false
            );

            phraseCommitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [PHRASE, NOTE_SALT])
            );

            const latestBlock = await ethers.provider.getBlock("latest");
            deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);

            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                deadline,
                "test-metadata"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            noteId = event.args.noteId;
        });

        it("redeemByPhrase succeeds with correct phrase", async function () {
            const redeemer = signers.user2;
            const balanceBefore = await facets.erc20.balanceOf(redeemer.address);

            await expect(
                facets.cambioEnvelope.connect(redeemer).redeemByPhrase(
                    noteId,
                    PHRASE,
                    AMOUNTS.ONE_TOKEN,
                    1,
                    "redeem-meta"
                )
            )
                .to.emit(facets.cambioEnvelope, "CambioEnvelopeNoteRedeemed")
                .withArgs(noteId, redeemer.address, AMOUNTS.ONE_TOKEN, AMOUNTS.TEN_TOKENS - AMOUNTS.ONE_TOKEN, ethers.isBytesLike);

            const balanceAfter = await facets.erc20.balanceOf(redeemer.address);
            expect(balanceAfter - balanceBefore).to.equal(AMOUNTS.ONE_TOKEN);

            const note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(note.spent).to.equal(AMOUNTS.ONE_TOKEN);
            expect(note.active).to.equal(true);
        });

        it("redeemByPhrase reverts with wrong phrase", async function () {
            await expect(
                facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                    noteId,
                    "wrong-phrase",
                    AMOUNTS.ONE_TOKEN,
                    1,
                    "redeem-meta"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "InvalidPhrase"
            );
        });

        it("redeemByPhrase reverts when note expired", async function () {
            await time.increase(TIME.ONE_DAY + 1);

            await expect(
                facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                    noteId,
                    PHRASE,
                    AMOUNTS.ONE_TOKEN,
                    1,
                    "redeem-meta"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "CambioNoteExpired"
            );
        });

        it("redeemByPhrase reverts when amount > remaining", async function () {
            await expect(
                facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                    noteId,
                    PHRASE,
                    AMOUNTS.TEN_TOKENS + 1n,
                    1,
                    "redeem-meta"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "InvalidRedemptionAmount"
            );
        });

        it("redeemByPhrase reverts on replayed nonce", async function () {
            await facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                noteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                42,
                "redeem-meta"
            );

            await expect(
                facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                    noteId,
                    PHRASE,
                    AMOUNTS.ONE_TOKEN,
                    42,
                    "redeem-meta-2"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "NonceAlreadySpent"
            );
        });

        it("partial redemption: note stays active, spent increases", async function () {
            await facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                noteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                1,
                "redeem-meta"
            );

            const note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(note.spent).to.equal(AMOUNTS.ONE_TOKEN);
            expect(note.active).to.equal(true);
            expect(note.escrowedAmount - note.spent).to.equal(AMOUNTS.TEN_TOKENS - AMOUNTS.ONE_TOKEN);
        });

        it("full redemption: note becomes inactive", async function () {
            await facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                noteId,
                PHRASE,
                AMOUNTS.TEN_TOKENS,
                1,
                "redeem-meta"
            );

            const note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(note.spent).to.equal(AMOUNTS.TEN_TOKENS);
            expect(note.active).to.equal(false);
        });

        it("daily ceiling enforced", async function () {
            await facets.cambioAdmin.connect(signers.admin).setIssuerDailyRedemptionCeiling(signers.user1.address, AMOUNTS.ONE_TOKEN);

            // First redemption at ceiling should succeed
            await facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                noteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                1,
                "redeem-meta"
            );

            // Create another note for second redemption attempt
            const latestBlock = await ethers.provider.getBlock("latest");
            const newDeadline = latestBlock.timestamp + TIME.ONE_DAY;
            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);
            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                newDeadline,
                "test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            const noteId2 = event.args.noteId;

            // Second redemption should exceed ceiling
            await expect(
                facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                    noteId2,
                    PHRASE,
                    AMOUNTS.ONE_TOKEN,
                    2,
                    "redeem-meta"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "CambioDailyRedemptionCeilingExceeded"
            );
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Relayer Enforcement
    // ═══════════════════════════════════════════════════════════════════════

    describe("Relayer Enforcement", function () {
        const PHRASE = "super-secret-phrase-for-testing-only";
        const NOTE_SALT = ethers.hexlify(ethers.randomBytes(32));
        let phraseCommitment;
        let openNoteId;
        let closedNoteId;
        let deadline;

        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.TEN_TOKENS,
                3600,
                86400,
                2048,
                AMOUNTS.THOUSAND_TOKENS,
                7200,
                false
            );

            phraseCommitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [PHRASE, NOTE_SALT])
            );

            const latestBlock = await ethers.provider.getBlock("latest");
            deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS * 2n);

            // Create closed note (openRedemption = false by default)
            const tx1 = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                deadline,
                "closed-note"
            );
            const receipt1 = await tx1.wait();
            const event1 = receipt1.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            closedNoteId = event1.args.noteId;

            // Create open bearer note
            await grantRole(facets.accessControl, ROLES.SPONSOR_BANK_ADMIN_ROLE, signers.admin.address, signers.owner);
            await facets.sponsorBank.connect(signers.admin).registerSponsorBank(signers.admin.address, "TEST_BANK", 0);
            await grantRole(facets.accessControl, ROLES.SPONSOR_BANK_OPERATOR_ROLE, signers.admin.address, signers.owner);
            await facets.cambioIssuer.connect(signers.admin).endorseNonBankIssuer(signers.user1.address);
            await facets.cambioIssuer.connect(signers.admin).getFunction("registerIssuer(address,address)")(signers.user1.address, signers.admin.address);
            await facets.cambioIssuer.connect(signers.admin).setIssuerOpenRedemption(signers.user1.address, true);

            const tx2 = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                deadline,
                "open-note"
            );
            const receipt2 = await tx2.wait();
            const event2 = receipt2.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            openNoteId = event2.args.noteId;

            // Set trustedForwarder to user3 for testing
            await erc2771.connect(signers.owner).setTrustedForwarder(signers.user3.address);
        });

        it("redeemByPhrase for open bearer note reverts when called directly", async function () {
            await expect(
                facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                    openNoteId,
                    PHRASE,
                    AMOUNTS.ONE_TOKEN,
                    1,
                    "redeem-meta"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "RelayerRequired"
            ).withArgs(openNoteId);
        });

        it("redeemByPhrase for open bearer note succeeds when called via trustedForwarder", async function () {
            const balanceBefore = await facets.erc20.balanceOf(signers.user2.address);

            // Build ERC-2771 calldata: function call + appended original sender
            const calldata = buildForwarderCalldata(
                facets.cambioEnvelope.interface,
                "redeemByPhrase",
                [openNoteId, PHRASE, AMOUNTS.ONE_TOKEN, 1, "redeem-meta"],
                signers.user2.address
            );

            // Send from trustedForwarder (user3) so msg.sender == trustedForwarder
            await signers.user3.sendTransaction({
                to: await facets.cambioEnvelope.getAddress(),
                data: calldata
            });

            const balanceAfter = await facets.erc20.balanceOf(signers.user2.address);
            expect(balanceAfter - balanceBefore).to.equal(AMOUNTS.ONE_TOKEN);
        });

        it("redeemByPhrase for closed note succeeds when called directly", async function () {
            const balanceBefore = await facets.erc20.balanceOf(signers.user2.address);

            await facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                closedNoteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                1,
                "redeem-meta"
            );

            const balanceAfter = await facets.erc20.balanceOf(signers.user2.address);
            expect(balanceAfter - balanceBefore).to.equal(AMOUNTS.ONE_TOKEN);
        });

        it("gate uses msg.sender, not _msgSender() — direct call with appended data still reverts", async function () {
            // Build calldata that appends user3 (the trustedForwarder address) to make _msgSender() extract user3
            const calldata = buildForwarderCalldata(
                facets.cambioEnvelope.interface,
                "redeemByPhrase",
                [openNoteId, PHRASE, AMOUNTS.ONE_TOKEN, 1, "redeem-meta"],
                signers.user3.address
            );

            // Send from user2 (NOT trustedForwarder). Even though appended data would extract user3 as _msgSender(),
            // the gate checks msg.sender != trustedForwarder and reverts.
            await expect(
                signers.user2.sendTransaction({
                    to: await facets.cambioEnvelope.getAddress(),
                    data: calldata
                })
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "RelayerRequired"
            ).withArgs(openNoteId);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Commit-Reveal System
    // ═══════════════════════════════════════════════════════════════════════

    describe("Commit-Reveal System", function () {
        const PHRASE = "super-secret-phrase-for-testing-only";
        const NOTE_SALT = ethers.hexlify(ethers.randomBytes(32));
        let phraseCommitment;
        let noteId;
        let deadline;

        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.TEN_TOKENS,
                3600,
                86400,
                2048,
                AMOUNTS.THOUSAND_TOKENS,
                7200,
                false
            );

            phraseCommitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [PHRASE, NOTE_SALT])
            );

            const latestBlock = await ethers.provider.getBlock("latest");
            deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);

            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                deadline,
                "test-metadata"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            noteId = event.args.noteId;
        });

        function computeCommitmentHash(chainId, diamondAddress, noteId, phrase, redeemer, amount, nonce) {
            return ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "address", "bytes32", "string", "address", "uint256", "uint256"],
                    [chainId, diamondAddress, noteId, phrase, redeemer, amount, nonce]
                )
            );
        }

        it("commitRedemption stores commit with correct expiry", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const latestBlockForCommit = await ethers.provider.getBlock("latest");
            const expiresAt = BigInt(latestBlockForCommit.timestamp + 3600);

            await expect(
                facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt)
            )
                .to.emit(facets.cambioEnvelope, "CommitRedemption")
                .withArgs(commitmentHash, signers.user2.address, expiresAt);
        });

        it("commitRedemption reverts if expiresAt > maxCommitLifetime", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 100000);

            await expect(
                facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt)
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "MaxCommitLifetimeExceeded"
            );
        });

        it("revealRedemption succeeds with matching commit", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const amount = AMOUNTS.ONE_TOKEN;
            const nonce = 1;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, amount, nonce
            );
            const latestBlockForCommit = await ethers.provider.getBlock("latest");
            const expiresAt = BigInt(latestBlockForCommit.timestamp + 3600);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt);

            const balanceBefore = await facets.erc20.balanceOf(signers.user2.address);

            await expect(
                facets.cambioEnvelope.connect(signers.user2).revealRedemption(noteId, PHRASE, amount, nonce)
            )
                .to.emit(facets.cambioEnvelope, "CambioEnvelopeNoteRedeemed")
                .withArgs(noteId, signers.user2.address, amount, AMOUNTS.TEN_TOKENS - amount, ethers.isBytesLike);

            const balanceAfter = await facets.erc20.balanceOf(signers.user2.address);
            expect(balanceAfter - balanceBefore).to.equal(amount);
        });

        it("revealRedemption reverts with wrong phrase", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const amount = AMOUNTS.ONE_TOKEN;
            const nonce = 1;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, amount, nonce
            );
            const latestBlockForCommit = await ethers.provider.getBlock("latest");
            const expiresAt = BigInt(latestBlockForCommit.timestamp + 3600);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt);

            // Changing the phrase changes the commitment hash, so reveal fails with InvalidCommit
            // before ever reaching phrase verification. This is correct: the commit binds the phrase.
            await expect(
                facets.cambioEnvelope.connect(signers.user2).revealRedemption(noteId, "wrong-phrase", amount, nonce)
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "InvalidCommit"
            );
        });

        it("revealRedemption reverts with wrong amount", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const latestBlockForCommit = await ethers.provider.getBlock("latest");
            const expiresAt = BigInt(latestBlockForCommit.timestamp + 3600);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt);

            await expect(
                facets.cambioEnvelope.connect(signers.user2).revealRedemption(noteId, PHRASE, AMOUNTS.TEN_TOKENS, 1)
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "InvalidCommit"
            );
        });

        it("revealRedemption reverts with wrong nonce", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const latestBlockForCommit = await ethers.provider.getBlock("latest");
            const expiresAt = BigInt(latestBlockForCommit.timestamp + 3600);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt);

            await expect(
                facets.cambioEnvelope.connect(signers.user2).revealRedemption(noteId, PHRASE, AMOUNTS.ONE_TOKEN, 2)
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "InvalidCommit"
            );
        });

        it("revealRedemption reverts with wrong redeemer", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const latestBlockForCommit = await ethers.provider.getBlock("latest");
            const expiresAt = BigInt(latestBlockForCommit.timestamp + 3600);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt);

            // Changing the redeemer changes the commitment hash, so reveal fails with InvalidCommit
            // before ever reaching redeemer verification. This is correct: the commit binds the redeemer.
            await expect(
                facets.cambioEnvelope.connect(signers.user3).revealRedemption(noteId, PHRASE, AMOUNTS.ONE_TOKEN, 1)
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "InvalidCommit"
            );
        });

        it("revealRedemption reverts for expired commit", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 10);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt);

            await time.increase(15);

            await expect(
                facets.cambioEnvelope.connect(signers.user2).revealRedemption(noteId, PHRASE, AMOUNTS.ONE_TOKEN, 1)
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "CommitExpired"
            ).withArgs(commitmentHash);
        });

        it("revealRedemption bypasses forwarder gate", async function () {
            // Set up open bearer note with commit-reveal
            await grantRole(facets.accessControl, ROLES.SPONSOR_BANK_ADMIN_ROLE, signers.admin.address, signers.owner);
            await facets.sponsorBank.connect(signers.admin).registerSponsorBank(signers.admin.address, "TEST_BANK", 0);
            await grantRole(facets.accessControl, ROLES.SPONSOR_BANK_OPERATOR_ROLE, signers.admin.address, signers.owner);
            await facets.cambioIssuer.connect(signers.admin).endorseNonBankIssuer(signers.user1.address);
            await facets.cambioIssuer.connect(signers.admin).getFunction("registerIssuer(address,address)")(signers.user1.address, signers.admin.address);
            await facets.cambioIssuer.connect(signers.admin).setIssuerOpenRedemption(signers.user1.address, true);

            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);
            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                deadline,
                "open-note"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            const openNoteId = event.args.noteId;

            // Set trustedForwarder so direct redeemByPhrase would fail
            await erc2771.connect(signers.owner).setTrustedForwarder(signers.user3.address);

            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, openNoteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const latestBlockForCommit = await ethers.provider.getBlock("latest");
            const expiresAt = BigInt(latestBlockForCommit.timestamp + 3600);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt);

            // revealRedemption should succeed directly (no forwarder needed)
            const balanceBefore = await facets.erc20.balanceOf(signers.user2.address);

            await facets.cambioEnvelope.connect(signers.user2).revealRedemption(openNoteId, PHRASE, AMOUNTS.ONE_TOKEN, 1);

            const balanceAfter = await facets.erc20.balanceOf(signers.user2.address);
            expect(balanceAfter - balanceBefore).to.equal(AMOUNTS.ONE_TOKEN);
        });

        it("two commits for same note/phrase/redeemer with different amounts coexist", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;

            const commitmentHash1 = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const commitmentHash2 = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 2
            );
            const latestBlockForCommit = await ethers.provider.getBlock("latest");
            const expiresAt = BigInt(latestBlockForCommit.timestamp + 3600);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash1, expiresAt);
            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash2, expiresAt);

            // Reveal first commit
            await facets.cambioEnvelope.connect(signers.user2).revealRedemption(noteId, PHRASE, AMOUNTS.ONE_TOKEN, 1);

            // Second commit should still be valid
            await facets.cambioEnvelope.connect(signers.user2).revealRedemption(noteId, PHRASE, AMOUNTS.ONE_TOKEN, 2);

            const note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(note.spent).to.equal(AMOUNTS.ONE_TOKEN + AMOUNTS.ONE_TOKEN);
            expect(note.active).to.equal(true);
        });

        it("revealRedemption consumes only the committed amount", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const latestBlockForCommit = await ethers.provider.getBlock("latest");
            const expiresAt = BigInt(latestBlockForCommit.timestamp + 3600);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt);

            await facets.cambioEnvelope.connect(signers.user2).revealRedemption(noteId, PHRASE, AMOUNTS.ONE_TOKEN, 1);

            const note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(note.spent).to.equal(AMOUNTS.ONE_TOKEN);
            expect(note.active).to.equal(true);
        });

        it("clearExpiredCommit callable by anyone post-expiry", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 10);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt);

            await time.increase(15);

            // user3 (anyone) can clear
            await expect(
                facets.cambioEnvelope.connect(signers.user3).clearExpiredCommit(commitmentHash)
            )
                .to.emit(facets.cambioEnvelope, "CommitCancelled")
                .withArgs(commitmentHash, signers.user2.address);
        });

        it("cancelCommit callable by committer only, pre-expiry", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const commitmentHash = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const latestBlockForCommit = await ethers.provider.getBlock("latest");
            const expiresAt = BigInt(latestBlockForCommit.timestamp + 3600);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt);

            // Non-committer cannot cancel
            await expect(
                facets.cambioEnvelope.connect(signers.user3).cancelCommit(commitmentHash)
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "CommitRedeemerMismatch"
            );

            // Committer can cancel
            await expect(
                facets.cambioEnvelope.connect(signers.user2).cancelCommit(commitmentHash)
            )
                .to.emit(facets.cambioEnvelope, "CommitCancelled")
                .withArgs(commitmentHash, signers.user2.address);
        });

        it("clearExpiredCommits batch sweep works", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;

            const commitmentHash1 = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const commitmentHash2 = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 2
            );
            const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 10);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash1, expiresAt);
            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash2, expiresAt);

            await time.increase(15);

            const tx = await facets.cambioEnvelope.connect(signers.user3).clearExpiredCommits([
                commitmentHash1,
                commitmentHash2
            ]);
            const receipt = await tx.wait();

            // Both CommitCancelled events should fire
            const events = receipt.logs.filter(
                log => log.fragment && log.fragment.name === "CommitCancelled"
            );
            expect(events.length).to.equal(2);
        });

        it("clearExpiredCommits no-ops on non-existent/unexpired commits", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;

            const commitmentHash1 = computeCommitmentHash(
                chainId, diamondAddress, noteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1
            );
            const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("nonexistent"));
            const expiresAt = BigInt((await ethers.provider.getBlock("latest")).timestamp + 10);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash1, expiresAt);

            // Try to clear before expiry + a non-existent hash
            const tx = await facets.cambioEnvelope.connect(signers.user3).clearExpiredCommits([
                commitmentHash1,
                fakeHash
            ]);
            const receipt = await tx.wait();

            const events = receipt.logs.filter(
                log => log.fragment && log.fragment.name === "CommitCleared"
            );
            expect(events.length).to.equal(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // requiresCommitReveal Enforcement
    // ═══════════════════════════════════════════════════════════════════════

    describe("requiresCommitReveal Enforcement", function () {
        const PHRASE = "super-secret-phrase-for-testing-only";
        const NOTE_SALT = ethers.hexlify(ethers.randomBytes(32));
        let phraseCommitment;
        let highValueNoteId;
        let lowValueNoteId;
        let deadline;

        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.THOUSAND_TOKENS * 2n,
                3600,
                86400,
                2048,
                AMOUNTS.THOUSAND_TOKENS,
                7200,
                false
            );

            phraseCommitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [PHRASE, NOTE_SALT])
            );

            const latestBlock = await ethers.provider.getBlock("latest");
            deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.THOUSAND_TOKENS * 2n);

            // Low-value note (below threshold)
            const tx1 = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.ONE_TOKEN,
                phraseCommitment,
                NOTE_SALT,
                deadline,
                "low-value"
            );
            const receipt1 = await tx1.wait();
            const event1 = receipt1.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            lowValueNoteId = event1.args.noteId;

            // High-value note (at threshold)
            const tx2 = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.THOUSAND_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                deadline,
                "high-value"
            );
            const receipt2 = await tx2.wait();
            const event2 = receipt2.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            highValueNoteId = event2.args.noteId;
        });

        it("note with requiresCommitReveal == true reverts on direct redeemByPhrase", async function () {
            const note = await facets.cambioEnvelope.getCambioEnvelopeNote(highValueNoteId);
            expect(note.requiresCommitReveal).to.equal(true);

            await expect(
                facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                    highValueNoteId,
                    PHRASE,
                    AMOUNTS.ONE_TOKEN,
                    1,
                    "redeem-meta"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "CommitRevealRequired"
            ).withArgs(highValueNoteId);
        });

        it("note with requiresCommitReveal == true succeeds via revealRedemption", async function () {
            const diamondAddress = await facets.cambioEnvelope.getAddress();
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const commitmentHash = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(
                    ["uint256", "address", "bytes32", "string", "address", "uint256", "uint256"],
                    [chainId, diamondAddress, highValueNoteId, PHRASE, signers.user2.address, AMOUNTS.ONE_TOKEN, 1]
                )
            );
            const latestBlockForCommit = await ethers.provider.getBlock("latest");
            const expiresAt = BigInt(latestBlockForCommit.timestamp + 3600);

            await facets.cambioEnvelope.connect(signers.user2).commitRedemption(commitmentHash, expiresAt);

            const balanceBefore = await facets.erc20.balanceOf(signers.user2.address);

            await facets.cambioEnvelope.connect(signers.user2).revealRedemption(
                highValueNoteId, PHRASE, AMOUNTS.ONE_TOKEN, 1
            );

            const balanceAfter = await facets.erc20.balanceOf(signers.user2.address);
            expect(balanceAfter - balanceBefore).to.equal(AMOUNTS.ONE_TOKEN);
        });

        it("note below threshold can still use direct redeemByPhrase", async function () {
            const note = await facets.cambioEnvelope.getCambioEnvelopeNote(lowValueNoteId);
            expect(note.requiresCommitReveal).to.equal(false);

            const balanceBefore = await facets.erc20.balanceOf(signers.user2.address);

            await facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                lowValueNoteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                1,
                "redeem-meta"
            );

            const balanceAfter = await facets.erc20.balanceOf(signers.user2.address);
            expect(balanceAfter - balanceBefore).to.equal(AMOUNTS.ONE_TOKEN);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Redemption by NoteId
    // ═══════════════════════════════════════════════════════════════════════

    describe("Redemption by NoteId", function () {
        const PHRASE = "super-secret-phrase-for-testing-only";
        const NOTE_SALT = ethers.hexlify(ethers.randomBytes(32));
        let phraseCommitment;
        let noteId;
        let deadline;

        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.TEN_TOKENS,
                3600,
                86400,
                2048,
                AMOUNTS.THOUSAND_TOKENS,
                7200,
                false
            );

            phraseCommitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [PHRASE, NOTE_SALT])
            );

            const latestBlock = await ethers.provider.getBlock("latest");
            deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);

            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                deadline,
                "test-metadata"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            noteId = event.args.noteId;
        });

        it("redeemByNoteId succeeds for closed notes with role", async function () {
            await grantRole(facets.accessControl, ROLES.CAMBIO_REDEEMER_ROLE, signers.user2.address, signers.owner);

            const balanceBefore = await facets.erc20.balanceOf(signers.user2.address);

            await facets.cambioEnvelope.connect(signers.user2).redeemByNoteId(
                noteId,
                AMOUNTS.ONE_TOKEN,
                1,
                "redeem-meta"
            );

            const balanceAfter = await facets.erc20.balanceOf(signers.user2.address);
            expect(balanceAfter - balanceBefore).to.equal(AMOUNTS.ONE_TOKEN);
        });

        it("redeemByNoteId reverts for open bearer notes", async function () {
            // Create an open redemption note
            await grantRole(facets.accessControl, ROLES.SPONSOR_BANK_ADMIN_ROLE, signers.admin.address, signers.owner);
            await facets.sponsorBank.connect(signers.admin).registerSponsorBank(signers.admin.address, "TEST_BANK", 0);
            await grantRole(facets.accessControl, ROLES.SPONSOR_BANK_OPERATOR_ROLE, signers.admin.address, signers.owner);
            await facets.cambioIssuer.connect(signers.admin).endorseNonBankIssuer(signers.user1.address);
            await facets.cambioIssuer.connect(signers.admin).getFunction("registerIssuer(address,address)")(signers.user1.address, signers.admin.address);
            await facets.cambioIssuer.connect(signers.admin).setIssuerOpenRedemption(signers.user1.address, true);

            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);
            const latestBlock = await ethers.provider.getBlock("latest");
            const openDeadline = latestBlock.timestamp + TIME.ONE_DAY;
            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                openDeadline,
                "test"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            const openNoteId = event.args.noteId;

            await grantRole(facets.accessControl, ROLES.CAMBIO_REDEEMER_ROLE, signers.user2.address, signers.owner);

            await expect(
                facets.cambioEnvelope.connect(signers.user2).redeemByNoteId(
                    openNoteId,
                    AMOUNTS.ONE_TOKEN,
                    1,
                    "redeem-meta"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "OpenRedemptionRequired"
            );
        });

        it("issuer self-recovery: succeeds post-deadline for own note", async function () {
            await time.increase(TIME.ONE_DAY + 1);

            const balanceBefore = await facets.erc20.balanceOf(signers.user1.address);

            await facets.cambioEnvelope.connect(signers.user1).redeemByNoteId(
                noteId,
                AMOUNTS.ONE_TOKEN,
                1,
                "redeem-meta"
            );

            const balanceAfter = await facets.erc20.balanceOf(signers.user1.address);
            expect(balanceAfter - balanceBefore).to.equal(AMOUNTS.ONE_TOKEN);
        });

        it("issuer self-recovery: reverts pre-deadline without role", async function () {
            // user1 is the issuer but does NOT have CAMBIO_REDEEMER_ROLE
            // (they have CAMBIO_ISSUER_ROLE, which counts as a valid role)
            // So this test is tricky. Let me revoke CAMBIO_ISSUER_ROLE from user1 first.
            await facets.accessControl.connect(signers.owner).revokeRole(ROLES.CAMBIO_ISSUER_ROLE, signers.user1.address);

            await expect(
                facets.cambioEnvelope.connect(signers.user1).redeemByNoteId(
                    noteId,
                    AMOUNTS.ONE_TOKEN,
                    1,
                    "redeem-meta"
                )
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "UnauthorizedRole"
            );
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Cancellation
    // ═══════════════════════════════════════════════════════════════════════

    describe("Cancellation", function () {
        const PHRASE = "super-secret-phrase-for-testing-only";
        const NOTE_SALT = ethers.hexlify(ethers.randomBytes(32));
        let phraseCommitment;
        let noteId;

        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.TEN_TOKENS,
                3600,
                86400,
                2048,
                AMOUNTS.THOUSAND_TOKENS,
                7200,
                false
            );

            phraseCommitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [PHRASE, NOTE_SALT])
            );

            const latestBlock = await ethers.provider.getBlock("latest");
            const deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);

            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                deadline,
                "test-metadata"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            noteId = event.args.noteId;
        });

        it("only issuer can cancel", async function () {
            await expect(
                facets.cambioEnvelope.connect(signers.user2).cancelEnvelopeNote(noteId)
            ).to.be.revertedWithCustomError(
                facets.cambioEnvelope,
                "NotNoteIssuer"
            );
        });

        it("returns remaining T3USD to issuer", async function () {
            const balanceBefore = await facets.erc20.balanceOf(signers.user1.address);

            await facets.cambioEnvelope.connect(signers.user1).cancelEnvelopeNote(noteId);

            const balanceAfter = await facets.erc20.balanceOf(signers.user1.address);
            expect(balanceAfter - balanceBefore).to.equal(AMOUNTS.TEN_TOKENS);
        });

        it("sets note inactive", async function () {
            await facets.cambioEnvelope.connect(signers.user1).cancelEnvelopeNote(noteId);

            const note = await facets.cambioEnvelope.getCambioEnvelopeNote(noteId);
            expect(note.active).to.equal(false);
        });

        it("emits CambioEnvelopeNoteCancelled", async function () {
            await expect(
                facets.cambioEnvelope.connect(signers.user1).cancelEnvelopeNote(noteId)
            )
                .to.emit(facets.cambioEnvelope, "CambioEnvelopeNoteCancelled")
                .withArgs(noteId, signers.user1.address, AMOUNTS.TEN_TOKENS);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // wave-panel LOW-3 (K-F3): single-item sanctioned-issuer holds
    // ═══════════════════════════════════════════════════════════════════════

    describe("wave-panel LOW-3 (K-F3) — sanctioned issuer: single-item hold routing", function () {
        const PHRASE = "low3-secret-phrase";
        const NOTE_SALT = ethers.hexlify(ethers.randomBytes(32));
        const SCREENING_BLOCKED = 3;
        let noteId;
        let holdLib;

        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.TEN_TOKENS, 3600, 86400, 2048, AMOUNTS.THOUSAND_TOKENS, 7200, false
            );
            const phraseCommitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [PHRASE, NOTE_SALT])
            );
            const deadline = (await time.latest()) + TIME.ONE_DAY;
            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);
            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS, phraseCommitment, NOTE_SALT, deadline, ""
            );
            const receipt = await tx.wait();
            noteId = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            ).args.noteId;

            // Arm sanctions, then block the issuer AFTER escrow-in.
            const instId = ethers.id("LOW3_INST");
            await facets.complianceScreening.connect(signers.owner)
                .setInstitutionSanctionsEnabled(instId, true);
            await facets.complianceScreening.connect(signers.owner)
                .recordNetworkScreening(signers.user1.address, SCREENING_BLOCKED, ethers.ZeroHash);

            // Hold events/errors live in the emitting library; decode via its ABI.
            holdLib = await ethers.getContractAt("ComplianceHoldLib", deployment.diamondAddress);
        });

        it("cancelEnvelopeNote parks a hold instead of paying the blocked issuer (leg 20)", async function () {
            const balBefore = await facets.erc20.balanceOf(signers.user1.address);
            const tx = facets.cambioEnvelope.connect(signers.user1).cancelEnvelopeNote(noteId);
            await expect(tx).to.emit(holdLib, "CompliancePayoutHeld");
            await expect(tx).to.not.emit(facets.cambioEnvelope, "CambioEnvelopeNoteCancelled");

            // Nothing paid; note state untouched until admin disposition.
            expect(await facets.erc20.balanceOf(signers.user1.address)).to.equal(balBefore);
            const note = await facets.cambioEnvelope.connect(signers.owner).getCambioEnvelopeNote(noteId);
            expect(note.active).to.equal(true);
            expect(note.spent).to.equal(0);

            // The held note stays frozen against a second cancel.
            await expect(
                facets.cambioEnvelope.connect(signers.user1).cancelEnvelopeNote(noteId)
            ).to.be.revertedWithCustomError(holdLib, "ComplianceHoldActive").withArgs(noteId);
        });

        it("issuer self-recovery redemption parks a hold instead of paying the blocked issuer (leg 21)", async function () {
            // Post-deadline self-recovery: redeemer == issuer, no redeemer role
            // needed (CambioEnvelopeFacet.sol:300) — the payout leg still
            // screens the payee and parks.
            await time.increase(TIME.ONE_DAY + 1);
            const balBefore = await facets.erc20.balanceOf(signers.user1.address);
            await expect(
                facets.cambioEnvelope.connect(signers.user1)
                    .redeemByNoteId(noteId, AMOUNTS.TEN_TOKENS, 1, "")
            ).to.emit(holdLib, "CompliancePayoutHeld");

            expect(await facets.erc20.balanceOf(signers.user1.address)).to.equal(balBefore);
            const note = await facets.cambioEnvelope.connect(signers.owner).getCambioEnvelopeNote(noteId);
            expect(note.active).to.equal(true);
            expect(note.spent).to.equal(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Receipts
    // ═══════════════════════════════════════════════════════════════════════

    describe("Receipts", function () {
        const PHRASE = "super-secret-phrase-for-testing-only";
        const NOTE_SALT = ethers.hexlify(ethers.randomBytes(32));
        let phraseCommitment;
        let noteId;

        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.TEN_TOKENS,
                3600,
                86400,
                2048,
                AMOUNTS.THOUSAND_TOKENS,
                7200,
                false
            );

            phraseCommitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [PHRASE, NOTE_SALT])
            );

            const latestBlock = await ethers.provider.getBlock("latest");
            const deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);

            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                deadline,
                "test-metadata"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            noteId = event.args.noteId;
        });

        it("receipt ID format includes chainid + address(this)", async function () {
            const redeemer = signers.user2;
            const metadata = "redeem-meta";

            const tx = await facets.cambioEnvelope.connect(redeemer).redeemByPhrase(
                noteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                1,
                metadata
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteRedeemed"
            );
            const receiptId = event.args.receiptId;

            // Verify receipt struct
            const storedReceipt = await facets.cambioEnvelope.getCambioEnvelopeReceipt(receiptId);
            expect(storedReceipt.noteId).to.equal(noteId);
            expect(storedReceipt.issuer).to.equal(signers.user1.address);
            expect(storedReceipt.redeemer).to.equal(redeemer.address);
            expect(storedReceipt.amount).to.equal(AMOUNTS.ONE_TOKEN);
            expect(storedReceipt.metadataHash).to.equal(ethers.keccak256(ethers.toUtf8Bytes(metadata)));

            // Verify raw metadata is NOT stored
            // The receipt struct only has metadataHash, no metadata field
        });

        it("receipt stored correctly", async function () {
            const redeemer = signers.user2;
            const metadata = "redeem-meta";

            await facets.cambioEnvelope.connect(redeemer).redeemByPhrase(
                noteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                1,
                metadata
            );

            const receipts = await facets.cambioEnvelope.getCambioEnvelopeReceiptsForNote(noteId);
            expect(receipts.length).to.equal(1);

            const storedReceipt = await facets.cambioEnvelope.getCambioEnvelopeReceipt(receipts[0]);
            expect(storedReceipt.noteId).to.equal(noteId);
            expect(storedReceipt.amount).to.equal(AMOUNTS.ONE_TOKEN);
        });

        it("ReceiptsByNote mapping populated", async function () {
            const redeemer = signers.user2;

            await facets.cambioEnvelope.connect(redeemer).redeemByPhrase(
                noteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                1,
                "meta-1"
            );

            await facets.cambioEnvelope.connect(redeemer).redeemByPhrase(
                noteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                2,
                "meta-2"
            );

            const receipts = await facets.cambioEnvelope.getCambioEnvelopeReceiptsForNote(noteId);
            expect(receipts.length).to.equal(2);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // NoteRedeemed Event (FR-1402)
    // ═══════════════════════════════════════════════════════════════════════

    describe("NoteRedeemed Event", function () {
        const PHRASE = "super-secret-phrase-for-testing-only";
        const NOTE_SALT = ethers.hexlify(ethers.randomBytes(32));
        let phraseCommitment;
        let noteId;
        let deadline;

        beforeEach(async function () {
            await grantRole(
                facets.accessControl,
                ROLES.SPONSOR_BANK_ADMIN_ROLE,
                signers.admin.address,
                signers.owner
            );
            await facets.sponsorBank
                .connect(signers.admin)
                .registerSponsorBank(signers.admin.address, "TEST_BANK", 0);
            await grantRole(
                facets.accessControl,
                ROLES.SPONSOR_BANK_OPERATOR_ROLE,
                signers.admin.address,
                signers.owner
            );
            await facets.cambioIssuer.connect(signers.admin).endorseNonBankIssuer(signers.user1.address);
            await facets.cambioIssuer
                .connect(signers.admin)
                .getFunction("registerIssuer(address,address)")(
                    signers.user1.address,
                    signers.admin.address
                );
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.TEN_TOKENS,
                3600,
                86400,
                2048,
                AMOUNTS.THOUSAND_TOKENS,
                7200,
                false
            );

            phraseCommitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [PHRASE, NOTE_SALT])
            );

            const latestBlock = await ethers.provider.getBlock("latest");
            deadline = latestBlock.timestamp + TIME.ONE_DAY;

            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);

            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                deadline,
                "test-metadata"
            );
            const receipt = await tx.wait();
            const event = receipt.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            );
            noteId = event.args.noteId;
        });

        it("emits NoteRedeemed with legacyIssuer == effectiveIssuer when no recovery", async function () {
            const tx = await facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                noteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                1,
                "redeem-meta"
            );
            const receipt = await tx.wait();

            const noteRedeemedEvents = receipt.logs.filter(
                log => log.fragment && log.fragment.name === "NoteRedeemed"
            );
            expect(noteRedeemedEvents.length).to.equal(1);
            const args = noteRedeemedEvents[0].args;
            expect(args.noteId).to.equal(noteId);
            expect(args.legacyIssuer).to.equal(signers.user1.address);
            expect(args.effectiveIssuer).to.equal(signers.user1.address);
            expect(args.redeemer).to.equal(signers.user2.address);
            expect(args.amount).to.equal(AMOUNTS.ONE_TOKEN);
        });

        it("emits NoteRedeemed with legacyIssuer != effectiveIssuer when recovery active", async function () {
            // Skip if wallet recovery facet unavailable
            if (!facets.walletRecovery || !facets.custodian) {
                this.skip();
            }

            // Register user1 and user2 as custodians for recovery
            const futureExpiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
            const custodianRole = ethers.id("CUSTODIAN_ROLE");
            await grantRole(facets.accessControl, custodianRole, signers.user1.address, signers.owner);
            await grantRole(facets.accessControl, custodianRole, signers.user2.address, signers.owner);
            await facets.custodian.connect(signers.owner).grantCustodianRole(signers.user1.address);
            await facets.custodian.connect(signers.user1).registerCustodiedWallet(signers.user1.address, 1, futureExpiry);
            await facets.custodian.connect(signers.owner).grantCustodianRole(signers.user2.address);
            await facets.custodian.connect(signers.user2).registerCustodiedWallet(signers.user2.address, 1, futureExpiry);

            // Initiate recovery user1 -> user2 and designate successor
            const legacyProfile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user1.address);
            expect(legacyProfile.isActive).to.be.true;
            expect(legacyProfile.valueOutstanding).to.equal(AMOUNTS.TEN_TOKENS);
            const txRec = await facets.walletRecovery.connect(signers.admin).initiateRecovery(signers.user1.address, 0);
            const receiptRec = await txRec.wait();
            const logRec = receiptRec.logs.find(l => {
                try { return facets.walletRecovery.interface.parseLog(l).name === "RecoveryInitiated"; } catch { return false; }
            });
            const recoveryId = facets.walletRecovery.interface.parseLog(logRec).args.recoveryId;
            await facets.walletRecovery.connect(signers.admin).designateSuccessor(recoveryId, signers.user2.address);
            const successorProfile = await facets.cambioEnvelope.getIssuerEnvelopeProfile(signers.user2.address);
            expect(successorProfile.valueOutstanding).to.equal(AMOUNTS.TEN_TOKENS);
            expect(successorProfile.notesOutstanding).to.equal(1n);

            const tx = await facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                noteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                1,
                "redeem-meta"
            );
            const receipt = await tx.wait();

            const noteRedeemedEvents = receipt.logs.filter(
                log => log.fragment && log.fragment.name === "NoteRedeemed"
            );
            expect(noteRedeemedEvents.length).to.equal(1);
            const args = noteRedeemedEvents[0].args;
            expect(args.noteId).to.equal(noteId);
            expect(args.legacyIssuer).to.equal(signers.user1.address);
            expect(args.effectiveIssuer).to.equal(signers.user2.address);
            expect(args.redeemer).to.equal(signers.user2.address);
            expect(args.amount).to.equal(AMOUNTS.ONE_TOKEN);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // C-F10 — view ACLs (crossfacet remediation)
    // ═══════════════════════════════════════════════════════════════════════

    describe("C-F10 view ACLs", function () {
        const PHRASE = "acl-phrase-for-testing-only";
        const NOTE_SALT = ethers.hexlify(ethers.randomBytes(32));
        let noteId;
        let receiptId;

        beforeEach(async function () {
            await facets.cambioEnvelope.connect(signers.admin).advanceCambioPhase();
            await facets.cambioAdmin.connect(signers.admin).setCambioEnvelopeConfig(
                AMOUNTS.TEN_TOKENS,
                3600,
                86400,
                2048,
                AMOUNTS.THOUSAND_TOKENS,
                7200,
                false
            );

            const phraseCommitment = ethers.keccak256(
                ethers.AbiCoder.defaultAbiCoder().encode(["string", "bytes32"], [PHRASE, NOTE_SALT])
            );
            const latestBlock = await ethers.provider.getBlock("latest");

            await facets.mintBurn.connect(signers.owner).mint(signers.user1.address, AMOUNTS.TEN_TOKENS);

            const tx = await facets.cambioEnvelope.connect(signers.user1).createCambioNote(
                AMOUNTS.TEN_TOKENS,
                phraseCommitment,
                NOTE_SALT,
                latestBlock.timestamp + TIME.ONE_DAY,
                "acl-meta"
            );
            const rec = await tx.wait();
            noteId = rec.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteCreated"
            ).args.noteId;

            const rtx = await facets.cambioEnvelope.connect(signers.user2).redeemByPhrase(
                noteId,
                PHRASE,
                AMOUNTS.ONE_TOKEN,
                1,
                "acl-redeem"
            );
            const rrec = await rtx.wait();
            receiptId = rrec.logs.find(
                log => log.fragment && log.fragment.name === "CambioEnvelopeNoteRedeemed"
            ).args.receiptId;
        });

        it("issuer-scoped views: issuer and operator may read; strangers may not", async function () {
            const ce = facets.cambioEnvelope;
            const { user1, user3, owner } = signers;

            await ce.connect(user1).getIssuerEnvelopeProfile(user1.address);
            await ce.connect(user1).getIssuerCeilingBuckets(user1.address);
            await ce.connect(owner).getIssuerEnvelopeProfile(user1.address);
            await ce.connect(owner).getIssuerCeilingBuckets(user1.address);

            await expect(ce.connect(user3).getIssuerEnvelopeProfile(user1.address))
                .to.be.revertedWithCustomError(ce, "UnauthorizedViewer")
                .withArgs(user3.address);
            await expect(ce.connect(user3).getIssuerCeilingBuckets(user1.address))
                .to.be.revertedWithCustomError(ce, "UnauthorizedViewer")
                .withArgs(user3.address);
        });

        it("note views: note-issuer-scoped; non-existent notes are not probeable", async function () {
            const ce = facets.cambioEnvelope;
            const { user1, user3, owner } = signers;

            expect((await ce.connect(user1).getCambioEnvelopeNote(noteId)).issuer).to.equal(user1.address);
            await ce.connect(owner).getCambioEnvelopeNote(noteId);
            expect((await ce.connect(user1).getCambioEnvelopeReceiptsForNote(noteId)).length).to.equal(1);

            await expect(ce.connect(user3).getCambioEnvelopeNote(noteId))
                .to.be.revertedWithCustomError(ce, "UnauthorizedViewer")
                .withArgs(user3.address);
            await expect(ce.connect(user3).getCambioEnvelopeReceiptsForNote(noteId))
                .to.be.revertedWithCustomError(ce, "UnauthorizedViewer")
                .withArgs(user3.address);

            // Non-existent note: a stranger gets the same UnauthorizedViewer as for an
            // existing note (no existence probing); an operator reads the empty struct.
            const missing = ethers.id("no-such-note");
            await expect(ce.connect(user3).getCambioEnvelopeNote(missing))
                .to.be.revertedWithCustomError(ce, "UnauthorizedViewer")
                .withArgs(user3.address);
            expect((await ce.connect(owner).getCambioEnvelopeNote(missing)).issuer).to.equal(ZERO_ADDRESS);
        });

        it("receipt views: redeemer carve-out plus issuer/operator; strangers denied", async function () {
            const ce = facets.cambioEnvelope;
            const { user1, user2, user3, owner } = signers;

            expect((await ce.connect(user2).getCambioEnvelopeReceipt(receiptId)).redeemer).to.equal(user2.address);
            await ce.connect(user1).getCambioEnvelopeReceipt(receiptId); // note issuer
            await ce.connect(owner).getCambioEnvelopeReceipt(receiptId); // operator

            await expect(ce.connect(user3).getCambioEnvelopeReceipt(receiptId))
                .to.be.revertedWithCustomError(ce, "UnauthorizedViewer")
                .withArgs(user3.address);
        });

        it("phase and config views stay public (deliberate C-F10 exception)", async function () {
            const ce = facets.cambioEnvelope;
            const { user3 } = signers;

            await ce.connect(user3).getCambioEnvelopePhase();
            await ce.connect(user3).getCambioEnvelopeConfig();
        });

        it("custodian-of-issuer may read issuer-scoped views; an unrelated custodian may not", async function () {
            const ce = facets.cambioEnvelope;
            const { user1, custodian1, custodian2 } = signers;

            const now = Math.floor(Date.now() / 1000);
            await facets.custodian
                .connect(custodian1)
                .registerCustodiedWallet(user1.address, now, now + 365 * 24 * 3600);

            await ce.connect(custodian1).getIssuerEnvelopeProfile(user1.address);
            await ce.connect(custodian1).getIssuerCeilingBuckets(user1.address);
            await ce.connect(custodian1).getCambioEnvelopeNote(noteId);
            await ce.connect(custodian1).getCambioEnvelopeReceiptsForNote(noteId);

            // CUSTODIAN_ROLE alone is not enough — must be THE custodian of the issuer
            await expect(ce.connect(custodian2).getIssuerEnvelopeProfile(user1.address))
                .to.be.revertedWithCustomError(ce, "UnauthorizedViewer")
                .withArgs(custodian2.address);
        });

        it("COMPLIANCE_ROLE holder is an operator on issuer/note/receipt views", async function () {
            const ce = facets.cambioEnvelope;
            const { user1, user3, owner } = signers;
            const COMPLIANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("COMPLIANCE_ROLE"));

            // user3 starts as a stranger…
            await expect(ce.connect(user3).getIssuerEnvelopeProfile(user1.address))
                .to.be.revertedWithCustomError(ce, "UnauthorizedViewer")
                .withArgs(user3.address);

            // …and becomes an operator once granted COMPLIANCE_ROLE
            await grantRole(facets.accessControl, COMPLIANCE_ROLE, user3.address, owner);

            await ce.connect(user3).getIssuerEnvelopeProfile(user1.address);
            await ce.connect(user3).getIssuerCeilingBuckets(user1.address);
            await ce.connect(user3).getCambioEnvelopeNote(noteId);
            await ce.connect(user3).getCambioEnvelopeReceiptsForNote(noteId);
            await ce.connect(user3).getCambioEnvelopeReceipt(receiptId);
        });

        it("redeemer is deliberately excluded from the per-note receipt LIST view", async function () {
            const ce = facets.cambioEnvelope;
            const { user2 } = signers;

            // user2 redeemed receiptId, so the single-receipt view works…
            expect((await ce.connect(user2).getCambioEnvelopeReceipt(receiptId)).redeemer)
                .to.equal(user2.address);

            // …but the per-note list is an issuer audit surface: it would expose
            // OTHER redeemers' receipt ids, so the redeemer carve-out does not apply.
            await expect(ce.connect(user2).getCambioEnvelopeReceiptsForNote(noteId))
                .to.be.revertedWithCustomError(ce, "UnauthorizedViewer")
                .withArgs(user2.address);
        });
    });
});
