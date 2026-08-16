'use client'
import { useState } from 'react'
import { useReadContract, useWriteContract, useAccount, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { parseEther, keccak256, toBytes, formatEther } from 'viem'
import {
  Server, CheckCircle, ExternalLink, ArrowLeft, Loader2,
  Plus, AlertCircle, Clock, Wallet, Terminal, ChevronDown, ChevronUp, Copy,
} from 'lucide-react'
import Link from 'next/link'

const REGISTRY = process.env.NEXT_PUBLIC_ASSET_REGISTRY as `0x${string}`
const ESCROW   = process.env.NEXT_PUBLIC_LEASE_ESCROW   as `0x${string}`
const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER || 'https://scan.bohr.life'

const REGISTRY_ABI = [
  { name: 'registerMachine', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'hardwareClass',  type: 'string'  },
      { name: 'region',         type: 'string'  },
      { name: 'attestationURI', type: 'string'  },
      { name: 'hardwareHash',   type: 'bytes32' },
    ], outputs: [{ type: 'uint256' }] },
  { name: 'getProviderMachines', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'provider', type: 'address' }], outputs: [{ type: 'uint256[]' }] },
  { name: 'getMachine', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'machineId', type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'provider',       type: 'address' },
      { name: 'hardwareHash',   type: 'bytes32' },
      { name: 'region',         type: 'string'  },
      { name: 'hardwareClass',  type: 'string'  },
      { name: 'attestationURI', type: 'string'  },
      { name: 'registeredAt',   type: 'uint256' },
      { name: 'lastHeartbeat',  type: 'uint256' },
      { name: 'status',         type: 'uint8'   },
    ]}] },
] as const

const ESCROW_ABI = [
  { name: 'pendingWithdrawals', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable',
    inputs: [], outputs: [] },
] as const

const HARDWARE_CLASSES = ['GPU-H100','GPU-A100','GPU-RTX4090','GPU-RTX3090','CPU-64C','CPU-32C','CPU-16C']
const REGIONS          = ['us-east','us-west','eu-central','eu-west','asia-pacific','asia-south','latam']
const STATUS_LABEL     = ['Unregistered','Active','Suspended']
const STATUS_COLOR     = ['text-gray-400','text-green-400','text-yellow-400']

function MachineRow({ machineId }: { machineId: bigint }) {
  const { data: m } = useReadContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'getMachine', args: [machineId],
  })
  if (!m) return <div className="py-3 border-b border-gray-800 animate-pulse"><div className="h-3 bg-gray-800 rounded w-1/2"/></div>
  const staleMins = Math.round((Math.floor(Date.now() / 1000) - Number(m.lastHeartbeat)) / 60)
  const isStale = staleMins > 5

  return (
    <div className="py-4 border-b border-gray-800 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <div className="bg-gray-800 rounded-lg p-2"><Server size={15} className="text-blue-400"/></div>
          <div>
            <div className="text-sm font-medium">
              {m.hardwareClass} <span className="text-gray-500 font-normal">· {m.region}</span>
            </div>
            <div className="text-xs text-gray-600 font-mono">Machine #{machineId.toString()}</div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className={STATUS_COLOR[m.status] ?? 'text-gray-400'}>{STATUS_LABEL[m.status] ?? 'Unknown'}</span>
          <span className={isStale ? 'text-red-400 font-medium' : 'text-green-400'}>
            <Clock size={11} className="inline mr-1"/>
            {isStale ? `⚠ Heartbeat ${staleMins}m stale — send heartbeat now` : `Heartbeat: ${staleMins}m ago`}
          </span>
          <a href={`${EXPLORER}/address/${REGISTRY}`} target="_blank" rel="noopener noreferrer"
            className="text-gray-600 hover:text-gray-300"><ExternalLink size={13}/></a>
        </div>
      </div>
      {m.attestationURI ? (
        <div className="ml-11 text-xs text-gray-500">
          Attestation: <a href={m.attestationURI} target="_blank" rel="noopener noreferrer"
            className="text-blue-400 hover:underline">{m.attestationURI}</a>
        </div>
      ) : (
        <div className="ml-11 text-xs text-red-400">
          ⚠ No attestation URI — buyers cannot verify your hardware or contact you
        </div>
      )}
    </div>
  )
}

