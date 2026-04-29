'use client'

import { useState, useTransition } from 'react'
import { updateMatch } from '@/app/admin/leagues/actions'
import { useToast } from './ToastProvider'

/**
 * Inline score editor for the admin schedule view (v1.15.0 — extracted from
 * ScheduleTab). Mobile and desktop rows used to maintain duplicate score
 * state + Enter / Escape / onBlur / parse-int / updateMatch logic; the
 * shared owner is here.
 *
 * Both variants share: state ownership, save flow (Enter or onBlur), cancel
 * flow (Escape), parse-int validation, the updateMatch call shape, the
 * toast on success / failure. They differ only in the static class names
 * applied to the inputs and the display surface — encoded as a single
 * `variant` prop.
 *
 * Re-keyed externally on `match.id` if the parent ever swaps which match
 * the editor renders for, so internal state doesn't bleed across rows.
 */

type MatchStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'POSTPONED'

interface MatchRefForScoreEditor {
  id: string
  homeScore: number
  awayScore: number
  status: MatchStatus
}

interface MatchScoreEditorProps {
  match: MatchRefForScoreEditor
  leagueId: string
  variant: 'mobile' | 'desktop'
}

export default function MatchScoreEditor({
  match,
  leagueId,
  variant,
}: MatchScoreEditorProps) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [homeScore, setHomeScore] = useState(String(match.homeScore))
  const [awayScore, setAwayScore] = useState(String(match.awayScore))
  const [, startTransition] = useTransition()

  function saveScore() {
    setEditing(false)
    const hs = parseInt(homeScore, 10)
    const as = parseInt(awayScore, 10)
    if (isNaN(hs) || isNaN(as)) return
    startTransition(async () => {
      try {
        await updateMatch(match.id, leagueId, {
          homeScore: hs,
          awayScore: as,
          status: 'COMPLETED',
        })
        toast('Score updated')
      } catch {
        toast('Failed to update score', 'error')
      }
    })
  }

  if (editing) {
    const inputClass =
      variant === 'desktop'
        ? 'w-10 bg-admin-surface3 border border-admin-green/50 text-admin-text text-xs rounded px-1 py-0.5 text-center font-mono outline-none'
        : 'w-10 bg-admin-surface3 border border-admin-green/50 text-admin-text text-xs rounded px-1 py-1 text-center font-mono outline-none'
    const wrapperClass =
      variant === 'mobile' ? 'flex items-center gap-1 shrink-0' : 'flex items-center gap-1'
    return (
      <div className={wrapperClass} data-testid="match-score-editor-editing">
        <input
          autoFocus
          type="number"
          min={0}
          value={homeScore}
          onChange={(e) => setHomeScore(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveScore()
            if (e.key === 'Escape') setEditing(false)
          }}
          aria-label="Home score"
          className={inputClass}
        />
        <span className="text-admin-text3 text-xs">–</span>
        <input
          type="number"
          min={0}
          value={awayScore}
          onChange={(e) => setAwayScore(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveScore()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={saveScore}
          aria-label="Away score"
          className={inputClass}
        />
      </div>
    )
  }

  function startEdit() {
    setHomeScore(String(match.homeScore))
    setAwayScore(String(match.awayScore))
    setEditing(true)
  }

  if (variant === 'mobile') {
    return (
      <span
        className="font-mono text-admin-text2 text-sm cursor-pointer px-2 py-1 rounded hover:bg-admin-surface3 transition-colors shrink-0"
        onClick={startEdit}
        data-testid="match-score-editor-display"
      >
        {match.status === 'COMPLETED' ? (
          `${match.homeScore}–${match.awayScore}`
        ) : (
          <span className="text-admin-text3">vs</span>
        )}
      </span>
    )
  }

  return (
    <span
      className="cursor-pointer transition-colors"
      onClick={startEdit}
      data-testid="match-score-editor-display"
    >
      {match.status === 'COMPLETED' ? (
        <span className="font-condensed font-bold text-base tracking-[1px] text-admin-text">
          {match.homeScore} – {match.awayScore}
        </span>
      ) : (
        <span className="font-mono text-xs text-admin-text3">vs</span>
      )}
    </span>
  )
}
