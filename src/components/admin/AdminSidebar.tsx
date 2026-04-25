'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/players', label: 'Players' },
  { href: '/admin/matches', label: 'Matches' },
  { href: '/admin/settings', label: 'League Settings' },
]

export default function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 min-h-screen bg-gray-900 text-white flex flex-col shrink-0">
      <div className="px-6 py-5 border-b border-gray-700">
        <span className="text-sm font-semibold uppercase tracking-widest text-gray-400">Admin Panel</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map(({ href, label }) => {
          const isActive =
            href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="px-6 py-4 border-t border-gray-700">
        <Link href="/" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
          ← Back to site
        </Link>
      </div>
    </aside>
  )
}
