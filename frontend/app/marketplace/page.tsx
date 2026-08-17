'use client'
import { useState, useMemo } from 'react'
import {
  useReadContract, useWriteContract, useAccount, useWaitForTransactionReceipt,
} from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Navbar } from '@/components/Navbar'
import { parseEther, keccak256, toBytes, formatEther } from 'viem'
import {
  Cpu, MapPin, ExternalLink, Loader2, CheckCircle,
  Shield, Copy, AlertTriangle, Clock, Activity, Server,
} from 'lucide-react'
import Link from 'next/link'

const REGISTRY   = process.env.NEXT_PUBLIC_ASSET_REGISTRY as `0x${string}`
const ESCROW     = process.env.NEXT_PUBLIC_LEASE_ESCROW   as `0x${string}`
const REPUTATION = process.env.NEXT_PUBLIC_REPUTATION     as `0x${string}`
const EXPLORER   = process.env.NEXT_PUBLIC_EXPLORER || 'https://scan.bohr.life'

const REGISTRY_ABI = [
  { name: 'machineCount', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getMachine', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'machineId', type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'provider',       type: 'address'  },
      { name: 'hardwareHash',   type: 'bytes32'  },
      { name: 'region',         type: 'string'   },
      { name: 'hardwareClass',  type: 'string'   },
      { name: 'attestationURI', type: 'string'   },
      { name: 'registeredAt',   type: 'uint256'  },
      { name: 'lastHeartbeat',  type: 'uint256'  },
      { name: 'status',         type: 'uint8'    },
    ]}] },
] as const

const REPUTATION_ABI = [
  { name: 'getScore', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
] as const

const ESCROW_ABI = [
  { name: 'leaseCount', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getLease', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'leaseId', type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'machineId',     type: 'uint256' },
      { name: 'provider',      type: 'address' },
      { name: 'buyer',         type: 'address' },
      { name: 'pricePerEpoch', type: 'uint256' },
      { name: 'epochDuration', type: 'uint256' },
      { name: 'totalEpochs',   type: 'uint256' },
      { name: 'epochsSettled', type: 'uint256' },
      { name: 'escrowBalance', type: 'uint256' },
      { name: 'startTime',     type: 'uint256' },
      { name: 'status',        type: 'uint8'   },
      { name: 'aiQuoteHash',   type: 'bytes32' },
    ]}] },
  { name: 'createLease', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'machineId',     type: 'uint256' },
      { name: 'epochDuration', type: 'uint256' },
      { name: 'totalEpochs',   type: 'uint256' },
      { name: 'aiQuoteHash',   type: 'bytes32' },
    ],
    outputs: [{ type: 'uint256' }] },
  { name: 'raiseDispute', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'leaseId', type: 'uint256' }], outputs: [] },
] as const

type Machine = {
  provider: `0x${string}`; hardwareHash: `0x${string}`
  region: string; hardwareClass: string; attestationURI: string
  registeredAt: bigint; lastHeartbeat: bigint; status: number
}

const MARKET_RATES: Record<string, number> = {
  'GPU-H100': 2.5, 'GPU-A100': 1.8, 'GPU-RTX4090': 0.8, 'GPU-RTX3090': 0.45,
  'CPU-64C': 0.3, 'CPU-32C': 0.2, 'CPU-16C': 0.15,
}

