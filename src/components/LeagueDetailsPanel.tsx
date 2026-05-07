'use client'

import {
  BALL_TYPE_LABELS,
  GOAL_SIZE_LABELS,
  THROW_IN_TYPE_LABELS,
  formatPlayerFormat,
  type LeagueDetails,
} from '@/lib/leagueDetails'

/**
 * v1.75.0 — Public League details panel.
 *
 * Renders below `PlannedRosterStats` on the preseason homepage when:
 *   - `preseasonMode === true` (the homepage is in preseason mode)
 *   - `showLeagueDetails === true` (admin opted in to surfacing the
 *     panel — the data helper returns null when this flag is off, so
 *     receiving non-null `data` here implies the flag is on)
 *
 * Hides individual rows when:
 *   - The matching field is null (matchDurationMinutes, playerFormat).
 *   - The "Backpass rule" row hides when ballType !== FUTSAL.
 *
 * Booleans surface as "Yes/No". Enums surface via the per-field label
 * map. Organizer message renders below the stats grid as a paragraph
 * with `whitespace-pre-line` so admin-entered newlines survive.
 */
interface Props {
  data: LeagueDetails
}

export default function LeagueDetailsPanel({ data }: Props) {
  const showBackpass = data.ballType === 'FUTSAL'
  const showDuration = data.matchDurationMinutes != null
  const showFormat = data.playerFormat != null
  const showMessage =
    data.organizerMessage != null && data.organizerMessage.trim() !== ''

  return (
    <section
      data-testid="league-details-panel"
      className="w-full mt-2 mb-3 rounded-2xl border border-border-default bg-card px-4 py-3"
    >
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-fg-mid mb-2">
        League details
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <Row label="Ball" value={BALL_TYPE_LABELS[data.ballType]} testid="league-details-ball-row" />
        <Row label="Goal size" value={GOAL_SIZE_LABELS[data.goalSize]} testid="league-details-goal-row" />
        <Row
          label="Sideline restart"
          value={THROW_IN_TYPE_LABELS[data.throwInType]}
          testid="league-details-throw-in-row"
        />
        <Row
          label="Offside"
          value={data.offsideRule ? 'Yes' : 'No'}
          testid="league-details-offside-row"
        />
        {showBackpass && (
          <Row
            label="Backpass rule"
            value={data.backpassRule ? 'Yes' : 'No'}
            testid="league-details-backpass-row"
          />
        )}
        {showDuration && (
          <Row
            label="Match length"
            value={`${data.matchDurationMinutes} min`}
            testid="league-details-duration-row"
          />
        )}
        {showFormat && (
          <Row
            label="Format"
            value={formatPlayerFormat(data.playerFormat as number)}
            testid="league-details-format-row"
          />
        )}
        <Row
          label="Subs"
          value={data.unlimitedSubstitutions ? 'Unlimited' : 'Limited'}
          testid="league-details-subs-row"
        />
      </dl>

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
