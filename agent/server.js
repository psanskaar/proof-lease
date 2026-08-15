require('dotenv').config()
const http  = require('http')
const fs    = require('fs')
const path  = require('path')
const ethers = require('ethers')

const { scoreMachineRisk }              = require('./riskScorer')
const { findAvailableLease, settleEpoch } = require('./settlementBot')

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  startTime:      new Date().toISOString(),
  mode:           process.env.SETTLEMENT_MODE || 'simulated',
  lastTick:       null,
  lastTickStatus: 'pending',
  tickCount:      0,
  leasesSettled:  0,
  lastError:      null,
}

const PORT          = process.env.PORT          || 3000
const POLL_MS       = Number(process.env.POLL_MS       || 30_000)
const HEARTBEAT_MAX = Number(process.env.HEARTBEAT_MAX || 300)
const RPC_URL       = process.env.RPC_URL       || 'https://rpc.bohr.life'
const EXPLORER      = 'https://scan.bohr.life'
const IS_LIVE       = state.mode === 'live'

// ─── Proof store ──────────────────────────────────────────────────────────────
const PROOFS_FILE = path.join(__dirname, 'data', 'proofs.json')

function readProofs() {
  try { return JSON.parse(fs.readFileSync(PROOFS_FILE, 'utf8')) }
  catch { return {} }
}

function writeProof(leaseId, epoch, entry) {
  const all = readProofs()
  all[`${leaseId}-${epoch}`] = { ...all[`${leaseId}-${epoch}`], ...entry }
  fs.mkdirSync(path.dirname(PROOFS_FILE), { recursive: true })
  fs.writeFileSync(PROOFS_FILE, JSON.stringify(all, null, 2))
}

// ─── Chain read — machine heartbeat ──────────────────────────────────────────
const REGISTRY_ABI = [
  'function getMachine(uint256 machineId) external view returns (tuple(address provider, bytes32 hardwareHash, string region, string hardwareClass, string attestationURI, uint256 registeredAt, uint256 lastHeartbeat, uint8 status))',
]

async function getMachine(machineId) {
  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const registry = new ethers.Contract(process.env.ASSET_REGISTRY, REGISTRY_ABI, provider)
  return await registry.getMachine(machineId)
}

