// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/AssetRegistry.sol";
import "../src/LeaseEscrow.sol";
import "../src/ProofRouter.sol";
import "../src/Reputation.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        Reputation    reputation = new Reputation();
        AssetRegistry registry   = new AssetRegistry();
        LeaseEscrow   escrow     = new LeaseEscrow(address(registry), deployer);
        ProofRouter   router     = new ProofRouter();

        escrow.setReputation(address(reputation));
        escrow.setAgentOracle(deployer);
        reputation.setEscrow(address(escrow));

        vm.stopBroadcast();

        console.log("=== DEPLOYED ===");
        console.log("Reputation:   ", address(reputation));
        console.log("AssetRegistry:", address(registry));
        console.log("LeaseEscrow:  ", address(escrow));
        console.log("ProofRouter:  ", address(router));
        console.log("Deployer:     ", deployer);
    }
}
