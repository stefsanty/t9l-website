'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';

interface RsvpButtonProps {
  matchdayId: string;
  /** Whether the user's team is confirmed (from sheet availability data) */
  initialGoing: boolean;
}

export default function RsvpButton({ matchdayId, initialGoing }: RsvpButtonProps) {
  const { data: session } = useSession();
  const [going, setGoing] = useState(initialGoing);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  if (!session?.playerId || !session?.teamId) return null;

  async function toggle() {
    const next = !going;
    setGoing(next); // optimistic
    setLoading(true);
    setError(false);

    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchdayId, going: next }),
      });
      if (!res.ok) throw new Error('RSVP failed');
    } catch {
      setGoing(!next); // revert
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white/30">
          Your RSVP
        </span>
        <div className="h-[1px] flex-1 bg-white/5" />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={toggle}
          disabled={loading}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12px] font-black uppercase tracking-wider transition-all disabled:opacity-50 active:scale-95 ${
            going
              ? 'bg-electric-green/15 border border-electric-green/40 text-electric-green'
              : 'bg-white/[0.03] border border-white/10 text-white/40 hover:border-white/25 hover:text-white/60'
          }`}
        >
          {loading ? (
            <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className={`w-2 h-2 rounded-full ${going ? 'bg-electric-green shadow-[0_0_8px_rgba(0,255,133,0.7)]' : 'bg-white/20'}`} />
          )}
          {going ? 'Going' : 'Not going'}
        </button>

        {going && (
          <span className="text-[11px] text-white/30 font-medium">
            You&apos;re confirmed for this matchday
          </span>
        )}
      </div>

      {error && (
        <p className="text-vibrant-pink text-[11px] mt-2">
          Could not update — try again
        </p>
      )}
    </div>
  );
}
