const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { getLocalRiskScore } = require("../riskScorer");
const { getLocalQuote, normalizeGroqQuote, toWei } = require("../quoteEngine");
const {
  buildProofRecord,
  saveProofRecord,
  getProofRecord,
  withProofLock,
} = require("../proofStore");
const {
  hasUnsettledEpochs,
  resolveLease,
  normalizeLeaseId,
} = require("../settlementBot");

test("risk scoring applies the documented rules", () => {
  const now = Math.floor(Date.now() / 1000);
  const result = getLocalRiskScore({
    hardwareClass: "GPU-RTX4090",
    region: "asia-pacific",
    lastHeartbeat: now - 31 * 60,
    registeredAt: now - 2 * 3600,
    attestationURI: "",
    reputationScore: 350,
  });

  assert.equal(result.score, 0);
  assert.equal(result.tier, "HIGH");
  assert.equal(result.eligible, false);
});

test("quote pricing is deterministic and produces wei values", () => {
  const result = getLocalQuote({
    hardwareClass: "GPU-RTX4090",
    epochDuration: 60,
    totalEpochs: 5,
    riskScore: 65,
  });

  assert.equal(result.pricePerEpochBOT, "0.100000");
  assert.equal(result.totalPriceBOT, "0.500000");
  assert.equal(result.discount, "25%");
});

test("proof records persist raw data and its keccak hash", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prooflease-"));
  const previousPath = process.env.PROOF_STORE_PATH;
  process.env.PROOF_STORE_PATH = path.join(tempDir, "proofs.json");

  try {
    const record = buildProofRecord({
      leaseId: 11,
      epoch: 3,
      compliant: false,
      proofData: "heartbeat-gap-demo",
    });
    saveProofRecord(record);
    const stored = getProofRecord(11, 3);
    assert.equal(stored.rawProofData, "heartbeat-gap-demo");
    assert.equal(stored.dataHash, record.dataHash);
    assert.equal(stored.compliant, false);
  } finally {
    if (previousPath === undefined) delete process.env.PROOF_STORE_PATH;
    else process.env.PROOF_STORE_PATH = previousPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("simulation routes proofs before settlement without chain writes", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prooflease-"));
  const previousPath = process.env.PROOF_STORE_PATH;
  const previousMode = process.env.SETTLEMENT_MODE;
  process.env.PROOF_STORE_PATH = path.join(tempDir, "proofs.json");
  process.env.SETTLEMENT_MODE = "simulated";

  try {
    const { settleEpoch } = require("../settlementBot");
    const result = await settleEpoch(99, 0, true, "simulated-proof");
    assert.equal(result.proofMode, "simulated");
    assert.equal(result.routerTxHash, null);
    assert.match(result.proofHash, /^0x[0-9a-f]{64}$/);
    assert.equal(getProofRecord(99, 0).rawProofData, "simulated-proof");
  } finally {
    if (previousPath === undefined) delete process.env.PROOF_STORE_PATH;
    else process.env.PROOF_STORE_PATH = previousPath;
    if (previousMode === undefined) delete process.env.SETTLEMENT_MODE;
    else process.env.SETTLEMENT_MODE = previousMode;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("proof records reject tampering when raw data changes", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prooflease-"));
  const previousPath = process.env.PROOF_STORE_PATH;
  process.env.PROOF_STORE_PATH = path.join(tempDir, "proofs.json");

  try {
    const record = buildProofRecord({
      leaseId: 12,
      epoch: 0,
      compliant: true,
      proofData: "original-proof",
    });
    saveProofRecord(record);
    const stored = getProofRecord(12, 0);
    stored.rawProofData = "tampered-proof";
    assert.notEqual(
      require("ethers").keccak256(
        require("ethers").toUtf8Bytes(stored.rawProofData),
      ),
      stored.dataHash,
    );
  } finally {
    if (previousPath === undefined) delete process.env.PROOF_STORE_PATH;
    else process.env.PROOF_STORE_PATH = previousPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("lease selection recognizes only active leases with unsettled escrow", () => {
  const baseLease = {
    provider: "0x0000000000000000000000000000000000000001",
    totalEpochs: 5n,
    epochsSettled: 2n,
    escrowBalance: 100n,
    status: 0,
  };

  assert.equal(hasUnsettledEpochs(baseLease), true);
  assert.equal(
    hasUnsettledEpochs({ ...baseLease, epochsSettled: 5n }),
    false,
  );
  assert.equal(
    hasUnsettledEpochs({ ...baseLease, escrowBalance: 0n }),
    false,
  );
  assert.equal(
    hasUnsettledEpochs({ ...baseLease, status: 1 }),
    false,
  );
  assert.equal(
    hasUnsettledEpochs({
      ...baseLease,
      provider: "0x0000000000000000000000000000000000000000",
    }),
    false,
  );
});

test("simulated lease resolution does not require a manually entered ID", async () => {
  const previousMode = process.env.SETTLEMENT_MODE;
  const previousId = process.env.DEMO_LEASE_ID;
  process.env.SETTLEMENT_MODE = "simulated";
  delete process.env.DEMO_LEASE_ID;

  try {
    const result = await resolveLease({ simulatedLeaseId: "simulated-auto-target" });
    assert.equal(result.leaseId, "simulated-auto-target");
    assert.equal(result.source, "simulated-default");
  } finally {
    if (previousMode === undefined) delete process.env.SETTLEMENT_MODE;
    else process.env.SETTLEMENT_MODE = previousMode;
    if (previousId === undefined) delete process.env.DEMO_LEASE_ID;
    else process.env.DEMO_LEASE_ID = previousId;
  }
});

test("unsafe or incomplete AI quotes fall back to deterministic pricing", () => {
  const request = {
    hardwareClass: "GPU-RTX4090",
    region: "asia-pacific",
    epochDuration: 60,
    totalEpochs: 5,
    riskScore: 65,
  };
  const local = getLocalQuote(request);
  const result = normalizeGroqQuote(
    { pricePerEpochBOT: "0.2", totalPriceBOT: "0.9" },
    local,
    request,
  );

  assert.equal(result.mode, "local-fallback");
  assert.equal(result.pricePerEpochBOT, local.pricePerEpochBOT);
  assert.equal(result.totalPriceWei, toWei(local.totalPriceBOT).toString());
  assert.match(result.quoteWarning, /unsafe price/);
});

test("proof locks serialize work and clean up after failures", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "prooflease-"));
  const previousPath = process.env.PROOF_STORE_PATH;
  process.env.PROOF_STORE_PATH = path.join(tempDir, "proofs.json");

  try {
    const order = [];
    const first = withProofLock("same-epoch", async () => {
      order.push("first-start");
      await new Promise((resolve) => setTimeout(resolve, 15));
      order.push("first-end");
    });
    const second = withProofLock("same-epoch", async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first-start", "first-end", "second"]);
    await assert.rejects(
      withProofLock("failure", async () => {
        throw new Error("expected");
      }),
      /expected/,
    );
    await withProofLock("failure", async () => {});
  } finally {
    if (previousPath === undefined) delete process.env.PROOF_STORE_PATH;
    else process.env.PROOF_STORE_PATH = previousPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("lease overrides must be positive contract-assigned IDs", () => {
  assert.equal(normalizeLeaseId("12"), "12");
  assert.throws(() => normalizeLeaseId("0"), /positive integer/);
  assert.throws(() => normalizeLeaseId("random"), /positive integer/);
  assert.throws(() => normalizeLeaseId("1.5"), /positive integer/);
});
