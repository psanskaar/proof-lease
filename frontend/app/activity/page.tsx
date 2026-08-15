'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { usePublicClient } from 'wagmi'
import { parseAbiItem } from 'viem'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import {
  CheckCircle, XCircle, ExternalLink, ArrowLeft,
  Loader2, RefreshCw, Brain, Shield, Clock, Cpu, ChevronDown, ChevronUp,
} from 'lucide-react'
import Link from 'next/link'

const ESCROW    = process.env.NEXT_PUBLIC_LEASE_ESCROW as `0x${string}`
const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL   || ''
const EXPLORER  = process.env.NEXT_PUBLIC_EXPLORER    || 'https://scan.bohr.life'

type AgentProof = {
  leaseId: string; epoch: number; machineId: number
  hardwareClass: string; region: string
  compliant: boolean; staleSecs: number
  riskScore: number; riskTier: 'LOW' | 'MEDIUM' | 'HIGH'
  riskReasons: string[]; groqReasoning: string
  proofHash: string | null; routerTxHash: string | null; escrowTxHash: string | null
  settledAt: string; mode: string
}

type ChainEvent = {
  leaseId: string; epoch: number; compliant: boolean
  proofHash: string; txHash: string; blockNumber: bigint
}

type MergedEntry = Omit<AgentProof, 'proofHash'> &
  Partial<ChainEvent> & { key: string; proofHash: string | null | undefined }

const TIER_STYLE = {
  LOW:    'bg-green-900/40 text-green-300 border-green-800',
  MEDIUM: 'bg-yellow-900/40 text-yellow-300 border-yellow-800',
  HIGH:   'bg-red-900/40 text-red-300 border-red-800',
}

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

function shortHash(h: string) { return `${h.slice(0, 10)}…${h.slice(-6)}` }

