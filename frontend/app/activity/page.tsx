'use client'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { usePublicClient } from 'wagmi'
import { parseAbiItem } from 'viem'
import { Navbar } from '@/components/Navbar'
import {
  CheckCircle, XCircle, ExternalLink,
  Loader2, RefreshCw, Brain, Shield, Clock, Cpu,
} from 'lucide-react'
import Link from 'next/link'

const ESCROW    = process.env.NEXT_PUBLIC_LEASE_ESCROW as `0x${string}`
const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL   || ''
const EXPLORER  = process.env.NEXT_PUBLIC_EXPLORER    || 'https://scan.botchain.ai'
const HEARTBEAT_MAX = 300

type AgentProof = {
  leaseId: string; epoch: number; machineId: number
  hardwareClass: string; region: string
  compliant: boolean; staleSecs: number
  groqReasoning: string; groqConfidence?: number; groqFactors?: string[]; verdictMode?: string
  riskScore: number; riskTier: 'LOW' | 'MEDIUM' | 'HIGH'; riskReasons: string[]; riskMode?: string
  repScore?: number; repRate?: number; repTotal?: number
  proofHash: string | null; routerTxHash: string | null; escrowTxHash: string | null
  settledAt: string; mode: string
  settlementRationale?: string
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
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
function shortHash(h: string) { return `${h.slice(0,10)}…${h.slice(-6)}` }

function ConfidenceBar({ value }: { value: number }) {
  const color = value >= 80 ? 'bg-green-500' : value >= 60 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-800 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${value}%` }}/>
      </div>
      <span className="text-xs font-mono text-gray-400 w-8 text-right">{value}%</span>
    </div>
  )
}

function SettlementCard({ entry }: { entry: MergedEntry }) {
  // New entries: verdictMode is 'groq' or 'local-fallback'
  // Old entries: no verdictMode field, treat groqReasoning as legacy AI decision
  const isGroq    = entry.verdictMode === 'groq'
  const isLegacy  = !entry.verdictMode && !!entry.groqReasoning
  const isLocal   = entry.verdictMode === 'local-fallback'
  return (
    <div className={`rounded-xl border p-5 ${
      entry.compliant ? 'bg-green-950/20 border-green-900/50' : 'bg-red-950/20 border-red-900/50'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          {entry.compliant
            ? <CheckCircle size={20} className="text-green-400 shrink-0"/>
            : <XCircle    size={20} className="text-red-400 shrink-0"/>}
          <div>
            <div className="font-semibold text-sm">Lease #{entry.leaseId} · Epoch {entry.epoch}</div>
            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
              <Cpu size={11}/>{entry.hardwareClass || ''}
              {entry.region && <><span className="mx-1">·</span>{entry.region}</>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <span className={`text-xs px-2 py-0.5 rounded-full border font-mono flex items-center gap-1 ${
            isGroq   ? 'bg-purple-950/60 text-purple-300 border-purple-900' :
            isLegacy ? 'bg-blue-950/50 text-blue-400 border-blue-900' :
                       'bg-gray-900 text-gray-500 border-gray-700'
          }`}>
            <Brain size={10}/>
            {isGroq ? 'Groq oracle' : isLegacy ? 'AI settled' : 'local fallback'}
          </span>
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
          {entry.settledAt && <span className="text-xs text-gray-500">{timeAgo(entry.settledAt)}</span>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div className="bg-gray-900/60 rounded-lg p-2 text-center">
          <div className="text-xs text-gray-500 mb-0.5">Risk Score</div>
          <div className="font-bold text-sm">{entry.riskScore ?? '-'}/100</div>
        </div>
        <div className="bg-gray-900/60 rounded-lg p-2 text-center">
          <div className="text-xs text-gray-500 mb-0.5 flex items-center justify-center gap-1">
            <Clock size={10}/>At-settlement heartbeat
          </div>
          <div className={`font-bold text-sm ${(entry.staleSecs||0) > HEARTBEAT_MAX ? 'text-red-400' : 'text-green-400'}`}>
            {entry.staleSecs !== undefined ? `${entry.staleSecs}s stale` : '-'}
          </div>
          <div className="text-xs text-gray-700 mt-0.5">snapshot at epoch close</div>
        </div>
        <div className="bg-gray-900/60 rounded-lg p-2 text-center">
          <div className="text-xs text-gray-500 mb-0.5">Outcome</div>
          <div className={`font-bold text-sm ${entry.compliant ? 'text-green-400' : 'text-red-400'}`}>
            {entry.compliant ? 'BOT → Provider' : 'BOT → Buyer'}
          </div>
        </div>
        {entry.repScore !== undefined ? (
          <div className="bg-gray-900/60 rounded-lg p-2 text-center">
            <div className="text-xs text-gray-500 mb-0.5">Reputation</div>
            <div className="font-bold text-sm">{entry.repScore}/1000</div>
            {(entry.repTotal ?? 0) > 0 && (
              <div className="text-xs text-gray-700 mt-0.5">{entry.repRate}% ({entry.repTotal})</div>
            )}
          </div>
        ) : (
          <div className="bg-gray-900/60 rounded-lg p-2 text-center">
            <div className="text-xs text-gray-500 mb-0.5">Mode</div>
            <div className="font-bold text-sm font-mono uppercase">{entry.mode || '-'}</div>
          </div>
        )}
      </div>

      {/* Settlement rationale */}
      {entry.settlementRationale && (
        <div className="bg-gray-900/40 border border-gray-700/50 rounded-lg p-3 mb-3">
          <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
            <Brain size={10}/> Settlement rationale
          </div>
          <p className="text-xs text-gray-300 leading-relaxed">{entry.settlementRationale}</p>
        </div>
      )}

      {/* Groq verdict */}
      {entry.groqReasoning && (
        <div className={`rounded-lg border p-3 mb-3 ${
          isGroq   ? 'bg-purple-950/30 border-purple-900/50' :
          isLegacy ? 'bg-blue-950/20 border-blue-900/40' :
                     'bg-gray-900/80 border-gray-700/60'
        }`}>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className={`flex items-center gap-2 text-xs font-medium ${
              isGroq ? 'text-purple-300' : isLegacy ? 'text-blue-400' : 'text-gray-500'
            }`}>
              <Brain size={13}/>
              {isGroq ? 'Groq AI Verdict' : isLegacy ? 'AI Decision (pre-Groq)' : 'Local Rule Verdict'}
            </div>
            {entry.groqConfidence !== undefined && (
              <div className="flex items-center gap-2 min-w-[130px]">
                <span className="text-xs text-gray-600 shrink-0">Confidence</span>
                <ConfidenceBar value={entry.groqConfidence}/>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-300 leading-relaxed mb-2">{entry.groqReasoning}</p>
          {entry.groqFactors && entry.groqFactors.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {entry.groqFactors.map(f => (
                <span key={f} className={`text-xs px-2 py-0.5 rounded-full border ${
                  isGroq   ? 'bg-purple-950/40 border-purple-900/40 text-purple-300' :
                  isLegacy ? 'bg-blue-950/40 border-blue-900/40 text-blue-300' :
                             'bg-gray-800 border-gray-700 text-gray-400'
                }`}>
                  {f.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          )}
          {entry.riskReasons && entry.riskReasons.length > 0 && (
            <div className="border-t border-gray-700/40 pt-2 mt-1">
              <div className="text-xs text-gray-600 mb-1">Risk signals:</div>
              <div className="flex flex-wrap gap-1">
                {entry.riskReasons.map(r => (
                  <span key={r} className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">{r}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
            <Shield size={11}/>Verify proof
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
  const publicClient   = usePublicClient()
  const [agentProofs,  setAgentProofs]  = useState<AgentProof[]>([])
  const [chainEvents,  setChainEvents]  = useState<ChainEvent[]>([])
  const [agentStatus,  setAgentStatus]  = useState<any>(null)
  const [loading,      setLoading]      = useState(true)
  const [lastRefresh,  setLastRefresh]  = useState<Date | null>(null)
  const [countdown,    setCountdown]    = useState(15)

  const fetchAgentData = useCallback(async () => {
    if (!AGENT_URL) return
    try {
      const [pr, hr] = await Promise.all([fetch(`${AGENT_URL}/proofs`), fetch(`${AGENT_URL}/health`)])
      if (pr.ok) { const d = await pr.json(); setAgentProofs(d.proofs || []) }
      if (hr.ok) setAgentStatus(await hr.json())
    } catch {}
  }, [])

  const fetchChainEvents = useCallback(async () => {
    if (!publicClient) return
    try {
      const logs = await publicClient.getLogs({
        address: ESCROW,
        event: parseAbiItem('event EpochSettled(uint256 indexed leaseId, uint256 epoch, bool compliant, bytes32 proofHash)'),
        fromBlock: 0n,
      })
      setChainEvents(logs.map(log => ({
        leaseId: String(log.args.leaseId), epoch: Number(log.args.epoch),
        compliant: Boolean(log.args.compliant), proofHash: log.args.proofHash as string,
        txHash: log.transactionHash || '', blockNumber: log.blockNumber || 0n,
      })))
    } catch {}
  }, [publicClient])

  const refresh = useCallback(async () => {
    setLoading(true)
    await Promise.all([fetchAgentData(), fetchChainEvents()])
    setLastRefresh(new Date()); setLoading(false); setCountdown(15)
  }, [fetchAgentData, fetchChainEvents])

  useEffect(() => { refresh() }, [publicClient])
  useEffect(() => { const t = setInterval(refresh, 15_000); return () => clearInterval(t) }, [refresh])
  useEffect(() => { const t = setInterval(() => setCountdown(c => Math.max(0,c-1)),1000); return ()=>clearInterval(t) }, [lastRefresh])

  const entries = useMemo<MergedEntry[]>(() => {
    const map = new Map<string, MergedEntry>()
    agentProofs.forEach(p => {
      map.set(`${p.leaseId}-${p.epoch}`, { ...p, key:`${p.leaseId}-${p.epoch}`, proofHash: p.proofHash ?? undefined })
    })
    chainEvents.forEach(e => {
      const key = `${e.leaseId}-${e.epoch}`; const ex = map.get(key)
      if (ex) map.set(key, { ...ex, ...e })
    })
    return [...map.values()]
      .filter(e => e.leaseId && e.epoch !== undefined && e.epoch !== null)
      .sort((a,b) => {
        if (a.settledAt && b.settledAt) return new Date(b.settledAt).getTime() - new Date(a.settledAt).getTime()
        return Number(b.blockNumber||0) - Number(a.blockNumber||0)
      })
  }, [agentProofs, chainEvents])

  // verdictMode='groq' = confirmed Groq call (new agent)
  // groqReasoning present without verdictMode = legacy entry (still AI-settled, just pre-versioning)
  const groqCount = entries.filter(e =>
    e.verdictMode === 'groq' || (e.groqReasoning && e.verdictMode === undefined)
  ).length
  const localCount = entries.filter(e => e.verdictMode === 'local-fallback').length
  const compliantCount = entries.filter(e => e.compliant).length
  const avgConf        = entries.length > 0
    ? Math.round(entries.reduce((s,e)=>s+(e.groqConfidence??75),0)/entries.length) : null

  return (
    <div className="min-h-screen">
      <Navbar/>
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-1">Agent Activity</h1>
            <p className="text-gray-400 text-sm">
              Live feed of Groq-verified epoch settlements. Each verdict is stored on-chain as a proof hash.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-600">Refresh in {countdown}s</span>
            <button onClick={refresh} disabled={loading}
              className="flex items-center gap-2 border border-gray-700 hover:border-gray-500 px-4 py-2 rounded-lg text-sm transition disabled:opacity-50">
              <RefreshCw size={14} className={loading?'animate-spin':''}/>Refresh
            </button>
          </div>
        </div>

        {agentStatus && (
          <div className={`rounded-xl p-4 border mb-6 text-sm ${
            agentStatus.lastError ? 'bg-red-950/30 border-red-900/50' : 'bg-green-950/30 border-green-900/50'
          }`}>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${agentStatus.lastError?'bg-red-400':'bg-green-400'} animate-pulse`}/>
                <span className="font-medium">Agent {agentStatus.lastError ? 'Error' : 'Online'}</span>
                <span className="text-gray-500 text-xs font-mono uppercase">{agentStatus.mode}</span>
              </div>
              <div className="flex gap-4 text-xs text-gray-400">
                <span>Up: {agentStatus.uptime}</span>
                <span>Ticks: {agentStatus.tickCount}</span>
                <span>Settled: {agentStatus.leasesSettled}</span>
              </div>
            </div>
            {agentStatus.lastError
              ? <p className="text-xs text-red-400 mt-2">Error: {agentStatus.lastError}</p>
              : agentStatus.lastTickStatus && (
                <p className="text-xs text-gray-500 mt-2">Last: {agentStatus.lastTickStatus}</p>
              )}
          </div>
        )}

        {entries.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label:'Total Epochs',   val: entries.length,   color:'text-white',     bg:'bg-gray-900 border-gray-800' },
              { label:'Compliant',      val: compliantCount,   color:'text-green-400', bg:'bg-green-950/30 border-green-900/50' },
              { label:'Breaches',       val: entries.length-compliantCount, color:'text-red-400', bg:'bg-red-950/30 border-red-900/50' },
              {
                label: groqCount > 0
                  ? `Groq oracle${avgConf!==null?' · '+avgConf+'% avg conf':''}`
                  : localCount > 0 ? 'Local fallback' : 'AI Decisions',
                val: groqCount > 0 ? groqCount : entries.length,
                color:'text-purple-400', bg:'bg-purple-950/30 border-purple-900/50',
                icon: <Brain size={16}/>,
              },
            ].map(({ label, val, color, bg, icon }) => (
              <div key={label} className={`border rounded-xl p-4 text-center ${bg}`}>
                <div className={`text-2xl font-bold mb-1 flex items-center justify-center gap-1 ${color}`}>
                  {icon}{val}
                </div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            ))}
          </div>
        )}

        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-24 text-gray-500">
            <Loader2 size={24} className="animate-spin mr-3"/>Fetching agent data…
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-24 text-gray-500">
            <Brain size={44} className="mx-auto mb-4 opacity-30"/>
            <p className="text-lg mb-1">No settlements yet</p>
            <p className="text-sm">Go to <Link href="/marketplace" className="text-blue-400 hover:underline">Marketplace</Link> to create a lease.</p>
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