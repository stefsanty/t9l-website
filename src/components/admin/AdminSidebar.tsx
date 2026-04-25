'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const links = [
  { href: '/admin',          label: 'Dashboard' },
  { href: '/admin/players',  label: 'Players' },
  { href: '/admin/matches',  label: 'Matches' },
  { href: '/admin/settings', label: 'League Settings' },
]

export default function AdminSidebar() {
  const path = usePathname()

  return (
    <aside className="w-56 bg-gray-900 min-h-screen flex flex-col shrink-0">
      <div className="px-4 py-5 border-b border-gray-700">
        <span className="text-white font-bold text-sm tracking-wide">T9L Admin</span>
      </div>
      <nav className="flex flex-col p-3 gap-1 flex-1">
        {links.map(({ href, label }) => {
          const active = path === href
          return (
            <Link
              key={href}
              href={href}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                active
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="px-4 py-3 border-t border-gray-700">
        <Link href="/" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
          ← Back to site
        </Link>
      </div>
    </aside>
  )
}
