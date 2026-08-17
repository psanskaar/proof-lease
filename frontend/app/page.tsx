'use client'
import { useState, useEffect } from 'react'
import { useReadContract } from 'wagmi'
import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  Shield, Cpu, Zap, CheckCircle, ExternalLink,
  Brain, Lock, Activity, RefreshCw,
} from 'lucide-react'

const REGISTRY   = process.env.NEXT_PUBLIC_ASSET_REGISTRY as `0x${string}`
const ESCROW     = process.env.NEXT_PUBLIC_LEASE_ESCROW   as `0x${string}`
const AGENT_URL  = process.env.NEXT_PUBLIC_AGENT_URL || ''
const EXPLORER   = process.env.NEXT_PUBLIC_EXPLORER  || 'https://scan.botchain.ai'

const CONTRACTS = [
  { name: 'AssetRegistry', addr: process.env.NEXT_PUBLIC_ASSET_REGISTRY || '' },
  { name: 'LeaseEscrow',   addr: process.env.NEXT_PUBLIC_LEASE_ESCROW   || '' },
  { name: 'ProofRouter',   addr: process.env.NEXT_PUBLIC_PROOF_ROUTER   || '' },
  { name: 'Reputation',    addr: process.env.NEXT_PUBLIC_REPUTATION     || '' },
]

