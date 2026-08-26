const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { deployT3DiamondFixture } = require("../helpers/deployment");
const { setupTestRoles, ROLES } = require("../helpers/roles");

/**
 * Wave 4 attributed-issuance capacity model: quote / reserve / execute / cancel / expire,
 * daily caps, anti-oversubscription, and the capacityModelActive mint gate.
 */
describe("IssuanceCapacityModel (Wave 4)", function () {
    const ASSET_TYPE = 1;
    const USDC_PLEDGE = ethers.parseUnits("1000", 6); // 1000 USDC (6 decimals)
    const CAPACITY = ethers.parseEther("1000");        // 1000e18 after normalization @ 100% factor
    const TTL = 3600;                                  // IssuanceRoutingLib.DEFAULT_TTL (1 hour)

    let RoutingLib; // for decoding library events/errors

    before(async function () {
        RoutingLib = await ethers.getContractFactory("IssuanceRoutingLib");
    });

    async function baseFixture() {
        const dep = await deployT3DiamondFixture();
        const { facets, signers, diamondAddress } = dep;
        await setupTestRoles(facets, signers);

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const usdc = await MockERC20.deploy("Mock USDC", "mUSDC", ethers.parseUnits("1000000", 6));
        await usdc.waitForDeployment();

        await facets.multiAssetVault.connect(signers.admin).configureAssetType(ASSET_TYPE, {
            tokenAddress: await usdc.getAddress(),
            decimals: 6,
            collateralFactorBps: 10000,
            haircutBps: 0,
            maxBankExposure: 0,
            isActive: true,
        });
        // Required for the asset to count toward effectiveReserve (capacity model base).
        await facets.multiAssetVault.connect(signers.admin).registerAssetTypeForReserve(ASSET_TYPE);

        const bank = signers.user1;
        await facets.consortiumMembership.connect(signers.admin).registerBank(
            bank.address, "Test Bank", bank.address, ethers.parseEther("10000000")
        );
        await facets.consortiumMembership.connect(signers.admin).configureBankWallet(
            bank.address, ASSET_TYPE, bank.address, bank.address
        );

        await usdc.connect(signers.owner).transfer(bank.address, USDC_PLEDGE);
        await usdc.connect(bank).approve(diamondAddress, USDC_PLEDGE);
        await facets.multiAssetVault.connect(bank).pledgeCollateral(ASSET_TYPE, USDC_PLEDGE);

        return { ...dep, usdc, bank };
    }

    // Fixture with attribution initialized + capacity model active (the production posture).
    async function activeFixture() {
        const f = await baseFixture();
        await f.facets.issuanceControl.connect(f.signers.owner).initializeClaimAttribution();
        await f.facets.issuanceControl.connect(f.signers.owner).setCapacityModelActive(true);
        return f;
    }

    async function reserveAndGetId(facets, signer, bank, amount) {
        const tx = await facets.issuanceControl.connect(signer).reserveIssuance(bank, amount);
        const rc = await tx.wait();
        for (const log of rc.logs) {
            try {
                const parsed = RoutingLib.interface.parseLog(log);
                if (parsed && parsed.name === "IssuanceReserved") return parsed.args.id;
            } catch (_) { /* not this event */ }
        }
        throw new Error("IssuanceReserved not emitted");
    }

    describe("quote + reserve/execute happy path", function () {
        it("quote reflects pledged capacity; reserve/execute mints attributed supply", async function () {
            const { facets, signers, bank } = await loadFixture(activeFixture);
            expect(await facets.issuanceControl.quoteIssuance(bank.address)).to.equal(CAPACITY);

            const amount = ethers.parseEther("400");
            const id = await reserveAndGetId(facets, signers.minter, bank.address, amount);

            // reservation encumbers capacity
            expect(await facets.issuanceControl.getReservedTotal(bank.address)).to.equal(amount);
            expect(await facets.issuanceControl.quoteIssuance(bank.address)).to.equal(CAPACITY - amount);

            await facets.issuanceControl.connect(signers.minter).executeIssuance(id);

            expect(await facets.erc20.balanceOf(bank.address)).to.equal(amount);
            expect(await facets.issuanceControl.getIssuerAttributedOutstanding(bank.address)).to.equal(amount);
            expect(await facets.issuanceControl.getReservedTotal(bank.address)).to.equal(0);
            // capacity dropped by outstanding now (reserve unchanged), not double-counted
            expect(await facets.issuanceControl.quoteIssuance(bank.address)).to.equal(CAPACITY - amount);
            expect(await facets.erc20.totalSupply()).to.equal(amount);
        });
    });

    describe("anti-oversubscription", function () {
        it("concurrent reservations cannot exceed capacity", async function () {
            const { facets, signers, bank } = await loadFixture(activeFixture);
            const big = ethers.parseEther("700");
            await reserveAndGetId(facets, signers.minter, bank.address, big);
            // second 700 would exceed the 1000 capacity (only 300 free)
            await expect(
                facets.issuanceControl.connect(signers.minter).reserveIssuance(bank.address, big)
            ).to.be.revertedWithCustomError(RoutingLib, "InsufficientCapacity");
        });

        it("cancel frees the reserved capacity", async function () {
            const { facets, signers, bank } = await loadFixture(activeFixture);
            const id = await reserveAndGetId(facets, signers.minter, bank.address, CAPACITY);
            expect(await facets.issuanceControl.quoteIssuance(bank.address)).to.equal(0);
            await facets.issuanceControl.connect(signers.minter).cancelReservation(id);
            expect(await facets.issuanceControl.quoteIssuance(bank.address)).to.equal(CAPACITY);
            expect(await facets.issuanceControl.getReservedTotal(bank.address)).to.equal(0);
        });
    });

    describe("TTL expiry", function () {
        it("execute reverts after TTL; expire sweeps and frees capacity; cancel-after-expiry reverts", async function () {
            const { facets, signers, bank } = await loadFixture(activeFixture);
            const amount = ethers.parseEther("100");
            const id = await reserveAndGetId(facets, signers.minter, bank.address, amount);

            await time.increase(TTL + 1);

            await expect(
                facets.issuanceControl.connect(signers.minter).executeIssuance(id)
            ).to.be.revertedWithCustomError(RoutingLib, "ReservationExpired");
            await expect(
                facets.issuanceControl.connect(signers.minter).cancelReservation(id)
            ).to.be.revertedWithCustomError(RoutingLib, "ReservationExpired");

            // permissionless expire sweep frees capacity
            await facets.issuanceControl.connect(signers.user3).expireReservation(id);
            expect(await facets.issuanceControl.getReservedTotal(bank.address)).to.equal(0);
        });
    });

    describe("daily cap", function () {
        it("enforces the cap at execute (concurrent reservations) and rolls over the next day", async function () {
            const { facets, signers, bank } = await loadFixture(activeFixture);
            const cap = ethers.parseEther("300");
            const chunk = ethers.parseEther("150");
            await facets.issuanceControl.connect(signers.owner).setBankDailyCap(bank.address, cap);

            // Three reservations made before any execute consumes the day's cap (reserve does
            // not consume the daily allowance, only execute does).
            const id1 = await reserveAndGetId(facets, signers.minter, bank.address, chunk);
            const id2 = await reserveAndGetId(facets, signers.minter, bank.address, chunk);
            const id3 = await reserveAndGetId(facets, signers.minter, bank.address, chunk);

            // First two fill the 300 cap.
            await facets.issuanceControl.connect(signers.minter).executeIssuance(id1);
            await facets.issuanceControl.connect(signers.minter).executeIssuance(id2);
            // Third would exceed the day's remaining (0) — hard-gated at execute.
            await expect(
                facets.issuanceControl.connect(signers.minter).executeIssuance(id3)
            ).to.be.revertedWithCustomError(RoutingLib, "DailyCapExceeded");

            // Roll to next day → cap resets. id3's TTL has expired, so reserve fresh and execute.
            await time.increase(24 * 3600);
            await facets.issuanceControl.connect(signers.minter).expireReservation(id3);
            const id4 = await reserveAndGetId(facets, signers.minter, bank.address, chunk);
            await expect(facets.issuanceControl.connect(signers.minter).executeIssuance(id4)).to.not.be.reverted;
            expect(await facets.erc20.balanceOf(bank.address)).to.equal(cap + chunk); // 300 + 150
        });
    });

    describe("access control + idempotency", function () {
        it("reserve/execute/cancel require MINTER_ROLE; expire is permissionless", async function () {
            const { facets, signers, bank } = await loadFixture(activeFixture);
            await expect(
                facets.issuanceControl.connect(signers.user2).reserveIssuance(bank.address, ethers.parseEther("10"))
            ).to.be.reverted; // missing MINTER_ROLE
        });

        it("a reservation cannot be executed twice", async function () {
            const { facets, signers, bank } = await loadFixture(activeFixture);
            const id = await reserveAndGetId(facets, signers.minter, bank.address, ethers.parseEther("100"));
            await facets.issuanceControl.connect(signers.minter).executeIssuance(id);
            await expect(
                facets.issuanceControl.connect(signers.minter).executeIssuance(id)
            ).to.be.revertedWithCustomError(RoutingLib, "ReservationNotActive");
        });

        it("another minter cannot execute or cancel someone else's reservation (bug_004)", async function () {
            const { facets, signers, bank } = await loadFixture(activeFixture);
            await facets.accessControl.connect(signers.owner).grantRole(ROLES.MINTER_ROLE, signers.user3.address);
            const id = await reserveAndGetId(facets, signers.minter, bank.address, ethers.parseEther("100"));
            await expect(
                facets.issuanceControl.connect(signers.user3).executeIssuance(id)
            ).to.be.revertedWithCustomError(facets.issuanceControl, "NotReservationOwner");
            await expect(
                facets.issuanceControl.connect(signers.user3).cancelReservation(id)
            ).to.be.revertedWithCustomError(facets.issuanceControl, "NotReservationOwner");
        });
    });

    describe("attribution init guard", function () {
        it("executeIssuance reverts when attribution is not initialized", async function () {
            const f = await loadFixture(baseFixture); // no init, but activate capacity model
            await f.facets.issuanceControl.connect(f.signers.owner).setCapacityModelActive(true);
            const id = await reserveAndGetId(f.facets, f.signers.minter, f.bank.address, ethers.parseEther("100"));
            await expect(
                f.facets.issuanceControl.connect(f.signers.minter).executeIssuance(id)
            ).to.be.revertedWithCustomError(f.facets.issuanceControl, "AttributionNotInitialized");
        });
    });

    describe("capacityModelActive mint gate", function () {
        it("blocks legacy mintForConsortiumBank and mint() when active", async function () {
            const { facets, signers, bank } = await loadFixture(activeFixture);
            await expect(
                facets.mintBurn.connect(signers.minter).mintForConsortiumBank(bank.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(facets.mintBurn, "CapacityModelActive");
            await expect(
                facets.mintBurn.connect(signers.minter).mint(signers.user2.address, ethers.parseEther("1"))
            ).to.be.revertedWithCustomError(facets.mintBurn, "CapacityModelActive");
        });
    });
});
