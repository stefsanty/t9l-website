'use client'

import Link from 'next/link'
import { useMemberships } from './MembershipsProvider'

/**
 * Account-menu "Switch league" entry mounted inside the LineLoginButton
 * dropdown.
 *
 * v1.59.0 — perf: reads memberships from context (SSR-hydrated by the root
 * layout) instead of doing a `/api/me/memberships` fetch on dropdown open.
 * Renders nothing when the user has < 2 memberships.
 *
 * The component no longer cares whether the dropdown is open — the data is
 * already present. The `dropdownOpen` prop is kept for API compatibility
 * with the existing call site in LineLoginButton.tsx but is unused.
 */
export default function AccountMenuLeagueSwitch({
  onNavigate,
}: {
  // Kept for backwards compat with the existing call site; unused after
  // v1.59.0 since memberships are no longer lazy-loaded.
  dropdownOpen?: boolean
  onNavigate?: () => void
}) {
  const memberships = useMemberships()

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
              href={`/id/${m.slug}`}
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
