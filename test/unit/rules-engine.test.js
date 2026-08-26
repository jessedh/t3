const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("RulesEngineFacet (scoring + KYC)", function () {
  let owner, user1, user2;
  let diamond, diamondCut;
  let rulesEngine, rulesConfig;

  const FacetCutAction = { Add: 0, Replace: 1, Remove: 2 };

  async function addFacet(facetInstance) {
    const selectors = [];
    facetInstance.interface.forEachFunction((f) => { selectors.push(f.selector); });
    const cut = [{ facetAddress: await facetInstance.getAddress(), action: FacetCutAction.Add, functionSelectors: selectors }];
    await diamondCut.connect(owner).diamondCut(cut, ethers.ZeroAddress, "0x");
  }

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();

    // Deploy DiamondCutFacet
    const DiamondCutFacet = await ethers.getContractFactory("DiamondCutFacet");
    const diamondCutFacet = await DiamondCutFacet.deploy();
    await diamondCutFacet.waitForDeployment();

    // Deploy Diamond
    const Diamond = await ethers.getContractFactory("Diamond");
    diamond = await Diamond.deploy(owner.address, await diamondCutFacet.getAddress());
    await diamond.waitForDeployment();
    diamondCut = await ethers.getContractAt("IDiamondCut", await diamond.getAddress());

    // Deploy and add RulesConfig + RulesEngine facets
    const RulesConfigFacet = await ethers.getContractFactory("RulesConfigFacet");
    const RulesEngineFacet = await ethers.getContractFactory("RulesEngineFacet");
    const cfg = await RulesConfigFacet.deploy();
    const eng = await RulesEngineFacet.deploy();
    await cfg.waitForDeployment();
    await eng.waitForDeployment();

    await addFacet(cfg);
    await addFacet(eng);

    rulesConfig = await ethers.getContractAt("RulesConfigFacet", await diamond.getAddress());
    rulesEngine = await ethers.getContractAt("RulesEngineFacet", await diamond.getAddress());
  });

  it("computes score for missing KYC with observation mode", async function () {
    // Configure observation mode and thresholds
    await rulesConfig.connect(owner).setObservationMode(true, 400, 800);

    // Configure network scope ruleset with requireKyc
    const scopeNetwork = await rulesConfig.scopeKeyForNetwork();
    const RuleSet = {
      enabledBits: 0,
      warnThreshold: 400,
      blockThreshold: 800,
      velocityWindowSecs: 0,
      maxAmount: 0,
      maxOutflowAmount: 0,
      maxPerRecipientDaily: 0,
      maxEvalCount: 10,
      restrictContracts: false,
      extendCommitOnWarn: false,
      warnExtendSeconds: 0,
      requireKyc: true,
      kycAmountThreshold: 0,
      kycSoonSeconds: 0,
      createdAt: 0,
      effectiveFrom: 0
    };
    await rulesConfig.connect(owner).setRuleSet(scopeNetwork, RuleSet);

    // Weight missing sender KYC high enough to reach DENY threshold
    await rulesConfig.connect(owner).setRuleWeight(scopeNetwork, 10, 900); // RULE_KYC_SENDER_MISSING

    const from = user1.address;
    const to = user2.address;
    const amount = ethers.parseEther("1");

    const [totalScore, action] = await rulesEngine.evaluateRulesPreview(from, to, amount, "0x", [], []);
    expect(BigInt(totalScore)).to.be.gte(900n);
    // In observation mode, action classification may be DENY, but engine does not enforce
    expect(action).to.equal(2); // DENY classification

    const [score2, action2] = await rulesEngine.evaluateRulesPreview(from, to, amount, "0x", [], []);
    // Returns (score, action). Even in observation mode we return DENY classification
    expect(BigInt(score2)).to.equal(BigInt(totalScore));
    expect(action2).to.equal(2); // DENY classification
  });

  it("classifies WARN for exceeding per-tx with configured weight", async function () {
    await rulesConfig.connect(owner).setObservationMode(true, 400, 800);
    const scopeNetwork = await rulesConfig.scopeKeyForNetwork();
    const RuleSet = {
      enabledBits: 0,
      warnThreshold: 400,
      blockThreshold: 800,
      velocityWindowSecs: 0,
      maxAmount: ethers.parseEther("1"), // 1 T3
      maxOutflowAmount: 0,
      maxEvalCount: 10,
      restrictContracts: false,
      extendCommitOnWarn: false,
      requireKyc: false,
      kycAmountThreshold: 0,
      kycSoonSeconds: 0,
      createdAt: 0,
      effectiveFrom: 0,
      maxPerRecipientDaily: 0,
      warnExtendSeconds: 0
    };
    await rulesConfig.connect(owner).setRuleSet(scopeNetwork, RuleSet);
    await rulesConfig.connect(owner).setRuleWeight(scopeNetwork, 2, 500); // RULE_MAX_PER_TX

    const from = user1.address;
    const to = user2.address;
    const amount = ethers.parseEther("2");
    const [score3, action3] = await rulesEngine.evaluateRulesPreview(from, to, amount, "0x", [], []);
    expect(BigInt(score3)).to.equal(560n);
    expect(action3).to.equal(1); // WARN classification
  });

  it("should reject postTransferUpdate from external address (R-11: onlyDiamond guard)", async function () {
    await expect(
      rulesEngine.connect(user1).postTransferUpdate(user1.address, user2.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(rulesEngine, "CallerNotDiamond");
  });
});
