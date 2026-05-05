'use client'

import { createContext, useContext } from 'react'
import type { Membership } from '@/lib/memberships'

/**
 * v1.59.0 — client-side bridge for the server-resolved memberships.
 *
 * The root layout calls `getMembershipsForSession()` and passes the result
 * here; the header `LeagueSwitcher` chevron reads from context. (v1.62.0 —
 * the in-dropdown `AccountMenuLeagueSwitch` was removed in favor of the
 * navbar chevron only.) The previous design lazy-loaded via
 * `/api/me/memberships` on dropdown open, which produced a visible flash
 * for multi-league users. With SSR hydration, the trigger renders on
 * first paint with the correct visibility decision (≥2 memberships → show;
 * <2 → hide).
 *
 * The `/api/me/memberships` route stays for compatibility but is no longer
 * the primary read path.
 */
const MembershipsContext = createContext<Membership[]>([])

export function MembershipsProvider({
  memberships,
  children,
}: {
  memberships: Membership[]
  children: React.ReactNode
}) {
  return (
    <MembershipsContext.Provider value={memberships}>
      {children}
    </MembershipsContext.Provider>
  )
}

export function useMemberships(): Membership[] {
  return useContext(MembershipsContext)
}

export type { Membership }
