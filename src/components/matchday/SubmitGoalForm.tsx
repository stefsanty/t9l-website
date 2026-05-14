'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { submitOwnMatchEvent } from '@/app/matchday/[id]/actions'
import { groupPlayersByPrimaryTeam } from '@/lib/playerOrdering'
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
  leagueSlug,
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
  /**
   * v2.2.5 — current league slug (the `/id/<slug>/...` URL the form is
   * rendered under). Passed through to `submitOwnMatchEvent` so the
   * action scopes the match lookup to the right tenant.
   */
  leagueSlug: string
}) {
  const [open, setOpen] = useState(false)

  // v1.48.1 — singleton CTA across matchday swipes. The Dashboard no longer
  // remounts this component on `selectedMatchday.id` change (the prior
  // `key={selectedMatchday.id}` is gone), so we have to reset the open
  // state ourselves when the matchday context changes: a previously-open
  // modal tied to MD2 must not linger after the user swipes to MD3.
  useEffect(() => {
    setOpen(false)
  }, [matchday.id])

  if (matches.length === 0) return null

  return (
    <div className="mt-4 mb-6" data-testid="submit-goal-section">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full bg-[#067E37] hover:bg-[#056630] active:scale-95 text-white text-base font-black uppercase tracking-wider px-4 py-4 rounded-2xl shadow-[0_4px_12px_rgba(6,199,85,0.25)] [text-shadow:0_1px_2px_rgba(0,0,0,0.35)] transition-all"
        data-testid="submit-goal-cta"
      >
        ⚽️ Submit a goal
      </button>

      {open ? (
        <SubmitGoalModal
          matchday={matchday}
          matches={matches}
          players={players}
          teams={teams}
          leagueSlug={leagueSlug}
          onClose={() => setOpen(false)}
          onSuccess={() => setOpen(false)}
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
 *
 * v1.82.0 — cross-team scorers/assisters. Casual leagues let players guest
 * for other teams; the dropdown now lists every league player. Beneficiary
 * (or opposing-team for OG) players sort first; "Other players" follow.
 * Beneficiary team is now an explicit selector — pre-v1.82.0 it was
 * derived from the scorer's team, which breaks once cross-team scorers are
 * legal. Server validation loosens scorer/assister scope from "on a match
 * team" to "any active member of this league".
 */
function SubmitGoalModal({
  matchday,
  matches,
  players,
  teams,
  leagueSlug,
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
  leagueSlug: string
  onClose: () => void
  onSuccess: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [matchPublicId, setMatchPublicId] = useState(matches[0]?.id ?? '')
  const [beneficiaryTeamId, setBeneficiaryTeamId] = useState(
    matches[0]?.homeTeamId ?? '',
  )
  const [scorerSlug, setScorerSlug] = useState('')
  // v1.88.0 — guest-scorer / guest-assister toggles. When checked, the
  // picker is hidden and the event records isGuestScorer=true (or
  // isGuestAssister=true) with scorerSlug/assisterSlug omitted.
  const [isGuestScorer, setIsGuestScorer] = useState(false)
  const [isGuestAssister, setIsGuestAssister] = useState(false)
  const [goalType, setGoalType] = useState<GoalType>('OPEN_PLAY')
  const [assisterSlug, setAssisterSlug] = useState('')
  const [minute, setMinute] = useState('')

  // v1.48.1 — singleton CTA. The parent SubmitGoalForm no longer remounts
  // on matchday change, so the modal's `matchPublicId` may now reference a
  // match from the prior matchday. If the current selection is no longer
  // in the list, reset to the first match in the new matchday's list.
  useEffect(() => {
    if (!matches.find((m) => m.id === matchPublicId)) {
      const first = matches[0]
      setMatchPublicId(first?.id ?? '')
      setBeneficiaryTeamId(first?.homeTeamId ?? '')
      setScorerSlug('')
      setAssisterSlug('')
    }
  }, [matches, matchPublicId])

  const [mounted, setMounted] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // Selected match — drives the beneficiary picker bounds.
  const selectedMatch = useMemo(
    () => matches.find((m) => m.id === matchPublicId) ?? matches[0],
    [matches, matchPublicId],
  )

  const teamLookup = useMemo(() => {
    const map = new Map<string, Team>()
    for (const t of teams) map.set(t.id, t)
    return map
  }, [teams])

  // v1.82.0 — primary team for scorer ordering: beneficiary for non-OG,
  // opposing for OG (matches the existing admin convention — for an own
  // goal, the scorer is the player who put the ball in their own net,
  // typically a member of the team that CONCEDED the goal).
  const opposingTeamId = useMemo(() => {
    if (!selectedMatch) return ''
    return beneficiaryTeamId === selectedMatch.homeTeamId
      ? selectedMatch.awayTeamId
      : selectedMatch.homeTeamId
  }, [selectedMatch, beneficiaryTeamId])

  const scorerPrimaryTeamId = goalType === 'OWN_GOAL' ? opposingTeamId : beneficiaryTeamId

  // Scorer options: scorer-primary team first, then "Other players" from the
  // rest of the league. Cross-team scorers are explicitly allowed.
  const scorerGroups = useMemo(() => {
    if (!scorerPrimaryTeamId) return []
    const team = teamLookup.get(scorerPrimaryTeamId)
    return groupPlayersByPrimaryTeam(
      players,
      scorerPrimaryTeamId,
      team?.name ?? 'Beneficiary team',
    )
  }, [players, scorerPrimaryTeamId, teamLookup])

  const scorerPlayer = useMemo(
    () => players.find((p) => p.id === scorerSlug) ?? null,
    [players, scorerSlug],
  )

  // Assister options: beneficiary team first regardless of goal type
  // (assist credit attaches to the goal's beneficiary side, not the OG
  // scorer's team), then "Other players". Excludes the scorer.
  const assisterGroups = useMemo(() => {
    if (!beneficiaryTeamId) return []
    const team = teamLookup.get(beneficiaryTeamId)
    const exclude = scorerSlug ? new Set([scorerSlug]) : undefined
    return groupPlayersByPrimaryTeam(
      players,
      beneficiaryTeamId,
      team?.name ?? 'Beneficiary team',
      'Other players',
      exclude,
    )
  }, [players, beneficiaryTeamId, scorerSlug, teamLookup])

  // v1.82.0 — guest hint surfaces when the selected scorer/assister is
  // not on the team we sorted to the top. Lets the submitter sanity-check
  // attribution at a glance.
  const scorerTeamLabel = useMemo(() => {
    if (!scorerPlayer) return null
    if (scorerPlayer.teamId === scorerPrimaryTeamId) return null
    return teamLookup.get(scorerPlayer.teamId)?.name ?? null
  }, [scorerPlayer, scorerPrimaryTeamId, teamLookup])

  const assisterPlayer = useMemo(
    () => players.find((p) => p.id === assisterSlug) ?? null,
    [players, assisterSlug],
  )
  const assisterTeamLabel = useMemo(() => {
    if (!assisterPlayer) return null
    if (assisterPlayer.teamId === beneficiaryTeamId) return null
    return teamLookup.get(assisterPlayer.teamId)?.name ?? null
  }, [assisterPlayer, beneficiaryTeamId, teamLookup])

  // Reset dependent fields when the match changes — different match teams
  // mean the beneficiary selection no longer applies. (Done in the change
  // handler rather than a setState-in-useEffect to avoid the cascading-
  // render lint rule from react-hooks v5.)
  function changeMatch(id: string) {
    const next = matches.find((m) => m.id === id)
    setMatchPublicId(id)
    setBeneficiaryTeamId(next?.homeTeamId ?? '')
    setScorerSlug('')
    setAssisterSlug('')
  }

  function changeBeneficiary(id: string) {
    setBeneficiaryTeamId(id)
    setScorerSlug('')
    setAssisterSlug('')
  }

  function changeGoalType(t: GoalType) {
    setGoalType(t)
    // For OG ↔ non-OG, the scorer's primary team flips; the previously
    // selected scorer may now be in the "Other players" group. Reset to
    // avoid a stale pick that doesn't match the user's mental model.
    setScorerSlug('')
    setAssisterSlug('')
  }

  function changeScorer(id: string) {
    setScorerSlug(id)
    setAssisterSlug('')
  }

  // v1.88.0 — toggling the guest-scorer flag clears the picker (and
  // vice-versa); same for assister.
  function toggleGuestScorer(checked: boolean) {
    setIsGuestScorer(checked)
    if (checked) setScorerSlug('')
  }

  function toggleGuestAssister(checked: boolean) {
    setIsGuestAssister(checked)
    if (checked) setAssisterSlug('')
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
    if (!isGuestScorer && !scorerSlug) {
      setError('Pick a scorer (or check "Scored by guest").')
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
    if (!beneficiaryTeamId) {
      setError('Pick the team this goal counts for.')
      return
    }
    startTransition(async () => {
      try {
        await submitOwnMatchEvent({
          matchPublicId,
          leagueSlug,
          beneficiaryTeamId,
          scorerPlayerSlug: isGuestScorer ? null : scorerSlug,
          isGuestScorer,
          goalType,
          assisterPlayerSlug: isGuestAssister ? null : (assisterSlug || null),
          isGuestAssister,
          minute: minuteValue,
        })
        // Reset form state for a possible second submission.
        setScorerSlug('')
        setIsGuestScorer(false)
        setGoalType('OPEN_PLAY')
        setAssisterSlug('')
        setIsGuestAssister(false)
        setMinute('')
        router.refresh()
        onSuccess()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Submission failed')
      }
    })
  }

  if (!mounted) return null

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
          <div className="flex flex-col gap-0.5">
            <span className="text-fg-low text-[10px] uppercase tracking-widest">
              Submit a goal for
            </span>
            <h3
              className="text-fg-high font-display text-2xl font-black uppercase tracking-tight"
              data-testid="submit-goal-modal-matchday-label"
            >
              {matchday.label}
            </h3>
          </div>
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

        {selectedMatch ? (
          <label className="block">
            <span className="text-fg-low text-[10px] uppercase tracking-widest">
              Goal counts for
            </span>
            <select
              data-testid="submit-goal-beneficiary"
              value={beneficiaryTeamId}
              onChange={(e) => changeBeneficiary(e.target.value)}
              className="mt-1 w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-fg-high"
            >
              <option value={selectedMatch.homeTeamId}>
                {selectedMatch.homeTeamName}
              </option>
              <option value={selectedMatch.awayTeamId}>
                {selectedMatch.awayTeamName}
              </option>
            </select>
          </label>
        ) : null}

        <label className="block">
          <span className="text-fg-low text-[10px] uppercase tracking-widest">Goal type</span>
          <select
            data-testid="submit-goal-type"
            value={goalType}
            onChange={(e) => changeGoalType(e.target.value as GoalType)}
            className="mt-1 w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-fg-high"
          >
            <option value="OPEN_PLAY">Open play</option>
            <option value="SET_PIECE">Set piece</option>
            <option value="PENALTY">Penalty</option>
            <option value="OWN_GOAL">Own goal</option>
          </select>
        </label>

        <div className="block">
          <span className="text-fg-low text-[10px] uppercase tracking-widest">Scorer</span>
          {/* v1.88.0 — guest-scorer toggle. When checked, hides the
              picker; the event records isGuestScorer=true with
              scorerPlayerSlug=null. Composes naturally with OG. */}
          <div className="mt-1 flex items-center gap-2">
            <input
              type="checkbox"
              id="submit-goal-is-guest-scorer"
              data-testid="submit-goal-is-guest-scorer"
              checked={isGuestScorer}
              onChange={(e) => toggleGuestScorer(e.target.checked)}
            />
            <label htmlFor="submit-goal-is-guest-scorer" className="text-fg-mid text-xs">
              Scored by guest (off-roster)
            </label>
          </div>
          {!isGuestScorer && (
            <>
              <select
                data-testid="submit-goal-scorer"
                value={scorerSlug}
                onChange={(e) => changeScorer(e.target.value)}
                className="mt-1 w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-fg-high"
              >
                <option value="">— pick a scorer —</option>
                {scorerGroups.map((g) => (
                  <optgroup key={g.key} label={g.label}>
                    {g.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {scorerTeamLabel ? (
                <span
                  data-testid="submit-goal-scorer-guest-hint"
                  className="mt-1 block text-fg-mid text-[11px]"
                >
                  (guest from {scorerTeamLabel})
                </span>
              ) : null}
            </>
          )}
        </div>

        <div className="block">
          <span className="text-fg-low text-[10px] uppercase tracking-widest">Assister (optional)</span>
          {/* v1.88.0 — guest-assister toggle, same pattern as scorer. */}
          <div className="mt-1 flex items-center gap-2">
            <input
              type="checkbox"
              id="submit-goal-is-guest-assister"
              data-testid="submit-goal-is-guest-assister"
              checked={isGuestAssister}
              onChange={(e) => toggleGuestAssister(e.target.checked)}
            />
            <label htmlFor="submit-goal-is-guest-assister" className="text-fg-mid text-xs">
              Assisted by guest (off-roster)
            </label>
          </div>
          {!isGuestAssister && (
            <>
              <select
                data-testid="submit-goal-assister"
                value={assisterSlug}
                onChange={(e) => setAssisterSlug(e.target.value)}
                disabled={!isGuestScorer && !scorerSlug}
                className="mt-1 w-full bg-background border border-border-subtle rounded px-3 py-2 text-sm text-fg-high disabled:opacity-50"
              >
                <option value="">— no assist —</option>
                {assisterGroups.map((g) => (
                  <optgroup key={g.key} label={g.label}>
                    {g.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {assisterTeamLabel ? (
                <span
                  data-testid="submit-goal-assister-guest-hint"
                  className="mt-1 block text-fg-mid text-[11px]"
                >
                  (guest from {assisterTeamLabel})
                </span>
              ) : null}
            </>
          )}
        </div>

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
            disabled={pending || (!isGuestScorer && !scorerSlug)}
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
