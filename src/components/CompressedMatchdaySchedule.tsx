'use client'

import type { Matchday, Team } from '@/types'
import { formatJstFriendly } from '@/lib/jst'

/**
 * v1.63.0 — Compressed pre-season matchday schedule.
 *
 * Replaces the "Classic League Homepage" stack (NextMatchdayBanner +
 * MatchdayAvailability + RsvpBar) when `League.preseasonMode === true`.
 * The classic stack is built around a single SELECTED matchday with deep
 * affordances (swipe banner, per-team accordions, RSVP). In pre-season —
 * before the first kickoff and before rosters are firmed up — what
 * players actually want is a vertically compact "all matchdays at a
 * glance" view: when, where, who plays whom, and that's it.
 *
 * Design language is intentionally a quiet sibling of `MatchdayCard` —
 * pl-card surface, magenta accent on the date label, T9L type — but
 * stripped of the heavy banner chrome (no countdown, no action buttons,
 * no per-event tick marks). Goal: every matchday in the season fits on
 * screen on iPhone-width without much scroll.
 *
 * Each matchday row shows:
 *   - MD label + date + venue (single line on desktop, wraps on mobile)
 *   - Per-match sub-rows: kickoff time + home vs away team names
 *
 * No interactivity beyond the existing ThemeToggle / LanguageToggle on
 * the header. The Submit Goal CTA's gate (kickoff has passed) means it
 * effectively never fires in pre-season, so it lives in Dashboard's
 * usual position above this component without needing special handling.
 */

function TeamLogo({ team, teamId }: { team: Team | null; teamId: string }) {
  if (team?.logo) {
    return (
      <img
        src={team.logo}
        alt=""
        aria-hidden
        data-testid={`team-logo-${team.id}`}
        className="w-4 h-4 rounded-sm object-contain shrink-0"
      />
    )
  }
  const initials = (team?.name ?? teamId).slice(0, 1).toUpperCase()
  return (
    <span
      data-testid={`team-logo-placeholder-${team?.id ?? teamId}`}
      className="w-4 h-4 rounded-sm bg-fg-low/30 flex items-center justify-center shrink-0 text-[8px] font-black text-fg-mid"
    >
      {initials}
    </span>
  )
}

interface CompressedMatchdayScheduleProps {
  matchdays: Matchday[]
  teams: Team[]
}

export default function CompressedMatchdaySchedule({
  matchdays,
  teams,
}: CompressedMatchdayScheduleProps) {
  const teamById = new Map(teams.map((t) => [t.id, t]))

  if (matchdays.length === 0) {
    return (
      <section
        data-testid="compressed-matchday-schedule"
        className="animate-in pl-card pl-card-magenta rounded-3xl bg-card p-6 text-center"
      >
        <p className="font-display text-2xl font-black uppercase text-fg-high">
          Schedule TBD
        </p>
        <p className="text-xs text-fg-mid font-bold uppercase tracking-widest mt-1">
          Matchdays will appear here once announced
        </p>
      </section>
    )
  }

  return (
    <section
      data-testid="compressed-matchday-schedule"
      className="animate-in space-y-2"
    >
      <div className="px-1 mb-2">
        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-fg-mid">
          Planned season schedule
        </p>
      </div>

      {matchdays.map((md) => {
        const dateLabel = md.date ? formatJstFriendly(md.date, 'en') : 'TBD'
        const venueName = md.venueName ?? 'TBD'

        return (
          <div
            key={md.id}
            data-testid={`compressed-md-${md.id}`}
            className="pl-card pl-card-magenta rounded-2xl bg-card relative overflow-hidden"
          >
            <div className="absolute inset-0 bg-diagonal-pattern opacity-[0.03] pointer-events-none" />

            <div className="relative px-4 py-3">
              {/* Header line: MD label · date · venue */}
              <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mb-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-fg-low/20 border border-fg-low/30">
                  <span className="text-[10px] font-black uppercase tracking-[0.15em] text-fg-mid">
                    {md.label}
                  </span>
                </span>
                <span className="font-display text-base font-black uppercase tracking-tight text-fg-high leading-none">
                  {dateLabel}
                </span>
                {md.venueUrl ? (
                  <a
                    href={md.venueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold text-vibrant-pink/80 hover:text-vibrant-pink transition-colors"
                  >
                    · {venueName} ↗
                  </a>
                ) : (
                  <span className="text-[11px] font-bold text-vibrant-pink/80">
                    · {venueName}
                  </span>
                )}
              </div>

              {/* Per-match sub-rows */}
              <div className="space-y-1">
                {md.matches.map((match) => {
                  const home = teamById.get(match.homeTeamId)
                  const away = teamById.get(match.awayTeamId)
                  return (
                    <div
                      key={match.id}
                      className="flex items-center gap-3 text-[13px] leading-tight"
                    >
                      <span className="font-mono font-bold text-fg-mid w-12 shrink-0 tabular-nums">
                        {match.kickoff || '—'}
                      </span>
                      <span
                        className="flex items-center gap-1 font-display font-black uppercase tracking-tight text-fg-high truncate"
                        translate="no"
                      >
                        <TeamLogo team={home ?? null} teamId={match.homeTeamId} />
                        {home?.name ?? match.homeTeamId}
                      </span>
                      <span className="text-fg-low font-bold text-[10px] uppercase tracking-widest shrink-0">
                        vs
                      </span>
                      <span
                        className="flex items-center gap-1 font-display font-black uppercase tracking-tight text-fg-high truncate"
                        translate="no"
                      >
                        <TeamLogo team={away ?? null} teamId={match.awayTeamId} />
                        {away?.name ?? match.awayTeamId}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })}
    </section>
  )
}
