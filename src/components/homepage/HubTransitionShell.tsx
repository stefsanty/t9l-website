'use client'

import {
  createContext,
  useContext,
  useTransition,
  type ReactNode,
  type TransitionStartFunction,
} from 'react'

/**
 * v1.93.0 — client wrapper around `<MultiLeagueHub>` content. Owns a
 * single `useTransition` so the switcher can dispatch a navigation and
 * the rest of the hub can render a "still loading" affordance from the
 * same `isPending`. Without the shared context we'd either duplicate the
 * transition (state out of sync) or push everything that needs the
 * pending state into the same client component (forces Dashboard to be
 * client-only — far too heavy for what we need).
 *
 * UX choices:
 *   - Tap the new pill → `useOptimistic` swaps the active styling
 *     immediately (in `<LeagueSwitcherTabs>`).
 *   - The transition kicks off `router.push('/test?league=<id>')`. The
 *     destination's RSC payload is prefetched on hover thanks to
 *     `<Link prefetch>` on the pill, so the navigation typically
 *     completes inside the cache window.
 *   - While the transition is pending, this shell renders a 2 px
 *     top-edge progress strip (CSS-only `hub-progress` keyframe). It's
 *     positioned `fixed top-0` so it sits above the sticky Header
 *     (`z-[60]` clears the header's `z-50`). The strip alone is
 *     intentional — we don't dim the dashboard content because on a
 *     warm prefetch the swap is fast enough that an opacity dip would
 *     just feel like a flash.
 *
 * Children render through verbatim. The shell never reads or writes to
 * Dashboard — it only contributes the overlay + the context.
 */

interface HubTransitionValue {
  isPending: boolean
  startNavigation: TransitionStartFunction
}

const HubTransitionCtx = createContext<HubTransitionValue>({
  isPending: false,
  // Default no-op fallback for any consumer rendered outside the shell
  // (e.g. unit tests that mount LeagueSwitcherTabs in isolation).
  startNavigation: ((cb: () => void) => cb()) as TransitionStartFunction,
})

export function useHubTransition(): HubTransitionValue {
  return useContext(HubTransitionCtx)
}

export default function HubTransitionShell({
  children,
}: {
  children: ReactNode
}) {
  const [isPending, startNavigation] = useTransition()

  return (
    <HubTransitionCtx.Provider value={{ isPending, startNavigation }}>
      {isPending ? (
        <div
          aria-hidden="true"
          data-testid="hub-transition-progress"
          className="fixed top-0 left-0 right-0 h-0.5 z-[60] pointer-events-none overflow-hidden"
        >
          <div className="h-full w-1/3 bg-primary opacity-80 animate-hub-progress" />
        </div>
      ) : null}
      {children}
    </HubTransitionCtx.Provider>
  )
}
