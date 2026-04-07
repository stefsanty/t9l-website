'use client';

import { useSession } from 'next-auth/react';
import type { Matchday, AvailabilityStatuses } from '@/types';

function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return 'TBD';
  const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(iso[2], 10) - 1]} ${parseInt(iso[3], 10)}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return dateStr;
}

export default function MyMatchdayCard({
  matchdays,
  availabilityStatuses,
}: {
  matchdays: Matchday[];
  availabilityStatuses: AvailabilityStatuses;
}) {
  const { data: session } = useSession();

  if (!session?.playerId || !session?.teamId) return null;

  // Next matchday where user's team plays (skip rest matchdays)
  const nextPlayingMd = matchdays.find(
    (md) =>
      md.sittingOutTeamId !== session.teamId &&
      md.matches[0].homeGoals === null
  );

  if (!nextPlayingMd) return null;

  const rawStatus =
    availabilityStatuses[nextPlayingMd.id]?.[session.teamId]?.[session.playerId] ?? '';

  const rsvpStatus: 'GOING' | 'UNDECIDED' | null =
    rawStatus === 'Y' || rawStatus === 'GOING' ? 'GOING' :
    rawStatus === 'EXPECTED' || rawStatus === 'UNDECIDED' ? 'UNDECIDED' :
    null;

  return (
    <div className="mb-4 flex items-center justify-between gap-3 bg-white/[0.04] border border-white/10 rounded-2xl px-4 py-3">
      <div className="min-w-0">
        <div className="text-[9px] font-black uppercase tracking-[0.22em] text-white/25 mb-0.5">
          Your next matchday
        </div>
        <div className="font-display text-lg font-black uppercase tracking-tight text-white/90 leading-none">
          {nextPlayingMd.label}
          {nextPlayingMd.date && (
            <span className="text-white/40 font-normal text-sm ml-2 normal-case">
              · {formatShortDate(nextPlayingMd.date)}
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0">
        {rsvpStatus === 'GOING' && (
          <span className="text-[11px] font-black px-3 py-1.5 rounded-full bg-electric-green/15 text-electric-green border border-electric-green/30">
            Going
          </span>
        )}
        {rsvpStatus === 'UNDECIDED' && (
          <span className="text-[11px] font-black px-3 py-1.5 rounded-full bg-yellow-400/15 text-yellow-400 border border-yellow-400/30">
            Undecided
          </span>
        )}
        {!rsvpStatus && (
          <span className="text-[11px] font-black px-3 py-1.5 rounded-full bg-white/[0.07] text-white/30 border border-white/10">
            Not confirmed
          </span>
        )}
      </div>
    </div>
  );
}
