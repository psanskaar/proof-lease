require('dotenv').config()
const http   = require('http')
const ethers = require('ethers')
const Groq   = require('groq-sdk')

const { scoreMachineRisk }                = require('./riskScorer')
const { findAvailableLease, settleEpoch } = require('./settlementBot')
const {
  listProofRecords,
  getProofRecord,
  saveProofRecord,
} = require('./proofStore')

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
const RPC_URL       = process.env.RPC_URL       || 'https://rpc.botchain.ai'
const EXPLORER      = 'https://scan.botchain.ai'
const IS_LIVE       = state.mode === 'live'

// ─── Chain reads ──────────────────────────────────────────────────────────────
const REGISTRY_ABI = [
  'function getMachine(uint256 machineId) external view returns (tuple(address provider, bytes32 hardwareHash, string region, string hardwareClass, string attestationURI, uint256 registeredAt, uint256 lastHeartbeat, uint8 status))',
]
const REPUTATION_ABI = [
  'function getScore(address provider) external view returns (uint256)',
  'function getFulfillmentRate(address provider) external view returns (uint256)',
  'function totalLeases(address provider) external view returns (uint256)',
]

async function getMachine(machineId) {
  const provider = new ethers.JsonRpcProvider(RPC_URL)
  const registry = new ethers.Contract(process.env.ASSET_REGISTRY, REGISTRY_ABI, provider)
  return await registry.getMachine(machineId)
}

async function getProviderReputation(providerAddress) {
  const repAddr = process.env.REPUTATION_CONTRACT || process.env.NEXT_PUBLIC_REPUTATION
  if (!repAddr) return { score: 500, rate: 100, total: 0 }
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL)
    const rep      = new ethers.Contract(repAddr, REPUTATION_ABI, provider)
    const [score, rate, total] = await Promise.all([
      rep.getScore(providerAddress),
      rep.getFulfillmentRate(providerAddress),
      rep.totalLeases(providerAddress),
    ])
    return { score: Number(score), rate: Number(rate), total: Number(total) }
  } catch (e) {
    console.log(`  Reputation read failed: ${e.message}`)
    return { score: 500, rate: 100, total: 0 }
  }
}

// ─── Epoch Evaluation ─────────────────────────────────────────────────────────
function localEpochEval(staleSecs, effectiveWindow) {
  const compliant = staleSecs <= effectiveWindow
  return {
    compliant,
    reasoning: compliant
      ? `Heartbeat is ${staleSecs}s old, within the ${effectiveWindow}s SLA window. Provider met uptime obligation.`
      : `Heartbeat is ${staleSecs}s old, exceeding the ${effectiveWindow}s SLA window. Provider missed uptime obligation.`,
    confidence: compliant ? 90 : 95,
    factors:    compliant
      ? ['heartbeat_fresh', 'sla_met']
      : ['heartbeat_stale', 'sla_violated'],
    mode: 'local-fallback',
  }
}

