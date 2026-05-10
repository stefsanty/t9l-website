'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { setMatchdayGuestEntry } from '@/app/api/guests/actions'

/**
 * v1.91.0 — Add Guests modal.
 *
 * Two integer inputs, one upsert. Mirrors the modal contract used by
 * `ApplyToLeagueModal` and `SignInLightbox` — portal, ESC dismiss,
 * backdrop click dismiss, body-scroll-lock while open, role=dialog.
 *
 * Initial values are the existing per-(matchday, team) counts so the
 * user can edit. Submit calls `setMatchdayGuestEntry` and closes on
 * success; failures surface inline. After a successful upsert the
 * server action revalidates the public domain, so a `router.refresh()`
 * is unnecessary — but we still call it because Next 16's RSC
 * cache-bust path doesn't always re-fetch the page on a same-route
 * action without an explicit refresh.
 */

interface Props {
  open: boolean
  onClose: () => void
  leagueSlug: string
  matchdayPublicId: string
  teamPublicId: string
  teamName: string
  matchdayLabel: string
  initialExternalCount: number
  initialLeagueCount: number
}

const MAX_PER_FIELD = 50

function clampInt(raw: string, max: number): number {
  if (raw === '') return 0
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, max)
}

export default function AddGuestsModal({
  open,
  onClose,
  leagueSlug,
  matchdayPublicId,
  teamPublicId,
  teamName,
  matchdayLabel,
  initialExternalCount,
  initialLeagueCount,
}: Props) {
  const router = useRouter()
  const [externalCount, setExternalCount] = useState<number>(initialExternalCount)
  const [leagueCount, setLeagueCount] = useState<number>(initialLeagueCount)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Re-sync on re-open — whichever entry exists at click time.
  useEffect(() => {
    if (!open) return
    setExternalCount(initialExternalCount)
    setLeagueCount(initialLeagueCount)
    setError(null)
  }, [open, initialExternalCount, initialLeagueCount])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await setMatchdayGuestEntry({
          leagueSlug,
          matchdayPublicId,
          teamPublicId,
          externalCount,
          leagueCount,
        })
        router.refresh()
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Submit failed')
      }
    })
  }

  if (!open || !mounted) return null

  const totalGuests = externalCount + leagueCount

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-label={`Add guests for ${teamName}`}
      data-testid="add-guests-modal"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        data-testid="add-guests-modal-backdrop"
      />
      <div className="relative w-full max-w-sm mx-auto bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl">
        <div className="px-6 pt-5 pb-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid">
                {matchdayLabel} · Add guests
              </p>
              <h2 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high leading-tight" translate="no">
                {teamName}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full text-fg-mid hover:text-fg-high hover:bg-surface transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-sm text-fg-mid mb-4 leading-relaxed">
            Record how many guests will join this team for the matchday. Guests bump the going count and slot into the formation.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4" data-testid="add-guests-form">
            <label className="block">
              <span className="block text-fg-high text-xs uppercase tracking-widest font-bold mb-1">
                External guests
              </span>
              <span className="block text-fg-low text-xs mb-1.5">
                Friends, colleagues — anyone not on T9L.
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_PER_FIELD}
                step={1}
                value={externalCount}
                onChange={(e) => setExternalCount(clampInt(e.target.value, MAX_PER_FIELD))}
                disabled={pending}
                className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-base text-fg-high"
                data-testid="add-guests-external"
              />
            </label>

            <label className="block">
              <span className="block text-fg-high text-xs uppercase tracking-widest font-bold mb-1">
                League guests
              </span>
              <span className="block text-fg-low text-xs mb-1.5">
                T9L players from another team filling in for this match.
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_PER_FIELD}
                step={1}
                value={leagueCount}
                onChange={(e) => setLeagueCount(clampInt(e.target.value, MAX_PER_FIELD))}
                disabled={pending}
                className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-base text-fg-high"
                data-testid="add-guests-league"
              />
            </label>

            <div className="flex items-center justify-between text-xs text-fg-mid bg-surface rounded-lg px-3 py-2">
              <span className="uppercase tracking-widest font-bold">Total guests</span>
              <span className="font-black text-fg-high text-base" data-testid="add-guests-total">{totalGuests}</span>
            </div>

            {error && (
              <p className="text-sm text-vibrant-pink" role="alert" data-testid="add-guests-error">
                {error}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="flex-1 rounded-lg border border-border-default px-4 py-2.5 text-sm font-bold text-fg-mid hover:text-fg-high transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="flex-1 rounded-lg bg-primary text-on-primary px-4 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
                data-testid="add-guests-submit"
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  )
}
