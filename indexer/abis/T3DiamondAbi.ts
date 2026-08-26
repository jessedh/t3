// AUTO-GENERATED — do not edit manually. Run: node scripts/regenerate-indexer-abi.js
//
// Sources: facets listed in scripts/lib/facet-manifest.js only.
// Test harnesses, mocks, and attacker contracts are excluded.
//
// BREAKING (A.9, 2026-06-13): InstitutionMode enum ordinals changed.
// ACTIVE=0 (was 1), ISSUANCE_PAUSED=1 (was 2), ORDERLY_EXIT=2 (was 3),
// DEFAULTED=3 (was 4), RESOLVED=4 (was 5). UNREGISTERED removed.
// Update any hardcoded ordinal comparisons in off-chain consumers.
export const T3DiamondAbi = [
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "institution",
        "type": "address"
      }
    ],
    "name": "AlreadyConfirmed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AlreadyInitialized",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "AmountMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ArrayLengthMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "attestor",
        "type": "address"
      }
    ],
    "name": "AttestorIsFundingParty",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "attributedOutstanding",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "totalSupply",
        "type": "uint256"
      }
    ],
    "name": "AttributedSupplyMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AttributionNotInitialized",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "existingId",
        "type": "bytes32"
      }
    ],
    "name": "BankAlreadyLinked",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "BankNotActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "BankNotCustodian",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "provided",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "max",
        "type": "uint256"
      }
    ],
    "name": "BatchSizeTooLarge",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "provided",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "max",
        "type": "uint256"
      }
    ],
    "name": "BatchTooLarge",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "BurnAmountZero",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "CallerNotArbiter",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "caller",
        "type": "address"
      }
    ],
    "name": "CallerNotDiamond",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "caller",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "parentSender",
        "type": "address"
      }
    ],
    "name": "CallerNotParentSender",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CallerNotRegisteredCustodian",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "CallerNotSenderOrArbiter",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "attempted",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "ceiling",
        "type": "uint256"
      }
    ],
    "name": "CambioDailyRedemptionCeilingExceeded",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CambioEnvelopeDisabled",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CambioInvalidConfiguration",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CambioInvalidPhaseTransition",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "current",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "max",
        "type": "uint256"
      }
    ],
    "name": "CambioMaxOutstandingNotesExceeded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "current",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "max",
        "type": "uint256"
      }
    ],
    "name": "CambioMaxOutstandingValueExceeded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      }
    ],
    "name": "CambioNoteExpired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "name": "CambioNoteNotInRecovery",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CambioPaused",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "CancelNotAllowed",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "capacity",
        "type": "uint256"
      }
    ],
    "name": "CapacityExceededAtExecute",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CapacityModelActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      }
    ],
    "name": "ChallengeWindowClosed",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "uint40",
        "name": "challengeDeadline",
        "type": "uint40"
      }
    ],
    "name": "ChallengeWindowNotElapsed",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "CIPNotFound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CIPRecordHashRequired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "currentSupply",
        "type": "uint256"
      }
    ],
    "name": "ClaimAttributionMustInitAtZeroSupply",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "ClawbackWindowActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "ClawbackWindowExpired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      }
    ],
    "name": "CommitAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      }
    ],
    "name": "CommitExpired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "expected",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "actual",
        "type": "address"
      }
    ],
    "name": "CommitRedeemerMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      }
    ],
    "name": "CommitRevealRequired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint40",
        "name": "childEnd",
        "type": "uint40"
      },
      {
        "internalType": "uint40",
        "name": "parentEnd",
        "type": "uint40"
      }
    ],
    "name": "CommitWindowExceedsParent",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "oldWallet",
        "type": "address"
      }
    ],
    "name": "CompletionStateNotZero",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "ComplianceBankNotEligible",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "uint8",
        "name": "context",
        "type": "uint8"
      }
    ],
    "name": "ComplianceCIPRequired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "scopeId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "controlKey",
        "type": "bytes32"
      }
    ],
    "name": "ComplianceExemptionRequired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "objectId",
        "type": "bytes32"
      }
    ],
    "name": "ComplianceHoldActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "domain",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "objectId",
        "type": "bytes32"
      }
    ],
    "name": "ComplianceHoldAlreadyResolved",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "outcome",
        "type": "uint8"
      }
    ],
    "name": "ComplianceHoldInvalidOutcome",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ComplianceHoldInvalidPayee",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "domain",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "objectId",
        "type": "bytes32"
      }
    ],
    "name": "ComplianceHoldNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "objectId",
        "type": "bytes32"
      }
    ],
    "name": "ComplianceHoldPartialBurn",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "domain",
        "type": "bytes32"
      }
    ],
    "name": "ComplianceHoldUnsupportedDomain",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "party",
        "type": "address"
      },
      {
        "internalType": "uint8",
        "name": "context",
        "type": "uint8"
      }
    ],
    "name": "ComplianceKycRequired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "party",
        "type": "address"
      }
    ],
    "name": "ComplianceSanctioned",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "party",
        "type": "address"
      }
    ],
    "name": "ComplianceScreeningStale",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "reason",
        "type": "bytes32"
      }
    ],
    "name": "ComplianceUnknownReason",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ConditionDataRequired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ConsortiumBurnRequiresAttributedPath",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "operation",
        "type": "bytes32"
      }
    ],
    "name": "ConsortiumOperationPaused",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CrossInstitutionFiatNotSupported",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "existingCustodian",
        "type": "address"
      }
    ],
    "name": "CustodianAlreadyAssigned",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "caller",
        "type": "address"
      }
    ],
    "name": "CustodianRoleRequired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CustodianZeroAddress",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "currentCycleId",
        "type": "bytes32"
      }
    ],
    "name": "CycleAlreadyActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "CycleAlreadyFinal",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      }
    ],
    "name": "CycleChallenged",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "CycleNotConfirmedOrFunding",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "provided",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "current",
        "type": "bytes32"
      }
    ],
    "name": "CycleNotCurrentRoutingCycle",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      }
    ],
    "name": "CycleNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "CycleNotFunding",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "CycleNotInFunding",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "current",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "required",
        "type": "uint8"
      }
    ],
    "name": "CycleNotInState",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "remaining",
        "type": "uint256"
      }
    ],
    "name": "DailyCapExceeded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint40",
        "name": "deadline",
        "type": "uint40"
      }
    ],
    "name": "DeadlineInPast",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "tinHash",
        "type": "bytes32"
      }
    ],
    "name": "DepositorHashAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "tinHash",
        "type": "bytes32"
      }
    ],
    "name": "DepositorHashNotFound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Deprecated",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "DisputeAlreadyActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "DisputeNotActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "DuplicateIssuer",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "name": "ElectionWindowExpired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "name": "ElectionWindowNotExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EmergencyAlreadyActive",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EmergencyNotActive",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EmptyComposition",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "requestedTotal",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "effectiveReserve",
        "type": "uint256"
      }
    ],
    "name": "EncumbranceExceedsReserve",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "EnvelopeAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "EnvelopeNotExpired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "EnvelopeNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "name": "EnvelopeNotInRecovery",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "current",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "required",
        "type": "uint8"
      }
    ],
    "name": "EnvelopeNotInState",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "currentState",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "requiredState",
        "type": "uint8"
      }
    ],
    "name": "EnvelopeNotInState",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "currentBalance",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "requiredBalance",
        "type": "uint256"
      }
    ],
    "name": "ERC20InsufficientBalance",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "escrowKey",
        "type": "bytes32"
      }
    ],
    "name": "EscrowAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "escrowKey",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "available",
        "type": "uint256"
      }
    ],
    "name": "EscrowInsufficientClaims",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "escrowKey",
        "type": "bytes32"
      }
    ],
    "name": "EscrowNotActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "available",
        "type": "uint256"
      }
    ],
    "name": "ExactCompositionMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes4",
        "name": "selector",
        "type": "bytes4"
      }
    ],
    "name": "FunctionDoesNotExist",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "provided",
        "type": "uint256"
      }
    ],
    "name": "FundingAmountMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      }
    ],
    "name": "FundingRefAlreadyUsed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "HalfLifeAboveMaximum",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "HalfLifeBelowMinimum",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InactivityPeriodPositive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "app",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "sponsor",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "investment",
        "type": "bool"
      }
    ],
    "name": "InconsistentEmergencyState",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "name": "InstitutionAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "existingBank",
        "type": "address"
      }
    ],
    "name": "InstitutionIdAlreadyLinked",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "custodian",
        "type": "address"
      },
      {
        "internalType": "enum InstitutionLifecycleStorage.InstitutionMode",
        "name": "mode",
        "type": "uint8"
      }
    ],
    "name": "InstitutionModeBlocksAttestation",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "custodian",
        "type": "address"
      },
      {
        "internalType": "enum InstitutionLifecycleStorage.InstitutionMode",
        "name": "mode",
        "type": "uint8"
      }
    ],
    "name": "InstitutionModeBlocksCustodianRegistration",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "enum InstitutionLifecycleStorage.InstitutionMode",
        "name": "mode",
        "type": "uint8"
      }
    ],
    "name": "InstitutionModeBlocksWalletLinking",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "name": "InstitutionNotActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "name": "InstitutionNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "available",
        "type": "uint256"
      }
    ],
    "name": "InsufficientCapacity",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "available",
        "type": "uint256"
      }
    ],
    "name": "InsufficientClaims",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "diamond",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "available",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      }
    ],
    "name": "InsufficientEscrowBalance",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "available",
        "type": "uint256"
      }
    ],
    "name": "InsufficientIssuerOutstanding",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "settled",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      }
    ],
    "name": "InsufficientSettledReserve",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidAmount",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      }
    ],
    "name": "InvalidCommit",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidCommitWindowEnd",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "provided",
        "type": "uint8"
      }
    ],
    "name": "InvalidDisputeOutcome",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidDuration",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "level",
        "type": "uint8"
      }
    ],
    "name": "InvalidEmergencyLevel",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "choice",
        "type": "uint8"
      }
    ],
    "name": "InvalidEnvelopeRecoveryChoice",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "provided",
        "type": "uint8"
      }
    ],
    "name": "InvalidExpirationBehavior",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "InvalidFragment",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidHashCommitment",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidInstitutionName",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "institution",
        "type": "address"
      },
      {
        "internalType": "enum InstitutionLifecycleStorage.InstitutionMode",
        "name": "current",
        "type": "uint8"
      },
      {
        "internalType": "enum InstitutionLifecycleStorage.InstitutionMode",
        "name": "proposed",
        "type": "uint8"
      }
    ],
    "name": "InvalidModeTransition",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "action",
        "type": "uint8"
      }
    ],
    "name": "InvalidNoteAction",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "objectType",
        "type": "uint8"
      }
    ],
    "name": "InvalidObjectType",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      }
    ],
    "name": "InvalidPhrase",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidPolicyKey",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidRecipient",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "currentState",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "expectedState",
        "type": "uint8"
      }
    ],
    "name": "InvalidRecoveryState",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "remaining",
        "type": "uint256"
      }
    ],
    "name": "InvalidRedemptionAmount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidRef",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidSaltHash",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "provided",
        "type": "uint8"
      }
    ],
    "name": "InvalidSettlementType",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidTinHash",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "IssuerAlreadyRegistered",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "IssuerFullyPaused",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "IssuerNotRegistered",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "KYCExpiryBeforeValidation",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "LegacyIssuanceDisabled",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "LegacyMintLocked",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "enum InstitutionLifecycleStorage.InstitutionMode",
        "name": "mode",
        "type": "uint8"
      }
    ],
    "name": "LifecycleDeactivationBlocked",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "max",
        "type": "uint256"
      }
    ],
    "name": "MaxCommitLifetimeExceeded",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MaxHalfLifeBelowMinimum",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MaxHalfLifePositive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "parentId",
        "type": "bytes32"
      }
    ],
    "name": "MaxInheritanceDepthExceeded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "max",
        "type": "uint256"
      }
    ],
    "name": "MaxNoteValueExceeded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "length",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxLength",
        "type": "uint256"
      }
    ],
    "name": "MetadataTooLong",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MigrationArrayLengthMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MinHalfLifeExceedsMax",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MinHalfLifePositive",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MintAmountZero",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MintToZeroAddress",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoActiveSaltEpoch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "redeemer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      }
    ],
    "name": "NonceAlreadySpent",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoOpenSettlementCycle",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "a",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "b",
        "type": "address"
      }
    ],
    "name": "NoPairDebt",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sponsorBank",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "NoPendingEndorsement",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotAdmin",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotCustodian",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "institution",
        "type": "address"
      }
    ],
    "name": "NotCycleIssuer",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      }
    ],
    "name": "NoteNotActive",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotFallbackActive",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotImplemented",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "NotNetworkBlocked",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "caller",
        "type": "address"
      }
    ],
    "name": "NotNoteIssuer",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "reservationId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "caller",
        "type": "address"
      }
    ],
    "name": "NotReservationOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      }
    ],
    "name": "OpenRedemptionRequired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "OracleAlreadyRegistered",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "OracleCallbackAlreadyReceived",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "caller",
        "type": "address"
      }
    ],
    "name": "OracleCallbackUnauthorized",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "OracleNotRegistered",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "OracleRequiredForBehavior",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      }
    ],
    "name": "PairAlreadyFunded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "lo",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "hi",
        "type": "address"
      }
    ],
    "name": "PairNotFunded",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "parentId",
        "type": "bytes32"
      }
    ],
    "name": "ParentEnvelopeNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "parentId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "currentState",
        "type": "uint8"
      }
    ],
    "name": "ParentNotInCreatedState",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Paused",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "receivingIssuer",
        "type": "address"
      }
    ],
    "name": "ReceivingIssuerNotActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "RecoveryBlockedBySanctions",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "counterparty",
        "type": "address"
      }
    ],
    "name": "RecoveryBlockedOnInterbankLiabilities",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "RecoveryBlockedOnLegacyTransfers",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "name": "RecoveryNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "name": "RecoveryNotMigrated",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      }
    ],
    "name": "RelayerRequired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "postReleaseReserve",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "floor",
        "type": "uint256"
      }
    ],
    "name": "ReleaseBelowFloor",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "name": "ReservationExpired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "name": "ReservationNotActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      }
    ],
    "name": "ReservationNotExpired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "remaining",
        "type": "uint256"
      }
    ],
    "name": "ReversalExceedsRemaining",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "ReversalNotPermitted",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "SafeERC20FailedOperation",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "epochId",
        "type": "uint16"
      }
    ],
    "name": "SaltEpochAlreadyExpired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "epochId",
        "type": "uint16"
      }
    ],
    "name": "SaltEpochNotFound",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "party",
        "type": "address"
      }
    ],
    "name": "SelfFunding",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "SelfObligation",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SelfTransfer",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "standby",
        "type": "address"
      }
    ],
    "name": "StandbyWalletInvalid",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "successor",
        "type": "address"
      }
    ],
    "name": "SuccessorCipMissing",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "successor",
        "type": "address"
      }
    ],
    "name": "SuccessorNotCustodian",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "successor",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "tag",
        "type": "bytes32"
      }
    ],
    "name": "SuccessorStateConflict",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "uint40",
        "name": "timelockEndsAt",
        "type": "uint40"
      }
    ],
    "name": "TimelockActive",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "requested",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maximum",
        "type": "uint256"
      }
    ],
    "name": "TooManyIssuerBuckets",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      }
    ],
    "name": "TooManyIssuers",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransferAmountZero",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransferToZeroAddress",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "ref",
        "type": "bytes32"
      }
    ],
    "name": "TravelRuleCommitmentMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "ref",
        "type": "bytes32"
      },
      {
        "internalType": "uint40",
        "name": "deadline",
        "type": "uint40"
      }
    ],
    "name": "TravelRuleRefExpired",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "threshold",
        "type": "uint256"
      }
    ],
    "name": "TravelRuleRequired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TreasuryAddressZero",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnauthorizedCaller",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "caller",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      }
    ],
    "name": "UnauthorizedRole",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "caller",
        "type": "address"
      }
    ],
    "name": "UnauthorizedViewer",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UserAddressZero",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      }
    ],
    "name": "UserAlreadyRegistered",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "currentInstitutionId",
        "type": "bytes32"
      }
    ],
    "name": "WalletAlreadyAffiliated",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "WalletInRecovery",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "WalletNotAffiliated",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      }
    ],
    "name": "WrongPairParties",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddressNotAllowed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAmount",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroPaymentRef",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "newAbnormalTxCount",
        "type": "uint256"
      }
    ],
    "name": "AbnormalTransactionFlagged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "Approval",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "price",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "stalenessThreshold",
        "type": "uint32"
      }
    ],
    "name": "AssetPriceSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "tokenAddress",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      }
    ],
    "name": "AssetTypeConfigured",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "activator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reason",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool[3]",
        "name": "systemsAffected",
        "type": "bool[3]"
      }
    ],
    "name": "AtomicEmergencyActivated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "deactivator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reason",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool[3]",
        "name": "systemsResumed",
        "type": "bool[3]"
      }
    ],
    "name": "AtomicEmergencyDeactivated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint8",
        "name": "threatLevel",
        "type": "uint8"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "activator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reason",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool[]",
        "name": "systemsPaused",
        "type": "bool[]"
      }
    ],
    "name": "AutomatedEmergencyModeActivated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "deactivator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reason",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool[]",
        "name": "systemsResumed",
        "type": "bool[]"
      }
    ],
    "name": "AutomatedEmergencyModeDeactivated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      }
    ],
    "name": "BankActivationChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "factorBps",
        "type": "uint256"
      }
    ],
    "name": "BankCollateralFactorSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "admin",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
      }
    ],
    "name": "BankDailyCapSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "name": "BankInstitutionLinked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "primarySigner",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "maxCollateralLimit",
        "type": "uint256"
      }
    ],
    "name": "BankProfileUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "primarySigner",
        "type": "address"
      }
    ],
    "name": "BankRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "treasuryWallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "collateralVault",
        "type": "address"
      }
    ],
    "name": "BankWalletConfigured",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "maxNoteValue",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint48",
        "name": "minDeadlineBuffer",
        "type": "uint48"
      },
      {
        "indexed": false,
        "internalType": "uint48",
        "name": "maxDeadlineWindow",
        "type": "uint48"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "maxMetadataLength",
        "type": "uint32"
      }
    ],
    "name": "CambioConfigUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "maxNoteValue",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint48",
        "name": "minDeadlineBuffer",
        "type": "uint48"
      },
      {
        "indexed": false,
        "internalType": "uint48",
        "name": "maxDeadlineWindow",
        "type": "uint48"
      },
      {
        "indexed": false,
        "internalType": "uint32",
        "name": "maxMetadataLength",
        "type": "uint32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "commitRevealThreshold",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint48",
        "name": "maxCommitLifetime",
        "type": "uint48"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "cambioPaused",
        "type": "bool"
      }
    ],
    "name": "CambioEnvelopeConfigUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "remainingAmount",
        "type": "uint256"
      }
    ],
    "name": "CambioEnvelopeNoteCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint48",
        "name": "deadline",
        "type": "uint48"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "phraseCommitment",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "openRedemptionSnapshot",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "requiresCommitReveal",
        "type": "bool"
      }
    ],
    "name": "CambioEnvelopeNoteCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "redeemer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "remaining",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "receiptId",
        "type": "bytes32"
      }
    ],
    "name": "CambioEnvelopeNoteRedeemed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "caller",
        "type": "address"
      }
    ],
    "name": "CambioPaused",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "enum CambioEnvelopeStorage.CambioEnvelopePhase",
        "name": "newPhase",
        "type": "uint8"
      }
    ],
    "name": "CambioPhaseAdvanced",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "caller",
        "type": "address"
      }
    ],
    "name": "CambioUnpaused",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "admin",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "CapacityModelActiveSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "parentEnvelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "childEnvelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "commitWindowEnd",
        "type": "uint40"
      }
    ],
    "name": "ChildEnvelopeCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "cipRecordHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "custodian",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "CIPRecorded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "custodian",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "CIPRevoked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "admin",
        "type": "address"
      }
    ],
    "name": "ClaimAttributionInitialized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "treasuryWallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "collateralVault",
        "type": "address"
      }
    ],
    "name": "CollateralPledged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "collateralVault",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      }
    ],
    "name": "CollateralReleased",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "redeemer",
        "type": "address"
      }
    ],
    "name": "CommitCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "redeemer",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "CommitCleared",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "redeemer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "expiresAt",
        "type": "uint256"
      }
    ],
    "name": "CommitRedemption",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "threshold",
        "type": "uint256"
      }
    ],
    "name": "CommitRevealThresholdUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "remainingAlerts",
        "type": "uint256"
      }
    ],
    "name": "ComplianceAlertResolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "scopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "controlKey",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "reasonHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "grantedBy",
        "type": "address"
      }
    ],
    "name": "ComplianceExemptionGranted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "gate",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "admin",
        "type": "address"
      }
    ],
    "name": "ComplianceGateSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "domain",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "objectId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "effectiveIssuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "valueOutstandingBefore",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "holdAmount",
        "type": "uint256"
      }
    ],
    "name": "ComplianceHoldNoteProfileClamped",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "domain",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "objectId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "failingParty",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "reasonCode",
        "type": "bytes32"
      }
    ],
    "name": "ComplianceHoldReleaseBlocked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "domain",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "objectId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "disposition",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "payee",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "resolvedBy",
        "type": "address"
      }
    ],
    "name": "ComplianceHoldResolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "domain",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "objectId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "resolvedPayee",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "failingParty",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "reasonCode",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "CompliancePayoutHeld",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "checkingBank",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "conflictBank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "tinHash",
        "type": "bytes32"
      }
    ],
    "name": "ConflictDetected",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "reportId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "totalDeposits",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "outstandingLiabilities",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "activeBanks",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "interbankVolume",
        "type": "uint256"
      }
    ],
    "name": "ConsortiumComplianceReport",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldWallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newWallet",
        "type": "address"
      }
    ],
    "name": "ConsortiumStateMigrated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "ConsortiumTokensBurned",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "ConsortiumTokensMinted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "bool",
        "name": "appStorageState",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "sponsorBankState",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "investmentState",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "CrossStorageEmergencySync",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "newWindow",
        "type": "uint40"
      }
    ],
    "name": "DefaultFallbackWindowUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "count",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "authority",
        "type": "address"
      }
    ],
    "name": "DefunctInstitutionBlocksCleared",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "int256",
        "name": "delta",
        "type": "int256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "newBalance",
        "type": "uint256"
      }
    ],
    "name": "DepositLedgerAdjusted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "count",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "DepositorHashBatchRemoved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "count",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "DepositorHashBatchSubmitted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "tinHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "DepositorHashRemoved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "tinHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "DepositorHashSubmitted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldWallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newWallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "movedThisCall",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "remaining",
        "type": "uint256"
      }
    ],
    "name": "DepositorIdentityStateMigrated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "totalMinted",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "totalBurned",
        "type": "uint256"
      }
    ],
    "name": "DepositTokenStatsUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "facetAddress",
            "type": "address"
          },
          {
            "internalType": "enum IDiamondCut.FacetCutAction",
            "name": "action",
            "type": "uint8"
          },
          {
            "internalType": "bytes4[]",
            "name": "functionSelectors",
            "type": "bytes4[]"
          }
        ],
        "indexed": false,
        "internalType": "struct IDiamondCut.FacetCut[]",
        "name": "_diamondCut",
        "type": "tuple[]"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "_init",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "_calldata",
        "type": "bytes"
      }
    ],
    "name": "DiamondCut",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "operator",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "feeAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "transferKind",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "correlationId",
        "type": "bytes32"
      }
    ],
    "name": "DirectTransferExecuted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "raisedBy",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "reasonHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "timeoutAt",
        "type": "uint40"
      }
    ],
    "name": "DisputeRaised",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "resolver",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "outcome",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "resolvedAt",
        "type": "uint40"
      }
    ],
    "name": "DisputeResolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "string",
        "name": "actionType",
        "type": "string"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "executor",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "success",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "details",
        "type": "string"
      }
    ],
    "name": "EmergencyActionExecuted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "guardian",
        "type": "address"
      }
    ],
    "name": "EmergencyGuardianUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "admin",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "newEpochId",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "EmergencySaltCompromise",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "bool",
        "name": "appStorageState",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "sponsorBankState",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "investmentState",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "isConsistent",
        "type": "bool"
      }
    ],
    "name": "EmergencyStateValidated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "choice",
        "type": "uint8"
      }
    ],
    "name": "EnvelopeChoiceOverridden",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "commitWindowEnd",
        "type": "uint40"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "settlementType",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "expirationBehavior",
        "type": "uint8"
      }
    ],
    "name": "EnvelopeCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "finalizedAt",
        "type": "uint40"
      }
    ],
    "name": "EnvelopeFinalized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "reversedAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "reversedAt",
        "type": "uint40"
      }
    ],
    "name": "EnvelopeReversed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "institution",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "paymentRef",
        "type": "bytes32"
      }
    ],
    "name": "FedwireAttested",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "challenger",
        "type": "address"
      }
    ],
    "name": "FedwireChallenged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "paymentRef",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "challengeDeadline",
        "type": "uint40"
      }
    ],
    "name": "FedwireFallbackInitiated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "paymentRef",
        "type": "bytes32"
      }
    ],
    "name": "FedwireFinalized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "fee",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "base",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "ruleSurcharge",
        "type": "uint256"
      }
    ],
    "name": "FeeApplied",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "minFeeWei",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "maxFeePercentBps",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "baseRiskScalerBps",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "maxRiskScalerBps",
        "type": "uint256"
      }
    ],
    "name": "FeeParametersUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "baseFee",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "perRuleSurcharge",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "surchargeCap",
        "type": "uint256"
      }
    ],
    "name": "FeeScheduleUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256[]",
        "name": "feeTierThresholds",
        "type": "uint256[]"
      },
      {
        "indexed": false,
        "internalType": "uint256[]",
        "name": "feeTierRatesBps",
        "type": "uint256[]"
      }
    ],
    "name": "FeeTiersUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "confirmedAt",
        "type": "uint40"
      }
    ],
    "name": "FiatDeliveryConfirmed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "clawedBackAt",
        "type": "uint40"
      }
    ],
    "name": "FiatSettlementClawedBack",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "clawbackDeadline",
        "type": "uint40"
      }
    ],
    "name": "FiatSettlementTriggered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "count",
        "type": "uint256"
      }
    ],
    "name": "GlobalMaxOutstandingNoteCountUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "GlobalMaxOutstandingNoteValueUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "halfLifeDuration",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "minHalfLifeDuration",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "maxHalfLifeDuration",
        "type": "uint256"
      }
    ],
    "name": "HalfLifeParametersUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "allow",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "deny",
        "type": "bool"
      }
    ],
    "name": "HotlistUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "inactivityResetPeriod",
        "type": "uint256"
      }
    ],
    "name": "InactivityResetPeriodUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "oldAdmin",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "newAdmin",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "rotatedBy",
        "type": "address"
      }
    ],
    "name": "InstitutionAdminRotated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "institution",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "enum InstitutionLifecycleStorage.InstitutionMode",
        "name": "oldMode",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "enum InstitutionLifecycleStorage.InstitutionMode",
        "name": "newMode",
        "type": "uint8"
      }
    ],
    "name": "InstitutionModeChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "clearedBy",
        "type": "address"
      }
    ],
    "name": "InstitutionPolicyCleared",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "setBy",
        "type": "address"
      }
    ],
    "name": "InstitutionPolicySet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "adminAddress",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "registeredBy",
        "type": "address"
      }
    ],
    "name": "InstitutionRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "enabled",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "setBy",
        "type": "address"
      }
    ],
    "name": "InstitutionSanctionsEnabledSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldWallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newWallet",
        "type": "address"
      }
    ],
    "name": "InstitutionStateMigrated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "enum InstitutionStorage.InstitutionStatus",
        "name": "newStatus",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "changedBy",
        "type": "address"
      }
    ],
    "name": "InstitutionStatusChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "updatedBy",
        "type": "address"
      }
    ],
    "name": "InstitutionUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "sendingBank",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "receivingBank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "normalizedAmount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "riskWeight",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "memo",
        "type": "string"
      }
    ],
    "name": "InterBankTransactionMonitored",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "IssuanceExecuted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "newState",
        "type": "uint8"
      }
    ],
    "name": "IssuanceReservationReleased",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "expiry",
        "type": "uint40"
      }
    ],
    "name": "IssuanceReserved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "ceiling",
        "type": "uint256"
      }
    ],
    "name": "IssuerDailyRedemptionCeilingUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "IssuerDeactivated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "floor",
        "type": "uint256"
      }
    ],
    "name": "IssuerFloorSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "count",
        "type": "uint256"
      }
    ],
    "name": "IssuerMaxOutstandingNoteCountUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "IssuerMaxOutstandingNoteValueUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "open",
        "type": "bool"
      }
    ],
    "name": "IssuerOpenRedemptionSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "open",
        "type": "bool"
      }
    ],
    "name": "IssuerOpenRedemptionUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "enum CambioEnvelopeStorage.PauseState",
        "name": "newState",
        "type": "uint8"
      }
    ],
    "name": "IssuerPauseStateChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "IssuerRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sponsorBank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "IssuerRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "custodian",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "reasonCode",
        "type": "uint256"
      }
    ],
    "name": "KYCRevoked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "custodian",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "kycValidatedTimestamp",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "kycExpiresTimestamp",
        "type": "uint256"
      }
    ],
    "name": "KYCStatusUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "admin",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "unlocked",
        "type": "bool"
      }
    ],
    "name": "LegacyMintUnlockedSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint48",
        "name": "lifetime",
        "type": "uint48"
      }
    ],
    "name": "MaxCommitLifetimeUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "allowRoot",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "denyRoot",
        "type": "bytes32"
      }
    ],
    "name": "MerkleRootsUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "listVersionHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "authority",
        "type": "address"
      }
    ],
    "name": "NetworkBlockPlaced",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "previousStatus",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "reasonHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "authority",
        "type": "address"
      }
    ],
    "name": "NetworkCleared",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "setBy",
        "type": "address"
      }
    ],
    "name": "NetworkPolicySet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "legacyIssuer",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "effectiveIssuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "redeemer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "NoteRedeemed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "bool",
        "name": "observationMode",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "warnAt",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "denyAt",
        "type": "uint16"
      }
    ],
    "name": "ObservationModeUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "operation",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "actor",
        "type": "address"
      }
    ],
    "name": "OperationPaused",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "operation",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "actor",
        "type": "address"
      }
    ],
    "name": "OperationResumed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "oracleAddress",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "result",
        "type": "bool"
      }
    ],
    "name": "OracleCallbackReceived",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "oracleAddress",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes4",
        "name": "callbackSelector",
        "type": "bytes4"
      }
    ],
    "name": "OracleRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "Paused",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "PendingTravelRuleCleared",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "ref",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "objectType",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "deadline",
        "type": "uint40"
      }
    ],
    "name": "PendingTravelRuleSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "receivingIssuer",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "setBy",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "timestamp",
        "type": "uint40"
      }
    ],
    "name": "ReceivingIssuerSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldWallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newWallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "RecoveryBalanceMigrated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "domain",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "objectId",
        "type": "bytes32"
      }
    ],
    "name": "RecoveryBulkItemHeld",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "action",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amountReturned",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "replayed",
        "type": "bool"
      }
    ],
    "name": "RecoveryCambioNoteResolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldWallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "cancelledBy",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "irreversible",
        "type": "bool"
      }
    ],
    "name": "RecoveryCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldWallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newWallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "completedAt",
        "type": "uint40"
      }
    ],
    "name": "RecoveryComplete",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "electionWindowEndsAt",
        "type": "uint40"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "emittedBy",
        "type": "address"
      }
    ],
    "name": "RecoveryElectionWindowExpired",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "choice",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amountMoved",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "replayed",
        "type": "bool"
      }
    ],
    "name": "RecoveryEnvelopeResolved",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldWallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "recoveryType",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "initiatedAt",
        "type": "uint40"
      }
    ],
    "name": "RecoveryInitiated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bankWallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "standbyWallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "setBy",
        "type": "address"
      }
    ],
    "name": "RecoveryStandbySet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "family",
        "type": "bytes32"
      }
    ],
    "name": "RecoveryStateMigrated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newWallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "designatedBy",
        "type": "address"
      }
    ],
    "name": "RecoverySuccessorDesignated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldNewWallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newNewWallet",
        "type": "address"
      }
    ],
    "name": "RecoverySuccessorRedirected",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "timelockEndsAt",
        "type": "uint40"
      }
    ],
    "name": "RecoveryTimelockStarted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "reasonHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "expiresAt",
        "type": "uint40"
      }
    ],
    "name": "RelayerFallbackDeclared",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "newExpiry",
        "type": "uint40"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "extendedBy",
        "type": "address"
      }
    ],
    "name": "RelayerFallbackExtended",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "revokedBy",
        "type": "address"
      }
    ],
    "name": "RelayerFallbackRevoked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "previousAdminRole",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "newAdminRole",
        "type": "bytes32"
      }
    ],
    "name": "RoleAdminChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "RoleGranted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "RoleRevoked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "ruleSetVersion",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "scopeKey",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "score",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "action",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes4",
        "name": "selector",
        "type": "bytes4"
      }
    ],
    "name": "RuleEvaluated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "scopeKey",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "version",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "effectiveFrom",
        "type": "uint256"
      }
    ],
    "name": "RuleSetUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "scopeKey",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "uint8",
        "name": "ruleId",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "weight",
        "type": "uint16"
      }
    ],
    "name": "RuleWeightUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint16",
        "name": "epochId",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "saltHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "activatedAt",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "transitionWindow",
        "type": "uint256"
      }
    ],
    "name": "SaltEpochCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint16",
        "name": "epochId",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "expiredAt",
        "type": "uint256"
      }
    ],
    "name": "SaltEpochExpired",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "grantedBy",
        "type": "address"
      }
    ],
    "name": "ScopedRoleGranted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "revokedBy",
        "type": "address"
      }
    ],
    "name": "ScopedRoleRevoked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "status",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "listVersionHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "attestor",
        "type": "address"
      }
    ],
    "name": "ScopedWalletScreened",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "attestor",
        "type": "address"
      }
    ],
    "name": "ScreeningBlocked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "secs",
        "type": "uint40"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "admin",
        "type": "address"
      }
    ],
    "name": "ScreeningStaleAfterSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "institution",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "netAmount",
        "type": "uint256"
      }
    ],
    "name": "SettlementCycleConfirmed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "exceptionRoot",
        "type": "bytes32"
      }
    ],
    "name": "SettlementCycleFailed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "finalizedAt",
        "type": "uint40"
      }
    ],
    "name": "SettlementCycleFinalized",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "fundingIssuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "settlementAsset",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "SettlementCycleFunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "cycleType",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "openedAt",
        "type": "uint40"
      }
    ],
    "name": "SettlementCycleOpened",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "obligationRoot",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint40",
        "name": "confirmationDeadline",
        "type": "uint40"
      }
    ],
    "name": "SettlementCycleProposed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "admin",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "SettlementModelActiveSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "obligationId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "outgoingIssuer",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "receivingIssuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "SettlementObligationRecorded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "cancelledBy",
        "type": "address"
      }
    ],
    "name": "SmartLockEnvelopeCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "releaseAuthorizedAddress",
        "type": "address"
      }
    ],
    "name": "SmartLockEnvelopeCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "releasedBy",
        "type": "address"
      }
    ],
    "name": "SmartLockEnvelopeReleased",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "sponsorBank",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "timestamp",
        "type": "uint256"
      }
    ],
    "name": "SponsorBankEndorsed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bankAddress",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "identifier",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "feeRate",
        "type": "uint256"
      }
    ],
    "name": "SponsorBankRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "bankAddress",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      }
    ],
    "name": "SponsorBankStatusUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "bool",
        "name": "allSystemsOperational",
        "type": "bool"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "validationTimestamp",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string[]",
        "name": "failedChecks",
        "type": "string[]"
      }
    ],
    "name": "SystemRecoveryValidated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "minter",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "TokensMinted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "Transfer",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "ref",
        "type": "bytes32"
      }
    ],
    "name": "TravelRuleAttached",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldTreasury",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newTreasury",
        "type": "address"
      }
    ],
    "name": "TreasuryAddressUpdated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "Unpaused",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "enum InstitutionStorage.WalletAffiliationStatus",
        "name": "newStatus",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "changedBy",
        "type": "address"
      }
    ],
    "name": "WalletAffiliationStatusChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "institution",
        "type": "address"
      }
    ],
    "name": "WalletInstitutionSet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "linkedBy",
        "type": "address"
      }
    ],
    "name": "WalletLinked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "clearedBy",
        "type": "address"
      }
    ],
    "name": "WalletPolicyCleared",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "setBy",
        "type": "address"
      }
    ],
    "name": "WalletPolicySet",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "custodian",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "kycValidatedTimestamp",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "kycExpiresTimestamp",
        "type": "uint256"
      }
    ],
    "name": "WalletRegistered",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "status",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "listVersionHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "attestor",
        "type": "address"
      }
    ],
    "name": "WalletScreened",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "unlinkedBy",
        "type": "address"
      }
    ],
    "name": "WalletUnlinked",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "custodian",
        "type": "address"
      }
    ],
    "name": "WalletUnregistered",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "_threatLevel",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "_reason",
        "type": "string"
      }
    ],
    "name": "activateCoordinatedEmergencyMode",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "offset",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
      }
    ],
    "name": "activeComplianceHolds",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "keys",
        "type": "bytes32[]"
      },
      {
        "internalType": "uint256",
        "name": "total",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "activeScopeCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "int256",
        "name": "delta",
        "type": "int256"
      }
    ],
    "name": "adjustDepositBalance",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ADMIN_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "advanceCambioPhase",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      }
    ],
    "name": "allowance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32[]",
        "name": "envelopeIds",
        "type": "bytes32[]"
      }
    ],
    "name": "applyBulkPolicy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "spender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "approve",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "BANK_REPRESENTATIVE_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tinHash",
        "type": "bytes32"
      },
      {
        "internalType": "address[]",
        "name": "destinationBanks",
        "type": "address[]"
      }
    ],
    "name": "batchCheckDepositorConflicts",
    "outputs": [
      {
        "internalType": "bool[]",
        "name": "conflicts",
        "type": "bool[]"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32[]",
        "name": "tinHashes",
        "type": "bytes32[]"
      }
    ],
    "name": "batchRemoveDepositorHashes",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32[]",
        "name": "tinHashes",
        "type": "bytes32[]"
      }
    ],
    "name": "batchSubmitDepositorHashes",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "data",
        "type": "bytes"
      },
      {
        "internalType": "bytes32[]",
        "name": "allowProof",
        "type": "bytes32[]"
      },
      {
        "internalType": "bytes32[]",
        "name": "denyProof",
        "type": "bytes32[]"
      }
    ],
    "name": "beforeTransferCheck",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "score",
        "type": "uint16"
      },
      {
        "internalType": "uint8",
        "name": "action",
        "type": "uint8"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "burn",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "BURNER_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "burnForConsortiumBank",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "burnFrom",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "CANCEL_OOB_THRESHOLD_USD",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      }
    ],
    "name": "cancelCommit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      }
    ],
    "name": "cancelEnvelopeNote",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "name": "cancelRecovery",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "reservationId",
        "type": "bytes32"
      }
    ],
    "name": "cancelReservation",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "cancelSmartLockEnvelope",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      }
    ],
    "name": "challengeSettlementCycle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tinHash",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "destinationBank",
        "type": "address"
      }
    ],
    "name": "checkDepositorConflict",
    "outputs": [
      {
        "internalType": "bool",
        "name": "exists",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "checkEmergencyStateConsistency",
    "outputs": [
      {
        "internalType": "bool",
        "name": "isConsistent",
        "type": "bool"
      },
      {
        "internalType": "bool[3]",
        "name": "states",
        "type": "bool[3]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "CIP_ENFORCE_ACTIVE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "cipScopeCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "clawbackSettlement",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "address[]",
        "name": "wallets",
        "type": "address[]"
      }
    ],
    "name": "clearDefunctInstitutionBlocks",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      }
    ],
    "name": "clearExpiredCommit",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32[]",
        "name": "commitmentHashes",
        "type": "bytes32[]"
      }
    ],
    "name": "clearExpiredCommits",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      }
    ],
    "name": "clearInstitutionPolicy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "reasonHash",
        "type": "bytes32"
      }
    ],
    "name": "clearNetworkBlock",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "clearPendingTravelRule",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      }
    ],
    "name": "clearWalletPolicy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "commitmentHash",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "expiresAt",
        "type": "uint256"
      }
    ],
    "name": "commitRedemption",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "address[]",
        "name": "predecessors",
        "type": "address[]"
      }
    ],
    "name": "completeRecovery",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "complianceArmed",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "ctx",
        "type": "uint8"
      }
    ],
    "name": "complianceCheck",
    "outputs": [
      {
        "internalType": "bool",
        "name": "ok",
        "type": "bool"
      },
      {
        "internalType": "address",
        "name": "failingParty",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "reasonCode",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      },
      {
        "components": [
          {
            "internalType": "address",
            "name": "tokenAddress",
            "type": "address"
          },
          {
            "internalType": "uint8",
            "name": "decimals",
            "type": "uint8"
          },
          {
            "internalType": "uint256",
            "name": "collateralFactorBps",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "haircutBps",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxBankExposure",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          }
        ],
        "internalType": "struct ConsortiumStorage.AssetTypeConfig",
        "name": "config",
        "type": "tuple"
      }
    ],
    "name": "configureAssetType",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "treasuryWallet",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "collateralVault",
        "type": "address"
      }
    ],
    "name": "configureBankWallet",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "confirmFiatDelivery",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      }
    ],
    "name": "confirmSettlementCycle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "CONSORTIUM_AUDITOR_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "CONSORTIUM_MEMBER_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "phraseCommitment",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "noteSalt",
        "type": "bytes32"
      },
      {
        "internalType": "uint48",
        "name": "deadline",
        "type": "uint48"
      },
      {
        "internalType": "string",
        "name": "metadata",
        "type": "string"
      }
    ],
    "name": "createCambioNote",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "parentEnvelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint40",
        "name": "commitWindowEnd",
        "type": "uint40"
      }
    ],
    "name": "createChildEnvelope",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "childEnvelopeId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint40",
        "name": "commitWindowEnd",
        "type": "uint40"
      },
      {
        "internalType": "uint8",
        "name": "settlementType",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "expirationBehavior",
        "type": "uint8"
      },
      {
        "internalType": "bytes",
        "name": "conditionData",
        "type": "bytes"
      }
    ],
    "name": "createEnvelope",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "hashCommitment",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "nonce",
        "type": "bytes32"
      },
      {
        "internalType": "uint40",
        "name": "commitWindowEnd",
        "type": "uint40"
      },
      {
        "internalType": "address",
        "name": "releaseAuthorizedAddress",
        "type": "address"
      }
    ],
    "name": "createSmartLockEnvelope",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "CUSTODIAN_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "custodianAtIndex",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "custodianCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "_reason",
        "type": "string"
      }
    ],
    "name": "deactivateCoordinatedEmergencyMode",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "deactivateIssuer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "debugGetReentrancyMutex",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "reasonHash",
        "type": "bytes32"
      }
    ],
    "name": "declareRelayerFallback",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DEFAULT_ADMIN_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DEPOSIT_TOKEN_ISSUER_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "newWallet",
        "type": "address"
      }
    ],
    "name": "designateSuccessor",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "facetAddress",
            "type": "address"
          },
          {
            "internalType": "enum IDiamondCut.FacetCutAction",
            "name": "action",
            "type": "uint8"
          },
          {
            "internalType": "bytes4[]",
            "name": "functionSelectors",
            "type": "bytes4[]"
          }
        ],
        "internalType": "struct IDiamondCut.FacetCut[]",
        "name": "_diamondCut",
        "type": "tuple[]"
      },
      {
        "internalType": "address",
        "name": "_init",
        "type": "address"
      },
      {
        "internalType": "bytes",
        "name": "_calldata",
        "type": "bytes"
      }
    ],
    "name": "diamondCut",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DUAL_APPROVAL_THRESHOLD_USD",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "EMERGENCY_COORDINATOR_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "_storageSystem",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "_reason",
        "type": "string"
      }
    ],
    "name": "emergencyPauseStorageSystem",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "_storageSystem",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "_reason",
        "type": "string"
      }
    ],
    "name": "emergencyResumeStorageSystem",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "newSaltHash",
        "type": "bytes32"
      }
    ],
    "name": "emergencySaltCompromise",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "name": "emitElectionWindowExpired",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "endorseNonBankIssuer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "ctx",
        "type": "uint8"
      }
    ],
    "name": "enforceCompliance",
    "outputs": [],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amountIntendedForRecipient",
        "type": "uint256"
      }
    ],
    "name": "estimateTransferFeeDetails",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "requestedAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "baseFeeAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "senderRiskScore",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "recipientRiskScore",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "applicableRiskScore",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountRiskScaler",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "scaledRiskImpactBps",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "finalRiskFactorBps",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "feeBeforeCreditsAndBounds",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "availableCredits",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "creditsToApply",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "feeAfterCredits",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxFeeBound",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "minFeeBound",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "maxFeeApplied",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "minFeeApplied",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "totalFeeAssessed",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "netAmountToSendToRecipient",
            "type": "uint256"
          }
        ],
        "internalType": "struct StorageLib.FeeDetails",
        "name": "details_",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes",
        "name": "data",
        "type": "bytes"
      },
      {
        "internalType": "bytes32[]",
        "name": "allowProof",
        "type": "bytes32[]"
      },
      {
        "internalType": "bytes32[]",
        "name": "denyProof",
        "type": "bytes32[]"
      }
    ],
    "name": "evaluateRulesPreview",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "totalScore",
        "type": "uint16"
      },
      {
        "internalType": "uint8",
        "name": "action",
        "type": "uint8"
      },
      {
        "internalType": "uint8[]",
        "name": "hits",
        "type": "uint8[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "reservationId",
        "type": "bytes32"
      }
    ],
    "name": "executeIssuance",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "reservationId",
        "type": "bytes32"
      }
    ],
    "name": "expireReservation",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "epochId",
        "type": "uint16"
      }
    ],
    "name": "expireSaltEpoch",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint40",
        "name": "newExpiry",
        "type": "uint40"
      }
    ],
    "name": "extendFallbackDeclaration",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes4",
        "name": "_functionSelector",
        "type": "bytes4"
      }
    ],
    "name": "facetAddress",
    "outputs": [
      {
        "internalType": "address",
        "name": "facetAddress_",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "facetAddresses",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "facetAddresses_",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_facet",
        "type": "address"
      }
    ],
    "name": "facetFunctionSelectors",
    "outputs": [
      {
        "internalType": "bytes4[]",
        "name": "facetFunctionSelectors_",
        "type": "bytes4[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "facets",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "facetAddress",
            "type": "address"
          },
          {
            "internalType": "bytes4[]",
            "name": "functionSelectors",
            "type": "bytes4[]"
          }
        ],
        "internalType": "struct IDiamondLoupe.Facet[]",
        "name": "facets_",
        "type": "tuple[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "exceptionRoot",
        "type": "bytes32"
      }
    ],
    "name": "failSettlementCycle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "FEE_EXEMPT_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "finalizeEnvelope",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      }
    ],
    "name": "finalizeSettlementCycle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "flagAbnormalTransaction",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "targetState",
        "type": "bool"
      },
      {
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "forceEmergencyStateSynchronization",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "generateConsortiumComplianceReport",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "reportId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getAllSponsorBanks",
    "outputs": [
      {
        "internalType": "address[]",
        "name": "banks",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getAllSupportedInterfaces",
    "outputs": [
      {
        "internalType": "bytes4[]",
        "name": "",
        "type": "bytes4[]"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      }
    ],
    "name": "getAssetType",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "tokenAddress",
            "type": "address"
          },
          {
            "internalType": "uint8",
            "name": "decimals",
            "type": "uint8"
          },
          {
            "internalType": "uint256",
            "name": "collateralFactorBps",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "haircutBps",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxBankExposure",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          }
        ],
        "internalType": "struct ConsortiumStorage.AssetTypeConfig",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "getAvailableReserve",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getBankCollateralFactor",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getBankComplianceMetrics",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "lastInterbankCheckAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "rollingInterbankVolume",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "unresolvedAlerts",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "lastReportAt",
            "type": "uint256"
          }
        ],
        "internalType": "struct ConsortiumStorage.BankComplianceMetrics",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getBankDailyCap",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getBankMigrationStatus",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "currentEpochCount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "oldEpochCount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "lastUpdated",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getBankProfile",
    "outputs": [
      {
        "components": [
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "address",
            "name": "primarySigner",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "maxCollateralLimit",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "riskRating",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "joinedAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "lastActivity",
            "type": "uint256"
          }
        ],
        "internalType": "struct ConsortiumStorage.BankProfile",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      }
    ],
    "name": "getBankWallet",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "treasuryWallet",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "collateralVault",
            "type": "address"
          }
        ],
        "internalType": "struct ConsortiumStorage.WalletConfig",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getCambioConfig",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "maxNoteValue",
        "type": "uint256"
      },
      {
        "internalType": "uint48",
        "name": "minDeadlineBuffer",
        "type": "uint48"
      },
      {
        "internalType": "uint48",
        "name": "maxDeadlineWindow",
        "type": "uint48"
      },
      {
        "internalType": "uint32",
        "name": "maxMetadataLength",
        "type": "uint32"
      },
      {
        "internalType": "bool",
        "name": "cambioPaused",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getCambioEnvelopeConfig",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "maxNoteValue",
        "type": "uint256"
      },
      {
        "internalType": "uint48",
        "name": "minDeadlineBuffer",
        "type": "uint48"
      },
      {
        "internalType": "uint48",
        "name": "maxDeadlineWindow",
        "type": "uint48"
      },
      {
        "internalType": "uint32",
        "name": "maxMetadataLength",
        "type": "uint32"
      },
      {
        "internalType": "uint256",
        "name": "commitRevealThreshold",
        "type": "uint256"
      },
      {
        "internalType": "uint48",
        "name": "maxCommitLifetime",
        "type": "uint48"
      },
      {
        "internalType": "bool",
        "name": "cambioPaused",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      }
    ],
    "name": "getCambioEnvelopeNote",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "issuer",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "escrowedAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "spent",
            "type": "uint256"
          },
          {
            "internalType": "uint48",
            "name": "createdAt",
            "type": "uint48"
          },
          {
            "internalType": "uint48",
            "name": "deadline",
            "type": "uint48"
          },
          {
            "internalType": "bool",
            "name": "active",
            "type": "bool"
          },
          {
            "internalType": "bytes32",
            "name": "phraseCommitment",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "noteSalt",
            "type": "bytes32"
          },
          {
            "internalType": "bool",
            "name": "openRedemptionSnapshot",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "requiresCommitReveal",
            "type": "bool"
          }
        ],
        "internalType": "struct CambioEnvelopeStorage.CambioEnvelopeNote",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getCambioEnvelopePhase",
    "outputs": [
      {
        "internalType": "enum CambioEnvelopeStorage.CambioEnvelopePhase",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "receiptId",
        "type": "bytes32"
      }
    ],
    "name": "getCambioEnvelopeReceipt",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "noteId",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "issuer",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "redeemer",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "uint48",
            "name": "timestamp",
            "type": "uint48"
          },
          {
            "internalType": "bytes32",
            "name": "metadataHash",
            "type": "bytes32"
          }
        ],
        "internalType": "struct CambioEnvelopeStorage.CambioEnvelopeReceipt",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      }
    ],
    "name": "getCambioEnvelopeReceiptsForNote",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "parentEnvelopeId",
        "type": "bytes32"
      }
    ],
    "name": "getChildEnvelopes",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getCIP",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "cipCompletedAt",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "cipRecordHash",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      }
    ],
    "name": "getCollateralPosition",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "pledgedAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "yieldAccrued",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "lastUpdated",
            "type": "uint256"
          }
        ],
        "internalType": "struct ConsortiumStorage.CollateralPosition",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "domain",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "objectId",
        "type": "bytes32"
      }
    ],
    "name": "getComplianceHold",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "domain",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "objectId",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "originalPayee",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "resolvedPayee",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "failingParty",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "reasonCode",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "recoveryId",
            "type": "bytes32"
          },
          {
            "internalType": "uint8",
            "name": "priorState",
            "type": "uint8"
          },
          {
            "internalType": "uint8",
            "name": "requestedAction",
            "type": "uint8"
          },
          {
            "internalType": "uint8",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint8",
            "name": "disposition",
            "type": "uint8"
          },
          {
            "internalType": "address",
            "name": "resolvedBy",
            "type": "address"
          },
          {
            "internalType": "uint40",
            "name": "heldAt",
            "type": "uint40"
          },
          {
            "internalType": "uint40",
            "name": "resolvedAt",
            "type": "uint40"
          }
        ],
        "internalType": "struct ComplianceHoldStorage.HoldRecord",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getComprehensiveEmergencyStatus",
    "outputs": [
      {
        "internalType": "bool[3]",
        "name": "emergencyStatus",
        "type": "bool[3]"
      },
      {
        "internalType": "uint8",
        "name": "threatLevel",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "lastUpdate",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getCurrentCycleId",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getCurrentSaltEpoch",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      }
    ],
    "name": "getCustodian",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getCycleLien",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      }
    ],
    "name": "getDailyPair",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "day",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "sum",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getDailyRemaining",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getDefaultFallbackWindow",
    "outputs": [
      {
        "internalType": "uint40",
        "name": "",
        "type": "uint40"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getDepositAccount",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "totalDeposits",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "totalMinted",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "totalBurned",
            "type": "uint256"
          }
        ],
        "internalType": "struct ConsortiumStorage.DepositTokenAccount",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getDepositorHashCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "getDispute",
    "outputs": [
      {
        "internalType": "address",
        "name": "raisedBy",
        "type": "address"
      },
      {
        "internalType": "uint40",
        "name": "raisedAt",
        "type": "uint40"
      },
      {
        "internalType": "uint40",
        "name": "timeoutAt",
        "type": "uint40"
      },
      {
        "internalType": "bytes32",
        "name": "reasonHash",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "resolved",
        "type": "bool"
      },
      {
        "internalType": "uint8",
        "name": "outcome",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      }
    ],
    "name": "getEffectivePolicy",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "source",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "getEffectiveReserve",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getEmergencyGuardian",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getEmergencyStatus",
    "outputs": [
      {
        "internalType": "bool",
        "name": "appStatus",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "sponsorStatus",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "investmentStatus",
        "type": "bool"
      },
      {
        "internalType": "uint8",
        "name": "threatLevel",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "getEnvelope",
    "outputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint40",
        "name": "commitWindowEnd",
        "type": "uint40"
      },
      {
        "internalType": "uint8",
        "name": "settlementType",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "expirationBehavior",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "state",
        "type": "uint8"
      },
      {
        "internalType": "uint40",
        "name": "createdAt",
        "type": "uint40"
      },
      {
        "internalType": "uint256",
        "name": "reversedAmount",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "getEnvelopeOverride",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "storedOverride",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      }
    ],
    "name": "getEnvelopesByRecipient",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "envelopeIds",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "getEnvelopesBySender",
    "outputs": [
      {
        "internalType": "bytes32[]",
        "name": "envelopeIds",
        "type": "bytes32[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getFallbackDeclaration",
    "outputs": [
      {
        "internalType": "uint40",
        "name": "activatedAt",
        "type": "uint40"
      },
      {
        "internalType": "uint40",
        "name": "expiresAt",
        "type": "uint40"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getFeeParameters",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "minWei",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxBps",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "baseRiskBps",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxRiskBps",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getFeeSchedule",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "baseFee",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "perRuleSurcharge",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "surchargeCap",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getFeeTierRates",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getFeeTiers",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "thresholds",
        "type": "uint256[]"
      },
      {
        "internalType": "uint256[]",
        "name": "ratesBps",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getFeeTierThresholds",
    "outputs": [
      {
        "internalType": "uint256[]",
        "name": "",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getGlobalParameters",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "minDistributionAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxBatchSize",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "globalKYCFeeRate",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "emergencyPaused",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getGlobalStatistics",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "totalHashes",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "totalChecks",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "bankCount",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getHalfLifeParameters",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "current",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "min",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "max",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "getIncentiveCredits",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "lastUpdated",
            "type": "uint256"
          }
        ],
        "internalType": "struct StorageLib.IncentiveCredits",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "name": "getInstitution",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "bytes32",
            "name": "metadataHash",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "metadataURI",
            "type": "string"
          },
          {
            "internalType": "enum InstitutionStorage.InstitutionStatus",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "address",
            "name": "adminAddress",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "registeredAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "updatedAt",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "registeredBy",
            "type": "address"
          }
        ],
        "internalType": "struct InstitutionStorage.Institution",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "getInstitutionAtIndex",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getInstitutionCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "institution",
        "type": "address"
      }
    ],
    "name": "getInstitutionMode",
    "outputs": [
      {
        "internalType": "enum InstitutionLifecycleStorage.InstitutionMode",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      }
    ],
    "name": "getInstitutionPolicyValue",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isExplicitlySet",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getInterfacesByCategory",
    "outputs": [
      {
        "internalType": "bytes4[]",
        "name": "core",
        "type": "bytes4[]"
      },
      {
        "internalType": "bytes4[]",
        "name": "token",
        "type": "bytes4[]"
      },
      {
        "internalType": "bytes4[]",
        "name": "banking",
        "type": "bytes4[]"
      },
      {
        "internalType": "bytes4[]",
        "name": "investment",
        "type": "bytes4[]"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "getIssuerAttributedOutstanding",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "getIssuerCeilingBuckets",
    "outputs": [
      {
        "internalType": "uint256[24]",
        "name": "buckets",
        "type": "uint256[24]"
      },
      {
        "internalType": "uint256",
        "name": "lastUpdatedHour",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "getIssuerEnvelopeProfile",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "sponsorBank",
            "type": "address"
          },
          {
            "internalType": "bool",
            "name": "isActive",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "openRedemption",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "registeredAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxOutstandingNoteCount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxOutstandingNoteValue",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "dailyRedemptionCeiling",
            "type": "uint256"
          },
          {
            "internalType": "enum CambioEnvelopeStorage.PauseState",
            "name": "pauseState",
            "type": "uint8"
          },
          {
            "internalType": "uint256",
            "name": "notesIssued",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "notesOutstanding",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "t3usdEscrowed",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "t3usdRedeemed",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "t3usdCancelled",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "valueOutstanding",
            "type": "uint256"
          }
        ],
        "internalType": "struct CambioEnvelopeStorage.IssuerEnvelopeProfile",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "getIssuerFloor",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "getIssuerProfile",
    "outputs": [
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "openRedemption",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "registeredAt",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      }
    ],
    "name": "getKYCTimestamps",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "validatedTimestamp",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "expiresTimestamp",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getLastUpdateTimestamp",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getLatestConsortiumReport",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "generatedAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "totalDeposits",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "outstandingLiabilities",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "activeBankCount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "totalInterbankVolume",
            "type": "uint256"
          }
        ],
        "internalType": "struct ConsortiumStorage.ConsortiumReport",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getMerkleRoots",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "allowRoot",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "denyRoot",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "minter",
        "type": "address"
      }
    ],
    "name": "getMintedByMinter",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getNetworkClearance",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint40",
            "name": "clearedAt",
            "type": "uint40"
          },
          {
            "internalType": "address",
            "name": "clearedBy",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "reasonHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint8",
            "name": "previousStatus",
            "type": "uint8"
          }
        ],
        "internalType": "struct ScreeningStorage.NetworkClearance",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      }
    ],
    "name": "getNetworkPolicy",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getObservationConfig",
    "outputs": [
      {
        "internalType": "bool",
        "name": "observationMode",
        "type": "bool"
      },
      {
        "internalType": "uint16",
        "name": "warnAt",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "denyAt",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "getOracleBinding",
    "outputs": [
      {
        "internalType": "address",
        "name": "oracleAddress",
        "type": "address"
      },
      {
        "internalType": "bytes4",
        "name": "callbackSelector",
        "type": "bytes4"
      },
      {
        "internalType": "bool",
        "name": "callbackReceived",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "callbackResult",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getOutflow",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "windowStart",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "sum",
        "type": "uint256"
      },
      {
        "internalType": "uint48",
        "name": "windowSecs",
        "type": "uint48"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "a",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "b",
        "type": "address"
      }
    ],
    "name": "getPairNet",
    "outputs": [
      {
        "internalType": "int256",
        "name": "",
        "type": "int256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "childEnvelopeId",
        "type": "bytes32"
      }
    ],
    "name": "getParentEnvelope",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sponsorBank",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "getPendingEndorsement",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "getPendingTravelRule",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "ref",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "uint8",
            "name": "objectType",
            "type": "uint8"
          },
          {
            "internalType": "uint40",
            "name": "deadline",
            "type": "uint40"
          }
        ],
        "internalType": "struct TravelRuleStorage.PendingTravelRule",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "name": "getRecovery",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "id",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "oldWallet",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "newWallet",
        "type": "address"
      },
      {
        "internalType": "uint8",
        "name": "recoveryType",
        "type": "uint8"
      },
      {
        "internalType": "uint8",
        "name": "state",
        "type": "uint8"
      },
      {
        "internalType": "uint40",
        "name": "initiatedAt",
        "type": "uint40"
      },
      {
        "internalType": "uint40",
        "name": "electionWindowEndsAt",
        "type": "uint40"
      },
      {
        "internalType": "uint40",
        "name": "timelockEndsAt",
        "type": "uint40"
      },
      {
        "internalType": "uint256",
        "name": "envelopesResolved",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "cambioNotesResolved",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "name": "getRecoveryPolicy",
    "outputs": [
      {
        "components": [
          {
            "internalType": "enum IWalletRecovery.EnvelopeRecoveryChoice",
            "name": "senderDefault",
            "type": "uint8"
          },
          {
            "internalType": "enum IWalletRecovery.EnvelopeRecoveryChoice",
            "name": "recipientDefault",
            "type": "uint8"
          },
          {
            "internalType": "enum IWalletRecovery.EnvelopeRecoveryChoice",
            "name": "disputedDefault",
            "type": "uint8"
          },
          {
            "internalType": "enum IWalletRecovery.EnvelopeRecoveryChoice",
            "name": "pendingFiatDefault",
            "type": "uint8"
          }
        ],
        "internalType": "struct IWalletRecovery.RecoveryPolicy",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bankWallet",
        "type": "address"
      }
    ],
    "name": "getRecoveryStandby",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "getReimbursementEncumbered",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "reservationId",
        "type": "bytes32"
      }
    ],
    "name": "getReservation",
    "outputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint40",
        "name": "expiry",
        "type": "uint40"
      },
      {
        "internalType": "uint8",
        "name": "state",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "getReservedTotal",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      }
    ],
    "name": "getReservePosition",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "settledQuantity",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "pendingQuantity",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "custodySettledAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "encumberedQuantity",
            "type": "uint256"
          }
        ],
        "internalType": "struct ReserveControlStorage.ReservePosition",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getResolvedCIP",
    "outputs": [
      {
        "internalType": "address",
        "name": "resolvedWallet",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "cipCompletedAt",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "cipRecordHash",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      }
    ],
    "name": "getResolvedEffectivePolicy",
    "outputs": [
      {
        "internalType": "address",
        "name": "resolvedWallet",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "source",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getResolvedScopedScreening",
    "outputs": [
      {
        "internalType": "address",
        "name": "resolvedWallet",
        "type": "address"
      },
      {
        "components": [
          {
            "internalType": "uint8",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint40",
            "name": "lastScreenedAt",
            "type": "uint40"
          },
          {
            "internalType": "bytes32",
            "name": "listVersionHash",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "attestor",
            "type": "address"
          }
        ],
        "internalType": "struct ScreeningStorage.Screening",
        "name": "screening",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getResolvedScreening",
    "outputs": [
      {
        "internalType": "address",
        "name": "resolvedWallet",
        "type": "address"
      },
      {
        "components": [
          {
            "internalType": "uint8",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint40",
            "name": "lastScreenedAt",
            "type": "uint40"
          },
          {
            "internalType": "bytes32",
            "name": "listVersionHash",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "attestor",
            "type": "address"
          }
        ],
        "internalType": "struct ScreeningStorage.Screening",
        "name": "screening",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getResolvedWalletAffiliation",
    "outputs": [
      {
        "internalType": "address",
        "name": "resolvedWallet",
        "type": "address"
      },
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "institutionId",
            "type": "bytes32"
          },
          {
            "internalType": "enum InstitutionStorage.WalletAffiliationStatus",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint256",
            "name": "affiliatedAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "updatedAt",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "updatedBy",
            "type": "address"
          }
        ],
        "internalType": "struct InstitutionStorage.WalletAffiliation",
        "name": "affiliation",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      }
    ],
    "name": "getRoleAdmin",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "scopeKey",
        "type": "bytes32"
      }
    ],
    "name": "getRuleSet",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "enabledBits",
            "type": "uint256"
          },
          {
            "internalType": "uint16",
            "name": "warnThreshold",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "blockThreshold",
            "type": "uint16"
          },
          {
            "internalType": "uint48",
            "name": "velocityWindowSecs",
            "type": "uint48"
          },
          {
            "internalType": "uint256",
            "name": "maxAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxOutflowAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxPerRecipientDaily",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxEvalCount",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "restrictContracts",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "extendCommitOnWarn",
            "type": "bool"
          },
          {
            "internalType": "uint48",
            "name": "warnExtendSeconds",
            "type": "uint48"
          },
          {
            "internalType": "bool",
            "name": "requireKyc",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "kycAmountThreshold",
            "type": "uint256"
          },
          {
            "internalType": "uint48",
            "name": "kycSoonSeconds",
            "type": "uint48"
          },
          {
            "internalType": "uint256",
            "name": "createdAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "effectiveFrom",
            "type": "uint256"
          }
        ],
        "internalType": "struct RulesStorageLib.RuleSet",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "scopeKey",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "ruleId",
        "type": "uint8"
      }
    ],
    "name": "getRuleWeight",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint16",
        "name": "epochId",
        "type": "uint16"
      }
    ],
    "name": "getSaltEpochInfo",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "saltHash",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "activatedAt",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "expiresAt",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getScopedScreening",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint8",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint40",
            "name": "lastScreenedAt",
            "type": "uint40"
          },
          {
            "internalType": "bytes32",
            "name": "listVersionHash",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "attestor",
            "type": "address"
          }
        ],
        "internalType": "struct ScreeningStorage.Screening",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getScreening",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint8",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint40",
            "name": "lastScreenedAt",
            "type": "uint40"
          },
          {
            "internalType": "bytes32",
            "name": "listVersionHash",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "attestor",
            "type": "address"
          }
        ],
        "internalType": "struct ScreeningStorage.Screening",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      }
    ],
    "name": "getSettlementCycle",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint8",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint8",
            "name": "cycleType",
            "type": "uint8"
          },
          {
            "internalType": "uint40",
            "name": "openedAt",
            "type": "uint40"
          },
          {
            "internalType": "uint40",
            "name": "proposalDeadline",
            "type": "uint40"
          },
          {
            "internalType": "uint40",
            "name": "confirmationDeadline",
            "type": "uint40"
          },
          {
            "internalType": "uint40",
            "name": "fundingDeadline",
            "type": "uint40"
          },
          {
            "internalType": "uint40",
            "name": "challengeDeadline",
            "type": "uint40"
          },
          {
            "internalType": "bytes32",
            "name": "obligationRoot",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "exceptionRoot",
            "type": "bytes32"
          }
        ],
        "internalType": "struct ISettlementCycle.SettlementCycle",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "obligationId",
        "type": "bytes32"
      }
    ],
    "name": "getSettlementObligation",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "outgoingIssuer",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "receivingIssuer",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "senderInstitution",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "recipientInstitution",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "cycleId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "sourceTransferId",
            "type": "bytes32"
          },
          {
            "internalType": "uint8",
            "name": "status",
            "type": "uint8"
          }
        ],
        "internalType": "struct ISettlementCycle.SettlementObligation",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "getSmartLockCondition",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "hashCommitment",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "nonce",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "releaseAuthorizedAddress",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bankAddress",
        "type": "address"
      }
    ],
    "name": "getSponsorBankInfo",
    "outputs": [
      {
        "internalType": "address",
        "name": "bankAddr",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "identifier",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "feeRate",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "isRegistered",
        "type": "bool"
      },
      {
        "internalType": "uint256",
        "name": "totalDistributions",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "totalVolume",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "registrationTime",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "totalFeeEarned",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getTotalAttributedOutstanding",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getTotalBanksCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "count",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "getTransferData",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "commitWindowEnd",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "halfLifeDuration",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "originator",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "transferCount",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "reversalHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "totalFeeAssessed",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "isReversed",
            "type": "bool"
          }
        ],
        "internalType": "struct StorageLib.TransferMetadata",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "getTravelRule",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "ref",
            "type": "bytes32"
          },
          {
            "internalType": "bool",
            "name": "satisfied",
            "type": "bool"
          },
          {
            "internalType": "uint40",
            "name": "attachedAt",
            "type": "uint40"
          }
        ],
        "internalType": "struct TravelRuleStorage.TravelRule",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getTreasuryAddress",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getTrustedForwarder",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getWalletAffiliation",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "institutionId",
            "type": "bytes32"
          },
          {
            "internalType": "enum InstitutionStorage.WalletAffiliationStatus",
            "name": "status",
            "type": "uint8"
          },
          {
            "internalType": "uint256",
            "name": "affiliatedAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "updatedAt",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "updatedBy",
            "type": "address"
          }
        ],
        "internalType": "struct InstitutionStorage.WalletAffiliation",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getWalletInstitution",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "getWalletInstitutionId",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      }
    ],
    "name": "getWalletPolicyValue",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isExplicitlySet",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "getWalletRiskProfile",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "reversalCount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "lastReversal",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "creationTime",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "abnormalTxCount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "riskScore",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "lastRiskUpdate",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "lastTransactionTime",
            "type": "uint256"
          }
        ],
        "internalType": "struct StorageLib.WalletRiskProfile",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "fiAddress",
        "type": "address"
      }
    ],
    "name": "grantCustodianRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "grantRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "name": "grantScopedRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "hasCIP",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "tinHash",
        "type": "bytes32"
      }
    ],
    "name": "hasDepositorHash",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "hasRole",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "name": "hasScopedRole",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "initializeClaimAttribution",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "initializeDefaultPolicies",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "uint8",
        "name": "recoveryType",
        "type": "uint8"
      }
    ],
    "name": "initiateRecovery",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "a",
        "type": "address"
      },
      {
        "internalType": "bytes32[]",
        "name": "allowProof",
        "type": "bytes32[]"
      },
      {
        "internalType": "bytes32[]",
        "name": "denyProof",
        "type": "bytes32[]"
      }
    ],
    "name": "isAddressAllowed",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isCapacityModelActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isCipEnforceActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isClaimAttributionInitialized",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "isCustodian",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      }
    ],
    "name": "isElectionWindowExpired",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "isEnvelopeResolved",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "isFallbackActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "name": "isInstitutionActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "name": "isInstitutionSanctionsEnabled",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isKycEnforceActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      }
    ],
    "name": "isKYCValid",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isLegacyMintUnlocked",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "operation",
        "type": "bytes32"
      }
    ],
    "name": "isOperationPaused",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "isResolvedScreeningBlocked",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "isScreeningBlocked",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isScreeningEnforceActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "isScreeningStale",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isSettlementModelActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "issuerEffectiveState",
    "outputs": [
      {
        "internalType": "enum CambioEnvelopeStorage.PauseState",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "isTravelRuleEnforceActive",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "forwarder",
        "type": "address"
      }
    ],
    "name": "isTrustedForwarder",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bankAddress",
        "type": "address"
      }
    ],
    "name": "isValidSponsorBank",
    "outputs": [
      {
        "internalType": "bool",
        "name": "isValid",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "name": "isWalletScopedInstitution",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "KYC_ENFORCE_ACTIVE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "kycScopeCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "name": "linkBankToInstitution",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "name": "linkWalletToInstitution",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MAX_HALFLIFE_ADJUSTMENTS",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "address[]",
        "name": "liabilityCounterparties",
        "type": "address[]"
      }
    ],
    "name": "migrateBalance",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256[]",
        "name": "assetTypes",
        "type": "uint256[]"
      },
      {
        "internalType": "address[]",
        "name": "tokens",
        "type": "address[]"
      }
    ],
    "name": "migrateConsortiumState",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "maxHashes",
        "type": "uint256"
      }
    ],
    "name": "migrateDepositorIdentityState",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32[]",
        "name": "institutionIds",
        "type": "bytes32[]"
      },
      {
        "internalType": "bytes32[]",
        "name": "scopes",
        "type": "bytes32[]"
      },
      {
        "internalType": "bytes32[]",
        "name": "policyIds",
        "type": "bytes32[]"
      }
    ],
    "name": "migrateInstitutionState",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "mint",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "MINTER_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "mintForConsortiumBank",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sendingBank",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "receivingBank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "normalizedAmount",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "memo",
        "type": "string"
      }
    ],
    "name": "monitorInterBankTransaction",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "msgSender",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "name",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "cycleType",
        "type": "uint8"
      }
    ],
    "name": "openSettlementCycle",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "ORACLE_ATTESTOR_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "choice",
        "type": "uint8"
      }
    ],
    "name": "overrideEnvelopeChoice",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "pauseCambio",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "paused",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "operation",
        "type": "bytes32"
      }
    ],
    "name": "pauseOperation",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32[]",
        "name": "operations",
        "type": "bytes32[]"
      }
    ],
    "name": "pauseOperations",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "PAUSER_ROLE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "performSystemHealthCheck",
    "outputs": [
      {
        "internalType": "bool",
        "name": "isHealthy",
        "type": "bool"
      },
      {
        "internalType": "string[]",
        "name": "failedChecks",
        "type": "string[]"
      },
      {
        "internalType": "uint256",
        "name": "checkTimestamp",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "pledgeCollateral",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "postTransferUpdate",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      }
    ],
    "name": "processExpiration",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "obligationRoot",
        "type": "bytes32"
      },
      {
        "internalType": "uint40",
        "name": "confirmationDeadline",
        "type": "uint40"
      }
    ],
    "name": "proposeAndRolloverSettlementCycle",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "nextCycleId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "obligationRoot",
        "type": "bytes32"
      },
      {
        "internalType": "uint40",
        "name": "confirmationDeadline",
        "type": "uint40"
      }
    ],
    "name": "proposeSettlementCycle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      },
      {
        "internalType": "bytes32[]",
        "name": "",
        "type": "bytes32[]"
      },
      {
        "internalType": "uint256",
        "name": "ruleChecksCount",
        "type": "uint256"
      }
    ],
    "name": "quoteFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "quoteIssuance",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes",
        "name": "reason",
        "type": "bytes"
      }
    ],
    "name": "raiseDispute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "realBalanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "result",
        "type": "bool"
      }
    ],
    "name": "receiveOracleCallback",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "cipRecordHash",
        "type": "bytes32"
      }
    ],
    "name": "recordCIP",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "debtor",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "creditor",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "settlementAsset",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "paymentRef",
        "type": "bytes32"
      },
      {
        "internalType": "uint40",
        "name": "challengeWindow",
        "type": "uint40"
      }
    ],
    "name": "recordFunding",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "minted",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "burned",
        "type": "uint256"
      }
    ],
    "name": "recordMintBurn",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "uint8",
        "name": "status",
        "type": "uint8"
      },
      {
        "internalType": "bytes32",
        "name": "listVersionHash",
        "type": "bytes32"
      }
    ],
    "name": "recordNetworkScreening",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "cycleId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "outgoingIssuer",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "receivingIssuer",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "senderInstitution",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "recipientInstitution",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "sourceTransferId",
        "type": "bytes32"
      }
    ],
    "name": "recordObligation",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "uint8",
        "name": "status",
        "type": "uint8"
      },
      {
        "internalType": "bytes32",
        "name": "listVersionHash",
        "type": "bytes32"
      }
    ],
    "name": "recordScopedScreening",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "uint8",
        "name": "status",
        "type": "uint8"
      },
      {
        "internalType": "bytes32",
        "name": "listVersionHash",
        "type": "bytes32"
      }
    ],
    "name": "recordScreening",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "metadata",
        "type": "string"
      }
    ],
    "name": "redeemByNoteId",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "phrase",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      },
      {
        "internalType": "string",
        "name": "metadata",
        "type": "string"
      }
    ],
    "name": "redeemByPhrase",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "newWallet",
        "type": "address"
      }
    ],
    "name": "redirectSuccessor",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      }
    ],
    "name": "registerAssetTypeForReserve",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "bankName",
        "type": "string"
      },
      {
        "internalType": "address",
        "name": "primarySigner",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "maxCollateralLimit",
        "type": "uint256"
      }
    ],
    "name": "registerBank",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "kycValidatedTimestamp",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "kycExpiresTimestamp",
        "type": "uint256"
      }
    ],
    "name": "registerCustodiedWallet",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "metadataURI",
        "type": "string"
      },
      {
        "internalType": "address",
        "name": "adminAddress",
        "type": "address"
      }
    ],
    "name": "registerInstitution",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "sponsorBank",
        "type": "address"
      }
    ],
    "name": "registerIssuer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "registerIssuer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "oracleAddress",
        "type": "address"
      },
      {
        "internalType": "bytes4",
        "name": "callbackSelector",
        "type": "bytes4"
      }
    ],
    "name": "registerOracle",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bankAddress",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "identifier",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "feeRate",
        "type": "uint256"
      }
    ],
    "name": "registerSponsorBank",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      }
    ],
    "name": "releaseCollateral",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "fragment",
        "type": "bytes32"
      }
    ],
    "name": "releaseSmartLockEnvelope",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tinHash",
        "type": "bytes32"
      }
    ],
    "name": "removeDepositorHash",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "renounceRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "reserveIssuance",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "resolveBankInstitution",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "recoveryId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32[]",
        "name": "noteIds",
        "type": "bytes32[]"
      },
      {
        "internalType": "uint8[]",
        "name": "actions",
        "type": "uint8[]"
      }
    ],
    "name": "resolveCambioNotesBulk",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "resolvedCount",
        "type": "uint256"
      }
    ],
    "name": "resolveComplianceAlert",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "domain",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "objectId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "outcome",
        "type": "uint8"
      },
      {
        "internalType": "address",
        "name": "alternatePayee",
        "type": "address"
      }
    ],
    "name": "resolveComplianceHold",
    "outputs": [
      {
        "internalType": "bool",
        "name": "released",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "outcome",
        "type": "uint8"
      },
      {
        "internalType": "uint256",
        "name": "splitAmount",
        "type": "uint256"
      }
    ],
    "name": "resolveDispute",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      }
    ],
    "name": "resolveEffectiveIssuer",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "name": "resolveInstitutionBank",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "_threatLevel",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "_reason",
        "type": "string"
      }
    ],
    "name": "respondToQuantumThreatLevel",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "operation",
        "type": "bytes32"
      }
    ],
    "name": "resumeOperation",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "noteId",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "phrase",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "nonce",
        "type": "uint256"
      }
    ],
    "name": "revealRedemption",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "reverseEnvelope",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "revokeCIP",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "fiAddress",
        "type": "address"
      }
    ],
    "name": "revokeCustodianRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      }
    ],
    "name": "revokeFallbackDeclaration",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "reasonCode",
        "type": "uint256"
      }
    ],
    "name": "revokeKYC",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "revokeOwnFallback",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "revokeRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "role",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      }
    ],
    "name": "revokeScopedRole",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "newAdmin",
        "type": "address"
      }
    ],
    "name": "rotateInstitutionAdmin",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "newSaltHash",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "transitionWindowSeconds",
        "type": "uint256"
      }
    ],
    "name": "rotateSalt",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "sanctionsScopeCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "institution",
        "type": "address"
      }
    ],
    "name": "scopeKeyForInstitution",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "scopeKeyForNetwork",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "scopeKeyForWallet",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "assetType",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "price",
        "type": "uint256"
      },
      {
        "internalType": "uint32",
        "name": "stalenessThreshold",
        "type": "uint32"
      }
    ],
    "name": "setAssetPrice",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      }
    ],
    "name": "setBankActivation",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "factorBps",
        "type": "uint256"
      }
    ],
    "name": "setBankCollateralFactor",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "limit",
        "type": "uint256"
      }
    ],
    "name": "setBankDailyCap",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_baseRiskScalerBps",
        "type": "uint256"
      }
    ],
    "name": "setBaseRiskScalerBps",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "maxNoteValue",
        "type": "uint256"
      },
      {
        "internalType": "uint48",
        "name": "minDeadlineBuffer",
        "type": "uint48"
      },
      {
        "internalType": "uint48",
        "name": "maxDeadlineWindow",
        "type": "uint48"
      },
      {
        "internalType": "uint32",
        "name": "maxMetadataLength",
        "type": "uint32"
      }
    ],
    "name": "setCambioConfig",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "maxNoteValue",
        "type": "uint256"
      },
      {
        "internalType": "uint48",
        "name": "minDeadlineBuffer",
        "type": "uint48"
      },
      {
        "internalType": "uint48",
        "name": "maxDeadlineWindow",
        "type": "uint48"
      },
      {
        "internalType": "uint32",
        "name": "maxMetadataLength",
        "type": "uint32"
      },
      {
        "internalType": "uint256",
        "name": "commitRevealThreshold",
        "type": "uint256"
      },
      {
        "internalType": "uint48",
        "name": "maxCommitLifetime",
        "type": "uint48"
      },
      {
        "internalType": "bool",
        "name": "cambioPaused",
        "type": "bool"
      }
    ],
    "name": "setCambioEnvelopeConfig",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "setCapacityModelActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "name": "setCipEnforceActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "threshold",
        "type": "uint256"
      }
    ],
    "name": "setCommitRevealThreshold",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint40",
        "name": "windowSeconds",
        "type": "uint40"
      }
    ],
    "name": "setDefaultClawbackWindow",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint40",
        "name": "timeoutSeconds",
        "type": "uint40"
      }
    ],
    "name": "setDefaultDisputeTimeout",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint40",
        "name": "windowSeconds",
        "type": "uint40"
      }
    ],
    "name": "setDefaultFallbackWindow",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "guardian",
        "type": "address"
      }
    ],
    "name": "setEmergencyGuardian",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "envelopeId",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "receivingIssuer",
        "type": "address"
      }
    ],
    "name": "setEnvelopeReceivingIssuer",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "featureKey",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "surcharge",
        "type": "uint256"
      }
    ],
    "name": "setFeatureSurcharge",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "baseFee",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "perRuleSurcharge",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "surchargeCap",
        "type": "uint256"
      }
    ],
    "name": "setFeeSchedule",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256[]",
        "name": "_feeTierThresholds",
        "type": "uint256[]"
      },
      {
        "internalType": "uint256[]",
        "name": "_feeTierRatesBps",
        "type": "uint256[]"
      }
    ],
    "name": "setFeeTiers",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "count",
        "type": "uint256"
      }
    ],
    "name": "setGlobalMaxOutstandingNoteCount",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "setGlobalMaxOutstandingNoteValue",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "minDistributionAmount",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxBatchSize",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "globalKYCFeeRate",
        "type": "uint256"
      }
    ],
    "name": "setGlobalParameters",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_halfLifeDuration",
        "type": "uint256"
      }
    ],
    "name": "setHalfLifeDuration",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "allow",
        "type": "bool"
      },
      {
        "internalType": "bool",
        "name": "deny",
        "type": "bool"
      }
    ],
    "name": "setHotlist",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_inactivityResetPeriod",
        "type": "uint256"
      }
    ],
    "name": "setInactivityResetPeriod",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "institution",
        "type": "address"
      },
      {
        "internalType": "enum InstitutionLifecycleStorage.InstitutionMode",
        "name": "newMode",
        "type": "uint8"
      }
    ],
    "name": "setInstitutionMode",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "setInstitutionPolicy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "reasonHash",
        "type": "bytes32"
      }
    ],
    "name": "setInstitutionPolicyWithReason",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "bool",
        "name": "enabled",
        "type": "bool"
      }
    ],
    "name": "setInstitutionSanctionsEnabled",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "enum InstitutionStorage.InstitutionStatus",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "setInstitutionStatus",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "ceiling",
        "type": "uint256"
      }
    ],
    "name": "setIssuerDailyRedemptionCeiling",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "floor",
        "type": "uint256"
      }
    ],
    "name": "setIssuerFloor",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "count",
        "type": "uint256"
      }
    ],
    "name": "setIssuerMaxOutstandingNoteCount",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "setIssuerMaxOutstandingNoteValue",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "open",
        "type": "bool"
      }
    ],
    "name": "setIssuerOpenRedemption",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "issuer",
        "type": "address"
      },
      {
        "internalType": "enum CambioEnvelopeStorage.PauseState",
        "name": "state",
        "type": "uint8"
      }
    ],
    "name": "setIssuerPauseState",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "name": "setKycEnforceActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "unlocked",
        "type": "bool"
      }
    ],
    "name": "setLegacyMintUnlocked",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint48",
        "name": "lifetime",
        "type": "uint48"
      }
    ],
    "name": "setMaxCommitLifetime",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_maxFeePercentBps",
        "type": "uint256"
      }
    ],
    "name": "setMaxFeePercentBps",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_maxHalfLifeDuration",
        "type": "uint256"
      }
    ],
    "name": "setMaxHalfLifeDuration",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_maxRiskScalerBps",
        "type": "uint256"
      }
    ],
    "name": "setMaxRiskScalerBps",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "allowRoot",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "denyRoot",
        "type": "bytes32"
      }
    ],
    "name": "setMerkleRoots",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_minFeeWei",
        "type": "uint256"
      }
    ],
    "name": "setMinFeeWei",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "_minHalfLifeDuration",
        "type": "uint256"
      }
    ],
    "name": "setMinHalfLifeDuration",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "setNetworkPolicy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "observationMode",
        "type": "bool"
      },
      {
        "internalType": "uint16",
        "name": "warnAt",
        "type": "uint16"
      },
      {
        "internalType": "uint16",
        "name": "denyAt",
        "type": "uint16"
      }
    ],
    "name": "setObservationMode",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "ref",
        "type": "bytes32"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "objectType",
        "type": "uint8"
      },
      {
        "internalType": "uint40",
        "name": "deadline",
        "type": "uint40"
      }
    ],
    "name": "setPendingTravelRule",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bankWallet",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "standbyWallet",
        "type": "address"
      }
    ],
    "name": "setRecoveryStandby",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "scopeKey",
        "type": "bytes32"
      },
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "enabledBits",
            "type": "uint256"
          },
          {
            "internalType": "uint16",
            "name": "warnThreshold",
            "type": "uint16"
          },
          {
            "internalType": "uint16",
            "name": "blockThreshold",
            "type": "uint16"
          },
          {
            "internalType": "uint48",
            "name": "velocityWindowSecs",
            "type": "uint48"
          },
          {
            "internalType": "uint256",
            "name": "maxAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxOutflowAmount",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxPerRecipientDaily",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxEvalCount",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "restrictContracts",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "extendCommitOnWarn",
            "type": "bool"
          },
          {
            "internalType": "uint48",
            "name": "warnExtendSeconds",
            "type": "uint48"
          },
          {
            "internalType": "bool",
            "name": "requireKyc",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "kycAmountThreshold",
            "type": "uint256"
          },
          {
            "internalType": "uint48",
            "name": "kycSoonSeconds",
            "type": "uint48"
          },
          {
            "internalType": "uint256",
            "name": "createdAt",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "effectiveFrom",
            "type": "uint256"
          }
        ],
        "internalType": "struct RulesStorageLib.RuleSet",
        "name": "rules",
        "type": "tuple"
      }
    ],
    "name": "setRuleSet",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "scopeKey",
        "type": "bytes32"
      },
      {
        "internalType": "uint8",
        "name": "ruleId",
        "type": "uint8"
      },
      {
        "internalType": "uint16",
        "name": "weight",
        "type": "uint16"
      }
    ],
    "name": "setRuleWeight",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "scopeKey",
        "type": "bytes32"
      },
      {
        "internalType": "uint8[]",
        "name": "ruleIds",
        "type": "uint8[]"
      },
      {
        "internalType": "uint16[]",
        "name": "weights",
        "type": "uint16[]"
      }
    ],
    "name": "setRuleWeights",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "name": "setScreeningEnforceActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint40",
        "name": "secs",
        "type": "uint40"
      }
    ],
    "name": "setScreeningStaleAfter",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "active",
        "type": "bool"
      }
    ],
    "name": "setSettlementModelActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "name": "setTravelRuleEnforceActive",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_treasuryAddress",
        "type": "address"
      }
    ],
    "name": "setTreasuryAddress",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "forwarder",
        "type": "address"
      }
    ],
    "name": "setTrustedForwarder",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "enum InstitutionStorage.WalletAffiliationStatus",
        "name": "status",
        "type": "uint8"
      }
    ],
    "name": "setWalletAffiliationStatus",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "institution",
        "type": "address"
      }
    ],
    "name": "setWalletInstitution",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "setWalletPolicy",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "key",
        "type": "bytes32"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      },
      {
        "internalType": "bytes32",
        "name": "reasonHash",
        "type": "bytes32"
      }
    ],
    "name": "setWalletPolicyWithReason",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "SHORTEN_OOB_REQUIRED",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "tinHash",
        "type": "bytes32"
      }
    ],
    "name": "submitDepositorHash",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint8",
        "name": "category",
        "type": "uint8"
      }
    ],
    "name": "supportsCategoryInterfaces",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes4",
        "name": "interfaceId",
        "type": "bytes4"
      }
    ],
    "name": "supportsInterface",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalSupply",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "transfer",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "transferFrom",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "TRAVEL_RULE_ENFORCE_ACTIVE",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "TRAVEL_RULE_THRESHOLD_USD",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "travelRuleScopeCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "wallet",
        "type": "address"
      }
    ],
    "name": "unlinkWalletFromInstitution",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "unpause",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "unpauseCambio",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      }
    ],
    "name": "unregisterCustodiedWallet",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bankAddress",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "newFeeRate",
        "type": "uint256"
      }
    ],
    "name": "updateBankFeeRate",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bank",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "bankName",
        "type": "string"
      },
      {
        "internalType": "address",
        "name": "primarySigner",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "maxCollateralLimit",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "riskRating",
        "type": "uint256"
      }
    ],
    "name": "updateBankProfile",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "bankAddress",
        "type": "address"
      },
      {
        "internalType": "bool",
        "name": "isActive",
        "type": "bool"
      }
    ],
    "name": "updateBankStatus",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "institutionId",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "bytes32",
        "name": "metadataHash",
        "type": "bytes32"
      },
      {
        "internalType": "string",
        "name": "metadataURI",
        "type": "string"
      }
    ],
    "name": "updateInstitution",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "userAddress",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "kycValidatedTimestamp",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "kycExpiresTimestamp",
        "type": "uint256"
      }
    ],
    "name": "updateKYCStatus",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "validateSystemRecovery",
    "outputs": [
      {
        "internalType": "bool",
        "name": "allSystemsOperational",
        "type": "bool"
      },
      {
        "internalType": "bool[3]",
        "name": "operationalStatus",
        "type": "bool[3]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
