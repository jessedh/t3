const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * @title Storage Layout Analyzer Script
 * @dev Analyzes diamond storage layouts and identifies potential upgrade risks
 * @notice Critical tool for ensuring storage layout safety during upgrades
 */

class StorageLayoutAnalyzer {
    constructor() {
        this.analysisResults = {
            timestamp: new Date().toISOString(),
            storageLayouts: {},
            riskAssessment: {},
            upgradeRecommendations: [],
            conflicts: [],
            metrics: {}
        };
        
        // Storage layout definitions based on actual contracts
        this.knownStorageLayouts = {
            AppStorage: {
                storageSlot: "com.t3programmablefiat.diamond.AppStorage.v1.995ced7e2b6e426f836004bd3a63670d",
                expectedPosition: ethers.keccak256(
                    ethers.toUtf8Bytes(
                        "com.t3programmablefiat.diamond.AppStorage.v1.995ced7e2b6e426f836004bd3a63670d"
                    )
                ),
                variables: this._getAppStorageVariables(),
                riskLevel: "HIGH",
                estimatedSize: 80
            },
            SponsorBankStorage: {
                storageSlot: "t3token.storage.sponsorbank.v1",
                expectedPosition: ethers.keccak256(ethers.toUtf8Bytes("t3token.storage.sponsorbank.v1")),
                variables: this._getSponsorBankStorageVariables(),
                riskLevel: "LOW",
                estimatedSize: 15
            },
            InvestmentStorage: {
                storageSlot: "t3token.storage.investment.v1",
                expectedPosition: ethers.keccak256(ethers.toUtf8Bytes("t3token.storage.investment.v1")),
                variables: this._getInvestmentStorageVariables(),
                riskLevel: "LOW",
                estimatedSize: 20
            }
        };
    }

    /**
     * Main analysis entry point
     */
    async analyzeStorageLayouts() {
        console.log("🔍 Starting Storage Layout Analysis...");
        console.log("=" .repeat(60));

        try {
            // Analyze each storage system
            await this._analyzeAppStorage();
            await this._analyzeSponsorBankStorage();
            await this._analyzeInvestmentStorage();
            
            // Detect conflicts and risks
            await this._detectStorageConflicts();
            await this._assessUpgradeRisks();
            
            // Generate recommendations
            this._generateRecommendations();
            
            // Calculate metrics
            this._calculateMetrics();
            
            // Output results
            this._displayResults();
            await this._saveResults();
            
            console.log("✅ Storage Layout Analysis Complete");
            
            return this.analysisResults;
            
        } catch (error) {
            console.error("❌ Storage Layout Analysis Failed:", error.message);
            throw error;
        }
    }

    /**
     * Analyze AppStorage layout and risks
     */
    async _analyzeAppStorage() {
        console.log("📊 Analyzing AppStorage Layout...");
        
        const appStorageInfo = this.knownStorageLayouts.AppStorage;
        const analysis = {
            name: "AppStorage",
            position: appStorageInfo.expectedPosition,
            variableCount: appStorageInfo.variables.length,
            criticalVariables: appStorageInfo.variables.filter(v => v.critical).length,
            riskFactors: [],
            upgradeComplexity: "HIGH"
        };

        // Assess risk factors
        if (analysis.variableCount > 70) {
            analysis.riskFactors.push("High variable count increases upgrade fragility");
        }
        
        if (analysis.criticalVariables > 20) {
            analysis.riskFactors.push("Many critical variables make reordering dangerous");
        }

        // Check for problematic patterns
        const problematicVariables = appStorageInfo.variables.filter(v => 
            v.type.includes("mapping") && v.critical
        );
        
        if (problematicVariables.length > 15) {
            analysis.riskFactors.push("High number of critical mappings complicate upgrades");
        }

        // Remaining capacity comes from the struct's OWN reserved gap, not a guessed
        // ceiling. A diamond-storage struct can grow indefinitely -- what actually
        // constrains it is the trailing __gap/__futureGap array reserved for
        // upgrade-safe appends. The previous hardcoded ceiling of 95 produced a
        // NEGATIVE capacity once the real 104-field struct was parsed, which is not a
        // meaningful number to report.
        const gapVar = appStorageInfo.variables.filter((v) => /^__(gap|futureGap)$/.test(v.name));
        const gapSlots = gapVar.reduce((n, v) => {
            const m = v.type.match(/\[(\d+)\]/);
            return n + (m ? parseInt(m[1], 10) : 0);
        }, 0);
        analysis.reservedGapSlots = gapSlots;
        analysis.remainingCapacity = gapSlots;
        
        if (analysis.remainingCapacity < 10) {
            analysis.riskFactors.push("Limited remaining storage capacity");
        }

        this.analysisResults.storageLayouts.AppStorage = analysis;
        console.log(`  ➤ Variables: ${analysis.variableCount} (${analysis.criticalVariables} critical)`);
        console.log(`  \u27a4 Reserved gap slots (upgrade headroom): ${analysis.remainingCapacity}`);
        console.log(`  ➤ Risk Factors: ${analysis.riskFactors.length}`);
    }

