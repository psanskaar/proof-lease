'use client'
import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { CheckCircle, XCircle, ArrowLeft, Loader2, ExternalLink, Info } from 'lucide-react'
import Link from 'next/link'

const PROOF_ROUTER = process.env.NEXT_PUBLIC_PROOF_ROUTER as `0x${string}`
const EXPLORER     = process.env.NEXT_PUBLIC_EXPLORER || 'https://scan.bohr.life'

const PROOF_ROUTER_ABI = [
  { name: 'getProof', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'leaseId', type: 'uint256' }, { name: 'epoch', type: 'uint256' }],
    outputs: [{ type: 'bytes32' }] },
  { name: 'proofCount', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'leaseId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }] },
] as const

const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'

// Demo examples using the agent's exact proof format:
// `lease-${leaseId}-epoch-${epoch}-ts-${Date.now()}-ok-${compliant}`
// (Date.now() = milliseconds, matching index.js exactly)
const DEMOS = [
  { label: 'Epoch 0 — compliant', leaseId: '1', epoch: '0', proofData: 'lease-1-epoch-0-ts-1723545600000-ok-true'  },
  { label: 'Epoch 3 — BREACH',    leaseId: '1', epoch: '3', proofData: 'lease-1-epoch-3-ts-1723559400000-ok-false' },
]

