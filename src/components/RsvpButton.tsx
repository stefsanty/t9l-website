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
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-fg-mid">
          {"Are you coming?"}
        </span>
        <div className="h-[1px] flex-1 bg-surface-md" />
        {loading && (
          <span className="w-3 h-3 border-2 border-border-default border-t-transparent rounded-full animate-spin" />
        )}
      </div>

      <div className="flex gap-2">
        {options.map(({ value, label }) => {
          const isActive = status === value;
          const activeStyles =
            value === 'GOING'
              ? 'bg-success/15 text-success border-success/40'
              : value === 'UNDECIDED'
              ? 'bg-warning/15 text-warning border-warning/40'
              : 'bg-vibrant-pink/15 text-vibrant-pink border-vibrant-pink/30 shadow-[var(--glow-primary-subtle)]';

          return (
            <button
              key={value}
              onClick={() => select(value)}
              disabled={loading}
              className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border disabled:opacity-50 active:scale-95 ${
                isActive
                  ? activeStyles
                  : 'bg-surface text-fg-mid border-border-subtle hover:bg-surface-md hover:text-fg-mid hover:border-border-default'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="text-vibrant-pink text-[11px] mt-2">
          Error saving RSVP. Try again.
        </p>
      )}
    </div>
  );
}