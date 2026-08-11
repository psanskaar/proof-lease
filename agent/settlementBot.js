const { ethers } = require("ethers");
require("dotenv").config();
const {
  buildProofRecord,
  saveProofRecord,
  getProofRecord,
  getProofRecordById,
  withProofLock,
} = require("./proofStore");

const ESCROW_ABI = [
  "function settleEpoch(uint256 leaseId, uint256 epoch, bool compliant, bytes32 proofHash) external",
  "function createLease(uint256 machineId, uint256 epochDuration, uint256 totalEpochs, bytes32 aiQuoteHash) external payable returns (uint256 leaseId)",
  "function leaseCount() external view returns (uint256)",
  "function getLease(uint256 leaseId) external view returns (tuple(uint256 machineId, address provider, address buyer, uint256 pricePerEpoch, uint256 epochDuration, uint256 totalEpochs, uint256 epochsSettled, uint256 escrowBalance, uint256 startTime, uint8 status, bytes32 aiQuoteHash))",
  "function epochStatus(uint256 leaseId, uint256 epoch) external view returns (uint8)",
  "function getEpochInfo(uint256 leaseId, uint256 epoch) external view returns (uint8 status, bytes32 proofHash)",
  "function pendingWithdrawals(address addr) external view returns (uint256)",
  "event LeaseCreated(uint256 indexed leaseId, uint256 indexed machineId, address indexed buyer, uint256 totalValue)",
  "event EpochSettled(uint256 indexed leaseId, uint256 epoch, bool compliant, uint256 released)",
];

const PROOF_ABI = [
  "function submitProof(uint256 leaseId, uint256 epoch, bytes32 dataHash) external returns (bytes32 proofHash)",
  "function getProof(uint256 leaseId, uint256 epoch) external view returns (bytes32)",
  "event ProofSubmitted(uint256 indexed leaseId, uint256 epoch, address indexed submitter, bytes32 proofHash)",
];

function isLiveSettlementEnabled() {
  return process.env.SETTLEMENT_MODE === "live" && Boolean(
    process.env.RPC_URL &&
      process.env.PRIVATE_KEY &&
      process.env.LEASE_ESCROW &&
      process.env.PROOF_ROUTER,
  );
}

function getReadOnlyContracts() {
  if (!process.env.RPC_URL || !process.env.LEASE_ESCROW) {
    throw new Error("RPC_URL and LEASE_ESCROW are required for chain reads.");
  }
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  return {
    escrow: new ethers.Contract(process.env.LEASE_ESCROW, ESCROW_ABI, provider),
    router: process.env.PROOF_ROUTER
      ? new ethers.Contract(process.env.PROOF_ROUTER, PROOF_ABI, provider)
      : null,
    provider,
  };
}

function getContracts() {
  if (!isLiveSettlementEnabled()) {
    throw new Error(
      "Live settlement requires SETTLEMENT_MODE=live, RPC_URL, PRIVATE_KEY, LEASE_ESCROW, and PROOF_ROUTER.",
    );
  }
  const { provider } = getReadOnlyContracts();
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  return {
    escrow: new ethers.Contract(process.env.LEASE_ESCROW, ESCROW_ABI, wallet),
    router: new ethers.Contract(process.env.PROOF_ROUTER, PROOF_ABI, wallet),
    wallet,
    provider,
  };
}

async function assertLiveNetwork(provider) {
  const expectedChainId = BigInt(process.env.EXPECTED_CHAIN_ID || "968");
  const network = await provider.getNetwork();
  if (network.chainId !== expectedChainId) {
    throw new Error(
      `Wrong network: expected chain ${expectedChainId}, got chain ${network.chainId}.`,
    );
  }

  for (const [name, address] of [
    ["LEASE_ESCROW", process.env.LEASE_ESCROW],
    ["PROOF_ROUTER", process.env.PROOF_ROUTER],
  ]) {
    if (!ethers.isAddress(address)) {
      throw new Error(`${name} is not a valid EVM address.`);
    }
    if ((await provider.getCode(address)) === "0x") {
      throw new Error(`${name} has no deployed bytecode at ${address}.`);
    }
  }
}

