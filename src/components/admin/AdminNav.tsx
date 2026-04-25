'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Users, Trophy, Settings, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

const links = [
  { href: '/admin',          label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/admin/players',  label: 'Players',         icon: Users },
  { href: '/admin/matches',  label: 'Matches',         icon: Trophy },
  { href: '/admin/settings', label: 'League Settings', icon: Settings },
]

export default function AdminNav({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname()

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-5 border-b border-gray-800 pr-10">
        <span className="text-white font-bold text-sm tracking-wide">T9L Admin</span>
      </div>
      <nav className="flex flex-col p-3 gap-1 flex-1">
        {links.map(({ href, label, icon: Icon }) => {
          const active = href === '/admin' ? path === href : path.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                active
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>
      <div className="px-4 py-3 border-t border-gray-800">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to site
        </Link>
      </div>
    </div>
  )
}
