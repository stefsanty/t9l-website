'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import type {
  Matchday,
  Team,
  Player,
  Availability,
  AvailabilityStatuses,
  PlayedStatus,
  MatchdayGuests,
  MatchdayGuestEntry,
} from '@/types';
import { type BallType, getPositionBucket, getPositionBucketByScore } from '@/lib/positions';
import { synthesizeGuestPlayers, isGuestPseudoId, GUEST_PSEUDO_ID_PREFIX } from '@/lib/guestSynthesis';
import FormationPitch from './FormationPitch';

// v1.91.0 — Add Guests modal. Lazy-loaded so the auth-modal pattern from
// v1.80.8 carries over: only fetched on first click, keeping the public-
// route first-load JS unchanged for users who never open the dialog.
const AddGuestsModal = dynamic(() => import('./AddGuestsModal'), {
  loading: () => null,
});

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

// -- List-view grouping ────────────────────────────────────────────────────
//
// Groups confirmed players by coarse position bucket for the list view.
// English labels used for all formats (futsal FIXO→Defense, PIVOT→Forwards).
// Empty buckets are omitted by the caller; the order is always GK→DF→MF→FW→UNB
// followed by the guest sub-buckets (LEAGUE_GUEST, then EXTERNAL_GUEST per
// the v1.93.0 brief). Guests are partitioned by type — League Guests above
// Ext Guests — and each guest carries their own positions[] from the
// MatchdayGuest row (v1.93.0; v1.91.0 had a single positionless GUEST bucket).

export type ListBucket =
  | 'GK'
  | 'DF'
  | 'MF'
  | 'FW'
  | 'UNB'
  | 'LEAGUE_GUEST'
  | 'EXTERNAL_GUEST';

// v1.92.0 — added 'UNB' (unbucketed) for players whose preferredPositions
// array is empty. Renders between Forwards and Guests so authenticated
// users without a recorded role still appear in the list.
const BUCKET_ORDER: ReadonlyArray<ListBucket> = [
  'GK', 'DF', 'MF', 'FW', 'UNB', 'LEAGUE_GUEST', 'EXTERNAL_GUEST',
];

export const BUCKET_LABEL: Record<ListBucket, string> = {
  GK: 'Goalkeepers',
  DF: 'Defense',
  MF: 'Midfield',
  FW: 'Forwards',
  UNB: 'Other',
  LEAGUE_GUEST: 'League Guests',
  EXTERNAL_GUEST: 'External Guests',
};

export const BUCKET_DOT: Record<ListBucket, string> = {
  GK: 'bg-yellow-400',
  DF: 'bg-blue-400',
  MF: 'bg-green-400',
  FW: 'bg-red-400',
  UNB: 'bg-fg-mid',
  LEAGUE_GUEST: 'bg-fg-low',
  EXTERNAL_GUEST: 'bg-fg-low',
};

export interface BucketGroup {
  bucket: ListBucket;
  players: Player[];
}

/** Internal — derive guest type from a synthesised pseudo-Player's name.
 *  `synthesizeGuestPlayers` is the only writer of guest pseudo-Players,
 *  so its `Ext Guest N` / `League Guest N` naming convention is the
 *  authoritative type marker on the public Player shape (which doesn't
 *  carry an explicit `type` field). Returns `null` for non-guest
 *  players. */
function guestTypeOf(p: Player): 'EXTERNAL' | 'LEAGUE' | null {
  if (!isGuestPseudoId(p.id)) return null;
  if (p.name.startsWith('League Guest')) return 'LEAGUE';
  if (p.name.startsWith('Ext Guest')) return 'EXTERNAL';
  return null;
}

/** Pure helper — resolves + groups confirmed players by position bucket.
 *
 *  v1.93.0 — guest sub-buckets. Guests partition into LEAGUE_GUEST
 *  (League Guests, rendered first) and EXTERNAL_GUEST (Ext Guests,
 *  rendered second) per the brief. Within each guest sub-bucket the
 *  ordering preserves the synthesised name's numeric tail (string
 *  localeCompare with numeric: true), matching the modal's row order
 *  for sets ≤9 and giving natural numeric order for sets ≥10.
 *
 *  v1.92.0 — bucketing logic flipped from `positions[0]` (which picked
 *  one code arbitrarily off the joined `position` string) to the score-
 *  based average across `preferredPositions[]` via
 *  `getPositionBucketByScore`. Falls back to the joined `position`
 *  string when preferredPositions is missing (legacy memberships that
 *  haven't been re-saved since v1.86.0). Empty array → 'UNB' bucket
 *  rather than silently dropping into 'MF'.
 */