function parseEvent(receipt, iface, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === eventName) return parsed;
    } catch {
      // Ignore logs emitted by other contracts.
    }
  }
  return null;
}

function hasUnsettledEpochs(lease) {
  return Boolean(
    lease &&
      lease.provider !== ethers.ZeroAddress &&
      lease.totalEpochs > 0n &&
      lease.epochsSettled < lease.totalEpochs &&
      lease.escrowBalance > 0n &&
      Number(lease.status) === 0,
  );
}

function normalizeLeaseId(leaseId) {
  const value = String(leaseId ?? "").trim();
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`Lease ID must be a positive integer: ${leaseId}`);
  }
  return value;
}

async function getLeaseCount() {
  const { escrow } = getReadOnlyContracts();
  return escrow.leaseCount();
}

async function findAvailableLease() {
  const { escrow } = getReadOnlyContracts();
  const count = await escrow.leaseCount();
  const configuredMax = Number(process.env.MAX_LEASE_SCAN || "1000");
  const maxScan = BigInt(
    Number.isSafeInteger(configuredMax) && configuredMax > 0
      ? configuredMax
      : 1000,
  );
  const upperBound = count < maxScan ? count : maxScan;

  for (let id = 1n; id <= upperBound; id += 1n) {
    try {
      const lease = await escrow.getLease(id);
      if (hasUnsettledEpochs(lease)) {
        return {
          leaseId: id.toString(),
          lease,
          source: "existing-active",
        };
      }
    } catch {
      // A sparse or historical mapping must not prevent later valid leases
      // from being discovered.
    }
  }

  return null;
}

async function createLease({
  machineId,
  epochDuration,
  totalEpochs,
  aiQuoteHash = ethers.ZeroHash,
  totalPriceWei,
}) {
  if (!isLiveSettlementEnabled()) {
    throw new Error("Automatic lease creation requires live settlement.");
  }
  if (!Number.isInteger(Number(machineId)) || Number(machineId) < 1) {
    throw new Error(`Invalid machine ID for lease creation: ${machineId}`);
  }
  if (!Number.isInteger(Number(epochDuration)) || Number(epochDuration) < 60) {
    throw new Error(`Epoch duration must be at least 60 seconds: ${epochDuration}`);
  }
  if (!Number.isInteger(Number(totalEpochs)) || Number(totalEpochs) < 1) {
    throw new Error(`Total epochs must be positive: ${totalEpochs}`);
  }
  if (!ethers.isBytesLike(aiQuoteHash) || ethers.hexlify(aiQuoteHash).length !== 66) {
    throw new Error("aiQuoteHash must be a 32-byte hex value.");
  }

  const value = BigInt(totalPriceWei);
  if (value <= 0n) {
    throw new Error("Automatic lease creation requires a positive total price.");
  }
  const maxTotalBot = process.env.MAX_AUTO_LEASE_TOTAL_BOT || "1";
  const maxTotalWei = ethers.parseEther(maxTotalBot);
  const allowLargeLease =
    String(process.env.ALLOW_LARGE_AUTO_LEASE ?? "false").toLowerCase() ===
    "true";
  if (!allowLargeLease && value > maxTotalWei) {
    throw new Error(
      `Automatic lease price ${ethers.formatEther(value)} BOT exceeds the safety limit of ${maxTotalBot} BOT. Set ALLOW_LARGE_AUTO_LEASE=true only after reviewing the quote.`,
    );
  }

  const { escrow, provider, wallet } = getContracts();
  await assertLiveNetwork(provider);
  const balance = await provider.getBalance(wallet.address);
  if (balance < value) {
    throw new Error(
      `Insufficient wallet balance for lease creation: need ${value} wei, have ${balance} wei.`,
    );
  }

  const tx = await escrow.createLease(
    machineId,
    epochDuration,
    totalEpochs,
    aiQuoteHash,
    { value },
  );
  const receipt = await tx.wait();
  const event = parseEvent(
    receipt,
    new ethers.Interface(ESCROW_ABI),
    "LeaseCreated",
  );
  const leaseId = event?.args?.[0]?.toString();
  if (!leaseId) {
    throw new Error(
      `LeaseCreated event was not found in lease creation transaction ${receipt.hash}.`,
    );
  }

  const lease = await escrow.getLease(leaseId);
  if (!hasUnsettledEpochs(lease)) {
    throw new Error(`Created lease ${leaseId} is not active or has no escrow.`);
  }

  return {
    leaseId,
    lease,
    source: "created",
    createTxHash: receipt.hash,
    createBlockNumber: receipt.blockNumber,
  };
}

