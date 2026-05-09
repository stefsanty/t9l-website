'use client'

import { useEffect, useState } from 'react'
import type { Matchday } from '@/types'
import { jstIsoString } from '@/lib/jst'

/**
 * v1.83.1 — Preseason "League starts in X days" banner above
 * `<LeagueDetailsPanel>`. Renders only while `now < firstMatchday.start`;
 * hides itself once the first matchday's kickoff has passed (the
 * matchday-level `<MatchdayCountdown>` takes over from there).
 *
 * Pure compute is split out so unit tests can pin behavior without
 * touching `useEffect` / `setInterval`.
 */
export type CountdownDisplay =
  | { unit: 'days'; value: number }
  | { unit: 'hours'; value: number }
  | { unit: 'minutes'; value: number }

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function firstMatchdayStartInstant(matchday: Matchday): Date | null {
  if (!matchday.date) return null
  const first = matchday.matches[0]
  if (!first || !first.kickoff) return null
  return new Date(jstIsoString(matchday.date, first.kickoff))
}

export function computeLeagueStartCountdown(
  start: Date,
  now: Date,
): CountdownDisplay | null {
  const diffMs = start.getTime() - now.getTime()
  if (diffMs <= 0) return null
  if (diffMs < HOUR_MS) {
    return { unit: 'minutes', value: Math.max(1, Math.ceil(diffMs / MINUTE_MS)) }
  }
  if (diffMs < DAY_MS) {
    return { unit: 'hours', value: Math.max(1, Math.ceil(diffMs / HOUR_MS)) }
  }
  return { unit: 'days', value: Math.max(1, Math.ceil(diffMs / DAY_MS)) }
}

export function formatLeagueStartCopy(d: CountdownDisplay): string {
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
  return `League starts in ${d.value} ${noun}`
}

interface Props {
  firstMatchday: Matchday | null
}

export default function LeagueStartCountdown({ firstMatchday }: Props) {
  // Re-render every 60s. Day-level resolution doesn't need a per-second tick
  // and a 1Hz interval is wasteful on mobile.
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), MINUTE_MS)
    return () => clearInterval(id)
  }, [])

  if (!firstMatchday) return null
  const start = firstMatchdayStartInstant(firstMatchday)
  if (!start) return null

  const display = computeLeagueStartCountdown(start, now)
  if (!display) return null

  return (
    <section
      data-testid="league-start-countdown"
      data-unit={display.unit}
      data-value={display.value}
      className="w-full mt-2 mb-3 rounded-2xl border border-vibrant-pink/60 bg-gradient-to-r from-vibrant-pink to-orange-500 px-4 py-4 text-center relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-diagonal-pattern opacity-10 pointer-events-none" />
      <p
        data-testid="league-start-countdown-copy"
        className="font-display text-3xl font-black uppercase tracking-tight text-white leading-tight tabular-nums relative"
        translate="no"
      >
        {formatLeagueStartCopy(display)}
      </p>
    </section>
  )
}
