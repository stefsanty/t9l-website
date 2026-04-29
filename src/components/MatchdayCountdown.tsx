'use client';

import { useEffect, useState } from 'react';
import type { Matchday } from '@/types';
import { jstIsoString } from '@/lib/jst';

function toJSTDate(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  return new Date(jstIsoString(dateStr, timeStr));
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

  if (!matchday.date || matchday.matches.length === 0) return null;

  const startDT = toJSTDate(matchday.date, matchday.matches[0].kickoff);
  const endDT = toJSTDate(
    matchday.date,
    matchday.matches[matchday.matches.length - 1].fullTime
  );

  if (!startDT || !endDT) return null;

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
