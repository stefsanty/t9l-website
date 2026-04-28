'use client';

import { useState, useEffect, useTransition, useOptimistic, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import type { Team, Player } from '@/types';
import {
  assignButtonLabel,
  assignButtonDisabled,
  unassignButtonLabel,
  unassignButtonDisabled,
} from '@/lib/assignButtonLabel';
import {
  attemptLink,
  attemptUnlink,
  type LinkedState,
  type LinkAttemptResult,
} from '@/lib/optimisticLink';

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

  // Optimistic linkage. `committedLinked` is the post-API-success state.
  // `optimisticLinked` flips synchronously the moment the user clicks
  // Confirm — it's the regression target for the <50ms perceived assertion.
  // If the API fails, we never call setCommittedLinked; the surrounding
  // transition completes and `useOptimistic` reverts to the committed value
  // (null), bouncing the user back to the form view.
  const [committedLinked, setCommittedLinked] = useState<LinkedState | null>(null);
  const [optimisticLinked, addOptimisticLinked] = useOptimistic<
    LinkedState | null,
    LinkedState | null
  >(committedLinked, (_, next) => next);

  // The Go-home button must not navigate the user to `/` before their JWT
  // reflects the new linkage — otherwise the destination renders stale
  // "Playing as: …" data. We track the in-flight API + session-update
  // promises in refs so the Go-home handler can await them only when the
  // user clicks before they settle (typical perception window: 0–3s under
  // cold-most-of-the-time).
  type LinkPipelineResult = LinkAttemptResult;
  const apiPromiseRef = useRef<Promise<LinkPipelineResult> | null>(null);
  const updatePromiseRef = useRef<Promise<unknown> | null>(null);
  const [finalizing, setFinalizing] = useState(false);

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

  // Looks up team metadata for the success view (color badge + team name).
  // Cheap — playersByTeam is already in scope.
  function teamForId(teamId: string): Team | null {
    const group = playersByTeam.find((g) => g.team.id === teamId);
    return group?.team ?? null;
  }

  async function handleConfirm() {
    if (!selectedPlayerId || isAlreadyAssigned) return;

    const flat = playersByTeam.flatMap((g) => g.players);
    const player = flat.find((p) => p.id === selectedPlayerId);
    if (!player) return;

    const optimistic: LinkedState = {
      playerId: selectedPlayerId,
      playerName: player.name,
      teamId: player.teamId,
    };

    setError(null);
    setSubmitting(true);

    // Kick the request off SYNCHRONOUSLY (before the transition body awaits)
    // so the ref is populated by the time any user click on Go-home runs.
    // No `{ fetch }` arg — see optimisticLink.ts (PR 15 / v1.4.3): passing
    // `{ fetch }` made the helper invoke fetch as a method of the deps
    // object, tripping the browser's WebIDL receiver brand check ("Illegal
    // invocation"). The helper now uses the module-scope global fetch.
    const apiPromise = attemptLink(selectedPlayerId);
    apiPromiseRef.current = apiPromise;

    startTransition(async () => {
      addOptimisticLinked(optimistic);
      const result = await apiPromise;
      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        // Don't commit — useOptimistic reverts to null when the transition
        // ends, so the form view returns. apiPromiseRef.current still points
        // at the failed promise; clearing it avoids a Go-home-after-error
        // ever awaiting it again.
        apiPromiseRef.current = null;
        return;
      }
      setCommittedLinked(optimistic);
      setSubmitting(false);
      // Fire the next-auth refresh now (PR 11 / v1.3.0). Stash the promise
      // so handleGoHome can await it if the user clicks the home button
      // before the JWT settles — without awaiting it on the main code path.
      const updatePromise = update().catch((err) => {
        console.warn('[assign] background session refresh failed:', err);
      });
      updatePromiseRef.current = updatePromise;
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
      return;
    }

    // Clear local + session-derived linkage. `committedLinked` is reset so
    // useOptimistic's optimistic value tracks back to null. `selectedPlayerId`
    // unselects the form so the user can pick a new player or go home.
    setCommittedLinked(null);
    setSelectedPlayerId(null);
    apiPromiseRef.current = null;
    updatePromiseRef.current = null;
    setUnassigning(false);

    update().catch((err) => {
      console.warn('[assign] background session refresh failed:', err);
    });
  }

  async function handleGoHome() {
    // If the link pipeline is still in flight (API write or post-write
    // session update), await it before navigating. Otherwise the destination
    // RSC reads a stale JWT and the user sees their old (or no) linkage.
    const apiPromise = apiPromiseRef.current;
    const updatePromise = updatePromiseRef.current;

    if (apiPromise || updatePromise) {
      setFinalizing(true);
      try {
        if (apiPromise) {
          const result = await apiPromise;
          if (!result.ok) {
            // Error is already surfaced by handleConfirm. Stay on this page
            // so the user can retry.
            setFinalizing(false);
            return;
          }
        }
        // updatePromiseRef is set inside the transition AFTER the API
        // succeeds. Re-read it post-await to pick up the latest value.
        const freshUpdate = updatePromiseRef.current;
        if (freshUpdate) {
          await freshUpdate;
        }
      } finally {
        setFinalizing(false);
      }
    }

    startTransition(() => {
      router.push('/');
    });
  }

  // Success view — shown the moment the user clicks Confirm (optimistic) and
  // persists once the API commits. The user navigates to / on their schedule
  // via the Go-home button rather than us pushing them there blindly.
  const linkedView = optimisticLinked;

  if (linkedView) {
    const team = teamForId(linkedView.teamId);
    return (
      <div className="w-full max-w-lg relative pb-8">
        <button
          onClick={() => router.push('/')}
          className="absolute top-0 right-0 p-2 text-fg-low hover:text-fg-high transition-colors"
          aria-label="Close"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="mt-12 flex flex-col items-center text-center">
          <div
            data-testid="assign-success-view"
            className="w-16 h-16 rounded-full bg-electric-green/10 border border-electric-green/40 flex items-center justify-center mb-6"
          >
            <svg className="w-8 h-8 text-electric-green" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-fg-mid mb-2">
            {"You're linked to"}
          </p>
          <h2 className="font-display text-3xl font-black uppercase tracking-tight text-fg-high mb-3">
            {linkedView.playerName}
          </h2>

          {team && (
            <div className="flex items-center gap-2 mb-10">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: team.color }}
              />
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-fg-mid">
                {team.name}
              </span>
            </div>
          )}

          <button
            data-testid="assign-go-home-button"
            onClick={handleGoHome}
            disabled={finalizing}
            className="w-full max-w-xs py-3 rounded-xl bg-electric-green text-black font-display text-sm font-black uppercase tracking-widest transition-all hover:bg-electric-green/90 active:scale-[0.98] disabled:opacity-60 disabled:cursor-wait"
          >
            {finalizing ? 'Finalizing…' : 'Go to home →'}
          </button>

          <button
            data-testid="assign-undo-button"
            onClick={handleUnassign}
            disabled={unassigning || finalizing}
            className="mt-4 text-[10px] font-black uppercase tracking-widest text-fg-low hover:text-primary transition-colors disabled:opacity-40"
          >
            {unassigning ? 'Undoing…' : 'Wrong player? Undo'}
          </button>

          {error && (
            <p className="mt-4 text-vibrant-pink text-[11px] font-bold">{error}</p>
          )}
        </div>
      </div>
    );
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
