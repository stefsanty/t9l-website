'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { applyToLeague } from '@/app/api/recruiting/actions'
import PositionMultiSelect from './PositionMultiSelect'
import type { BallType } from '@/lib/positions'

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
  /**
   * v1.82.0 — league format. Drives the position chip vocabulary
   * (SOCCER → 12 codes, FUTSAL → GK/FIXO/ALA/PIVOT). Optional;
   * defaults to SOCCER for callers that haven't been updated.
   */
  ballType?: BallType | null
}

export default function ApplyToLeagueModal({
  open,
  onClose,
  leagueId,
  leagueName,
  mode = 'fresh',
  ballType = null,
}: Props) {
  const [name, setName] = useState('')
  const [positions, setPositions] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [mounted, setMounted] = useState(false)
  // v1.81.0 — capture the originating page path so the server action can
  // redirect to `<originPath>?submitted=applyToLeague` and the popup
  // mounts on the page the user came from. Captured at mount time
  // (before any potential URL changes) so the value is stable for the
  // life of the modal.
  const [originPath, setOriginPath] = useState<string | null>(null)

  useEffect(() => {
    setMounted(true)
    if (typeof window !== 'undefined') {
      setOriginPath(window.location.pathname + window.location.search)
    }
  }, [])

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
      try {
        // v1.81.0 — server-side redirect handles success navigation.
        // `redirect()` throws NEXT_REDIRECT which the Next.js framework
        // catches and converts to a navigation; the resolved-result
        // branch only fires on validation / authz failures.
        const result = await applyToLeague({
          leagueId,
          // For State D ('existing'), the existing Player's name is
          // unchanged; we send empty string and the action ignores it.
          name: mode === 'existing' ? '' : name.trim(),
          positions,
          originPath,
        })
        if (result && !result.ok) {
          setError(result.error)
        }
      } catch (err) {
        // Re-throw the Next.js redirect (recognised by the `digest` field
        // starting with NEXT_REDIRECT) so the framework can apply the
        // navigation. Any other thrown error gets surfaced inline.
        if (err && typeof err === 'object' && 'digest' in err) throw err
        setError(err instanceof Error ? err.message : 'Submit failed')
      }
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

            <div className="block">
              <span className="block text-fg-mid text-xs uppercase tracking-widest font-bold mb-1.5">
                Position(s)
              </span>
              <PositionMultiSelect
                selected={positions}
                onChange={setPositions}
                ballType={ballType}
                disabled={pending}
                testIdPrefix="apply-position"
              />
              <span className="block text-fg-low text-xs mt-1.5">
                Tap to pick one or more. You can leave this blank.
              </span>
            </div>

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
