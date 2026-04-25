'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { ChevronDown, LogOut, LayoutDashboard, Users, User } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AdminNavProps {
  adminName?: string | null
}

const navLinks = [
  { href: '/admin', label: 'Dashboard', exact: true },
  { href: '/admin/teams-all', label: 'All Teams' },
  { href: '/admin/players-all', label: 'All Players' },
]

export default function AdminNav({ adminName }: AdminNavProps) {
  const pathname = usePathname()
  const [dropdownOpen, setDropdownOpen] = useState(false)

  return (
    <nav
      className="h-12 bg-admin-surface border-b border-admin-border flex items-center px-6 gap-6 shrink-0"
      style={{ zIndex: 40 }}
    >
      {/* Logo */}
      <Link
        href="/admin"
        className="font-condensed font-extrabold text-admin-green text-lg tracking-wide no-underline hover:opacity-90 shrink-0"
      >
        T9L Admin
      </Link>

      {/* Nav links */}
      <div className="flex items-center gap-1 flex-1">
        <NavLink href="/admin" exact={true} pathname={pathname} label="Dashboard" />
        <NavLink href="/admin/teams-all" exact={false} pathname={pathname} label="All Teams" />
        <NavLink href="/admin/players-all" exact={false} pathname={pathname} label="All Players" />
      </div>

      {/* Admin dropdown */}
      <div className="relative">
        <button
          onClick={() => setDropdownOpen((o) => !o)}
          className="flex items-center gap-2 text-admin-text2 hover:text-admin-text text-sm font-barlow transition-colors"
        >
          <span className="w-6 h-6 rounded-full bg-admin-surface3 border border-admin-border2 flex items-center justify-center">
            <User className="w-3 h-3" />
          </span>
          <span>{adminName ?? 'Admin'}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>

        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
            <div className="absolute right-0 top-full mt-1 w-44 bg-admin-surface border border-admin-border rounded-lg shadow-xl z-50 py-1">
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-admin-text2 hover:text-admin-red hover:bg-admin-red-dim transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </nav>
  )
}

function NavLink({
  href,
  exact,
  pathname,
  label,
}: {
  href: string
  exact: boolean
  pathname: string
  label: string
}) {
  const active = exact ? pathname === href : pathname.startsWith(href) && href !== '/admin'

  return (
    <Link
      href={href}
      className={cn(
        'px-3 py-1.5 rounded text-sm transition-colors no-underline',
        active
          ? 'text-admin-text bg-admin-surface2'
          : 'text-admin-text2 hover:text-admin-text hover:bg-admin-surface2',
      )}
    >
      {label}
    </Link>
  )
}
