'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { submitOwnMatchEvent } from '@/app/matchday/[id]/actions'
import type { Matchday, Player, Team } from '@/types'

type GoalType = 'OPEN_PLAY' | 'SET_PIECE' | 'PENALTY' | 'OWN_GOAL'

/**
 * v1.46.0 (epic match events PR ζ) — submission form for goals.
 *
 * v1.47.0 — UI shape inverted from "inline expand" to "big CTA + modal
 * overlay". The CTA is a prominent full-width button rendered in place;
 * clicking it opens a centered modal (createPortal, ESC + backdrop close,
 * `role="dialog"` + `aria-modal`, body scroll locked while open).
 *
 * v1.48.0 — open attribution: ANY logged-in linked player can submit a
 * goal for ANY player. Scorer is now a dropdown sourced from the matchday's
 * participating-team rosters (not locked to the calling user). Color flips
 * from pink to LINE green (#06C755) per the user's product brief — the CTA
 * now lives on the homepage Dashboard too, so the visual delineation from
 * the surrounding pink-magenta brand chrome makes it easier to find.
 */
export default function SubmitGoalForm({
  matchday,
  matches,
  players,
  teams,
}: {
  matchday: Matchday
  /** All matches in the selected matchday (we no longer filter to user's team). */
  matches: Array<{
    id: string
    homeTeamId: string
    awayTeamId: string
    homeTeamName: string
    awayTeamName: string
  }>
  /** All players in the league — drives the scorer + assister dropdowns. */
  players: Player[]
  /** All teams in the league — used to label the scorer dropdown groups. */
  teams: Team[]
}) {
  const [open, setOpen] = useState(false)
  const [success, setSuccess] = useState(false)

  if (matches.length === 0) return null

  return (
    <div className="mt-4 mb-6" data-testid="submit-goal-section">
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setSuccess(false)
        }}
        className="w-full bg-[#06C755] hover:bg-[#05b34c] active:scale-95 text-white text-base font-black uppercase tracking-wider px-4 py-4 rounded-2xl shadow-[0_4px_12px_rgba(6,199,85,0.25)] transition-all"
        data-testid="submit-goal-cta"
      >
        ⚽️ Submit a goal
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
          matches={matches}
          players={players}
          teams={teams}
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
 *
 * v1.48.0 — scorer dropdown added. Picking a match restricts the scorer
 * options to the two participating teams; picking a scorer restricts the
 * assister options to the scorer's team minus the scorer.
 */
function SubmitGoalModal({
  matchday,
  matches,
  players,
  teams,
  onClose,
  onSuccess,
}: {
  matchday: Matchday
  matches: Array<{
    id: string
    homeTeamId: string
    awayTeamId: string
    homeTeamName: string
    awayTeamName: string
  }>
  players: Player[]
  teams: Team[]
  onClose: () => void
  onSuccess: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [matchPublicId, setMatchPublicId] = useState(matches[0]?.id ?? '')
  const [scorerSlug, setScorerSlug] = useState('')
  const [goalType, setGoalType] = useState<GoalType>('OPEN_PLAY')
  const [assisterSlug, setAssisterSlug] = useState('')
  const [minute, setMinute] = useState('')

  const [mounted, setMounted] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // Selected match — drives scorer dropdown grouping (only the two
  // participating teams' rosters).
  const selectedMatch = useMemo(
    () => matches.find((m) => m.id === matchPublicId) ?? matches[0],
    [matches, matchPublicId],
  )

  const teamLookup = useMemo(() => {
    const map = new Map<string, Team>()
    for (const t of teams) map.set(t.id, t)
    return map
  }, [teams])

  // Scorer options grouped by participating team.
  const scorerGroups = useMemo(() => {
    if (!selectedMatch) return []
    return [selectedMatch.homeTeamId, selectedMatch.awayTeamId].map((teamId) => {
      const team = teamLookup.get(teamId)
      const teamPlayers = players
        .filter((p) => p.teamId === teamId)
        .sort((a, b) => a.name.localeCompare(b.name))
      return {
        teamId,
        teamName: team?.name ?? teamId,
        players: teamPlayers,
      }
    })
  }, [selectedMatch, players, teamLookup])

  // Resolve the scorer's team — drives the assister dropdown.
  const scorerPlayer = useMemo(
    () => players.find((p) => p.id === scorerSlug) ?? null,
    [players, scorerSlug],
  )
  const assisterCandidates = useMemo(() => {
    if (!scorerPlayer) return []
    return players
      .filter((p) => p.teamId === scorerPlayer.teamId && p.id !== scorerPlayer.id)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [players, scorerPlayer])

  // Reset dependent fields when the match changes — the participating
  // team set differs, so the previous scorer may no longer be eligible.
  // (Done in the change handler rather than a setState-in-useEffect to
  // avoid the cascading-render lint rule from react-hooks v5.)
  function changeMatch(id: string) {
    setMatchPublicId(id)
    setScorerSlug('')
    setAssisterSlug('')
  }

  function changeScorer(id: string) {
    setScorerSlug(id)
    setAssisterSlug('')
  }

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
    if (!scorerSlug) {
      setError('Pick a scorer.')
      return
    }
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
          scorerPlayerSlug: scorerSlug,
          goalType,
          assisterPlayerSlug: assisterSlug || null,
          minute: minuteValue,
        })
        // Reset form state for a possible second submission.
        setScorerSlug('')
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

  void matchday // matchday is reserved for future per-matchday narrative

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
        aria-label="Submit a goal"
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
            onChange={(e) => changeMatch(e.target.value)}
            className="mt-1 w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-fg-high"
          >
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.homeTeamName} vs {m.awayTeamName}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-fg-low text-[10px] uppercase tracking-widest">Scorer</span>
          <select
            data-testid="submit-goal-scorer"
            value={scorerSlug}
            onChange={(e) => changeScorer(e.target.value)}
            className="mt-1 w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-fg-high"
          >
            <option value="">— pick a scorer —</option>
            {scorerGroups.map((g) => (
              <optgroup key={g.teamId} label={g.teamName}>
                {g.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
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
            <option value="OWN_GOAL">Own goal</option>
          </select>
        </label>

        <label className="block">
          <span className="text-fg-low text-[10px] uppercase tracking-widest">Assister (optional)</span>
          <select
            data-testid="submit-goal-assister"
            value={assisterSlug}
            onChange={(e) => setAssisterSlug(e.target.value)}
            disabled={!scorerSlug}
            className="mt-1 w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-fg-high disabled:opacity-50"
          >
            <option value="">— no assist —</option>
            {assisterCandidates.map((p) => (
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
            disabled={pending || !scorerSlug}
            onClick={submit}
            className="bg-[#06C755] hover:bg-[#05b34c] text-white text-sm font-black uppercase tracking-wider px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
          >
            {pending ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
