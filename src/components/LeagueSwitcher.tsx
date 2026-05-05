'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { useMemberships, type Membership } from './MembershipsProvider'

/**
 * Header league-switcher dropdown next to the brand title. Renders a small
 * chevron button when the user has 2+ league memberships; clicking opens a
 * menu that navigates to `/id/<slug>`.
 *
 * v1.59.0 — perf: memberships are now server-resolved in `app/layout.tsx`
 * via `getMembershipsForSession()` and passed through `<MembershipsProvider>`.
 * Pre-v1.59.0 the trigger was hidden until a post-mount `/api/me/memberships`
 * round-trip returned (~300ms-1s flash for multi-league users); the SSR
 * hydration eliminates that round-trip entirely. The trigger renders on
 * first paint with the correct visibility decision.
 *
 * The `useLeagueMemberships` hook is preserved as a public export for any
 * caller that wants on-demand refresh (none today); it now reads from
 * context with a `load()` no-op so existing call sites compile unchanged.
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

export default function LeagueSwitcher() {
  const memberships = useMemberships()
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Hide entirely for users without multiple memberships. SSR hydration
  // means this check is accurate on first render; no flash window.
  if (memberships.length < 2) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-0.5 text-fg-mid hover:text-fg-high transition-colors"
        aria-label="Switch league"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="league-switcher-trigger"
      >
        <ChevronDown className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 min-w-[200px] rounded-lg border border-border-default bg-card shadow-lg z-50 overflow-hidden"
          data-testid="league-switcher-menu"
        >
          <ul className="py-1">
            {memberships.map((m) => (
              <li key={m.leagueId}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    router.push(`/id/${m.slug}`)
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors hover:bg-card-hover ${
                    m.isCurrent ? 'text-vibrant-pink font-bold' : 'text-fg-high'
                  }`}
                  role="menuitem"
                  data-testid={`league-switcher-item-${m.slug}`}
                >
                  {m.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
