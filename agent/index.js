require("dotenv").config();

const { ethers } = require("ethers");
const { scoreMachineRisk } = require("./riskScorer");
const { generateQuote } = require("./quoteEngine");
const {
  settleEpoch,
  isLiveSettlementEnabled,
  getChainSummary,
  resolveLease,
} = require("./settlementBot");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runDemo() {
  const now = Math.floor(Date.now() / 1000);
  const machine = {
    hardwareClass: "GPU-RTX4090",
    region: "asia-pacific",
    lastHeartbeat: now - 120,
    registeredAt: now - 86400 * 5,
    attestationURI: "https://github.com/psanskaar/proof-lease",
    reputationScore: 500,
  };

  console.log("ProofLease AI Agent - Demo Mode");
  console.log("AI mode:", process.env.GROQ_API_KEY ? "Groq" : "local fallback");
  console.log("Settlement:", isLiveSettlementEnabled() ? "LIVE" : "SIMULATED");
  console.log("================================\n");

  console.log("[STEP 1] Running risk assessment on machine #1...");
  const risk = await scoreMachineRisk(machine);
  console.log("Risk Result:");
  console.log("  Score:   ", `${risk.score}/100`);
  console.log("  Tier:    ", risk.tier);
  console.log("  Eligible:", risk.eligible);
  console.log("  Reasons: ", risk.reasons.join(", "));
  console.log("  AI mode: ", risk.mode);

  if (!risk.eligible) {
    console.log("\nMachine not eligible - lease blocked.");
    return;
  }

  console.log("\n[STEP 2] Generating lease quote...");
  const quote = await generateQuote({
    hardwareClass: machine.hardwareClass,
    region: machine.region,
    epochDuration: 60,
    totalEpochs: 5,
    riskScore: risk.score,
  });
  console.log("Quote Result:");
  console.log("  Price/epoch:", quote.pricePerEpochBOT, "BOT");
  console.log("  Total:      ", quote.totalPriceBOT, "BOT");
  console.log("  Rationale:  ", quote.rationale);
  console.log("  Discount:   ", quote.discount);
  console.log("  AI mode:    ", quote.mode);

  const totalEpochs = 5;
  const epochDuration = 60;
  const delayMs = Number(process.env.DEMO_DELAY_MS ?? 250);
  const machineId = Number(process.env.DEMO_MACHINE_ID ?? 1);
  const aiQuoteHash = ethers.keccak256(
    ethers.toUtf8Bytes(
      JSON.stringify({
        hardwareClass: machine.hardwareClass,
        region: machine.region,
        epochDuration,
        totalEpochs,
        riskScore: risk.score,
        quote,
      }),
    ),
  );
  const leaseResolution = await resolveLease({
    machineId,
    epochDuration,
    totalEpochs,
    aiQuoteHash,
    totalPriceWei: quote.totalPriceWei,
  });
  const leaseId = leaseResolution.leaseId;
  const selectedTotalEpochs = Number(
    leaseResolution.lease?.totalEpochs ?? totalEpochs,
  );
  const pattern = Array.from(
    { length: selectedTotalEpochs },
    (_, epoch) => epoch !== 2,
  );

  console.log(
    `\n[STEP 3] Settling ${selectedTotalEpochs} epochs for lease #${leaseId}...`,
  );
  console.log(`Lease selection: ${leaseResolution.source}`);
  if (leaseResolution.createTxHash) {
    console.log(`Lease creation TX: ${leaseResolution.createTxHash}`);
    console.log(
      `Lease creation: https://scan.bohr.life/tx/${leaseResolution.createTxHash}`,
    );
  }
  console.log(
    `Pattern: ${pattern
      .map((compliant) => (compliant ? "compliant" : "BREACH"))
      .join(", ")}\n`,
  );

  for (let epoch = 0; epoch < selectedTotalEpochs; epoch += 1) {
    await wait(delayMs);
    const compliant = pattern[epoch];
    const proofData = `lease-${leaseId}-epoch-${epoch}-ts-${Date.now()}-ok-${compliant}`;

    console.log(
      `Epoch ${epoch}: ${compliant ? "compliant" : "BREACH - heartbeat gap detected"}`,
    );
    if (!compliant) {
      console.log("  Agent: anomaly flagged, payment held, refund queued for buyer");
    }

    const result = await settleEpoch(leaseId, epoch, compliant, proofData);
    if (result.skipped) {
      console.log(`  Skipped live write: ${result.skipReason}`);
      console.log(`  Existing on-chain status: ${result.onChainStatus}`);
      console.log(`  Existing escrow proof: ${result.onChainProofHash}`);
    } else if (result.escrowTxHash) {
      console.log(`  ProofRouter TX: ${result.routerTxHash}`);
      console.log(`  ProofRouter: https://scan.bohr.life/tx/${result.routerTxHash}`);
      console.log(`  Escrow TX: ${result.escrowTxHash}`);
      console.log(`  Escrow: ${result.explorerUrl}`);
      console.log(`  Proof saved: ${result.id}`);
    } else {
      console.log(`  Simulated proof hash: ${result.proofHash}`);
      console.log(`  Proof saved: ${result.id}`);
    }
  }

  console.log("\nDemo complete.");
  if (!isLiveSettlementEnabled()) {
    console.log(
      "No blockchain transactions were sent. Set SETTLEMENT_MODE=live to enable settlement.",
    );
  }

  if (
    !isLiveSettlementEnabled() &&
    process.env.RPC_URL &&
    process.env.LEASE_ESCROW
  ) {
    const summary = await getChainSummary(leaseId, []);
    console.log(`Chain read verified: chain ${summary.chainId}`);
  } else if (!isLiveSettlementEnabled()) {
    console.log("Chain read skipped: RPC_URL and LEASE_ESCROW are not configured.");
  }
}

runDemo().catch((error) => {
  console.error("Agent error:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
