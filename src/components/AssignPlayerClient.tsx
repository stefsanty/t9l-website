'use client';

import { useState, useEffect } from 'react';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selected player with session when it loads
  useEffect(() => {
    if (session?.playerId && !selectedPlayerId) {
      setSelectedPlayerId(session.playerId);
    }
  }, [session?.playerId, selectedPlayerId]);

  const isAlreadyAssigned = session?.playerId === selectedPlayerId && !!selectedPlayerId;

  const filteredPlayersByTeam = playersByTeam.map(({ team, players }) => ({
    team,
    players: players.filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(group => group.players.length > 0);

  const hasResults = filteredPlayersByTeam.length > 0;

  async function handleConfirm() {
    if (!selectedPlayerId || isAlreadyAssigned) return;
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

      await update();
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  async function handleUnassign() {
    if (!session?.playerId) return;
    setUnassigning(true);
    setError(null);

    try {
      const res = await fetch('/api/assign-player', {
        method: 'DELETE',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Unassignment failed');
      }

      await update();
      setSelectedPlayerId(null);
      setUnassigning(false);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setUnassigning(false);
    }
  }

  return (
    <div className="w-full max-w-lg">
      {/* Header */}
      <div className="mb-8 text-center">
        <h1 className="font-display text-4xl font-black uppercase tracking-tight text-white">
          {"Who are you?"}
        </h1>
        <p className="text-sm text-white/95 mt-2">
          {"Select your player profile. This links your LINE account to your squad entry."}
        </p>
      </div>

      {/* Search and results */}
      <div className="space-y-6">
        <div className="relative group">
          <input
            type="text"
            placeholder={"Search your name (e.g. 'St')"}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-12 py-4 text-white placeholder:text-white/65 focus:outline-none focus:border-electric-green/40 focus:bg-white/[0.05] transition-all"
          />
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/65 group-focus-within:text-electric-green/60 transition-colors"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/10 text-white/95 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-4">
          {error && (
            <p className="text-vibrant-pink text-sm text-center">{error}</p>
          )}

          <div className="flex flex-col gap-3">
            <button
              onClick={handleConfirm}
              disabled={!selectedPlayerId || submitting || unassigning || isAlreadyAssigned}
              className={`w-full py-4 rounded-2xl font-display text-lg font-black uppercase tracking-wider transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                isAlreadyAssigned
                  ? 'bg-white/10 text-white/95'
                  : 'bg-electric-green text-black hover:bg-electric-green/90 active:scale-[0.98]'
              }`}
            >
              {submitting
                ? "Saving…"
                : isAlreadyAssigned
                ? "This is you"
                : selectedPlayerId
                ? "Confirm — I’m this player"
                : "Select a player below"}
            </button>

            <button
              onClick={() => router.push('/')}
              className="w-full py-3 rounded-xl border border-white/10 text-[11px] font-black uppercase tracking-[0.2em] text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
            >
              {"Skip — Browse as Guest"}
            </button>
          </div>

          {session?.playerId && (
            <button
              onClick={handleUnassign}
              disabled={submitting || unassigning}
              className="w-full py-2 text-[11px] font-black uppercase tracking-widest text-vibrant-pink/40 hover:text-vibrant-pink transition-all"
            >
              {unassigning ? "Removing…" : "Unassign current player"}
            </button>
          )}

          <p className="text-[9px] text-white/40 text-center uppercase tracking-widest">
            {"Your LINE profile photo will be used as your avatar"}
          </p>
        </div>

        {hasResults ? (
          <div className="space-y-6">
            {filteredPlayersByTeam.map(({ team, players }) => (
              <div key={team.id}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                  <span className="text-[11px] font-black uppercase tracking-[0.25em] text-white/95">
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
                            : 'border-white/5 bg-white/[0.02] text-white/95 hover:border-white/20 hover:text-white/80'
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
        ) : (
          <div className="text-center py-12 px-8 bg-white/[0.02] border border-dashed border-white/10 rounded-2xl">
            <p className="text-white/95 text-sm">{"No players found matching"} &ldquo;{searchQuery}&rdquo;</p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-electric-green/60 hover:text-electric-green text-xs font-bold uppercase tracking-widest transition-colors"
            >
              {"Clear search"}
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
