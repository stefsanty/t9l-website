'use client'

import { useState, useTransition } from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { useToast } from './ToastProvider'
import {
  updateLeagueDetails,
  updateLeagueFeeSettings,
  updateLeaguePlannedRoster,
} from '@/app/admin/leagues/actions'
import { cn } from '@/lib/utils'
import { formatJpyFee } from '@/lib/playerFee'
import { formatJstDate } from '@/lib/jst'

/**
 * v1.75.0 — Admin League Settings: "League details" section.
 * v1.75.1 — Fields reordered by player-perspective importance.
 * v1.75.5 — Combined editor: absorbs fee + planned-roster fields so the
 *   admin sees ONE consolidated "League details" form. Save calls all three
 *   server actions in parallel. Standalone LeagueFeesEditor /
 *   LeaguePlannedRosterEditor components remain as files (referenced by
 *   their own dedicated tests + dark-mode contrast pin) but are no longer
 *   mounted on the admin page.
 *
 * Field order (player-importance — mirrors public LeagueDetailsPanel):
 *   1. Player format        2. Match duration
 *   3. Ball type            4. Goal size
 *   5. Default fee + per-position fee rows
 *   6. Planned teams        7. Planned per-team
 *   8. Registration deadline
 *   9. Offside rule         10. Throw-in vs kick-in
 *  11. Backpass rule (futsal-only)
 *  12. Unlimited subs
 *  13. Show on homepage toggle
 *  14. Organizer message (long text, last)
 */

type BallType = 'SOCCER' | 'FUTSAL'
type GoalSize = 'FUTSAL' | 'YOUTH_SOCCER' | 'FULL_SIZE_SOCCER'
type ThrowInType = 'THROW_IN' | 'KICK_IN'
type GoalKickType = 'THROW' | 'KICK'

interface FeeRow {
  position: string
  fee: number
}

interface Props {
  leagueId: string
  initialBallType: BallType
  initialGoalSize: GoalSize
  initialThrowInType: ThrowInType
  initialOffsideRule: boolean
  initialBackpassRule: boolean
  initialMatchDurationMinutes: number | null
  initialPlayerFormat: number | null
  initialGoalKickType: GoalKickType
  initialUnlimitedSubstitutions: boolean
  initialOrganizerMessage: string | null
  initialShowLeagueDetails: boolean
  // v1.75.5 — Fee fields (absorbed from LeagueFeesEditor).
  initialDefaultFee: number
  initialPositionFees: ReadonlyArray<FeeRow>
  // v1.75.5 — Planned-roster fields (absorbed from LeaguePlannedRosterEditor).
  initialPlannedPlayersPerTeam: number
  initialPlannedNumberOfTeams: number
  initialRegistrationDeadline: Date | null
}

function fmtDateInput(d: Date | null): string {
  if (!d) return ''
  return formatJstDate(d)
}

