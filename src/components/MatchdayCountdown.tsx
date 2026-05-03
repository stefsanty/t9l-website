'use client';

import { useEffect, useState } from 'react';
import type { Matchday } from '@/types';
import { jstIsoString } from '@/lib/jst';

/**
 * T9L matches are 33 minutes per CLAUDE.md "Important Notes". The countdown
 * uses this to estimate matchday end when the LAST match's `fullTime` is
 * missing in DB (i.e. `Match.endedAt IS NULL`) — see `computeMatchdayBoundsJst`.
 */
const MATCH_DURATION_MS = 33 * 60 * 1000;

/**
 * Conservative fallback when the last match's kickoff is also missing — covers
 * a 3-match T9L matchday with stagger (19:05 / 19:40 / 20:15 + 33min ≈ 20:48,
 * roughly 1h45m). 3h gives generous slack.
 */
const FALLBACK_MATCHDAY_DURATION_MS = 3 * 60 * 60 * 1000;

function toJSTDate(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  return new Date(jstIsoString(dateStr, timeStr));
}

/**
 * Compute the JST start + end Date instants for a matchday.
 *
 * v1.41.4 — pre-fix the countdown bailed entirely when the last match had no
 * `fullTime` (which is empty whenever `Match.endedAt` is null in DB). After
 * v1.21.0 removed the FT picker, no admin UI sets `endedAt`, so newly created
 * matchdays universally had no countdown. This helper falls back to
 * `last_kickoff + 33min` (T9L match duration) and finally to
 * `start + FALLBACK_MATCHDAY_DURATION_MS` so countdowns render whenever we
 * have at least the first match's kickoff time.
 *
 * Pure for testability — no `useState`, no `setInterval`, no DOM.
 */
export function computeMatchdayBoundsJst(matchday: Matchday): {
  start: Date;
  end: Date;
} | null {
  if (!matchday.date || matchday.matches.length === 0) return null;

  const first = matchday.matches[0];
  const last = matchday.matches[matchday.matches.length - 1];

  const start = toJSTDate(matchday.date, first.kickoff);
  if (!start) return null;

  // Preferred: explicit fullTime on the last match (legacy backfill data).
  let end = toJSTDate(matchday.date, last.fullTime);

  // Fallback 1: last kickoff + 33min (works for any matchday whose admin
  // entered kickoff times, which is the v1.21.0 schedule editor's default).
  if (!end) {
    const lastStart = toJSTDate(matchday.date, last.kickoff);
    if (lastStart) {
      end = new Date(lastStart.getTime() + MATCH_DURATION_MS);
    }
  }

  // Fallback 2: degenerate case where last kickoff is also missing — anchor
  // on first kickoff + 3h so the countdown still renders pre-matchday and
  // hides itself shortly afterward.
  if (!end) {
    end = new Date(start.getTime() + FALLBACK_MATCHDAY_DURATION_MS);
  }

  return { start, end };
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const weeks = Math.floor(totalMinutes / (7 * 24 * 60));
  const days = Math.floor((totalMinutes % (7 * 24 * 60)) / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const mins = totalMinutes % 60;
  const secs = totalSeconds % 60;

  const parts: string[] = [];
  if (weeks) parts.push(`${weeks}w`);
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins) parts.push(`${mins}m`);
  if (secs && parts.length < 4) parts.push(`${secs}s`);

  if (parts.length === 0) return 'Starting soon';
  return parts.slice(0, 4).join(' ') + ' from now';
}

export default function MatchdayCountdown({ matchday }: { matchday: Matchday }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const bounds = computeMatchdayBoundsJst(matchday);
  if (!bounds) return null;
  const { start: startDT, end: endDT } = bounds;

  if (now > endDT) return null;

  if (now >= startDT) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-400" translate="no">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Live
      </span>
    );
  }

  return (
    <span className="text-[11px] font-bold tabular-nums" translate="no">
      {formatCountdown(startDT.getTime() - now.getTime())}
    </span>
  );
}
