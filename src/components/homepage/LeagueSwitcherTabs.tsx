'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { ChevronDown } from 'lucide-react'
import { useHubTransition } from './HubTransitionShell'
import type { ApprovedMembership } from '@/lib/homepageRouting'

/**
 * v1.97.0 — chevron-collapsible league switcher rendered inside
 * `<MultiLeagueHub>` for users with ≥ 2 APPROVED memberships.
 *
 * Pre-v1.97.0 (v1.85.0 → v1.96.1) this surface was a persistent
 * horizontal-scrolling pill strip. The user-reported problem: the strip
 * occupies vertical space below the fixed Header on every render, the
 * oval pills make the active selection ambiguous against the dashboard
 * chrome, and the strip duplicates information already in the Header
 * (the active league's abbreviation is the page title).
 *
 * v1.97.0 collapses the strip into a chevron-driven dropdown bar that
 * matches the visual model of `<LeagueSwitcher>` in the Header:
 *
 *   1. Closed: only the trigger row is rendered (chevron icon + active
 *      league name + downstream chevron rotation cue). 48 px tall — same
 *      visual weight as a Header chip.
 *   2. Open: a rectangular bar slides in below with one rectangular
 *      pill per league. Each pill is ≥ 44 px tall (touch target), wraps
 *      inside the dashboard column, and renders the active league with
 *      the primary glow shadow.
 *   3. Outside-click + Escape close the bar. Same-league taps short-
 *      circuit the navigation. Power-user gestures
 *      (cmd/ctrl/shift/alt-click, middle-click) pass through.
 *   4. The shared `useHubTransition()` still wraps the navigation, so
 *      the top-edge progress strip + body skeleton dim on Dashboard fire
 *      from the same `isPending` signal. The v1.94.0 optimistic-active
 *      regression target — `selected` computed against
 *      `optimisticActiveId`, NOT the stale server-supplied
 *      `activeLeagueId` — is preserved.
 *
 * Prefetch trade-off: the per-league `<Link prefetch>` only mounts while
 * the dropdown is open, so the first navigation after opening pays one
 * cold RSC fetch (~250–400 ms). The new body skeleton (rendered by
 * `<HubTransitionShell>` via `useHubTransition`) communicates the
 * loading state explicitly, which was the v1.92.x user complaint that
 * v1.93.0's tiny pill-pulse never fully addressed.
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
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Outside-click + Escape close. Mirrors the LeagueSwitcher (header
  // chevron) pattern in `src/components/LeagueSwitcher.tsx` — same
  // listener shape so the two switchers behave identically.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent | TouchEvent | Event) {
      const target = e.target as Node | null
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown as EventListener)
    document.addEventListener('touchstart', onPointerDown as EventListener)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown as EventListener)
      document.removeEventListener('touchstart', onPointerDown as EventListener)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (memberships.length < 2) return null

  const active = memberships.find((m) => m.leagueId === optimisticActiveId)
  const activeLabel = active?.leagueName ?? 'Switch league'

  function pickLeague(
    e: MouseEvent<HTMLAnchorElement>,
    leagueId: string,
    href: string,
  ) {
    if (
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      e.button !== 0
    ) {
      // Power-user gestures (cmd-click new tab, middle-click, etc.) —
      // let the browser handle the navigation natively. Close the
      // dropdown so the trigger surface doesn't stay open after the new
      // tab opens.
      setOpen(false)
      return
    }
    if (leagueId === activeLeagueId) {
      // Same-league taps would otherwise re-fetch the RSC payload for
      // no reason. Cancel the implicit navigation, collapse the bar.
      e.preventDefault()
      setOpen(false)
      return
    }
    e.preventDefault()
    setOpen(false)
    startNavigation(() => {
      setOptimisticActiveId(leagueId)
      router.push(href, { scroll: false })
    })
  }

  return (
    <div
      ref={containerRef}
      data-testid="league-switcher-tabs"
      data-open={open ? 'true' : 'false'}
      className="relative pt-2 mb-3"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="league-switcher-bar"
        aria-label={open ? 'Close league switcher' : 'Open league switcher'}
        data-testid="league-switcher-trigger"
        className="flex items-center justify-between w-full h-11 px-4 rounded-xl border border-border-default bg-card text-fg-high transition-all duration-150 hover:bg-surface-md hover:border-primary/40 active:scale-[0.99]"
      >
        <span className="text-[11px] font-black uppercase tracking-widest truncate">
          {activeLabel}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`w-4 h-4 ml-2 shrink-0 text-fg-mid transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          id="league-switcher-bar"
          role="menu"
          aria-label="Switch league"
          data-testid="league-switcher-bar"
          className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl border border-border-default bg-card shadow-lg p-2 animate-in"
        >
          <div className="flex flex-wrap gap-1.5">
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
                  role="menuitem"
                  onClick={(e) => pickLeague(e, m.leagueId, href)}
                  data-testid={`league-switcher-tab-${m.slug}`}
                  data-active={selected ? 'true' : 'false'}
                  aria-pressed={selected}
                  className={`flex-1 min-w-[44%] inline-flex items-center justify-center min-h-[44px] px-3 py-2 rounded-lg border-2 text-[11px] font-black uppercase tracking-widest text-center transition-all duration-150 active:scale-[0.96] no-underline ${
                    selected
                      ? 'bg-primary text-primary-foreground border-primary shadow-[var(--glow-primary-md)]'
                      : 'bg-surface text-fg-mid border-border-default hover:bg-surface-md hover:text-fg-high hover:border-primary/40'
                  }`}
                >
                  <span className="truncate">{m.leagueName}</span>
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
        </div>
      ) : null}
    </div>
  )
}
