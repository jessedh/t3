const { ethers } = require("hardhat");

/**
 * Shared test constants
 */

// Common addresses
const ZERO_ADDRESS = ethers.ZeroAddress;
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

// Common amounts
const AMOUNTS = {
    ZERO: 0n,
    ONE_TOKEN: ethers.parseEther("1"),
    TEN_TOKENS: ethers.parseEther("10"),
    HUNDRED_TOKENS: ethers.parseEther("100"),
    FIVE_HUNDRED_TOKENS: ethers.parseEther("500"),
    THOUSAND_TOKENS: ethers.parseEther("1000"),
    ONE_WEI: 1n,
    ONE_GWEI: ethers.parseUnits("1", "gwei"),
    ONE_ETHER: ethers.parseEther("1")
};

// Test amounts for integration tests
const TEST_AMOUNTS = {
    DISTRIBUTION: ethers.parseEther("5000"),
    INVESTMENT: ethers.parseEther("500"),
    LARGE: ethers.parseEther("100000")
};

// Time constants (in seconds)
const TIME = {
    ONE_MINUTE: 60,
    ONE_HOUR: 60 * 60,
    ONE_DAY: 24 * 60 * 60,
    ONE_WEEK: 7 * 24 * 60 * 60,
    ONE_MONTH: 30 * 24 * 60 * 60,
    ONE_YEAR: 365 * 24 * 60 * 60
};

// Fee constants
const FEE_PRECISION_MULTIPLIER = 1000;
const BASIS_POINTS = {
    ONE_PERCENT: 100,
    FIVE_PERCENT: 500,
    TEN_PERCENT: 1000,
    FIFTY_PERCENT: 5000,
    HUNDRED_PERCENT: 10000
};

// Default initialization parameters for testing
const DEFAULT_INIT_PARAMS = {
    tokenName: "T3Token",
    tokenSymbol: "T3T",
    halfLifeDuration: BigInt(TIME.ONE_DAY),
    minHalfLifeDuration: BigInt(TIME.ONE_HOUR),
    maxHalfLifeDuration: BigInt(TIME.ONE_WEEK),
    inactivityResetPeriod: BigInt(TIME.ONE_MONTH),
    minFee: ethers.parseEther("0.001"),
    baseRiskScalerBps: 100,
    maxRiskScalerBps: 1000,
    feeTierThresholds: [
        ethers.parseEther("1"),
        ethers.parseEther("10"),
        ethers.parseEther("100")
    ],
    feeTierRates: [50, 25, 10]
};

// Diamond Cut Actions
const FACET_CUT_ACTION = {
    ADD: 0,
    REPLACE: 1,
    REMOVE: 2
};

// Investment types for Phase 3
const INVESTMENT_TYPES = {
    REAL_ESTATE: 0,
    COMMODITIES: 1,
    EQUITIES: 2,
    BONDS: 3,
    MIXED: 4
};

// Vehicle status for Phase 3
const VEHICLE_STATUS = {
    PENDING: 0,
    ACTIVE: 1,
    PAUSED: 2,
    CLOSED: 3
};

// Distribution status for Phase 2
const DISTRIBUTION_STATUS = {
    INITIATED: 0,
    REGISTERED: 1,
    COMPLETED: 2,
    CANCELLED: 3
};

// Proposal status for Phase 3
const PROPOSAL_STATUS = {
    PENDING: 0,
    ACTIVE: 1,
    PASSED: 2,
    REJECTED: 3,
    EXECUTED: 4,
    CANCELLED: 5
};

// Error messages for testing
const ERROR_MESSAGES = {
    UNAUTHORIZED: "UnauthorizedRole",
    INSUFFICIENT_BALANCE: "ERC20InsufficientBalance",
    INSUFFICIENT_ALLOWANCE: "ERC20InsufficientAllowance",
    INVALID_SENDER: "ERC20InvalidSender",
    INVALID_RECEIVER: "ERC20InvalidReceiver",
    ZERO_ADDRESS: "ERC20InvalidApprover",
    PAUSED: "EnforcedPause",
    NOT_PAUSED: "ExpectedPause",
    REENTRANCY: "ReentrancyGuardReentrantCall"
};

// Gas limits for different operations
const GAS_LIMITS = {
    SIMPLE_TRANSFER: 100000,
    COMPLEX_TRANSFER: 200000,
    MINT: 150000,
    BURN: 100000,
    ROLE_GRANT: 80000,
    DIAMOND_CUT: 500000,
    DISTRIBUTION: 300000,
    INVESTMENT: 250000
};

// Test data generators
const GENERATORS = {
    /**
     * Generate a random address
     */
    randomAddress: () => ethers.Wallet.createRandom().address,

    /**
     * Generate a random bytes32
     */
    randomBytes32: () => ethers.randomBytes(32),

    /**
     * Generate a random amount between min and max
     */
    randomAmount: (min = 1, max = 1000) => {
        const random = Math.floor(Math.random() * (max - min + 1)) + min;
        return ethers.parseEther(random.toString());
    },

    /**
     * Generate test vehicle ID
     */
    vehicleId: (suffix = "") => ethers.keccak256(ethers.toUtf8Bytes(`vehicle_${suffix}_${Date.now()}`)),

    /**
     * Generate test distribution ID
     */
    distributionId: (suffix = "") => ethers.keccak256(ethers.toUtf8Bytes(`distribution_${suffix}_${Date.now()}`))
};

// Common test assertions
const ASSERTIONS = {
    /**
     * Assert that two BigInt values are equal
     */
    bigIntEqual: (actual, expected, message = "") => {
        if (actual !== expected) {
            throw new Error(`${message}: expected ${expected}, got ${actual}`);
        }
    },

    /**
     * Assert that a value is approximately equal (within tolerance)
     */
    approximately: (actual, expected, tolerance = ethers.parseEther("0.001"), message = "") => {
        const diff = actual > expected ? actual - expected : expected - actual;
        if (diff > tolerance) {
            throw new Error(`${message}: expected ~${expected}, got ${actual}, diff ${diff}`);
        }
    }
};

const CONSTANTS = {
    ZERO_ADDRESS,
    DEAD_ADDRESS,
    AMOUNTS,
    TEST_AMOUNTS,
    TIME,
    FEE_PRECISION_MULTIPLIER,
    BASIS_POINTS,
    DEFAULT_INIT_PARAMS,
    FACET_CUT_ACTION,
    INVESTMENT_TYPES,
    VEHICLE_STATUS,
    DISTRIBUTION_STATUS,
    PROPOSAL_STATUS,
    ERROR_MESSAGES,
    GAS_LIMITS,
    GENERATORS,
    ASSERTIONS
};

module.exports = {
    CONSTANTS,
    AMOUNTS,
    TEST_AMOUNTS,
    TIME,
    FEE_PRECISION_MULTIPLIER,
    BASIS_POINTS,
    DEFAULT_INIT_PARAMS,
    FACET_CUT_ACTION,
    INVESTMENT_TYPES,
    VEHICLE_STATUS,
    DISTRIBUTION_STATUS,
    PROPOSAL_STATUS,
    ERROR_MESSAGES,
    GAS_LIMITS,
    GENERATORS,
    ASSERTIONS,
    ZERO_ADDRESS,
    DEAD_ADDRESS
};