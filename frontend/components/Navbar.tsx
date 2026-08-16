'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'

const LINKS = [
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/provider',    label: 'Provide'      },
  { href: '/activity',    label: 'Activity'      },
  { href: '/verify',      label: 'Verify'        },
]

export function Navbar() {
  const pathname = usePathname()

  return (
    <nav className="border-b border-gray-800 px-6 py-4 flex justify-between items-center sticky top-0 bg-gray-950/90 backdrop-blur z-40">
      <Link href="/" className="flex items-center gap-3 shrink-0">
        <span className="text-xl font-bold text-blue-400">ProofLease</span>
        <span className="hidden sm:inline text-xs bg-green-900/60 text-green-300 border border-green-800 px-2 py-0.5 rounded-full font-mono">
          LIVE · Mainnet
        </span>
      </Link>

      <div className="flex items-center gap-1 sm:gap-2 mx-4">
        {LINKS.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-gray-800 text-white font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </div>

      <div className="shrink-0">
        <ConnectButton />
      </div>
    </nav>
  )
}