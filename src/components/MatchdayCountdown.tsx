'use client';

import { useEffect, useState } from 'react';
import type { Matchday } from '@/types';

function toJSTDate(dateStr: string, timeStr: string): Date | null {
  if (!dateStr || !timeStr) return null;
  // Construct ISO 8601 with JST offset so Date.parse is timezone-aware
  return new Date(`${dateStr}T${timeStr}+09:00`);
}

function formatCountdown(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const weeks = Math.floor(totalMinutes / (7 * 24 * 60));
  const days = Math.floor((totalMinutes % (7 * 24 * 60)) / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const mins = totalMinutes % 60;

  const parts: string[] = [];
  if (weeks) parts.push(`${weeks}w`);
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins && parts.length < 3) parts.push(`${mins}m`);

  if (parts.length === 0) return 'Starting soon';
  return parts.slice(0, 3).join(' ') + ' from now';
}

export default function MatchdayCountdown({ matchday }: { matchday: Matchday }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
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
      <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        Live
      </span>
    );
  }

  return (
    <span className="text-[11px] font-bold text-white/55 tabular-nums">
      {formatCountdown(startDT.getTime() - now.getTime())}
    </span>
  );
}
