'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { useToast } from './ToastProvider'
import { updateLeagueDetails } from '@/app/admin/leagues/actions'
import { cn } from '@/lib/utils'

/**
 * v1.75.0 — Admin League Settings: "League details" section.
 *
 * Edits the ten new `League` columns introduced in v1.75.0 (ballType,
 * goalSize, throwInType, offsideRule, backpassRule,
 * matchDurationMinutes, playerFormat, unlimitedSubstitutions,
 * organizerMessage, showLeagueDetails). Surfaced server-side by the
 * new `LeagueDetailsPanel` on the public preseason homepage when both
 * `preseasonMode` and `showLeagueDetails` are true.
 *
 * Conventions:
 *   - `backpassRule` toggle is conditionally rendered: only meaningful
 *     when ballType === FUTSAL. The public panel applies the same
 *     hide rule.
 *   - `matchDurationMinutes` and `playerFormat` are optional. Empty
 *     input clears the column (sent as null).
 *   - `playerFormat` is a dropdown with allowed values (5, 6, 7, 9, 11).
 *   - `organizerMessage` is a textarea (~6 rows default; auto-grows
 *     visually via min-h). Persists newlines.
 *   - All ten fields save together via one server action call.
 */

type BallType = 'SOCCER' | 'FUTSAL'
type GoalSize = 'FUTSAL' | 'YOUTH_SOCCER' | 'FULL_SIZE_SOCCER'
type ThrowInType = 'THROW_IN' | 'KICK_IN'

interface Props {
  leagueId: string
  initialBallType: BallType
  initialGoalSize: GoalSize
  initialThrowInType: ThrowInType
  initialOffsideRule: boolean
  initialBackpassRule: boolean
  initialMatchDurationMinutes: number | null
  initialPlayerFormat: number | null
  initialUnlimitedSubstitutions: boolean
  initialOrganizerMessage: string | null
  initialShowLeagueDetails: boolean
}

