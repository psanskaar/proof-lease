// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IProofLease {
    // Machine states
    enum MachineStatus { Unregistered, Active, Suspended }
    // Lease lifecycle
    enum LeaseStatus   { Active, Completed, Disputed, Refunded }
    // Per-epoch outcome
    enum EpochStatus   { Pending, Compliant, Breached }

    struct Machine {
        address provider;
        bytes32 hardwareHash;   // keccak256(deviceId + specs string)
        string  region;         // "us-east", "asia-pacific", etc.
        string  hardwareClass;  // "GPU-RTX4090", "CPU-64C", etc.
        string  attestationURI; // IPFS CID or URL to benchmark doc
        uint256 registeredAt;
        uint256 lastHeartbeat;
        MachineStatus status;
    }

    struct Lease {
        uint256 machineId;
        address provider;
        address buyer;
        uint256 pricePerEpoch;   // in wei
        uint256 epochDuration;   // seconds per epoch
        uint256 totalEpochs;     // total epochs in lease
        uint256 epochsSettled;   // how many done
        uint256 escrowBalance;   // remaining locked BOT
        uint256 startTime;
        LeaseStatus status;
        bytes32 aiQuoteHash;     // hash of AI's signed quote
    }

    // Events — judges will see these in the explorer
    event MachineRegistered(uint256 indexed machineId, address indexed provider, string hardwareClass);
    event LeaseCreated(uint256 indexed leaseId, uint256 indexed machineId, address indexed buyer, uint256 totalValue);
    event ProofSubmitted(uint256 indexed leaseId, uint256 epoch, bytes32 proofHash);
    event EpochSettled(uint256 indexed leaseId, uint256 epoch, bool compliant, uint256 released);
    event DisputeRaised(uint256 indexed leaseId, address initiator);
    event ReputationUpdated(address indexed provider, uint256 newScore);
}