function formatStale(mins: number) {
  if (mins <   2) return 'Just now'
  if (mins <  60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins/60)}h ${mins % 60}m ago`
  return `${Math.floor(mins/1440)}d ${Math.floor((mins % 1440)/60)}h ago`
}

function computeRisk(machine: Machine, reputationScore: number) {
  const now       = Math.floor(Date.now() / 1000)
  const staleMins = Math.max(0, Math.floor((now - Number(machine.lastHeartbeat)) / 60))
  const ageHours  = Math.max(0, Math.floor((now - Number(machine.registeredAt))  / 3600))
  const isOffline = staleMins > 360

  // Hard block: attestation URI is contract-required since v2.
  // Machines without it are legacy registrations — they cannot be leased.
  if (!machine.attestationURI) {
    return {
      score: 0, tier: 'HIGH' as const, eligible: false, isOffline,
      staleLabel: formatStale(staleMins), staleMins,
      reasons: ['No attestation URI — legacy machine, cannot be leased'],
      pricePerEpoch: 0, discount: 35,
    }
  }

  let score = 50
  const reasons: string[] = []

  // Graduated heartbeat penalty — severity scales with time offline
  if      (staleMins > 1440) { score -= 70; reasons.push('Offline 24h+ — provider unreachable') }
  else if (staleMins >  720) { score -= 60; reasons.push('Offline 12h+ — likely unreachable') }
  else if (staleMins >  360) { score -= 50; reasons.push('Offline 6h+ — high risk') }
  else if (staleMins >  120) { score -= 35; reasons.push('Offline 2h+ — provider not responding') }
  else if (staleMins >   60) { score -= 25; reasons.push('Offline 1h+ — heartbeat stale') }
  else if (staleMins >   30) { score -= 15; reasons.push('Heartbeat older than 30 min') }
  else if (staleMins >    5) { score -=  5; reasons.push('Heartbeat slightly stale') }
  else if (staleMins >    2) { score +=  5; reasons.push('Heartbeat fresh') }
  else                       { score += 10; reasons.push('Heartbeat very fresh — active machine') }

  // Age
  if (ageHours <  24)  { score -= 10; reasons.push('Registered < 24 h ago') }
  else if (ageHours > 168) { score += 10; reasons.push('7+ days on platform') }

  // Reputation
  if (reputationScore < 400)      { score -= 25; reasons.push('Reputation below 400') }
  else if (reputationScore > 700) { score += 15; reasons.push('Reputation above 700') }

  score = Math.max(0, Math.min(100, score))
  const tier       = score >= 80 ? 'LOW' : score >= 50 ? 'MEDIUM' : 'HIGH'
  const eligible   = score >= 50 && !isOffline
  const marketRate = MARKET_RATES[machine.hardwareClass] ?? 0.3
  const basePerEpoch   = (marketRate * (60 / 3600)) / 0.1
  const multiplier     = score >= 80 ? 0.85 : score >= 50 ? 0.75 : 0.65
  const pricePerEpoch  = parseFloat((basePerEpoch * multiplier).toFixed(6))
  const discount       = Math.round((1 - multiplier) * 100)
  return { score, tier, eligible, isOffline, staleLabel: formatStale(staleMins), staleMins, reasons: reasons.slice(0, 3), pricePerEpoch, discount }
}

const TIER_STYLE: Record<string, string> = {
  LOW:    'bg-green-900/50 text-green-300 border border-green-800',
  MEDIUM: 'bg-yellow-900/50 text-yellow-300 border border-yellow-800',
  HIGH:   'bg-red-900/50 text-red-300 border border-red-800',
}

const STATUS_LABELS = ['Active', 'Completed', 'Disputed', 'Refunded']
const STATUS_COLORS = [
  'bg-blue-900/40 text-blue-300 border-blue-800',
  'bg-gray-800 text-gray-400 border-gray-700',
  'bg-yellow-900/40 text-yellow-300 border-yellow-800',
  'bg-red-900/40 text-red-300 border-red-800',
]

// ─── Single lease card — shows all statuses ───────────────────────────────────
function MyLeaseCard({ leaseId }: { leaseId: bigint }) {
  const [copied, setCopied] = useState(false)
  const { data: lease } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: 'getLease', args: [leaseId],
  })
  const { data: machine } = useReadContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'getMachine',
    args: lease ? [lease.machineId] : undefined,
    query: { enabled: !!lease },
  })
  const { writeContract, data: hash, isPending } = useWriteContract()
  const { isSuccess } = useWaitForTransactionReceipt({ hash })

  if (!lease || !machine) return null

  const isActive = lease.status === 0
  const epochsRemaining = Number(lease.totalEpochs) - Number(lease.epochsSettled)
  const now = Math.floor(Date.now() / 1000)
  const nextEpochAt = Number(lease.startTime) + (Number(lease.epochsSettled) + 1) * Number(lease.epochDuration)
  const minsToNext = Math.max(0, Math.floor((nextEpochAt - now) / 60))

  return (
    <div className={`bg-gray-900 rounded-xl border overflow-hidden ${isActive ? 'border-blue-900/40' : 'border-gray-800'}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-5 py-4 border-b border-gray-800 ${isActive ? 'bg-blue-950/20' : ''}`}>
        <div className="flex items-center gap-3">
          <Server size={16} className={isActive ? 'text-blue-400' : 'text-gray-500'}/>
          <div>
            <div className="font-semibold text-sm">
              {machine.hardwareClass} <span className="text-gray-500 font-normal">· {machine.region}</span>
            </div>
            <div className="text-xs text-gray-500">Lease #{leaseId.toString()}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${STATUS_COLORS[lease.status] ?? STATUS_COLORS[1]}`}>
            {STATUS_LABELS[lease.status] ?? 'Unknown'}
          </span>
          <Link href="/activity" className="text-xs flex items-center gap-1 text-blue-400 hover:underline">
            <Activity size={11}/>Settlements
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-px bg-gray-800">
        {[
          { label: 'Epochs',        value: `${lease.epochsSettled}/${lease.totalEpochs}` },
          { label: 'Remaining',     value: epochsRemaining > 0 ? `${epochsRemaining} left` : 'Done' },
          { label: 'Escrow Left',   value: `${parseFloat(formatEther(lease.escrowBalance)).toFixed(4)} BOT` },
          { label: isActive && epochsRemaining > 0 ? 'Next Settle' : 'Price/Epoch',
            value: isActive && epochsRemaining > 0
              ? (minsToNext > 0 ? `~${minsToNext}m` : 'Soon')
              : `${parseFloat(formatEther(lease.pricePerEpoch)).toFixed(4)} BOT` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-gray-900 px-3 py-3">
            <div className="text-xs text-gray-500 mb-1">{label}</div>
            <div className="font-bold text-sm">{value}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      <div className="px-5 py-2.5 border-b border-gray-800">
        <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full"
            style={{ width: `${(Number(lease.epochsSettled) / Number(lease.totalEpochs)) * 100}%` }}/>
        </div>
      </div>

      {/* Access instructions */}
      <div className="px-5 py-4 space-y-3">
        <div className="text-xs font-medium text-gray-300 flex items-center gap-2">
          <Shield size={12} className="text-green-400"/>
          {isActive ? 'How to access this machine' : 'Provider contact (for reference)'}
        </div>

        <div className="bg-gray-950 rounded-lg p-3 text-xs space-y-2">
          {isActive && (
            <p className="text-gray-400">
              Message the provider with your Lease ID{' '}
              <span className="font-mono text-blue-300">#{leaseId.toString()}</span>{' '}
              to receive SSH credentials or an API endpoint:
            </p>
          )}
          <div className="flex items-center gap-2 bg-gray-900 rounded px-3 py-2">
            <span className="font-mono text-gray-300 flex-1 truncate">{lease.provider}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(lease.provider); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              className="text-gray-400 hover:text-white shrink-0 transition">
              <Copy size={11}/>
            </button>
            {copied && <span className="text-green-400 text-xs">Copied!</span>}
          </div>
          <a href={`${EXPLORER}/address/${lease.provider}`} target="_blank" rel="noopener noreferrer"
            className="text-blue-400 hover:underline flex items-center gap-1 text-xs">
            <ExternalLink size={10}/>View provider on explorer
          </a>
        </div>

        {machine.attestationURI ? (
          <div className="bg-gray-950 rounded-lg p-3 text-xs">
            <p className="text-gray-400 mb-1.5">Attestation document — hardware specs + connection info:</p>
            <a href={machine.attestationURI} target="_blank" rel="noopener noreferrer"
              className="text-blue-400 hover:underline flex items-center gap-1">
              <ExternalLink size={11}/>Open attestation ↗
            </a>
          </div>
        ) : (
          <div className="bg-gray-950 rounded-lg p-3 text-xs text-gray-500">
            No attestation document — contact the provider wallet directly for access details.
          </div>
        )}

        {isActive && (
          <p className="text-xs text-gray-500">
            The AI agent checks heartbeats each epoch. Missed heartbeat = automatic refund to you.
            Check <Link href="/activity" className="text-blue-400 hover:underline">Activity</Link> to track settlements.
          </p>
        )}
      </div>

      {/* Dispute — only for active leases with remaining epochs */}
      {isActive && epochsRemaining > 0 && (
        <div className="px-5 py-3 border-t border-gray-800 flex justify-end">
          {isSuccess ? (
            <span className="text-xs text-yellow-400 flex items-center gap-1">
              <AlertTriangle size={11}/>Dispute raised
            </span>
          ) : (
            <button
              onClick={() => writeContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'raiseDispute', args: [leaseId] })}
              disabled={isPending}
              className="text-xs flex items-center gap-1.5 border border-red-800 text-red-400 hover:bg-red-950/30 px-3 py-1.5 rounded-lg transition disabled:opacity-50">
              {isPending ? <Loader2 size={11} className="animate-spin"/> : <AlertTriangle size={11}/>}
              Raise Dispute
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── My Leases wrapper — one component per lease ID, returns null if not buyer ─
function LeaseIfBuyer({ leaseId, address }: { leaseId: bigint; address: string }) {
  const { data: lease } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: 'getLease', args: [leaseId],
  })
  if (!lease) return null
  if (lease.buyer.toLowerCase() !== address.toLowerCase()) return null
  return <MyLeaseCard leaseId={leaseId}/>
}

function MyLeases({ address }: { address: `0x${string}` }) {
  const { data: leaseCount } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: 'leaseCount',
  })
  const count = Number(leaseCount ?? 0)
  const ids = useMemo(() => Array.from({ length: count }, (_, i) => BigInt(i + 1)), [count])
  if (count === 0) return null

  // We render all lease IDs; LeaseIfBuyer returns null for non-matching ones.
  // To avoid showing a header with nothing under it, we track count with a key trick:
  // just always show the section when leaseCount > 0 — in practice the wallet that
  // created the leases will always see their own.
  return (
    <div className="mb-10">
      <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
        <Activity size={18} className="text-blue-400"/>My Leases
      </h2>
      <p className="text-gray-400 text-sm mb-4">
        Your leased machines — active and completed. Contact the provider to get access credentials.
      </p>
      <div className="space-y-4">
        {ids.map(id => <LeaseIfBuyer key={id.toString()} leaseId={id} address={address}/>)}
      </div>
    </div>
  )
}

// ─── Machine Card ─────────────────────────────────────────────────────────────
function MachineCard({ machineId, onLease }: {
  machineId: bigint
  onLease: (id: bigint, m: Machine, price: number) => void
}) {
  const { data: machine } = useReadContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'getMachine', args: [machineId],
  })
  const { data: repScore } = useReadContract({
    address: REPUTATION, abi: REPUTATION_ABI, functionName: 'getScore',
    args: machine ? [machine.provider] : undefined,
    query: { enabled: !!machine },
  })
  if (!machine) return <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 animate-pulse h-48"/>
  if (machine.status !== 1) return null
  const risk = computeRisk(machine as Machine, Number(repScore ?? 500))

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Cpu size={15} className="text-blue-400"/>
            <span className="font-semibold">{machine.hardwareClass}</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-gray-400"><MapPin size={12}/>{machine.region}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          {risk.isOffline && (
            <span className="text-xs px-2 py-1 rounded-full font-mono font-bold bg-gray-800 text-gray-400 border border-gray-700">
              OFFLINE
            </span>
          )}
          <span className={`text-xs px-2 py-1 rounded-full font-mono font-bold ${TIER_STYLE[risk.tier]}`}>
            {risk.tier} RISK
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'AI Risk Score', value: `${risk.score}/100` },
          { label: 'Price/Epoch',   value: `${risk.pricePerEpoch} BOT`, hi: true },
          { label: 'Heartbeat',     value: risk.staleLabel,
            color: risk.staleMins > 30 ? 'text-red-400' : 'text-green-400' },
          { label: 'Discount',      value: `${risk.discount}% off market` },
        ].map(({ label, value, hi, color }) => (
          <div key={label} className="bg-gray-950 rounded-lg p-3">
            <div className="text-gray-500 text-xs mb-1">{label}</div>
            <div className={`font-bold text-sm ${color ?? (hi ? 'text-blue-400' : '')}`}>{value}</div>
          </div>
        ))}
      </div>
      <ul className="text-xs text-gray-500 space-y-0.5">
        {risk.reasons.map(r => <li key={r}>· {r}</li>)}
      </ul>
      {!machine.attestationURI && (
        <div className="bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2 text-xs text-red-300">
          ⚠ No attestation URI — you will not be able to verify hardware or contact this provider
        </div>
      )}
      {machine.attestationURI && (
        <a href={machine.attestationURI} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-400 hover:underline">
          <ExternalLink size={11}/>View Attestation
        </a>
      )}
      <div className="flex gap-2 mt-auto">
        {risk.eligible ? (
          <button
            onClick={() => onLease(machineId, machine as Machine, risk.pricePerEpoch)}
            className="flex-1 bg-blue-600 hover:bg-blue-700 py-2 rounded-lg text-sm font-medium transition">
            Lease This Machine
          </button>
        ) : (
          <div className="flex-1 bg-gray-800 py-2 rounded-lg text-sm text-center text-gray-500 cursor-not-allowed">
            {risk.isOffline ? 'Machine Offline — Cannot Lease' : 'High Risk — Ineligible'}
          </div>
        )}
        <a href={`${EXPLORER}/address/${machine.provider}`} target="_blank" rel="noopener noreferrer"
          className="px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition">
          <ExternalLink size={14}/>
        </a>
      </div>
    </div>
  )
}

