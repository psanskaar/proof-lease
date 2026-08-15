'use client'
import { useState } from 'react'
import { useReadContract, useWriteContract, useAccount, useWaitForTransactionReceipt } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { parseEther, keccak256, toBytes } from 'viem'
import { Server, CheckCircle, ExternalLink, ArrowLeft, Loader2, Plus, AlertCircle, Clock } from 'lucide-react'
import Link from 'next/link'

const REGISTRY = process.env.NEXT_PUBLIC_ASSET_REGISTRY as `0x${string}`
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

const HARDWARE_CLASSES = ['GPU-H100','GPU-A100','GPU-RTX4090','GPU-RTX3090','CPU-64C','CPU-32C','CPU-16C']
const REGIONS          = ['us-east','us-west','eu-central','eu-west','asia-pacific','asia-south','latam']
const STATUS_LABEL     = ['Unregistered','Active','Suspended']
const STATUS_COLOR     = ['text-gray-400','text-green-400','text-yellow-400']

function MachineRow({ machineId }: { machineId: bigint }) {
  const { data: m } = useReadContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'getMachine', args: [machineId],
  })
  if (!m) return <div className="py-3 border-b border-gray-800 animate-pulse"><div className="h-3 bg-gray-800 rounded w-1/2"/></div>

  const stale = Math.round((Math.floor(Date.now() / 1000) - Number(m.lastHeartbeat)) / 60)

  return (
    <div className="flex flex-wrap items-center justify-between py-3 border-b border-gray-800 last:border-0 gap-3">
      <div className="flex items-center gap-3">
        <div className="bg-gray-800 rounded-lg p-2"><Server size={15} className="text-blue-400"/></div>
        <div>
          <div className="text-sm font-medium">{m.hardwareClass} <span className="text-gray-500 font-normal">· {m.region}</span></div>
          <div className="text-xs text-gray-600 font-mono">Machine #{machineId.toString()}</div>
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs">
        <span className={STATUS_COLOR[m.status] ?? 'text-gray-400'}>{STATUS_LABEL[m.status] ?? 'Unknown'}</span>
        <span className={stale > 30 ? 'text-red-400' : 'text-green-400'}>
          <Clock size={11} className="inline mr-1"/>Heartbeat: {stale}m ago
        </span>
        <a href={`${EXPLORER}/address/${REGISTRY}`} target="_blank" rel="noopener noreferrer"
          className="text-gray-600 hover:text-gray-300"><ExternalLink size={13}/></a>
      </div>
    </div>
  )
}

export default function ProviderPage() {
  const { address, isConnected } = useAccount()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    hardwareClass: 'GPU-RTX4090', region: 'asia-pacific', attestationURI: '', deviceId: '',
  })

  const { data: myMachineIds } = useReadContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: 'getProviderMachines',
    args: address ? [address] : undefined, query: { enabled: !!address },
  })

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const handleRegister = () => {
    if (!form.deviceId.trim()) { alert('Enter a Device ID to generate the hardware hash.'); return }
    const hardwareHash = keccak256(toBytes(form.deviceId.trim() + form.hardwareClass))
    writeContract({
      address: REGISTRY, abi: REGISTRY_ABI, functionName: 'registerMachine',
      args: [form.hardwareClass, form.region, form.attestationURI, hardwareHash],
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
          <ConnectButton/>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2">Provider Dashboard</h1>
        <p className="text-gray-400 mb-8 text-sm leading-relaxed">
          Register compute machines as RWA assets on BOT Chain. Earn BOT for every epoch the AI agent marks compliant.
        </p>

        {!isConnected ? (
          <div className="bg-gray-900 rounded-xl p-12 text-center border border-gray-800">
            <Server size={44} className="mx-auto mb-4 text-gray-700"/>
            <p className="text-gray-400 mb-6 text-sm">Connect your wallet to manage your machines</p>
            <ConnectButton/>
          </div>
        ) : (
          <>
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
                      Now live on BOT Chain. The AI agent will monitor heartbeats once a lease is active.
                    </p>
                    {hash && (
                      <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener noreferrer"
                        className="text-blue-400 hover:underline text-sm">View TX ↗</a>
                    )}
                    <div className="mt-4 flex gap-3 justify-center">
                      <button onClick={() => { reset(); setForm({ hardwareClass:'GPU-RTX4090', region:'asia-pacific', attestationURI:'', deviceId:'' }) }}
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
                        Device ID <span className="text-gray-600 text-xs">(used to generate hardware hash — keep private)</span>
                      </label>
                      <input value={form.deviceId} placeholder="e.g. server-001-rtx4090"
                        onChange={e => setForm(s => ({ ...s, deviceId: e.target.value }))}
                        className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none text-sm"/>
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Attestation URI</label>
                      <input value={form.attestationURI} placeholder="https://github.com/you/repo/blob/main/attestation.md"
                        onChange={e => setForm(s => ({ ...s, attestationURI: e.target.value }))}
                        className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 focus:border-blue-500 outline-none text-sm"/>
                      <p className="text-xs text-gray-600 mt-1">Leaving this blank deducts 15 points from your AI risk score.</p>
                    </div>
                    <div className="bg-gray-950 rounded-lg p-4 text-sm flex justify-between">
                      <span className="text-gray-400">Registration bond</span>
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

        <div className="mt-6 bg-gray-900 rounded-xl p-4 border border-gray-800 text-xs text-gray-500 leading-relaxed">
          <strong className="text-gray-400">How earnings work: </strong>
          The AI agent monitors heartbeats each epoch. Compliant → 98% of epoch price released to your
          withdrawal balance. Missed heartbeat → buyer refunded for that epoch.
          Withdraw via <code className="text-blue-300">LeaseEscrow.withdraw()</code> anytime.
        </div>
      </div>
    </div>
  )
}
