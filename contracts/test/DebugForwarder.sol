// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "../T3Forwarder.sol";

import "hardhat/console.sol";

contract DebugForwarder is T3Forwarder {
    constructor(string memory name) T3Forwarder(name) {}

    function getStructHash(ForwardRequestData calldata request) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                _FORWARD_REQUEST_TYPEHASH,
                request.from,
                request.to,
                request.value,
                request.gas,
                nonces(request.from),
                request.deadline,
                keccak256(request.data)
            )
        );
    }

    function verify(ForwardRequestData calldata request) public view override returns (bool) {
        console.log("--- Verify Debug ---");
        console.log("From:", request.from);
        console.log("Nonce:", nonces(request.from));
        console.log("Deadline:", request.deadline);
        console.log("Value:", request.value);
        console.log("Gas:", request.gas);
        
        bytes32 structHash = getStructHash(request);
        console.logBytes32(structHash);
        
        // Manual validation flow
        (bool success, address signer) = _recoverForwardRequestSigner(request);
        console.log("Recovered:", signer);
        console.log("Expected:", request.from);
        
        bool trusted = _isTrustedByTarget(request.to);
        console.log("Is Trusted By Target:", trusted);
        
        bool active = request.deadline >= block.timestamp;
        console.log("Is Active (Deadline):", active);
        console.log("Deadline:", request.deadline);
        console.log("Block Timestamp:", block.timestamp);
        
        return success && signer == request.from && trusted && active;
    }


    function getDomainSeparator() public view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function getDigest(ForwardRequestData calldata request) public view returns (bytes32) {
        return _hashTypedDataV4(getStructHash(request));
    }
    
    function recoverSigner(ForwardRequestData calldata request) public view returns (address) {
        (address recovered, , ) = ECDSA.tryRecover(getDigest(request), request.signature);
        return recovered;
    }
}
