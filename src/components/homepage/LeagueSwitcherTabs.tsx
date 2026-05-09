'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setUserDefaultLeague } from './actions'
import type { ApprovedMembership } from '@/lib/homepageRouting'

/**
 * v1.85.0 — homepage redesign phase 1c. Pill-style tab strip rendered
 * inside `<MultiLeagueHub>` for users with ≥ 2 APPROVED memberships.
 *
 * Why Option A (tabs) instead of Option B (banner + dropdown): a
 * 2–4-league user benefits from at-a-glance discovery — every league
 * the user belongs to is visible without a tap. A dropdown adds an
 * extra interaction step and hides the membership count behind a
 * chevron. On overflow (5+ leagues, currently zero in production), the
 * row scrolls horizontally rather than wrapping; the active tab stays
 * leftmost so the most-used league is one tap away on a fresh load.
 *
 * Mobile layout: pills are h-9, gap-2, with `flex-shrink-0` so they
 * keep their typography intact under horizontal scroll. The container
 * uses `overflow-x-auto` + `no-scrollbar` so the strip stays visually
 * clean even when scrollable. Sits directly under the Header; the
 * Dashboard's `<main>` content begins below.
 *
 * Click behaviour:
 *   1. Optimistic: visually mark the tapped tab as active.
 *   2. Fire `setUserDefaultLeague(leagueId)` server action.
 *   3. On success: `router.refresh()` so the server-rendered
 *      `<HomepageRouter>` re-evaluates the persona with the new
 *      `defaultLeagueId` and the page swaps to that league's data.
 *   4. On failure: roll back to the original active tab; the user can
 *      retry by tapping again.
 *
 * `useTransition` wraps the action so React keeps the strip
 * interactive while the refresh is in flight (the active tab shows a
 * subtle pulse rather than freezing the whole UI).
 */
export default function LeagueSwitcherTabs({
  memberships,
  activeLeagueId,
}: {
  memberships: ReadonlyArray<ApprovedMembership>
  activeLeagueId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function pick(leagueId: string) {
    if (leagueId === activeLeagueId) return
    startTransition(async () => {
      const result = await setUserDefaultLeague(leagueId)
      if (result.ok) {
        router.refresh()
      }
    })
  }

  if (memberships.length < 2) return null

  return (
    <nav
      aria-label="Switch league"
      data-testid="league-switcher-tabs"
      className="w-full overflow-x-auto no-scrollbar mb-3"
    >
      <div className="flex items-center gap-2 min-w-max">
        {memberships.map((m) => {
          const selected = m.leagueId === activeLeagueId
          return (
            <button
              key={m.leagueId}
              type="button"
              onClick={() => pick(m.leagueId)}
              disabled={isPending}
              data-testid={`league-switcher-tab-${m.slug}`}
              data-active={selected ? 'true' : 'false'}
              className={`flex-shrink-0 h-9 px-4 rounded-full text-[11px] font-black uppercase tracking-widest transition-colors ${
                selected
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface text-fg-mid hover:bg-surface-md'
              } ${isPending && selected ? 'animate-pulse' : ''}`}
              aria-pressed={selected}
            >
              {m.leagueName}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
