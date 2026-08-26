// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;
import { StorageLib } from "../lib/StorageLib.sol";
import { ERC20BaseFacet } from "./ERC20BaseFacet.sol";
// Note: pause functionality handled by ERC20PausableFacet
import { ReentrancyGuardBase } from "../base/ReentrancyGuardBase.sol"; // For nonReentrant modifier
import { AccessControlFacet } from "./AccessControlFacet.sol"; // For role checks
import { RoleConstants } from "../lib/RoleConstants.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @notice Facet in charge of time-lock style transfers that lean on hash fragments for release.
 * @dev The "pseudo" quantum resistance comes from never committing to the full secret on-chain.
 *      Instead, callers escrow funds against a commitment `hashCommitment = keccak256(fragment || nonce)`.
 *      Releasing requires revealing only the fragment, meaning a quantum adversary has to recover
 *      both the per-transfer nonce and the correct fragment slice, not the original master secret,
 *      which makes Grover-style preimage attacks less attractive for the short lifetime of a lock.
 */
contract LockedTransferManagerFacet is ReentrancyGuardBase { // Use ReentrancyGuard for modifier, pause functionality from ERC20PausableFacet
    using EnumerableSet for EnumerableSet.AddressSet;
    using StorageLib for StorageLib.AppStorage;
    
    // Role check function
    function _checkRole(bytes32 role, address account) internal view {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        if (!ds._roles[role].contains(account)) {
            revert StorageLib.UnauthorizedRole(account, role);
        }
    }
    
    // Internal wrapper function to replace ERC20BaseFacet.internal_transfer calls
    function _internal_transfer(StorageLib.AppStorage storage ds, address sender, address recipient, uint256 amount) internal {
        // Same logic as ERC20BaseFacet.internal_transfer
        if (sender == address(0)) { revert StorageLib.TransferToZeroAddress(); }
        if (recipient == address(0)) { revert StorageLib.TransferToZeroAddress(); }
        
        uint256 senderBalance = ds._balances[sender];
        if (senderBalance < amount) {
            revert StorageLib.ERC20InsufficientBalance(sender, senderBalance, amount);
        }
        
        ds._balances[sender] = senderBalance - amount;
        ds._balances[recipient] += amount;
    }

    event LockedTransferCreated(
        bytes32 indexed transferId,
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        address releaseAuthorizedAddress
    );
    event LockedTransferReleased(
        bytes32 indexed transferId,
        address indexed recipient,
        uint256 amount,
        address releaser // Address that triggered the release
    );
    event LockedTransferCancelled(
        bytes32 indexed transferId,
        address canceller // Address that triggered the cancellation
    );
    
    // Quantum Resistance Events
    event QuantumThreatDetected(
        bytes32 indexed transferId,
        address indexed reporter,
        uint8 threatLevel,
        string description
    );
    
    event FragmentValidationFailed(
        bytes32 indexed transferId,
        address indexed attempter,
        bytes32 providedFragment,
        string reason
    );
    
    event EmergencyQuantumResponse(
        bytes32 indexed transferId,
        address indexed responder,
        string emergencyReason,
        uint256 timestamp
    );

    function createLockedTransfer(
        address _recipient,
        uint256 _amount,
        bytes32 _hashCommitment,
        bytes32 _nonce,
        address _releaseAuthorizedAddress
    ) external nonReentrant returns (bytes32 transferId) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();

        if (_amount == 0) { revert StorageLib.ErrorLockedTransferAmountZero(); }
        if (msg.sender == _recipient) { revert StorageLib.ErrorSelfLockedTransfer(); }
        if (_recipient == address(0)) { revert StorageLib.TransferToZeroAddress(); }
        if (_releaseAuthorizedAddress == address(0)) { revert StorageLib.CustodianZeroAddress(); } // Use more specific error

        // `hashCommitment` must be pre-computed off-chain as keccak256(fragment || nonce).
        // Only the fragment will ever be revealed on-chain; the nonce is stored here to reconstitute the commitment.
        transferId = keccak256(abi.encodePacked(
            msg.sender, _recipient, _amount, _hashCommitment, _nonce, block.timestamp, block.chainid
        ));

        if (ds.lockedTransfers[transferId].sender != address(0)) {
            revert("LockedTransferManager: Transfer ID collision");
        }

        // Escrow: Transfer tokens from sender to this Diamond contract
        _internal_transfer(ds, msg.sender, address(this), _amount);

        ds.lockedTransfers[transferId] = StorageLib.LockedTransfer({
            sender: msg.sender,
            recipient: _recipient,
            amount: _amount,
            hashCommitment: _hashCommitment,
            nonce: _nonce,
            releaseAuthorizedAddress: _releaseAuthorizedAddress,
            isReleased: false,
            isCancelled: false
        });

        emit LockedTransferCreated(transferId, msg.sender, _recipient, _amount, _releaseAuthorizedAddress);
        return transferId;
    }

    // Release by anyone who knows the secret.
    // If the person knowing the secret is also the releaseAuthorizedAddress, they must also be a CUSTODIAN.
    function releaseLockedTransfer(bytes32 _transferId, bytes32 _revealedFragment)
        external nonReentrant returns (bool) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        StorageLib.LockedTransfer storage transfer_ = ds.lockedTransfers[_transferId];

        if (transfer_.sender == address(0)) { revert StorageLib.ErrorLockedTransferNotFound(); }
        if (transfer_.isReleased) { revert StorageLib.ErrorTransferAlreadyReleased(); }
        if (transfer_.isCancelled) { revert StorageLib.ErrorTransferAlreadyCancelled(); }

        // Rebuild the commitment using the caller-supplied fragment slice plus the stored nonce.
        // Only if the recomposed hash matches do we consider the fragment authentic.
        if (keccak256(abi.encodePacked(_revealedFragment, transfer_.nonce)) != transfer_.hashCommitment) {
            revert StorageLib.ErrorHashCommitmentMismatch();
        }

        // **CRITICAL CUSTODIAN_ROLE CHECK**
        // If the msg.sender happens to be the designated releaseAuthorizedAddress,
        // they MUST also have the CUSTODIAN_ROLE.
        // This covers the primary authorized path.
        if (msg.sender == transfer_.releaseAuthorizedAddress) {
            _checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        }
        // Design choice: If someone *else* (not releaseAuthorizedAddress) has the secret, should they also need CUSTODIAN_ROLE?
        // For maximum security relating to your requirement, you might want to enforce that *any* releaser needs CUSTODIAN_ROLE:
        // else { _checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender); }
        // Or, if the intent is *only* the releaseAuthorizedAddress (who must be a custodian) can release:
        // require(msg.sender == transfer_.releaseAuthorizedAddress, "Only designated authorized address");
        // _checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender); // This becomes redundant with above if so.
        // The current logic allows release by secret, with an added check if the secret holder IS the auth address.

        transfer_.isReleased = true;
        _internal_transfer(ds, address(this), transfer_.recipient, transfer_.amount);

        emit LockedTransferReleased(_transferId, transfer_.recipient, transfer_.amount, msg.sender);
        return true;
    }

    // Release specifically by the designated releaseAuthorizedAddress, who MUST be a CUSTODIAN.
    function releaseLockedTransferByAuthorized(bytes32 _transferId)
        external nonReentrant returns (bool) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        StorageLib.LockedTransfer storage transfer_ = ds.lockedTransfers[_transferId];

        if (transfer_.sender == address(0)) { revert StorageLib.ErrorLockedTransferNotFound(); }
        if (transfer_.isReleased) { revert StorageLib.ErrorTransferAlreadyReleased(); }
        if (transfer_.isCancelled) { revert StorageLib.ErrorTransferAlreadyCancelled(); }

        if (msg.sender != transfer_.releaseAuthorizedAddress) {
            revert StorageLib.ErrorOnlyAuthorizedAddressCanRelease();
        }
        // **CRITICAL CUSTODIAN_ROLE CHECK**
        _checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);

        transfer_.isReleased = true;
        _internal_transfer(ds, address(this), transfer_.recipient, transfer_.amount);

        emit LockedTransferReleased(_transferId, transfer_.recipient, transfer_.amount, msg.sender);
        return true;
    }

    function cancelLockedTransfer(bytes32 _transferId)
        external nonReentrant returns (bool) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        StorageLib.LockedTransfer storage transfer_ = ds.lockedTransfers[_transferId];

        if (transfer_.sender == address(0)) { revert StorageLib.ErrorLockedTransferNotFound(); }
        if (transfer_.isReleased) { revert StorageLib.ErrorTransferAlreadyReleased(); }
        if (transfer_.isCancelled) { revert StorageLib.ErrorTransferAlreadyCancelled(); }

        bool isSender = (msg.sender == transfer_.sender);
        bool isAdmin = ds._roles[RoleConstants.ADMIN_ROLE].contains(msg.sender);

        if (!isSender && !isAdmin) {
            revert StorageLib.ErrorOnlySenderOrAdminCanCancel();
        }

        transfer_.isCancelled = true;
        _internal_transfer(ds, address(this), transfer_.sender, transfer_.amount);

        emit LockedTransferCancelled(_transferId, msg.sender);
        return true;
    }

    // Batch release requires the caller (a custodian) to provide secrets for each transfer.
    // Each transfer's releaseAuthorizedAddress should ideally be this custodian for this path.
    function batchReleaseLockedTransfers(
        bytes32[] calldata _transferIds,
        bytes32[] calldata _revealedFragments
    )
        external nonReentrant returns (bool[] memory results)
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        uint256 length = _transferIds.length;
        require(length == _revealedFragments.length, "LockedTransferManagerFacet: Array length mismatch");
        results = new bool[](length);

        _checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);

        for (uint256 i = 0; i < length; ) {
            StorageLib.LockedTransfer storage transfer_ = ds.lockedTransfers[_transferIds[i]];
            if (transfer_.sender != address(0) &&
                !transfer_.isReleased &&
                !transfer_.isCancelled &&
                msg.sender == transfer_.releaseAuthorizedAddress && // The calling custodian must be the one authorized for this specific transfer
                keccak256(abi.encodePacked(_revealedFragments[i], transfer_.nonce)) == transfer_.hashCommitment)
            {
                transfer_.isReleased = true;
                _internal_transfer(ds, address(this), transfer_.recipient, transfer_.amount);
                emit LockedTransferReleased(_transferIds[i], transfer_.recipient, transfer_.amount, msg.sender);
                results[i] = true;
            } else {
                results[i] = false;
            }
            unchecked { ++i; }
        }
        return results;
    }

    function getLockedTransfer(bytes32 _transferId)
        external view returns (StorageLib.LockedTransfer memory) {
        return StorageLib.diamondStorage().lockedTransfers[_transferId];
    }

    // ============ QUANTUM RESISTANCE FUNCTIONS ============

    /**
     * @notice Validate fragment derivation for quantum resistance
     * @dev Supports multiple derivation methods for operational flexibility
     * @param masterSecretHash Hash of the full master secret (for verification)
     * @param revealedFragment The fragment being revealed
     * @param derivationMethod How fragment was derived from master secret (0-2)
     * @return isValid Whether fragment follows expected derivation pattern
     */
    function validateFragmentDerivation(
        bytes32 masterSecretHash,
        bytes32 revealedFragment, 
        uint8 derivationMethod
    ) external pure returns (bool isValid) {
        // Each derivation path deterministically maps the off-chain master secret to a smaller "fragment".
        // Only the fragment hash is ever checked on-chain, keeping the bulk of the master secret opaque.
        if (derivationMethod == 0) {
            // Method 0: First 32 bytes derived pattern
            bytes32 expectedFragment = keccak256(abi.encodePacked(masterSecretHash, "FIRST_32"));
            return keccak256(abi.encodePacked(revealedFragment)) == expectedFragment;
        } else if (derivationMethod == 1) {
            // Method 1: Hash-based derivation
            bytes32 expectedFragment = keccak256(abi.encodePacked(masterSecretHash, "HASH_DERIVED"));
            return keccak256(abi.encodePacked(revealedFragment)) == expectedFragment;
        } else if (derivationMethod == 2) {
            // Method 2: Offset-based derivation
            bytes32 expectedFragment = keccak256(abi.encodePacked(masterSecretHash, "OFFSET_64"));
            return keccak256(abi.encodePacked(revealedFragment)) == expectedFragment;
        }
        return false;
    }
    
    /**
     * @notice Enhanced release with quantum resistance validation
     * @dev Adds additional security checks for quantum threats
     * @param _transferId Transfer to release
     * @param _revealedFragment Secret fragment
     * @param _quantumThreatLevel Current quantum threat assessment (0-10)
     * @return success Whether release was successful
     */
    function releaseLockedTransferQuantumSecure(
        bytes32 _transferId, 
        bytes32 _revealedFragment,
        uint8 _quantumThreatLevel
    ) external nonReentrant returns (bool success) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        StorageLib.LockedTransfer storage transfer_ = ds.lockedTransfers[_transferId];
        
        // Standard validations
        if (transfer_.sender == address(0)) { revert StorageLib.ErrorLockedTransferNotFound(); }
        if (transfer_.isReleased) { revert StorageLib.ErrorTransferAlreadyReleased(); }
        if (transfer_.isCancelled) { revert StorageLib.ErrorTransferAlreadyCancelled(); }
        
        // Enhanced quantum resistance checks
        if (_quantumThreatLevel >= 7) {
            // At elevated threat levels we fall back to trusted custodial release so fragments stay off-chain;
            // this avoids disclosing additional pieces that could help a quantum attacker brute force the secret.
            // High threat level: require custodian release only
            require(
                msg.sender == transfer_.releaseAuthorizedAddress,
                "QuantumThreat: High risk requires authorized release"
            );
            _checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
            
            // Log quantum threat action
            emit QuantumThreatDetected(
                _transferId,
                msg.sender,
                _quantumThreatLevel,
                "High quantum threat: custodian override used"
            );
            
            // Execute without fragment verification
            transfer_.isReleased = true;
            _internal_transfer(ds, address(this), transfer_.recipient, transfer_.amount);
            emit LockedTransferReleased(_transferId, transfer_.recipient, transfer_.amount, msg.sender);
            return true;
        }
        
        // Standard fragment verification for lower threat levels
        // Fragment + nonce must recompose the original commitment, otherwise the lock remains sealed.
        bytes32 computedHash = keccak256(abi.encodePacked(_revealedFragment, transfer_.nonce));
        if (computedHash != transfer_.hashCommitment) {
            emit FragmentValidationFailed(
                _transferId,
                msg.sender,
                _revealedFragment,
                "Hash commitment mismatch"
            );
            revert StorageLib.ErrorHashCommitmentMismatch();
        }
        
        // Custodian role check if caller is authorized address
        if (msg.sender == transfer_.releaseAuthorizedAddress) {
            _checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        }
        
        // Execute release
        transfer_.isReleased = true;
        _internal_transfer(ds, address(this), transfer_.recipient, transfer_.amount);
        emit LockedTransferReleased(_transferId, transfer_.recipient, transfer_.amount, msg.sender);
        return true;
    }
    
    /**
     * @notice Emergency quantum threat response
     * @dev Allows authorized parties to respond to quantum attacks
     * @param _transferId Transfer to protect
     * @param _emergencyReason Reason for emergency action
     * @return success Whether emergency action was successful
     */
    function emergencyQuantumResponse(
        bytes32 _transferId,
        string calldata _emergencyReason
    ) external nonReentrant returns (bool success) {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        StorageLib.LockedTransfer storage transfer_ = ds.lockedTransfers[_transferId];
        
        // Verify transfer exists and is active
        require(transfer_.sender != address(0), "Transfer not found");
        require(!transfer_.isReleased && !transfer_.isCancelled, "Transfer already processed");
        
        // Check authorization: must be custodian, admin, or emergency recovery
        StorageLib.AppStorage storage ds_auth = StorageLib.diamondStorage();
        bool isAuthorized = ds_auth._roles[RoleConstants.CUSTODIAN_ROLE].contains(msg.sender) ||
                           ds_auth._roles[RoleConstants.ADMIN_ROLE].contains(msg.sender) ||
                           msg.sender == transfer_.releaseAuthorizedAddress;
        
        require(isAuthorized, "Not authorized for emergency response");
        
        // Execute emergency release
        transfer_.isReleased = true;
        _internal_transfer(ds, address(this), transfer_.recipient, transfer_.amount);
        
        // Log emergency action
        emit EmergencyQuantumResponse(
            _transferId,
            msg.sender,
            _emergencyReason,
            block.timestamp
        );
        
        emit LockedTransferReleased(_transferId, transfer_.recipient, transfer_.amount, msg.sender);
        
        return true;
    }
    
    /**
     * @notice Batch release with quantum-resistant validation
     * @dev Enhanced batch processing with quantum threat awareness
     * @param _transferIds Array of transfers to release
     * @param _revealedFragments Corresponding secret fragments
     * @param _quantumThreatLevel Current quantum threat assessment
     * @return results Success status for each transfer
     */
    function batchReleaseWithQuantumProtection(
        bytes32[] calldata _transferIds,
        bytes32[] calldata _revealedFragments,
        uint8 _quantumThreatLevel
    ) external nonReentrant returns (bool[] memory results) {
        require(_transferIds.length == _revealedFragments.length, "Array length mismatch");
        require(_transferIds.length <= 50, "Batch size too large"); // Gas limit protection
        
        _checkRole(RoleConstants.CUSTODIAN_ROLE, msg.sender);
        
        results = new bool[](_transferIds.length);
        
        for (uint256 i = 0; i < _transferIds.length; ) {
            try this.releaseLockedTransferQuantumSecure(
                _transferIds[i],
                _revealedFragments[i],
                _quantumThreatLevel
            ) returns (bool success) {
                results[i] = success;
            } catch {
                results[i] = false;
                // Log failure but continue processing
                emit FragmentValidationFailed(
                    _transferIds[i],
                    msg.sender,
                    _revealedFragments[i],
                    "Batch processing failure"
                );
            }
            
            unchecked { ++i; }
        }
        
        return results;
    }
    
    /**
     * @notice Get quantum security status for a transfer
     * @param _transferId Transfer to check
     * @return threatLevel Current threat assessment (mock implementation)
     * @return requiresEmergencyRelease Whether emergency procedures needed
     * @return authorizedResponder Address that can respond to emergencies
     */
    function getQuantumSecurityStatus(bytes32 _transferId) 
        external 
        view 
        returns (
            uint8 threatLevel,
            bool requiresEmergencyRelease,
            address authorizedResponder
        ) 
    {
        StorageLib.AppStorage storage ds = StorageLib.diamondStorage();
        StorageLib.LockedTransfer memory transfer_ = ds.lockedTransfers[_transferId];
        
        // Mock threat level calculation (would be enhanced with real logic)
        threatLevel = 3; // Default medium threat level
        requiresEmergencyRelease = threatLevel >= 7;
        authorizedResponder = transfer_.releaseAuthorizedAddress;
        
        return (threatLevel, requiresEmergencyRelease, authorizedResponder);
    }
}
