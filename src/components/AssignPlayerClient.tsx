'use client';

import { useState, useEffect, useTransition } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { Team, Player } from '@/types';
import {
  assignButtonLabel,
  assignButtonDisabled,
  unassignButtonLabel,
  unassignButtonDisabled,
} from '@/lib/assignButtonLabel';
import { attemptLink, attemptUnlink } from '@/lib/optimisticLink';
import { notifyLinkOutcome, notifyUnlinkOutcome } from '@/lib/assignToast';

interface Props {
  playersByTeam: { team: Team; players: Player[] }[];
}

export default function AssignPlayerClient({ playersByTeam }: Props) {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [, startTransition] = useTransition();
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

    setError(null);
    setSubmitting(true);

    // Auto-navigate on success (v1.6.0): the inline success view + Go-home
    // button (PR 13 / v1.4.0) added a friction step the user wanted gone.
    // Now: API write → toast.success + router.push('/') in one go. The
    // toast persists across navigation because <Toaster /> lives at the
    // root layout level. On failure, the user stays on /assign-player and
    // sees an error toast for retry.
    const result = await attemptLink(selectedPlayerId);
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      notifyLinkOutcome(result, toast);
      return;
    }

    // Fire the next-auth refresh so the destination renders with a fresh
    // JWT (PR 11 / v1.3.0 fire-and-forget pattern). The toast + push are
    // not gated on this — under cold-most-of-the-time, awaiting it would
    // re-introduce the multi-second hang we removed.
    update().catch((err) => {
      console.warn('[assign] background session refresh failed:', err);
    });

    notifyLinkOutcome(result, toast);
    startTransition(() => {
      router.push('/');
    });
  }

  async function handleUnassign() {
    if (!session?.playerId) return;
    setUnassigning(true);
    setError(null);

    const result = await attemptUnlink();
    if (!result.ok) {
      setError(result.error);
      setUnassigning(false);
      notifyUnlinkOutcome(result, toast);
      return;
    }

    setSelectedPlayerId(null);
    setUnassigning(false);

    update().catch((err) => {
      console.warn('[assign] background session refresh failed:', err);
    });

    notifyUnlinkOutcome(result, toast);
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
                    // Linked players are filtered out server-side in
                    // src/app/assign-player/page.tsx (PR 15 / v1.4.3) — the
                    // picker shows only players the viewer can actually pick.
                    return (
                      <button
                        key={player.id}
                        data-testid={`assign-player-row-${player.id}`}
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
                isAlreadyAssigned,
              })}
              className={`flex-[2] py-3 rounded-xl font-display text-sm font-black uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                isAlreadyAssigned
                  ? 'bg-surface-md text-fg-high'
                  : 'bg-electric-green text-black hover:bg-electric-green/90 active:scale-[0.98]'
              }`}
            >
              {assignButtonLabel({
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
                disabled={unassignButtonDisabled({ submitting, unassigning })}
                className="text-[9px] font-black uppercase tracking-widest text-primary/40 hover:text-primary transition-all"
              >
                {unassignButtonLabel({ unassigning })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
