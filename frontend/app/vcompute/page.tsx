'use client'
import Link from 'next/link'
import {
  Brain, Cpu, Shield, Zap, GitMerge, Lock,
  Server, Activity, CheckCircle, ArrowRight, ExternalLink,
} from 'lucide-react'
import { Navbar } from '@/components/Navbar'

// ─── Static data ────────────────────────────────────────────────────────────

const INTEGRATION_PHASES = [
  {
    phase: '01',
    status: 'live',
    statusLabel: 'Live now',
    statusColor: 'text-green-400 bg-green-900/30 border-green-800',
    title: 'Heartbeat-Based SLA Settlement',
    description:
      'ProofLease already runs on BOT Chain Mainnet. Hardware operators register machines as on-chain RWA assets, buyers escrow BOT, and the AI agent settles each epoch by reading heartbeat proofs from AssetRegistry. This is the foundation layer that vCompute will extend.',
    details: [
      'AssetRegistry, LeaseEscrow, ProofRouter, Reputation — all deployed on-chain',
      'AI oracle reads liveness proofs every 30s and settles escrow autonomously',
      'Every decision stored as a keccak256 proof hash, independently verifiable',
      'Proven lifecycle: register → escrow → settle → withdraw running on mainnet',
    ],
    icon: <Activity size={20} className="text-green-400" />,
  },
  {
    phase: '02',
    status: 'planned',
    statusLabel: 'Planned — vCompute launch',
    statusColor: 'text-purple-400 bg-purple-900/30 border-purple-800',
    title: 'Cryptographic Proof of Compute Delivery',
    description:
      'The current heartbeat mechanism confirms machine liveness but not actual workload delivery. When vCompute ships its cryptographic proof-of-work layer, ProofLease\'s ProofRouter contract is purpose-built to receive those proofs. The AI oracle will factor verified compute receipts — not just heartbeats — into each settlement decision.',
    details: [
      'ProofRouter.submitProof() will accept vCompute-generated execution receipts',
      'AI oracle will validate cryptographic proof of work in settlement prompt',
      'Breach threshold tightens: heartbeat staleness AND missing compute receipt → refund',
      'Buyers gain SLA guarantees backed by real compute delivery, not just uptime',
    ],
    icon: <Shield size={20} className="text-purple-400" />,
  },
  {
    phase: '03',
    status: 'planned',
    statusLabel: 'Planned — hardware attestation',
    statusColor: 'text-blue-400 bg-blue-900/30 border-blue-800',
    title: 'Trusted Hardware Attestation (TEE / TPM)',
    description:
      'Hardware class and region are currently self-reported by providers. vCompute\'s trusted hardware attestation layer (TPM or TEE-based remote attestation) will flow into the AssetRegistry hardwareHash field, letting the AI oracle verify that the machine actually has the advertised GPU class — not just that a provider claimed it.',
    details: [
      'hardwareHash will be populated by vCompute attestation service, not self-reported',
      'AI risk scorer will weight verified hardware identity in its score calculation',
      'Providers with attested hardware earn lower risk scores → eligible for premium leases',
      'Reputation contract scores will reflect attestation compliance over time',
    ],
    icon: <Lock size={20} className="text-blue-400" />,
  },
  {
    phase: '04',
    status: 'planned',
    statusLabel: 'Planned — DePIN node activation',
    statusColor: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
    title: 'Full DePIN Marketplace for vCompute Nodes',
    description:
      'BOT Chain\'s Compute Node Activation onboards physical GPU and CPU hardware as DePIN nodes. ProofLease becomes the public-facing marketplace for that infrastructure: node operators list capacity, buyers lease it with BOT token, and the AI oracle enforces the SLA end-to-end. ProofLease is the monetisation layer for vCompute\'s supply side.',
    details: [
      'vCompute node operators register directly through ProofLease\'s provider flow',
      'Marketplace displays attested hardware specs fetched from vCompute registry',
      'BOT token is the settlement currency for all compute capacity in the ecosystem',
      'Reputation scores aggregate across the full DePIN node lifecycle',
    ],
    icon: <Server size={20} className="text-yellow-400" />,
  },
]

