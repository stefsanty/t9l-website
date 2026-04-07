'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

type RsvpStatus = 'GOING' | 'UNDECIDED' | '';

interface RsvpButtonProps {
  matchdayId: string;
  /** Player's current status from sheet data (legacy Y/EXPECTED values also accepted) */
  initialStatus: 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | '';
}

function normalizeStatus(s: string): RsvpStatus {
  if (s === 'GOING' || s === 'Y') return 'GOING';
  if (s === 'UNDECIDED' || s === 'EXPECTED') return 'UNDECIDED';
  return '';
}

export default function RsvpButton({ matchdayId, initialStatus }: RsvpButtonProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const [status, setStatus] = useState<RsvpStatus>(() => normalizeStatus(initialStatus));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  if (!session?.playerId || !session?.teamId) return null;

  async function select(next: RsvpStatus) {
    if (next === status || loading) return;
    const prev = status;
    setStatus(next); // optimistic
    setLoading(true);
    setError(false);

    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchdayId, status: next }),
      });
      if (!res.ok) throw new Error('RSVP failed');
      router.refresh();
    } catch {
      setStatus(prev); // revert
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const options: { value: RsvpStatus; label: string }[] = [
    { value: 'GOING', label: 'Going' },
    { value: 'UNDECIDED', label: 'Undecided' },
    { value: '', label: 'Not going' },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/30">
          Your RSVP
        </span>
        <div className="h-[1px] flex-1 bg-white/10" />
        {loading && (
          <span className="w-3 h-3 border-2 border-white/30 border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      <div className="flex rounded-xl overflow-hidden border border-white/10 bg-white/[0.04]">
        {options.map(({ value, label }) => {
          const isActive = status === value;
          const activeStyles =
            value === 'GOING'
              ? 'bg-electric-green/20 text-electric-green border-electric-green/40'
              : value === 'UNDECIDED'
              ? 'bg-yellow-400/15 text-yellow-400 border-yellow-400/30'
              : 'bg-vibrant-pink/10 text-vibrant-pink/70 border-vibrant-pink/20';

          return (
            <button
              key={value}
              onClick={() => select(value)}
              disabled={loading}
              className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-wider transition-all border-b-2 disabled:opacity-50 active:scale-95 ${
                isActive
                  ? activeStyles
                  : 'text-white/30 border-transparent hover:text-white/50 hover:bg-white/[0.04]'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="text-vibrant-pink text-[11px] mt-2">
          Could not update — try again
        </p>
      )}
    </div>
  );
}
