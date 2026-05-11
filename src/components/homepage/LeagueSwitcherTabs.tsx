'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useOptimistic, type MouseEvent } from 'react'
import { useHubTransition } from './HubTransitionShell'
import type { ApprovedMembership } from '@/lib/homepageRouting'

/**
 * v1.85.0 → v1.93.0 — pill-style league switcher rendered inside
 * `<MultiLeagueHub>` for users with ≥ 2 APPROVED memberships.
 *
 * v1.85.0 shipped this as a `<button>` row that called the
 * `setUserDefaultLeague` server action then `router.refresh()`. That
 * meant every click sat on three sequential Neon round-trips before
 * the navigation kicked off, with no visual feedback in the meantime —
 * v1.92.x user feedback was "no animation, no loading, takes too long."
 *
 * v1.93.0 swaps the model:
 *
 *   1. Each pill is a `<Link prefetch href="/test?league=<id>">`.
 *      Next.js prefetches the destination's RSC payload on hover /
 *      visibility, so the navigation typically lands inside the route
 *      cache window (warm: ~50 ms; cold: ~250–400 ms).
 *
 *   2. `useOptimistic` mirrors the server-supplied `activeLeagueId`
 *      and updates IMMEDIATELY on click, so the tapped pill jumps to
 *      the active style before the navigation resolves. Pre-v1.93.0
 *      the `animate-pulse` actually fired on the OLD active pill
 *      because the comparison ran against the not-yet-updated
 *      `activeLeagueId` — confusing UX dressed up as a perf problem.
 *
 *   3. The click is wrapped in the shared `useHubTransition()` so the
 *      `<HubTransitionShell>` can render the top-edge progress strip
 *      from the same `isPending` signal.
 *
 *   4. `active:scale-[0.96]` gives a tactile press without any JS.
 *
 *   5. `User.defaultLeagueId` is no longer written from the click. The
 *      `<MultiLeagueHub>` server component fires
 *      `touchUserDefaultLeague(...)` via `waitUntil` on every render,
 *      which mirrors the `/id/<slug>` last-selected pattern and
 *      removes the action's 3-query critical path entirely.
 *
 * Why we still call `router.push` from inside `startNavigation` rather
 * than letting `<Link>` navigate on its own:
 *
 *   - We need the navigation to share the SAME transition that wraps
 *     the optimistic state update, otherwise React rejects the
 *     `setOptimisticId` call ("not in a transition"). Running both
 *     inside `startNavigation` keeps them coupled.
 *   - We keep `<Link prefetch>` so Next.js prefetches the destination,
 *     and we keep `href` set so right-click / open-in-new-tab still
 *     work for keyboard / power users.
 *   - The `e.preventDefault()` short-circuits the implicit navigation
 *     so React isn't fighting the router for control of the next URL.
 */
export default function LeagueSwitcherTabs({
  memberships,
  activeLeagueId,
}: {
  memberships: ReadonlyArray<ApprovedMembership>
  activeLeagueId: string
}) {
  const router = useRouter()
  const { isPending, startNavigation } = useHubTransition()
  const [optimisticActiveId, setOptimisticActiveId] = useOptimistic(activeLeagueId)

  if (memberships.length < 2) return null

  function pickLeague(
    e: MouseEvent<HTMLAnchorElement>,
    leagueId: string,
    href: string,
  ) {
    if (leagueId === activeLeagueId) {
      // Same-league taps would otherwise re-fetch the RSC payload for
      // no reason. Cancel the implicit navigation and exit.
      e.preventDefault()
      return
    }
    if (
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      e.button !== 0
    ) {
      // Power-user gestures (cmd-click new tab, middle-click, etc.)
      // — let the browser handle the navigation natively.
      return
    }
    e.preventDefault()
    startNavigation(() => {
      setOptimisticActiveId(leagueId)
      router.push(href, { scroll: false })
    })
  }

  return (
    <nav
      aria-label="Switch league"
      data-testid="league-switcher-tabs"
      className="w-full overflow-x-auto no-scrollbar mb-3"
    >
      <div className="flex items-center gap-2 min-w-max">
        {memberships.map((m) => {
          const selected = m.leagueId === optimisticActiveId
          const showSpinner = isPending && selected
          const href = `/test?league=${encodeURIComponent(m.leagueId)}`
          return (
            <Link
              key={m.leagueId}
              href={href}
              prefetch
              scroll={false}
              onClick={(e) => pickLeague(e, m.leagueId, href)}
              data-testid={`league-switcher-tab-${m.slug}`}
              data-active={selected ? 'true' : 'false'}
              aria-pressed={selected}
              className={`flex-shrink-0 inline-flex items-center h-9 px-4 rounded-full text-[11px] font-black uppercase tracking-widest transition-transform duration-100 active:scale-[0.96] ${
                selected
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-surface text-fg-mid hover:bg-surface-md'
              }`}
            >
              <span>{m.leagueName}</span>
              {showSpinner ? (
                <span
                  aria-hidden="true"
                  data-testid={`league-switcher-tab-spinner-${m.slug}`}
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70 animate-pulse"
                />
              ) : null}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