function SettlementCard({ entry }: { entry: MergedEntry }) {
  const [reasoningOpen, setReasoningOpen] = useState(false)

  return (
    <div className={`rounded-xl border p-5 transition ${
      entry.compliant
        ? 'bg-green-950/20 border-green-900/50'
        : 'bg-red-950/20 border-red-900/50'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          {entry.compliant
            ? <CheckCircle size={20} className="text-green-400 shrink-0" />
            : <XCircle    size={20} className="text-red-400 shrink-0" />}
          <div>
            <div className="font-semibold text-sm">
              Lease #{entry.leaseId} · Epoch {entry.epoch}
            </div>
            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
              <Cpu size={11} />{entry.hardwareClass || '—'}
              {entry.region && <><span className="mx-1">·</span>{entry.region}</>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {entry.riskTier && (
            <span className={`text-xs px-2 py-0.5 rounded-full border font-mono font-bold ${TIER_STYLE[entry.riskTier]}`}>
              {entry.riskTier}
            </span>
          )}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            entry.compliant ? 'bg-green-900/60 text-green-300' : 'bg-red-900/60 text-red-300'
          }`}>
            {entry.compliant ? 'COMPLIANT' : 'BREACH'}
          </span>
          {entry.settledAt && (
            <span className="text-xs text-gray-500">{timeAgo(entry.settledAt)}</span>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div className="bg-gray-900/60 rounded-lg p-2 text-center">
          <div className="text-xs text-gray-500 mb-0.5">AI Risk Score</div>
          <div className="font-bold text-sm">{entry.riskScore || '—'}/100</div>
        </div>
        <div className="bg-gray-900/60 rounded-lg p-2 text-center">
          <div className="text-xs text-gray-500 mb-0.5 flex items-center justify-center gap-1">
            <Clock size={10}/>Heartbeat
          </div>
          <div className={`font-bold text-sm ${
            (entry.staleSecs || 0) > 300 ? 'text-red-400' : 'text-green-400'
          }`}>
            {entry.staleSecs !== undefined ? `${entry.staleSecs}s ago` : '—'}
          </div>
        </div>
        <div className="bg-gray-900/60 rounded-lg p-2 text-center">
          <div className="text-xs text-gray-500 mb-0.5">Outcome</div>
          <div className={`font-bold text-sm ${entry.compliant ? 'text-green-400' : 'text-red-400'}`}>
            {entry.compliant ? 'BOT → Provider' : 'BOT → Buyer'}
          </div>
        </div>
        <div className="bg-gray-900/60 rounded-lg p-2 text-center">
          <div className="text-xs text-gray-500 mb-0.5">Mode</div>
          <div className="font-bold text-sm font-mono uppercase">{entry.mode || '—'}</div>
        </div>
      </div>

      {/* Groq reasoning — always visible, expandable */}
      {entry.groqReasoning ? (
        <div className="bg-gray-900/80 rounded-lg border border-gray-700/60 mb-3 overflow-hidden">
          <button
            onClick={() => setReasoningOpen(o => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-800/40 transition"
          >
            <div className="flex items-center gap-2 text-xs text-blue-400 font-medium">
              <Brain size={13} />Groq AI Reasoning
            </div>
            {reasoningOpen
              ? <ChevronUp size={14} className="text-gray-500" />
              : <ChevronDown size={14} className="text-gray-500" />}
          </button>
          {reasoningOpen && (
            <div className="px-3 pb-3 border-t border-gray-700/60 pt-2.5">
              <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
                {entry.groqReasoning}
              </p>
              {entry.riskReasons && entry.riskReasons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {entry.riskReasons.map(r => (
                    <span key={r} className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {!reasoningOpen && (
            <p className="px-3 pb-3 text-xs text-gray-500 line-clamp-2">
              {entry.groqReasoning}
            </p>
          )}
        </div>
      ) : null}

      {/* Links */}
      <div className="flex flex-wrap gap-3 text-xs">
        {entry.escrowTxHash && (
          <a href={`${EXPLORER}/tx/${entry.escrowTxHash}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-blue-400 hover:underline">
            <ExternalLink size={11}/>Settlement TX
          </a>
        )}
        {entry.routerTxHash && (
          <a href={`${EXPLORER}/tx/${entry.routerTxHash}`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-blue-400 hover:underline">
            <ExternalLink size={11}/>Proof TX
          </a>
        )}
        {entry.proofHash && (
          <Link href={`/verify?leaseId=${entry.leaseId}&epoch=${entry.epoch}`}
            className="flex items-center gap-1 text-gray-400 hover:text-white">
            <Shield size={11}/>Verify Proof
          </Link>
        )}
        {entry.proofHash && (
          <span className="text-gray-600 font-mono">{shortHash(entry.proofHash)}</span>
        )}
      </div>
    </div>
  )
}

export default function ActivityPage() {
  const publicClient  = usePublicClient()
  const [agentProofs, setAgentProofs] = useState<AgentProof[]>([])
  const [chainEvents, setChainEvents] = useState<ChainEvent[]>([])
  const [agentStatus, setAgentStatus] = useState<any>(null)
  const [loading,     setLoading]     = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [countdown,   setCountdown]   = useState(15)

  const fetchAgentData = useCallback(async () => {
    if (!AGENT_URL) return
    try {
      const [pr, hr] = await Promise.all([
        fetch(`${AGENT_URL}/proofs`),
        fetch(`${AGENT_URL}/health`),
      ])
      if (pr.ok) { const d = await pr.json(); setAgentProofs(d.proofs || []) }
      if (hr.ok) setAgentStatus(await hr.json())
    } catch {}
  }, [])

  const fetchChainEvents = useCallback(async () => {
    if (!publicClient) return
    try {
      const logs = await publicClient.getLogs({
        address: ESCROW,
        event: parseAbiItem(
          'event EpochSettled(uint256 indexed leaseId, uint256 epoch, bool compliant, bytes32 proofHash)'
        ),
        fromBlock: 0n,
      })
      setChainEvents(logs.map(log => ({
        leaseId:     String(log.args.leaseId),
        epoch:       Number(log.args.epoch),
        compliant:   Boolean(log.args.compliant),
        proofHash:   log.args.proofHash as string,
        txHash:      log.transactionHash || '',
        blockNumber: log.blockNumber || 0n,
      })))
    } catch {}
  }, [publicClient])

  const refresh = useCallback(async () => {
    setLoading(true)
    await Promise.all([fetchAgentData(), fetchChainEvents()])
    setLastRefresh(new Date())
    setLoading(false)
    setCountdown(15)
  }, [fetchAgentData, fetchChainEvents])

  useEffect(() => { refresh() }, [publicClient])

  // 15s auto-refresh
  useEffect(() => {
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [refresh])

  // Countdown display
  useEffect(() => {
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1_000)
    return () => clearInterval(t)
  }, [lastRefresh])

  const entries = useMemo<MergedEntry[]>(() => {
    const map = new Map<string, MergedEntry>()
    agentProofs.forEach(p => {
      map.set(`${p.leaseId}-${p.epoch}`, { ...p, key: `${p.leaseId}-${p.epoch}`, proofHash: p.proofHash ?? undefined })
    })
    chainEvents.forEach(e => {
      const key = `${e.leaseId}-${e.epoch}`
      const ex = map.get(key)
      if (ex) {
        map.set(key, { ...ex, ...e })
      } else {
        map.set(key, {
          key, leaseId: e.leaseId, epoch: e.epoch, compliant: e.compliant,
          proofHash: e.proofHash, txHash: e.txHash, blockNumber: e.blockNumber,
          machineId: 0, hardwareClass: '', region: '', staleSecs: 0,
          riskScore: 0, riskTier: 'MEDIUM', riskReasons: [], groqReasoning: '',
          routerTxHash: null, escrowTxHash: e.txHash, settledAt: '', mode: 'live',
        })
      }
    })
    return [...map.values()].sort((a, b) => {
      if (a.settledAt && b.settledAt)
        return new Date(b.settledAt).getTime() - new Date(a.settledAt).getTime()
      return Number(b.blockNumber || 0) - Number(a.blockNumber || 0)
    })
  }, [agentProofs, chainEvents])

  const compliantCount = entries.filter(e => e.compliant).length
  const breachCount    = entries.filter(e => !e.compliant).length

  return (
    <div className="min-h-screen">
      <nav className="border-b border-gray-800 px-6 py-4 flex justify-between items-center sticky top-0 bg-gray-950/90 backdrop-blur z-40">
        <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition">
          <ArrowLeft size={16}/><span className="text-blue-400 font-bold">ProofLease</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/marketplace" className="text-sm text-gray-400 hover:text-white transition">Marketplace</Link>
          <Link href="/provider"    className="text-sm text-gray-400 hover:text-white transition">Provider</Link>
          <Link href="/verify"      className="text-sm text-gray-400 hover:text-white transition">Verify</Link>
          <ConnectButton/>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-1">Agent Activity</h1>
            <p className="text-gray-400 text-sm">
              Live feed of AI-verified epoch settlements — on-chain decisions with full Groq reasoning.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-600">
              Refresh in {countdown}s
            </span>
            <button onClick={refresh} disabled={loading}
              className="flex items-center gap-2 border border-gray-700 hover:border-gray-500 px-4 py-2 rounded-lg text-sm transition disabled:opacity-50">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''}/>
              Refresh
            </button>
          </div>
        </div>

        {/* Agent status */}
        {agentStatus && (
          <div className={`rounded-xl p-4 border mb-6 text-sm ${
            agentStatus.lastError
              ? 'bg-red-950/30 border-red-900/50'
              : 'bg-green-950/30 border-green-900/50'
          }`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${agentStatus.lastError ? 'bg-red-400' : 'bg-green-400'} animate-pulse`}/>
                <span className="font-medium">
                  Agent {agentStatus.lastError ? 'Error' : 'Online'}
                </span>
                <span className="text-gray-500 text-xs font-mono uppercase">{agentStatus.mode}</span>
              </div>
              <div className="flex gap-4 text-xs text-gray-400">
                <span>Up: {agentStatus.uptime}</span>
                <span>Ticks: {agentStatus.tickCount}</span>
                <span>Settled: {agentStatus.leasesSettled}</span>
              </div>
            </div>
            {agentStatus.lastError ? (
              <p className="text-xs text-red-400 mt-2">Error: {agentStatus.lastError}</p>
            ) : agentStatus.lastTickStatus && (
              <p className="text-xs text-gray-500 mt-2">Last: {agentStatus.lastTickStatus}</p>
            )}
          </div>
        )}

        {!AGENT_URL && (
          <div className="bg-yellow-950/30 border border-yellow-900/50 rounded-xl p-4 mb-6 text-sm text-yellow-300">
            <strong>NEXT_PUBLIC_AGENT_URL</strong> not set — AI reasoning unavailable.
          </div>
        )}

        {/* Stats */}
        {entries.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold mb-1">{entries.length}</div>
              <div className="text-xs text-gray-500">Total Epochs</div>
            </div>
            <div className="bg-green-950/30 border border-green-900/50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-green-400 mb-1">{compliantCount}</div>
              <div className="text-xs text-gray-500">Compliant</div>
            </div>
            <div className="bg-red-950/30 border border-red-900/50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-red-400 mb-1">{breachCount}</div>
              <div className="text-xs text-gray-500">Breaches</div>
            </div>
          </div>
        )}

        {/* Feed */}
        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-gray-500">
            <Loader2 size={24} className="animate-spin mr-3"/>
            Fetching agent data and chain events…
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-24 text-gray-500">
            <Brain size={44} className="mx-auto mb-4 opacity-30"/>
            <p className="text-lg mb-1">No settlements yet</p>
            <p className="text-sm">
              Go to <Link href="/marketplace" className="text-blue-400 hover:underline">Marketplace</Link> to create a lease.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {entries.map(entry => <SettlementCard key={entry.key} entry={entry}/>)}
          </div>
        )}

        {lastRefresh && (
          <p className="text-xs text-gray-700 text-center mt-6">
            Last refreshed: {lastRefresh.toLocaleTimeString()} · Auto-refreshes every 15s
          </p>
        )}
      </div>
    </div>
  )
}