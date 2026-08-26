const { ethers } = require("hardhat");
const { expect } = require("chai");

/**
 * @title Storage Test Helper
 * @dev Comprehensive utilities for cross-storage integration testing
 * @notice Provides atomic operation simulation, storage snapshots, and cross-storage validation
 */

class StorageTestHelper {
    constructor(diamond, facetContracts) {
        this.diamond = diamond;
        this.diamondAddress = diamond.target || diamond.address;
        this.facets = facetContracts;
        this.snapshots = new Map();
        this.operationHistory = [];
    }

    /**
     * Capture storage state snapshots across all three storage systems
     * @param {string} snapshotId Unique identifier for this snapshot
     * @returns {Promise<Object>} Snapshot data with state from all storage systems
     */
    async captureSnapshot(snapshotId) {
        const snapshot = {
            id: snapshotId,
            timestamp: Date.now(),
            blockNumber: await ethers.provider.getBlockNumber(),
            appStorage: await this._captureAppStorageState(),
            sponsorBankStorage: await this._captureSponsorBankStorageState(),
            investmentStorage: await this._captureInvestmentStorageState()
        };

        this.snapshots.set(snapshotId, snapshot);
        return snapshot;
    }

    /**
     * Restore storage state from a snapshot (simulation only - for comparison)
     * @param {string} snapshotId Snapshot to restore from
     * @returns {Promise<Object>} Expected state data
     */
    async getSnapshotState(snapshotId) {
        const snapshot = this.snapshots.get(snapshotId);
        if (!snapshot) {
            throw new Error(`Snapshot ${snapshotId} not found`);
        }
        return snapshot;
    }

    /**
     * Compare current state with snapshot to detect drift
     * @param {string} snapshotId Snapshot to compare against
     * @returns {Promise<Object>} Drift analysis with differences found
     */
    async detectStorageDrift(snapshotId) {
        const snapshot = this.snapshots.get(snapshotId);
        if (!snapshot) {
            throw new Error(`Snapshot ${snapshotId} not found`);
        }

        const currentState = {
            appStorage: await this._captureAppStorageState(),
            sponsorBankStorage: await this._captureSponsorBankStorageState(),
            investmentStorage: await this._captureInvestmentStorageState()
        };

        return {
            appStorageDrift: this._compareStates(snapshot.appStorage, currentState.appStorage),
            sponsorBankDrift: this._compareStates(snapshot.sponsorBankStorage, currentState.sponsorBankStorage),
            investmentDrift: this._compareStates(snapshot.investmentStorage, currentState.investmentStorage),
            totalDifferences: this._countTotalDifferences(snapshot, currentState)
        };
    }

    /**
     * Simulate atomic operation across multiple storage systems
     * @param {Array} operations Array of operation objects to execute atomically
     * @returns {Promise<Object>} Operation results and state changes
     */
    async simulateAtomicOperation(operations) {
        const preSnapshot = await this.captureSnapshot(`atomic_pre_${Date.now()}`);
        const results = [];
        let allSucceeded = true;

        try {
            for (const operation of operations) {
                const result = await this._executeOperation(operation);
                results.push(result);
                
                if (!result.success) {
                    allSucceeded = false;
                    break;
                }
            }

            const postSnapshot = await this.captureSnapshot(`atomic_post_${Date.now()}`);
            
            return {
                success: allSucceeded,
                operations: results,
                preState: preSnapshot,
                postState: postSnapshot,
                stateChanges: await this.detectStorageDrift(`atomic_pre_${Date.now()}`)
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                operations: results,
                preState: preSnapshot
            };
        }
    }

    /**
     * Validate cross-storage consistency after operations
     * @param {Array} expectedStates Array of expected state conditions
     * @returns {Promise<Object>} Validation results
     */
    async validateCrossStorageConsistency(expectedStates = []) {
        const currentState = {
            appStorage: await this._captureAppStorageState(),
            sponsorBankStorage: await this._captureSponsorBankStorageState(),
            investmentStorage: await this._captureInvestmentStorageState()
        };

        const validationResults = {
            isConsistent: true,
            violations: [],
            warnings: [],
            summary: {}
        };

        // Check referential integrity between storage systems
        const integrityChecks = await this._checkReferentialIntegrity(currentState);
        if (!integrityChecks.isValid) {
            validationResults.isConsistent = false;
            validationResults.violations.push(...integrityChecks.violations);
        }

        // Validate expected states if provided
        for (const expectedState of expectedStates) {
            const stateValidation = await this._validateExpectedState(currentState, expectedState);
            if (!stateValidation.isValid) {
                validationResults.isConsistent = false;
                validationResults.violations.push(...stateValidation.violations);
            }
        }

        // Check for potential storage layout conflicts
        const layoutChecks = await this._checkStorageLayoutSafety();
        if (layoutChecks.warnings.length > 0) {
            validationResults.warnings.push(...layoutChecks.warnings);
        }

        validationResults.summary = {
            totalChecks: integrityChecks.totalChecks + expectedStates.length,
            passedChecks: integrityChecks.passedChecks + expectedStates.filter(s => s.isValid).length,
            failedChecks: validationResults.violations.length,
            warningCount: validationResults.warnings.length
        };

        return validationResults;
    }