export default function LeagueDetailsEditor({
  leagueId,
  initialBallType,
  initialGoalSize,
  initialThrowInType,
  initialOffsideRule,
  initialBackpassRule,
  initialMatchDurationMinutes,
  initialPlayerFormat,
  initialUnlimitedSubstitutions,
  initialOrganizerMessage,
  initialShowLeagueDetails,
}: Props) {
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()

  const [ballType, setBallType] = useState<BallType>(initialBallType)
  const [goalSize, setGoalSize] = useState<GoalSize>(initialGoalSize)
  const [throwInType, setThrowInType] = useState<ThrowInType>(initialThrowInType)
  const [offsideRule, setOffsideRule] = useState<boolean>(initialOffsideRule)
  const [backpassRule, setBackpassRule] = useState<boolean>(initialBackpassRule)
  const [matchDurationMinutes, setMatchDurationMinutes] = useState<string>(
    initialMatchDurationMinutes != null ? String(initialMatchDurationMinutes) : '',
  )
  const [playerFormat, setPlayerFormat] = useState<string>(
    initialPlayerFormat != null ? String(initialPlayerFormat) : '',
  )
  const [unlimitedSubstitutions, setUnlimitedSubstitutions] = useState<boolean>(
    initialUnlimitedSubstitutions,
  )
  const [organizerMessage, setOrganizerMessage] = useState<string>(
    initialOrganizerMessage ?? '',
  )
  const [showLeagueDetails, setShowLeagueDetails] = useState<boolean>(
    initialShowLeagueDetails,
  )

  function handleSave() {
    const durationParsed = matchDurationMinutes.trim() === ''
      ? null
      : parseInt(matchDurationMinutes, 10)
    const formatParsed = playerFormat.trim() === ''
      ? null
      : parseInt(playerFormat, 10)

    if (durationParsed !== null && (Number.isNaN(durationParsed) || durationParsed <= 0)) {
      toast('Match duration must be a positive number', 'error')
      return
    }

    startTransition(async () => {
      try {
        await updateLeagueDetails({
          leagueId,
          ballType,
          goalSize,
          throwInType,
          offsideRule,
          // Only persist backpassRule when it's relevant. Sending the
          // current value when the field is hidden would silently
          // overwrite a previously-set value the admin can't see.
          backpassRule: ballType === 'FUTSAL' ? backpassRule : undefined,
          matchDurationMinutes: durationParsed,
          playerFormat: formatParsed,
          unlimitedSubstitutions,
          organizerMessage: organizerMessage.trim() === '' ? null : organizerMessage,
          showLeagueDetails,
        })
        toast('League details saved', 'success')
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed to save', 'error')
      }
    })
  }

  return (
    <section
      className="bg-admin-surface rounded-xl border border-admin-border p-5 space-y-5"
      data-testid="settings-tab-league-details-section"
    >
      <div>
        <h2 className="font-condensed font-bold text-admin-text text-lg">League details</h2>
        <p className="text-xs text-admin-text3 mt-1 leading-relaxed">
          Match-format details surfaced on the public preseason homepage.
          Toggle &ldquo;Show on homepage&rdquo; off to hide the panel without losing the values.
        </p>
      </div>

      {/* Ball type */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Ball type</label>
        <div className="grid grid-cols-2 gap-3">
          {(['SOCCER', 'FUTSAL'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              data-testid={`league-details-ball-type-${opt.toLowerCase()}`}
              onClick={() => setBallType(opt)}
              className={cn(
                'rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
                ballType === opt
                  ? 'border-admin-green bg-admin-green/10 text-admin-text'
                  : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
              )}
            >
              {opt === 'SOCCER' ? 'Soccer' : 'Futsal'}
            </button>
          ))}
        </div>
      </div>

      {/* Goal size */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Goal size</label>
        <select
          value={goalSize}
          onChange={(e) => setGoalSize(e.target.value as GoalSize)}
          className="w-full bg-admin-surface2 border border-admin-border rounded-lg px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-admin-border2"
          data-testid="league-details-goal-size"
        >
          <option value="FUTSAL">Futsal</option>
          <option value="YOUTH_SOCCER">Youth soccer</option>
          <option value="FULL_SIZE_SOCCER">Full size soccer</option>
        </select>
      </div>

      {/* Throw-in vs kick-in */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Restart from sideline</label>
        <div className="grid grid-cols-2 gap-3">
          {(['THROW_IN', 'KICK_IN'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              data-testid={`league-details-throw-in-${opt.toLowerCase().replace('_', '-')}`}
              onClick={() => setThrowInType(opt)}
              className={cn(
                'rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
                throwInType === opt
                  ? 'border-admin-green bg-admin-green/10 text-admin-text'
                  : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
              )}
            >
              {opt === 'THROW_IN' ? 'Throw-in' : 'Kick-in'}
            </button>
          ))}
        </div>
      </div>

      {/* Offside rule */}
      <div className="flex items-center justify-between gap-3" data-testid="league-details-offside-toggle">
        <div>
          <p className="text-sm font-medium text-admin-text">Offside rule</p>
          <p className="text-xs text-admin-text3">When off, attackers can stay behind the last defender.</p>
        </div>
        <button
          type="button"
          aria-pressed={offsideRule}
          onClick={() => setOffsideRule(!offsideRule)}
          className={cn(
            'rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest border transition-colors',
            offsideRule
              ? 'border-admin-green bg-admin-green/15 text-admin-text'
              : 'border-admin-border bg-admin-surface2 text-admin-text3',
          )}
        >
          {offsideRule ? 'On' : 'Off'}
        </button>
      </div>

      {/* Backpass — futsal-only */}
      {ballType === 'FUTSAL' && (
        <div className="flex items-center justify-between gap-3" data-testid="league-details-backpass-toggle">
          <div>
            <p className="text-sm font-medium text-admin-text">Backpass rule</p>
            <p className="text-xs text-admin-text3">Futsal: keeper can&apos;t handle a deliberate teammate pass.</p>
          </div>
          <button
            type="button"
            aria-pressed={backpassRule}
            onClick={() => setBackpassRule(!backpassRule)}
            className={cn(
              'rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest border transition-colors',
              backpassRule
                ? 'border-admin-green bg-admin-green/15 text-admin-text'
                : 'border-admin-border bg-admin-surface2 text-admin-text3',
            )}
          >
            {backpassRule ? 'On' : 'Off'}
          </button>
        </div>
      )}

      {/* Match duration + player format */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Match duration (min)</label>
          <input
            type="number"
            min={1}
            step={1}
            value={matchDurationMinutes}
            onChange={(e) => setMatchDurationMinutes(e.target.value)}
            placeholder="e.g. 33"
            className="w-full bg-admin-surface2 border border-admin-border rounded-lg px-3 py-2 text-sm text-admin-text placeholder:text-admin-text3 focus:outline-none focus:border-admin-border2"
            data-testid="league-details-match-duration"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Player format</label>
          <select
            value={playerFormat}
            onChange={(e) => setPlayerFormat(e.target.value)}
            className="w-full bg-admin-surface2 border border-admin-border rounded-lg px-3 py-2 text-sm text-admin-text focus:outline-none focus:border-admin-border2"
            data-testid="league-details-player-format"
          >
            <option value="">— not set —</option>
            <option value="5">5-a-side</option>
            <option value="6">6-a-side</option>
            <option value="7">7-a-side</option>
            <option value="9">9-a-side</option>
            <option value="11">11-a-side</option>
          </select>
        </div>
      </div>

      {/* Unlimited subs */}
      <div className="flex items-center justify-between gap-3" data-testid="league-details-unlimited-subs-toggle">
        <div>
          <p className="text-sm font-medium text-admin-text">Unlimited substitutions</p>
          <p className="text-xs text-admin-text3">When off, standard limit applies (admin sets per-match).</p>
        </div>
        <button
          type="button"
          aria-pressed={unlimitedSubstitutions}
          onClick={() => setUnlimitedSubstitutions(!unlimitedSubstitutions)}
          className={cn(
            'rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest border transition-colors',
            unlimitedSubstitutions
              ? 'border-admin-green bg-admin-green/15 text-admin-text'
              : 'border-admin-border bg-admin-surface2 text-admin-text3',
          )}
        >
          {unlimitedSubstitutions ? 'On' : 'Off'}
        </button>
      </div>

      {/* Organizer message */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Organizer message</label>
        <textarea
          value={organizerMessage}
          onChange={(e) => setOrganizerMessage(e.target.value)}
          rows={6}
          placeholder="Welcome message, league rules, contact info, etc. Newlines are preserved."
          className="w-full bg-admin-surface2 border border-admin-border rounded-lg px-3 py-2 text-sm text-admin-text placeholder:text-admin-text3 focus:outline-none focus:border-admin-border2 resize-y min-h-[8rem]"
          data-testid="league-details-organizer-message"
        />
      </div>

      {/* Show on homepage toggle */}
      <div className="flex items-center justify-between gap-3 pt-2 border-t border-admin-border" data-testid="league-details-show-toggle">
        <div>
          <p className="text-sm font-medium text-admin-text">Show on preseason homepage</p>
          <p className="text-xs text-admin-text3">When off, the public details panel is hidden but values are kept.</p>
        </div>
        <button
          type="button"
          aria-pressed={showLeagueDetails}
          onClick={() => setShowLeagueDetails(!showLeagueDetails)}
          className={cn(
            'rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-widest border transition-colors',
            showLeagueDetails
              ? 'border-admin-green bg-admin-green/15 text-admin-text'
              : 'border-admin-border bg-admin-surface2 text-admin-text3',
          )}
        >
          {showLeagueDetails ? 'Visible' : 'Hidden'}
        </button>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="px-5 py-2 bg-admin-green text-admin-ink font-medium text-sm rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 inline-flex items-center gap-2"
          data-testid="league-details-save"
        >
          {pending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save league details
        </button>
      </div>
    </section>
  )
}
