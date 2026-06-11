'use client'

import { useState } from 'react'
import {
  BALL_TYPE_LABELS,
  GOAL_SIZE_LABELS,
  THROW_IN_TYPE_LABELS,
  GOAL_KICK_TYPE_LABELS,
  formatPlayerFormat,
  type LeagueDetails,
} from '@/lib/leagueDetails'
import type { PlannedRosterStats as PlannedRosterStatsData } from '@/lib/plannedRosterStats'
import { formatJstFriendly } from '@/lib/jst'
import { formatJpyFee } from '@/lib/playerFee'
import { Tabs, type TabDef } from '@/components/ui/Tabs'

/**
 * v1.75.0 — Public League details panel.
 * v1.75.1 — Consolidated: includes planned-roster stats + fee inline.
 *   Decoupled from preseasonMode — renders whenever showLeagueDetails=true.
 *   Collapsible: expanded by default when preseasonMode=true, collapsed
 *   when preseasonMode=false.
 * v1.75.6 — Stats moved to a dedicated bottom subsection separated from
 *   the rule rows. Labels renamed; "Current Players" row removed;
 *   "Matchdays" row added. Season Fee + Register By combined onto one line.
 * v1.75.7 — Rules section text-xs; "Goal size" → "Goal"; "Sideline restart"
 *   → "Sideline"; Goal kick row added (between Sideline and Backpass);
 *   Season Fee/Register By row no longer wraps on iPhone-width viewports.
 * v1.79.4 — Season Fee and Register By as TWO separate rows, each its own
 *   flex justify-between items-baseline div with one dt/dd pair, matching
 *   the same pattern as Teams / Roster Size / Matchdays / Spots Left.
 *   season-fee-row only renders when fee > 0; register-by-row only when
 *   deadline is set.
 * v2.3.0 — Layout reshaped from collapsible accordion to the new shared
 *   <Tabs> primitive (futcal Discover-style underline tabs). Rules /
 *   Season info / Organizer message become tab panels. The v1.75.1
 *   chevron-header + expand/collapse state is gone; the panel is always
 *   open. The Organizer tab only renders when `organizerMessage` is set.
 *   `preseasonMode` now controls the default tab (Season info when true,
 *   Rules otherwise) instead of the collapsed/expanded state.
 *
 * Rules tab order:
 *   1. Player format
 *   2. Match duration
 *   3. Ball type
 *   4. Goal size
 *   5. Offside rule
 *   6. Throw-in / kick-in (Sideline)
 *   7. Goal kick
 *   8. Backpass rule (futsal-only)
 *   9. Unlimited substitutions
 *
 * Season info tab order:
 *   1. Season Fee (own row)
 *   2. Register By (own row)
 *   3. Teams
 *   4. Roster Size
 *   5. Matchdays
 *   6. Spots left
 *
 * Organizer message tab — long text, conditionally rendered.
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
  const showSeasonTab =
    showFee || showPlannedTeams || showPlannedPerTeam || showCurrentAndSpots || showDeadline || showMatchdays

  // Compose the tab list dynamically so empty surfaces don't show empty
  // tabs (e.g. a league with no plannedRosterStats hides Season info).
  const tabs: TabDef[] = []
  tabs.push({ id: 'rules', label: 'Rules', testid: 'league-details-tab-rules' })
  if (showSeasonTab) {
    tabs.push({ id: 'season', label: 'Season info', testid: 'league-details-tab-season' })
  }
  if (showMessage) {
    tabs.push({ id: 'organizer', label: 'From the organizer', testid: 'league-details-tab-organizer' })
  }

  // Preseason leagues default to the Season info tab (when it exists) —
  // that's the more salient panel for a viewer browsing a recruiting
  // league. Classic mode opens Rules.
  const defaultTabId =
    preseasonMode && showSeasonTab ? 'season' : 'rules'
  const [activeId, setActiveId] = useState<string>(defaultTabId)
  const safeActiveId = tabs.some((t) => t.id === activeId) ? activeId : 'rules'

  return (
    <section
      data-testid="league-details-panel"
      className="w-full mt-2 mb-3 rounded-2xl border border-border-default bg-card overflow-hidden"
    >
      <Tabs
        tabs={tabs}
        activeId={safeActiveId}
        onChange={setActiveId}
        ariaLabel="League details sections"
        testid="league-details-tabs"
      >
        {(active) => (
          <div className="px-4 pt-4 pb-3" data-testid="league-details-panel-body">
            {active === 'rules' && (
              <dl
                className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs"
                data-testid="league-details-rules-section"
              >
                {showFormat && (
                  <Row
                    label="Format"
                    value={formatPlayerFormat(data.playerFormat as number)}
                    testid="league-details-format-row"
                  />
                )}

                {showDuration && (
                  <Row
                    label="Match length"
                    value={`${data.matchDurationMinutes} min`}
                    testid="league-details-duration-row"
                  />
                )}

                <Row
                  label="Ball"
                  value={BALL_TYPE_LABELS[data.ballType]}
                  testid="league-details-ball-row"
                />

                <Row
                  label="Goal"
                  value={GOAL_SIZE_LABELS[data.goalSize]}
                  testid="league-details-goal-row"
                />

                <Row
                  label="Offside"
                  value={data.offsideRule ? 'Yes' : 'No'}
                  testid="league-details-offside-row"
                />

                <Row
                  label="Sideline"
                  value={THROW_IN_TYPE_LABELS[data.throwInType]}
                  testid="league-details-throw-in-row"
                />

                <Row
                  label="Goal kick"
                  value={GOAL_KICK_TYPE_LABELS[data.goalKickType]}
                  testid="league-details-goal-kick-row"
                />

                {showBackpass && (
                  <Row
                    label="Backpass rule"
                    value={data.backpassRule ? 'Yes' : 'No'}
                    testid="league-details-backpass-row"
                  />
                )}

                <Row
                  label="Subs"
                  value={data.unlimitedSubstitutions ? 'Unlimited' : 'Limited'}
                  testid="league-details-subs-row"
                />
              </dl>
            )}

            {active === 'season' && showSeasonTab && plannedRosterStats && (
              <div data-testid="league-stats-section">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {showFee && (
                    <div
                      className="flex justify-between items-baseline"
                      data-testid="season-fee-row"
                    >
                      <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
                        Season Fee
                      </dt>
                      <dd className="font-display font-black text-fg-high">
                        {formatJpyFee(plannedRosterStats.defaultFee)}
                      </dd>
                    </div>
                  )}

                  {showDeadline && plannedRosterStats.registrationDeadline && (
                    <div
                      className="flex justify-between items-baseline"
                      data-testid="register-by-row"
                    >
                      <dt className="text-fg-mid text-xs uppercase tracking-wider font-bold">
                        Register By
                      </dt>
                      <dd className="font-display font-black text-fg-high">
                        {formatJstFriendly(plannedRosterStats.registrationDeadline, 'en')}
                      </dd>
                    </div>
                  )}
                  {showFee && plannedRosterStats.positionFees.length > 0 && (
                    <p
                      className="col-span-2 text-[10px] text-fg-low leading-snug"
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

                  {showPlannedTeams && (
                    <Row
                      label="Teams"
                      value={String(plannedRosterStats.plannedNumberOfTeams)}
                      testid="planned-teams-row"
                    />
                  )}

                  {showPlannedPerTeam && (
                    <Row
                      label="Roster Size"
                      value={String(plannedRosterStats.plannedPlayersPerTeam)}
                      testid="planned-per-team-row"
                    />
                  )}

                  {showMatchdays && (
                    <Row
                      label="Matchdays"
                      value={String(plannedRosterStats.matchdays)}
                      testid="matchdays-row"
                    />
                  )}

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

            {active === 'organizer' && showMessage && (
              <div data-testid="league-details-organizer-message">
                <p className="text-sm text-fg-high whitespace-pre-line leading-relaxed">
                  {data.organizerMessage}
                </p>
              </div>
            )}
          </div>
        )}
      </Tabs>
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
