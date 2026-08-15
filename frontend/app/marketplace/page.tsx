'use client'
import { useState, useMemo } from 'react'
import {
  useReadContract, useWriteContract, useAccount, useWaitForTransactionReceipt,
} from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { parseEther, keccak256, toBytes } from 'viem'
import { Cpu, MapPin, ExternalLink, ArrowLeft, Loader2, CheckCircle, Shield } from 'lucide-react'
import Link from 'next/link'

// ─── Addresses ───────────────────────────────────────────────────────────────
const REGISTRY   = process.env.NEXT_PUBLIC_ASSET_REGISTRY as `0x${string}`
const ESCROW     = process.env.NEXT_PUBLIC_LEASE_ESCROW   as `0x${string}`
const REPUTATION = process.env.NEXT_PUBLIC_REPUTATION     as `0x${string}`
const EXPLORER   = process.env.NEXT_PUBLIC_EXPLORER || 'https://scan.bohr.life'

// ─── ABIs ────────────────────────────────────────────────────────────────────
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
  { name: 'createLease', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'machineId',    type: 'uint256' },
      { name: 'epochDuration', type: 'uint256' },
      { name: 'totalEpochs',  type: 'uint256' },
      { name: 'aiQuoteHash',  type: 'bytes32' },
    ],
    outputs: [{ type: 'uint256' }] },
] as const

// ─── Types ────────────────────────────────────────────────────────────────────
type Machine = {
  provider: `0x${string}`; hardwareHash: `0x${string}`
  region: string; hardwareClass: string; attestationURI: string
  registeredAt: bigint; lastHeartbeat: bigint; status: number
}

// ─── Risk + Pricing — mirrors riskScorer.js and quoteEngine.js exactly ───────
const MARKET_RATES: Record<string, number> = {
  'GPU-H100': 2.5, 'GPU-A100': 1.8, 'GPU-RTX4090': 0.8,
  'GPU-RTX3090': 0.45, 'CPU-64': 0.3,
}

function computeRisk(machine: Machine, reputationScore: number) {
  let score = 50
  const reasons: string[] = []
  const now = Math.floor(Date.now() / 1000)
  const staleMins = Math.max(0, Math.floor((now - Number(machine.lastHeartbeat)) / 60))
  const ageHours  = Math.max(0, Math.floor((now - Number(machine.registeredAt))  / 3600))

  if (staleMins > 30) { score -= 20; reasons.push('Heartbeat older than 30 min') }
  else                { reasons.push('Heartbeat is fresh') }

  if (!machine.attestationURI) { score -= 15; reasons.push('No attestation URI') }
  else                          { score +=  5 }

  if (ageHours < 24)       { score -= 10; reasons.push('Registered < 24 h ago') }
  else if (ageHours > 168) { score += 10; reasons.push('> 7 days on platform') }

  if (reputationScore < 400)      { score -= 25; reasons.push('Reputation below 400') }
  else if (reputationScore > 700) { score += 15; reasons.push('Reputation above 700') }

  score = Math.max(0, Math.min(100, score))
  const tier = score >= 80 ? 'LOW' : score >= 50 ? 'MEDIUM' : 'HIGH'

  // Pricing: mirrors getLocalQuote() — epochDuration fixed at 60 s for display
  const marketRate = MARKET_RATES[machine.hardwareClass] ?? 0.3
  const hoursPerEpoch = 60 / 3600
  const basePerEpoch  = (marketRate * hoursPerEpoch) / 0.1          // 1 BOT = $0.10
  const multiplier    = score >= 80 ? 0.85 : score >= 50 ? 0.75 : 0
  const pricePerEpoch = parseFloat((basePerEpoch * multiplier).toFixed(6))
  const discount      = Math.round((1 - multiplier) * 100)

  return {
    score, tier, reasons: reasons.slice(0, 3),
    eligible: score >= 20, pricePerEpoch, discount, staleMins,
    suggestedMaxEpochs: score >= 80 ? 50 : score >= 50 ? 10 : 0,
  }
}

const TIER_STYLE = {
  LOW:    'bg-green-900/50 text-green-300 border border-green-800',
  MEDIUM: 'bg-yellow-900/50 text-yellow-300 border border-yellow-800',
  HIGH:   'bg-red-900/50 text-red-300 border border-red-800',
}

