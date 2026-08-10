# ProofLease - Verifiable Compute Leases on BOT Chain

> AI-verified SLA settlement for GPU and CPU compute leases. Providers register machines as RWA assets. Buyers escrow BOT. An AI agent monitors heartbeat proofs and settles each epoch automatically - compliant epochs release payment, breaches refund the buyer. Every decision is anchored to a verifiable on-chain proof hash.

Built for **BOT Chain Builder Challenge #2** - AI x RWA track.

---

## Judge Path

| | Testnet (Bohr) | Mainnet |
|---|---|---|
| **AssetRegistry** | [0xE147...Ce6f](https://scan.bohr.life/address/0xE147555124044D5EbDc7B702fAc8EE8d6FCfCe6f) | FILL_AFTER_DEPLOY |
| **LeaseEscrow** | [0x8f4a...DC4](https://scan.bohr.life/address/0x8f4a193B4DeAaF619d46b2f4934a9557169AFdC4) | FILL_AFTER_DEPLOY |
| **ProofRouter** | [0xe3A6...364](https://scan.bohr.life/address/0xe3A60feE5562108cAFd72e4e0f4271a5757c4364) | FILL_AFTER_DEPLOY |
| **Reputation** | [0x3872...BAa](https://scan.bohr.life/address/0x3872A0D2EFEe103396eB8CE5c35f09FeE1fAFBAa) | FILL_AFTER_DEPLOY |

### Live Testnet Transactions

| Action | TX |
|---|---|
| Machine registered | [0xf89c...fcd](https://scan.bohr.life/tx/0xf89c9c8598f5bed215ff2d766ef3a588cd53219b79766e66cdd6b9441ba25fcd) |
| Lease created (0.005 BOT escrowed) | [0x5a75...07](https://scan.bohr.life/tx/0x5a75a7aa1781280c73cd6d85c0a578153d5786d4385d42df9bd0de32f9549e07) |
| Proof submitted to ProofRouter | [0x2e38...f3](https://scan.bohr.life/tx/0x2e3874621bde322c70338f1d3a4716a049cd12ec9aac3bcda7c11a60c78c03f3) |
| Epoch 0 settled - compliant | [0x5f92...12](https://scan.bohr.life/tx/0x5f923d0d5db6341c4d7310b5458969b073c0543b7a83ce86aedc827a89788f12) |
| Epoch 1 settled - breach | [0x8b7d...72](https://scan.bohr.life/tx/0x8b7deb06f5ded89fb27afcfa577cb3e3e56d57f33fcc3c4bc7f9e1d2e57ef272) |
| Provider withdrawal | [0xc9e7...a6](https://scan.bohr.life/tx/0xc9e7242cabd84c70804dd26cb6fa911ff285ab65033da8aebbcb4d7e761979a6) |

---

## How It Works

```
Provider registers machine -> AI scores risk -> AI generates quote
-> Buyer escrows BOT -> Provider sends heartbeat proofs each epoch
-> AI agent evaluates proof -> Compliant: BOT released to provider
                            -> Breach: epoch payment refunded to buyer
-> Lease completes -> Reputation score updated on-chain
```

The AI agent (Claude Sonnet) handles three jobs:
- **Risk scoring** - evaluates provider history, heartbeat freshness, attestation
- **Quote generation** - prices capacity against market rates with rationale
- **Epoch settlement** - calls settleEpoch() based on proof validity

The agent is policy-bounded. It can only call settleEpoch(). It cannot move funds, modify contracts, or override dispute resolution. All fund movements go through the pull-payment withdrawal pattern.

---

## Architecture

```
contracts/
  src/
    interfaces/IProofLease.sol   - shared structs and events
    AssetRegistry.sol            - machine registration and bonding
    LeaseEscrow.sol              - escrow, epoch settlement, disputes
    ProofRouter.sol              - signed heartbeat proof storage
    Reputation.sol               - non-transferable provider score
  test/
    ProofLease.t.sol             - 15 Foundry tests, all passing
  script/
    Deploy.s.sol                 - single-command deployment

agent/
  index.js                       - demo agent loop
  riskScorer.js                  - Claude API risk assessment
  quoteEngine.js                 - Claude API dynamic pricing
  settlementBot.js               - on-chain settlement via ethers.js

frontend/
  app/
    page.tsx                     - marketplace landing
    verify/page.tsx              - proof hash verifier
```

---

## Why BOT Chain

BOT Chain's roadmap includes vCompute (Verifiable Computation Layer) and Compute Node Activation, which onboards physical GPU and CPU hardware as DePIN nodes. ProofLease is the user-facing marketplace for that infrastructure: hardware operators earn by contributing capacity, buyers get SLA-guaranteed compute, and BOT token is the settlement currency for the entire loop.

BOT Chain's 0.75-second blocks and near-zero fees make epoch-by-epoch proof settlement economically viable. On Ethereum mainnet the gas cost per epoch would exceed the payment itself.

---

## Smart Contract Design Decisions

**Pull payment pattern** - pendingWithdrawals mapping prevents reentrancy. Funds are queued, not pushed.

**Epoch-ordered settlement** - require(epoch == lease.epochsSettled) enforces strict sequence. No skipping, no replaying.

**Replay protection** - EpochStatus.Pending check fires before epoch-order check, so a replay attempt on a settled epoch returns "Already settled" not a misleading "Wrong epoch".

**Agent oracle separation** - only the agentOracle address can call settleEpoch(). The agent wallet has no other permissions. Owner retains dispute resolution via resolveDispute().

**2% platform fee** - deducted from provider payment on compliant epochs only. Breach epochs refund the full epoch amount to the buyer.

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

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Clone and install deps
git clone https://github.com/psanskaar/proof-lease
cd proof-lease/contracts
forge install OpenZeppelin/openzeppelin-contracts --no-commit

# Run tests
forge test -vvv

# Deploy to testnet
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.bohr.life \
  --broadcast -vvvv

# Deploy to mainnet
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.botchain.ai \
  --broadcast -vvvv
```

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
- **AI Agent** - Claude Sonnet (Anthropic), ethers.js v6, Node.js
- **Frontend** - Next.js 14, wagmi v2, viem, RainbowKit, Tailwind CSS
- **Deploy** - GitHub Codespaces, Foundry forge script, Vercel

---

## Deployments

See [deployments/bohr-testnet.json](./deployments/bohr-testnet.json) for the full testnet deployment record.
Mainnet deployment record will be added at [deployments/bot-mainnet.json](./deployments/bot-mainnet.json) after gas support is received.