    /**
     * Analyze SponsorBankStorage layout
     */
    async _analyzeSponsorBankStorage() {
        console.log("📊 Analyzing SponsorBankStorage Layout...");
        
        const sponsorBankInfo = this.knownStorageLayouts.SponsorBankStorage;
        const analysis = {
            name: "SponsorBankStorage",
            position: sponsorBankInfo.expectedPosition,
            variableCount: sponsorBankInfo.variables.length,
            isolated: true,
            riskFactors: [],
            upgradeComplexity: "LOW"
        };

        // Diamond storage pattern is safer
        analysis.riskFactors.push("Uses diamond storage pattern - safer for upgrades");
        
        // Check for emergency pause capability
        const hasEmergencyPause = sponsorBankInfo.variables.some(v => v.name === "emergencyPaused");
        if (hasEmergencyPause) {
            analysis.riskFactors.push("Emergency pause capability available");
        }

        this.analysisResults.storageLayouts.SponsorBankStorage = analysis;
        console.log(`  ➤ Variables: ${analysis.variableCount}`);
        console.log(`  ➤ Isolated: ${analysis.isolated}`);
        console.log(`  ➤ Risk Level: ${sponsorBankInfo.riskLevel}`);
    }

    /**
     * Analyze InvestmentStorage layout
     */
    async _analyzeInvestmentStorage() {
        console.log("📊 Analyzing InvestmentStorage Layout...");
        
        const investmentInfo = this.knownStorageLayouts.InvestmentStorage;
        const analysis = {
            name: "InvestmentStorage",
            position: investmentInfo.expectedPosition,
            variableCount: investmentInfo.variables.length,
            isolated: true,
            riskFactors: [],
            upgradeComplexity: "LOW"
        };

        // Diamond storage pattern is safer
        analysis.riskFactors.push("Uses diamond storage pattern - safer for upgrades");
        
        // Check for emergency pause capability  
        const hasEmergencyPause = investmentInfo.variables.some(v => v.name === "emergencyPaused");
        if (hasEmergencyPause) {
            analysis.riskFactors.push("Emergency pause capability available");
        } else {
            analysis.riskFactors.push("⚠️  Missing emergency pause setter function");
        }

        this.analysisResults.storageLayouts.InvestmentStorage = analysis;
        console.log(`  ➤ Variables: ${analysis.variableCount}`);
        console.log(`  ➤ Isolated: ${analysis.isolated}`);
        console.log(`  ➤ Risk Level: ${investmentInfo.riskLevel}`);
    }

