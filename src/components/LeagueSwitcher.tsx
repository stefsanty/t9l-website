'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ChevronDown } from 'lucide-react'

/**
 * v1.52.0 (PR 3 of the path-routing chain) — header league-switcher
 * dropdown next to the brand title. Mounts as a small chevron button
 * adjacent to the T9L logo; on click, fetches `/api/me/memberships`
 * and shows the user's leagues. Click a league → `router.push('/<slug>')`.
 *
 * Visibility rules:
 *   - Hidden when the user has < 2 memberships (no need to switch).
 *   - Hidden for admin-credentials sessions and for unauthenticated
 *     users (no memberships).
 *   - The dropdown body lazy-loads on first open so the API round-trip
 *     doesn't fire on every page render.
 *
 * The same memberships list also surfaces inside the account dropdown
 * (`LineLoginButton`) via the shared `useLeagueMemberships` hook.
 *
 * Accessibility:
 *   - `role="button"` on the trigger; `role="menu"` on the dropdown.
 *   - Outside-click + Escape close.
 */

export interface Membership {
  leagueId: string
  name: string
  slug: string
  isCurrent: boolean
}

export function useLeagueMemberships(): {
  memberships: Membership[]
  loading: boolean
  load: () => Promise<void>
} {
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [loading, setLoading] = useState(false)
  const loadedRef = useRef(false)

  async function load() {
    if (loadedRef.current) return
    loadedRef.current = true
    setLoading(true)
    try {
      const res = await fetch('/api/me/memberships', { cache: 'no-store' })
      if (!res.ok) {
        setMemberships([])
        return
      }
      const data = (await res.json()) as { memberships?: Membership[] }
      setMemberships(Array.isArray(data.memberships) ? data.memberships : [])
    } catch {
      setMemberships([])
    } finally {
      setLoading(false)
    }
  }

  return { memberships, loading, load }
}

export default function LeagueSwitcher() {
  const { data: session, status } = useSession()
  const { memberships, loading, load } = useLeagueMemberships()
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Lazy load on first open — keeps the page-render path lean.
  useEffect(() => {
    if (open) {
      void load()
    }
  }, [open, load])

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

  // Hide entirely for unauthenticated / admin-only / single-league sessions.
  // The session.userId nullness is the canonical signal for "not a real
  // player session" in stage α.5+. Pre-load memberships once on session
  // hydration so the visibility check is accurate without forcing a fetch
  // on every render.
  const hasSession = status === 'authenticated' && !!session?.userId
  // We surface the dropdown trigger only when the user has 2+ memberships.
  // To avoid flashing the trigger and then hiding it, only render after
  // the lazy load has run at least once. Until then, render nothing.
  if (!hasSession) return null
  if (memberships.length < 2 && !loading) {
    // First-render shape: kick off the load opportunistically so the
    // visibility check resolves on the next tick. Suppress the trigger
    // until we know the membership count.
    if (!open) {
      // schedule load on next paint
      void load()
    }
    return null
  }

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
          {loading ? (
            <div className="px-3 py-2 text-xs text-fg-mid">Loading…</div>
          ) : (
            <ul className="py-1">
              {memberships.map((m) => (
                <li key={m.leagueId}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false)
                      router.push(`/league/${m.slug}`)
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
          )}
        </div>
      )}
    </div>
  )
}