const REGISTRY_ABI = [
  { name: 'machineCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

const ESCROW_ABI = [
  { name: 'leaseCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

// ─── Live stats from chain + agent ───────────────────────────────────────────
function LiveStats() {
  const { data: machineCount } = useReadContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'machineCount',
  })
  const { data: leaseCount } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: 'leaseCount',
  })
  const [agentStats, setAgentStats] = useState<{
    total: number; compliant: number; rate: string
  } | null>(null)

  useEffect(() => {
    if (!AGENT_URL) return
    // Show cached values instantly while fetching
    try {
      const cached = sessionStorage.getItem('pl_agent_stats')
      if (cached) setAgentStats(JSON.parse(cached))
    } catch {}

    fetch(`${AGENT_URL}/proofs`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const proofs: any[] = d.proofs || []
        const compliant = proofs.filter(p => p.compliant).length
        const rate = proofs.length > 0
          ? `${Math.round((compliant / proofs.length) * 100)}%`
          : '—'
        const stats = { total: proofs.length, compliant, rate }
        setAgentStats(stats)
        try { sessionStorage.setItem('pl_agent_stats', JSON.stringify(stats)) } catch {}
      })
      .catch(() => {
        // Agent offline — keep cached values if available, otherwise show N/A
        setAgentStats(prev => prev ?? { total: 0, compliant: 0, rate: 'N/A' })
      })
  }, [])

  const stats = [
    {
      value: machineCount !== undefined ? Number(machineCount).toString() : '—',
      label: 'Machines registered',
      color: 'text-blue-400',
    },
    {
      value: leaseCount !== undefined ? Number(leaseCount).toString() : '—',
      label: 'Leases created',
      color: 'text-blue-400',
    },
    {
      value: agentStats ? agentStats.total.toString() : '—',
      label: 'AI decisions made',
      color: 'text-purple-400',
    },
    {
      value: agentStats ? agentStats.rate : '—',
      label: 'Epoch compliance rate',
      color: 'text-green-400',
    },
  ]

  return (
    <div className="border-y border-gray-800 bg-gray-950 py-5">
      <div className="max-w-5xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map(({ value, label, color }) => (
            <div key={label} className="text-center">
              <div className={`text-2xl font-bold font-mono ${color} tabular-nums ${value === '—' ? 'opacity-30' : ''}`}>
                {value === '—' ? <span className="animate-pulse">—</span> : value}
              </div>
              <div className="text-xs text-gray-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-1.5 mt-3">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/>
          <span className="text-xs text-gray-600">Live — BOT Chain Mainnet · Chain ID 677</span>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Home() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Nav */}
      <nav className="border-b border-gray-800 px-6 py-4 flex justify-between items-center sticky top-0 bg-gray-950/90 backdrop-blur z-40">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-blue-400">ProofLease</span>
          <span className="text-xs bg-green-900/60 text-green-300 border border-green-800 px-2 py-0.5 rounded-full font-mono">
            LIVE · BOT Mainnet
          </span>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/marketplace" className="text-gray-400 hover:text-white text-sm transition">Marketplace</Link>
          <Link href="/provider"    className="text-gray-400 hover:text-white text-sm transition">Provide</Link>
          <Link href="/activity"    className="text-gray-400 hover:text-white text-sm transition">Activity</Link>
          <Link href="/verify"      className="text-gray-400 hover:text-white text-sm transition">Verify</Link>
          <ConnectButton />
        </div>
      </nav>

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="inline-flex items-center gap-2 bg-purple-950/60 border border-purple-900 text-purple-300 text-sm px-3 py-1 rounded-full mb-6">
          <Brain size={13}/>
          AI Agent Oracle · DePIN Compute · BOT Chain
        </div>
        <h1 className="text-5xl font-bold mb-6 leading-tight tracking-tight">
          Trustless Compute Leasing.<br />
          <span className="text-blue-400">Every Payment Decided by AI.</span>
        </h1>
        <p className="text-gray-400 text-lg mb-4 max-w-2xl mx-auto leading-relaxed">
          Providers register GPU and CPU machines on-chain. Buyers escrow BOT tokens.
          A Groq-powered AI agent verifies uptime each epoch and executes payment or refund
          automatically — no human, no dispute emails, no trust required.
        </p>
        <p className="text-gray-600 text-sm mb-10">
          Every AI decision is stored as a keccak256 proof hash on BOT Chain. Anyone can verify it.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link href="/marketplace" className="bg-blue-600 hover:bg-blue-700 px-8 py-3 rounded-lg font-medium transition">
            Find Compute →
          </Link>
          <Link href="/provider" className="border border-gray-600 hover:border-gray-400 px-8 py-3 rounded-lg font-medium transition">
            List Your Machine
          </Link>
          <Link href="/activity" className="border border-gray-700 hover:border-gray-500 px-8 py-3 rounded-lg font-medium text-gray-400 transition flex items-center gap-2">
            <Activity size={15}/>Watch Agent Live
          </Link>
        </div>
      </div>

      {/* Live stats bar */}
      <LiveStats />

      {/* How it works */}
      <div className="max-w-5xl mx-auto px-6 py-16">
        <h2 className="text-center text-xs font-semibold text-gray-500 uppercase tracking-widest mb-8">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {[
            {
              icon: <Cpu size={22} className="text-blue-400" />,
              step: '01',
              title: 'Register Hardware',
              body: 'Providers stake 0.001 BOT and register GPU/CPU machines as on-chain assets via AssetRegistry, with an attestation URI for buyer verification.',
            },
            {
              icon: <Brain size={22} className="text-purple-400" />,
              step: '02',
              title: 'AI Scores & Prices',
              body: 'Groq LLM evaluates machine risk using on-chain reputation, heartbeat freshness, and provider history. Score gates lease eligibility and sets price.',
            },
            {
              icon: <Zap size={22} className="text-green-400" />,
              step: '03',
              title: 'Agent Settles Automatically',
              body: 'Each epoch: AI agent checks heartbeat on-chain. Fresh → BOT released to provider. Stale → buyer refunded. Every decision stored as a proof hash.',
            },
          ].map(({ icon, step, title, body }) => (
            <div key={title} className="bg-gray-900 rounded-xl p-6 border border-gray-800 relative overflow-hidden">
              <div className="absolute top-4 right-5 text-5xl font-bold text-gray-800/50 select-none font-mono">{step}</div>
              <div className="mb-3 relative">{icon}</div>
              <h3 className="font-semibold mb-2 relative">{title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed relative">{body}</p>
            </div>
          ))}
        </div>

        {/* AI is core — explicit for judges */}
        <div className="bg-gray-900 rounded-2xl border border-purple-900/40 p-8 mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="bg-purple-950/60 rounded-lg p-2"><Brain size={20} className="text-purple-400"/></div>
            <div>
              <h3 className="font-bold text-lg">AI is the decision-maker, not a helper</h3>
              <p className="text-gray-500 text-xs mt-0.5">Every BOT payment or refund flows through an AI oracle</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                title: 'AI gates lease access',
                desc: 'Groq risk score determines if a machine is eligible to lease. Score < 50 → listing blocked. No human override.',
                color: 'border-purple-900/40 bg-purple-950/20',
                badge: 'Pre-lease',
              },
              {
                title: 'AI executes settlement',
                desc: 'Agent reads chain heartbeat each epoch, calls settleEpoch() autonomously. Human never touches the transaction.',
                color: 'border-blue-900/40 bg-blue-950/20',
                badge: 'Each epoch',
              },
              {
                title: 'AI updates reputation',
                desc: 'After lease completion, compliance record is written to the on-chain Reputation contract. Affects all future AI scores for that provider.',
                color: 'border-green-900/40 bg-green-950/20',
                badge: 'Post-lease',
              },
            ].map(({ title, desc, color, badge }) => (
              <div key={title} className={`rounded-xl p-4 border ${color}`}>
                <span className="text-xs font-mono text-gray-500 uppercase">{badge}</span>
                <div className="font-semibold text-sm mt-1 mb-2">{title}</div>
                <p className="text-gray-400 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Verify section — featured prominently */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <Link href="/verify"
            className="bg-gray-900 border border-gray-800 hover:border-blue-600 rounded-xl p-6 transition group">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-blue-950/60 rounded-lg p-2">
                <Shield size={18} className="text-blue-400"/>
              </div>
              <div>
                <div className="font-semibold group-hover:text-blue-400 transition">Verify any AI decision →</div>
                <div className="text-xs text-gray-500 mt-0.5">On-chain proof verification</div>
              </div>
            </div>
            <p className="text-gray-500 text-sm leading-relaxed">
              Every settlement stores a keccak256 proof hash on-chain. Enter any lease ID + epoch
              to independently recompute the hash and confirm the AI agent used real data — not fabricated telemetry.
            </p>
            <div className="mt-3 text-xs font-mono text-gray-700 bg-gray-950 rounded px-3 py-1.5">
              ProofRouter.getProof(leaseId, epoch) → bytes32
            </div>
          </Link>

          <Link href="/activity"
            className="bg-gray-900 border border-gray-800 hover:border-purple-600 rounded-xl p-6 transition group">
            <div className="flex items-center gap-3 mb-3">
              <div className="bg-purple-950/60 rounded-lg p-2">
                <Activity size={18} className="text-purple-400"/>
              </div>
              <div>
                <div className="font-semibold group-hover:text-purple-400 transition">Watch agent reasoning live →</div>
                <div className="text-xs text-gray-500 mt-0.5">Real-time settlement feed</div>
              </div>
            </div>
            <p className="text-gray-500 text-sm leading-relaxed">
              Live feed of every AI-verified epoch. See the full Groq reasoning text, risk score,
              risk factors, and on-chain TX hash for each settlement decision.
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"/>
              Auto-refreshes every 15 seconds
            </div>
          </Link>
        </div>

        {/* Escrow security callout */}
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 mb-6 flex items-start gap-4">
          <div className="bg-gray-800 rounded-lg p-2 shrink-0 mt-0.5">
            <Lock size={16} className="text-gray-400"/>
          </div>
          <div>
            <div className="font-medium text-sm mb-1">Escrow is trustless — agent can only release, never steal</div>
            <p className="text-gray-500 text-xs leading-relaxed">
              The AI agent wallet is registered as the oracle address. It can only call{' '}
              <code className="text-blue-300/80">settleEpoch()</code> — which routes funds to either the provider
              or the buyer based on the proof. It cannot withdraw, transfer, or drain the escrow balance.
              Contract source is on GitHub and verified on-chain.
            </p>
          </div>
        </div>

        {/* Contract table */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle size={16} className="text-green-400" />
            <h3 className="font-semibold">Deployed Contracts — BOT Chain Mainnet</h3>
            <span className="ml-auto text-xs text-gray-600 font-mono">Chain ID 677</span>
          </div>
          <div className="space-y-2 font-mono text-sm">
            {CONTRACTS.map(({ name, addr }) => (
              <div key={name} className="flex justify-between items-center py-1.5 border-b border-gray-800 last:border-0">
                <span className="text-gray-400">{name}</span>
                {addr ? (
                  <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noopener noreferrer"
                    className="text-blue-400 hover:underline flex items-center gap-1 text-xs">
                    {addr.slice(0, 10)}…{addr.slice(-6)}
                    <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="text-gray-700 text-xs">not configured</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-800 py-6 text-center text-xs text-gray-700">
        ProofLease · Built on BOT Chain · AI-verified compute leasing
      </div>
    </div>
  )
}