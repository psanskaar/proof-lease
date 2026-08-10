// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IProofLease.sol";
import "./AssetRegistry.sol";
import "./Reputation.sol";

contract LeaseEscrow is IProofLease {
    AssetRegistry public immutable registry;
    Reputation public reputation;

    address public owner;
    address public agentOracle;
    address public platformWallet;
    uint256 public platformFeeBps = 200;

    uint256 public leaseCount;
    mapping(uint256 => Lease) private _leases;
    mapping(uint256 => mapping(uint256 => EpochStatus)) public epochStatus;
    mapping(uint256 => mapping(uint256 => bytes32)) public epochProofHash;
    mapping(address => uint256) public pendingWithdrawals;

    uint256 public constant MAX_EPOCHS = 1440;
    uint256 public constant MIN_EPOCH_SEC = 60;

    modifier onlyOwner() { require(msg.sender == owner, "Not owner"); _; }
    modifier onlyAgent() { require(msg.sender == agentOracle, "Not agent oracle"); _; }

    constructor(address _registry, address _platform) {
        owner = msg.sender;
        registry = AssetRegistry(_registry);
        platformWallet = _platform;
    }

    function createLease(
        uint256 machineId,
        uint256 epochDuration,
        uint256 totalEpochs,
        bytes32 aiQuoteHash
    ) external payable returns (uint256 leaseId) {
        IProofLease.Machine memory m = registry.getMachine(machineId);
        require(m.status == MachineStatus.Active, "Machine inactive");
        require(epochDuration >= MIN_EPOCH_SEC, "Epoch too short");
        require(totalEpochs > 0 && totalEpochs <= MAX_EPOCHS, "Bad epoch count");
        require(msg.value > 0, "No funds sent");

        uint256 pricePerEpoch = msg.value / totalEpochs;
        require(pricePerEpoch > 0, "Price too low");

        leaseId = ++leaseCount;
        _leases[leaseId] = Lease({
            machineId:      machineId,
            provider:       m.provider,
            buyer:          msg.sender,
            pricePerEpoch:  pricePerEpoch,
            epochDuration:  epochDuration,
            totalEpochs:    totalEpochs,
            epochsSettled:  0,
            escrowBalance:  msg.value,
            startTime:      block.timestamp,
            status:         LeaseStatus.Active,
            aiQuoteHash:    aiQuoteHash
        });

        emit LeaseCreated(leaseId, machineId, msg.sender, msg.value);
    }

    function settleEpoch(
        uint256 leaseId,
        uint256 epoch,
        bool compliant,
        bytes32 proofHash
    ) external onlyAgent {
        Lease storage lease = _leases[leaseId];
        require(lease.status == LeaseStatus.Active, "Not active");
        require(epochStatus[leaseId][epoch] == EpochStatus.Pending, "Already settled");
        require(epoch == lease.epochsSettled, "Wrong epoch");

        epochProofHash[leaseId][epoch] = proofHash;

        if (compliant) {
            epochStatus[leaseId][epoch] = EpochStatus.Compliant;
            uint256 fee = (lease.pricePerEpoch * platformFeeBps) / 10_000;
            uint256 providerPay = lease.pricePerEpoch - fee;
            lease.escrowBalance -= lease.pricePerEpoch;
            pendingWithdrawals[lease.provider] += providerPay;
            pendingWithdrawals[platformWallet] += fee;
        } else {
            epochStatus[leaseId][epoch] = EpochStatus.Breached;
            lease.escrowBalance -= lease.pricePerEpoch;
            pendingWithdrawals[lease.buyer] += lease.pricePerEpoch;
        }

        lease.epochsSettled++;
        emit EpochSettled(leaseId, epoch, compliant, compliant ? lease.pricePerEpoch : 0);

        if (lease.epochsSettled == lease.totalEpochs) {
            lease.status = LeaseStatus.Completed;
            if (lease.escrowBalance > 0) {
                pendingWithdrawals[lease.buyer] += lease.escrowBalance;
                lease.escrowBalance = 0;
            }
            if (address(reputation) != address(0)) {
                uint256 breaches = _countBreaches(leaseId, lease.totalEpochs);
                reputation.recordOutcome(lease.provider, breaches == 0);
            }
        }
    }

    function raiseDispute(uint256 leaseId) external {
        Lease storage lease = _leases[leaseId];
        require(msg.sender == lease.buyer || msg.sender == lease.provider, "Not party");
        require(lease.status == LeaseStatus.Active, "Not active");
        lease.status = LeaseStatus.Disputed;
        emit DisputeRaised(leaseId, msg.sender);
    }

    function resolveDispute(
        uint256 leaseId,
        uint256 refundBuyer,
        uint256 payProvider
    ) external onlyOwner {
        Lease storage lease = _leases[leaseId];
        require(lease.status == LeaseStatus.Disputed, "Not disputed");
        require(refundBuyer + payProvider <= lease.escrowBalance, "Exceeds balance");
        pendingWithdrawals[lease.buyer]    += refundBuyer;
        pendingWithdrawals[lease.provider] += payProvider;
        lease.escrowBalance -= (refundBuyer + payProvider);
        lease.status = LeaseStatus.Completed;
    }

    function withdraw() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
    }

    function getLease(uint256 leaseId) external view returns (Lease memory) {
        return _leases[leaseId];
    }

    function getEpochInfo(uint256 leaseId, uint256 epoch)
        external view returns (EpochStatus status, bytes32 proofHash) {
        return (epochStatus[leaseId][epoch], epochProofHash[leaseId][epoch]);
    }

    function _countBreaches(uint256 leaseId, uint256 total)
        internal view returns (uint256 count) {
        for (uint256 i = 0; i < total; i++) {
            if (epochStatus[leaseId][i] == EpochStatus.Breached) count++;
        }
    }

    function setAgentOracle(address oracle) external onlyOwner {
        agentOracle = oracle;
    }

    function setReputation(address rep) external onlyOwner {
        reputation = Reputation(rep);
    }

    receive() external payable {}
}