async function resolveLease(options = {}) {
  const explicitLeaseId =
    options.leaseId ?? process.env.DEMO_LEASE_ID?.trim();
  if (explicitLeaseId !== undefined && String(explicitLeaseId).trim() !== "") {
    const normalizedLeaseId = normalizeLeaseId(explicitLeaseId);
    if (!isLiveSettlementEnabled()) {
      return {
        leaseId: normalizedLeaseId,
        source: "explicit-override",
        lease: null,
      };
    }
    const lease = await getLease(normalizedLeaseId);
    if (!hasUnsettledEpochs(lease)) {
      throw new Error(
        `Explicit lease ${normalizedLeaseId} is not an active lease with unsettled epochs and escrow.`,
      );
    }
    return {
      leaseId: normalizedLeaseId,
      source: "explicit-override",
      lease,
    };
  }

  if (!isLiveSettlementEnabled()) {
    return {
      leaseId: String(options.simulatedLeaseId || "2"),
      source: "simulated-default",
      lease: null,
    };
  }

  const existing = await findAvailableLease();
  if (existing) return existing;

  const autoCreate =
    String(process.env.AUTO_CREATE_LEASE ?? "true").toLowerCase() === "true";
  if (!autoCreate) {
    throw new Error(
      "No active lease with unsettled epochs was found. Set AUTO_CREATE_LEASE=true or provide DEMO_LEASE_ID.",
    );
  }

  return createLease(options);
}

async function submitProof(leaseId, epoch, proofRecord) {
  if (!isLiveSettlementEnabled()) {
    const simulatedProofHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "bytes32", "address"],
        [leaseId, epoch, proofRecord.dataHash, ethers.ZeroAddress],
      ),
    );
    const record = saveProofRecord({
      ...proofRecord,
      proofHash: simulatedProofHash,
      proofMode: "simulated",
      status: "simulated",
    });
    return {
      ...record,
      routerTxHash: null,
      proofHash: simulatedProofHash,
    };
  }

  const { router, provider } = getContracts();
  await assertLiveNetwork(provider);
  const existingProof = await router.getProof(leaseId, epoch);
  if (existingProof && existingProof !== ethers.ZeroHash) {
    const record = saveProofRecord({
      ...proofRecord,
      proofHash: existingProof,
      proofMode: "existing-on-chain",
      routerTxHash: null,
      status: "proof-already-submitted",
    });
    return { ...record, routerTxHash: null, proofHash: existingProof };
  }

  // Persist the exact raw evidence before sending the router transaction. If
  // the process exits after the router confirms but before escrow settles, the
  // next run can resume with the same data instead of generating a new proof.
  saveProofRecord({
    ...proofRecord,
    proofMode: "live",
    status: "prepared",
  });
  const tx = await router.submitProof(
    leaseId,
    epoch,
    proofRecord.dataHash,
  );
  const receipt = await tx.wait();
  const parsed = parseEvent(
    receipt,
    new ethers.Interface(PROOF_ABI),
    "ProofSubmitted",
  );
  const proofHash =
    parsed?.args?.[3] || (await router.getProof(leaseId, epoch));

  if (!proofHash || proofHash === ethers.ZeroHash) {
    throw new Error(
      `ProofRouter did not return a proof hash for lease ${leaseId}, epoch ${epoch}.`,
    );
  }

  const record = saveProofRecord({
    ...proofRecord,
    proofHash,
    proofMode: "live",
    routerTxHash: receipt.hash,
    routerBlockNumber: receipt.blockNumber,
    status: "proof-submitted",
  });
  return { ...record, routerTxHash: receipt.hash, proofHash };
}

