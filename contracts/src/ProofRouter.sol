// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IProofLease.sol";

contract ProofRouter is IProofLease {
    mapping(uint256 => mapping(uint256 => bytes32)) public proofs;
    mapping(uint256 => uint256) public proofCount;

    event ProofSubmitted(
        uint256 indexed leaseId,
        uint256 indexed epoch,
        address indexed submitter,
        bytes32 proofHash
    );

    function submitProof(
        uint256 leaseId,
        uint256 epoch,
        bytes32 dataHash
    ) external returns (bytes32 proofHash) {
        proofHash = keccak256(
            abi.encodePacked(leaseId, epoch, block.timestamp, dataHash, msg.sender)
        );
        proofs[leaseId][epoch] = proofHash;
        proofCount[leaseId]++;
        emit ProofSubmitted(leaseId, epoch, msg.sender, proofHash);
    }

    function getProof(uint256 leaseId, uint256 epoch)
        external view returns (bytes32) {
        return proofs[leaseId][epoch];
    }
}
