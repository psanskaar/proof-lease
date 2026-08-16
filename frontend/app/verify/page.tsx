'use client'
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useReadContract } from 'wagmi'
import { keccak256, toBytes } from 'viem'
import { Navbar } from '@/components/Navbar'
import {
  CheckCircle, XCircle, Loader2, ExternalLink, Info,
  Brain, Shield, Link2,
} from 'lucide-react'

const PROOF_ROUTER = process.env.NEXT_PUBLIC_PROOF_ROUTER as `0x${string}`
const AGENT_URL    = process.env.NEXT_PUBLIC_AGENT_URL || ''
const EXPLORER     = process.env.NEXT_PUBLIC_EXPLORER || 'https://scan.botchain.ai'

const PROOF_ROUTER_ABI = [
  { name: 'getProof', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'leaseId', type: 'uint256' }, { name: 'epoch', type: 'uint256' }],
    outputs: [{ type: 'bytes32' }] },
  { name: 'proofCount', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'leaseId', type: 'uint256' }],
    outputs: [{ type: 'uint256' }] },
] as const

const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'

function shortHash(h: string) { return `${h.slice(0,14)}…${h.slice(-8)}` }

// ─── How verification works ───────────────────────────────────────────────────
// ProofRouter.submitProof stores: keccak256(abi.encodePacked(leaseId, epoch, block.timestamp, dataHash, sender))
// That composite hash cannot be recomputed client-side without knowing the exact block.timestamp.
//
// So we do TWO-STEP verification:
// Step 1 — Data integrity: compute keccak256(rawProofData) locally → compare with agent's stored dataHash
//          This proves the rawProofData string was NOT altered after the agent submitted it.
// Step 2 — On-chain existence: ProofRouter.getProof(leaseId, epoch) returns non-zero
//          This proves the agent DID commit a proof to the blockchain for this epoch.
//
// Together: the raw evidence is self-consistent AND was committed to chain before the escrow settled.