async function settleEpochUnlocked(leaseId, epoch, compliant, proofData) {
  if (!isLiveSettlementEnabled()) {
    const proofRecord = buildProofRecord({
      leaseId,
      epoch,
      compliant,
      proofData,
    });
    return submitProof(leaseId, epoch, proofRecord);
  }

  const existingEpoch = await getEpochInfo(leaseId, epoch);
  if (existingEpoch.status !== 0) {
    const existingRecord = getProofRecord(leaseId, epoch);
    return {
      ...(existingRecord || {
        leaseId: String(leaseId),
        epoch: String(epoch),
        compliant: Boolean(compliant),
      }),
      mode: "live",
      skipped: true,
      skipReason: "epoch-already-settled",
      onChainStatus: existingEpoch.status,
      onChainProofHash: existingEpoch.proofHash,
      proofHash: existingEpoch.proofHash,
      hash: null,
      routerTxHash: null,
      escrowTxHash: null,
    };
  }

  const storedRecord = getProofRecord(leaseId, epoch);
  if (
    storedRecord &&
    typeof storedRecord.rawProofData !== "string" &&
    storedRecord.proofHash
  ) {
    throw new Error(
      `Cannot resume lease ${leaseId}, epoch ${epoch}: stored proof is missing rawProofData.`,
    );
  }
  const proofRecord = storedRecord || buildProofRecord({
    leaseId,
    epoch,
    compliant,
    proofData,
  });
  const proof = await submitProof(leaseId, epoch, proofRecord);
  const { escrow, provider } = getContracts();
  await assertLiveNetwork(provider);
  const tx = await escrow.settleEpoch(
    leaseId,
    epoch,
    proof.compliant,
    proof.proofHash,
  );
  const receipt = await tx.wait();
  const event = parseEvent(
    receipt,
    new ethers.Interface(ESCROW_ABI),
    "EpochSettled",
  );
  const record = saveProofRecord({
    ...proof,
    escrowTxHash: receipt.hash,
    escrowBlockNumber: receipt.blockNumber,
    settlementEvent: event
      ? {
          leaseId: event.args[0].toString(),
          epoch: event.args[1].toString(),
          compliant: event.args[2],
          released: event.args[3].toString(),
        }
      : null,
    status: "settled",
  });

  const explorer = process.env.RPC_URL.includes("botchain.ai")
    ? "https://scan.botchain.ai"
    : "https://scan.bohr.life";

  return {
    ...record,
    mode: "live",
    hash: receipt.hash,
    routerTxHash: proof.routerTxHash,
    escrowTxHash: receipt.hash,
    explorerUrl: `${explorer}/tx/${receipt.hash}`,
    routerExplorerUrl: `${explorer}/tx/${proof.routerTxHash}`,
  };
}

async function settleEpoch(leaseId, epoch, compliant, proofData) {
  return withProofLock(`settlement-${leaseId}-${epoch}`, () =>
    settleEpochUnlocked(leaseId, epoch, compliant, proofData),
  );
}

async function getLease(leaseId) {
  const { escrow } = getReadOnlyContracts();
  return escrow.getLease(leaseId);
}

async function getEpochInfo(leaseId, epoch) {
  const { escrow } = getReadOnlyContracts();
  const result = await escrow.getEpochInfo(leaseId, epoch);
  return {
    status: Number(result.status),
    proofHash: result.proofHash,
  };
}

async function getProof(leaseId, epoch) {
  const { router } = getReadOnlyContracts();
  if (!router) throw new Error("PROOF_ROUTER is required for proof reads.");
  return router.getProof(leaseId, epoch);
}

async function getPendingWithdrawal(address) {
  const { escrow } = getReadOnlyContracts();
  return escrow.pendingWithdrawals(address);
}