export function bucketConfirmedPlayers(
  confirmedIds: string[],
  players: Player[],
): BucketGroup[] {
  const resolved = confirmedIds
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is Player => !!p);

  const map = new Map<ListBucket, Player[]>([
    ['GK', []], ['DF', []], ['MF', []], ['FW', []], ['UNB', []],
    ['LEAGUE_GUEST', []], ['EXTERNAL_GUEST', []],
  ]);

  for (const p of resolved) {
    const gType = guestTypeOf(p);
    if (gType === 'LEAGUE') { map.get('LEAGUE_GUEST')!.push(p); continue; }
    if (gType === 'EXTERNAL') { map.get('EXTERNAL_GUEST')!.push(p); continue; }
    // Prefer the explicit preferredPositions[] array; fall back to
    // splitting the legacy joined `position` string for memberships
    // that haven't been re-saved since v1.86.0.
    const positions = p.preferredPositions && p.preferredPositions.length > 0
      ? p.preferredPositions
      : (p.position ?? '').split('/').map((s) => s.trim()).filter(Boolean);
    const scoreBucket = getPositionBucketByScore(positions);
    const listBucket: ListBucket = scoreBucket ?? 'UNB';
    map.get(listBucket)!.push(p);
  }

  // Real-player buckets sort alphabetically. Guest buckets sort by
  // synthesised name with numeric: true so "Ext Guest 10" comes after
  // "Ext Guest 2" (not lex-sorted "10, 2, 3, ...").
  for (const [bucket, group] of map.entries()) {
    if (bucket === 'LEAGUE_GUEST' || bucket === 'EXTERNAL_GUEST') {
      group.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    } else {
      group.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return BUCKET_ORDER
    .map((bucket) => ({ bucket, players: map.get(bucket)! }))
    .filter((g) => g.players.length > 0);
}

// -- Avatar fallback ──────────────────────────────────────────────────────
//
// v1.92.0 — initials for the list-view player pill when `User.image` is
// null. First letter of the first whitespace-separated token + first
// letter of the last token. Single-token names use that single letter
// twice trimmed to one. Empty/null name → "?". Always uppercase.

export function playerInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  const first = parts[0]!.charAt(0).toUpperCase();
  const last = parts[parts.length - 1]!.charAt(0).toUpperCase();
  return `${first}${last}`;
}

/** v1.92.0 — list-view avatar. User.image when present, otherwise the
 *  initials bubble. Sized ~22px (px-2 py-1 pill is ~28px tall, so 22px
 *  avatar reads as inline-centered). */
