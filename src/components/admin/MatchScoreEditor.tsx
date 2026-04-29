'use client'

import { useState, useTransition } from 'react'
import { updateMatch } from '@/app/admin/leagues/actions'
import { useToast } from './ToastProvider'

/**
 * Inline score editor for the admin schedule view.
 *
 * v1.15.0 extracted this component out of `ScheduleTab`; mobile and desktop
 * rows used to maintain duplicate score state + Enter / Escape / onBlur /
 * parse-int / updateMatch logic. The shared owner is here.
 *
 * v1.21.0 visual taxonomy update:
 *   - Number-edit appearance: subtle bg `admin-surface2`, Barlow Condensed
 *     bold for the score, no chevron (matches the "Number edit" entry in
 *     the visual taxonomy).
 *   - Empty state: transparent bg, dotted outline, "enter" placeholder
 *     (replaces the old quiet `vs` text-only affordance, which the v1.20
 *     audit flagged as not legibly editable).
 *   - Saving a score still implies status=COMPLETED — that's the natural
 *     read of "I'm entering a final score." But v1.21.0 also exposes
 *     status changes via the new `MatchOverflowMenu` kebab, so admins can
 *     mark a match Complete (e.g. 0-0 with no goals), Cancelled, or
 *     Postponed without going through the score editor at all.
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
      'w-9 bg-admin-surface3 border border-admin-green/50 text-admin-text text-sm rounded px-1 py-0.5 text-center font-condensed font-bold outline-none'
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

  // Number-edit display (filled state) — subtle bg, Barlow Condensed bold.
  // Per v1.21.0 taxonomy: status===COMPLETED renders the score; otherwise
  // shows the empty-number placeholder with dotted outline.
  if (match.status === 'COMPLETED') {
    return (
      <button
        type="button"
        onClick={startEdit}
        data-testid="match-score-editor-display"
        aria-label="Edit score"
        className="inline-flex items-center justify-center min-w-[48px] px-2 py-0.5 rounded bg-admin-surface2 hover:bg-admin-surface3 transition-colors font-condensed font-bold text-base tracking-[1px] text-admin-text"
      >
        {match.homeScore} - {match.awayScore}
      </button>
    )
  }

  // Empty-number placeholder.
  return (
    <button
      type="button"
      onClick={startEdit}
      data-testid="match-score-editor-display"
      aria-label="Enter score"
      className="inline-flex items-center justify-center min-w-[48px] px-2 py-0.5 rounded border border-dotted border-admin-text3 bg-transparent text-admin-text3 hover:text-admin-text2 hover:border-admin-text2 transition-colors text-xs font-mono"
    >
      enter
    </button>
  )
}