// ─── MachineCard ─────────────────────────────────────────────────────────────
function MachineCard({ machineId, onLease }: {
  machineId: bigint
  onLease: (id: bigint, m: Machine, pricePerEpoch: number) => void
}) {
  const { data: machine } = useReadContract({
    address: REGISTRY, abi: REGISTRY_ABI,
    functionName: 'getMachine', args: [machineId],
  })

  const { data: repScore } = useReadContract({
    address: REPUTATION, abi: REPUTATION_ABI,
    functionName: 'getScore',
    args: machine ? [machine.provider] : undefined,
    query: { enabled: !!machine },
  })

  if (!machine) return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 animate-pulse space-y-3">
      <div className="h-4 bg-gray-800 rounded w-3/4" />
      <div className="h-3 bg-gray-800 rounded w-1/2" />
      <div className="h-3 bg-gray-800 rounded w-2/3" />
    </div>
  )
  if (machine.status !== 1) return null

  const rep  = Number(repScore ?? 500)
  const risk = computeRisk(machine as Machine, rep)

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Cpu size={15} className="text-blue-400" />
            <span className="font-semibold">{machine.hardwareClass}</span>
          </div>
          <div className="flex items-center gap-1 text-sm text-gray-400">
            <MapPin size={12} />{machine.region}
          </div>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full font-mono font-bold ${TIER_STYLE[risk.tier as 'LOW' | 'MEDIUM' | 'HIGH']}`}>
          {risk.tier} RISK
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        {[
          { label: 'AI Risk Score',   value: `${risk.score}/100` },
          { label: 'Price/Epoch',     value: `${risk.pricePerEpoch} BOT`, hi: true },
          { label: 'Heartbeat',       value: `${risk.staleMins}m ago`,
            color: risk.staleMins > 30 ? 'text-red-400' : 'text-green-400' },
          { label: 'Discount',        value: `${risk.discount}% off market` },
        ].map(({ label, value, hi, color }) => (
          <div key={label} className="bg-gray-950 rounded-lg p-3">
            <div className="text-gray-500 text-xs mb-1">{label}</div>
            <div className={`font-bold text-sm ${color ?? (hi ? 'text-blue-400' : '')}`}>{value}</div>
          </div>
        ))}
      </div>

      {risk.reasons.length > 0 && (
        <ul className="text-xs text-gray-500 space-y-0.5">
          {risk.reasons.map(r => <li key={r}>· {r}</li>)}
        </ul>
      )}

      {machine.attestationURI && (
        <a href={machine.attestationURI} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-blue-400 hover:underline">
          <ExternalLink size={11} /> View Attestation
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
            High Risk — Ineligible
          </div>
        )}
        <a href={`${EXPLORER}/address/${machine.provider}`} target="_blank" rel="noopener noreferrer"
          className="px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-white transition">
          <ExternalLink size={14} />
        </a>
      </div>
    </div>
  )
}

// ─── LeaseModal ───────────────────────────────────────────────────────────────
function LeaseModal({ machineId, machine, pricePerEpoch, onClose }: {
  machineId: bigint; machine: Machine; pricePerEpoch: number; onClose: () => void
}) {
  const [epochDuration, setEpochDuration] = useState('60')
  const [totalEpochs,   setTotalEpochs]   = useState('5')

  const epochs     = Math.max(1, parseInt(totalEpochs   || '1'))
  const duration   = Math.max(60, parseInt(epochDuration || '60'))
  const totalPrice = pricePerEpoch * epochs

  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const handleLease = () => {
    const aiQuoteHash = keccak256(toBytes(`quote-machine-${machineId}-ts-${Date.now()}`))
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
        <p className="text-gray-400 text-sm mb-6">{machine.region} · #{machineId.toString()}</p>

        {isSuccess ? (
          <div className="text-center py-8">
            <CheckCircle size={48} className="text-green-400 mx-auto mb-4" />
            <p className="text-green-400 font-semibold mb-2">Lease Created!</p>
            <p className="text-gray-500 text-sm mb-4">
              BOT escrowed. The AI agent will monitor heartbeats and settle each epoch automatically.
            </p>
            {hash && (
              <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
                className="text-blue-400 hover:underline text-sm">View on Explorer ↗</a>
            )}
          </div>
        ) : (
          <>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Epoch Duration (seconds, min 60)</label>
                <input type="number" value={epochDuration} min="60"
                  onChange={e => setEpochDuration(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none text-sm" />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Total Epochs (max {machine ? '50' : '10'})
                </label>
                <input type="number" value={totalEpochs} min="1"
                  onChange={e => setTotalEpochs(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none text-sm" />
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
                {(isPending || isConfirming) && <Loader2 size={15} className="animate-spin" />}
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
  const { isConnected } = useAccount()
  const [leaseTarget, setLeaseTarget] = useState<{
    id: bigint; machine: Machine; pricePerEpoch: number
  } | null>(null)

  const { data: machineCount } = useReadContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'machineCount',
  })

  const count = Number(machineCount ?? 0)
  const machineIds = useMemo(
    () => Array.from({ length: count }, (_, i) => BigInt(i + 1)),
    [count]
  )

  return (
    <div className="min-h-screen">
      <nav className="border-b border-gray-800 px-6 py-4 flex justify-between items-center sticky top-0 bg-gray-950/90 backdrop-blur z-40">
        <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition">
          <ArrowLeft size={16} />
          <span className="text-blue-400 font-bold">ProofLease</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/provider" className="text-sm text-gray-400 hover:text-white transition">Provide</Link>
          <Link href="/verify"   className="text-sm text-gray-400 hover:text-white transition">Verify</Link>
          <ConnectButton />
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-12">
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
            <Shield size={13} className="text-blue-400" />
            Risk + pricing mirrors the on-chain AI agent
          </div>
        </div>

        {!isConnected && (
          <div className="bg-blue-950/40 border border-blue-900 rounded-xl p-4 mb-8 flex items-center justify-between gap-4">
            <p className="text-blue-300 text-sm">Connect your wallet to create leases and escrow BOT</p>
            <ConnectButton />
          </div>
        )}

        {count === 0 ? (
          <div className="text-center py-24 text-gray-500">
            <Cpu size={48} className="mx-auto mb-4 opacity-30" />
            <p className="text-lg mb-2">No machines registered yet</p>
            <Link href="/provider" className="text-blue-400 hover:underline text-sm">Register your machine →</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {machineIds.map(id => (
              <MachineCard key={id.toString()} machineId={id}
                onLease={(id, m, p) => setLeaseTarget({ id, machine: m, pricePerEpoch: p })} />
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
