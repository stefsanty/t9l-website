'use client'

import { useState, useTransition } from 'react'
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
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [matchPublicId, setMatchPublicId] = useState(
    participatingMatches[0]?.id ?? '',
  )
  const [goalType, setGoalType] = useState<GoalType>('OPEN_PLAY')
  const [assisterSlug, setAssisterSlug] = useState('')
  const [minute, setMinute] = useState('')

  if (participatingMatches.length === 0) return null

  function submit() {
    setError(null)
    const minuteValue = minute.trim() === '' ? null : parseInt(minute, 10)
    if (minuteValue !== null && (Number.isNaN(minuteValue) || minuteValue < 0 || minuteValue > 200)) {
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
        setSuccess(true)
        setOpen(false)
        // Reset form for a possible second submission.
        setGoalType('OPEN_PLAY')
        setAssisterSlug('')
        setMinute('')
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Submission failed')
      }
    })
  }

  if (!open) {
    return (
      <div className="mt-6 text-center" data-testid="submit-goal-section">
        {success ? (
          <p className="text-fg-mid text-xs uppercase tracking-widest mb-3" data-testid="submit-goal-success">
            ✅ Submitted. Add another?
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            setSuccess(false)
          }}
          className="bg-vibrant-pink text-white text-sm font-bold uppercase tracking-widest px-4 py-2 rounded-lg"
          data-testid="submit-goal-cta"
        >
          + Submit a goal you scored
        </button>
        <p className="text-fg-low text-[10px] mt-2 max-w-xs mx-auto">
          Auto-approved. Admin can edit / delete via the Stats tab.
        </p>
        {void matchday}
      </div>
    )
  }

  return (
    <div
      className="mt-6 rounded-lg border border-border-default bg-bg-elevated p-4 space-y-3"
      data-testid="submit-goal-form"
      role="region"
      aria-label="Submit a goal"
    >
      <h3 className="text-fg-high font-bold text-sm">Submit a goal you scored</h3>

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
          <option value="OWN_GOAL">Own goal (yes, you scored against your own team)</option>
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
        {void myTeamId}
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

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-fg-mid text-sm px-3 py-1.5"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="submit-goal-submit"
          disabled={pending}
          onClick={submit}
          className="bg-vibrant-pink text-white text-sm font-bold px-4 py-1.5 rounded disabled:opacity-50"
        >
          {pending ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
