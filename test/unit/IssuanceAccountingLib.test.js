const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("IssuanceAccountingLib", function () {
    let harness;
    let walletA;
    let walletB;
    let walletC;
    let issuer1;
    let issuer2;
    let issuer3;
    let issuer4;

    beforeEach(async function () {
        const Harness = await ethers.getContractFactory("IssuanceAccountingHarness");
        harness = await Harness.deploy();
        await harness.waitForDeployment();
        await harness.initialize();

        const signers = await ethers.getSigners();
        walletA = signers[10].address;
        walletB = signers[11].address;
        walletC = signers[12].address;
        issuer1 = signers[13].address;
        issuer2 = signers[14].address;
        issuer3 = signers[15].address;
        issuer4 = signers[16].address;
    });

    function deterministicAddress(index) {
        return ethers.getAddress(ethers.zeroPadValue(ethers.toBeHex(index), 20));
    }

    async function snapshot() {
        return {
            supply: await harness.totalSupply(),
            attributed: await harness.totalAttributedOutstanding(),
            walletABalance: await harness.balanceOf(walletA),
            walletAClaims: await harness.sumWalletClaims(walletA),
            issuer1: await harness.getIssuerAttributedOutstanding(issuer1),
            issuer2: await harness.getIssuerAttributedOutstanding(issuer2),
            issuer3: await harness.getIssuerAttributedOutstanding(issuer3),
        };
    }

    it("mints balance, holder claim, issuer outstanding, and supply atomically", async function () {
        await harness.mintAttributed(issuer1, walletA, 1000);

        expect(await harness.balanceOf(walletA)).to.equal(1000);
        expect(await harness.getWalletClaimAmount(walletA, issuer1)).to.equal(1000);
        expect(await harness.getIssuerAttributedOutstanding(issuer1)).to.equal(1000);
        expect(await harness.totalAttributedOutstanding()).to.equal(1000);
        expect(await harness.totalSupply()).to.equal(1000);
        await expect(harness.assertAttributedSupplyConservation()).not.to.be.reverted;
    });

    it("burns a single issuer composition atomically", async function () {
        await harness.mintAttributed(issuer1, walletA, 1000);
        const [issuers, amounts] = await harness.burnAttributed.staticCall(walletA, 400);
        expect(issuers).to.deep.equal([issuer1]);
        expect(amounts).to.deep.equal([400n]);

        await harness.burnAttributed(walletA, 400);
        expect(await harness.balanceOf(walletA)).to.equal(600);
        expect(await harness.getWalletClaimAmount(walletA, issuer1)).to.equal(600);
        expect(await harness.getIssuerAttributedOutstanding(issuer1)).to.equal(600);
        expect(await harness.totalAttributedOutstanding()).to.equal(600);
        expect(await harness.totalSupply()).to.equal(600);
    });

    it("burns mixed FIFO buckets and decrements each issuer exactly", async function () {
        await harness.mintAttributed(issuer1, walletA, 1000);
        await harness.mintAttributed(issuer2, walletA, 2000);

        const [issuers, amounts] = await harness.burnAttributed.staticCall(walletA, 1500);
        expect(issuers).to.deep.equal([issuer1, issuer2]);
        expect(amounts).to.deep.equal([1000n, 500n]);
        await harness.burnAttributed(walletA, 1500);

        expect(await harness.balanceOf(walletA)).to.equal(1500);
        expect(await harness.getWalletClaimAmount(walletA, issuer1)).to.equal(0);
        expect(await harness.getWalletClaimAmount(walletA, issuer2)).to.equal(1500);
        expect(await harness.getIssuerAttributedOutstanding(issuer1)).to.equal(0);
        expect(await harness.getIssuerAttributedOutstanding(issuer2)).to.equal(1500);
        expect(await harness.totalAttributedOutstanding()).to.equal(1500);
        expect(await harness.totalSupply()).to.equal(1500);
    });

    it("substitutes holder and issuer liability without changing supply", async function () {
        await harness.mintAttributed(issuer1, walletA, 1000);
        await harness.mintAttributed(issuer2, walletA, 2000);

        const supplyBefore = await harness.totalSupply();
        const hash = await harness.substituteAttributed.staticCall(
            walletA,
            walletB,
            1500,
            issuer3
        );
        expect(hash).to.equal(
            await harness.computeCompositionHash([issuer1, issuer2], [1000, 500])
        );
        await harness.substituteAttributed(walletA, walletB, 1500, issuer3);

        expect(await harness.totalSupply()).to.equal(supplyBefore);
        expect(await harness.totalAttributedOutstanding()).to.equal(supplyBefore);
        expect(await harness.getIssuerAttributedOutstanding(issuer1)).to.equal(0);
        expect(await harness.getIssuerAttributedOutstanding(issuer2)).to.equal(1500);
        expect(await harness.getIssuerAttributedOutstanding(issuer3)).to.equal(1500);
        expect(await harness.getWalletClaimAmount(walletB, issuer3)).to.equal(1500);
        expect(await harness.balanceOf(walletA)).to.equal(1500);
        expect(await harness.balanceOf(walletB)).to.equal(1500);
    });

    it("conserves supply and attribution across chained substitutions", async function () {
        await harness.mintAttributed(issuer1, walletA, 2000);
        await harness.substituteAttributed(walletA, walletB, 1500, issuer3);
        await harness.substituteAttributed(walletB, walletC, 1000, issuer4);

        expect(await harness.totalSupply()).to.equal(2000);
        expect(await harness.totalAttributedOutstanding()).to.equal(2000);
        expect(await harness.getIssuerAttributedOutstanding(issuer1)).to.equal(500);
        expect(await harness.getIssuerAttributedOutstanding(issuer3)).to.equal(500);
        expect(await harness.getIssuerAttributedOutstanding(issuer4)).to.equal(1000);
        expect(await harness.getWalletClaimAmount(walletC, issuer4)).to.equal(1000);
        await expect(harness.assertAttributedSupplyConservation()).not.to.be.reverted;
    });

    it("rolls back a mint when the beneficiary bucket limit is exhausted", async function () {
        for (let i = 1; i <= 16; i++) {
            await harness.mintAttributed(
                deterministicAddress(6000 + i),
                walletA,
                i
            );
        }
        const before = await snapshot();

        await expect(
            harness.mintAttributed(deterministicAddress(6017), walletA, 17)
        ).to.be.revertedWithCustomError(harness, "TooManyIssuerBuckets");
        expect(await snapshot()).to.deep.equal(before);
    });

    it("rolls back a burn that exceeds the account balance", async function () {
        await harness.mintAttributed(issuer1, walletA, 1000);
        const before = await snapshot();
        await expect(
            harness.burnAttributed(walletA, 1001)
        ).to.be.revertedWithCustomError(harness, "ERC20InsufficientBalance");
        expect(await snapshot()).to.deep.equal(before);
    });

    it("rejects invalid liability substitution inputs without changing state", async function () {
        await harness.mintAttributed(issuer1, walletA, 1000);
        const before = await snapshot();

        await expect(
            harness.substituteLiability([issuer1], [500, 500], issuer2, 500)
        ).to.be.revertedWithCustomError(harness, "ArrayLengthMismatch");
        await expect(
            harness.substituteLiability([issuer1], [500], issuer2, 499)
        ).to.be.revertedWithCustomError(harness, "AmountMismatch");
        await expect(
            harness.substituteLiability([issuer1], [500], ethers.ZeroAddress, 500)
        ).to.be.revertedWithCustomError(harness, "ZeroAddress");
        await expect(
            harness.substituteLiability([issuer1, issuer1], [250, 250], issuer2, 500)
        ).to.be.revertedWithCustomError(harness, "DuplicateIssuer");
        await expect(
            harness.substituteLiability([issuer1, issuer2], [1000, 0], issuer3, 1000)
        ).to.be.revertedWithCustomError(harness, "ZeroAmount");
        await expect(
            harness.substituteLiability([issuer1], [1001], issuer2, 1001)
        ).to.be.revertedWithCustomError(harness, "InsufficientIssuerOutstanding");

        expect(await snapshot()).to.deep.equal(before);
    });

    it("keeps aggregate attribution unchanged for a direct holder-only credit", async function () {
        await harness.creditClaimOnly(walletA, issuer1, 500);
        expect(await harness.getWalletClaimAmount(walletA, issuer1)).to.equal(500);
        expect(await harness.getIssuerAttributedOutstanding(issuer1)).to.equal(0);
        expect(await harness.totalAttributedOutstanding()).to.equal(0);
        expect(await harness.totalSupply()).to.equal(0);
    });

    it("detects corrupted attributed supply state", async function () {
        await harness.setRawAccountingState(1000, 999);
        await expect(
            harness.assertAttributedSupplyConservation()
        ).to.be.revertedWithCustomError(harness, "AttributedSupplyMismatch");
    });
});
