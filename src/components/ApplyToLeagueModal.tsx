'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { applyToLeague } from '@/app/api/recruiting/actions'

/**
 * v1.64.0 — Application form modal.
 *
 * Reuses the field shape from `OnboardingForm` (name + position) without
 * re-routing through `/join/[code]/onboarding` — applications don't have
 * an invite code, so the redemption flow doesn't apply. Submission calls
 * `applyToLeague` server action which creates a Player with
 * `applicationStatus = PENDING` bound to the calling User.
 *
 * Modal contract (mirrors `SignInLightbox.tsx` / `SubmitGoalModal`):
 *   - `createPortal` to escape parent stacking context.
 *   - ESC + backdrop click + X button + Cancel all dismiss.
 *   - Body scroll locked while open.
 *   - `role="dialog"` + `aria-modal="true"` for screen readers.
 *
 * Post-submit:
 *   - On success: closes modal, refreshes the route (so the
 *     RecruitingBanner re-fetches viewer state and shows the
 *     "your application is being reviewed" surface), fires
 *     `useSession().update()` so the JWT picks up the new playerId.
 *   - On failure: surfaces the error inline; modal stays open.
 */

const POSITIONS: ReadonlyArray<{ value: '' | 'GK' | 'DF' | 'MF' | 'FW'; label: string }> = [
  { value: '', label: 'Prefer not to say' },
  { value: 'GK', label: 'GK — Goalkeeper' },
  { value: 'DF', label: 'DF — Defender' },
  { value: 'MF', label: 'MF — Midfielder' },
  { value: 'FW', label: 'FW — Forward' },
]

interface Props {
  open: boolean
  onClose: () => void
  leagueId: string
  leagueName: string
  // v1.65.1 — `'fresh'` is the State C path (no Player yet; full intake
  // form with name + position). `'existing'` is the State D path (user
  // already has a Player; only collect position for the new league —
  // the existing Player's name carries through).
  mode?: 'fresh' | 'existing'
}

export default function ApplyToLeagueModal({
  open,
  onClose,
  leagueId,
  leagueName,
  mode = 'fresh',
}: Props) {
  const [name, setName] = useState('')
  const [position, setPosition] = useState<'' | 'GK' | 'DF' | 'MF' | 'FW'>('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const { update } = useSession()

  useEffect(() => setMounted(true), [])

  // Body scroll lock + ESC dismiss.
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
      const result = await applyToLeague({
        leagueId,
        // For State D ('existing'), the existing Player's name is
        // unchanged; we send empty string and the action ignores it.
        name: mode === 'existing' ? '' : name.trim(),
        position: position === '' ? null : position,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      // Success — refresh JWT and route so banner re-renders as 'pending_this'.
      try {
        await update()
      } catch {
        /* swallow — refresh below covers the data path */
      }
      router.refresh()
      onClose()
    })
  }

  if (!open || !mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-5"
      role="dialog"
      aria-modal="true"
      aria-label={`Apply to ${leagueName}`}
      data-testid="apply-modal"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
        data-testid="apply-modal-backdrop"
      />
      <div className="relative w-full max-w-sm mx-auto bg-card border border-border-default rounded-3xl overflow-hidden shadow-2xl">
        <div className="px-6 pt-5 pb-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid">
                Apply to
              </p>
              <h2 className="font-display text-2xl font-black uppercase tracking-tight text-fg-high leading-tight">
                {leagueName}
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
            {mode === 'existing'
              ? `You already have a player profile. Just tell us your position for ${leagueName} — the admin will review and add you to a team.`
              : 'Tell us a bit about yourself. The league admin will review your application.'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4" data-testid="apply-form">
            {mode === 'fresh' && (
              <label className="block">
                <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
                  Name <span className="text-vibrant-pink">*</span>
                </span>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. Stefan S"
                  className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
                  data-testid="apply-name"
                />
              </label>
            )}

            <label className="block">
              <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
                Position
              </span>
              <select
                value={position}
                onChange={(e) => setPosition(e.target.value as typeof position)}
                className="w-full bg-background border border-border-default rounded-lg px-3 py-2 text-sm text-fg-high"
                data-testid="apply-position"
              >
                {POSITIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            {error && (
              <p className="text-sm text-vibrant-pink" role="alert" data-testid="apply-error">
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
                disabled={pending || (mode === 'fresh' && !name.trim())}
                className="flex-1 rounded-lg bg-primary text-on-primary px-4 py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity"
                data-testid="apply-submit"
              >
                {pending ? 'Submitting…' : 'Submit application'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body,
  )
}
