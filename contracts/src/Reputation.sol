// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Reputation {
    mapping(address => uint256) public scores;
    mapping(address => uint256) public totalLeases;
    mapping(address => uint256) public successLeases;

    address public owner;
    address public escrowContract;
    uint256 public constant START_SCORE = 500;

    event ScoreUpdated(address indexed provider, uint256 oldScore, uint256 newScore);

    modifier onlyAuthorized() {
        require(msg.sender == escrowContract || msg.sender == owner, "Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function recordOutcome(address provider, bool success) external onlyAuthorized {
        if (scores[provider] == 0) scores[provider] = START_SCORE;
        totalLeases[provider]++;
        uint256 old = scores[provider];

        if (success) {
            successLeases[provider]++;
            scores[provider] = scores[provider] + 10 > 1000
                ? 1000
                : scores[provider] + 10;
        } else {
            scores[provider] = scores[provider] > 20
                ? scores[provider] - 20
                : 0;
        }
        emit ScoreUpdated(provider, old, scores[provider]);
    }

    function getScore(address provider) external view returns (uint256) {
        return scores[provider] == 0 ? START_SCORE : scores[provider];
    }

    function getFulfillmentRate(address provider) external view returns (uint256) {
        if (totalLeases[provider] == 0) return 100;
        return (successLeases[provider] * 100) / totalLeases[provider];
    }

    function setEscrow(address escrow) external {
        require(msg.sender == owner, "Not owner");
        escrowContract = escrow;
    }
}