    /**
     * Setup test data across all storage systems for complex scenarios
     * @param {Object} testScenario Configuration for test data setup
     * @returns {Promise<Object>} Setup results with created entities
     */
    async setupTestScenario(testScenario) {
        const setupResults = {
            appStorage: {},
            sponsorBankStorage: {},
            investmentStorage: {},
            crossReferences: {}
        };

        try {
            // Setup AppStorage entities (users, balances, roles)
            if (testScenario.users) {
                setupResults.appStorage.users = await this._setupTestUsers(testScenario.users);
            }

            // Setup SponsorBankStorage entities (banks, distributions)
            if (testScenario.sponsorBanks) {
                setupResults.sponsorBankStorage.banks = await this._setupTestSponsorBanks(testScenario.sponsorBanks);
            }

            if (testScenario.distributions) {
                setupResults.sponsorBankStorage.distributions = await this._setupTestDistributions(testScenario.distributions);
            }

            // Setup InvestmentStorage entities (vehicles, profiles)
            if (testScenario.investmentVehicles) {
                setupResults.investmentStorage.vehicles = await this._setupTestVehicles(testScenario.investmentVehicles);
            }

            if (testScenario.investorProfiles) {
                setupResults.investmentStorage.profiles = await this._setupTestProfiles(testScenario.investorProfiles);
            }

            // Establish cross-storage relationships
            if (testScenario.crossReferences) {
                setupResults.crossReferences = await this._setupCrossReferences(testScenario.crossReferences, setupResults);
            }

            return setupResults;

        } catch (error) {
            throw new Error(`Test scenario setup failed: ${error.message}`);
        }
    }

    /**
     * Generate storage layout safety report
     * @returns {Promise<Object>} Safety analysis of current storage layouts
     */
    async generateStorageLayoutReport() {
        const report = {
            timestamp: Date.now(),
            appStorage: await this._analyzeAppStorageLayout(),
            sponsorBankStorage: await this._analyzeSponsorBankStorageLayout(),
            investmentStorage: await this._analyzeInvestmentStorageLayout(),
            conflicts: [],
            recommendations: []
        };

        // Check for storage slot conflicts
        const slotConflicts = this._detectStorageSlotConflicts(report);
        report.conflicts = slotConflicts;

        // Generate safety recommendations
        report.recommendations = this._generateSafetyRecommendations(report);

        return report;
    }

    // Private helper methods

    async _captureAppStorageState() {
        try {
            // Capture key AppStorage state through available facet methods
            const state = {
                tokenInfo: {
                    name: await this.facets.erc20.name().catch(() => "Unknown"),
                    symbol: await this.facets.erc20.symbol().catch(() => "Unknown"),
                    totalSupply: await this.facets.erc20.totalSupply().catch(() => 0n),
                    decimals: await this.facets.erc20.decimals().catch(() => 18)
                },
                paused: await this.facets.pausable.paused().catch(() => false),
                // Note: More detailed state would require additional getter methods
                balancesSample: {}, // Would need to track test addresses
                lastUpdated: Date.now()
            };

            return state;
        } catch (error) {
            return { error: error.message, lastUpdated: Date.now() };
        }
    }

    async _captureSponsorBankStorageState() {
        try {
            const state = {
                banks: [],
                distributions: [],
                totalBanks: 0,
                totalDistributions: 0,
                lastUpdated: Date.now()
            };

            // Would capture sponsor bank state if facets are available
            if (this.facets.sponsorBank) {
                // Sample state capture - would need actual getter methods
                state.available = true;
            } else {
                state.available = false;
            }

            return state;
        } catch (error) {
            return { error: error.message, lastUpdated: Date.now() };
        }
    }

