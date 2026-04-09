'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import type { Matchday, Team } from '@/types';

type RsvpStatus = 'GOING' | 'UNDECIDED' | '';

const COLOR_NAMES: Record<string, string> = {
  'mariners-fc': 'Blue',
  'fenix-fc':    'Yellow',
  'hygge-sc':    'Red',
  'fc-torpedo':  'Gray',
};

function normalizeStatus(s: string): RsvpStatus {
  if (s === 'GOING' || s === 'Y') return 'GOING';
  if (s === 'UNDECIDED' || s === 'EXPECTED') return 'UNDECIDED';
  return '';
}

function arrivalTime(kickoff: string): string {
  const [h, m] = kickoff.split(':').map(Number);
  const total = h * 60 + m - 10;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

interface RsvpBarProps {
  matchday: Matchday;
  initialStatus: 'GOING' | 'UNDECIDED' | 'Y' | 'EXPECTED' | '';
  userTeam: Team | null;
  userTeamIsPlaying: boolean;
  isCompleted: boolean;
}

export default function RsvpBar({
  matchday,
  initialStatus,
  userTeam,
  userTeamIsPlaying,
  isCompleted,
}: RsvpBarProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const [status, setStatus] = useState<RsvpStatus>(() => normalizeStatus(initialStatus));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  if (!session?.playerId || !session?.teamId || !userTeamIsPlaying || isCompleted || !userTeam) {
    return null;
  }

  async function select(next: RsvpStatus) {
    if (next === status || loading) return;
    const prev = status;
    setStatus(next);
    setShowOptions(false);
    if (next === 'GOING') setShowConfirm(true);
    setLoading(true);
    setError(false);

    try {
      const res = await fetch('/api/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchdayId: matchday.id, status: next }),
      });
      if (!res.ok) throw new Error('RSVP failed');
      router.refresh();
    } catch {
      setStatus(prev);
      setShowConfirm(false);
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const colorName = COLOR_NAMES[userTeam.id] ?? userTeam.color;
  const userFirstMatch = matchday.matches
    .filter((m) => m.homeTeamId === session.teamId || m.awayTeamId === session.teamId)
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff))[0];

  const isGoing = status === 'GOING';

  return (
    <>
      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-lg z-40">
        <div className="px-4 pt-3 pb-5 bg-background border-t-2 border-primary/60">

          {isGoing && !showOptions ? (
            /* ── You're Going state ── */
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <svg className="w-5 h-5 text-success shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-base font-black text-success uppercase tracking-wide">You're Going</span>
                <span className="text-sm font-black text-fg-low">·</span>
                <span className="text-sm font-black text-fg-mid uppercase tracking-wide truncate">{matchday.label}</span>
              </div>
              <button
                onClick={() => setShowOptions(true)}
                className="text-xs font-bold text-fg-mid underline underline-offset-2 decoration-fg-low hover:text-fg-high transition-colors shrink-0 whitespace-nowrap"
              >
                edit attendance
              </button>
            </div>
          ) : (
            /* ── Join state (or editing) ── */
            <>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm font-black uppercase tracking-[0.15em] text-fg-high">
                  {matchday.label}
                </span>
                <span className="text-sm font-black text-fg-low">·</span>
                <span className="text-sm font-black uppercase tracking-[0.1em] text-fg-mid">
                  {isGoing ? 'Change attendance' : 'Are you coming?'}
                </span>
                <div className="h-[1px] flex-1 bg-surface-md" />
                {loading && (
                  <span className="w-3.5 h-3.5 border-2 border-border-default border-t-fg-mid rounded-full animate-spin shrink-0" />
                )}
              </div>

              {/* Join + dropdown toggle */}
              <div className="flex gap-1">
                <button
                  onClick={() => select('GOING')}
                  disabled={loading}
                  className="flex-1 py-4 rounded-2xl text-base font-black uppercase tracking-wider bg-primary text-white border border-primary transition-all disabled:opacity-50 active:scale-95 hover:bg-primary/90"
                >
                  Join
                </button>
                <button
                  onClick={() => setShowOptions((v) => !v)}
                  disabled={loading}
                  className="w-14 rounded-2xl bg-surface-md border border-border-default text-fg-mid transition-all disabled:opacity-50 active:scale-95 hover:bg-surface hover:text-fg-high flex items-center justify-center"
                  aria-label="More options"
                >
                  <svg
                    className={`w-4 h-4 transition-transform duration-200 ${showOptions ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </>
          )}

          {/* Dropdown options (Undecided / Not going) */}
          {showOptions && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => select('UNDECIDED')}
                disabled={loading}
                className={`flex-1 py-3 rounded-2xl text-sm font-black uppercase tracking-wider border transition-all disabled:opacity-50 active:scale-95 ${
                  status === 'UNDECIDED'
                    ? 'bg-warning/20 text-warning border-warning/60'
                    : 'bg-surface-md text-fg-high border-border-default hover:border-warning/40 hover:text-warning'
                }`}
              >
                Undecided
              </button>
              <button
                onClick={() => select('')}
                disabled={loading}
                className={`flex-1 py-3 rounded-2xl text-sm font-black uppercase tracking-wider border transition-all disabled:opacity-50 active:scale-95 ${
                  status === '' && !isGoing
                    ? 'bg-vibrant-pink/20 text-vibrant-pink border-vibrant-pink/50'
                    : 'bg-surface-md text-fg-high border-border-default hover:border-vibrant-pink/40 hover:text-vibrant-pink'
                }`}
              >
                Not going
              </button>
            </div>
          )}

          {error && (
            <p className="text-vibrant-pink text-[11px] mt-2 text-center">
              Error saving RSVP. Try again.
            </p>
          )}
        </div>
      </div>

      {/* Confirmation modal */}
      {showConfirm && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-start justify-center px-4"
          onClick={() => setShowConfirm(false)}
        >
          <div
            className="bg-card rounded-3xl p-6 w-full max-w-xs mt-[20vh] shadow-xl border border-border-default"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-14 h-14 rounded-full bg-success/15 border border-success/40 flex items-center justify-center">
                <svg className="w-7 h-7 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>

            <h2 className="font-display text-2xl font-black uppercase tracking-tighter text-fg-high text-center mb-1">
              {"You're In!"}
            </h2>
            <p className="text-sm text-fg-mid text-center mb-5" translate="no">
              You are confirmed to join{' '}
              <span className="text-fg-high font-bold">{matchday.label}</span>{' '}
              with{' '}
              <span className="text-fg-high font-bold">{userTeam.name}</span>.
            </p>

            <div className="space-y-3 mb-6">
              <div className="flex items-start gap-3 bg-surface rounded-2xl px-4 py-3">
                <span className="text-lg shrink-0">👕</span>
                <p className="text-[13px] text-fg-mid leading-snug">
                  Your team will be wearing{' '}
                  <span className="text-fg-high font-bold">{colorName}</span> — bring a shirt of the same colour if possible{' '}
                  <span className="text-fg-low">(bibs will be provided)</span>.
                </p>
              </div>

              {userFirstMatch && (
                <div className="flex items-start gap-3 bg-surface rounded-2xl px-4 py-3">
                  <span className="text-lg shrink-0">⏰</span>
                  <p className="text-[13px] text-fg-mid leading-snug">
                    Please arrive by{' '}
                    <span className="text-fg-high font-bold">{arrivalTime(userFirstMatch.kickoff)}</span>!
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowConfirm(false)}
              className="w-full py-3.5 rounded-2xl bg-success/15 text-success border border-success/40 text-sm font-black uppercase tracking-wider transition-all hover:bg-success/25 active:scale-95"
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </>
  );
}