async function evaluateEpochWithGroq({
  staleSecs, effectiveWindow, machine, repScore, repRate, repTotal,
  leaseId, epoch, totalEpochs,
}) {
  if (!process.env.GROQ_API_KEY) return localEpochEval(staleSecs, effectiveWindow)

  const ageHours  = Math.max(0, Math.floor((Date.now() / 1000 - Number(machine.registeredAt)) / 3600))
  const hasAttest = Boolean(machine.attestationURI)

  const prompt = `You are an AI oracle on BOT Chain executing a binding settlement for a decentralized compute lease.
Your verdict triggers an irreversible blockchain transaction: COMPLIANT releases BOT to the provider, BREACH refunds the buyer.

EPOCH DATA:
- Lease #${leaseId} | Epoch ${epoch + 1} of ${totalEpochs}
- Machine: ${machine.hardwareClass} | Region: ${machine.region}
- Heartbeat age: ${staleSecs}s (SLA window for this lease: ${effectiveWindow}s)
- Provider reputation: ${repScore}/1000 | Fulfillment rate: ${repRate}% over ${repTotal} leases
- Machine age: ${ageHours}h registered
- Attestation URI: ${hasAttest ? 'PROVIDED' : 'MISSING'}

SETTLEMENT RULES:
1. PRIMARY: heartbeat older than ${effectiveWindow}s → BREACH (hard SLA violation, non-negotiable)
2. SECONDARY: if heartbeat is fresh, consider reputation:
   - repScore < 200 with repTotal > 3 → flag but still COMPLIANT (heartbeat proof wins)
   - All other cases with fresh heartbeat → COMPLIANT
3. Do NOT flip a fresh-heartbeat epoch to BREACH based on reputation alone.

Return ONLY raw JSON — no markdown, no explanation outside the JSON object:
{"compliant": true, "reasoning": "one clear sentence explaining the verdict", "confidence": 87, "factors": ["heartbeat_fresh", "reputation_stable"]}`

  try {
    const groq     = new Groq({ apiKey: process.env.GROQ_API_KEY })
    const response = await groq.chat.completions.create({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  200,
      temperature: 0.1,
    })
    const text   = response.choices[0]?.message?.content?.trim() ?? ''
    const clean  = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(clean)

    if (typeof parsed.compliant !== 'boolean') throw new Error('invalid compliant field')

    const hardBreach     = staleSecs > effectiveWindow
    const finalCompliant = hardBreach ? false : Boolean(parsed.compliant)

    return {
      compliant:  finalCompliant,
      reasoning:  typeof parsed.reasoning === 'string'
        ? parsed.reasoning
        : (finalCompliant ? 'Epoch verified compliant by AI oracle.' : 'Epoch marked breach by AI oracle.'),
      confidence: typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
        : 75,
      factors: Array.isArray(parsed.factors)
        ? parsed.factors.filter(f => typeof f === 'string').slice(0, 5)
        : [],
      mode: 'groq',
    }
  } catch (e) {
    console.log(`  Groq epoch eval failed (${e.message}) — using local fallback`)
    return localEpochEval(staleSecs, effectiveWindow)
  }
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

    // 1. Read machine heartbeat from chain
    const machine          = await getMachine(machineId)
    const staleSecs        = Math.floor(Date.now() / 1000) - Number(machine.lastHeartbeat)
    const effectiveWindow  = Math.min(HEARTBEAT_MAX, Number(lease.epochDuration))
    console.log(`  Heartbeat: ${staleSecs}s old | SLA window: ${effectiveWindow}s (min of ${HEARTBEAT_MAX}s max and ${Number(lease.epochDuration)}s epoch duration)`)

    // 2. Read reputation from chain
    const rep = await getProviderReputation(machine.provider)
    console.log(`  Reputation: ${rep.score}/1000 | ${rep.rate}% fulfillment over ${rep.total} leases`)

    // 3. Groq oracle verdict
    console.log('  Calling Groq oracle for epoch verdict…')
    const verdict = await evaluateEpochWithGroq({
      staleSecs,
      effectiveWindow,
      machine,
      repScore:    rep.score,
      repRate:     rep.rate,
      repTotal:    rep.total,
      leaseId,
      epoch,
      totalEpochs: Number(lease.totalEpochs),
    })
    console.log(`  Groq verdict: ${verdict.compliant ? 'COMPLIANT ✅' : 'BREACH ❌'} (${verdict.confidence}% confidence) via ${verdict.mode}`)
    console.log(`  Reasoning: ${verdict.reasoning}`)

    // 4. Machine risk score
    let riskResult = { score: 50, tier: 'MEDIUM', reasons: ['Fallback scoring'], mode: 'local' }
    try {
      riskResult = await scoreMachineRisk({
        hardwareClass:   machine.hardwareClass,
        region:          machine.region,
        lastHeartbeat:   Number(machine.lastHeartbeat),
        registeredAt:    Number(machine.registeredAt),
        attestationURI:  machine.attestationURI,
        reputationScore: rep.score,
      })
      console.log(`  Risk score: ${riskResult.score}/100 (${riskResult.tier}) via ${riskResult.mode}`)
    } catch (e) {
      console.log(`  Risk score: skipped (${e.message})`)
    }

    // 5. Settle on-chain
    const proofData = `lease-${leaseId}-epoch-${epoch}-ts-${Date.now()}-ok-${verdict.compliant}-conf-${verdict.confidence}`
    const result    = await settleEpoch(leaseId, epoch, verdict.compliant, proofData)

    // 6. Enrich proof record with Groq reasoning + risk metadata
    const existingRecord = getProofRecord(String(leaseId), String(epoch))
    if (existingRecord) {
      saveProofRecord({
        ...existingRecord,
        machineId,
        hardwareClass:  machine.hardwareClass,
        region:         machine.region,
        provider:       machine.provider,
        staleSecs,
        effectiveWindow,
        groqReasoning:  verdict.reasoning,
        groqConfidence: verdict.confidence,
        groqFactors:    verdict.factors,
        verdictMode:    verdict.mode,
        riskScore:      riskResult.score,
        riskTier:       riskResult.tier,
        riskReasons:    riskResult.reasons || [],
        riskMode:       riskResult.mode,
        repScore:       rep.score,
        repRate:        rep.rate,
        repTotal:       rep.total,
        settledAt:      new Date().toISOString(),
        mode:           state.mode,
      })
    }

    // 7. Plain-language settlement rationale
    let settlementRationale = verdict.compliant
      ? `Epoch ${epoch} compliant: heartbeat was ${staleSecs}s old, within the ${effectiveWindow}s SLA window.`
      : `Epoch ${epoch} breached: heartbeat was ${staleSecs}s old, exceeding the ${effectiveWindow}s SLA window. Full refund issued to buyer.`

    if (process.env.GROQ_API_KEY) {
      try {
        const groq = new (require('groq-sdk'))({ apiKey: process.env.GROQ_API_KEY })
        const r    = await groq.chat.completions.create({
          model:    'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content:
            `Lease ${leaseId}, Epoch ${epoch}: heartbeat was ${staleSecs}s old (SLA window ${effectiveWindow}s), risk score ${riskResult.score}/100, verdict ${verdict.compliant ? 'COMPLIANT' : 'BREACH'}. Write one plain-English sentence explaining this settlement decision to a non-technical buyer.`
          }],
          max_tokens:  80,
          temperature: 0.2,
        })
        settlementRationale = r.choices[0]?.message?.content?.trim() || settlementRationale
      } catch {}
    }

    const recordAfterRationale = getProofRecord(String(leaseId), String(epoch))
    if (recordAfterRationale) {
      saveProofRecord({ ...recordAfterRationale, settlementRationale })
    }

    if (result.escrowTxHash) {
      console.log(`  ✅ ${EXPLORER}/tx/${result.escrowTxHash}`)
      state.leasesSettled++
    } else {
      console.log(`  📋 Simulated — proofHash: ${result.proofHash}`)
    }

    state.lastError      = null
    state.lastTickStatus = `lease #${leaseId} epoch ${epoch} → ${verdict.compliant ? 'compliant' : 'breach'} (${verdict.mode})`

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

  if (req.url === '/' || req.url === '/health') {
    const settledCount = listProofRecords().filter(p => p.escrowTxHash).length
    return json(res, 200, {
      status:         state.lastError ? 'error' : 'ok',
      mode:           state.mode,
      uptime:         Math.floor((Date.now() - new Date(state.startTime)) / 1000) + 's',
      startTime:      state.startTime,
      lastTick:       state.lastTick,
      lastTickStatus: state.lastTickStatus,
      tickCount:      state.tickCount,
      leasesSettled:  settledCount,
      lastError:      state.lastError,
    })
  }

  if (req.url === '/proofs') {
    const proofs = listProofRecords().sort(
      (a, b) => new Date(b.settledAt || 0) - new Date(a.settledAt || 0)
    )
    return json(res, 200, { count: proofs.length, proofs })
  }

  const m = req.url.match(/^\/proofs\/(\d+)\/(\d+)$/)
  if (m) {
    const entry = getProofRecord(m[1], m[2])
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
  console.log(`   Groq:   ${process.env.GROQ_API_KEY ? 'enabled ✓' : 'missing — local fallback active'}`)
  const repAddr = process.env.REPUTATION_CONTRACT || process.env.NEXT_PUBLIC_REPUTATION
  console.log(`   Rep:    ${repAddr ? repAddr.slice(0,10)+'… ✓' : 'missing REPUTATION_CONTRACT — using score 500 default'}`)
  console.log('─'.repeat(50))
  tick()
  setInterval(tick, POLL_MS)
})