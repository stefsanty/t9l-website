'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { signOut } from 'next-auth/react'
import { ChevronDown, LogOut, User, Menu, X } from 'lucide-react'
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
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <>
      <nav
        className="h-12 bg-admin-surface border-b border-admin-border flex items-center px-4 md:px-6 gap-4 md:gap-6 shrink-0"
        style={{ zIndex: 40 }}
      >
        {/* Logo */}
        <Link
          href="/admin"
          className="font-condensed font-extrabold text-admin-green text-[18px] tracking-[2px] uppercase no-underline hover:opacity-90 shrink-0"
        >
          T9L Admin
        </Link>

        {/* Nav links — desktop only */}
        <div className="hidden md:flex items-center gap-1 flex-1">
          <NavLink href="/admin" exact={true} pathname={pathname} label="Dashboard" />
          <NavLink href="/admin/teams-all" exact={false} pathname={pathname} label="All Teams" />
          <NavLink href="/admin/players-all" exact={false} pathname={pathname} label="All Players" />
        </div>

        {/* Spacer on mobile */}
        <div className="flex-1 md:hidden" />

        {/* Admin dropdown — desktop only */}
        <div className="relative hidden md:block">
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center gap-2 text-admin-text2 hover:text-admin-text font-mono text-xs transition-colors"
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

        {/* Hamburger — mobile only */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="md:hidden flex items-center justify-center w-11 h-11 -mr-1.5 text-admin-text2 hover:text-admin-text transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
      </nav>

      {/* Mobile drawer */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-50 md:hidden"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="fixed top-0 right-0 h-full w-64 bg-admin-surface border-l border-admin-border z-50 flex flex-col md:hidden">
            <div className="h-12 flex items-center justify-between px-4 border-b border-admin-border shrink-0">
              <span className="font-condensed font-extrabold text-admin-green text-lg">T9L Admin</span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="w-11 h-11 flex items-center justify-center text-admin-text2 hover:text-admin-text -mr-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col py-2 flex-1 overflow-y-auto">
              {navLinks.map(({ href, label, exact }) => {
                const active = exact
                  ? pathname === href
                  : pathname.startsWith(href) && href !== '/admin'
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setDrawerOpen(false)}
                    className={cn(
                      'flex items-center px-4 py-3.5 text-sm transition-colors no-underline',
                      active
                        ? 'text-admin-text bg-admin-surface2'
                        : 'text-admin-text2 hover:text-admin-text hover:bg-admin-surface2',
                    )}
                  >
                    {label}
                  </Link>
                )
              })}
            </div>

            <div className="border-t border-admin-border p-3 shrink-0">
              <div className="flex items-center gap-2 px-1 py-2 mb-1">
                <span className="w-6 h-6 rounded-full bg-admin-surface3 border border-admin-border2 flex items-center justify-center shrink-0">
                  <User className="w-3 h-3 text-admin-text2" />
                </span>
                <span className="text-admin-text2 text-sm truncate">{adminName ?? 'Admin'}</span>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="w-full flex items-center gap-2.5 px-3 py-3 text-sm text-admin-text2 hover:text-admin-red hover:bg-admin-red-dim transition-colors rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </>
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
        'px-3 py-1.5 text-[13px] tracking-[0.3px] transition-colors no-underline',
        active
          ? 'text-admin-text'
          : 'text-admin-text2 hover:text-admin-text',
      )}
    >
      {label}
    </Link>
  )
}