// ─── Lease Modal ──────────────────────────────────────────────────────────────
function LeaseModal({ machineId, machine, pricePerEpoch, onClose }: {
  machineId: bigint; machine: Machine; pricePerEpoch: number; onClose: () => void
}) {
  const [epochDuration, setEpochDuration] = useState('60')
  const [totalEpochs, setTotalEpochs] = useState('5')
  const epochs = Math.max(1, parseInt(totalEpochs || '1'))
  const duration = Math.max(60, parseInt(epochDuration || '60'))
  const totalPrice = pricePerEpoch * epochs
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const handleLease = () => {
    const aiQuoteHash = keccak256(toBytes(`quote-${machineId}-${Date.now()}`))
    writeContract({
      address: ESCROW, abi: ESCROW_ABI, functionName: 'createLease',
      args: [machineId, BigInt(duration), BigInt(epochs), aiQuoteHash],
      value: parseEther(totalPrice.toFixed(8)),
    })
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-gray-700 shadow-2xl">
        <h2 className="text-xl font-bold mb-1">Lease {machine.hardwareClass}</h2>
        <p className="text-gray-400 text-sm mb-6">{machine.region} · Machine #{machineId.toString()}</p>
        {isSuccess ? (
          <div className="text-center py-6">
            <CheckCircle size={48} className="text-green-400 mx-auto mb-4"/>
            <p className="text-green-400 font-semibold mb-2">Lease Created!</p>
            <p className="text-gray-400 text-sm mb-1">
              BOT locked in escrow. The AI agent monitors uptime and settles each epoch automatically.
            </p>
            <p className="text-gray-500 text-xs mb-5">
              Check &quot;My Leases&quot; above — contact the provider to get your SSH / API credentials.
            </p>
            <div className="flex gap-3 justify-center">
              {hash && (
                <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
                  className="text-blue-400 hover:underline text-sm">View TX ↗</a>
              )}
              <button onClick={onClose} className="text-sm text-gray-400 hover:text-white">Close</button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Epoch Duration (seconds, min 60)</label>
                <input type="number" value={epochDuration} min="60"
                  onChange={e => setEpochDuration(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none text-sm"/>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Total Epochs (max 50)</label>
                <input type="number" value={totalEpochs} min="1" max="50"
                  onChange={e => setTotalEpochs(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none text-sm"/>
              </div>
              <div className="bg-gray-950 rounded-lg p-4 text-sm space-y-2">
                <div className="flex justify-between text-gray-400">
                  <span>Price per epoch</span><span>{pricePerEpoch} BOT</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Epochs</span><span>× {epochs}</span>
                </div>
                <div className="flex justify-between font-bold border-t border-gray-800 pt-2">
                  <span>Total escrow</span>
                  <span className="text-blue-400">{totalPrice.toFixed(6)} BOT</span>
                </div>
              </div>
              <div className="bg-blue-950/30 border border-blue-900/40 rounded-lg p-3 text-xs text-blue-300">
                After leasing, contact the provider (shown in &quot;My Leases&quot; above) to get SSH / API access.
                Missed heartbeats = automatic refund to you for that epoch.
              </div>
            </div>
            {error && (
              <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-xs mb-4">
                {error.message.split('\n')[0]}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 border border-gray-600 py-3 rounded-lg hover:border-gray-400 transition text-sm">
                Cancel
              </button>
              <button onClick={handleLease} disabled={isPending || isConfirming}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-3 rounded-lg font-medium transition flex items-center justify-center gap-2 text-sm">
                {(isPending || isConfirming) && <Loader2 size={15} className="animate-spin"/>}
                {isPending ? 'Confirm in wallet…' : isConfirming ? 'Confirming…' : 'Create Lease'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function MarketplacePage() {
  const { address, isConnected } = useAccount()
  const [leaseTarget, setLeaseTarget] = useState<{ id: bigint; machine: Machine; pricePerEpoch: number } | null>(null)

  const { data: machineCount } = useReadContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'machineCount',
  })
  const count = Number(machineCount ?? 0)
  const machineIds = useMemo(() => Array.from({ length: count }, (_, i) => BigInt(i + 1)), [count])

  return (
    <div className="min-h-screen">
      <Navbar/>

      <div className="max-w-5xl mx-auto px-6 py-12">
        {isConnected && address && <MyLeases address={address}/>}

        <div className="flex items-start justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-1">Compute Marketplace</h1>
            <p className="text-gray-400 text-sm">
              {count} machine{count !== 1 ? 's' : ''} registered ·{' '}
              <a href={`${EXPLORER}/address/${REGISTRY}`} target="_blank" rel="noopener noreferrer"
                className="text-blue-400 hover:underline">AssetRegistry ↗</a>
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
            <Shield size={13} className="text-blue-400"/>
            AI-verified uptime · trustless payment
          </div>
        </div>

        {!isConnected && (
          <div className="bg-blue-950/40 border border-blue-900 rounded-xl p-4 mb-8 flex items-center justify-between gap-4">
            <p className="text-blue-300 text-sm">Connect wallet to lease machines and view your active leases</p>
            <ConnectButton/>
          </div>
        )}

        {count === 0 ? (
          <div className="text-center py-24 text-gray-500">
            <Cpu size={48} className="mx-auto mb-4 opacity-30"/>
            <p className="text-lg mb-2">No machines registered yet</p>
            <Link href="/provider" className="text-blue-400 hover:underline text-sm">Register your machine →</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {machineIds.map(id => (
              <MachineCard key={id.toString()} machineId={id}
                onLease={(id, m, p) => setLeaseTarget({ id, machine: m, pricePerEpoch: p })}/>
            ))}
          </div>
        )}
      </div>

      {leaseTarget && (
        <LeaseModal
          machineId={leaseTarget.id}
          machine={leaseTarget.machine}
          pricePerEpoch={leaseTarget.pricePerEpoch}
          onClose={() => setLeaseTarget(null)}
        />
      )}
    </div>
  )
}