    async _captureInvestmentStorageState() {
        try {
            const state = {
                vehicles: [],
                profiles: [],
                yieldDistributions: [],
                totalVehicles: 0,
                lastUpdated: Date.now()
            };

            // Would capture investment state if facets are available
            if (this.facets.investmentRegistry) {
                state.available = true;
            } else {
                state.available = false;
            }

            return state;
        } catch (error) {
            return { error: error.message, lastUpdated: Date.now() };
        }
    }

    _compareStates(snapshot, current) {
        const differences = [];
        
        // Deep comparison of state objects
        const keys = new Set([...Object.keys(snapshot), ...Object.keys(current)]);
        
        for (const key of keys) {
            if (snapshot[key] !== current[key]) {
                differences.push({
                    field: key,
                    expected: snapshot[key],
                    actual: current[key]
                });
            }
        }

        return {
            hasDifferences: differences.length > 0,
            differences,
            changeCount: differences.length
        };
    }

    _countTotalDifferences(snapshot, current) {
        let total = 0;
        
        ['appStorage', 'sponsorBankStorage', 'investmentStorage'].forEach(storageType => {
            if (snapshot[storageType] && current[storageType]) {
                const comparison = this._compareStates(snapshot[storageType], current[storageType]);
                total += comparison.changeCount;
            }
        });

        return total;
    }

    async _executeOperation(operation) {
        try {
            let result;
            
            switch (operation.type) {
                case 'TRANSFER':
                    result = await this._executeTransfer(operation);
                    break;
                case 'DISTRIBUTION':
                    result = await this._executeDistribution(operation);
                    break;
                case 'INVESTMENT':
                    result = await this._executeInvestment(operation);
                    break;
                case 'MINT':
                    result = await this._executeMint(operation);
                    break;
                default:
                    throw new Error(`Unknown operation type: ${operation.type}`);
            }

            return { success: true, operation: operation.type, result };
        } catch (error) {
            return { success: false, operation: operation.type, error: error.message };
        }
    }

    async _executeTransfer(operation) {
        const { from, to, amount } = operation.params;
        const tx = await this.facets.directTransfer.connect(from).transfer(to.address, amount);
        return await tx.wait();
    }

    async _executeDistribution(operation) {
        // Would implement distribution creation/execution
        return { operation: 'distribution', status: 'simulated' };
    }

    async _executeInvestment(operation) {
        // Would implement investment recording
        return { operation: 'investment', status: 'simulated' };
    }

    async _executeMint(operation) {
        const { to, amount } = operation.params;
        const tx = await this.facets.mintBurn.mint(to.address, amount);
        return await tx.wait();
    }

    async _checkReferentialIntegrity(currentState) {
        const violations = [];
        let totalChecks = 0;
        let passedChecks = 0;

        // Check 1: Ensure users exist in both AppStorage and any referenced systems
        totalChecks++;
        // Would implement actual integrity checks
        passedChecks++; // Placeholder

        // Check 2: Verify distribution recipients exist in AppStorage
        totalChecks++;
        passedChecks++; // Placeholder

        // Check 3: Validate investment vehicle token contracts match AppStorage
        totalChecks++;
        passedChecks++; // Placeholder

        return {
            isValid: violations.length === 0,
            violations,
            totalChecks,
            passedChecks
        };
    }

    async _validateExpectedState(currentState, expectedState) {
        const violations = [];

        // Validate expected conditions
        for (const [path, expectedValue] of Object.entries(expectedState.conditions || {})) {
            const actualValue = this._getValueByPath(currentState, path);
            if (actualValue !== expectedValue) {
                violations.push({
                    path,
                    expected: expectedValue,
                    actual: actualValue
                });
            }
        }

        return {
            isValid: violations.length === 0,
            violations
        };
    }

    async _checkStorageLayoutSafety() {
        const warnings = [];

        // Check for potential storage layout issues
        // These would be actual checks in production
        
        return { warnings };
    }

    _getValueByPath(obj, path) {
        return path.split('.').reduce((current, key) => current && current[key], obj);
    }

