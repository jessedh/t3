// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library EnvelopeInheritanceStorage {
    bytes32 internal constant STORAGE_SLOT =
        keccak256("t3.storage.envelope.inheritance.v1");

    struct Layout {
        mapping(bytes32 => bytes32) parentOf;      // childId => parentId (zero = no parent)
        mapping(bytes32 => bytes32[]) childrenOf;  // parentId => childIds
    }

    error ParentEnvelopeNotFound(bytes32 parentId);
    error ParentNotInCreatedState(bytes32 parentId, uint8 currentState);
    error CommitWindowExceedsParent(uint40 childEnd, uint40 parentEnd);
    error MaxInheritanceDepthExceeded(bytes32 parentId);
    error CallerNotParentSender(address caller, address parentSender);

    function layout() internal pure returns (Layout storage l) {
        bytes32 slot = STORAGE_SLOT;
        assembly { l.slot := slot }
    }
}