export default function LeagueDetailsEditor({
  leagueId,
  initialBallType,
  initialGoalSize,
  initialThrowInType,
  initialGoalKickType,
  initialOffsideRule,
  initialBackpassRule,
  initialMatchDurationMinutes,
  initialPlayerFormat,
  initialUnlimitedSubstitutions,
  initialOrganizerMessage,
  initialShowLeagueDetails,
  initialDefaultFee,
  initialPositionFees,
  initialPlannedPlayersPerTeam,
  initialPlannedNumberOfTeams,
  initialRegistrationDeadline,
}: Props) {
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()

  // Details fields
  const [ballType, setBallType] = useState<BallType>(initialBallType)
  const [goalSize, setGoalSize] = useState<GoalSize>(initialGoalSize)
  const [throwInType, setThrowInType] = useState<ThrowInType>(initialThrowInType)
  const [goalKickType, setGoalKickType] = useState<GoalKickType>(initialGoalKickType)
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

  // Fee fields (absorbed from LeagueFeesEditor)
  const [defaultFee, setDefaultFee] = useState<number>(initialDefaultFee)
  const [feeRows, setFeeRows] = useState<FeeRow[]>([...initialPositionFees])

  function addFeeRow() {
    setFeeRows([...feeRows, { position: '', fee: 0 }])
  }
  function removeFeeRow(idx: number) {
    setFeeRows(feeRows.filter((_, i) => i !== idx))
  }
  function updateFeeRow(idx: number, patch: Partial<FeeRow>) {
    setFeeRows(feeRows.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  // Planned-roster fields (absorbed from LeaguePlannedRosterEditor)
  const [plannedPlayersPerTeam, setPlannedPlayersPerTeam] = useState<number>(
    initialPlannedPlayersPerTeam,
  )
  const [plannedNumberOfTeams, setPlannedNumberOfTeams] = useState<number>(
    initialPlannedNumberOfTeams,
  )
  const [registrationDeadline, setRegistrationDeadline] = useState<string>(
    fmtDateInput(initialRegistrationDeadline),
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
        await Promise.all([
          updateLeagueDetails({
            leagueId,
            ballType,
            goalSize,
            throwInType,
            goalKickType,
            offsideRule,
            // Only persist backpassRule when relevant. Sending the value
            // when the field is hidden would silently overwrite a
            // previously-set value the admin can't see.
            backpassRule: ballType === 'FUTSAL' ? backpassRule : undefined,
            matchDurationMinutes: durationParsed,
            playerFormat: formatParsed,
            unlimitedSubstitutions,
            organizerMessage: organizerMessage.trim() === '' ? null : organizerMessage,
            showLeagueDetails,
          }),
          updateLeagueFeeSettings({
            leagueId,
            defaultFee,
            positionFees: feeRows
              .map((r) => ({ position: r.position.trim(), fee: Math.max(0, Math.floor(r.fee || 0)) }))
              .filter((r) => r.position),
          }),
          updateLeaguePlannedRoster({
            leagueId,
            plannedPlayersPerTeam: Math.max(0, Math.floor(plannedPlayersPerTeam || 0)),
            plannedNumberOfTeams: Math.max(0, Math.floor(plannedNumberOfTeams || 0)),
            registrationDeadline: registrationDeadline.trim() === '' ? null : registrationDeadline,
          }),
        ])
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
          Match-format details, player fees, and planned-roster targets. Surfaced on the
          public homepage when &ldquo;Show on homepage&rdquo; is on.
        </p>
      </div>

      {/* 1 — Player format + 2 — Match duration (side by side) */}
      <div className="grid grid-cols-2 gap-3">
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
      </div>

      {/* 3 — Ball type */}
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

      {/* 4 — Goal size */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Goal</label>
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

      {/* 5 — Default fee + per-position fee rows */}
      <div
        className="pt-4 border-t border-admin-border space-y-4"
        data-testid="league-fees-editor"
      >
        <div>
          <h3 className="text-sm font-bold text-admin-text mb-1">Player fees</h3>
          <p className="text-xs text-admin-text2 leading-relaxed">
            Default fee applies to every player whose position has no override below.
            Per-position rows match
            <code className="mx-1 px-1 bg-admin-surface2 rounded text-[11px] font-mono text-admin-text">PlayerLeagueMembership.position</code>
            via case-sensitive exact match (e.g. <code>GK</code> = 5,000 + default = 4,000).
          </p>
        </div>

        <label className="block">
          <span className="block text-xs uppercase tracking-widest font-bold text-admin-text2 mb-1.5">
            Default fee (JPY)
          </span>
          <input
            type="number"
            min={0}
            step={100}
            value={defaultFee}
            onChange={(e) => setDefaultFee(parseInt(e.target.value, 10) || 0)}
            className="w-32 bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono text-admin-text"
            data-testid="default-fee-input"
          />
          <p className="text-[11px] text-admin-text3 mt-1">
            {formatJpyFee(defaultFee)} per matchday (or season — your call)
          </p>
        </label>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest font-bold text-admin-text2">Per-position overrides</p>
          {feeRows.length === 0 && (
            <p className="text-xs text-admin-text3 italic">No per-position overrides — every player pays the default fee.</p>
          )}
          {feeRows.map((row, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2"
              data-testid={`fee-row-${idx}`}
            >
              <input
                type="text"
                value={row.position}
                onChange={(e) => updateFeeRow(idx, { position: e.target.value })}
                placeholder="GK"
                maxLength={32}
                className="w-20 bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono uppercase text-admin-text placeholder:text-admin-text3"
                data-testid={`fee-position-${idx}`}
              />
              <input
                type="number"
                min={0}
                step={100}
                value={row.fee}
                onChange={(e) => updateFeeRow(idx, { fee: parseInt(e.target.value, 10) || 0 })}
                className="w-32 bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono text-admin-text"
                data-testid={`fee-amount-${idx}`}
              />
              <span className="text-[11px] text-admin-text3">{formatJpyFee(row.fee)}</span>
              <button
                type="button"
                onClick={() => removeFeeRow(idx)}
                aria-label="Remove fee row"
                className="ml-auto w-7 h-7 flex items-center justify-center rounded text-admin-text3 hover:text-admin-text hover:bg-admin-surface2 transition-colors"
                data-testid={`fee-remove-${idx}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addFeeRow}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-admin-text2 hover:text-admin-text px-2 py-1 rounded border border-dashed border-admin-border hover:border-admin-border2 transition-colors"
            data-testid="fee-add-row"
          >
            <Plus className="w-3.5 h-3.5" />
            Add position fee
          </button>
        </div>
      </div>

      {/* 6 — Planned teams + 7 — Planned per-team + 8 — Registration deadline */}
      <div
        className="pt-4 border-t border-admin-border space-y-4"
        data-testid="league-planned-roster-editor"
      >
        <div>
          <h3 className="text-sm font-bold text-admin-text mb-1">Planned roster</h3>
          <p className="text-xs text-admin-text2 leading-relaxed">
            Targets surfaced on the public homepage. Set to 0 to hide a row from the public panel.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs uppercase tracking-widest font-bold text-admin-text2 mb-1.5">
              Planned teams
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={plannedNumberOfTeams}
              onChange={(e) => setPlannedNumberOfTeams(parseInt(e.target.value, 10) || 0)}
              className="w-full bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono text-admin-text"
              data-testid="planned-number-of-teams-input"
            />
          </label>

          <label className="block">
            <span className="block text-xs uppercase tracking-widest font-bold text-admin-text2 mb-1.5">
              Planned players / team
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={plannedPlayersPerTeam}
              onChange={(e) => setPlannedPlayersPerTeam(parseInt(e.target.value, 10) || 0)}
              className="w-full bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono text-admin-text"
              data-testid="planned-players-per-team-input"
            />
          </label>
        </div>

        <label className="block">
          <span className="block text-xs uppercase tracking-widest font-bold text-admin-text2 mb-1.5">
            Registration deadline
          </span>
          <input
            type="date"
            value={registrationDeadline}
            onChange={(e) => setRegistrationDeadline(e.target.value)}
            className="bg-admin-surface2 border border-admin-border rounded px-2 py-1 text-sm font-mono text-admin-text"
            data-testid="registration-deadline-input"
          />
          <p className="text-[11px] text-admin-text3 mt-1">
            JST calendar date. Leave empty to hide the deadline row from the public panel.
          </p>
        </label>
      </div>

      {/* 9 — Offside rule */}
      <div
        className="flex items-center justify-between gap-3 pt-4 border-t border-admin-border"
        data-testid="league-details-offside-toggle"
      >
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

      {/* 10 — Throw-in vs kick-in */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Sideline</label>
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

      {/* 11 — Goal kick */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-admin-text2 uppercase tracking-wide">Goal kick</label>
        <div className="grid grid-cols-2 gap-3">
          {(['THROW', 'KICK'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              data-testid={`league-details-goal-kick-${opt.toLowerCase()}`}
              onClick={() => setGoalKickType(opt)}
              className={cn(
                'rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
                goalKickType === opt
                  ? 'border-admin-green bg-admin-green/10 text-admin-text'
                  : 'border-admin-border bg-admin-surface2 text-admin-text2 hover:border-admin-border2 hover:text-admin-text',
              )}
            >
              {opt === 'THROW' ? 'Throw' : 'Kick'}
            </button>
          ))}
        </div>
      </div>

      {/* 12 — Backpass rule (futsal-only) */}
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

      {/* 12 — Unlimited subs */}
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

      {/* 13 — Show on homepage toggle */}
      <div
        className="flex items-center justify-between gap-3 pt-2 border-t border-admin-border"
        data-testid="league-details-show-toggle"
      >
        <div>
          <p className="text-sm font-medium text-admin-text">Show on homepage</p>
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

      {/* 14 — Organizer message (long text, last) */}
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
