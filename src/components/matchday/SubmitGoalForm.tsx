'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { submitOwnMatchEvent } from '@/app/matchday/[id]/actions'
import type { Matchday, Player } from '@/types'

type GoalType = 'OPEN_PLAY' | 'SET_PIECE' | 'PENALTY' | 'OWN_GOAL'

/**
 * v1.46.0 (epic match events PR ζ) — player-side submission form on the
 * per-matchday page. Scorer is locked to the session's playerId; the
 * matches dropdown lists matches in this matchday where the player's
 * team participates; assister picker shows the player's team minus
 * themselves; minute is optional.
 *
 * v1.47.0 — UI shape inverted from "inline expand" to "big CTA + modal
 * overlay". The CTA is a prominent full-width button rendered in place;
 * clicking it opens a centered modal (createPortal, ESC + backdrop close,
 * `role="dialog"` + `aria-modal`, body scroll locked while open). The
 * actual form body is unchanged — only the wrapper changed.
 */
export default function SubmitGoalForm({
  matchday,
  participatingMatches,
  teammates,
  myTeamId,
}: {
  matchday: Matchday
  /** Matches in this matchday where the user's team is playing. */
  participatingMatches: Array<{
    id: string
    homeTeamId: string
    awayTeamId: string
    homeTeamName: string
    awayTeamName: string
  }>
  /** Player's teammates (excluding the user) for the assister picker. */
  teammates: Player[]
  myTeamId: string
}) {
  const [open, setOpen] = useState(false)
  const [success, setSuccess] = useState(false)

  if (participatingMatches.length === 0) return null

  return (
    <div className="mt-4 mb-6" data-testid="submit-goal-section">
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setSuccess(false)
        }}
        className="w-full bg-vibrant-pink text-white text-base font-black uppercase tracking-wider px-4 py-4 rounded-2xl shadow-lg active:scale-95 transition-transform"
        data-testid="submit-goal-cta"
      >
        ⚽️ Submit a goal you scored
      </button>
      {success ? (
        <p
          className="text-fg-mid text-center text-[11px] font-black uppercase tracking-widest mt-2"
          data-testid="submit-goal-success"
        >
          ✅ Submitted. Tap again to add another.
        </p>
      ) : (
        <p className="text-fg-low text-[10px] mt-2 text-center max-w-xs mx-auto">
          Auto-approved. Admin can edit / delete via the Stats tab.
        </p>
      )}

      {open ? (
        <SubmitGoalModal
          matchday={matchday}
          participatingMatches={participatingMatches}
          teammates={teammates}
          myTeamId={myTeamId}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            setSuccess(true)
            setOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * v1.47.0 — modal overlay for the goal submission form. Owns the form state,
 * server-action call, and dismissal wiring (ESC, backdrop, X button, Cancel,
 * post-success). The CTA above is the only mount point.
 */
function SubmitGoalModal({
  matchday,
  participatingMatches,
  teammates,
  myTeamId,
  onClose,
  onSuccess,
}: {
  matchday: Matchday
  participatingMatches: Array<{
    id: string
    homeTeamId: string
    awayTeamId: string
    homeTeamName: string
    awayTeamName: string
  }>
  teammates: Player[]
  myTeamId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [matchPublicId, setMatchPublicId] = useState(
    participatingMatches[0]?.id ?? '',
  )
  const [goalType, setGoalType] = useState<GoalType>('OPEN_PLAY')
  const [assisterSlug, setAssisterSlug] = useState('')
  const [minute, setMinute] = useState('')

  const [mounted, setMounted] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // Portal target lives on document.body; only mount on client.
  useEffect(() => {
    setMounted(true)
  }, [])

  // ESC closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, pending])

  function submit() {
    setError(null)
    const minuteValue = minute.trim() === '' ? null : parseInt(minute, 10)
    if (
      minuteValue !== null &&
      (Number.isNaN(minuteValue) || minuteValue < 0 || minuteValue > 200)
    ) {
      setError('Minute must be 0–200, or empty.')
      return
    }
    startTransition(async () => {
      try {
        await submitOwnMatchEvent({
          matchPublicId,
          goalType,
          assisterPlayerSlug: assisterSlug || null,
          minute: minuteValue,
        })
        // Reset form state for a possible second submission.
        setGoalType('OPEN_PLAY')
        setAssisterSlug('')
        setMinute('')
        router.refresh()
        onSuccess()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Submission failed')
      }
    })
  }

  if (!mounted) return null

  // void matchday + myTeamId — both are reserved for future per-matchday
  // narrative / cross-team validation; intentionally not removed so the
  // function signature stays stable for callers and tests.
  void matchday
  void myTeamId

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-4"
      onClick={() => {
        if (!pending) onClose()
      }}
      data-testid="submit-goal-modal-backdrop"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Submit a goal you scored"
        className="bg-card border border-border-default rounded-3xl w-full max-w-sm p-5 space-y-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="submit-goal-form"
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-fg-high font-display text-xl font-black uppercase tracking-tight">
            Submit a goal
          </h3>
          <button
            type="button"
            onClick={() => {
              if (!pending) onClose()
            }}
            disabled={pending}
            className="text-fg-mid hover:text-fg-high text-2xl leading-none px-1 disabled:opacity-40"
            aria-label="Close"
            data-testid="submit-goal-close"
          >
            ×
          </button>
        </div>

        <label className="block">
          <span className="text-fg-low text-[10px] uppercase tracking-widest">Match</span>
          <select
            data-testid="submit-goal-match"
            value={matchPublicId}
            onChange={(e) => setMatchPublicId(e.target.value)}
            className="mt-1 w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-fg-high"
          >
            {participatingMatches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.homeTeamName} vs {m.awayTeamName}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-fg-low text-[10px] uppercase tracking-widest">Goal type</span>
          <select
            data-testid="submit-goal-type"
            value={goalType}
            onChange={(e) => setGoalType(e.target.value as GoalType)}
            className="mt-1 w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-fg-high"
          >
            <option value="OPEN_PLAY">Open play</option>
            <option value="SET_PIECE">Set piece</option>
            <option value="PENALTY">Penalty</option>
            <option value="OWN_GOAL">Own goal (you scored against your own team)</option>
          </select>
        </label>

        <label className="block">
          <span className="text-fg-low text-[10px] uppercase tracking-widest">Assister (optional)</span>
          <select
            data-testid="submit-goal-assister"
            value={assisterSlug}
            onChange={(e) => setAssisterSlug(e.target.value)}
            className="mt-1 w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-fg-high"
          >
            <option value="">— no assist —</option>
            {teammates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-fg-low text-[10px] uppercase tracking-widest">Minute (optional)</span>
          <input
            data-testid="submit-goal-minute"
            type="number"
            min="0"
            max="200"
            value={minute}
            onChange={(e) => setMinute(e.target.value)}
            className="mt-1 w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-fg-high"
          />
        </label>

        {error ? (
          <p data-testid="submit-goal-error" className="text-red-500 text-sm">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              if (!pending) onClose()
            }}
            disabled={pending}
            className="text-fg-mid text-sm px-3 py-2 disabled:opacity-40"
            data-testid="submit-goal-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="submit-goal-submit"
            disabled={pending}
            onClick={submit}
            className="bg-vibrant-pink text-white text-sm font-black uppercase tracking-wider px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {pending ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
