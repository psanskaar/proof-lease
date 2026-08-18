# ProofLease - Verifiable Compute Leases on BOT Chain

> AI-verified SLA settlement for GPU and CPU compute leases. Providers register machines as RWA assets. Buyers escrow BOT. An AI agent monitors heartbeat proofs each epoch and settles automatically - compliant epochs release payment, breaches refund the buyer. Every decision is anchored to a verifiable on-chain proof hash and explained in plain language by the AI.

Built for **BOT Chain Builder Challenge #2** - AI × RWA track.

---

## Judge Path

| | Live App | Testnet (Bohr) | Mainnet |
|---|---|---|---|
| **Frontend** | [proof-lease.vercel.app](https://proof-lease.vercel.app/marketplace) | - | - |
| **AssetRegistry** | - | [0xE147...Ce6f](https://scan.bohr.life/address/0xE147555124044D5EbDc7B702fAc8EE8d6FCfCe6f) | [0xE147...Ce6f](https://scan.botchain.ai/address/0xE147555124044D5EbDc7B702fAc8EE8d6FCfCe6f) |
| **LeaseEscrow** | - | [0x8f4a...DC4](https://scan.bohr.life/address/0x8f4a193B4DeAaF619d46b2f4934a9557169AFdC4) | [0x8f4a...DC4](https://scan.botchain.ai/address/0x8f4a193B4DeAaF619d46b2f4934a9557169AFdC4) |
| **ProofRouter** | - | [0xe3A6...364](https://scan.bohr.life/address/0xe3A60feE5562108cAFd72e4e0f4271a5757c4364) | [0xe3A6...364](https://scan.botchain.ai/address/0xe3A60feE5562108cAFd72e4e0f4271a5757c4364) |
| **Reputation** | - | [0x3872...BAa](https://scan.bohr.life/address/0x3872A0D2EFEe103396eB8CE5c35f09FeE1fAFBAa) | [0x3872...BAa](https://scan.botchain.ai/address/0x3872A0D2EFEe103396eB8CE5c35f09FeE1fAFBAa) |

Contract addresses are identical on testnet and mainnet - same deployer wallet and nonce sequence produces deterministic EVM addresses.

### Verified Transactions (Mainnet — full lifecycle)

| Action | TX |
|---|---|
| Machine registered | [0x229951...f420](https://scan.botchain.ai/tx/0x229951e8d4a3482cd6c1862091c99df36116aa501762c674413bab91cf42f420) |
| Lease created (0.005 BOT escrowed) | [0x472984...8b5b](https://scan.botchain.ai/tx/0x472984545f3769fbd1214ae74fcc57cb3e44f6a8f48b3d2b2cb781da62b88b5b) |
| Proof submitted to ProofRouter (epoch 0) | [0x981b4c...b77e](https://scan.botchain.ai/tx/0x981b4c92c22c9a0138b0b68bc993a5a0ffd1738903e80ce442650a81087ab77e) |
| Epoch 0 settled — compliant | [0x314a3a...34f9](https://scan.botchain.ai/tx/0x314a3ae5f8c7bc27bda3f25af22d9fbdb01b89a0aa3d5a34225025e05fa934f9) |
| Proof submitted to ProofRouter (epoch 1) | [0x49ea21...e04d](https://scan.botchain.ai/tx/0x49ea21df8ec41a877b63ad1c72b13a6860b9ee8b1a0a8008264ee2c4c5a3e04d) |
| Epoch 1 settled — breach | [0xb8f019...d73a](https://scan.botchain.ai/tx/0xb8f01930218e5629f5e90e09fcc560a91a6d11a681ba59602073cadb9879d73a) |
| Provider withdrawal | [0x3d7c68...0f23](https://scan.botchain.ai/tx/0x3d7c6821b91c86116ae2ee5485acbbb3653660318a2f1732f5d219a98ba20f23) |

Machine ID: 4  |  Lease ID: 5  |  Deployer: [0x72CD...3945](https://scan.botchain.ai/address/0x72CD637431ea7cE9374CAdeb4F036ae14a6f3945)

<details>
<summary>Testnet (Bohr) — same lifecycle, run prior to mainnet</summary>

| Action | TX |
|---|---|
| Machine registered | [0xf89c...fcd](https://scan.bohr.life/tx/0xf89c9c8598f5bed215ff2d766ef3a588cd53219b79766e66cdd6b9441ba25fcd) |
| Lease created (0.005 BOT escrowed) | [0x5a75...07](https://scan.bohr.life/tx/0x5a75a7aa1781280c73cd6d85c0a578153d5786d4385d42df9bd0de32f9549e07) |
| Proof submitted to ProofRouter | [0x2e38...f3](https://scan.bohr.life/tx/0x2e3874621bde322c70338f1d3a4716a049cd12ec9aac3bcda7c11a60c78c03f3) |
| Epoch 0 settled — compliant | [0x5f92...12](https://scan.bohr.life/tx/0x5f923d0d5db6341c4d7310b5458969b073c0543b7a83ce86aedc827a89788f12) |
| Epoch 1 settled — breach | [0x8b7d...72](https://scan.bohr.life/tx/0x8b7deb06f5ded89fb27afcfa577cb3e3e56d57f33fcc3c4bc7f9e1d2e57ef272) |
| Provider withdrawal | [0xc9e7...a6](https://scan.bohr.life/tx/0xc9e7242cabd84c70804dd26cb6fa911ff285ab65033da8aebbcb4d7e761979a6) |

</details>

---

## How It Works

The AI agent handles four jobs:

- **Risk scoring** - evaluates provider heartbeat freshness, platform age, and reputation score using Groq (qwen/qwen3.6-27b) with a local deterministic fallback. Risk scoring is intentionally deterministic: non-deterministic AI deciding whether escrow releases is a security liability, not a feature.
- **Quote generation** - prices capacity against centralised market rates and returns a plain-language rationale for the price.
- **Epoch settlement** - reads the provider's last on-chain heartbeat, submits a proof to ProofRouter, then calls `settleEpoch()` on LeaseEscrow. Compliant epochs pay the provider; breaches refund the buyer in full.
- **Settlement rationale** - after each epoch settles, Groq generates a one-sentence plain-language explanation of the decision (e.g. "Heartbeat was 420s stale against a 300s threshold - breach, full refund issued to buyer"). This is stored in the proof record and shown in the activity feed alongside the on-chain proof hash.

The agent is policy-bounded. It can only call `settleEpoch()`. It cannot move funds, modify contracts, or override dispute resolution. All fund movements go through the pull-payment withdrawal pattern.

---

## Contracts

```
contracts/
  src/
    interfaces/IProofLease.sol   - shared structs and events
    AssetRegistry.sol            - machine registration and bonding
    LeaseEscrow.sol              - escrow, epoch settlement, disputes
    ProofRouter.sol              - heartbeat proof storage
    Reputation.sol               - non-transferable provider score
  test/
    ProofLease.t.sol             - 15 Foundry tests, all passing
  script/
    Deploy.s.sol                 - single-command deployment
deployments/
  bohr-testnet.json              - testnet contract addresses
  bot-mainnet.json               - mainnet contract addresses
```

---

## Agent

```
agent/
  server.js         - HTTP server (tick loop + /health + /proofs API)
  index.js          - standalone demo runner
  riskScorer.js     - Groq + local fallback risk scoring
  quoteEngine.js    - Groq + local fallback quote generation
  settlementBot.js  - ProofRouter submission and epoch settlement
  proofStore.js     - file-locked proof persistence with keccak verification
  data/proofs.json  - proof records from live runs
  test/test.js      - 9 Node.js tests covering all modules
  render.yaml       - Render.com deployment config
  .env.example      - environment variable reference
```

The agent server runs a tick loop every 30 seconds:

1. Finds the next active lease with unsettled epochs
2. Reads the provider's last heartbeat timestamp from AssetRegistry on-chain
3. Scores risk via Groq AI (fallback to local logic if unavailable)
4. Marks the epoch compliant (heartbeat within 300s) or breach (stale)
5. Submits proof to ProofRouter then calls `settleEpoch()` on LeaseEscrow
6. Calls Groq to generate a plain-language `settlementRationale` explaining the decision
7. Persists the full record - proof hash, tx hashes, risk score, AI rationale - to `proofs.json`

The agent exposes:

- `GET /health` - agent status, uptime, tick count, last error
- `GET /proofs` - all settlement records sorted newest first, including `settlementRationale`
- `GET /proofs/:leaseId/:epoch` - single epoch record

The agent runs in two modes via `SETTLEMENT_MODE`:

- **simulated** (default) - full pipeline with no chain writes
- **live** - submits to ProofRouter and calls `settleEpoch()` on-chain

---

## Frontend

```
frontend/
  app/
    page.tsx              - landing page with contract table and how it works
    marketplace/page.tsx  - machine listings, risk scores, lease creation modal, My Leases
    provider/page.tsx     - provider dashboard, machine registration, withdraw, heartbeat guide
    activity/page.tsx     - live agent feed merged with on-chain EpochSettled events
    verify/page.tsx       - proof hash verifier with live ProofRouter.getProof() reads
```

The activity page fetches from the agent API and independently reads `EpochSettled` events from LeaseEscrow via wagmi. Both sources are merged by lease ID and epoch - each card shows the full picture: the AI's `settlementRationale` in plain English, the risk score that informed it, the proof hash anchored on-chain, and explorer links to both transactions.

The verify page reads `ProofRouter.getProof(leaseId, epoch)` live from the chain and lets anyone recompute the keccak256 hash from the raw proof string to confirm the agent's decision was based on real data.

---

## Why BOT Chain

BOT Chain's roadmap includes vCompute (Verifiable Computation Layer) and Compute Node Activation, which onboards physical GPU and CPU hardware as DePIN nodes. ProofLease is the user-facing marketplace for that infrastructure: hardware operators earn by contributing capacity, buyers get SLA-guaranteed compute, and BOT token is the settlement currency for the entire loop.

BOT Chain's 0.75-second blocks and near-zero fees make epoch-by-epoch proof settlement economically viable. On Ethereum mainnet the gas cost per epoch would exceed the payment itself.

---

## Smart Contract Design Decisions

**Pull payment pattern** - `pendingWithdrawals` mapping prevents reentrancy. Funds are queued, never pushed.

**Epoch-ordered settlement** - `require(epoch == lease.epochsSettled)` enforces strict sequence. No skipping, no replaying.

**Replay protection** - `EpochStatus.Pending` check fires before the epoch-order check, so a replay attempt on a settled epoch returns "Already settled" rather than a misleading "Wrong epoch".

**Agent oracle separation** - only the `agentOracle` address can call `settleEpoch()`. The agent wallet has no other permissions. Owner retains dispute resolution via `resolveDispute()`.

**Deterministic risk scoring** - scoring rules are implemented identically in the agent (local fallback) and surfaced to Groq in the prompt. This ensures the AI's output is verifiable and bounded - a non-deterministic model freely deciding escrow release would be a security anti-pattern.

**2% platform fee** - deducted from provider payment on compliant epochs only. Breach epochs refund the full epoch amount to the buyer.

---

## Known Limitations (MVP scope)

`touchHeartbeat` in AssetRegistry is currently permissionless - any address can update any machine's timestamp. In a production deployment this would be restricted to the machine's registered provider. Similarly, `ProofRouter.submitProof` would be gated to the agent oracle address. These are intentional prototype simplifications; the settlement logic that actually controls fund movement is correctly access-controlled via `onlyAgent` on `LeaseEscrow.settleEpoch()`.

---

## Test Coverage

```
forge test -vvv

Ran 15 tests for test/ProofLease.t.sol:ProofLeaseTest
[PASS] test_HappyPath
[PASS] test_BreachHoldsPaymentRefundsBuyer
[PASS] test_ReplayProtection
[PASS] test_OnlyAgentCanSettle
[PASS] test_DisputeFlow
[PASS] test_WithdrawalPullPattern
[PASS] test_FundAccounting
[PASS] test_LeaseAutoCompletesAfterAllEpochs
[PASS] test_PlatformFeeIsExactly2Pct
[PASS] test_CannotLeaseInactiveMachine
[PASS] test_CannotLeaseWithZeroValue
[PASS] test_StrangerCannotRaiseDispute
[PASS] test_ResolveDispute
[PASS] test_ProofRouterStoresHash
[PASS] test_ReputationUpdatesAfterLease

15 passed; 0 failed
```

---

## Build and Deploy

### Contracts

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup

git clone https://github.com/psanskaar/proof-lease
cd proof-lease/contracts
forge install OpenZeppelin/openzeppelin-contracts

forge test -vvv

forge script script/Deploy.s.sol \
  --rpc-url https://rpc.bohr.life \
  --broadcast -vvvv
```

### Agent

```bash
cd agent
cp .env.example .env
# Add GROQ_API_KEY and PRIVATE_KEY

npm install
npm start          # simulated mode
```

To deploy the agent as a live service, connect the repo to [Render.com](https://render.com) - the `render.yaml` in the agent folder configures everything. Add `GROQ_API_KEY` and `PRIVATE_KEY` as environment secrets in the Render dashboard.

### Frontend

```bash
cd frontend
cp .env.local.example .env.local
# Set NEXT_PUBLIC_AGENT_URL to your Render agent URL

npm install
npm run dev
```

Deploy to Vercel by importing the GitHub repo and setting root directory to `frontend`.

---

## Network Config

| | Testnet | Mainnet |
|---|---|---|
| Chain ID | 968 | 677 |
| RPC | https://rpc.bohr.life | https://rpc.botchain.ai |
| Explorer | https://scan.bohr.life | https://scan.botchain.ai |
| Faucet | https://faucet.botchain.ai/basic | - |

---

## Stack

- **Contracts** - Solidity 0.8.24, Foundry, OpenZeppelin
- **AI Agent** - Node.js, ethers.js v6, Groq (qwen/qwen3.6-27b) with local fallback, deployed on Render
- **Frontend** - Next.js 14, wagmi v2, viem, RainbowKit, Tailwind CSS, deployed on Vercel

---

## Deployments

See [deployments/bohr-testnet.json](./deployments/bohr-testnet.json) for the testnet deployment record.
See [deployments/bot-mainnet.json](./deployments/bot-mainnet.json) for the mainnet deployment record.