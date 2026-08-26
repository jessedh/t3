const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Custom assertion helpers for T3 testing
 */

/**
 * Assert that a transaction reverts with specific error
 * @param {Promise} txPromise - Transaction promise
 * @param {string|Contract} errorName - Expected error name or contract for custom errors
 * @param {Array} errorArgs - Expected error arguments (optional)
 */
async function expectRevert(txPromise, errorName, errorArgs = []) {
    if (typeof errorName === 'object' && errorName.interface) {
        // If errorName is a contract, treat first arg as actual error name
        const [contract, actualErrorName] = [errorName, errorArgs[0]];
        const actualArgs = errorArgs.slice(1);
        
        if (actualArgs.length > 0) {
            await expect(txPromise).to.be.revertedWithCustomError(contract, actualErrorName).withArgs(...actualArgs);
        } else {
            await expect(txPromise).to.be.revertedWithCustomError(contract, actualErrorName);
        }
    } else if (errorArgs.length > 0) {
        await expect(txPromise).to.be.revertedWithCustomError(errorName, errorArgs);
    } else {
        // Try as revert reason string first
        try {
            await expect(txPromise).to.be.revertedWith(errorName);
        } catch (e) {
            // If that fails, the error might be a custom error name without contract
            throw e;
        }
    }
}

/**
 * Assert that a transaction reverts with unauthorized role error
 * @param {Promise} txPromise - Transaction promise
 * @param {string} account - Account address
 * @param {string} role - Role hash
 */
async function expectUnauthorizedRole(txPromise, account, role) {
    await expect(txPromise).to.be.revertedWithCustomError("UnauthorizedRole")
        .withArgs(account, role);
}

/**
 * Assert that a transaction reverts with insufficient balance error
 * @param {Promise} txPromise - Transaction promise
 * @param {string} account - Account address
 * @param {BigInt} balance - Current balance
 * @param {BigInt} needed - Needed amount
 */
async function expectInsufficientBalance(txPromise, account, balance, needed) {
    await expect(txPromise).to.be.revertedWithCustomError("ERC20InsufficientBalance")
        .withArgs(account, balance, needed);
}

/**
 * Assert that a transaction reverts with insufficient allowance error
 * @param {Promise} txPromise - Transaction promise
 * @param {string} spender - Spender address
 * @param {BigInt} allowance - Current allowance
 * @param {BigInt} needed - Needed amount
 */
async function expectInsufficientAllowance(txPromise, spender, allowance, needed) {
    await expect(txPromise).to.be.revertedWithCustomError("ERC20InsufficientAllowance")
        .withArgs(spender, allowance, needed);
}

/**
 * Assert that a transaction emits an event with specific args
 * @param {Promise} txPromise - Transaction promise
 * @param {Contract} contract - Contract instance
 * @param {string} eventName - Event name
 * @param {Array} eventArgs - Expected event arguments (optional)
 */
function expectEvent(txPromise, contract, eventName, eventArgs = []) {
    const assertion = expect(txPromise).to.emit(contract, eventName);
    
    // Return an object with withArgs method for chaining
    return {
        withArgs: (...args) => assertion.withArgs(...args),
        // Also support direct execution without args
        then: assertion.then?.bind(assertion),
        catch: assertion.catch?.bind(assertion)
    };
}

/**
 * Assert that a balance changes by expected amount
 * @param {Function} txFunction - Function that executes transaction
 * @param {Contract} token - Token contract
 * @param {string} account - Account address
 * @param {BigInt} expectedChange - Expected balance change
 */
async function expectBalanceChange(txFunction, token, account, expectedChange) {
    await expect(txFunction).to.changeTokenBalance(token, account, expectedChange);
}

/**
 * Assert that multiple balances change as expected
 * @param {Function} txFunction - Function that executes transaction
 * @param {Contract} token - Token contract
 * @param {Array} accounts - Array of account addresses
 * @param {Array} expectedChanges - Array of expected balance changes
 */
async function expectBalanceChanges(txFunction, token, accounts, expectedChanges) {
    await expect(txFunction).to.changeTokenBalances(token, accounts, expectedChanges);
}

