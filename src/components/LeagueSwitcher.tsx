'use client'

import Link from 'next/link'
import { useEffect, useOptimistic, useRef, useState, type MouseEvent } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { useMemberships, type Membership } from './MembershipsProvider'
import { useHubTransition } from './homepage/HubTransitionShell'
import { setDefaultLeagueCookie } from '@/app/api/default-league/actions'

/**
 * Header league-switcher: a chevron next to the brand title that opens a
 * 1-line horizontal scrollable pill bar below the fixed header. Rendered
 * only for users with ≥ 2 league memberships.
 *
 * v1.97.1 — UX rebuild. Pre-v1.97.1 the trigger opened a vertical
 * dropdown menu of league names. Concurrently, the v1.85.0 → v1.97.0
 * multi-league hub at `/test` shipped its own in-page league picker
 * (`<LeagueSwitcherTabs>`) that duplicated this role with different
 * chrome (pill strip → chevron-collapsible dropdown bar across the
 * v1.93.0 / v1.96.1 / v1.97.0 iterations). The user clarified the
 * intent: the Header chevron is the canonical picker and should expand
 * into a single-line scrollable pill bar. v1.97.1 collapses both
 * surfaces into this one. The duplicate `<LeagueSwitcherTabs>` is
 * deleted; the body-skeleton overlay on Dashboard (v1.97.0) stays and is
 * now driven by this component's `useHubTransition()` call.
 *
 * Behaviour:
 *   1. Closed: just the chevron button, inline next to the brand title.
 *      Hidden entirely when memberships.length < 2.
 *   2. Open: a horizontal bar slides in directly below the Header,
 *      aligned to the same `max-w-lg` column. The bar uses
 *      `overflow-x-auto` + `.pill-scrollbar` (re-added in v1.97.1 after
 *      v1.97.0 removed it) so leagues scroll horizontally on narrow
 *      viewports instead of wrapping onto a second line.
 *   3. Pills are rectangular (`rounded-lg`), `≥36px` tall, with the
 *      active league carrying the primary glow shadow + primary
 *      background (same visual treatment as the v1.96.1 pill strip).
 *   4. Outside-click + Escape close the bar (`mousedown` + `touchstart`
 *      + `keydown` listeners, gated on `open`).
 *   5. Navigation target depends on the current route — on the
 *      `/test` multi-league hub we navigate via `?league=<id>` so the
 *      hub stays mounted and the body skeleton overlay can pulse;
 *      everywhere else we navigate to `/id/<slug>`. `usePathname()` is
 *      the discriminator.
 *   6. `useOptimistic` swaps the active styling immediately on tap so
 *      the user sees the result of their click without waiting for the
 *      RSC payload (v1.94.0 regression target preserved). On `/test`
 *      this is wrapped in `useHubTransition().startNavigation` so the
 *      transition's `isPending` drives Dashboard's body-skeleton dim.
 *      Off-hub `useHubTransition()` returns its default no-op, so the
 *      navigation just runs synchronously (Next.js's own route
 *      transition handles the cross-page loading state).
 *   7. Same-league taps short-circuit; power-user gestures
 *      (cmd/ctrl/shift/alt-click, middle-click) pass through to the
 *      browser so "open in new tab" still works.
 *
 * v1.97.2 — two fixes prompted by user-reported "click does nothing" +
 * "loading too long" on /test:
 *   - On the `/test` multi-league hub, `currentLeagueId` is now derived
 *     from `useSearchParams().get('league')` (with a fallback to the
 *     SSR-baked `isCurrent` flag for the no-searchParam case). Pre-
 *     v1.97.2 `currentLeagueId` came only from `Membership.isCurrent`,
 *     which is set at layout SSR from `session.leagueId` — a value that
 *     doesn't change as the user navigates `?league=<id>` within the
 *     hub. Result: a user viewing `/test?league=<other>` would see the
 *     pill for their default league (e.g. t9l-2026-spring) styled as
 *     "selected" and the same-league-tap short-circuit would silently
 *     swallow the click, making the picker feel broken.
 *   - Memberships are router-prefetched on mount when `onHub` is true.
 *     Pre-v1.97.2 the `<Link prefetch>` only warmed when the bar was
 *     open (because the Links don't mount until then), so tapping a
 *     pill within ~200ms of opening the chevron hit a cold RSC fetch.
 *     The eager prefetch fires once per session per league on the
 *     `/test` route, mirroring Next.js's link-visibility prefetch
 *     behaviour without requiring the Links to render first.
 *
 * v1.97.3 — combined league-name + chevron trigger.
 *   Pre-v1.97.3 the Header rendered `<Link href="/">{leagueTitle}</Link>`
 *   followed by a chevron-only `<LeagueSwitcher />`. For multi-league
 *   users viewing `/test`, clicking the league-name link navigated to
 *   `/` — which renders the default-league dashboard. If their default
 *   IS the league they're already viewing, the navigation feels like a
 *   no-op ("clicking on t9l 2026 spring button still does nothing").
 *   The user clarified the intent: the league name itself should open
 *   the picker, not act as a hyperlink.
 *
 *   v1.97.3 collapses both surfaces into one trigger button. When
 *   `leagueTitle` is provided AND the user has ≥ 2 memberships, the
 *   button contains the title text + chevron and the whole region
 *   toggles the bar. Without `leagueTitle` we fall back to the v1.97.1
 *   chevron-only trigger (preserves any caller that mounts the
 *   switcher in isolation). The `data-testid="header-league-title"`
 *   span is mounted INSIDE the button so existing source-grep tests
 *   keep passing. Header now renders the standalone `<Link href="/">`
 *   only on the single-league fallback path (where the picker would
 *   return null anyway).
 */