const INTEGRATION_POINTS = [
  {
    contract: 'AssetRegistry',
    role: 'Machine registration',
    vComputeHook: 'vCompute attestation service writes hardware proofs into hardwareHash on registration',
    color: 'border-blue-900/40',
  },
  {
    contract: 'ProofRouter',
    role: 'Proof storage',
    vComputeHook: 'Receives execution receipts from vCompute node layer alongside existing heartbeat proofs',
    color: 'border-purple-900/40',
  },
  {
    contract: 'LeaseEscrow',
    role: 'Payment settlement',
    vComputeHook: 'settleEpoch() reads from ProofRouter; vCompute proofs gate compliant vs. breach decision',
    color: 'border-green-900/40',
  },
  {
    contract: 'Reputation',
    role: 'Provider scoring',
    vComputeHook: 'Score reflects full DePIN compliance history — liveness + compute delivery + attestation',
    color: 'border-yellow-900/40',
  },
]

// ─── Component ───────────────────────────────────────────────────────────────

export default function VComputePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />

      {/* Hero */}
      <div className="max-w-5xl mx-auto px-6 pt-16 pb-10 text-center">
        <div className="inline-flex items-center gap-2 bg-purple-950/60 border border-purple-800 text-purple-300 text-sm px-3 py-1 rounded-full mb-6">
          <GitMerge size={13} />
          Integration Roadmap · BOT Chain vCompute Layer
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-5 leading-tight tracking-tight">
          ProofLease <span className="text-gray-600">×</span>{' '}
          <span className="text-purple-400">vCompute</span>
        </h1>
        <p className="text-gray-400 text-lg mb-4 max-w-2xl mx-auto leading-relaxed">
          ProofLease is being integrated as the SLA settlement and marketplace layer for
          BOT Chain&apos;s <strong className="text-white">vCompute</strong> — the Verifiable
          Computation Layer that onboards physical GPU and CPU hardware as DePIN nodes.
        </p>
        <p className="text-gray-600 text-sm max-w-xl mx-auto">
          Every contract, oracle, and reputation mechanic in ProofLease is designed to plug
          directly into vCompute&apos;s attestation and proof-of-work infrastructure when it ships.
        </p>
      </div>

      {/* What is vCompute */}
      <div className="max-w-5xl mx-auto px-6 pb-12">
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="bg-purple-950/60 rounded-lg p-2">
              <Cpu size={20} className="text-purple-400" />
            </div>
            <div>
              <h2 className="font-bold text-lg">What is vCompute?</h2>
              <p className="text-gray-500 text-xs mt-0.5">BOT Chain&apos;s Verifiable Computation Layer</p>
            </div>
          </div>
          <p className="text-gray-400 text-sm leading-relaxed mb-4">
            vCompute is a core pillar of BOT Chain&apos;s roadmap. It onboards physical GPU and CPU
            hardware as DePIN (Decentralised Physical Infrastructure) nodes, issues cryptographic
            proof-of-work receipts for compute tasks, and provides trusted hardware attestation
            so that buyers can verify a machine really has the hardware it claims.
          </p>
          <p className="text-gray-400 text-sm leading-relaxed">
            vCompute supplies the <em>verification</em> primitive. ProofLease supplies the
            <em> marketplace and settlement</em> primitive. Together they close the full loop:
            hardware operators earn BOT for verified compute delivery, and buyers get
            cryptographically-enforced SLA guarantees — not just trust-me uptime claims.
          </p>
        </div>

        {/* Why ProofLease + vCompute */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[
            {
              icon: <Brain size={18} className="text-purple-400" />,
              title: 'AI oracle, ready to extend',
              body: 'The settlement agent already calls an LLM to reason about compliance. Adding vCompute proof validation to the prompt is one targeted change — the architecture is already structured for it.',
            },
            {
              icon: <Shield size={18} className="text-blue-400" />,
              title: 'ProofRouter is the bridge',
              body: 'ProofRouter.submitProof() is designed to accept arbitrary proof data. It will receive vCompute execution receipts with no contract changes — just a new caller and a richer proof payload.',
            },
            {
              icon: <Zap size={18} className="text-green-400" />,
              title: '0.75s blocks make it viable',
              body: 'vCompute proof submission per epoch and AI settlement calls are economically viable on BOT Chain. On Ethereum mainnet the gas cost per epoch would exceed the payment itself.',
            },
          ].map(({ icon, title, body }) => (
            <div key={title} className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <div className="mb-3">{icon}</div>
              <div className="font-semibold text-sm mb-2">{title}</div>
              <p className="text-gray-500 text-xs leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        {/* Integration phases */}
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-5">
          Integration Phases
        </h2>
        <div className="space-y-4 mb-10">
          {INTEGRATION_PHASES.map(({ phase, statusLabel, statusColor, title, description, details, icon }) => (
            <div key={phase} className="bg-gray-900 rounded-2xl border border-gray-800 p-7">
              <div className="flex items-start gap-4">
                <div className="bg-gray-800 rounded-xl p-2.5 shrink-0 mt-0.5">{icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <span className="text-3xl font-bold text-gray-800/60 font-mono select-none">
                      {phase}
                    </span>
                    <h3 className="font-semibold text-base">{title}</h3>
                    <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${statusColor}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <p className="text-gray-400 text-sm leading-relaxed mb-4">{description}</p>
                  <ul className="space-y-1.5">
                    {details.map(d => (
                      <li key={d} className="flex items-start gap-2 text-xs text-gray-500">
                        <ArrowRight size={11} className="mt-0.5 shrink-0 text-gray-700" />
                        {d}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Technical integration map */}
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-5">
          Contract-Level Integration Points
        </h2>
        <div className="bg-gray-900 rounded-2xl border border-gray-800 divide-y divide-gray-800 mb-6 overflow-hidden">
          {INTEGRATION_POINTS.map(({ contract, role, vComputeHook, color }) => (
            <div key={contract} className={`p-5 border-l-2 ${color}`}>
              <div className="flex items-center gap-3 mb-1.5">
                <code className="text-blue-300 text-sm font-mono">{contract}</code>
                <span className="text-xs text-gray-600 bg-gray-800 px-2 py-0.5 rounded">{role}</span>
              </div>
              <p className="text-gray-500 text-xs leading-relaxed">
                <span className="text-purple-400 font-medium">vCompute hook: </span>
                {vComputeHook}
              </p>
            </div>
          ))}
        </div>

        {/* Current status callout */}
        <div className="bg-gray-900 rounded-xl border border-green-900/40 p-6 mb-6 flex items-start gap-4">
          <div className="bg-green-950/50 rounded-lg p-2 shrink-0 mt-0.5">
            <CheckCircle size={18} className="text-green-400" />
          </div>
          <div>
            <div className="font-semibold text-sm mb-1">
              Phase 1 is live today — the rest are planned for vCompute launch
            </div>
            <p className="text-gray-500 text-xs leading-relaxed">
              The full contract suite and AI agent are deployed on BOT Chain Mainnet and have
              settled real epochs with verified on-chain transactions. The architecture is
              deliberately vCompute-shaped: ProofRouter accepts arbitrary proof data, the AI
              oracle prompt is structured to reason about proof validity, and the Reputation
              contract aggregates compliance history across the full lease lifecycle.
              When vCompute ships its attestation and proof-of-work layer, ProofLease plugs in
              with minimal changes — not a rewrite.
            </p>
          </div>
        </div>

        {/* CTA links */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link
            href="/marketplace"
            className="bg-gray-900 border border-gray-800 hover:border-blue-600 rounded-xl p-5 transition group"
          >
            <div className="font-semibold text-sm group-hover:text-blue-400 transition mb-1">
              Browse the marketplace →
            </div>
            <p className="text-gray-600 text-xs">
              Lease GPU &amp; CPU capacity on BOT Chain today
            </p>
          </Link>

          <Link
            href="/activity"
            className="bg-gray-900 border border-gray-800 hover:border-purple-600 rounded-xl p-5 transition group"
          >
            <div className="font-semibold text-sm group-hover:text-purple-400 transition mb-1">
              Watch the AI agent live →
            </div>
            <p className="text-gray-600 text-xs">
              See real settlement decisions and AI rationale
            </p>
          </Link>

          <a
            href="https://scan.botchain.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded-xl p-5 transition group flex flex-col"
          >
            <div className="font-semibold text-sm group-hover:text-white transition mb-1 flex items-center gap-1.5">
              BOT Chain Explorer
              <ExternalLink size={11} />
            </div>
            <p className="text-gray-600 text-xs">
              Verify deployed contracts on BOT Chain Mainnet
            </p>
          </a>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-800 py-6 text-center text-xs text-gray-700">
        ProofLease · Built on BOT Chain · Integration layer for vCompute
      </div>
    </div>
  )
}