/**
 * Assert that a role is granted/revoked correctly
 * @param {Contract} accessControl - AccessControl contract
 * @param {string} role - Role hash
 * @param {string} account - Account address
 * @param {boolean} shouldHave - Whether account should have role
 */
async function expectRole(accessControl, role, account, shouldHave = true) {
    const hasRole = await accessControl.hasRole(role, account);
    expect(hasRole).to.equal(shouldHave, 
        `Account ${account} ${shouldHave ? 'should have' : 'should not have'} role ${role}`);
}

/**
 * Assert that a transaction causes gas usage within expected range
 * @param {Promise} txPromise - Transaction promise
 * @param {number} maxGas - Maximum expected gas usage
 */
async function expectGasUsage(txPromise, maxGas) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    expect(receipt.gasUsed).to.be.lte(maxGas, 
        `Gas usage ${receipt.gasUsed} exceeded maximum ${maxGas}`);
}

/**
 * Assert that contract state matches expected values
 * @param {Contract} contract - Contract instance
 * @param {Object} expectedState - Object with method names and expected values
 */
async function expectContractState(contract, expectedState) {
    for (const [method, expectedValue] of Object.entries(expectedState)) {
        const actualValue = await contract[method]();
        expect(actualValue).to.equal(expectedValue, 
            `${method}() returned ${actualValue}, expected ${expectedValue}`);
    }
}

/**
 * Assert that two BigInt values are approximately equal
 * @param {BigInt} actual - Actual value
 * @param {BigInt} expected - Expected value
 * @param {BigInt} tolerance - Allowed difference
 * @param {string} message - Error message
 */
function expectApproximately(actual, expected, tolerance, message = "") {
    const diff = actual > expected ? actual - expected : expected - actual;
    expect(diff).to.be.lte(tolerance, 
        `${message}: expected ~${expected}, got ${actual}, diff ${diff}`);
}

/**
 * Assert that a timestamp is close to current time
 * @param {BigInt} timestamp - Timestamp to check
 * @param {number} toleranceSeconds - Allowed difference in seconds (default 60)
 */
async function expectTimestampClose(timestamp, toleranceSeconds = 60) {
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    const diff = timestamp > currentTime ? timestamp - currentTime : currentTime - timestamp;
    expect(diff).to.be.lte(BigInt(toleranceSeconds), 
        `Timestamp ${timestamp} is not close to current time ${currentTime}`);
}

/**
 * Assert that an array contains specific elements
 * @param {Array} array - Array to check
 * @param {Array} expectedElements - Elements that should be present
 */
function expectArrayContains(array, expectedElements) {
    for (const element of expectedElements) {
        expect(array).to.include(element, `Array should contain ${element}`);
    }
}

/**
 * Assert that an array has specific length
 * @param {Array} array - Array to check
 * @param {number} expectedLength - Expected length
 */
function expectArrayLength(array, expectedLength) {
    expect(array).to.have.lengthOf(expectedLength, 
        `Array length ${array.length} does not match expected ${expectedLength}`);
}

/**
 * Assert that a contract supports an interface
 * @param {Contract} contract - Contract with ERC165 support
 * @param {string} interfaceId - Interface ID to check
 */
async function expectSupportsInterface(contract, interfaceId) {
    const supports = await contract.supportsInterface(interfaceId);
    expect(supports).to.be.true;
}

/**
 * Assert that a pause state is correct
 * @param {Contract} pausable - Pausable contract
 * @param {boolean} shouldBePaused - Whether contract should be paused
 */
async function expectPauseState(pausable, shouldBePaused) {
    const isPaused = await pausable.paused();
    expect(isPaused).to.equal(shouldBePaused, 
        `Contract ${shouldBePaused ? 'should be' : 'should not be'} paused`);
}

module.exports = {
    expectRevert,
    expectUnauthorizedRole,
    expectInsufficientBalance,
    expectInsufficientAllowance,
    expectEvent,
    expectBalanceChange,
    expectBalanceChanges,
    expectRole,
    expectGasUsage,
    expectContractState,
    expectApproximately,
    expectTimestampClose,
    expectArrayContains,
    expectArrayLength,
    expectSupportsInterface,
    expectPauseState
};