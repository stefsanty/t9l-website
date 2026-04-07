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
    <div className="w-full max-w-lg relative pb-32">
      {/* Close button */}
      <button
        onClick={() => router.push('/')}
        className="absolute top-0 right-0 p-2 text-white/30 hover:text-white transition-colors"
        aria-label="Close"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Header */}
      <div className="mb-8 text-center pt-4">
        <h1 className="font-display text-3xl font-black uppercase tracking-tight text-white">
          {"Who are you?"}
        </h1>
        <p className="text-[11px] text-white/60 mt-1 uppercase tracking-wider">
          {"Link your LINE account to your squad entry"}
        </p>
      </div>

      {/* Search and results */}
      <div className="space-y-6">
        <div className="relative group">
          <input
            type="text"
            placeholder={"Search your name..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-12 py-3.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-electric-green/40 focus:bg-white/[0.05] transition-all"
          />
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 group-focus-within:text-electric-green/60 transition-colors"
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

        {hasResults ? (
          <div className="space-y-6">
            {filteredPlayersByTeam.map(({ team, players }) => (
              <div key={team.id}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: team.color }} />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/70">
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
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'border-electric-green/60 bg-electric-green/5 text-electric-green'
                            : 'border-white/5 bg-white/[0.02] text-white/90 hover:border-white/20 hover:text-white/80'
                        }`}
                      >
                        <div
                          className="w-1.5 h-1.5 rounded-full shrink-0 border-2 transition-colors"
                          style={{
                            borderColor: isSelected ? '#00FF85' : 'rgba(255,255,255,0.1)',
                            backgroundColor: isSelected ? '#00FF85' : 'transparent',
                          }}
                        />
                        <div className="min-w-0">
                          <p className="text-[12px] font-bold truncate">{player.name}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 px-8 bg-white/[0.01] border border-dashed border-white/5 rounded-2xl">
            <p className="text-white/40 text-xs">{"No players found matching"} &ldquo;{searchQuery}&rdquo;</p>
            <button
              onClick={() => setSearchQuery('')}
              className="mt-2 text-electric-green/40 hover:text-electric-green text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              {"Clear search"}
            </button>
          </div>
        )}
      </div>

      {/* Fixed bottom actions */}
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-8 bg-[#0A050B]/80 backdrop-blur-xl border-t border-white/5">
        <div className="max-w-lg mx-auto space-y-4">
          {error && (
            <p className="text-vibrant-pink text-[11px] text-center font-bold">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => router.push('/')}
              className="flex-1 py-3 rounded-xl border border-white/10 text-[11px] font-black uppercase tracking-widest text-white/40 hover:text-white/80 hover:bg-white/5 transition-all"
            >
              {"Guest"}
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedPlayerId || submitting || unassigning || isAlreadyAssigned}
              className={`flex-[2] py-3 rounded-xl font-display text-sm font-black uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                isAlreadyAssigned
                  ? 'bg-white/10 text-white/95'
                  : 'bg-electric-green text-black hover:bg-electric-green/90 active:scale-[0.98]'
              }`}
            >
              {submitting
                ? "Saving…"
                : isAlreadyAssigned
                ? "Linked"
                : selectedPlayerId
                ? "Confirm"
                : "Select Player"}
            </button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-[9px] text-white/30 uppercase tracking-[0.1em] font-medium">
              {"LINE photo → Avatar"}
            </p>
            {session?.playerId && (
              <button
                onClick={handleUnassign}
                disabled={submitting || unassigning}
                className="text-[9px] font-black uppercase tracking-widest text-vibrant-pink/40 hover:text-vibrant-pink transition-all"
              >
                {unassigning ? "Removing…" : "Unassign Profile"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