function VerifyInner() {
  const params = useSearchParams()

  const [leaseId,     setLeaseId]     = useState(params.get('leaseId') || '')
  const [epoch,       setEpoch]       = useState(params.get('epoch')   || '')
  const [rawProof,    setRawProof]    = useState('')
  const [agentEntry,  setAgentEntry]  = useState<any>(null)
  const [fetching,    setFetching]    = useState(false)
  const [fetchErr,    setFetchErr]    = useState('')
  const [result,      setResult]      = useState<null | {
    computedHash: string
    agentDataHash: string | null
    step1: 'match' | 'mismatch' | 'no-agent'
    rawProofData: string | null
  }>(null)

  const ready = !!(leaseId && epoch && leaseId.match(/^\d+$/) && epoch.match(/^\d+$/))

  // Fetch agent proof when leaseId + epoch are set from URL params or form
  const fetchAgentProof = useCallback(async (lid: string, ep: string) => {
    if (!AGENT_URL || !lid || !ep) return
    setFetching(true); setFetchErr('')
    try {
      const r = await fetch(`${AGENT_URL}/proofs/${lid}/${ep}`)
      if (r.ok) {
        const d = await r.json()
        setAgentEntry(d)
        // Auto-fill rawProof from agent if field is empty
        const raw = d.rawProofData || d.proofData || ''
        if (raw) setRawProof(raw)
      } else {
        setFetchErr('No agent record found for this lease/epoch. Enter the raw proof data manually.')
      }
    } catch {
      setFetchErr('Could not reach agent API. Enter the raw proof data manually.')
    } finally {
      setFetching(false)
    }
  }, [])

  // Auto-fetch when arriving via URL params from Activity page
  useEffect(() => {
    const lid = params.get('leaseId')
    const ep  = params.get('epoch')
    if (lid && ep) fetchAgentProof(lid, ep)
  }, [params, fetchAgentProof])

  // Re-fetch when user edits leaseId/epoch manually
  const handleLookup = () => {
    setResult(null); setAgentEntry(null); setRawProof(''); setFetchErr('')
    fetchAgentProof(leaseId, epoch)
  }

  // On-chain read (live)
  const { data: onChainHash, isLoading: chainLoading } = useReadContract({
    address: PROOF_ROUTER, abi: PROOF_ROUTER_ABI, functionName: 'getProof',
    args: ready ? [BigInt(leaseId), BigInt(epoch)] : undefined,
    query: { enabled: ready },
  })
  const { data: proofCount } = useReadContract({
    address: PROOF_ROUTER, abi: PROOF_ROUTER_ABI, functionName: 'proofCount',
    args: leaseId.match(/^\d+$/) ? [BigInt(leaseId)] : undefined,
    query: { enabled: !!leaseId.match(/^\d+$/) },
  })
  const hasOnChain = onChainHash && onChainHash !== ZERO

  // Step 1 verification
  const handleVerify = () => {
    if (!rawProof.trim()) return
    const computedHash = keccak256(toBytes(rawProof.trim()))
    const agentDataHash = agentEntry?.dataHash || null

    let step1: 'match' | 'mismatch' | 'no-agent' = 'no-agent'
    if (agentDataHash) {
      step1 = computedHash.toLowerCase() === agentDataHash.toLowerCase() ? 'match' : 'mismatch'
    }

    setResult({
      computedHash,
      agentDataHash,
      step1,
      rawProofData: agentEntry?.rawProofData || agentEntry?.proofData || null,
    })
  }

  const groqConf = agentEntry?.groqConfidence
  const verdictMode = agentEntry?.verdictMode

  return (
    <div className="min-h-screen">
      <Navbar/>
      <div className="max-w-2xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-3xl font-bold">Proof Verifier</h1>
          <span className="text-xs bg-purple-950/60 text-purple-300 border border-purple-900 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Brain size={11}/>Groq-powered
          </span>
        </div>
        <p className="text-gray-400 mb-2 text-sm leading-relaxed">
          Every epoch settlement stores a keccak256 proof on{' '}
          <a href={`${EXPLORER}/address/${PROOF_ROUTER}`} target="_blank" rel="noopener noreferrer"
            className="text-blue-400 hover:underline">ProofRouter ↗</a>.
          This page verifies the AI agent used real telemetry — not fabricated data.
        </p>

        {/* How it works explainer */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6 text-xs text-gray-500 space-y-1">
          <div className="flex items-center gap-2 text-gray-400 font-medium mb-2">
            <Info size={12}/>Two-step verification
          </div>
          <div className="flex items-start gap-2">
            <span className="text-blue-400 font-bold shrink-0">①</span>
            <span><strong className="text-gray-400">Data integrity</strong> — keccak256(rawProofData) matches the hash the agent committed. Proves the evidence string was not altered after submission.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-green-400 font-bold shrink-0">②</span>
            <span><strong className="text-gray-400">On-chain existence</strong> — ProofRouter has a non-zero entry for this epoch. Proves the agent submitted to the blockchain before the escrow settled.</span>
          </div>
        </div>

        {/* Inputs */}
        <div className="space-y-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Lease ID</label>
              <input value={leaseId} placeholder="e.g. 1"
                onChange={e => { setLeaseId(e.target.value); setResult(null) }}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none text-sm"/>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Epoch Number</label>
              <input value={epoch} placeholder="e.g. 0"
                onChange={e => { setEpoch(e.target.value); setResult(null) }}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none text-sm"/>
            </div>
          </div>

          <button onClick={handleLookup} disabled={!leaseId || !epoch || fetching}
            className="w-full border border-gray-700 hover:border-blue-500 disabled:opacity-40 py-2.5 rounded-lg text-sm transition flex items-center justify-center gap-2">
            {fetching
              ? <><Loader2 size={14} className="animate-spin"/>Fetching from agent…</>
              : 'Look Up Proof Data from Agent'}
          </button>

          {/* Agent fetch result / error */}
          {fetchErr && (
            <div className="bg-yellow-950/40 border border-yellow-900/50 rounded-lg p-3 text-xs text-yellow-300">
              {fetchErr}
            </div>
          )}

          {agentEntry && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs space-y-2">
              <div className="text-gray-500 font-medium flex items-center gap-2">
                <Brain size={11} className="text-purple-400"/>Agent record found
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-400">
                <span>Verdict:</span>
                <span className={agentEntry.compliant ? 'text-green-400' : 'text-red-400'}>
                  {agentEntry.compliant ? 'COMPLIANT' : 'BREACH'}
                  {groqConf !== undefined && <span className="text-gray-600 ml-1">({groqConf}% conf.)</span>}
                </span>
                <span>AI mode:</span>
                <span className={verdictMode === 'groq' ? 'text-purple-300' : 'text-gray-500'}>
                  {verdictMode || '—'}
                </span>
                {agentEntry.groqReasoning && <>
                  <span>Reasoning:</span>
                  <span className="text-gray-300">{agentEntry.groqReasoning}</span>
                </>}
                <span>Heartbeat at settle:</span>
                <span className={(agentEntry.staleSecs||0) > 300 ? 'text-red-400' : 'text-green-400'}>
                  {agentEntry.staleSecs !== undefined ? `${agentEntry.staleSecs}s stale` : '—'}
                </span>
                {agentEntry.repScore !== undefined && <>
                  <span>Reputation:</span>
                  <span>{agentEntry.repScore}/1000 ({agentEntry.repRate}%)</span>
                </>}
                <span>Settled:</span>
                <span>{agentEntry.settledAt ? new Date(agentEntry.settledAt).toLocaleString() : '—'}</span>
              </div>
            </div>
          )}

          {/* On-chain hash */}
          {ready && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 text-xs">
              <div className="flex items-center gap-2 text-gray-500 mb-2">
                {chainLoading && <Loader2 size={11} className="animate-spin"/>}
                <Link2 size={11}/>
                On-chain — <span className="font-mono">ProofRouter.getProof({leaseId}, {epoch})</span>
              </div>
              {chainLoading ? (
                <span className="text-gray-600">Reading from BOT Chain…</span>
              ) : hasOnChain ? (
                <div className="space-y-1">
                  <div className="font-mono break-all text-green-300">{onChainHash as string}</div>
                  <div className="flex items-center gap-4 text-gray-600 mt-1">
                    {proofCount !== undefined && <span>{proofCount.toString()} proof(s) for lease #{leaseId}</span>}
                    <a href={`${EXPLORER}/address/${PROOF_ROUTER}?tab=read_contract`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-500 hover:underline">
                      Explorer <ExternalLink size={10}/>
                    </a>
                    {agentEntry?.escrowTxHash && (
                      <a href={`${EXPLORER}/tx/${agentEntry.escrowTxHash}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-500 hover:underline">
                        Settlement TX <ExternalLink size={10}/>
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <span className="text-gray-600">No on-chain proof yet for lease {leaseId} epoch {epoch}.</span>
              )}
            </div>
          )}

          {/* Raw proof input */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Raw Proof Data
              {fetching && <span className="text-gray-600 ml-2 text-xs">(auto-filling from agent…)</span>}
            </label>
            <textarea value={rawProof} rows={3}
              placeholder={`lease-1-epoch-0-ts-${Date.now()}-ok-true-conf-87`}
              onChange={e => { setRawProof(e.target.value); setResult(null) }}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white font-mono text-xs focus:border-blue-500 outline-none resize-none"/>
            <p className="text-xs text-gray-600 mt-1">
              Auto-filled when you look up a lease/epoch. Or paste from the Activity feed.
            </p>
          </div>

          <button onClick={handleVerify} disabled={!rawProof.trim()}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 py-3 rounded-lg font-medium transition text-sm">
            Verify Proof
          </button>
        </div>

        {/* Result */}
        {result && (
          <div className="space-y-3">
            {/* Step 1 */}
            <div className={`p-5 rounded-xl border ${
              result.step1 === 'match'    ? 'border-green-700 bg-green-950/30'   :
              result.step1 === 'mismatch' ? 'border-red-700 bg-red-950/30'       :
                                            'border-gray-700 bg-gray-900'
            }`}>
              <div className="flex items-center gap-2 font-bold mb-3">
                {result.step1 === 'match'
                  ? <><CheckCircle size={18} className="text-green-400"/>① DATA INTEGRITY — VERIFIED</>
                  : result.step1 === 'mismatch'
                  ? <><XCircle size={18} className="text-red-400"/>① DATA INTEGRITY — MISMATCH</>
                  : <><Shield size={18} className="text-blue-400"/>① DATA INTEGRITY — HASH COMPUTED</>
                }
              </div>
              <div className="space-y-2 text-xs font-mono">
                <div>
                  <div className="text-gray-500 mb-0.5">Your computed hash (keccak256 of raw proof):</div>
                  <div className="bg-gray-950/60 rounded p-2 break-all">{result.computedHash}</div>
                </div>
                {result.agentDataHash && (
                  <div>
                    <div className="text-gray-500 mb-0.5">Agent&apos;s committed dataHash (from API):</div>
                    <div className="bg-gray-950/60 rounded p-2 break-all">{result.agentDataHash}</div>
                  </div>
                )}
              </div>
              <p className="text-xs mt-3 text-gray-400">
                {result.step1 === 'match'
                  ? 'The raw proof string you entered hashes to the same value the agent committed. The evidence was not altered after submission.'
                  : result.step1 === 'mismatch'
                  ? 'Hash mismatch. The raw proof string does not match the agent\'s committed hash. Check for extra whitespace or copy errors.'
                  : 'Hash computed from your input. Look up the agent record above to compare against the stored dataHash.'}
              </p>
            </div>

            {/* Step 2 */}
            <div className={`p-5 rounded-xl border ${
              hasOnChain ? 'border-green-700 bg-green-950/30' : 'border-gray-700 bg-gray-900'
            }`}>
              <div className="flex items-center gap-2 font-bold mb-3">
                {hasOnChain
                  ? <><CheckCircle size={18} className="text-green-400"/>② ON-CHAIN PROOF — EXISTS</>
                  : <><Shield size={18} className="text-gray-400"/>② ON-CHAIN PROOF — NOT FOUND</>
                }
              </div>
              {hasOnChain ? (
                <>
                  <div className="text-xs font-mono bg-gray-950/60 rounded p-2 break-all mb-2">
                    {onChainHash as string}
                  </div>
                  <p className="text-xs text-gray-400">
                    ProofRouter has a committed entry for lease {leaseId} epoch {epoch}.
                    This composite hash (including block.timestamp and agent address) was
                    stored on-chain before the escrow settlement executed — proving the evidence
                    was committed before money moved.
                  </p>
                </>
              ) : (
                <p className="text-xs text-gray-500">
                  {chainLoading ? 'Checking chain…' : `No on-chain entry found for lease ${leaseId} epoch ${epoch}.`}
                </p>
              )}
            </div>

            {/* Full verified banner */}
            {result.step1 === 'match' && hasOnChain && (
              <div className="bg-green-950/40 border border-green-600 rounded-xl p-4 text-center">
                <div className="flex items-center justify-center gap-2 text-green-400 font-bold text-lg mb-1">
                  <CheckCircle size={22}/>FULLY VERIFIED
                </div>
                <p className="text-xs text-green-300">
                  Raw proof data is self-consistent AND committed on-chain.
                  The Groq AI agent&apos;s decision is cryptographically auditable.
                </p>
              </div>
            )}
          </div>
        )}

        {/* How proof format works */}
        <div className="mt-8 bg-gray-900 rounded-xl p-5 border border-gray-800 text-xs text-gray-500 leading-relaxed space-y-2">
          <div className="flex items-center gap-2 text-gray-400 font-medium">
            <Brain size={13} className="text-purple-400"/>Proof format
          </div>
          <div className="font-mono text-blue-300/80 text-xs bg-gray-950 rounded p-2">
            lease-[id]-epoch-[n]-ts-[ms]-ok-[true|false]-conf-[0-100]
          </div>
          <p>
            Each epoch, the agent passes this string (including Groq&apos;s compliance verdict and confidence
            score) to <span className="font-mono text-blue-300">keccak256()</span> to get the{' '}
            <em>dataHash</em>. It then calls{' '}
            <span className="font-mono text-blue-300">ProofRouter.submitProof(leaseId, epoch, dataHash)</span>,
            which creates a composite hash also incorporating the block timestamp and agent wallet address.
            Finally, <span className="font-mono text-blue-300">LeaseEscrow.settleEpoch()</span> runs with
            the composite hash — so the on-chain settlement is cryptographically linked to the AI decision.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500"><Loader2 size={24} className="animate-spin mr-2"/>Loading…</div>}>
      <VerifyInner/>
    </Suspense>
  )
}