    /**
     * Detect potential storage slot conflicts
     */
    async _detectStorageConflicts() {
        console.log("🔍 Detecting Storage Conflicts...");
        
        const storagePositions = [];
        const conflicts = [];

        // Collect all storage positions
        for (const [name, layout] of Object.entries(this.knownStorageLayouts)) {
            const position = BigInt(layout.expectedPosition);
            storagePositions.push({ name, position });
        }

        // Check for conflicts (positions too close together)
        const minSafeDistance = 1n << 252n;
        
        for (let i = 0; i < storagePositions.length; i++) {
            for (let j = i + 1; j < storagePositions.length; j++) {
                const distance = storagePositions[i].position > storagePositions[j].position 
                    ? storagePositions[i].position - storagePositions[j].position
                    : storagePositions[j].position - storagePositions[i].position;
                
                if (distance < minSafeDistance) {
                    conflicts.push({
                        storage1: storagePositions[i].name,
                        storage2: storagePositions[j].name,
                        distance: distance.toString(),
                        severity: "MEDIUM",
                        description: "Storage positions may be too close"
                    });
                }
            }
        }

        this.analysisResults.conflicts = conflicts;
        console.log(`  ➤ Conflicts Found: ${conflicts.length}`);
        
        if (conflicts.length > 0) {
            conflicts.forEach(conflict => {
                console.log(`    ⚠️  ${conflict.storage1} ↔ ${conflict.storage2}: ${conflict.description}`);
            });
        }
    }

    /**
     * Assess upgrade risks across all storage systems
     */
    async _assessUpgradeRisks() {
        console.log("⚠️  Assessing Upgrade Risks...");
        
        const riskAssessment = {
            overall: "MEDIUM",
            categories: {
                storageLayoutFragility: "HIGH",
                storageSlotConflicts: "LOW", 
                emergencyResponseGaps: "HIGH",
                upgradeComplexity: "HIGH"
            },
            criticalIssues: [],
            recommendations: []
        };

        // Assess AppStorage fragility
        const appStorage = this.analysisResults.storageLayouts.AppStorage;
        if (appStorage.variableCount > 70) {
            riskAssessment.criticalIssues.push({
                category: "Storage Fragility",
                severity: "HIGH",
                description: "AppStorage has 80+ variables making it fragile to upgrades",
                impact: "Incorrect upgrades could corrupt all user balances and system state"
            });
        }

        // Emergency response: no in-repo threat DETECTOR (the actuator exists and works).
        riskAssessment.criticalIssues.push({
            category: "Emergency Response",
            severity: "MEDIUM",
            description: "No threat-monitoring facet exists in the manifest; threat detection is external",
            impact: "AutomatedResponseFacet.respondToQuantumThreatLevel is manually invoked by an " +
                    "ADMIN_ROLE or CUSTODIAN_ROLE holder. Escalation is automated once invoked, but " +
                    "nothing on-chain decides when to invoke it."
        });

        riskAssessment.criticalIssues.push({
            category: "Test Coverage",
            severity: "MEDIUM",
            description: "respondToQuantumThreatLevel has no test coverage",
            impact: "An emergency circuit breaker that pauses AppStorage, SponsorBank and " +
                    "Investment storage is untested."
        });

        this.analysisResults.riskAssessment = riskAssessment;
        console.log(`  ➤ Overall Risk: ${riskAssessment.overall}`);
        console.log(`  ➤ Critical Issues: ${riskAssessment.criticalIssues.length}`);
    }

