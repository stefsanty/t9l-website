'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useLeagueMemberships } from './LeagueSwitcher'

/**
 * v1.52.0 (PR 3 of the path-routing chain) — account-menu "Switch
 * league" entry. Mounted inside the `LineLoginButton` dropdown.
 *
 * Renders nothing when the user has < 2 memberships (no need to
 * switch). When the user has multiple, surfaces a small section
 * header + inline list of leagues. Each row is a `<Link>` so the
 * browser handles the navigation natively (no router.push); active
 * league is visually marked.
 *
 * Memberships are fetched via the shared `useLeagueMemberships` hook
 * (defined in `LeagueSwitcher.tsx`); the hook caches per-component
 * instance, so the navbar dropdown and this account-menu list each
 * trigger their own fetch on first open. That's acceptable — the
 * memberships list is small (a few rows per user) and changes rarely.
 *
 * The parent `LineLoginButton` controls whether the dropdown is open;
 * this component only loads the memberships when the dropdown is
 * actually showing (gated by the `dropdownOpen` prop).
 */
export default function AccountMenuLeagueSwitch({
  dropdownOpen,
  onNavigate,
}: {
  dropdownOpen: boolean
  onNavigate?: () => void
}) {
  const { memberships, loading, load } = useLeagueMemberships()

  useEffect(() => {
    if (dropdownOpen) {
      void load()
    }
  }, [dropdownOpen, load])

  // Hide entirely when the user has < 2 memberships. The navbar
  // dropdown does the same — single-league users see no extra chrome.
  if (loading) return null
  if (memberships.length < 2) return null

  return (
    <div
      className="border-t border-border-default mt-1 pt-1"
      data-testid="account-menu-switch-league"
    >
      <p className="px-4 pt-2 pb-1 text-[10px] font-black uppercase tracking-[0.2em] text-fg-low">
        Switch league
      </p>
      <ul>
        {memberships.map((m) => (
          <li key={m.leagueId}>
            <Link
              href={`/league/${m.slug}`}
              onClick={() => onNavigate?.()}
              className={`flex items-center gap-2 px-4 py-2 text-[12px] font-bold transition-colors hover:bg-surface ${
                m.isCurrent ? 'text-vibrant-pink' : 'text-fg-high hover:text-fg-mid'
              }`}
              data-testid={`account-menu-switch-league-${m.slug}`}
            >
              {m.name}
              {m.isCurrent && (
                <span className="text-[9px] font-black uppercase tracking-[0.15em] text-vibrant-pink">
                  · current
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
