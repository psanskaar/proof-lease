const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

function getStorePath() {
  return process.env.PROOF_STORE_PATH || path.join(process.cwd(), "data", "proofs.json");
}

function readStore() {
  const storePath = getStorePath();
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    if (!parsed || !Array.isArray(parsed.proofs)) {
      throw new Error(`Invalid proof store format: ${storePath}`);
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { proofs: [] };
    }
    throw error;
  }
}

function writeStore(store) {
  const storePath = getStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, storePath);
}

function buildProofRecord({ leaseId, epoch, compliant, proofData }) {
  const dataHash = ethers.keccak256(ethers.toUtf8Bytes(proofData));
  return {
    id: `${leaseId}:${epoch}:${dataHash}`,
    leaseId: String(leaseId),
    epoch: String(epoch),
    compliant: Boolean(compliant),
    rawProofData: proofData,
    dataHash,
    status: "prepared",
    createdAt: new Date().toISOString(),
  };
}

function saveProofRecord(record) {
  const store = readStore();
  const index = store.proofs.findIndex((item) => item.id === record.id);
  if (index === -1) {
    store.proofs.push(record);
  } else {
    store.proofs[index] = { ...store.proofs[index], ...record };
  }
  writeStore(store);
  return record;
}

function getProofRecord(leaseId, epoch) {
  const matches = readStore().proofs.filter(
    (record) =>
      record.leaseId === String(leaseId) && record.epoch === String(epoch),
  );
  return matches.at(-1);
}

function getProofRecordById(id) {
  return readStore().proofs.find((record) => record.id === String(id));
}

function listProofRecords() {
  return readStore().proofs;
}

async function withProofLock(key, fn, options = {}) {
  const safeKey = String(key).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const lockPath = `${getStorePath()}.${safeKey}.lock`;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const retryMs = options.retryMs ?? 100;
  const staleMs = options.staleMs ?? 120_000;
  const startedAt = Date.now();
  let heartbeat;

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, `${process.pid}\n`, "utf8");
      fs.closeSync(fd);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > staleMs) fs.unlinkSync(lockPath);
      } catch {
        // The lock disappeared between the stat and unlink attempts.
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for proof lock: ${key}`);
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }

  const heartbeatMs = Math.max(1_000, Math.floor(staleMs / 3));
  heartbeat = setInterval(() => {
    try {
      const now = new Date();
      fs.utimesSync(lockPath, now, now);
    } catch {
      // The lock is cleaned up by the owner if it disappears unexpectedly.
    }
  }, heartbeatMs);
  heartbeat.unref?.();

  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    try {
      fs.unlinkSync(lockPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

module.exports = {
  getStorePath,
  buildProofRecord,
  saveProofRecord,
  getProofRecord,
  getProofRecordById,
  listProofRecords,
  withProofLock,
};
