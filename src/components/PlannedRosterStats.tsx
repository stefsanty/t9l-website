'use client'

import type { PlannedRosterStats } from '@/lib/plannedRosterStats'
import { formatJstFriendly } from '@/lib/jst'

/**
 * v1.67.0 — Public planned-roster stats panel.
 *
 * Renders between RecruitingBanner and CompressedMatchdaySchedule on
 * the homepage when:
 *   - `preseasonMode === true` (homepage shows the planned schedule)
 *   - `recruiting === true` (recruiting banner is visible above)
 *   - viewer is authenticated (server gates by passing `null` when
 *     `session.userId` is null)
 *
 * Hides individual rows when their value is 0 / null:
 *   - `plannedNumberOfTeams === 0`        → hide "Planned teams" row
 *   - `plannedPlayersPerTeam === 0`       → hide "Planned players per team"
 *   - `registrationDeadline === null`     → hide "Registration deadline"
 *
 * "Current players" + "Spots left" always render — once the league
 * has any planned target set, they're useful even if zero.
 *
 * If ALL stats are zero/null (the admin never filled anything in),
 * the panel renders nothing.
 */
interface Props {
  data: PlannedRosterStats
}

export default function PlannedRosterStats({ data }: Props) {
  const showPlannedTeams = data.plannedNumberOfTeams > 0
  const showPlannedPerTeam = data.plannedPlayersPerTeam > 0
  const showDeadline = data.registrationDeadline !== null
  // If nothing is set up, hide the whole panel — no point showing
  // "Current players: 0" with no targets.
  if (!showPlannedTeams && !showPlannedPerTeam && !showDeadline && data.currentPlayers === 0) {
    return null
  }

  return (
    <section
      data-testid="planned-roster-stats"
      className="w-full mt-2 mb-3 rounded-2xl border border-border-default bg-card px-4 py-3"
    >
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-fg-mid mb-2">
        Roster targets
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {showPlannedTeams && (
          <div className="flex justify-between items-baseline" data-testid="planned-teams-row">
            <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
              Planned teams
            </dt>
            <dd className="font-display font-black text-fg-high tabular-nums">
              {data.plannedNumberOfTeams}
            </dd>
          </div>
        )}
        {showPlannedPerTeam && (
          <div className="flex justify-between items-baseline" data-testid="planned-per-team-row">
            <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
              Per team
            </dt>
            <dd className="font-display font-black text-fg-high tabular-nums">
              {data.plannedPlayersPerTeam}
            </dd>
          </div>
        )}
        <div className="flex justify-between items-baseline" data-testid="current-players-row">
          <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
            Current players
          </dt>
          <dd className="font-display font-black text-fg-high tabular-nums">
            {data.currentPlayers}
          </dd>
        </div>
        <div className="flex justify-between items-baseline" data-testid="spots-left-row">
          <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
            Spots left
          </dt>
          <dd className="font-display font-black text-vibrant-pink tabular-nums">
            {data.spotsLeft}
          </dd>
        </div>
        {showDeadline && data.registrationDeadline && (
          <div
            className="col-span-2 flex justify-between items-baseline pt-1.5 mt-0.5 border-t border-border-subtle"
            data-testid="deadline-row"
          >
            <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
              Registration deadline
            </dt>
            <dd className="font-display font-black text-fg-high">
              {formatJstFriendly(data.registrationDeadline, 'en')}
            </dd>
          </div>
        )}
      </dl>
    </section>
  )
}