    /**
     * Generate upgrade and safety recommendations
     */
    _generateRecommendations() {
        console.log("💡 Generating Recommendations...");
        
        const recommendations = [
            {
                priority: "MEDIUM",
                category: "Emergency Response Integration",
                title: "Add test coverage for the emergency circuit breaker, and wire a threat source",
                description: "AutomatedResponseFacet is in the manifest and does pause AppStorage, " +
                             "SponsorBank and Investment storage. What is missing is (a) test coverage " +
                             "for respondToQuantumThreatLevel and (b) any on-chain source of threat levels.",
                implementation: "Write tests for the >=9 / >=7 / ==0 escalation branches. If automated " +
                                "response is wanted, grant an external monitor ADMIN_ROLE or " +
                                "CUSTODIAN_ROLE deliberately -- there is no monitoring facet in this repo.",
                effort: "Medium"
            },
            {
                priority: "HIGH",
                category: "Storage Layout Safety",
                title: "Implement automated storage layout validation",
                description: "Add pre-upgrade storage layout validation to prevent corruption",
                implementation: "Integrate storage-layout-analyzer.js into CI/CD pipeline",
                effort: "Low"
            },
            {
                priority: "HIGH", 
                category: "Storage Architecture",
                title: "Migrate complex features to isolated storage",
                description: "Move quantum resistance and audit trails to dedicated storage",
                implementation: "Create QuantumResistanceStorage and AuditTrailsStorage libraries",
                effort: "High"
            },
            {
                priority: "MEDIUM",
                category: "Storage Capacity",
                title: "Plan AppStorage capacity management",
                description: "With 80+ variables, AppStorage is approaching practical limits",
                implementation: "Document variable addition process and monitor capacity",
                effort: "Low"
            },
            {
                priority: "LOW",
                category: "Emergency Infrastructure",
                title: "Emergency pause setters exist — keep them covered by tests",
                description: "InvestmentStorage.emergencyPaused and SponsorBankStorage.emergencyPaused " +
                             "are both settable via AutomatedResponseFacet.emergencyPauseStorageSystem / " +
                             "emergencyResumeStorageSystem. This entry previously claimed no setter " +
                             "existed and pointed at InvestmentComplianceFacet, which is not in this repo.",
                implementation: "Add tests for the pause/resume paths; no new setter is required.",
                effort: "Low"
            }
        ];

        this.analysisResults.upgradeRecommendations = recommendations;
        console.log(`  ➤ Recommendations Generated: ${recommendations.length}`);
        
        recommendations.filter(r => r.priority === "CRITICAL").forEach(rec => {
            console.log(`    🚨 CRITICAL: ${rec.title}`);
        });
    }

    /**
     * Calculate storage layout metrics
     */
    _calculateMetrics() {
        const metrics = {
            totalStorageSystems: Object.keys(this.knownStorageLayouts).length,
            totalVariables: 0,
            criticalVariables: 0,
            isolatedStorageSystems: 0,
            storageUtilization: {},
            riskScore: 0
        };

        // Calculate totals
        for (const layout of Object.values(this.knownStorageLayouts)) {
            metrics.totalVariables += layout.variables.length;
            metrics.criticalVariables += layout.variables.filter(v => v.critical).length;
            
            if (layout.riskLevel === "LOW") {
                metrics.isolatedStorageSystems++;
            }
        }

        // Calculate storage utilization
        const appStorage = this.analysisResults.storageLayouts.AppStorage;
        metrics.storageUtilization.AppStorage = {
            used: appStorage.variableCount,
            capacity: 95, // Conservative estimate
            utilizationPercent: Math.round((appStorage.variableCount / 95) * 100)
        };

        // Calculate risk score (0-100, higher = riskier)
        let riskScore = 0;
        riskScore += Math.min(appStorage.variableCount, 50); // Variable count contribution
        riskScore += this.analysisResults.riskAssessment.criticalIssues.length * 10; // Critical issues
        riskScore += this.analysisResults.conflicts.length * 5; // Conflicts
        
        metrics.riskScore = Math.min(riskScore, 100);

        this.analysisResults.metrics = metrics;
    }