function PlayerPillAvatar({
  src,
  name,
}: {
  src: string | null | undefined;
  name: string;
}) {
  if (src) {
    return (
      <span
        className="w-[22px] h-[22px] rounded-full overflow-hidden shrink-0 bg-fg-mid/20 inline-block align-middle"
        data-testid="availability-pill-avatar"
      >
        {/* Native <img> rather than next/image: the public LeagueData
            payload doesn't currently configure remote-image domains
            for arbitrary OAuth-provider avatars, and the perf cost is
            negligible for the ≤24px list pills. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      className="w-[22px] h-[22px] rounded-full bg-fg-mid/20 text-fg-mid text-[10px] font-black uppercase inline-flex items-center justify-center shrink-0 align-middle"
      data-testid="availability-pill-avatar-initials"
    >
      {playerInitials(name)}
    </span>
  );
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

  const groups = bucketConfirmedPlayers(confirmedIds, players);

  return (
    <div className="mt-2 space-y-3" data-testid="availability-pill-list">
      {groups.map(({ bucket, players: groupPlayers }) => (
        <div key={bucket} data-testid={`availability-group-${bucket}`}>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${BUCKET_DOT[bucket]}`} />
            <span className="text-[9px] font-black uppercase tracking-wider text-fg-low">
              {BUCKET_LABEL[bucket]}
            </span>
            <div className="h-px flex-1 bg-border-subtle" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {groupPlayers.map((p) => {
              const isGuest = bucket === 'LEAGUE_GUEST' || bucket === 'EXTERNAL_GUEST';
              // v1.93.0 — guests now carry their own positions, so the
              // pill displays them like real players (or "Any" when the
              // guest has no positions). Pill colouring stays neutral
              // for guests (no auth-linked User → no team-coloured
              // role pill).
              const positionLabel = p.position && p.position.trim() !== ''
                ? p.position
                : isGuest ? 'Any' : '—';
              return (
                <span
                  key={p.id}
                  className={
                    isGuest
                      ? 'inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full border bg-surface-md text-fg-mid border-border-default'
                      : `inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full border ${getPositionPillColor(p.position)}`
                  }
                  translate="no"
                  data-testid={`availability-pill-${p.id}`}
                >
                  {/* v1.92.0 — avatar (User.image or initials) for
                      non-guest pills only. Guests have no auth-linked
                      User and render as a plain pill. */}
                  {!isGuest && <PlayerPillAvatar src={p.image} name={p.name} />}
                  <span className="text-[9px] font-black uppercase tracking-wider opacity-80">
                    {positionLabel}
                  </span>
                  {p.name}
                </span>
              );
            })}
          </div>
        </div>
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
  /**
   * v1.93.0 — Per-(matchday, team) typed guest rows. Replaces the
   * v1.91.0 count map. Empty when no guests are recorded; the "+ Guests"
   * trigger still renders so authenticated users can record the first
   * guest. Optional for legacy preview paths that render without
   * league context.
   */
  guests?: MatchdayGuests;
  /** v1.91.0 — league subdomain, target for the Add Guests server action. */
  leagueSlug?: string;
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
  guests,
  leagueSlug,
}: MatchdayAvailabilityProps) {
  const { data: session } = useSession();
  const canAddGuests = Boolean(session?.user) && Boolean(leagueSlug);

  const [guestModalTeamId, setGuestModalTeamId] = useState<string | null>(null);
  const guestModalTeam = guestModalTeamId
    ? teams.find((t) => t.id === guestModalTeamId) ?? null
    : null;
  const guestModalRows: MatchdayGuestEntry[] = guestModalTeamId
    ? guests?.[matchday.id]?.[guestModalTeamId] ?? []
    : [];
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

  // v1.93.0 — Per-team guest synthesis. Each team's guest rows turn
  // into one pseudo-Player per row (with their chosen positions, so the
  // 6-pass formation algorithm places them like real players). Memoised
  // across the matchday so the synthesised array is stable per render.
  function getTeamGuests(teamId: string): MatchdayGuestEntry[] {
    return guests?.[matchday.id]?.[teamId] ?? [];
  }
  function getTeamGuestTotal(teamId: string): number {
    return getTeamGuests(teamId).length;
  }
  // One synthesised pool, per (matchday, all teams). Each team only
  // references its own guest IDs in `confirmedIds`, so a single shared
  // `players` array containing every team's guest pseudo-Player is safe.
  const playersWithGuests = useMemo(() => {
    const out: Player[] = [...players];
    for (const t of playingTeams) {
      const teamGuests = getTeamGuests(t.id);
      if (teamGuests.length > 0) out.push(...synthesizeGuestPlayers(t.id, teamGuests));
    }
    return out;
    // Track guests JSON for stability when guests identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, playingTeams, JSON.stringify(guests?.[matchday.id] ?? {})]);

  function guestIdsForTeam(teamId: string): string[] {
    return getTeamGuests(teamId).map((g) => `${GUEST_PSEUDO_ID_PREFIX}${g.id}`);
  }

  // Single modal node, mounted in both the past-matchday and upcoming-
  // matchday return paths. Only renders when the user has clicked an
  // "+ Guests" trigger — `guestModalTeam` is null otherwise.
  const guestModalNode = guestModalTeam && leagueSlug ? (
    <AddGuestsModal
      open
      onClose={() => setGuestModalTeamId(null)}
      leagueSlug={leagueSlug}
      matchdayPublicId={matchday.id}
      teamPublicId={guestModalTeam.id}
      teamName={guestModalTeam.name}
      matchdayLabel={matchday.label}
      ballType={(ballType as BallType | null | undefined) ?? null}
      initialGuests={guestModalRows}
    />
  ) : null;

  if (!isNext) {
    // Past matchday — show who played
    const anyPlayed = playingTeams.some(
      (t) => (mdPlayed[t.id] || []).length > 0 || getTeamGuestTotal(t.id) > 0,
    );
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
            const guestIds = guestIdsForTeam(team.id);
            const confirmedIds = [...playedIds, ...guestIds];
            const total = confirmedIds.length;

            return (
              <div
                key={team.id}
                className={`rounded-xl overflow-hidden transition-all duration-300 border ${
                  isExpanded ? 'bg-surface-md border-border-default' : 'bg-surface border-border-subtle hover:border-border-default'
                }`}
              >
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleTeam(team.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleTeam(team.id);
                    }
                  }}
                  className="w-full flex items-center justify-between px-4 py-2 text-left cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: team.color }} />
                    <span className="text-[15px] font-black tracking-tight uppercase" translate="no">{team.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {canAddGuests && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setGuestModalTeamId(team.id);
                        }}
                        className="text-[10px] font-black uppercase tracking-widest text-fg-mid hover:text-fg-high px-2 py-1 rounded border border-border-default bg-background"
                        data-testid={`add-guests-trigger-${team.id}`}
                        aria-label={`Add guests for ${team.name}`}
                      >
                        + Guests
                      </button>
                    )}
                    <span className={`text-[11px] font-black px-2 py-0.5 rounded ${
                      total > 0 ? 'bg-electric-violet/10 text-electric-violet' : 'bg-surface-md text-fg-mid'
                    }`} data-testid={`played-count-${team.id}`}>
                      {total} {"played"}
                    </span>
                    <svg
                      className={`w-4 h-4 text-fg-mid transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-border-subtle animate-in">
                    {viewMode === 'list' ? (
                      <TeamPillList confirmedIds={confirmedIds} players={playersWithGuests} />
                    ) : (
                      <FormationPitch
                        confirmedIds={confirmedIds}
                        players={playersWithGuests}
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
        {guestModalNode}
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

          // v1.87.0 — exclude retired players from upcoming-matchday
          // formation/availability pickers. A retired player's stale
          // Redis RSVP must not show up as "going" or land in a
          // formation slot. Past matchdays (the `!isNext` branch) keep
          // retired players visible because they reflect historical
          // participation.
          const retiredIds = new Set(
            players.filter((p) => p.retiredAt).map((p) => p.id),
          );
          const goingIds = allAvailIds.filter((id) => {
            if (retiredIds.has(id)) return false;
            const s = teamStatuses[id];
            return s === 'GOING' || s === 'Y';
          });
          const isExpanded = expandedTeams.has(team.id);
          const guestIds = guestIdsForTeam(team.id);
          const confirmedIds = [...goingIds, ...guestIds];
          const total = confirmedIds.length;

          return (
            <div
              key={team.id}
              className={`rounded-xl overflow-hidden transition-all duration-300 border ${
                isExpanded ? 'bg-surface-md border-border-default' : 'bg-surface border-border-subtle hover:border-border-default'
              }`}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleTeam(team.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleTeam(team.id);
                  }
                }}
                className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer select-none"
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
                  {canAddGuests && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setGuestModalTeamId(team.id);
                      }}
                      className="text-[10px] font-black uppercase tracking-widest text-fg-mid hover:text-fg-high px-2 py-1 rounded border border-border-default bg-background"
                      data-testid={`add-guests-trigger-${team.id}`}
                      aria-label={`Add guests for ${team.name}`}
                    >
                      + Guests
                    </button>
                  )}
                  <span className="text-[11px] font-semibold text-fg-mid" data-testid={`going-count-${team.id}`}>
                    {total} {"going"}
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
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 pt-0 border-t border-border-subtle animate-in">
                  {viewMode === 'list' ? (
                    <TeamPillList confirmedIds={confirmedIds} players={playersWithGuests} />
                  ) : (
                    <FormationPitch
                      confirmedIds={confirmedIds}
                      players={playersWithGuests}
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

      {guestModalNode}
    </section>
  );
}