function WithdrawPanel({ address }: { address: `0x${string}` }) {
  const { data: pending, refetch } = useReadContract({
    address: ESCROW, abi: ESCROW_ABI, functionName: 'pendingWithdrawals', args: [address],
  })
  const { writeContract, data: hash, isPending, error } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })
  if (isSuccess) refetch()
  const amount = pending ?? 0n

  return (
    <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Wallet size={18} className="text-green-400"/>
        <h2 className="text-lg font-semibold">Earnings & Refunds</h2>
      </div>
      <div className="bg-gray-950 rounded-lg p-4 flex items-center justify-between mb-3">
        <div>
          <div className="text-xs text-gray-500 mb-1">Available to withdraw</div>
          <div className={`text-2xl font-bold font-mono ${amount > 0n ? 'text-green-400' : 'text-gray-600'}`}>
            {parseFloat(formatEther(amount)).toFixed(6)} BOT
          </div>
          <div className="text-xs text-gray-600 mt-1">
            Compliant epoch payments + breach refunds accumulate here
          </div>
        </div>
        <button
          onClick={() => writeContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'withdraw' })}
          disabled={amount === 0n || isPending || isConfirming}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2.5 rounded-lg font-medium text-sm transition flex items-center gap-2"
        >
          {(isPending || isConfirming) && <Loader2 size={14} className="animate-spin"/>}
          {isPending ? 'Confirm…' : isConfirming ? 'Withdrawing…' : 'Withdraw All'}
        </button>
      </div>
      {error && (
        <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-xs">
          {error.message.split('\n')[0]}
        </div>
      )}
      {isSuccess && hash && (
        <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:underline flex items-center gap-1">
          <ExternalLink size={11}/>View withdrawal TX
        </a>
      )}
    </div>
  )
}

function HeartbeatGuide({ address }: { address: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const script = `// heartbeat.js — run this on your machine as a background process
// Install: npm install ethers dotenv
// Run: node heartbeat.js
require('dotenv').config()
const { ethers } = require('ethers')

const RPC      = 'https://rpc.botchain.ai'
const REGISTRY = '${process.env.NEXT_PUBLIC_ASSET_REGISTRY || '0xE147555124044D5EbDc7B702fAc8EE8d6FCfCe6f'}'
const MACHINE_ID = process.env.MACHINE_ID || '1'  // your machine ID from registration

const provider = new ethers.JsonRpcProvider(RPC)
const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider)
const registry = new ethers.Contract(REGISTRY, [
  'function touchHeartbeat(uint256 machineId) external'
], wallet)

async function beat() {
  try {
    const tx = await registry.touchHeartbeat(MACHINE_ID)
    await tx.wait()
    console.log('[' + new Date().toISOString() + '] Heartbeat sent ✓')
  } catch (e) {
    console.error('Heartbeat failed:', e.message)
  }
}

beat() // send immediately on start
setInterval(beat, 30_000) // then every 30 seconds`

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-800/40 transition rounded-xl"
      >
        <div className="flex items-center gap-3">
          <Terminal size={18} className="text-blue-400"/>
          <div className="text-left">
            <div className="font-semibold">Heartbeat Setup — Required for earnings</div>
            <div className="text-xs text-gray-500 mt-0.5">
              You must run this on your machine or you get marked as breach every epoch
            </div>
          </div>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400"/> : <ChevronDown size={16} className="text-gray-400"/>}
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-gray-800 pt-4 space-y-4">
          <div className="space-y-2 text-sm text-gray-300">
            <p>
              The AI agent checks your machine&apos;s heartbeat every epoch (every N seconds, based on the lease duration).
              If your heartbeat is more than 300 seconds stale when the agent checks, that epoch is marked as a{' '}
              <span className="text-red-400 font-medium">BREACH</span> and the buyer gets refunded.
              If the heartbeat is fresh, you get paid.
            </p>
            <p className="text-gray-400">
              Run the script below on the same server you&apos;re leasing. It sends a heartbeat transaction
              to the blockchain every 30 seconds using your provider wallet.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 font-mono">heartbeat.js</span>
              <button
                onClick={() => { navigator.clipboard.writeText(script); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition"
              >
                <Copy size={12}/>{copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="bg-gray-950 rounded-lg p-4 text-xs text-gray-300 overflow-x-auto leading-relaxed font-mono whitespace-pre">
              {script}
            </pre>
          </div>

          <div className="bg-gray-950 rounded-lg p-4 space-y-2 text-xs">
            <div className="font-medium text-gray-300">Setup steps:</div>
            <ol className="space-y-1 text-gray-400 list-decimal list-inside">
              <li>Copy the script to your server</li>
              <li>Create a <span className="font-mono text-gray-300">.env</span> file with{' '}
                <span className="font-mono text-gray-300">PRIVATE_KEY=0x... MACHINE_ID=1</span></li>
              <li>Run <span className="font-mono text-gray-300">npm install ethers dotenv</span></li>
              <li>Run <span className="font-mono text-gray-300">node heartbeat.js</span> in the background
                (use <span className="font-mono text-gray-300">pm2</span> or <span className="font-mono text-gray-300">nohup</span> to keep it running)</li>
            </ol>
          </div>

          <div className="bg-yellow-950/40 border border-yellow-900/50 rounded-lg p-3 text-xs text-yellow-300">
            <strong>Important:</strong> Use the same wallet you registered with. The heartbeat is tied to your
            provider address on-chain. Keep your PRIVATE_KEY safe — never commit it to GitHub.
          </div>
        </div>
      )}
    </div>
  )
}

function AttestationGuide() {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-gray-900 rounded-xl border border-orange-900/40 mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-800/40 transition rounded-xl"
      >
        <div className="flex items-center gap-3">
          <AlertCircle size={18} className="text-orange-400"/>
          <div className="text-left">
            <div className="font-semibold">Attestation URI — How buyers contact you</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Without this, buyers have no way to get SSH access or verify your hardware
            </div>
          </div>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400"/> : <ChevronDown size={16} className="text-gray-400"/>}
      </button>

      {open && (
        <div className="px-6 pb-6 border-t border-orange-900/30 pt-4 space-y-4 text-sm text-gray-300">
          <p>
            When a buyer leases your machine, the only way they can reach you or access the machine
            is through your Attestation URI. This is a URL you publish that contains:
          </p>
          <ul className="space-y-1 text-gray-400 list-disc list-inside">
            <li>Hardware specs and proof (GPU model, RAM, storage)</li>
            <li>How buyers can request SSH access or an API endpoint</li>
            <li>Your contact method (email, Telegram, Discord)</li>
            <li>Your uptime SLA commitment</li>
          </ul>
          <div className="bg-gray-950 rounded-lg p-4 text-xs space-y-2">
            <div className="text-gray-400 font-medium">Easiest option — GitHub Gist:</div>
            <ol className="text-gray-400 list-decimal list-inside space-y-1">
              <li>Go to <a href="https://gist.github.com" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">gist.github.com</a></li>
              <li>Create a public gist with your machine specs and contact info</li>
              <li>Copy the raw URL (click Raw → copy URL)</li>
              <li>Use that URL as your Attestation URI when registering</li>
            </ol>
          </div>
          <p className="text-gray-500 text-xs">
            Machines without an Attestation URI get -15 points on their risk score and show a warning to buyers.
            Buyers are advised not to lease machines with no attestation.
          </p>
        </div>
      )}
    </div>
  )
}

