'use client'
import Link from 'next/link'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Shield, Cpu, Zap, CheckCircle, ExternalLink } from 'lucide-react'

const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER || 'https://scan.bohr.life'

const CONTRACTS = [
  { name: 'AssetRegistry', addr: process.env.NEXT_PUBLIC_ASSET_REGISTRY || '' },
  { name: 'LeaseEscrow',   addr: process.env.NEXT_PUBLIC_LEASE_ESCROW   || '' },
  { name: 'ProofRouter',   addr: process.env.NEXT_PUBLIC_PROOF_ROUTER   || '' },
  { name: 'Reputation',    addr: process.env.NEXT_PUBLIC_REPUTATION     || '' },
]

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-gray-800 px-6 py-4 flex justify-between items-center sticky top-0 bg-gray-950/90 backdrop-blur z-40">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold text-blue-400">ProofLease</span>
          <span className="text-xs bg-green-900/60 text-green-300 border border-green-800 px-2 py-0.5 rounded-full font-mono">
            LIVE · BOT Chain
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
      <div className="max-w-5xl mx-auto px-6 py-24 text-center">
        <div className="inline-block bg-blue-950/60 border border-blue-900 text-blue-300 text-sm px-3 py-1 rounded-full mb-6">
          Built for BOT Chain · vCompute + DePIN
        </div>
        <h1 className="text-5xl font-bold mb-6 leading-tight tracking-tight">
          Rent Verified Compute.<br />
          <span className="text-blue-400">Every Epoch, On-Chain Proof.</span>
        </h1>
        <p className="text-gray-400 text-lg mb-10 max-w-2xl mx-auto leading-relaxed">
          GPU and CPU operators register machines as RWA assets. Buyers escrow BOT tokens.
          An AI agent monitors heartbeat proofs each epoch and settles automatically — no trust required.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link href="/marketplace" className="bg-blue-600 hover:bg-blue-700 px-8 py-3 rounded-lg font-medium transition">
            Find Compute →
          </Link>
          <Link href="/provider" className="border border-gray-600 hover:border-gray-400 px-8 py-3 rounded-lg font-medium transition">
            List Your Machine
          </Link>
          <Link href="/activity" className="border border-gray-700 hover:border-gray-500 px-8 py-3 rounded-lg font-medium text-gray-400 transition">
            Watch Agent Live
          </Link>
        </div>
      </div>

      {/* How it works */}
      <div className="max-w-5xl mx-auto px-6 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {[
            {
              icon: <Cpu size={22} className="text-blue-400" />,
              title: 'Register Your Machine',
              body: 'Providers register GPU/CPU hardware as on-chain RWA assets via AssetRegistry with a hardware attestation URI and a 0.001 BOT bond.',
            },
            {
              icon: <Shield size={22} className="text-blue-400" />,
              title: 'AI Prices & Monitors',
              body: 'A Groq-powered AI agent scores provider risk using heartbeat staleness and on-chain reputation, then settles each epoch automatically.',
            },
            {
              icon: <Zap size={22} className="text-blue-400" />,
              title: 'Automatic Settlement',
              body: 'Compliant epoch → BOT released to provider. Missed heartbeat → buyer refunded. Every decision stored as a proof hash in ProofRouter.',
            },
          ].map((f) => (
            <div key={f.title} className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <div className="mb-3">{f.icon}</div>
              <h3 className="font-semibold mb-2">{f.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>

        {/* Contract table */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle size={16} className="text-green-400" />
            <h3 className="font-semibold">Deployed Contracts — BOT Chain Testnet</h3>
          </div>
          <div className="space-y-2 font-mono text-sm">
            {CONTRACTS.map(({ name, addr }) => (
              <div key={name} className="flex justify-between items-center py-1 border-b border-gray-800 last:border-0">
                <span className="text-gray-500">{name}</span>
                {addr ? (
                  <a href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noopener noreferrer"
                    className="text-blue-400 hover:underline flex items-center gap-1 text-xs">
                    {addr.slice(0, 10)}…{addr.slice(-6)}
                    <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="text-gray-700 text-xs">not set</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-600 mt-4">
            The AI agent never moves funds unilaterally. Every settlement is the deterministic outcome
            of a proof hash matched against on-chain SLA rules.
          </p>
        </div>

        {/* CTA cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link href="/activity" className="bg-gray-900 border border-gray-800 hover:border-blue-700 rounded-xl p-5 transition group">
            <div className="text-blue-400 text-sm font-medium mb-1 group-hover:underline">Watch Agent Activity →</div>
            <p className="text-gray-500 text-xs">Live feed of every AI-verified epoch settlement — with full Groq reasoning, risk scores, and proof hashes.</p>
          </Link>
          <Link href="/verify" className="bg-gray-900 border border-gray-800 hover:border-blue-700 rounded-xl p-5 transition group">
            <div className="text-blue-400 text-sm font-medium mb-1 group-hover:underline">Independently Verify Proofs →</div>
            <p className="text-gray-500 text-xs">Recompute any keccak256 proof hash from raw data and confirm it matches the on-chain record in ProofRouter.</p>
          </Link>
        </div>
      </div>
    </div>
  )
}