async function getSettlementBalances(leaseId) {
  const lease = await getLease(leaseId);
  const [providerPending, buyerPending] = await Promise.all([
    getPendingWithdrawal(lease.provider),
    getPendingWithdrawal(lease.buyer),
  ]);
  return {
    provider: lease.provider,
    buyer: lease.buyer,
    providerPendingWei: providerPending.toString(),
    buyerPendingWei: buyerPending.toString(),
  };
}

async function verifyProofRecord(recordOrId) {
  const record =
    typeof recordOrId === "string"
      ? getProofRecordById(recordOrId)
      : recordOrId;
  if (!record) {
    return {
      verified: false,
      reason: "proof-record-not-found",
      dataHashMatches: false,
      escrowProofMatches: null,
      routerProofMatches: null,
      expectedDataHash: null,
    };
  }

  const hasRawProofData = typeof record.rawProofData === "string";
  const expectedDataHash = hasRawProofData
    ? ethers.keccak256(ethers.toUtf8Bytes(record.rawProofData))
    : null;
  const result = {
    dataHashMatches: Boolean(
      expectedDataHash && expectedDataHash === record.dataHash,
    ),
    escrowProofMatches: null,
    routerProofMatches: null,
    expectedDataHash,
  };

  try {
    const { escrow, router } = getReadOnlyContracts();
    const [epochInfo, routerProof] = await Promise.all([
      escrow.getEpochInfo(record.leaseId, record.epoch),
      router
        ? router.getProof(record.leaseId, record.epoch)
        : Promise.resolve(null),
    ]);
    result.escrowProofMatches = Boolean(
      record.proofHash &&
        epochInfo.proofHash.toLowerCase() === record.proofHash.toLowerCase(),
    );
    result.routerProofMatches = routerProof
      ? Boolean(
          record.proofHash &&
            routerProof.toLowerCase() === record.proofHash.toLowerCase(),
        )
      : null;
  } catch (error) {
    return {
      ...result,
      verified: false,
      reason: `chain-verification-failed: ${error.message}`,
    };
  }
  return {
    ...result,
    verified:
      result.dataHashMatches &&
      result.escrowProofMatches &&
      (result.routerProofMatches === null || result.routerProofMatches),
    reason: result.dataHashMatches
      ? undefined
      : hasRawProofData
        ? "raw-proof-data-does-not-match-data-hash"
        : "raw-proof-data-missing",
  };
}

async function getChainSummary(leaseId, epochs = []) {
  const { provider } = getReadOnlyContracts();
  const network = await provider.getNetwork();
  const lease = await getLease(leaseId);
  const epochInfo = [];
  for (const epoch of epochs) {
    epochInfo.push({
      epoch: String(epoch),
      ...(await getEpochInfo(leaseId, epoch)),
      routerProofHash: await getProof(leaseId, epoch),
    });
  }
  return {
    chainId: network.chainId.toString(),
    lease: {
      machineId: lease.machineId.toString(),
      provider: lease.provider,
      buyer: lease.buyer,
      pricePerEpoch: lease.pricePerEpoch.toString(),
      epochDuration: lease.epochDuration.toString(),
      totalEpochs: lease.totalEpochs.toString(),
      epochsSettled: lease.epochsSettled.toString(),
      escrowBalance: lease.escrowBalance.toString(),
      startTime: lease.startTime.toString(),
      status: Number(lease.status),
      aiQuoteHash: lease.aiQuoteHash,
    },
    epochs: epochInfo,
    balances: await getSettlementBalances(leaseId),
  };
}

module.exports = {
  settleEpoch,
  submitProof,
  getContracts,
  getReadOnlyContracts,
  getLeaseCount,
  hasUnsettledEpochs,
  normalizeLeaseId,
  findAvailableLease,
  createLease,
  resolveLease,
  getLease,
  getEpochInfo,
  getProof,
  getPendingWithdrawal,
  getSettlementBalances,
  verifyProofRecord,
  getChainSummary,
  assertLiveNetwork,
  isLiveSettlementEnabled,
};