    /**
     * Display analysis results
     */
    _displayResults() {
        console.log("\n" + "=".repeat(60));
        console.log("📋 STORAGE LAYOUT ANALYSIS RESULTS");
        console.log("=".repeat(60));

        // Summary metrics
        const metrics = this.analysisResults.metrics;
        console.log(`📊 METRICS:`);
        console.log(`   Total Storage Systems: ${metrics.totalStorageSystems}`);
        console.log(`   Total Variables: ${metrics.totalVariables}`);
        console.log(`   Critical Variables: ${metrics.criticalVariables}`);
        console.log(`   Risk Score: ${metrics.riskScore}/100`);
        console.log(`   AppStorage Utilization: ${metrics.storageUtilization.AppStorage.utilizationPercent}%`);

        // Critical issues
        console.log(`\n🚨 CRITICAL ISSUES (${this.analysisResults.riskAssessment.criticalIssues.length}):`);
        this.analysisResults.riskAssessment.criticalIssues.forEach((issue, i) => {
            console.log(`   ${i + 1}. [${issue.severity}] ${issue.description}`);
            console.log(`      Impact: ${issue.impact}`);
        });

        // Top recommendations
        console.log(`\n💡 TOP RECOMMENDATIONS:`);
        this.analysisResults.upgradeRecommendations
            .filter(r => r.priority === "CRITICAL" || r.priority === "HIGH")
            .slice(0, 5)
            .forEach((rec, i) => {
                console.log(`   ${i + 1}. [${rec.priority}] ${rec.title}`);
                console.log(`      ${rec.description}`);
            });

        // Storage conflicts
        if (this.analysisResults.conflicts.length > 0) {
            console.log(`\n⚠️  STORAGE CONFLICTS (${this.analysisResults.conflicts.length}):`);
            this.analysisResults.conflicts.forEach((conflict, i) => {
                console.log(`   ${i + 1}. ${conflict.storage1} ↔ ${conflict.storage2}`);
                console.log(`      ${conflict.description}`);
            });
        }

        console.log("\n" + "=".repeat(60));
    }

    /**
     * Save analysis results to file
     */
    async _saveResults() {
        const outputDir = path.join(__dirname, "../storage-analysis");
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `storage-layout-analysis-${timestamp}.json`;
        const filepath = path.join(outputDir, filename);

        fs.writeFileSync(filepath, JSON.stringify(this.analysisResults, null, 2));
        console.log(`📁 Results saved to: ${filepath}`);

        // Also save latest analysis
        const latestPath = path.join(outputDir, "latest-analysis.json");
        fs.writeFileSync(latestPath, JSON.stringify(this.analysisResults, null, 2));
    }

    // Storage variable definitions (based on actual contracts)

