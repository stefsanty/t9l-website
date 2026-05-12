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
 * v1.96.1 — visual polish (UI-only):
 *   - `pt-2` on the nav adds 8px breathing room below the fixed Header
 *     (was flush at the 48px line).
 *   - `picker-scrollbar` utility (defined in `globals.css`) replaces
 *     `no-scrollbar` so the horizontal scroll surfaces a styled thin
 *     scrollbar on overflow — mobile users now have a visual cue that
 *     the strip scrolls.
 *   - `py-2` inside the scroll viewport reserves 8px above/below so the
 *     active pill's glow shadow isn't clipped by `overflow-x-auto`.
 *   - Pills bumped to `h-11 px-5 text-[12px]` for ≥44px touch target and
 *     more visual weight; inactive pills carry `border border-border-default`,
 *     active pill carries `border-2 border-primary` plus the existing
 *     primary glow shadow recipe.
 *   - The just-clicked pill's pending cue switched from a 1.5px
 *     `animate-pulse` dot to a `h-3 w-3 animate-spin` ring — matches the
 *     `<RsvpButton>` / `<RsvpBar>` inline pending pattern used across
 *     non-admin public UI.
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
      className="w-full overflow-x-auto picker-scrollbar pt-2 mb-4"
    >
      {/* v1.96.1 — `py-2` inside the scroll viewport reserves 8px above
          and below the pills so the active pill's `--glow-primary-bar`
          shadow doesn't get clipped by `overflow-x-auto` (which forces
          overflow-y to clip even though we didn't ask for it). */}
      <div className="flex items-center gap-2 min-w-max py-2">
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
              className={`flex-shrink-0 inline-flex items-center h-11 px-5 rounded-full text-[12px] font-black uppercase tracking-widest transition-all duration-150 active:scale-[0.96] ${
                selected
                  ? 'bg-primary text-primary-foreground border-2 border-primary shadow-[0_2px_10px_rgba(233,0,82,0.4)]'
                  : 'bg-surface text-fg-mid border border-border-default hover:bg-surface-md hover:text-fg-high hover:border-border-default'
              }`}
            >
              <span>{m.leagueName}</span>
              {showSpinner ? (
                <span
                  aria-hidden="true"
                  data-testid={`league-switcher-tab-spinner-${m.slug}`}
                  className="ml-2 inline-block h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin opacity-80"
                />
              ) : null}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
