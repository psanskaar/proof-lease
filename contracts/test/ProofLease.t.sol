// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AssetRegistry.sol";
import "../src/LeaseEscrow.sol";
import "../src/ProofRouter.sol";
import "../src/Reputation.sol";
import "../src/interfaces/IProofLease.sol";

contract ProofLeaseTest is Test {
    AssetRegistry registry;
    LeaseEscrow   escrow;
    ProofRouter   router;
    Reputation    reputation;

    address deployer  = makeAddr("deployer");
    address provider  = makeAddr("provider");
    address buyer     = makeAddr("buyer");
    address agent     = makeAddr("agent");
    address platform  = makeAddr("platform");
    address stranger  = makeAddr("stranger");

    function setUp() public {
        vm.startPrank(deployer);
        registry   = new AssetRegistry();
        reputation = new Reputation();
        escrow     = new LeaseEscrow(address(registry), platform);
        router     = new ProofRouter();
        escrow.setAgentOracle(agent);
        escrow.setReputation(address(reputation));
        reputation.setEscrow(address(escrow));
        vm.stopPrank();
        vm.deal(provider, 10 ether);
        vm.deal(buyer,    10 ether);
    }

    function _registerMachine() internal returns (uint256 id) {
        vm.prank(provider);
        id = registry.registerMachine{value: 0.001 ether}(
            "GPU-RTX4090", "asia-pacific",
            "ipfs://QmTestAttestation",
            keccak256("demo-device-001")
        );
    }

    function _createLease(uint256 machineId) internal returns (uint256 leaseId) {
        vm.prank(buyer);
        leaseId = escrow.createLease{value: 0.005 ether}(machineId, 60, 5, bytes32(0));
    }

    // ── 1. Happy path ────────────────────────────────────────────────────────

    function test_HappyPath() public {
        uint256 mid = _registerMachine();
        uint256 lid = _createLease(mid);

        IProofLease.Lease memory lease = escrow.getLease(lid);
        assertEq(lease.escrowBalance, 0.005 ether);
        assertEq(uint(lease.status), uint(IProofLease.LeaseStatus.Active));

        vm.prank(agent);
        escrow.settleEpoch(lid, 0, true, keccak256("proof-0"));

        assertGt(escrow.pendingWithdrawals(provider), 0);
        assertGt(escrow.pendingWithdrawals(platform), 0);
    }

    // ── 2. Breach holds payment, refunds buyer ───────────────────────────────

    function test_BreachHoldsPaymentRefundsBuyer() public {
        uint256 mid = _registerMachine();
        uint256 lid = _createLease(mid);

        vm.prank(agent);
        escrow.settleEpoch(lid, 0, false, keccak256("breach-0"));

        assertEq(escrow.pendingWithdrawals(provider), 0, "Provider gets nothing on breach");
        assertGt(escrow.pendingWithdrawals(buyer),    0, "Buyer gets refund on breach");
    }

    // ── 3. Replay protection — status check fires before epoch-order check ───

    function test_ReplayProtection() public {
        uint256 mid = _registerMachine();
        uint256 lid = _createLease(mid);

        vm.startPrank(agent);
        escrow.settleEpoch(lid, 0, true, keccak256("p0"));
        vm.expectRevert("Already settled");
        escrow.settleEpoch(lid, 0, true, keccak256("p0-replay"));
        vm.stopPrank();
    }

    // ── 4. Only the agent oracle can settle ──────────────────────────────────

    function test_OnlyAgentCanSettle() public {
        uint256 mid = _registerMachine();
        uint256 lid = _createLease(mid);

        vm.prank(buyer);
        vm.expectRevert("Not agent oracle");
        escrow.settleEpoch(lid, 0, true, bytes32(0));

        vm.prank(provider);
        vm.expectRevert("Not agent oracle");
        escrow.settleEpoch(lid, 0, true, bytes32(0));
    }

    // ── 5. Dispute flow — both parties can raise ─────────────────────────────

    function test_DisputeFlow() public {
        uint256 mid = _registerMachine();
        uint256 lid = _createLease(mid);

        vm.prank(agent); escrow.settleEpoch(lid, 0, false, keccak256("b0"));
        vm.prank(agent); escrow.settleEpoch(lid, 1, false, keccak256("b1"));

        vm.prank(buyer);
        escrow.raiseDispute(lid);

        assertEq(uint(escrow.getLease(lid).status), uint(IProofLease.LeaseStatus.Disputed));
    }

    // ── 6. Withdrawal pull pattern ───────────────────────────────────────────

    function test_WithdrawalPullPattern() public {
        uint256 mid = _registerMachine();
        uint256 lid = _createLease(mid);

        vm.prank(agent);
        escrow.settleEpoch(lid, 0, true, keccak256("p0"));

        uint256 before = provider.balance;
        vm.prank(provider);
        escrow.withdraw();
        assertGt(provider.balance, before);
    }

    // ── 7. Full fund accounting — total in == total out ──────────────────────

    function test_FundAccounting() public {
        uint256 mid   = _registerMachine();
        uint256 lid   = _createLease(mid);
        uint256 total = 0.005 ether;

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(agent);
            escrow.settleEpoch(lid, i, true, keccak256(abi.encode("p", i)));
        }

        assertApproxEqAbs(
            escrow.pendingWithdrawals(provider) + escrow.pendingWithdrawals(platform),
            total, 100,
            "Total payouts must equal escrow input"
        );
    }

    // ── 8. Lease auto-completes after all epochs, status = Completed ─────────

    function test_LeaseAutoCompletesAfterAllEpochs() public {
        uint256 mid = _registerMachine();
        uint256 lid = _createLease(mid);

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(agent);
            escrow.settleEpoch(lid, i, true, keccak256(abi.encode("p", i)));
        }

        assertEq(
            uint(escrow.getLease(lid).status),
            uint(IProofLease.LeaseStatus.Completed),
            "Lease should auto-complete"
        );
        assertEq(escrow.getLease(lid).escrowBalance, 0, "Escrow should be drained");
    }

    // ── 9. Platform fee is exactly 2% ────────────────────────────────────────

    function test_PlatformFeeIsExactly2Pct() public {
        uint256 mid = _registerMachine();
        uint256 lid = _createLease(mid);

        // pricePerEpoch = 0.005 ether / 5 = 0.001 ether = 1e15 wei
        // 2% of 1e15 = 2e13
        vm.prank(agent);
        escrow.settleEpoch(lid, 0, true, keccak256("p0"));

        assertEq(escrow.pendingWithdrawals(platform), 20000000000000, "Platform fee must be 2%");
        assertEq(escrow.pendingWithdrawals(provider), 980000000000000, "Provider gets 98%");
    }

    // ── 10. Cannot create lease on an inactive/unregistered machine ──────────

    function test_CannotLeaseInactiveMachine() public {
        // machineId 999 was never registered — status is Unregistered (0), not Active (1)
        vm.prank(buyer);
        vm.expectRevert("Machine inactive");
        escrow.createLease{value: 0.005 ether}(999, 60, 5, bytes32(0));
    }

    // ── 11. Cannot create lease with zero value ──────────────────────────────

    function test_CannotLeaseWithZeroValue() public {
        uint256 mid = _registerMachine();

        vm.prank(buyer);
        vm.expectRevert("No funds sent");
        escrow.createLease{value: 0}(mid, 60, 5, bytes32(0));
    }

    // ── 12. Stranger cannot raise a dispute ──────────────────────────────────

    function test_StrangerCannotRaiseDispute() public {
        uint256 mid = _registerMachine();
        uint256 lid = _createLease(mid);

        vm.prank(stranger);
        vm.expectRevert("Not party");
        escrow.raiseDispute(lid);
    }

    // ── 13. Owner resolves dispute, funds split correctly ────────────────────

    function test_ResolveDispute() public {
        uint256 mid = _registerMachine();
        uint256 lid = _createLease(mid);

        // One breach to create the dispute scenario
        vm.prank(agent); escrow.settleEpoch(lid, 0, false, keccak256("b0"));
        vm.prank(buyer); escrow.raiseDispute(lid);

        // Remaining escrow = 4 epochs worth = 0.004 ether
        // Owner awards: 0.003 to buyer, 0.001 to provider
        uint256 remaining = escrow.getLease(lid).escrowBalance;
        uint256 toProvider = remaining / 4;
        uint256 toBuyer    = remaining - toProvider;

        vm.prank(deployer);
        escrow.resolveDispute(lid, toBuyer, toProvider);

        // buyer: 1e15 breach refund (epoch 0) + 3e15 dispute award = 4e15 total
        assertEq(escrow.pendingWithdrawals(buyer),    toBuyer + (0.005 ether / 5), "Buyer: dispute award + breach refund");
        assertEq(escrow.pendingWithdrawals(provider), toProvider,                   "Provider: dispute award");
        assertGt(escrow.pendingWithdrawals(provider), 0, "Provider gets partial payment");
        assertEq(uint(escrow.getLease(lid).status), uint(IProofLease.LeaseStatus.Completed));
    }

    // ── 14. ProofRouter stores and returns correct hash ──────────────────────

    function test_ProofRouterStoresHash() public {
        bytes32 dataHash = keccak256("telemetry-payload-epoch-0");

        vm.prank(provider);
        bytes32 proofHash = router.submitProof(1, 0, dataHash);

        assertEq(router.getProof(1, 0), proofHash, "Stored hash must match returned hash");
        assertEq(router.proofCount(1), 1, "Proof count should increment");
        assertNotEq(proofHash, bytes32(0), "Proof hash must not be zero");
    }

    // ── 15. Reputation updates correctly after lease outcomes ────────────────

    function test_ReputationUpdatesAfterLease() public {
        uint256 mid = _registerMachine();
        uint256 lid = _createLease(mid);

        uint256 scoreBefore = reputation.getScore(provider);

        // Complete all 5 epochs successfully → score should increase
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(agent);
            escrow.settleEpoch(lid, i, true, keccak256(abi.encode("p", i)));
        }

        uint256 scoreAfter = reputation.getScore(provider);
        assertGt(scoreAfter, scoreBefore, "Score must increase after successful lease");
        assertEq(reputation.totalLeases(provider), 1);
        assertEq(reputation.successLeases(provider), 1);
    }
}