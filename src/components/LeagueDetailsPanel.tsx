'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  BALL_TYPE_LABELS,
  GOAL_SIZE_LABELS,
  THROW_IN_TYPE_LABELS,
  formatPlayerFormat,
  type LeagueDetails,
} from '@/lib/leagueDetails'
import type { PlannedRosterStats as PlannedRosterStatsData } from '@/lib/plannedRosterStats'
import { formatJstFriendly } from '@/lib/jst'
import { formatJpyFee } from '@/lib/playerFee'

/**
 * v1.75.0 — Public League details panel.
 * v1.75.1 — Consolidated: includes planned-roster stats + fee inline.
 *   Decoupled from preseasonMode — renders whenever showLeagueDetails=true.
 *   Collapsible: expanded by default when preseasonMode=true, collapsed
 *   when preseasonMode=false.
 * v1.75.6 — Stats moved to a dedicated bottom subsection separated from
 *   the rule rows. Labels renamed; "Current Players" row removed;
 *   "Matchdays" row added. Season Fee + Register By combined onto one line.
 *
 * Rules section order:
 *   1. Player format
 *   2. Match duration
 *   3. Ball type
 *   4. Goal size
 *   5. Offside rule
 *   6. Throw-in / kick-in
 *   7. Backpass rule (futsal-only)
 *   8. Unlimited substitutions
 *   9. Organizer message (long text)
 *
 * Season info subsection (bottom, separated by divider):
 *   1. Season Fee + Register By (combined line)
 *   2. Teams
 *   3. Roster Size
 *   4. Matchdays
 *   5. Spots left
 */
interface Props {
  data: LeagueDetails
  plannedRosterStats?: PlannedRosterStatsData | null
  preseasonMode?: boolean
}

