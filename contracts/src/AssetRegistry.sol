// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IProofLease.sol";

contract AssetRegistry is IProofLease {
    uint256 public machineCount;
    mapping(uint256 => Machine) private _machines;
    mapping(address => uint256[]) private _providerMachines;

    uint256 public constant MIN_BOND = 0.001 ether;

    function registerMachine(
        string calldata hardwareClass,
        string calldata region,
        string calldata attestationURI,
        bytes32 hardwareHash
    ) external payable returns (uint256 machineId) {
        require(msg.value >= MIN_BOND, "Bond required");
        require(bytes(hardwareClass).length > 0, "Empty class");
        require(bytes(region).length > 0, "Empty region");

        machineId = ++machineCount;
        _machines[machineId] = Machine({
            provider:       msg.sender,
            hardwareHash:   hardwareHash,
            region:         region,
            hardwareClass:  hardwareClass,
            attestationURI: attestationURI,
            registeredAt:   block.timestamp,
            lastHeartbeat:  block.timestamp,
            status:         MachineStatus.Active
        });
        _providerMachines[msg.sender].push(machineId);

        emit MachineRegistered(machineId, msg.sender, hardwareClass);
    }

    function getMachine(uint256 machineId)
        external view returns (Machine memory) {
        return _machines[machineId];
    }

    function getProviderMachines(address provider)
        external view returns (uint256[] memory) {
        return _providerMachines[provider];
    }

    function getMachineStatus(uint256 machineId)
        external view returns (MachineStatus) {
        return _machines[machineId].status;
    }

    function touchHeartbeat(uint256 machineId) external {
        _machines[machineId].lastHeartbeat = block.timestamp;
    }
}