    _getAppStorageVariables() {
        // PARSED FROM SOURCE, never hardcoded. This method previously listed 26 of
        // AppStorage's fields with a literal "... Additional variables would be listed
        // here" placeholder and a stale __gap[15]. The real struct has 104 fields ending
        // in __futureGap[48], so the tool reported utilisation of a surface it had only
        // seen a quarter of. A risk tool that understates what it measures is worse than
        // no tool, so it now reads contracts/lib/StorageLib.sol directly.
        const src = fs.readFileSync(
            path.join(__dirname, "..", "contracts", "lib", "StorageLib.sol"), "utf8"
        ).split("\n");
        const startIdx = src.findIndex((l) => /struct\s+AppStorage\s*\{/.test(l));
        if (startIdx === -1) throw new Error("AppStorage struct not found in StorageLib.sol");

        // Fields whose loss or reordering breaks the diamond or the token itself.
        const CRITICAL = /^(_selectors|_roles|_facetAddresses|_facetFunctionSelectors|_name|_symbol|_balances|_allowances|_totalSupply|_paused|_reentrancyMutex|storageVersion|__gap|__futureGap)$/;

        const vars = [];
        let depth = 0;
        for (let i = startIdx; i < src.length; i++) {
            const line = src[i];
            depth += (line.match(/\{/g) || []).length;
            depth -= (line.match(/\}/g) || []).length;
            if (i > startIdx && depth === 0) break;
            const decl = line.replace(/\/\/.*$/, "").trim();
            if (!decl.endsWith(";")) continue;
            const m = decl.slice(0, -1).trim().match(/^(.+?)\s+([A-Za-z_]\w*)$/);
            if (!m) continue;
            vars.push({
                name: m[2], type: m[1].trim(),
                critical: CRITICAL.test(m[2]),
                position: vars.length, sourceLine: i + 1
            });
        }
        return vars;
    }

    _getSponsorBankStorageVariables() {
        return [
            { name: "banks", type: "mapping(address => SponsorBank)", critical: true, position: 0 },
            { name: "distributions", type: "mapping(bytes32 => Distribution)", critical: true, position: 1 },
            { name: "bankDistributions", type: "mapping(address => bytes32[])", critical: false, position: 2 },
            { name: "kycBankRevenue", type: "mapping(address => uint256)", critical: false, position: 3 },
            { name: "sponsorBankRevenue", type: "mapping(address => uint256)", critical: false, position: 4 },
            { name: "totalBanks", type: "uint256", critical: false, position: 5 },
            { name: "totalDistributions", type: "uint256", critical: false, position: 6 },
            { name: "globalKYCFeeRate", type: "uint256", critical: false, position: 7 },
            { name: "emergencyPaused", type: "bool", critical: true, position: 8 },
            { name: "minDistributionAmount", type: "uint256", critical: false, position: 9 },
            { name: "maxBatchSize", type: "uint256", critical: false, position: 10 }
        ];
    }

    _getInvestmentStorageVariables() {
        return [
            { name: "vehicles", type: "mapping(bytes32 => InvestmentVehicle)", critical: true, position: 0 },
            { name: "yieldDistributions", type: "mapping(bytes32 => YieldDistribution)", critical: true, position: 1 },
            { name: "investorProfiles", type: "mapping(address => InvestorProfile)", critical: true, position: 2 },
            { name: "proposals", type: "mapping(uint256 => GovernanceProposal)", critical: true, position: 3 },
            { name: "vehicleTaxParams", type: "mapping(bytes32 => TaxParameters)", critical: false, position: 4 },
            { name: "investorYieldBalance", type: "mapping(address => mapping(bytes32 => uint256))", critical: true, position: 5 },
            { name: "requiresAccreditation", type: "mapping(InvestmentType => bool)", critical: false, position: 6 },
            { name: "vehicleInvestors", type: "mapping(bytes32 => address[])", critical: false, position: 7 },
            { name: "investorVehicles", type: "mapping(address => bytes32[])", critical: false, position: 8 },
            { name: "totalVehicles", type: "uint256", critical: false, position: 9 },
            { name: "totalYieldDistributions", type: "uint256", critical: false, position: 10 },
            { name: "nextProposalId", type: "uint256", critical: false, position: 11 },
            { name: "globalMinimumInvestment", type: "uint256", critical: false, position: 12 },
            { name: "globalMaximumInvestment", type: "uint256", critical: false, position: 13 },
            { name: "emergencyPaused", type: "bool", critical: true, position: 14 },
            { name: "defaultVotingPeriod", type: "uint256", critical: false, position: 15 },
            { name: "defaultQuorumPercentage", type: "uint256", critical: false, position: 16 },
            { name: "defaultApprovalThreshold", type: "uint256", critical: false, position: 17 },
            { name: "minimumProposalBalance", type: "uint256", critical: false, position: 18 }
        ];
    }
}

// Main execution
async function main() {
    try {
        const analyzer = new StorageLayoutAnalyzer();
        const results = await analyzer.analyzeStorageLayouts();
        
        // Exit with appropriate code based on risk level
        const riskScore = results.metrics.riskScore;
        if (riskScore > 80) {
            console.log("❌ HIGH RISK: Storage layout requires immediate attention");
            process.exit(1);
        } else if (riskScore > 60) {
            console.log("⚠️  MEDIUM RISK: Storage layout should be reviewed");
            process.exit(0);
        } else {
            console.log("✅ LOW RISK: Storage layout is acceptable");
            process.exit(0);
        }
        
    } catch (error) {
        console.error("💥 Analysis failed:", error);
        process.exit(1);
    }
}

// Export for use in other scripts
module.exports = { StorageLayoutAnalyzer };

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}
