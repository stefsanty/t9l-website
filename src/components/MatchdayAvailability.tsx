'use client';

import { useEffect, useState } from 'react';
import type { Matchday, Team, Player, Availability, AvailabilityStatuses, PlayedStatus } from '@/types';
import { getPositionBucket } from '@/lib/positions';
import FormationPitch from './FormationPitch';

// -- View mode --

export type AvailabilityViewMode = 'formation' | 'list';

const VIEW_MODE_STORAGE_KEY = 't9l-availability-view';

// -- Position colors (mirrors SquadList.getPositionColor) --

// v1.82.0 — colour-by-bucket. Public `Player.position` is now a joined
// string like "CB/CM" (or futsal "FIXO/ALA"); the first code drives
// the colour band.
const BUCKET_COLORS: Record<'GK' | 'DF' | 'MF' | 'FW', string> = {
  GK: 'bg-zinc-950 text-white border-white/20',
  DF: 'bg-blue-600 text-white border-blue-400/30',
  MF: 'bg-emerald-600 text-white border-emerald-400/30',
  FW: 'bg-red-600 text-white border-red-400/30',
};

export function getPositionPillColor(pos: string | null | undefined): string {
  if (!pos) return 'bg-surface-md text-fg-mid border-border-subtle';
  const first = pos.split('/')[0]?.toUpperCase();
  if (!first) return 'bg-surface-md text-fg-mid border-border-subtle';
  return BUCKET_COLORS[getPositionBucket(first)];
}

// -- TeamPillList sub-component --

function TeamPillList({
  confirmedIds,
  players,
}: {
  confirmedIds: string[];
  players: Player[];
}) {
  if (confirmedIds.length === 0) {
    return (
      <span className="text-[11px] text-fg-mid italic py-2 px-1 block">
        {"No confirmations yet"}
      </span>
    );
  }

  // v1.82.0 — bucket-driven sort (GK → DF → MF → FW). The first code
  // in the joined `position` string picks the bucket.
  const bucketOrder: Record<'GK' | 'DF' | 'MF' | 'FW', number> = {
    GK: 1, DF: 2, MF: 3, FW: 4,
  };
  const sortKey = (pos: string | null) => {
    if (!pos) return 99;
    const first = pos.split('/')[0]?.toUpperCase();
    if (!first) return 99;
    return bucketOrder[getPositionBucket(first)] ?? 99;
  };
  const confirmedPlayers = confirmedIds
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => !!p)
    .sort((a, b) => {
      const posA = sortKey(a.position);
      const posB = sortKey(b.position);
      if (posA !== posB) return posA - posB;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="availability-pill-list">
      {confirmedPlayers.map((p) => (
        <span
          key={p.id}
          className={`text-[11px] font-bold px-2 py-1 rounded-full border ${getPositionPillColor(p.position)}`}
          translate="no"
          data-testid={`availability-pill-${p.id}`}
        >
          <span className="text-[9px] font-black uppercase tracking-wider opacity-80 mr-1">
            {p.position || '—'}
          </span>
          {p.name}
        </span>
      ))}
    </div>
  );
}

// -- View toggle --

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: AvailabilityViewMode;
  onChange: (mode: AvailabilityViewMode) => void;
}) {
  return (
    <div
      className="flex items-center gap-0.5 bg-surface rounded-md border border-border-subtle p-0.5"
      data-testid="availability-view-toggle"
    >
      <button
        type="button"
        onClick={() => onChange('formation')}
        className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded transition-all ${
          mode === 'formation' ? 'bg-surface-md text-foreground' : 'text-fg-low hover:text-fg-mid'
        }`}
        aria-pressed={mode === 'formation'}
        data-testid="availability-view-formation"
      >
        {"Pitch"}
      </button>
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded transition-all ${
          mode === 'list' ? 'bg-surface-md text-foreground' : 'text-fg-low hover:text-fg-mid'
        }`}
        aria-pressed={mode === 'list'}
        data-testid="availability-view-list"
      >
        {"List"}
      </button>
    </div>
  );
}

// -- TeamFormation removed in v1.83.0 — replaced by <FormationPitch>
//    (per-format catalog from src/lib/formations.ts + multi-role
//    assignment + manual override). The bucket-row distribution and
//    hardcoded FORMATIONS list lived here before; both are now driven
//    by `getFormationsFor(ballType, playerFormat)`.

// -- Main component --

interface MatchdayAvailabilityProps {
  matchday: Matchday;
  teams: Team[];
  players: Player[];
  availability: Availability;
  availabilityStatuses: AvailabilityStatuses;
  played: PlayedStatus;
  /**
   * v1.83.0 — league context drives the formation catalog
   * (`src/lib/formations.ts`) + the position vocabulary used for
   * slot-compat. Optional because some legacy preview paths render
   * MatchdayAvailability without league lookup; in that case we fall
   * back to SOCCER + the 9-aside catalog (Tennozu's default).
   */
  ballType?: 'SOCCER' | 'FUTSAL' | null;
  playerFormat?: number | null;
}