export type { Membership }

/**
 * @deprecated v1.59.0 — memberships are SSR-hydrated. Use `useMemberships()`
 * directly. Kept as a thin shim so existing call sites compile; `load()` is
 * a no-op since the data is already present at first render.
 */
export function useLeagueMemberships(): {
  memberships: Membership[]
  loading: boolean
  load: () => Promise<void>
} {
  const memberships = useMemberships()
  return {
    memberships,
    loading: false,
    load: async () => {},
  }
}

interface LeagueSwitcherProps {
  /**
   * v1.97.3 — when provided, the trigger button renders the league
   * name text inside the same surface as the chevron, so the whole
   * `[Title] [Chevron]` region toggles the picker. Header threads the
   * page-resolved abbreviation/name here; when omitted (legacy mount
   * points), the trigger is chevron-only as in v1.97.1.
   */
  leagueTitle?: string | null
}

export default function LeagueSwitcher({ leagueTitle }: LeagueSwitcherProps = {}) {
  const memberships = useMemberships()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isPending, startNavigation } = useHubTransition()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onHub = pathname === '/test' || (pathname?.startsWith('/test/') ?? false)
  // v1.97.2 — on `/test`, the URL's `?league=<id>` is the source of
  // truth for the active league (the page-level RSC resolves it via
  // `homepageRouting.classifyPersona`). The SSR-baked `Membership.isCurrent`
  // flag comes from `session.leagueId` and doesn't track in-hub
  // navigation, so reading it here would mis-identify the active league
  // after the user has clicked through to a non-default league. Use the
  // searchParam when present, fall back to `isCurrent` for the
  // no-searchParam case (matches the page's own fallback chain:
  // searchParam → defaultLeagueId → memberships[0]).
  const urlLeagueId =
    onHub && searchParams ? searchParams.get('league') : null
  const verifiedUrlLeagueId =
    urlLeagueId && memberships.some((m) => m.leagueId === urlLeagueId)
      ? urlLeagueId
      : null
  const sessionCurrentLeagueId =
    memberships.find((m) => m.isCurrent)?.leagueId ?? null
  const currentLeagueId = verifiedUrlLeagueId ?? sessionCurrentLeagueId
  const [optimisticActiveId, setOptimisticActiveId] = useOptimistic(currentLeagueId)

  // v1.97.2 — eager prefetch of each membership's hub destination when
  // the user lands on `/test`. The `<Link prefetch>` inside the bar
  // would only fire on mount/visibility — but the Links don't mount
  // until the chevron is opened, so a fast click misses the warm
  // window. Calling `router.prefetch()` here moves the warm-up to page
  // load: subsequent pill taps land inside Next.js's route cache.
  // Bounded by `memberships.length` (typically 2-4) so the prefetch
  // cost is small even on multi-league users.
  useEffect(() => {
    if (!onHub) return
    if (memberships.length < 2) return
    for (const m of memberships) {
      router.prefetch(`/test?league=${encodeURIComponent(m.leagueId)}`)
    }
  }, [onHub, memberships, router])

  // Outside-click + Escape close. Same listener shape as the prior
  // dropdown implementation; touchstart added so the close fires on
  // mobile-tap-outside without waiting for the synthetic click.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: Event) {
      const target = e.target as Node | null
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Hide entirely for users without multiple memberships. SSR hydration
  // means this check is accurate on first render; no flash window.
  if (memberships.length < 2) return null

  function buildHref(m: Membership): string {
    return onHub
      ? `/test?league=${encodeURIComponent(m.leagueId)}`
      : `/id/${m.slug}`
  }

  function pickLeague(e: MouseEvent<HTMLAnchorElement>, m: Membership) {
    if (
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      e.button !== 0
    ) {
      // Power-user gestures — let the browser handle the navigation.
      // Close the bar so the trigger surface doesn't stay open after
      // the new tab opens.
      setOpen(false)
      return
    }
    if (m.leagueId === currentLeagueId) {
      // Same-league taps would otherwise re-fetch the RSC payload for
      // no reason. Cancel the implicit navigation, collapse the bar.
      e.preventDefault()
      setOpen(false)
      return
    }
    e.preventDefault()
    setOpen(false)
    const href = buildHref(m)
    // v1.97.5 — fire-and-forget cookie write. The server action sets
    // an HttpOnly cookie so the next persona-aware apex render
    // (`<HomepageRouter>` on `/test`) picks this league without a
    // Prisma round-trip. We deliberately don't await: the navigation
    // is the user-facing critical path, and the cookie only needs to
    // exist by the time of the NEXT page render (typically seconds
    // later). On failure the next render falls through to the DB
    // `User.defaultLeagueId` — no regression beyond pre-v1.97.5 behaviour.
    void setDefaultLeagueCookie(m.leagueId).catch(() => {})
    startNavigation(() => {
      setOptimisticActiveId(m.leagueId)
      router.push(href, { scroll: false })
    })
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // v1.97.3 — when `leagueTitle` is provided the trigger doubles
        // as the brand-title surface, so it adopts the original
        // Header.tsx Link styling (font-display + uppercase + tracking)
        // and reserves `gap-1.5` between title and chevron to match the
        // legacy `gap-1.5` from the Header brand link. Without
        // `leagueTitle` it stays chevron-only with the v1.97.1 styling.
        className={
          leagueTitle
            ? 'inline-flex items-baseline gap-1.5 shrink-0 font-display font-black uppercase tracking-tight leading-none text-fg-high hover:opacity-80 transition-opacity'
            : 'inline-flex items-center gap-0.5 text-fg-mid hover:text-fg-high transition-colors'
        }
        aria-label={open ? 'Close league switcher' : 'Switch league'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="league-switcher-bar"
        data-testid="league-switcher-trigger"
      >
        {leagueTitle ? (
          <span className="text-xl" data-testid="header-league-title">
            {leagueTitle}
          </span>
        ) : null}
        <ChevronDown
          aria-hidden="true"
          className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''} ${leagueTitle ? 'self-center text-fg-mid' : ''}`}
        />
      </button>

      {open ? (
        <div
          id="league-switcher-bar"
          role="menu"
          aria-label="Switch league"
          data-testid="league-switcher-bar"
          data-open="true"
          // Positioned `fixed` to the viewport (not the trigger) so the
          // bar lines up with the fixed Header column at `top-12`
          // regardless of the trigger's exact x-position. `max-w-lg`
          // matches the Header's column width.
          className="fixed top-12 left-1/2 -translate-x-1/2 w-full max-w-lg z-40 border-b border-border-default bg-header-bg backdrop-blur-md animate-in"
        >
          <div className="pill-scrollbar flex items-center gap-2 overflow-x-auto px-3 md:px-4 py-2">
            {memberships.map((m) => {
              const selected = m.leagueId === optimisticActiveId
              const showSpinner = isPending && selected
              const href = buildHref(m)
              return (
                <Link
                  key={m.leagueId}
                  href={href}
                  prefetch
                  scroll={false}
                  role="menuitem"
                  onClick={(e) => pickLeague(e, m)}
                  data-testid={`league-switcher-pill-${m.slug}`}
                  data-active={selected ? 'true' : 'false'}
                  aria-pressed={selected}
                  className={`shrink-0 inline-flex items-center justify-center min-h-[36px] h-9 px-3 rounded-lg border-2 text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-all duration-150 active:scale-[0.96] no-underline ${
                    selected
                      ? 'bg-primary text-primary-foreground border-primary shadow-[var(--glow-primary-md)]'
                      : 'bg-surface text-fg-mid border-border-default hover:bg-surface-md hover:text-fg-high hover:border-primary/40'
                  }`}
                >
                  <span>{m.name}</span>
                  {showSpinner ? (
                    <span
                      aria-hidden="true"
                      data-testid={`league-switcher-pill-spinner-${m.slug}`}
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