export default function ProviderPage() {
  const { address, isConnected } = useAccount()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    hardwareClass: 'GPU-RTX4090', region: 'us-east', attestationURI: '', deviceId: '',
  })

  const { data: myMachineIds } = useReadContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'getProviderMachines',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const handleRegister = () => {
    if (!form.deviceId.trim()) { alert('Enter a Device ID.'); return }
    if (!form.attestationURI.trim()) { alert('Attestation URI is required. See the guide above.'); return }
    try { new URL(form.attestationURI.trim()) } catch { alert('Attestation URI must be a valid URL (starting with https://).'); return }
    const hardwareHash = keccak256(toBytes(form.deviceId.trim() + form.hardwareClass))
    writeContract({
      address: REGISTRY, abi: REGISTRY_ABI, functionName: 'registerMachine',
      args: [form.hardwareClass, form.region, form.attestationURI.trim(), hardwareHash],
      value: parseEther('0.001'),
    })
  }

  return (
    <div className="min-h-screen">
      <nav className="border-b border-gray-800 px-6 py-4 flex justify-between items-center sticky top-0 bg-gray-950/90 backdrop-blur z-40">
        <Link href="/" className="flex items-center gap-2 text-gray-400 hover:text-white transition">
          <ArrowLeft size={16}/><span className="text-blue-400 font-bold">ProofLease</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/marketplace" className="text-sm text-gray-400 hover:text-white transition">Marketplace</Link>
          <Link href="/activity"    className="text-sm text-gray-400 hover:text-white transition">Activity</Link>
          <ConnectButton/>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Provider Dashboard</h1>
        <p className="text-gray-400 mb-8 text-sm leading-relaxed">
          Register your compute machine as a verifiable asset on BOT Chain. The AI agent monitors
          heartbeats and releases payments automatically each epoch.
        </p>

        {!isConnected ? (
          <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
            <Server size={44} className="mx-auto mb-4 text-gray-700"/>
            <p className="text-gray-400 mb-6 text-sm">Connect your wallet to manage your machines</p>
            <ConnectButton/>
          </div>
        ) : (
          <>
            <WithdrawPanel address={address!}/>
            <HeartbeatGuide address={address!}/>
            <AttestationGuide/>

            {/* My machines */}
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">My Machines</h2>
                <button onClick={() => setShowForm(!showForm)}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-medium transition">
                  <Plus size={14}/>Register Machine
                </button>
              </div>
              {!myMachineIds || myMachineIds.length === 0
                ? <p className="text-gray-500 text-sm py-4">No machines registered yet.</p>
                : myMachineIds.map(id => <MachineRow key={id.toString()} machineId={id}/>)
              }
            </div>

            {/* Registration form */}
            {showForm && (
              <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
                <h2 className="text-lg font-semibold mb-4">Register New Machine</h2>
                {isSuccess ? (
                  <div className="text-center py-8">
                    <CheckCircle size={44} className="text-green-400 mx-auto mb-4"/>
                    <p className="text-green-400 font-semibold mb-2">Machine Registered!</p>
                    <p className="text-gray-500 text-sm mb-4">
                      Now set up the heartbeat script (see above) — without it every epoch will be a breach.
                    </p>
                    {hash && (
                      <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
                        className="text-blue-400 hover:underline text-sm">View TX ↗</a>
                    )}
                    <div className="mt-4 flex gap-3 justify-center">
                      <button
                        onClick={() => { reset(); setForm({ hardwareClass:'GPU-RTX4090', region:'us-east', attestationURI:'', deviceId:'' }) }}
                        className="text-sm border border-gray-600 hover:border-gray-400 px-4 py-2 rounded-lg transition">
                        Register Another
                      </button>
                      <button onClick={() => setShowForm(false)} className="text-sm text-gray-500 hover:text-white">Close</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">Hardware Class</label>
                        <select value={form.hardwareClass}
                          onChange={e => setForm(s => ({ ...s, hardwareClass: e.target.value }))}
                          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none text-sm">
                          {HARDWARE_CLASSES.map(c => <option key={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm text-gray-400 mb-1">Region</label>
                        <select value={form.region}
                          onChange={e => setForm(s => ({ ...s, region: e.target.value }))}
                          className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none text-sm">
                          {REGIONS.map(r => <option key={r}>{r}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        Device ID <span className="text-gray-600 text-xs">(generates hardware fingerprint — keep private)</span>
                      </label>
                      <input value={form.deviceId} placeholder="e.g. server-001-rtx4090"
                        onChange={e => setForm(s => ({ ...s, deviceId: e.target.value }))}
                        className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none text-sm"/>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        Attestation URI <span className="text-orange-400 text-xs">— strongly recommended</span>
                      </label>
                      <input value={form.attestationURI}
                        placeholder="https://gist.github.com/you/abc123/raw — hardware specs + contact info"
                        onChange={e => setForm(s => ({ ...s, attestationURI: e.target.value }))}
                        className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none text-sm"/>
                      <p className="text-xs text-gray-500 mt-1">
                        Buyers use this to verify your hardware and request SSH/API access.
                        Without it, your machine shows as high risk and buyers can&apos;t contact you.
                        See the guide above.
                      </p>
                    </div>
                    <div className="bg-gray-950 rounded-lg p-4 text-sm flex justify-between">
                      <span className="text-gray-400">Registration bond (refundable on delist)</span>
                      <span className="font-mono">0.001 BOT</span>
                    </div>
                    {error && (
                      <div className="bg-red-950 border border-red-800 rounded-lg p-3 text-red-300 text-xs flex gap-2">
                        <AlertCircle size={14} className="shrink-0 mt-0.5"/>{error.message.split('\n')[0]}
                      </div>
                    )}
                    <button onClick={handleRegister} disabled={isPending || isConfirming}
                      className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-3 rounded-lg font-medium transition flex items-center justify-center gap-2 text-sm">
                      {(isPending || isConfirming) && <Loader2 size={15} className="animate-spin"/>}
                      {isPending ? 'Confirm in wallet…' : isConfirming ? 'Registering…' : 'Register Machine (0.001 BOT bond)'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}