export default function VerifyPage() {
  const [leaseId,   setLeaseId]   = useState('')
  const [epoch,     setEpoch]     = useState('')
  const [proofData, setProofData] = useState('')
  const [computed,  setComputed]  = useState('')
  const [verified,  setVerified]  = useState(false)

  const ready = !!(leaseId && epoch)

  const { data: onChainHash, isLoading } = useReadContract({
    address: PROOF_ROUTER, abi: PROOF_ROUTER_ABI, functionName: 'getProof',
    args: ready ? [BigInt(leaseId), BigInt(epoch)] : undefined,
    query: { enabled: ready },
  })

  const { data: proofCount } = useReadContract({
    address: PROOF_ROUTER, abi: PROOF_ROUTER_ABI, functionName: 'proofCount',
    args: leaseId ? [BigInt(leaseId)] : undefined,
    query: { enabled: !!leaseId },
  })

  const hasOnChain = onChainHash && onChainHash !== ZERO
  const isMatch    = hasOnChain && computed
    ? computed.toLowerCase() === (onChainHash as string).toLowerCase()
    : null

  const handleVerify = () => {
    if (!proofData.trim()) return
    setComputed(keccak256(toBytes(proofData.trim())))
    setVerified(true)
  }

  const loadDemo = (d: typeof DEMOS[number]) => {
    setLeaseId(d.leaseId); setEpoch(d.epoch); setProofData(d.proofData)
    setComputed(''); setVerified(false)
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white mb-8 text-sm transition">
        <ArrowLeft size={16}/> Back to home
      </Link>

      <h1 className="text-3xl font-bold mb-2">Proof Verifier</h1>
      <p className="text-gray-400 mb-1 text-sm leading-relaxed">
        Every epoch settlement stores a keccak256 proof hash on BOT Chain via{' '}
        <a href={`${EXPLORER}/address/${PROOF_ROUTER}`} target="_blank" rel="noopener noreferrer"
          className="text-blue-400 hover:underline">ProofRouter ↗</a>.
        Enter the lease ID, epoch, and raw proof string to independently recompute the hash
        and confirm it matches the on-chain record — proving the AI agent's decision was deterministic.
      </p>
      <p className="text-xs text-gray-600 mb-6">
        Agent proof format: <code className="text-blue-300/70">lease-[id]-epoch-[n]-ts-[Date.now()]-ok-[true/false]</code>
      </p>

      {/* Demo quick-fills */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
          <Info size={12}/>Try a demo (seeded testnet transactions):
        </div>
        <div className="flex gap-2 flex-wrap">
          {DEMOS.map(d => (
            <button key={d.label} onClick={() => loadDemo(d)}
              className="text-xs border border-gray-700 hover:border-blue-600 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition">
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Lease ID</label>
            <input value={leaseId} placeholder="e.g. 1"
              onChange={e => { setLeaseId(e.target.value); setVerified(false); setComputed('') }}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none text-sm"/>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Epoch Number</label>
            <input value={epoch} placeholder="e.g. 0"
              onChange={e => { setEpoch(e.target.value); setVerified(false); setComputed('') }}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none text-sm"/>
          </div>
        </div>

        {/* Live on-chain read */}
        {ready && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs">
            <div className="flex items-center gap-2 text-gray-500 mb-2">
              {isLoading && <Loader2 size={11} className="animate-spin"/>}
              On-chain hash — ProofRouter.getProof({leaseId}, {epoch}):
            </div>
            {isLoading ? (
              <span className="text-gray-600">Fetching from BOT Chain…</span>
            ) : hasOnChain ? (
              <>
                <div className="font-mono break-all text-blue-300">{onChainHash}</div>
                <div className="mt-2 flex items-center gap-4 text-gray-600">
                  {proofCount !== undefined && <span>Total proofs for lease #{leaseId}: {proofCount.toString()}</span>}
                  <a href={`${EXPLORER}/address/${PROOF_ROUTER}?tab=read_contract`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-500 hover:underline">
                    Verify on explorer <ExternalLink size={11}/>
                  </a>
                </div>
              </>
            ) : (
              <span className="text-gray-600">
                No proof stored yet for lease {leaseId} epoch {epoch}.
              </span>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm text-gray-400 mb-1">Raw Proof Data</label>
          <textarea value={proofData} rows={3}
            placeholder={`lease-1-epoch-0-ts-${Date.now()}-ok-true`}
            onChange={e => { setProofData(e.target.value); setVerified(false); setComputed('') }}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white font-mono text-xs focus:border-blue-500 outline-none resize-none"/>
        </div>

        <button onClick={handleVerify} disabled={!proofData.trim()}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 py-3 rounded-lg font-medium transition text-sm">
          Compute &amp; Verify Hash
        </button>
      </div>

      {/* Result */}
      {verified && computed && (
        <div className={`p-6 rounded-xl border ${
          hasOnChain
            ? isMatch ? 'border-green-700 bg-green-950/40' : 'border-red-700 bg-red-950/40'
            : 'border-gray-700 bg-gray-900'
        }`}>
          <div className="flex items-center gap-2 text-lg font-bold mb-4">
            {hasOnChain
              ? isMatch
                ? <><CheckCircle size={20} className="text-green-400"/>PROOF VERIFIED</>
                : <><XCircle    size={20} className="text-red-400"/>HASH MISMATCH</>
              : <><CheckCircle size={20} className="text-blue-400"/>HASH COMPUTED</>
            }
          </div>
          <div className="space-y-3 text-xs font-mono">
            <div>
              <div className="text-gray-500 mb-1">Computed from your input:</div>
              <div className="bg-gray-950/60 rounded p-2 break-all">{computed}</div>
            </div>
            {hasOnChain && (
              <div>
                <div className="text-gray-500 mb-1">Stored on-chain (ProofRouter):</div>
                <div className="bg-gray-950/60 rounded p-2 break-all">{onChainHash}</div>
              </div>
            )}
          </div>
          {!hasOnChain && (
            <p className="text-gray-500 text-xs mt-4">
              No on-chain proof found for lease {leaseId} epoch {epoch}.
              The hash above is what would be stored if this data were submitted.
            </p>
          )}
          {isMatch === false && (
            <p className="text-red-300 text-xs mt-4">
              Input data does not match what was stored on-chain. The agent may have used a different timestamp or proof string for this epoch.
            </p>
          )}
        </div>
      )}

      {/* Explainer */}
      <div className="mt-8 bg-gray-900 rounded-xl p-4 border border-gray-800 text-xs text-gray-500 leading-relaxed">
        <strong className="text-gray-400">How it works: </strong>
        The agent calls <code className="text-blue-300">ProofRouter.submitProof(leaseId, epoch, dataHash)</code> before
        each <code className="text-blue-300">LeaseEscrow.settleEpoch()</code>. The contract stores the resulting
        keccak256 hash permanently. This page lets anyone recompute the hash from the original proof string
        and confirm the agent's decision was based on real telemetry — not fabricated data.
      </div>
    </div>
  )
}