// ─── Tick ─────────────────────────────────────────────────────────────────────
async function tick() {
  state.tickCount++
  state.lastTick = new Date().toISOString()
  console.log(`\n[${state.lastTick}] Tick #${state.tickCount}`)

  if (!IS_LIVE) {
    state.lastTickStatus = 'SIMULATED — set SETTLEMENT_MODE=live to activate'
    console.log('  SIMULATED — no chain reads or writes')
    return
  }

  try {
    const found = await findAvailableLease()
    if (!found) {
      state.lastTickStatus = 'no active leases'
      console.log('  No active leases with unsettled epochs')
      return
    }

    const { leaseId, lease } = found
    const epoch     = Number(lease.epochsSettled)
    const machineId = Number(lease.machineId)
    console.log(`  Lease #${leaseId} | Machine #${machineId} | Epoch ${epoch}/${Number(lease.totalEpochs)}`)

    // 1. Read heartbeat from chain
    const machine   = await getMachine(machineId)
    const staleSecs = Math.floor(Date.now() / 1000) - Number(machine.lastHeartbeat)
    const compliant = staleSecs <= HEARTBEAT_MAX
    console.log(`  Heartbeat: ${staleSecs}s ago → ${compliant ? 'COMPLIANT ✅' : 'BREACH ❌'}`)

    // 2. Groq AI risk scoring
    let riskResult = {
      score: 50, tier: 'MEDIUM',
      reasons: ['Fallback scoring — Groq unavailable'],
      mode: 'local',
    }
    try {
      riskResult = await scoreMachineRisk({
        hardwareClass:   machine.hardwareClass,
        region:          machine.region,
        lastHeartbeat:   Number(machine.lastHeartbeat),
        registeredAt:    Number(machine.registeredAt),
        attestationURI:  machine.attestationURI,
        reputationScore: 500,
      })
      console.log(`  AI Risk: ${riskResult.score}/100 (${riskResult.tier}) via ${riskResult.mode}`)
    } catch (e) {
      console.log(`  AI Risk: skipped (${e.message})`)
    }

    // 3. Build human-readable reasoning from the AI result + compliance decision
    const groqReasoning = [
      `Risk assessment: ${riskResult.score}/100 — ${riskResult.tier} tier.`,
      riskResult.reasons.join(' '),
      compliant
        ? `Heartbeat received ${staleSecs}s ago, within the ${HEARTBEAT_MAX}s SLA window. Epoch marked COMPLIANT — payment released to provider.`
        : `Heartbeat is ${staleSecs}s stale, exceeding the ${HEARTBEAT_MAX}s SLA threshold. Epoch marked BREACH — buyer refunded.`,
      riskResult.mode === 'groq'
        ? 'Scored by Groq AI (llama-3.3-70b-versatile).'
        : 'Local fallback scoring applied.',
    ].join(' ')

    // 4. Settle on-chain
    const proofData = `lease-${leaseId}-epoch-${epoch}-ts-${Date.now()}-ok-${compliant}`
    const result    = await settleEpoch(leaseId, epoch, compliant, proofData)

    // 5. Persist everything to proofs.json — activity page reads this
    writeProof(leaseId, epoch, {
      leaseId:       String(leaseId),
      epoch,
      machineId,
      hardwareClass: machine.hardwareClass,
      region:        machine.region,
      provider:      machine.provider,
      compliant,
      staleSecs,
      riskScore:     riskResult.score,
      riskTier:      riskResult.tier,
      riskReasons:   riskResult.reasons || [],
      riskMode:      riskResult.mode,
      groqReasoning,
      proofData,
      proofHash:     result.proofHash    || null,
      routerTxHash:  result.routerTxHash || null,
      escrowTxHash:  result.escrowTxHash || null,
      settledAt:     new Date().toISOString(),
      mode:          state.mode,
    })

    if (result.escrowTxHash) {
      console.log(`  ✅ ${EXPLORER}/tx/${result.escrowTxHash}`)
      state.leasesSettled++
    } else {
      console.log(`  📋 Simulated — proofHash: ${result.proofHash}`)
    }

    state.lastError      = null
    state.lastTickStatus = `lease #${leaseId} epoch ${epoch} → ${compliant ? 'compliant' : 'breach'}`

  } catch (err) {
    state.lastError      = err.message
    state.lastTickStatus = `error: ${err.message}`
    console.error(`  ❌ ${err.message}`)
  }
}

// ─── CORS + JSON helpers ──────────────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res, status, data) {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data, null, 2))
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return }

  // GET / or /health — UptimeRobot pings this
  if (req.url === '/' || req.url === '/health') {
    return json(res, 200, {
      status:         state.lastError ? 'error' : 'ok',
      mode:           state.mode,
      uptime:         Math.floor((Date.now() - new Date(state.startTime)) / 1000) + 's',
      startTime:      state.startTime,
      lastTick:       state.lastTick,
      lastTickStatus: state.lastTickStatus,
      tickCount:      state.tickCount,
      leasesSettled:  state.leasesSettled,
      lastError:      state.lastError,
    })
  }

  // GET /proofs — all settlements, sorted newest first
  if (req.url === '/proofs') {
    const all    = readProofs()
    const proofs = Object.values(all).sort(
      (a, b) => new Date(b.settledAt || 0) - new Date(a.settledAt || 0)
    )
    return json(res, 200, { count: proofs.length, proofs })
  }

  // GET /proofs/:leaseId/:epoch
  const m = req.url.match(/^\/proofs\/(\d+)\/(\d+)$/)
  if (m) {
    const entry = readProofs()[`${m[1]}-${m[2]}`]
    if (!entry) return json(res, 404, { error: 'not found' })
    return json(res, 200, entry)
  }

  res.writeHead(404); res.end('not found')
})

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('🤖 ProofLease Agent')
  console.log(`   Health: http://localhost:${PORT}/health`)
  console.log(`   Proofs: http://localhost:${PORT}/proofs`)
  console.log(`   Mode:   ${state.mode.toUpperCase()}`)
  console.log(`   RPC:    ${RPC_URL}`)
  console.log(`   Poll:   every ${POLL_MS / 1000}s`)
  console.log('─'.repeat(50))

  tick()
  setInterval(tick, POLL_MS)
})
