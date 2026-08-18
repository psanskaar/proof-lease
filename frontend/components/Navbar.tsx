'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Menu, X } from 'lucide-react'

const LINKS = [
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/provider',    label: 'Provide'      },
  { href: '/activity',    label: 'Activity'      },
  { href: '/verify',      label: 'Verify'        },
]

export function Navbar() {
  const pathname        = usePathname()
  const [open, setOpen] = useState(false)

  // Close menu on route change
  useEffect(() => { setOpen(false) }, [pathname])

  // Close menu on outside scroll (feels more native)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, { passive: true })
    return () => window.removeEventListener('scroll', close)
  }, [open])

  return (
    <>
      <nav className="border-b border-gray-800 px-4 sm:px-6 py-3 flex justify-between items-center sticky top-0 bg-gray-950/95 backdrop-blur z-40">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="text-lg sm:text-xl font-bold text-blue-400">ProofLease</span>
          <span className="hidden sm:inline text-xs bg-green-900/60 text-green-300 border border-green-800 px-2 py-0.5 rounded-full font-mono">
            LIVE · Mainnet
          </span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden md:flex items-center gap-1 mx-4">
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

        {/* Right side: ConnectButton + hamburger */}
        <div className="flex items-center gap-2 shrink-0">
          {/* ConnectButton — compact on mobile via RainbowKit's built-in responsive prop */}
          <div className="scale-90 sm:scale-100 origin-right">
            <ConnectButton
              accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
              chainStatus={{ smallScreen: 'none', largeScreen: 'icon' }}
              showBalance={{ smallScreen: false, largeScreen: true }}
            />
          </div>

          {/* Hamburger — mobile only */}
          <button
            onClick={() => setOpen(o => !o)}
            className="md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X size={20}/> : <Menu size={20}/>}
          </button>
        </div>
      </nav>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden fixed top-[57px] inset-x-0 z-30 bg-gray-950/98 border-b border-gray-800 px-4 py-3 flex flex-col gap-1 backdrop-blur">
          {LINKS.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(href + '/')
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                }`}
              >
                {label}
              </Link>
            )
          })}
          <div className="mt-1 pt-3 border-t border-gray-800">
            <span className="text-xs text-gray-600 font-mono px-1">LIVE · BOT Chain Mainnet</span>
          </div>
        </div>
      )}
    </>
  )
}