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
    <nav className="border-b border-gray-800 px-4 sm:px-6 py-3 flex items-center gap-2 sticky top-0 bg-gray-950/90 backdrop-blur z-40">

      {/* ── Left: brand ─────────────────────────────────────────────────────── */}
      {/* flex-1 so it takes equal space as the right side, keeping nav centred */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-xl font-bold text-blue-400">ProofLease</span>
          <span className="hidden lg:inline-flex items-center gap-1 text-xs bg-green-900/60 text-green-300 border border-green-800 px-2 py-0.5 rounded-full font-mono whitespace-nowrap">
            LIVE · BOT Mainnet
          </span>
        </Link>
      </div>

      {/* ── Centre: nav links ────────────────────────────────────────────────── */}
      {/* hidden on mobile; each link gets whitespace-nowrap so it never breaks */}
      <div className="hidden md:flex items-center gap-0.5 shrink-0">
        {LINKS.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
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

      {/* ── Right: wallet ────────────────────────────────────────────────────── */}
      {/* flex-1 + justify-end mirrors the left side so the centre stays centred */}
      <div className="flex-1 flex items-center justify-end shrink-0">
        <ConnectButton />
      </div>

    </nav>
  )
}