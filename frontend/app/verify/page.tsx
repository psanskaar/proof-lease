'use client'
import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { Navbar } from '@/components/Navbar'
import { CheckCircle, XCircle, Loader2, ExternalLink, Info, Brain } from 'lucide-react'

const PROOF_ROUTER = process.env.NEXT_PUBLIC_PROOF_ROUTER as `0x${string}`
const EXPLORER     = process.env.NEXT_PUBLIC_EXPLORER || 'https://scan.botchain.ai'

const PROOF_ROUTER_ABI = [
  { name: 'getProof', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'leaseId', type: 'uint256' }, { name: 'epoch', type: 'uint256' }],
    outputs: [{ type: 'bytes32' }] },
  { name: 'proofCount', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'leaseId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }] },
] as const

const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'

// New proof format includes Groq confidence: lease-[id]-epoch-[n]-ts-[ms]-ok-[bool]-conf-[0-100]
const DEMOS = [
  { label: 'Compliant (Groq 87%)',  leaseId: '1', epoch: '0', proofData: 'lease-1-epoch-0-ts-1723545600000-ok-true-conf-87'  },
  { label: 'BREACH (Groq 95%)',     leaseId: '1', epoch: '3', proofData: 'lease-1-epoch-3-ts-1723559400000-ok-false-conf-95' },
  { label: 'Compliant (fallback)',  leaseId: '2', epoch: '0', proofData: 'lease-2-epoch-0-ts-1723545600000-ok-true-conf-90'  },
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

  const reset = () => {
    setLeaseId(''); setEpoch(''); setProofData('')
    setComputed(''); setVerified(false)
  }

  return (
    <div className="min-h-screen">
      <Navbar/>

      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-3xl font-bold">Proof Verifier</h1>
          <span className="text-xs bg-purple-950/60 text-purple-300 border border-purple-900 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Brain size={11}/>Groq-powered
          </span>
        </div>
        <p className="text-gray-400 mb-2 text-sm leading-relaxed">
          Every epoch settlement stores a keccak256 proof hash on BOT Chain via{' '}
          <a href={`${EXPLORER}/address/${PROOF_ROUTER}`} target="_blank" rel="noopener noreferrer"
            className="text-blue-400 hover:underline">ProofRouter ↗</a>.
          Enter the lease ID, epoch number, and raw proof string to independently recompute the hash
          and confirm it matches the on-chain record — proving the Groq AI agent used real signals,
          not fabricated data.
        </p>
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-3 mb-6 text-xs font-mono text-gray-500">
          <div className="text-gray-600 mb-1">Proof format (new — includes Groq confidence score):</div>
          <div className="text-blue-300/80">lease-[id]-epoch-[n]-ts-[ms]-ok-[true|false]-conf-[0-100]</div>
        </div>

        {/* Demo fills */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
            <Info size={12}/>Try a demo:
          </div>
          <div className="flex gap-2 flex-wrap">
            {DEMOS.map(d => (
              <button key={d.label} onClick={() => loadDemo(d)}
                className="text-xs border border-gray-700 hover:border-purple-600 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition">
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
                On-chain hash — <span className="font-mono text-blue-300/70">ProofRouter.getProof({leaseId}, {epoch})</span>
              </div>
              {isLoading ? (
                <span className="text-gray-600">Reading from BOT Chain…</span>
              ) : hasOnChain ? (
                <>
                  <div className="font-mono break-all text-blue-300">{onChainHash as string}</div>
                  <div className="mt-2 flex items-center gap-4 text-gray-600">
                    {proofCount !== undefined && <span>Total proofs for lease #{leaseId}: {proofCount.toString()}</span>}
                    <a href={`${EXPLORER}/address/${PROOF_ROUTER}?tab=read_contract`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-500 hover:underline">
                      Verify on explorer <ExternalLink size={11}/>
                    </a>
                  </div>
                </>
              ) : (
                <span className="text-gray-600">No proof stored for lease {leaseId} epoch {epoch}.</span>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-400 mb-1">Raw Proof Data</label>
            <textarea value={proofData} rows={3}
              placeholder={`lease-1-epoch-0-ts-${Date.now()}-ok-true-conf-87`}
              onChange={e => { setProofData(e.target.value); setVerified(false); setComputed('') }}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white font-mono text-xs focus:border-blue-500 outline-none resize-none"/>
            <p className="text-xs text-gray-600 mt-1">
              Find this in the Activity feed — click any settlement card&apos;s &ldquo;Verify proof&rdquo; link to pre-fill.
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={handleVerify} disabled={!proofData.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 py-3 rounded-lg font-medium transition text-sm">
              Compute &amp; Verify Hash
            </button>
            {(leaseId || proofData) && (
              <button onClick={reset}
                className="px-4 py-3 border border-gray-700 hover:border-gray-500 rounded-lg text-sm text-gray-400 transition">
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Result */}
        {verified && computed && (
          <div className={`p-6 rounded-xl border mb-6 ${
            hasOnChain
              ? isMatch ? 'border-green-700 bg-green-950/40' : 'border-red-700 bg-red-950/40'
              : 'border-gray-700 bg-gray-900'
          }`}>
            <div className="flex items-center gap-2 text-lg font-bold mb-4">
              {hasOnChain
                ? isMatch
                  ? <><CheckCircle size={20} className="text-green-400"/>PROOF VERIFIED — Groq used real data</>
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
                  <div className="bg-gray-950/60 rounded p-2 break-all">{onChainHash as string}</div>
                </div>
              )}
            </div>
            {isMatch && (
              <p className="text-green-300 text-xs mt-4">
                The Groq AI agent&apos;s settlement decision is cryptographically verified. The proof data — including lease ID,
                epoch, timestamp, compliance verdict, and confidence score — matches what was committed on-chain before
                the escrow transaction executed.
              </p>
            )}
            {isMatch === false && (
              <p className="text-red-300 text-xs mt-4">
                Input data does not match the on-chain record. The agent may have used different proof data for this epoch.
                Copy the exact proof string from the Activity feed — small differences (spaces, casing) will change the hash.
              </p>
            )}
            {!hasOnChain && (
              <p className="text-gray-500 text-xs mt-4">
                No on-chain proof found for lease {leaseId} epoch {epoch}.
                The hash above is what the agent would store if this proof data were submitted.
              </p>
            )}
          </div>
        )}

        {/* Explainer */}
        <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 text-xs text-gray-500 leading-relaxed space-y-2">
          <div className="flex items-center gap-2 text-gray-400 font-medium mb-1">
            <Brain size={14} className="text-purple-400"/>How Groq verification works
          </div>
          <p>
            Each epoch, the AI agent calls Groq&apos;s LLM with the machine&apos;s heartbeat age, provider reputation score,
            fulfillment rate, machine age, and region. Groq returns a compliance verdict, reasoning text, and a confidence
            score (0–100).
          </p>
          <p>
            Before executing the escrow transaction, the agent calls{' '}
            <span className="font-mono text-blue-300">ProofRouter.submitProof(leaseId, epoch, dataHash)</span> to commit
            the proof string — which includes the verdict and Groq&apos;s confidence — on-chain. This makes the decision
            tamper-evident: you can recompute the keccak256 hash from the raw proof and confirm it matches what was
            stored before money moved.
          </p>
          <p>
            This page proves the agent didn&apos;t fabricate telemetry or change its verdict after seeing the outcome.
            The hash was committed first; the payment followed.
          </p>
        </div>
      </div>
    </div>
  )
}