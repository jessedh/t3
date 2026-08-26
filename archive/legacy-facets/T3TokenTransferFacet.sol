// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import { StorageLib } from "../lib/StorageLib.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol"; //
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol"; //
// import { T3TokenReversalExpiryFacet } from "./T3TokenReversalExpiryFacet.sol"; //
import { T3TokenPrefundedFeesFacet } from "./T3TokenPrefundedFeesFacet.sol"; //
// Removed: import { T3TokenCommonLogicFacet } from "./T3TokenCommonLogicFacet.sol";
import { RoleConstants } from "../lib/RoleConstants.sol"; //
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol"; //
import { T3FeeLib } from "../lib/T3FeeLib.sol"; // Import the fee calculation library
import { T3CommonLib } from "../lib/T3CommonLib.sol"; // Import the common utility library
import { SponsorBankStorage } from "../lib/SponsorBankStorage.sol";

contract T3TokenTransferFacet is ReentrancyGuardBase { 
    // NOTE: Pausable functionality (pause/paused/unpause) is handled by ERC20PausableFacet to avoid selector collisions
    using StorageLib for StorageLib.AppStorage; //
    using EnumerableSet for EnumerableSet.AddressSet; //
    using SponsorBankStorage for SponsorBankStorage.Storage;
    
    /**
     * @notice Extracts the original sender from meta-transaction or returns msg.sender
     * @dev This is the core ERC-2771 functionality. When called via trusted forwarder,
     * the original sender is extracted from the last 20 bytes of calldata.
     * @return sender The original transaction sender
     */
    function _msgSender() internal view returns (address sender) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (ds.trustedForwarder != address(0) && msg.sender == ds.trustedForwarder && msg.data.length >= 20) {
            // Extract sender from the last 20 bytes of calldata (ERC-2771 standard)
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    // Internal modifier to check if paused (same logic as ERC20PausableFacet)
    modifier whenNotPaused() {
        if (StorageLib.diamondStorage()._paused) {
            revert("Pausable: paused");
        }
        _;
    }
    
    // Internal function to check role (same logic as ERC20PausableFacet)
    function _checkRole(bytes32 role, address account) internal view virtual {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[role].contains(account)) {
            revert StorageLib.UnauthorizedRole(account, role);
        }
    }

    // --- Core Internal Helper Functions ---

    function _internal_spendAllowance(StorageLib.AppStorage storage ds, address owner, address spender, uint256 amount) internal {
        // Logic for spending allowance remains as it's part of ERC20 mechanics, not T3 fee calculation itself.
        uint256 currentAllowance = ds._allowances[owner][spender]; //
        if (currentAllowance != type(uint256).max) {
            if (currentAllowance < amount) {
                revert StorageLib.ERC20InsufficientBalance(spender, currentAllowance, amount); //
            }
            unchecked {
                ds._allowances[owner][spender] = currentAllowance - amount; //
            }
            emit ERC20BaseFacet.Approval(owner, spender, ds._allowances[owner][spender]); //
        }
    }

    function _internal_transfer(StorageLib.AppStorage storage ds, address sender, address recipient, uint256 amount) internal {
        // Use consolidated transfer logic from T3CommonLib
        T3CommonLib.internalTransfer(ds, sender, recipient, amount);
        // Emit event from this facet context
        emit ERC20BaseFacet.Transfer(sender, recipient, amount);
    }

    // Removed: _ensureProfileExistsForWrite - now using T3CommonLib.ensureProfileExistsForWrite
    
    /**
     * @notice Processes the collected fee by distributing incentive credits.
     * @dev Currently, 25% of the fee goes to the sender and 25% to the recipient as credits.
     * The remaining 50% implicitly goes to the treasury.
     * @param ds The application's shared storage.
     * @param sender The sender of the original transaction.
     * @param recipient The recipient of the original transaction.
     * @param totalFeeCollected The total fee amount that was collected for the transaction.
     */
    function _processFee(StorageLib.AppStorage storage ds, address sender, address recipient, uint256 totalFeeCollected) internal {
        // Use consolidated fee processing logic from T3CommonLib
        T3CommonLib.processFee(ds, sender, recipient, totalFeeCollected);
    }
    
    /**
     * @notice Attempts to use a user's prefunded fee balance to cover a part of the fee.
     * @dev This function mutates the prefundedFeeBalances in storage.
     * @param ds The application's shared storage.
     * @param user The user whose prefunded balance is to be used.
     * @param amountToUse The amount of fee to try and cover from prefunded balance.
     * @return success True if some prefunded amount could be used, false otherwise.
     * @return actuallyUsed The amount actually debited from the prefunded balance.
     */
    function _usePrefundedFees(StorageLib.AppStorage storage ds, address user, uint256 amountToUse)
        internal returns (bool success, uint256 actuallyUsed)
    {
        // Use consolidated prefunded fee logic from T3CommonLib
        return T3CommonLib.usePrefundedFees(ds, user, amountToUse);
    }
    
    /**
     * @notice Applies a user's incentive credits to cover a part of the fee.
     * @dev This function mutates the incentiveCredits in storage.
     * @param ds The application's shared storage.
     * @param wallet The user whose credits are to be applied.
     * @param feeToCover The amount of fee to try and cover with credits.
     * @return remainingFeeAfterCredits The fee amount still remaining after applying credits.
     * @return creditsActuallyUsed The amount of credits actually used.
     */
    function _applyCredits(StorageLib.AppStorage storage ds, address wallet, uint256 feeToCover)
        internal returns (uint256 remainingFeeAfterCredits, uint256 creditsActuallyUsed) {
        // Use consolidated credit application logic from T3CommonLib
        return T3CommonLib.applyCredits(ds, wallet, feeToCover);
    }
    
    /**
     * @notice Updates the sender's rolling average transaction amount.
     * @dev Resets if the inactivity period has passed since the last update.
     * @param ds The application's shared storage.
     * @param wallet The sender's address.
     * @param amount The amount of the current transaction.
     */
    function _updateRollingAverage(StorageLib.AppStorage storage ds, address wallet, uint256 amount) internal {
        // Use consolidated rolling average logic from T3CommonLib
        T3CommonLib.updateRollingAverage(ds, wallet, amount);
    }
    
    /**
     * @notice Calculates an adaptive half-life duration for a transaction.
     * @dev The duration can be reduced based on transaction history between parties
     * and increased for unusually large transactions compared to sender's average.
     * Result is bounded by min/max half-life durations.
     * @param ds The application's shared storage.
     * @param sender The sender's address.
     * @param recipient The recipient's address.
     * @param amount The transaction amount.
     * @return The calculated adaptive half-life duration in seconds.
     */
    function _calculateAdaptiveHalfLife(
        StorageLib.AppStorage storage ds, 
        address sender, 
        address recipient, 
        uint256 amount,
        uint256 userMinLock
    )
        internal view returns (uint256) {
        
        uint256 usdValue = 0;
        if (ds.secureSettle.oracleManager != address(0)) {
            try IOracleManager(ds.secureSettle.oracleManager).getUsdValue(address(this), amount) returns (uint256 value) {
                usdValue = value;
            } catch {
                // If oracle fails, assume 1:1 parity for KYC half-life calculation
                usdValue = amount;
            }
        } else {
            // If oracle is not configured, assume 1:1 parity
            usdValue = amount;
        }

        // Use enhanced half-life calculation that includes KYC minimum requirements and user override
        return T3CommonLib.calculateEnhancedHalfLife(ds, sender, recipient, amount, usdValue, userMinLock);
    }

    // --- End of Internal Helper Functions (Wrappers or Copied Logic) ---

    event TransferWithFee(
        address indexed from,
        address indexed to,
        uint256 amountSentToRecipient,
        uint256 totalFeeAssessed, // Fee after bounds, before payment methods
        uint256 feePaidFromBalance,
        uint256 feePaidFromPrefund,
        uint256 feePaidFromCredits
    ); //

    function transfer(address recipient, uint256 amountIntendedForRecipient)
        external
        nonReentrant
        whenNotPaused
        returns (bool)
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _t3Transfer(ds, _msgSender(), recipient, amountIntendedForRecipient, 0); // Default: no user override
        return true;
    }

    function transferWithLock(address recipient, uint256 amountIntendedForRecipient, uint256 minLockDuration)
        external
        nonReentrant
        whenNotPaused
        returns (bool)
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _t3Transfer(ds, _msgSender(), recipient, amountIntendedForRecipient, minLockDuration);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amountIntendedForRecipient)
        external
        nonReentrant
        whenNotPaused
        returns (bool)
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        _internal_spendAllowance(ds, sender, _msgSender(), amountIntendedForRecipient);
        _t3Transfer(ds, sender, recipient, amountIntendedForRecipient, 0);
        return true;
    }

    /**
     * @notice Internal core logic for executing a T3 transfer.
     * @dev Calculates fees using T3FeeLib, handles fee payment from various sources,
     * performs the token transfer, processes fee distributions, and updates metadata.
     * @param ds The application's shared storage.
     * @param sender The sender's address.
     * @param recipient The recipient's address.
     * @param amountIntendedForRecipient The amount the recipient should receive.
     * @param userMinLock Optional minimum lock duration requested by user.
     */
    function _t3Transfer(
        StorageLib.AppStorage storage ds,
        address sender,
        address recipient,
        uint256 amountIntendedForRecipient,
        uint256 userMinLock
    ) internal {
        // --- Pre-Transfer Validations ---
        if (recipient == address(0)) { revert StorageLib.TransferToZeroAddress(); } //
        if (amountIntendedForRecipient == 0) { revert StorageLib.TransferAmountZero(); } //

        // Ensure sender and recipient profiles exist for writing subsequent metadata.
        T3CommonLib.ensureProfileExistsForWrite(ds, sender);
        T3CommonLib.ensureProfileExistsForWrite(ds, recipient);

        // --- Rules Engine Pre-Check (observation/enforcement)
        // Call into RulesEngineFacet via the diamond to obtain score/action
        // Encode sponsorship flag for rule engine: 0x01 if relayed via trusted forwarder
        bool isSponsored = (ds.trustedForwarder != address(0) && msg.sender == ds.trustedForwarder);
        bytes memory rulesData = new bytes(1);
        rulesData[0] = isSponsored ? bytes1(0x01) : bytes1(0x00);

        uint8 rulesAction = 0; // default ALLOW
        try IRulesEngineFacet(address(this)).beforeTransferCheck(
            sender,
            recipient,
            amountIntendedForRecipient,
            rulesData /*data*/, new bytes32[](0) /*allowProof*/, new bytes32[](0) /*denyProof*/
        ) returns (uint16 score, uint8 action) {
            // Enforce only when engine returns DENY (engine respects observationMode internally)
            rulesAction = action;
            if (rulesAction == uint8(IRulesEngineFacet.Action.DENY)) {
                revert("Rules: denied by policy");
            }
            // On WARN or ALLOW, continue. Score is emitted by engine event.
        } catch {
            // M-2: If failClosed is enabled, revert on rules engine failure.
            // Otherwise, continue (fail-open legacy behavior).
            if (RulesStorageLib.rulesStorage().failClosed) {
                revert("Rules: engine failure (fail-closed)");
            }
            // If fail-open, continue; incidents will be logged off-chain.
        }
        
        // --- Enhanced Integration: SecureSettle Check ---
        // Check if this transfer requires SecureSettle approval due to amount threshold
        if (ds.secureSettle.secureSettleActive && _requiresSecureSettlement(ds, amountIntendedForRecipient)) {
            revert("Transfer requires SecureSettle approval");
        }
        
        
        // --- Ledger-Based Locking Check ---
        // Clean up sender's outgoing list for hygiene
        _cleanupOutgoingTransfers(ds, sender);

        // Calculate available balance by subtracting active locks from total balance.
        // This also performs lazy cleanup of expired locks.
        uint256 lockedAmount = _calculateLockedAmountAndCleanup(ds, sender);
        uint256 senderBalance = ds._balances[sender];
        if (senderBalance < lockedAmount + amountIntendedForRecipient) {
             revert("Insufficient free balance (funds locked by HalfLife)");
        }

        // --- Fee Calculation via Library ---
        // Get the full fee breakdown from the centralized library.
        // `feeDetails.totalFeeAssessed` is the fee after bounds but BEFORE any payment methods (credits/prefund) are considered from sender's perspective.
        // `feeDetails.feeAfterCredits` is this fee if only credits were hypothetically applied (for estimation).
        StorageLib.FeeDetails memory feeDetails = T3FeeLib.getFullFeeDetails(
            ds, sender, recipient, amountIntendedForRecipient
        );
        // The fee that needs to be covered by the sender through various means (prefund, credits, balance).
        uint256 actualFeeToCover = feeDetails.totalFeeAssessed; // refers to the original calculation now done by T3FeeLib

        // Apply small surcharge on WARN (observation: effect tied to engine settings)
        if (rulesAction == uint8(IRulesEngineFacet.Action.WARN)) {
            // Pull perRuleSurcharge from rules fee schedule
            // Safe read: zero if not configured
            (, uint256 perRuleSurcharge, ) = _getRulesFees();
            if (perRuleSurcharge > 0) {
                actualFeeToCover += perRuleSurcharge;
            }
        }

        // --- Fee Payment Handling ---
        // Determine how the `actualFeeToCover` will be paid (prefunded, credits, main balance).
        // This function will mutate prefunded balances and credit balances.
        (
            uint256 feeEffectivelyPaidFromPrefund,
            uint256 feeEffectivelyPaidFromCredits,
            uint256 feeToPayFromMainBalance
        ) = _handleFeePayment(ds, sender, actualFeeToCover); //

        // --- Perform Token Transfers ---
        // 1. Transfer the principal amount from sender to recipient.
        _internal_transfer(ds, sender, recipient, amountIntendedForRecipient); 
        
        // 2. If there's a fee portion to be paid from the sender's main balance, transfer it to treasury.
        if (feeToPayFromMainBalance > 0) {
             _internal_transfer(ds, sender, ds.treasuryAddress, feeToPayFromMainBalance); //
        }
        // Fees paid from prefund are already in the treasury. Fees paid by credits don't involve a new transfer.

        // --- Enhanced Integration: Fee Processing with Escrow ---
        // If any fee was assessed and covered, process incentive credit distribution with KYC-based escrow
        if (actualFeeToCover > 0) {
            _processEnhancedFee(ds, sender, recipient, amountIntendedForRecipient, actualFeeToCover);
        }

        // --- Update Transaction Metadata ---
        // Record details about this transfer for half-life, rolling averages, etc.
        _updatePostTransferMetadata(ds, sender, recipient, amountIntendedForRecipient, actualFeeToCover, userMinLock); //

        // Post-transfer rules accounting
        try IRulesEngineFacet(address(this)).postTransferUpdate(sender, recipient, amountIntendedForRecipient) { } catch {}

        // Extend commit window on WARN if configured
        if (rulesAction == uint8(IRulesEngineFacet.Action.WARN)) {
            (bool extendOnWarn, uint48 extendSeconds) = _getWarnExtension();
            if (extendOnWarn && extendSeconds > 0) {
                // Note: Extension logic for Ledger-Based Locking would require finding the specific lock.
                // For now, we skip this advanced feature to keep the refactor clean, or we can implement it later.
                // _extendLatestLock(ds, sender, extendSeconds); 
            }
        }
        
        // --- Emit Event ---
        emit TransferWithFee(
            sender,
            recipient,
            amountIntendedForRecipient,
            actualFeeToCover, // Total fee that was covered
            feeToPayFromMainBalance,
            feeEffectivelyPaidFromPrefund,
            feeEffectivelyPaidFromCredits
        ); //
    }

    /**
     * @notice Manages the payment of the transaction fee from different sources in order:
     * 1. Sender's prefunded fee balance.
     * 2. Sender's incentive credits.
     * 3. Sender's main token balance.
     * @dev This function mutates storage for prefunded balances and incentive credits.
     * @param ds The application's shared storage.
     * @param sender The address of the fee payer.
     * @param totalFeeToPay The total fee amount that needs to be covered.
     * @return feePaidFromPrefund_ Amount of fee covered by prefunded balance.
     * @return feePaidFromCredits_ Amount of fee covered by incentive credits.
     * @return feePaidFromMainBalance_ Amount of fee to be covered from the main token balance.
     */
    function _handleFeePayment(
        StorageLib.AppStorage storage ds,
        address sender,
        uint256 totalFeeToPay
    ) internal returns (uint256 feePaidFromPrefund_, uint256 feePaidFromCredits_, uint256 feePaidFromMainBalance_) {
        uint256 remainingFee = totalFeeToPay; //

        // 1. Try to use prefunded fees.
        if (remainingFee > 0 && ds.prefundedFeeBalances[sender] > 0) {
            // _usePrefundedFees mutates ds.prefundedFeeBalances[sender].
            (bool success, uint256 usedFromPrefund) = _usePrefundedFees(ds, sender, remainingFee); //
            if (success) {
                feePaidFromPrefund_ = usedFromPrefund; //
                remainingFee -= usedFromPrefund;
                if (usedFromPrefund > 0) { 
                    // Emit event that prefunded fee was used (from T3TokenPrefundedFeesFacet context)
                    emit T3TokenPrefundedFeesFacet.PrefundedFeeUsed(sender, usedFromPrefund); //
                }
            }
        }

        // 2. Try to use incentive credits for any remaining fee.
        if (remainingFee > 0) {
            // _applyCredits mutates ds.incentiveCredits[sender].
            (uint256 feeAfterCredits, uint256 creditsUsed) = _applyCredits(ds, sender, remainingFee); //
            feePaidFromCredits_ = creditsUsed;
            remainingFee = feeAfterCredits;
            // Placeholder: emit IncentiveCreditUsed(sender, creditsUsed); //
        }

        // 3. The rest must be paid from the main balance.
        feePaidFromMainBalance_ = remainingFee; //
    }

    /**
     * @notice Updates various metadata fields in storage after a successful transfer.
     * @dev This includes transaction counts, sender's rolling average, and recipient's
     * transfer data for half-life mechanism.
     * @param ds The application's shared storage.
     * @param sender The sender of the transaction.
     * @param recipient The recipient of the transaction.
     * @param amountIntendedForRecipient The amount transferred to the recipient.
     * @param finalTotalFeeAssessed The total fee that was assessed and covered for the transaction.
     */
    function _updatePostTransferMetadata(
        StorageLib.AppStorage storage ds,
        address sender,
        address recipient,
        uint256 amountIntendedForRecipient,
        uint256 finalTotalFeeAssessed,
        uint256 userMinLock
    ) internal {
        // Increment transaction count between sender and recipient.
        ds.transactionCountBetween[sender][recipient]++; //
        // Update sender's rolling average transaction amount.
        _updateRollingAverage(ds, sender, amountIntendedForRecipient); 
        
        // Calculate adaptive half-life for this specific transfer.
        uint256 adaptiveHalfLife = _calculateAdaptiveHalfLife(
            ds, sender, recipient, amountIntendedForRecipient, userMinLock
        ); //
        
        // Ensure recipient's profile exists before writing transfer data.
        T3CommonLib.ensureProfileExistsForWrite(ds, recipient);

        // --- Ledger-Based Locking Implementation ---
        // Create a new PendingTransfer record
        bytes32 transferId = keccak256(abi.encodePacked(
            sender, 
            recipient, 
            amountIntendedForRecipient, 
            block.timestamp, 
            block.chainid,
            ds.pendingTransferIds[recipient].length // Nonce to ensure uniqueness
        ));

        StorageLib.PendingTransfer memory newTransfer = StorageLib.PendingTransfer({
            id: transferId,
            originator: sender,
            recipient: recipient,
            amount: amountIntendedForRecipient,
            originalAmount: amountIntendedForRecipient,  // NEW: Store original amount
            totalReversed: 0,                             // NEW: No reversals yet
            reversalCount: 0,                             // NEW: No reversals yet
            firstReversalTime: 0,                         // NEW: No reversals yet
            lastReversalTime: 0,                          // NEW: No reversals yet
            unlockTime: block.timestamp + adaptiveHalfLife,
            isReversed: false,
            reversalHash: keccak256(abi.encodePacked(sender, recipient, amountIntendedForRecipient, block.timestamp, block.chainid))
        });

        ds.pendingTransfers[transferId] = newTransfer;
        ds.pendingTransferIds[recipient].push(transferId);
        ds.outgoingPendingTransferIds[sender].push(transferId); // Track for sender visibility
        
        // Update sender's transaction history for compliance monitoring
        ds.transactionHistory[sender].push(StorageLib.TransactionRecord({
            recipient: recipient,
            amount: amountIntendedForRecipient,
            timestamp: block.timestamp,
            transactionType: "TRANSFER"
        }));
        
        // Update recipient's transaction history for compliance monitoring
        ds.transactionHistory[recipient].push(StorageLib.TransactionRecord({
            recipient: sender,
            amount: amountIntendedForRecipient,
            timestamp: block.timestamp,
            transactionType: "RECEIVE"
        }));
        
        // Update last transaction time for risk profiling
        ds.walletRiskProfiles[sender].lastTransactionTime = block.timestamp;
        ds.walletRiskProfiles[recipient].lastTransactionTime = block.timestamp;
        
        // Legacy support: Update old transferData for backward compatibility if needed, 
        // or just leave it. For now, we rely on the new system.
    }

    /**
     * @notice cleans up expired/completed outgoing transfers for the sender.
     * @dev Removes IDs from outgoingPendingTransferIds if the underlying transfer is finished/expired.
     * Does NOT delete the struct (process owned by recipient/locking logic).
     */
    function _cleanupOutgoingTransfers(StorageLib.AppStorage storage ds, address user) internal {
        bytes32[] storage ids = ds.outgoingPendingTransferIds[user];
        uint256 length = ids.length;
        
        // Iterate backwards to allow safe removal
        for (uint256 i = length; i > 0; i--) {
            uint256 index = i - 1;
            bytes32 id = ids[index];
            StorageLib.PendingTransfer storage pt = ds.pendingTransfers[id];
            
            // Clean up if:
            // 1. Struct was deleted (amount == 0)
            // 2. Already reversed
            // 3. Expired
            if (pt.amount == 0 && pt.unlockTime == 0) {
                _removeOutgoingTransferId(ds, user, index);
            } else if (pt.isReversed) {
                _removeOutgoingTransferId(ds, user, index);
            } else if (block.timestamp >= pt.unlockTime) {
                _removeOutgoingTransferId(ds, user, index);
            }
        }
    }

    function _removeOutgoingTransferId(StorageLib.AppStorage storage ds, address user, uint256 index) internal {
        bytes32[] storage ids = ds.outgoingPendingTransferIds[user];
        if (index >= ids.length) return;
        ids[index] = ids[ids.length - 1];
        ids.pop();
    }

    /**
     * @notice Calculates the total locked amount for a user and cleans up expired locks.
     * @dev Iterates through the user's pending transfers.
     * @param ds The application's shared storage.
     * @param user The user to check.
     * @return totalLocked The total amount currently locked.
     */
    function _calculateLockedAmountAndCleanup(
        StorageLib.AppStorage storage ds, 
        address user
    ) internal returns (uint256 totalLocked) {
        bytes32[] storage ids = ds.pendingTransferIds[user];
        uint256 length = ids.length;
        totalLocked = 0;

        // Iterate backwards to allow safe deletion (swap-pop)
        for (uint256 i = length; i > 0; i--) {
            uint256 index = i - 1;
            bytes32 id = ids[index];
            StorageLib.PendingTransfer storage pt = ds.pendingTransfers[id];

            if (pt.amount == 0 && pt.unlockTime == 0) {
                 // Struct was deleted (likely by the other party or cleanup), remove ID
                 T3CommonLib.removePendingTransfer(ds, user, index);
            } else if (pt.isReversed) {
                // Already reversed, just remove from list
                T3CommonLib.removePendingTransfer(ds, user, index);
            } else if (block.timestamp >= pt.unlockTime) {
                // Expired, remove from list
                T3CommonLib.removePendingTransfer(ds, user, index);
            } else {
                // Active lock
                totalLocked += pt.amount;
            }
        }
    }

    // --- Enhanced Integration Helper Functions ---

    /**
     * @notice Enhanced fee processing with KYC-based escrow routing
     * @dev Attempts to use enhanced fee facet if available, falls back to standard processing
     */
    function _processEnhancedFee(
        StorageLib.AppStorage storage ds,
        address sender,
        address recipient,
        uint256 amount,
        uint256 totalFeeCollected
    ) internal {
        // Check if enhanced fee processing should be used
        if (ds.kycCacheDuration > 0) {
            // Refresh KYC cache for better accuracy
            T3CommonLib.refreshKycCache(ds, sender);
            T3CommonLib.refreshKycCache(ds, recipient);
            
            // Use KYC-aware fee processing
            _processFeeWithKycEscrow(ds, sender, recipient, totalFeeCollected);
        } else {
            // Fallback to standard fee processing
            _processFee(ds, sender, recipient, totalFeeCollected);
        }
    }
    
    /**
     * @notice Process fees with KYC-based escrow routing
     */
    function _processFeeWithKycEscrow(
        StorageLib.AppStorage storage ds,
        address sender,
        address recipient,
        uint256 totalFeeCollected
    ) internal {
        if (totalFeeCollected == 0) return;

        // Check KYC status using cache
        bool senderKyc = T3CommonLib.getKycStatusCached(ds, sender);
        bool recipientKyc = T3CommonLib.getKycStatusCached(ds, recipient);

        // Calculate reward shares (25% each to sender and recipient)
        uint256 senderReward = totalFeeCollected / 4;
        uint256 recipientReward = totalFeeCollected / 4;

        // Process sender reward based on KYC status
        if (senderKyc) {
            // KYC'd sender gets immediate reward credits (use struct for consistency with applyCredits)
            T3CommonLib.ensureProfileExistsForWrite(ds, sender);
            ds.incentiveCredits[sender].amount += senderReward;
            ds.incentiveCredits[sender].lastUpdated = block.timestamp;
        } else {
            // Non-KYC'd sender reward goes to escrow
            _addRewardToEscrow(ds, sender, senderReward);
        }

        // Process recipient reward based on KYC status
        if (recipientKyc) {
            // KYC'd recipient gets immediate reward credits (use struct for consistency with applyCredits)
            T3CommonLib.ensureProfileExistsForWrite(ds, recipient);
            ds.incentiveCredits[recipient].amount += recipientReward;
            ds.incentiveCredits[recipient].lastUpdated = block.timestamp;
        } else {
            // Non-KYC'd recipient reward goes to escrow
            _addRewardToEscrow(ds, recipient, recipientReward);
        }

        // NOTE: Treasury already holds the full fee from _internal_transfer() in _t3Transfer().
        // The 50% treasury share remains there implicitly. Only credits/escrow are distributed above.
    }

    /**
     * @notice Checks if a transfer requires SecureSettle approval
     * @dev Evaluates USD value against configured thresholds
     */
    function _requiresSecureSettlement(StorageLib.AppStorage storage ds, uint256 amount) internal view returns (bool) {
        if (!ds.secureSettle.secureSettleActive) return false;
        if (ds.secureSettle.oracleManager == address(0)) return false;

        try IOracleManager(ds.secureSettle.oracleManager).getUsdValue(address(this), amount) returns (uint256 usdValue) {
            uint256 threshold = ds.secureSettle.defaultThreshold;
            return usdValue >= threshold;
        } catch {
            // If oracle fails, block the transfer
            revert("OracleManager: Price data unavailable");
        }
    }

    function _addRewardToEscrow(
        StorageLib.AppStorage storage ds,
        address user,
        uint256 amount
    ) internal {
        if (amount == 0) return;

        if (ds.rewardsEscrowContract == address(0)) {
            // No escrow configured. Fee already sits in treasury from _internal_transfer().
            // No additional balance manipulation needed — treasury implicitly keeps the reward share.
            return;
        }

        // Move reward portion FROM treasury to escrow contract (no minting)
        address treasury = ds.treasuryAddress;
        if (ds._balances[treasury] < amount) {
            // Safety: if treasury somehow doesn't have enough, skip escrow (funds stay in treasury)
            return;
        }

        ds._balances[treasury] -= amount;
        ds._balances[ds.rewardsEscrowContract] += amount;

        try IRewardsEscrow(ds.rewardsEscrowContract).addReward(user, amount) {
            // Success — escrow contract now manages the reward
        } catch {
            // Escrow call failed — return tokens to treasury (no inflation)
            ds._balances[ds.rewardsEscrowContract] -= amount;
            ds._balances[treasury] += amount;
        }
    }

    /**
     * @notice Returns all pending transfers (active locks) for a user (Recipient View).
     * @param user The address to query.
     * @return transfers An array of PendingTransfer structs.
     */
    function getPendingTransfers(address user) external view returns (StorageLib.PendingTransfer[] memory transfers) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        bytes32[] storage ids = ds.pendingTransferIds[user];
        uint256 length = ids.length;
        
        // First pass: count valid entries
        uint256 validCount = 0;
        for (uint256 i = 0; i < length; i++) {
            if (ds.pendingTransfers[ids[i]].amount > 0) {
                validCount++;
            }
        }
        
        transfers = new StorageLib.PendingTransfer[](validCount);
        uint256 currentIndex = 0;
        
        for (uint256 i = 0; i < length; i++) {
            StorageLib.PendingTransfer storage pt = ds.pendingTransfers[ids[i]];
            if (pt.amount > 0) {
                transfers[currentIndex] = pt;
                currentIndex++;
            }
        }
    }

    /**
     * @notice Returns all outgoing pending transfers for a user (Sender View).
     * @param user The address to query.
     * @return transfers An array of PendingTransfer structs.
     */
    function getOutgoingPendingTransfers(address user) external view returns (StorageLib.PendingTransfer[] memory transfers) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        bytes32[] storage ids = ds.outgoingPendingTransferIds[user];
        uint256 length = ids.length;
        
        // First pass: count valid entries
        uint256 validCount = 0;
        for (uint256 i = 0; i < length; i++) {
            if (ds.pendingTransfers[ids[i]].amount > 0) {
                validCount++;
            }
        }
        
        transfers = new StorageLib.PendingTransfer[](validCount);
        uint256 currentIndex = 0;
        
        for (uint256 i = 0; i < length; i++) {
            StorageLib.PendingTransfer storage pt = ds.pendingTransfers[ids[i]];
            if (pt.amount > 0) {
                transfers[currentIndex] = pt;
                currentIndex++;
            }
        }
    }
}