export default function MatchdayAvailability({
  matchday,
  teams,
  players,
  availability,
  availabilityStatuses,
  played,
  ballType,
  playerFormat,
}: MatchdayAvailabilityProps) {
    const isNext = matchday.matches[0].homeGoals === null;
  const playingTeams = teams.filter((t) => t.id !== matchday.sittingOutTeamId);

  // All playing teams collapsed by default
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(
    () => new Set()
  );

  // View mode (formation vs pill list); persists per-user via localStorage.
  // Default to formation. Hydrate from localStorage on mount.
  const [viewMode, setViewMode] = useState<AvailabilityViewMode>('formation');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (stored === 'formation' || stored === 'list') {
        setViewMode(stored);
      }
    } catch {
      // localStorage unavailable (private mode etc.) — keep default
    }
  }, []);

  function handleViewModeChange(next: AvailabilityViewMode) {
    setViewMode(next);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable — keep in-memory only
    }
  }

  function toggleTeam(teamId: string) {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  const mdAvailability = availability[matchday.id] || {};
  const mdPlayed = played[matchday.id] || {};

  if (!isNext) {
    // Past matchday — show who played
    const anyPlayed = playingTeams.some((t) => (mdPlayed[t.id] || []).length > 0);
    if (!anyPlayed) return null;

    return (
      <section className="mt-3 mb-3 animate-in">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-fg-mid">
            {"Who Played"}
          </h3>
          <div className="h-[1px] flex-1 bg-surface-md" />
          <ViewModeToggle mode={viewMode} onChange={handleViewModeChange} />
        </div>

        <div className="grid gap-2">
          {playingTeams.map((team) => {
            const playedIds = mdPlayed[team.id] || [];
            const isExpanded = expandedTeams.has(team.id);

            return (
              <div
                key={team.id}
                className={`rounded-xl overflow-hidden transition-all duration-300 border ${
                  isExpanded ? 'bg-surface-md border-border-default' : 'bg-surface border-border-subtle hover:border-border-default'
                }`}
              >
                <button
                  onClick={() => toggleTeam(team.id)}
                  className="w-full flex items-center justify-between px-4 py-2 text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                    <span className="text-[15px] font-black tracking-tight uppercase" translate="no">{team.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[11px] font-black px-2 py-0.5 rounded ${
                      playedIds.length > 0 ? 'bg-electric-violet/10 text-electric-violet' : 'bg-surface-md text-fg-mid'
                    }`}>
                      {playedIds.length} {"played"}
                    </span>
                    <svg
                      className={`w-4 h-4 text-fg-mid transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-border-subtle animate-in">
                    {viewMode === 'list' ? (
                      <TeamPillList confirmedIds={playedIds} players={players} />
                    ) : (
                      <FormationPitch
                        confirmedIds={playedIds}
                        players={players}
                        teamColor={team.color}
                        ballType={ballType}
                        playerFormat={playerFormat}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  // Upcoming matchday — show availability
  return (
    <section className="mt-4 mb-12 animate-in">
      {/* Player availability */}
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-fg-mid">
          {"Who else is coming?"}
        </h3>
        <div className="h-[1px] flex-1 bg-border-subtle" />
        <ViewModeToggle mode={viewMode} onChange={handleViewModeChange} />
      </div>

      <div className="grid gap-3">
        {playingTeams.map((team) => {
          const allAvailIds = mdAvailability[team.id] || [];
          const teamStatuses = availabilityStatuses[matchday.id]?.[team.id] || {};

          const goingIds = allAvailIds.filter((id) => {
            const s = teamStatuses[id];
            return s === 'GOING' || s === 'Y';
          });
          const isExpanded = expandedTeams.has(team.id);

          return (
            <div
              key={team.id}
              className={`rounded-xl overflow-hidden transition-all duration-300 border ${
                isExpanded ? 'bg-surface-md border-border-default' : 'bg-surface border-border-subtle hover:border-border-default'
              }`}
            >
              <button
                onClick={() => toggleTeam(team.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: team.color }}
                  />
                  <span className="text-[15px] font-black tracking-tight uppercase" translate="no">
                    {team.name}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold text-fg-mid">
                    {goingIds.length} {"going"}
                  </span>
                  <svg
                    className={`w-4 h-4 text-fg-mid transition-transform duration-300 ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 pt-0 border-t border-border-subtle animate-in">
                  {viewMode === 'list' ? (
                    <TeamPillList confirmedIds={goingIds} players={players} />
                  ) : (
                    <FormationPitch
                      confirmedIds={goingIds}
                      players={players}
                      teamColor={team.color}
                      ballType={ballType}
                      playerFormat={playerFormat}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
