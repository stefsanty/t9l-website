'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import type { Team, Player } from '@/types';
import {
  assignButtonLabel,
  assignButtonDisabled,
  unassignButtonLabel,
  unassignButtonDisabled,
} from '@/lib/assignButtonLabel';

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
  // `redirecting` is the gap between API success and AssignPlayerClient
  // unmounting on the destination page. Under the post-cutover Prisma-on-
  // every-JWT auth path that gap is 5–7 seconds — leaving the button on
  // "Saving…" the whole time looks broken. Flip submitting → redirecting
  // the moment the API write succeeds; the button stays disabled but the
  // text becomes a clear "we're navigating" affordance.
  const [redirecting, setRedirecting] = useState(false);
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

      // The API write is the only piece that warrants a "Saving…" affordance.
      // Everything that follows (next-auth update, router.push, destination
      // RSC render) is the "redirecting" phase — clear submit, raise redirect.
      setSubmitting(false);
      setRedirecting(true);

      await update();
      // Pair push + refresh: push initiates client-side navigation; refresh
      // invalidates the client RSC cache so the destination renders against
      // the updated session/Player.lineId rather than the stale cache.
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
      setRedirecting(false);
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

      setUnassigning(false);
      setRedirecting(true);
      setSelectedPlayerId(null);

      await update();
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setUnassigning(false);
      setRedirecting(false);
    }
  }

  return (
    <div className="w-full max-w-lg relative pb-32">
      {/* Close button */}
      <button
        onClick={() => router.push('/')}
        className="absolute top-0 right-0 p-2 text-fg-low hover:text-fg-high transition-colors"
        aria-label="Close"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Header */}
      <div className="mb-8 text-center pt-4">
        <h1 className="font-display text-3xl font-black uppercase tracking-tight text-fg-high">
          {"Who are you?"}
        </h1>
        <p className="text-[11px] text-fg-mid mt-1 uppercase tracking-wider">
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
            className="w-full bg-surface border border-border-subtle rounded-2xl px-12 py-3.5 text-sm text-fg-high placeholder:text-fg-low focus:outline-none focus:border-success/40 focus:bg-surface-md transition-all"
          />
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-low group-focus-within:text-success/60 transition-colors"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-surface-md text-fg-high transition-colors"
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
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid">
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
                            : 'border-border-subtle bg-surface text-fg-high hover:border-border-default hover:text-fg-mid'
                        }`}
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full shrink-0 border-2 transition-colors ${isSelected ? 'border-success bg-success' : 'border-border-default bg-transparent'}`}
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
          <div className="text-center py-10 px-8 bg-surface border border-dashed border-border-subtle rounded-2xl">
            <p className="text-fg-low text-xs">{"No players found matching"} &ldquo;{searchQuery}&rdquo;</p>
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
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 pb-8 bg-header-bg backdrop-blur-xl border-t border-border-subtle">
        <div className="max-w-lg mx-auto space-y-4">
          {error && (
            <p className="text-vibrant-pink text-[11px] text-center font-bold">{error}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => router.push('/')}
              className="flex-1 py-3 rounded-xl border border-border-subtle text-[11px] font-black uppercase tracking-widest text-fg-low hover:text-fg-mid hover:bg-surface transition-all"
            >
              {"Guest"}
            </button>
            <button
              data-testid="assign-confirm-button"
              onClick={handleConfirm}
              disabled={assignButtonDisabled({
                selectedPlayerId,
                submitting,
                unassigning,
                redirecting,
                isAlreadyAssigned,
              })}
              className={`flex-[2] py-3 rounded-xl font-display text-sm font-black uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                isAlreadyAssigned || redirecting
                  ? 'bg-surface-md text-fg-high'
                  : 'bg-electric-green text-black hover:bg-electric-green/90 active:scale-[0.98]'
              }`}
            >
              {assignButtonLabel({
                redirecting,
                isAlreadyAssigned,
                submitting,
                selectedPlayerId,
              })}
            </button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-[9px] text-fg-low uppercase tracking-[0.1em] font-medium">
              {"LINE photo → Avatar"}
            </p>
            {session?.playerId && (
              <button
                data-testid="assign-unassign-button"
                onClick={handleUnassign}
                disabled={unassignButtonDisabled({ submitting, unassigning, redirecting })}
                className="text-[9px] font-black uppercase tracking-widest text-primary/40 hover:text-primary transition-all"
              >
                {unassignButtonLabel({ unassigning, redirecting })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
