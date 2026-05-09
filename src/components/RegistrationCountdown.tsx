'use client'

import { useEffect, useState } from 'react'

/**
 * v1.83.1 — Pre-season "League registration closes in X days" banner above
 * `<LeagueDetailsPanel>`. Renders only while `now < registrationDeadline`;
 * hides when the deadline has passed or when no deadline is configured on
 * the league. The matchday-card-level `<MatchdayCountdown>` remains the
 * surface for "Live"/in-progress signal once the season has started.
 *
 * Pure compute is split out so unit tests can pin behavior without
 * touching `useEffect` / `setInterval`.
 *
 * Data source: `League.registrationDeadline` (DateTime?), surfaced via
 * `getPlannedRosterStats(...).registrationDeadline` and threaded through
 * `<Dashboard plannedRosterStats={...}>`.
 */
export type CountdownDisplay =
  | { unit: 'days'; value: number }
  | { unit: 'hours'; value: number }
  | { unit: 'minutes'; value: number }

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function computeRegistrationCountdown(
  deadline: Date,
  now: Date,
): CountdownDisplay | null {
  const diffMs = deadline.getTime() - now.getTime()
  if (diffMs <= 0) return null
  if (diffMs < HOUR_MS) {
    return { unit: 'minutes', value: Math.max(1, Math.ceil(diffMs / MINUTE_MS)) }
  }
  if (diffMs < DAY_MS) {
    return { unit: 'hours', value: Math.max(1, Math.ceil(diffMs / HOUR_MS)) }
  }
  return { unit: 'days', value: Math.max(1, Math.ceil(diffMs / DAY_MS)) }
}

export function formatRegistrationCloseCopy(d: CountdownDisplay): string {
  const noun =
    d.unit === 'days'
      ? d.value === 1
        ? 'day'
        : 'days'
      : d.unit === 'hours'
        ? d.value === 1
          ? 'hour'
          : 'hours'
        : d.value === 1
          ? 'minute'
          : 'minutes'
  return `League registration closes in ${d.value} ${noun}`
}

interface Props {
  // Accepts Date or ISO string — Next.js serialization across server →
  // client component boundaries can flatten Date to string in some build paths.
  registrationDeadline: Date | string | null
}

export default function RegistrationCountdown({ registrationDeadline }: Props) {
  // Re-render every 60s. Day-level resolution doesn't need a per-second tick
  // and a 1Hz interval is wasteful on mobile.
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), MINUTE_MS)
    return () => clearInterval(id)
  }, [])

  if (!registrationDeadline) return null
  const deadline =
    registrationDeadline instanceof Date
      ? registrationDeadline
      : new Date(registrationDeadline)
  if (isNaN(deadline.getTime())) return null

  const display = computeRegistrationCountdown(deadline, now)
  if (!display) return null

  return (
    <section
      data-testid="registration-countdown"
      data-unit={display.unit}
      data-value={display.value}
      className="w-full mt-2 mb-3 rounded-xl border border-border-default bg-surface-md px-4 py-3 flex items-center gap-3"
    >
      <svg
        aria-hidden
        className="w-5 h-5 shrink-0 text-fg-mid"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
      </svg>
      <p
        data-testid="registration-countdown-copy"
        className="font-display text-lg font-black uppercase tracking-tight text-fg-high leading-tight tabular-nums"
        translate="no"
      >
        {formatRegistrationCloseCopy(display)}
      </p>
    </section>
  )
}