/**
 * @notice Interface for RewardsEscrow contract
 */
interface IRewardsEscrow {
    function addReward(address user, uint256 amount) external;
}

/**
 * @notice Interface for enhanced fee processing
 */
interface IEnhancedFeeFacet {
    function processFeeWithEscrow(address sender, address recipient, uint256 amount, uint256 totalFeeCollected) 
        external returns (uint256 senderReward, uint256 recipientReward);
}

/**
 * @notice Interface for Oracle Manager
 */
interface IOracleManager {
    function getUsdValue(address asset, uint256 amount) external view returns (uint256);
}

/// @notice Minimal interface for RulesEngineFacet for cross-facet calls
interface IRulesEngineFacet {
    enum Action { ALLOW, WARN, DENY }
    function beforeTransferCheck(
        address from,
        address to,
        uint256 amount,
        bytes calldata data,
        bytes32[] calldata allowProof,
        bytes32[] calldata denyProof
    ) external returns (uint16 score, uint8 action);
    function postTransferUpdate(address from, address to, uint256 amount) external;
}

// Internal helpers to read rules schedule and warn extension without exposing storage
import { RulesStorageLib } from "../lib/RulesStorageLib.sol";
function _getRulesFees() view returns (uint256 base, uint256 perRule, uint256 cap) {
    RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
    base = rs.feeSchedule.baseFee;
    perRule = rs.feeSchedule.perRuleSurcharge;
    cap = rs.feeSchedule.surchargeCap;
}
function _getWarnExtension() view returns (bool extendOnWarn, uint48 extendSeconds) {
    RulesStorageLib.RulesStorage storage rs = RulesStorageLib.rulesStorage();
    RulesStorageLib.RuleSet storage net = rs.ruleSets[keccak256(abi.encodePacked("NETWORK", bytes32(0)))];
    return (net.extendCommitOnWarn, net.warnExtendSeconds);
}
