'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import type { Team, Player } from '@/types';

interface Props {
  playersByTeam: { team: Team; players: Player[] }[];
}

export default function AssignPlayerClient({ playersByTeam }: Props) {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(
    session?.playerId ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!selectedPlayerId) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/assign-player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: selectedPlayerId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Assignment failed');
      }

      // Refresh the NextAuth JWT so the session picks up the new player
      await update();
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-lg">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="font-display text-4xl font-black uppercase tracking-tight text-white">
          Who are you?
        </h1>
        <p className="text-sm text-white/40 mt-2">
          Select your player profile. This links your LINE account to your squad entry.
        </p>
      </div>

      {/* Team sections */}
      <div className="space-y-6">
        {playersByTeam.map(({ team, players }) => (
          <div key={team.id}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
              <span className="text-[11px] font-black uppercase tracking-[0.25em] text-white/40">
                {team.name}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {players.map((player) => {
                const isSelected = selectedPlayerId === player.id;
                return (
                  <button
                    key={player.id}
                    onClick={() => setSelectedPlayerId(player.id)}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'border-electric-green/60 bg-electric-green/5 text-electric-green'
                        : 'border-white/5 bg-white/[0.02] text-white/60 hover:border-white/20 hover:text-white/80'
                    }`}
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0 border-2 transition-colors"
                      style={{
                        borderColor: isSelected ? '#00FF85' : 'rgba(255,255,255,0.15)',
                        backgroundColor: isSelected ? '#00FF85' : 'transparent',
                      }}
                    />
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold truncate">{player.name}</p>
                      {player.position && (
                        <p className="text-[10px] font-black uppercase tracking-wider opacity-50">
                          {player.position}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Confirm button */}
      <div className="mt-8 pb-12">
        {error && (
          <p className="text-vibrant-pink text-sm text-center mb-4">{error}</p>
        )}
        <button
          onClick={handleConfirm}
          disabled={!selectedPlayerId || submitting}
          className="w-full py-4 rounded-2xl font-display text-lg font-black uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed bg-electric-green text-black hover:bg-electric-green/90 active:scale-[0.98]"
        >
          {submitting ? 'Saving\u2026' : selectedPlayerId ? "Confirm \u2014 I\u2019m this player" : 'Select a player above'}
        </button>

        <p className="text-[10px] text-white/20 text-center mt-4 uppercase tracking-widest">
          Your LINE profile photo will be used as your avatar
        </p>
      </div>
    </div>
  );
}