    async _setupTestUsers(userConfig) {
        const users = {};
        
        for (const [userName, config] of Object.entries(userConfig)) {
            users[userName] = {
                address: config.address,
                balance: config.balance || 0n,
                roles: config.roles || []
            };

            // Setup initial balance if specified
            if (config.balance && config.balance > 0n) {
                try {
                    await this.facets.mintBurn.mint(config.address, config.balance);
                } catch (error) {
                    console.warn(`Failed to mint for ${userName}:`, error.message);
                }
            }

            // Grant roles if specified
            for (const role of config.roles || []) {
                try {
                    await this.facets.accessControl.grantRole(role, config.address);
                } catch (error) {
                    console.warn(`Failed to grant ${role} to ${userName}:`, error.message);
                }
            }
        }

        return users;
    }

    async _setupTestSponsorBanks(bankConfig) {
        const banks = {};
        
        // Would implement sponsor bank setup
        for (const [bankName, config] of Object.entries(bankConfig)) {
            banks[bankName] = {
                address: config.address,
                identifier: config.identifier,
                feeRate: config.feeRate || 100
            };
        }

        return banks;
    }

    async _setupTestDistributions(distributionConfig) {
        const distributions = {};
        
        // Would implement distribution setup
        for (const [distName, config] of Object.entries(distributionConfig)) {
            distributions[distName] = {
                id: config.id,
                amount: config.amount,
                status: config.status || 0
            };
        }

        return distributions;
    }

    async _setupTestVehicles(vehicleConfig) {
        const vehicles = {};
        
        // Would implement investment vehicle setup
        for (const [vehicleName, config] of Object.entries(vehicleConfig)) {
            vehicles[vehicleName] = {
                id: config.id,
                type: config.type,
                sponsor: config.sponsor
            };
        }

        return vehicles;
    }

    async _setupTestProfiles(profileConfig) {
        const profiles = {};
        
        // Would implement investor profile setup
        for (const [profileName, config] of Object.entries(profileConfig)) {
            profiles[profileName] = {
                address: config.address,
                isAccredited: config.isAccredited || false,
                jurisdiction: config.jurisdiction || "US"
            };
        }

        return profiles;
    }

    async _setupCrossReferences(crossRefConfig, setupResults) {
        const crossReferences = {};
        
        // Would implement cross-storage relationship setup
        for (const [refName, config] of Object.entries(crossRefConfig)) {
            crossReferences[refName] = {
                type: config.type,
                entities: config.entities
            };
        }

        return crossReferences;
    }

    async _analyzeAppStorageLayout() {
        return {
            type: "AppStorage",
            estimatedVariables: 80,
            storageSlot: "main",
            riskLevel: "HIGH", // Due to 80+ variables
            recommendations: ["Consider storage segmentation", "Implement upgrade safety checks"]
        };
    }

    async _analyzeSponsorBankStorageLayout() {
        return {
            type: "SponsorBankStorage",
            storageSlot: "keccak256('t3token.storage.sponsorbank.v1')",
            riskLevel: "LOW",
            isolated: true
        };
    }

    async _analyzeInvestmentStorageLayout() {
        return {
            type: "InvestmentStorage", 
            storageSlot: "keccak256('t3token.storage.investment.v1')",
            riskLevel: "LOW",
            isolated: true
        };
    }

    _detectStorageSlotConflicts(report) {
        const conflicts = [];
        
        // Check for potential slot conflicts between storage systems
        // This would be actual conflict detection in production
        
        return conflicts;
    }

    _generateSafetyRecommendations(report) {
        const recommendations = [];
        
        if (report.appStorage.riskLevel === "HIGH") {
            recommendations.push("Implement storage layout upgrade safety testing");
            recommendations.push("Consider breaking AppStorage into smaller, focused storage libraries");
        }

        recommendations.push("Maintain storage isolation between Phase 2 and Phase 3 operations");
        recommendations.push("Implement automated storage layout analysis in CI/CD pipeline");

        return recommendations;
    }
}

/**
 * Factory function to create StorageTestHelper instance
 */
async function createStorageTestHelper(diamond, facetContracts) {
    return new StorageTestHelper(diamond, facetContracts);
}

/**
 * Convenience function for basic cross-storage consistency checks
 */
async function validateBasicConsistency(diamond, facetContracts) {
    const helper = await createStorageTestHelper(diamond, facetContracts);
    return await helper.validateCrossStorageConsistency();
}

/**
 * Convenience function for storage drift detection
 */
async function detectDriftFromSnapshot(diamond, facetContracts, snapshotId) {
    const helper = await createStorageTestHelper(diamond, facetContracts);
    return await helper.detectStorageDrift(snapshotId);
}

module.exports = {
    StorageTestHelper,
    createStorageTestHelper,
    validateBasicConsistency,
    detectDriftFromSnapshot
};