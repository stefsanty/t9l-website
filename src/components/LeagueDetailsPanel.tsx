'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  BALL_TYPE_LABELS,
  GOAL_SIZE_LABELS,
  THROW_IN_TYPE_LABELS,
  GOAL_KICK_TYPE_LABELS,
  SKILL_LEVEL_LABELS,
  SHINGUARD_POLICY_LABELS,
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
 * v1.75.7 — Rules section text-xs; "Goal size" → "Goal"; "Sideline restart"
 *   → "Sideline"; Goal kick row added (between Sideline and Backpass);
 *   Season Fee/Register By row no longer wraps on iPhone-width viewports.
 * v1.79.4 — Season Fee and Register By as TWO separate rows, each its own
 *   flex justify-between items-baseline div with one dt/dd pair, matching
 *   the same pattern as Teams / Roster Size / Matchdays / Spots Left.
 *   season-fee-row only renders when fee > 0; register-by-row only when
 *   deadline is set.
 * v1.81.0 — League details extras: Skill level, Shoes, Shinguards (top
 *   section, with player-facing metadata) + Total matches (bottom stats
 *   grid, distinct from matchdays count). All four render "TBD" when
 *   unset rather than hiding the row, matching the matchday-TBD pattern
 *   used elsewhere on the homepage. Season Fee row gains a small caption
 *   explaining what the fee covers.
 *
 * Rules section order:
 *   1. Player format
 *   2. Match duration
 *   3. Skill level                 (v1.81.0)
 *   4. Ball type
 *   5. Goal size
 *   6. Shoes                       (v1.81.0)
 *   7. Shinguards                  (v1.81.0)
 *   8. Offside rule
 *   9. Throw-in / kick-in (Sideline)
 *  10. Goal kick
 *  11. Backpass rule (futsal-only)
 *  12. Unlimited substitutions
 *  13. Organizer message (long text)
 *
 * Season info subsection (bottom, separated by divider):
 *   1. Season Fee (own row) + caption (referee fee, equipment, league
 *                                      management costs)             (v1.81.0)
 *   2. Register By (own row)
 *   3. Teams
 *   4. Roster Size
 *   5. Matchdays
 *   6. Total matches               (v1.81.0)
 *   7. Spots left
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

  // v1.81.0 — Extras render values for TBD-fallback rows.
  const skillLevelValue = data.skillLevel ? SKILL_LEVEL_LABELS[data.skillLevel] : 'TBD'
  const shoeTypesValue = data.shoeTypes.length > 0 ? data.shoeTypes.join(', ') : 'TBD'
  const shinguardValue = data.shinguardPolicy ? SHINGUARD_POLICY_LABELS[data.shinguardPolicy] : 'TBD'
  const totalMatchesValue = data.totalMatches != null ? String(data.totalMatches) : 'TBD'

  // Season info section visibility gates.
  const showPlannedTeams = !!plannedRosterStats && plannedRosterStats.plannedNumberOfTeams > 0
  const showPlannedPerTeam = !!plannedRosterStats && plannedRosterStats.plannedPlayersPerTeam > 0
  const showCurrentAndSpots = showPlannedTeams && showPlannedPerTeam
  const showDeadline = !!plannedRosterStats && plannedRosterStats.registrationDeadline !== null
  const showMatchdays = !!plannedRosterStats && plannedRosterStats.matchdays > 0
  const showFee =
    !!plannedRosterStats &&
    (plannedRosterStats.defaultFee > 0 || plannedRosterStats.positionFees.length > 0)
  // v1.81.0 — Stats section now always renders to host the always-visible
  // Total matches row (TBD-fallback). Existing per-row gates preserved
  // for the rows that still hide on null/zero (Fee / Register By / Teams /
  // Roster Size / Matchdays / Spots).
  const showStatsSection = true

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
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs" data-testid="league-details-rules-section">
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

            {/* 3 — Skill level (v1.81.0; TBD when unset) */}
            <Row
              label="Skill level"
              value={skillLevelValue}
              testid="league-details-skill-level-row"
            />

            {/* 4 — Ball type */}
            <Row
              label="Ball"
              value={BALL_TYPE_LABELS[data.ballType]}
              testid="league-details-ball-row"
            />

            {/* 5 — Goal size */}
            <Row
              label="Goal"
              value={GOAL_SIZE_LABELS[data.goalSize]}
              testid="league-details-goal-row"
            />

            {/* 6 — Shoes (v1.81.0; TBD when none selected) */}
            <Row
              label="Shoes"
              value={shoeTypesValue}
              testid="league-details-shoe-types-row"
            />

            {/* 7 — Shinguards (v1.81.0; TBD when unset) */}
            <Row
              label="Shinguards"
              value={shinguardValue}
              testid="league-details-shinguard-row"
            />

            {/* 8 — Offside rule */}
            <Row
              label="Offside"
              value={data.offsideRule ? 'Yes' : 'No'}
              testid="league-details-offside-row"
            />

            {/* 6 — Throw-in vs kick-in */}
            <Row
              label="Sideline"
              value={THROW_IN_TYPE_LABELS[data.throwInType]}
              testid="league-details-throw-in-row"
            />

            {/* 7 — Goal kick */}
            <Row
              label="Goal kick"
              value={GOAL_KICK_TYPE_LABELS[data.goalKickType]}
              testid="league-details-goal-kick-row"
            />

            {/* 8 — Backpass (futsal-only) */}
            {showBackpass && (
              <Row
                label="Backpass rule"
                value={data.backpassRule ? 'Yes' : 'No'}
                testid="league-details-backpass-row"
              />
            )}

            {/* 9 — Substitutions */}
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

          {/* Season info — bottom subsection, separated by a divider.
              v1.81.0 — Always rendered to host the Total matches TBD-fallback
              row; pre-existing rows keep their per-row gates. */}
          {showStatsSection && (
            <div
              className="mt-3 pt-3 border-t border-border-subtle"
              data-testid="league-stats-section"
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {plannedRosterStats && (
                  <>
                    {/* Season Fee */}
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

                    {/* Register By */}
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

                    {/* v1.81.0 — Season Fee caption. Placed directly below
                        the fee+register-by row so the explanation reads as
                        attached to the Season Fee column (left). */}
                    {showFee && (
                      <p
                        className="col-span-2 text-[10px] text-fg-low leading-snug -mt-0.5"
                        data-testid="season-fee-caption"
                      >
                        Covers referee fee, equipment, and league management costs.
                      </p>
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
                  </>
                )}

                {/* Total matches (v1.81.0; always renders, TBD when unset).
                    Distinct from `Matchdays` — a matchday hosts multiple
                    matches, so totalMatches is the season-wide sum. */}
                <Row
                  label="Total Matches"
                  value={totalMatchesValue}
                  testid="total-matches-row"
                />

                {/* Spots left — gated on both planned targets being non-zero */}
                {plannedRosterStats && showCurrentAndSpots && (
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
