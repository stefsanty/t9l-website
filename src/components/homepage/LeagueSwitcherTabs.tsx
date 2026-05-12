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

  // v1.96.1 — UX refresh:
  //
  //   1. Top margin (`pt-2`) matches the spacing between the fixed Header
  //      and the recruiting banner on `/id/<slug>`. Pre-v1.96.1 the pill
  //      strip butted directly against the bottom of the header.
  //   2. The wrapper's scrollbar uses the new `.pill-scrollbar` utility
  //      (defined in globals.css) — thin track, rounded surface-md thumb.
  //      Pre-v1.96.1 we applied a `no-scrollbar` class that did not exist,
  //      so the browser default scrollbar bled through.
  //   3. Pills are visibly weightier: 44 px touch target (h-11), 2 px
  //      border, slightly larger uppercase text, and a primary glow on
  //      the active pill so the selected league is unambiguous.
  //   4. Loading affordance swapped from a tiny `animate-pulse` dot to
  //      the small `animate-spin` ring used by RsvpBar / RsvpButton /
  //      every admin editor — the predominant in-flight pattern across
  //      the codebase. The spinner still gates on `isPending && selected`,
  //      and `selected` is computed against `optimisticActiveId`, so it
  //      fires on the just-clicked pill (the v1.94.0 fix is preserved).
  return (
    <nav
      aria-label="Switch league"
      data-testid="league-switcher-tabs"
      className="w-full overflow-x-auto pill-scrollbar pt-2 pb-1.5 mb-3"
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
              className={`flex-shrink-0 inline-flex items-center justify-center min-w-[44px] h-11 px-5 rounded-full border-2 text-xs font-black uppercase tracking-widest transition-all duration-150 active:scale-[0.96] no-underline ${
                selected
                  ? 'bg-primary text-primary-foreground border-primary shadow-[var(--glow-primary-md)]'
                  : 'bg-card text-fg-mid border-border-default hover:bg-surface-md hover:text-fg-high hover:border-primary/40'
              }`}
            >
              <span>{m.leagueName}</span>
              {showSpinner ? (
                <span
                  aria-hidden="true"
                  data-testid={`league-switcher-tab-spinner-${m.slug}`}
                  className="ml-2 inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0 opacity-80"
                />
              ) : null}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