export default function LeagueDetailsPanel({
  data,
  plannedRosterStats,
  preseasonMode = false,
}: Props) {
  const [expanded, setExpanded] = useState(preseasonMode)

  const showBackpass = data.ballType === 'FUTSAL'
  const showDuration = data.matchDurationMinutes != null
  const showFormat = data.playerFormat != null
  const showMessage =
    data.organizerMessage != null && data.organizerMessage.trim() !== ''

  // Season info section visibility gates.
  const showPlannedTeams = !!plannedRosterStats && plannedRosterStats.plannedNumberOfTeams > 0
  const showPlannedPerTeam = !!plannedRosterStats && plannedRosterStats.plannedPlayersPerTeam > 0
  const showCurrentAndSpots = showPlannedTeams && showPlannedPerTeam
  const showDeadline = !!plannedRosterStats && plannedRosterStats.registrationDeadline !== null
  const showMatchdays = !!plannedRosterStats && plannedRosterStats.matchdays > 0
  const showFee =
    !!plannedRosterStats &&
    (plannedRosterStats.defaultFee > 0 || plannedRosterStats.positionFees.length > 0)
  const showStatsSection =
    showFee || showPlannedTeams || showPlannedPerTeam || showCurrentAndSpots || showDeadline || showMatchdays

  return (
    <section
      data-testid="league-details-panel"
      className="w-full mt-2 mb-3 rounded-2xl border border-border-default bg-card overflow-hidden"
    >
      {/* Clickable header — toggles expand/collapse */}
      <button
        type="button"
        data-testid="league-details-panel-header"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left bg-surface hover:bg-surface-md transition-colors"
        aria-expanded={expanded}
      >
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-fg-high">
          League details
        </span>
        <ChevronDown
          className={`w-4 h-4 text-fg-mid transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="px-4 pt-4 pb-3" data-testid="league-details-panel-body">
          {/* Rules section */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm" data-testid="league-details-rules-section">
            {/* 1 — Player format */}
            {showFormat && (
              <Row
                label="Format"
                value={formatPlayerFormat(data.playerFormat as number)}
                testid="league-details-format-row"
              />
            )}

            {/* 2 — Match duration */}
            {showDuration && (
              <Row
                label="Match length"
                value={`${data.matchDurationMinutes} min`}
                testid="league-details-duration-row"
              />
            )}

            {/* 3 — Ball type */}
            <Row
              label="Ball"
              value={BALL_TYPE_LABELS[data.ballType]}
              testid="league-details-ball-row"
            />

            {/* 4 — Goal size */}
            <Row
              label="Goal size"
              value={GOAL_SIZE_LABELS[data.goalSize]}
              testid="league-details-goal-row"
            />

            {/* 5 — Offside rule */}
            <Row
              label="Offside"
              value={data.offsideRule ? 'Yes' : 'No'}
              testid="league-details-offside-row"
            />

            {/* 6 — Throw-in vs kick-in */}
            <Row
              label="Sideline restart"
              value={THROW_IN_TYPE_LABELS[data.throwInType]}
              testid="league-details-throw-in-row"
            />

            {/* 7 — Backpass (futsal-only) */}
            {showBackpass && (
              <Row
                label="Backpass rule"
                value={data.backpassRule ? 'Yes' : 'No'}
                testid="league-details-backpass-row"
              />
            )}

            {/* 8 — Substitutions */}
            <Row
              label="Subs"
              value={data.unlimitedSubstitutions ? 'Unlimited' : 'Limited'}
              testid="league-details-subs-row"
            />
          </dl>

          {/* 9 — Organizer message (long text, after rules) */}
          {showMessage && (
            <div
              className="mt-3 pt-3 border-t border-border-subtle"
              data-testid="league-details-organizer-message"
            >
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-fg-mid mb-1.5">
                From the organizer
              </p>
              <p className="text-sm text-fg-high whitespace-pre-line leading-relaxed">
                {data.organizerMessage}
              </p>
            </div>
          )}

          {/* Season info — bottom subsection, separated by a divider */}
          {showStatsSection && plannedRosterStats && (
            <div
              className="mt-3 pt-3 border-t border-border-subtle"
              data-testid="league-stats-section"
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {/* Season Fee + Register By — combined first line */}
                {(showFee || showDeadline) && (
                  <div className="col-span-2" data-testid="season-fee-row">
                    <div className="flex items-baseline justify-between gap-4 flex-wrap">
                      {showFee && (
                        <div className="flex items-baseline gap-1.5 min-w-0">
                          <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold shrink-0">
                            Season Fee
                          </dt>
                          <dd className="font-display font-black text-fg-high tabular-nums">
                            {formatJpyFee(plannedRosterStats.defaultFee)}
                          </dd>
                        </div>
                      )}
                      {showDeadline && plannedRosterStats.registrationDeadline && (
                        <div className="flex items-baseline gap-1.5 min-w-0" data-testid="deadline-row">
                          <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold shrink-0">
                            Register By
                          </dt>
                          <dd className="font-display font-black text-fg-high">
                            {formatJstFriendly(plannedRosterStats.registrationDeadline, 'en')}
                          </dd>
                        </div>
                      )}
                    </div>
                    {showFee && plannedRosterStats.positionFees.length > 0 && (
                      <p
                        className="text-[10px] text-fg-low mt-1 leading-snug"
                        data-testid="player-fee-position-rows"
                      >
                        {plannedRosterStats.positionFees.map((p, idx) => (
                          <span key={p.position}>
                            {idx > 0 && ' '}
                            ({p.position} – {formatJpyFee(p.fee)})
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                )}

                {/* Teams */}
                {showPlannedTeams && (
                  <Row
                    label="Teams"
                    value={String(plannedRosterStats.plannedNumberOfTeams)}
                    testid="planned-teams-row"
                  />
                )}

                {/* Roster Size */}
                {showPlannedPerTeam && (
                  <Row
                    label="Roster Size"
                    value={String(plannedRosterStats.plannedPlayersPerTeam)}
                    testid="planned-per-team-row"
                  />
                )}

                {/* Matchdays */}
                {showMatchdays && (
                  <Row
                    label="Matchdays"
                    value={String(plannedRosterStats.matchdays)}
                    testid="matchdays-row"
                  />
                )}

                {/* Spots left — gated on both planned targets being non-zero */}
                {showCurrentAndSpots && (
                  <div className="flex justify-between items-baseline" data-testid="spots-left-row">
                    <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
                      Spots left
                    </dt>
                    <dd className="font-display font-black text-vibrant-pink tabular-nums">
                      {plannedRosterStats.spotsLeft}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Row({ label, value, testid }: { label: string; value: string; testid: string }) {
  return (
    <div className="flex justify-between items-baseline" data-testid={testid}>
      <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">{label}</dt>
      <dd className="font-display font-black text-fg-high">{value}</dd>
    </div>
  )
}
