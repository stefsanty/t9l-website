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
 * v1.75.1 — Consolidated: includes planned-roster stats + fee inline
 *   (formerly a separate PlannedRosterStats render in Dashboard).
 *   Decoupled from preseasonMode — renders whenever showLeagueDetails=true.
 *   Collapsible: expanded by default when preseasonMode=true, collapsed
 *   when preseasonMode=false. Fields ordered by player-perspective importance.
 *
 * Field order (most → least important):
 *   1. Player format          — primary "what kind of game"
 *   2. Match duration
 *   3. Ball type
 *   4. Goal size
 *   5. Player fee             — when configured
 *   6. Planned teams / per-team / current / spots left — when recruiting=true
 *   7. Registration deadline  — when recruiting=true
 *   8. Offside rule
 *   9. Throw-in / kick-in
 *  10. Backpass rule          — futsal-only
 *  11. Unlimited substitutions
 *  12. Organizer message      — long text, last
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

  // Planned-roster visibility (mirrors PlannedRosterStats component logic).
  // v1.75.5 — current/spots-left rows are gated on BOTH planned targets
  // being non-zero. With the relaxed gate (plannedRosterStats threads
  // unconditionally) we'd otherwise show "Spots left: 0" on non-recruiting
  // leagues, which is meaningless.
  const showPlannedTeams = !!plannedRosterStats && plannedRosterStats.plannedNumberOfTeams > 0
  const showPlannedPerTeam = !!plannedRosterStats && plannedRosterStats.plannedPlayersPerTeam > 0
  const showCurrentAndSpots = showPlannedTeams && showPlannedPerTeam
  const showDeadline = !!plannedRosterStats && plannedRosterStats.registrationDeadline !== null
  const showFee =
    !!plannedRosterStats &&
    (plannedRosterStats.defaultFee > 0 || plannedRosterStats.positionFees.length > 0)
  const showRosterSection = showFee || showPlannedTeams || showPlannedPerTeam || showCurrentAndSpots || showDeadline

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
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
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

            {/* 5 — Player fee */}
            {showFee && plannedRosterStats && (
              <div
                className="col-span-2 pt-1.5 mt-0.5 border-t border-border-subtle"
                data-testid="player-fee-row"
              >
                <div className="flex justify-between items-baseline gap-2 flex-wrap">
                  <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
                    Player fee
                  </dt>
                  <dd className="font-display font-black text-fg-high tabular-nums">
                    {formatJpyFee(plannedRosterStats.defaultFee)}
                    {plannedRosterStats.positionFees.length > 0 && (
                      <span
                        className="ml-2 text-[10px] font-bold text-fg-mid tracking-wider"
                        data-testid="player-fee-position-rows"
                      >
                        {plannedRosterStats.positionFees.map((p, idx) => (
                          <span key={p.position}>
                            {idx > 0 && ' '}
                            ({p.position} – {formatJpyFee(p.fee)})
                          </span>
                        ))}
                      </span>
                    )}
                  </dd>
                </div>
                <p className="text-[10px] text-fg-low mt-1 leading-snug">
                  Player fee is used to pay referee volunteers and league management work.
                </p>
              </div>
            )}

            {/* 6 — Planned teams / per-team / current count / spots left */}
            {showRosterSection && plannedRosterStats && (
              <>
                {showPlannedTeams && (
                  <div
                    className={`flex justify-between items-baseline${!showFee ? ' pt-1.5 mt-0.5 border-t border-border-subtle col-span-2' : ''}`}
                    data-testid="planned-teams-row"
                  >
                    <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
                      Planned teams
                    </dt>
                    <dd className="font-display font-black text-fg-high tabular-nums">
                      {plannedRosterStats.plannedNumberOfTeams}
                    </dd>
                  </div>
                )}
                {showPlannedPerTeam && (
                  <div className="flex justify-between items-baseline" data-testid="planned-per-team-row">
                    <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
                      Per team
                    </dt>
                    <dd className="font-display font-black text-fg-high tabular-nums">
                      {plannedRosterStats.plannedPlayersPerTeam}
                    </dd>
                  </div>
                )}
                {showCurrentAndSpots && (
                  <>
                    <div className="flex justify-between items-baseline" data-testid="current-players-row">
                      <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
                        Current players
                      </dt>
                      <dd className="font-display font-black text-fg-high tabular-nums">
                        {plannedRosterStats.currentPlayers}
                      </dd>
                    </div>
                    <div className="flex justify-between items-baseline" data-testid="spots-left-row">
                      <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
                        Spots left
                      </dt>
                      <dd className="font-display font-black text-vibrant-pink tabular-nums">
                        {plannedRosterStats.spotsLeft}
                      </dd>
                    </div>
                  </>
                )}
              </>
            )}

            {/* 7 — Registration deadline */}
            {showDeadline && plannedRosterStats?.registrationDeadline && (
              <div
                className="col-span-2 flex justify-between items-baseline pt-1.5 mt-0.5 border-t border-border-subtle"
                data-testid="deadline-row"
              >
                <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
                  Registration deadline
                </dt>
                <dd className="font-display font-black text-fg-high">
                  {formatJstFriendly(plannedRosterStats.registrationDeadline, 'en')}
                </dd>
              </div>
            )}

            {/* 8 — Offside rule */}
            <Row
              label="Offside"
              value={data.offsideRule ? 'Yes' : 'No'}
              testid="league-details-offside-row"
            />

            {/* 9 — Throw-in vs kick-in */}
            <Row
              label="Sideline restart"
              value={THROW_IN_TYPE_LABELS[data.throwInType]}
              testid="league-details-throw-in-row"
            />

            {/* 10 — Backpass (futsal-only) */}
            {showBackpass && (
              <Row
                label="Backpass rule"
                value={data.backpassRule ? 'Yes' : 'No'}
                testid="league-details-backpass-row"
              />
            )}

            {/* 11 — Substitutions */}
            <Row
              label="Subs"
              value={data.unlimitedSubstitutions ? 'Unlimited' : 'Limited'}
              testid="league-details-subs-row"
            />
          </dl>

          {/* 12 — Organizer message (long text, last) */}
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
