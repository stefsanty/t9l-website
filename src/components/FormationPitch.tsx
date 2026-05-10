'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Player } from '@/types';
import {
  type Formation,
  type AssignmentInput,
  assignAlternatesToSlots,
  assignPlayersToFormation,
  findFormation,
  getFormationsFor,
  playerCodeFillsSlot,
} from '@/lib/formations';
import { positionPillColor } from '@/lib/positions';
import { isGuestPseudoId } from '@/lib/guestSynthesis';

// ── Picker storage ────────────────────────────────────────────────────────
//
// Per-(ballType, playerCount) selected formation code persists across
// dashboards via localStorage. Key shape: t9l-formation:<ballType>:<n>.
// On hydration miss, defaults to the first formation in the catalog
// (the conventional "most common" entry).

function storageKey(ballType: 'SOCCER' | 'FUTSAL', playerCount: number): string {
  return `t9l-formation:${ballType}:${playerCount}`;
}

function readStoredCode(ballType: 'SOCCER' | 'FUTSAL', playerCount: number): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(storageKey(ballType, playerCount));
  } catch {
    return null;
  }
}

function writeStoredCode(ballType: 'SOCCER' | 'FUTSAL', playerCount: number, code: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(ballType, playerCount), code);
  } catch {
    // localStorage unavailable — keep in-memory only
  }
}

// ── Player → AssignmentInput projection ───────────────────────────────────
//
// `Player.position` is a `/`-joined string (per dbToPublicLeagueData v1.82.0).
// We split, normalise, and feed into the assignment algorithm.

function playerPositions(p: Player): string[] {
  return (p.position ?? '')
    .split('/')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

function toAssignmentInput(p: Player): AssignmentInput {
  return {
    id: p.id,
    positions: playerPositions(p),
    preferredPositions: p.preferredPositions,
    secondaryPositions: p.secondaryPositions,
  };
}

/** First code in the player's positions array — the user-pinned primary. */
function primaryPositionCode(p: Player): string | null {
  return playerPositions(p)[0] ?? null;
}

// Cap alternates rendered under each slot to keep the depth chart legible
// on mobile (~360px viewport, 9-11 slots). Overflow lands in "Other subs".
const MAX_ALTERNATES_PER_SLOT = 3;

// ── Pitch SVG ─────────────────────────────────────────────────────────────

function PitchBackground() {
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox="0 0 100 133"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect x="4" y="4" width="92" height="125" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9" />
      <line x1="4" y1="66.5" x2="96" y2="66.5" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9" />
      <circle cx="50" cy="66.5" r="14" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9" />
      <rect x="23" y="4" width="54" height="22" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9" />
      <rect x="37" y="4" width="26" height="9" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9" />
      <rect x="23" y="107" width="54" height="22" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9" />
      <rect x="37" y="120" width="26" height="9" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="0.9" />
    </svg>
  );
}

// ── Position pill ─────────────────────────────────────────────────────────
//
// For starters: shows the SLOT's primary position (so a CM in an LM slot
// shows [LM]). For depth-chart alternates and bench subs: shows the
// player's own positions[0] — they are candidates, not yet placed.

function PositionPill({ code }: { code: string | null }) {
  if (!code) return null;
  const colorClass = positionPillColor(code);
  return (
    <span
      className={`text-[7px] font-black uppercase tracking-widest ${colorClass} px-1 py-[1px] rounded leading-none`}
      data-testid={`position-pill-${code}`}
    >
      {code}
    </span>
  );
}

// ── Slot column (starter + alternate stack) ──────────────────────────────

function SlotColumn({
  slotCode,
  starter,
  alternates,
  teamColor,
  onClick,
}: {
  slotCode: string;
  starter: Player | null;
  alternates: Player[];
  teamColor: string;
  onClick: () => void;
}) {
  const filled = !!starter;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded p-0.5 max-w-[78px]"
      data-testid={`formation-slot-${slotCode}`}
      aria-label={
        filled
          ? `${slotCode} — ${starter.name}. Tap to reassign.`
          : `${slotCode} — empty slot. Tap to assign.`
      }
    >
      {filled ? (
        <>
          <div
            className="w-5 h-5 rounded-full shrink-0"
            style={{
              background: teamColor,
              boxShadow: '0 0 0 2px rgba(255,255,255,0.85), 0 2px 6px rgba(0,0,0,0.5)',
            }}
          />
          <div
            className="flex items-center gap-[2px] px-1.5 py-[2px] rounded whitespace-nowrap"
            style={{ backgroundColor: 'rgba(0,0,0,0.62)' }}
          >
            <PositionPill code={slotCode} />
            <span
              className="text-[8px] font-black text-white text-center leading-tight"
              translate="no"
            >
              {starter.name}
            </span>
          </div>
        </>
      ) : (
        <div className="w-5 h-5 rounded-full border-2 border-dashed border-white/40" />
      )}

      {alternates.length > 0 && (
        <div
          className="mt-[2px] flex flex-col items-center gap-[1px]"
          data-testid={`formation-alternates-${slotCode}`}
        >
          {alternates.map((alt) => (
            <div
              key={alt.id}
              className="flex items-center gap-[2px] px-1.5 py-[2px] rounded whitespace-nowrap"
              style={{ backgroundColor: 'rgba(0,0,0,0.62)' }}
              data-testid={`formation-alternate-${alt.id}`}
              aria-label={`${alt.name} (alternate)`}
            >
              <PositionPill code={primaryPositionCode(alt)} />
              <span
                className="text-[8px] font-black text-white text-center leading-tight"
                translate="no"
              >
                {alt.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

// ── Slot picker popover ───────────────────────────────────────────────────
//
// Opens when the user clicks an empty or filled slot. Lists every
// available player, with a visual marker for those compatible with the
// slot's position code. Picking a player swaps them into the slot
// (kicking out whoever was there into the bench).

function SlotPickerSheet({
  slotCode,
  ballType,
  candidatePlayers,
  currentPlayerId,
  onPick,
  onClear,
  onClose,
}: {
  slotCode: string;
  ballType: 'SOCCER' | 'FUTSAL';
  candidatePlayers: Player[];
  currentPlayerId: string | null;
  onPick: (playerId: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 animate-in"
      role="dialog"
      aria-modal="true"
      aria-label={`Pick a player for slot ${slotCode}`}
      onClick={onClose}
      data-testid="formation-slot-picker"
    >
      <div
        className="w-full sm:w-[420px] max-h-[70vh] bg-surface-md border-t sm:border border-border-default rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-fg-low">{"SLOT"}</p>
            <p className="text-base font-black uppercase tracking-tight text-foreground">{slotCode}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] font-black uppercase tracking-widest text-fg-mid hover:text-foreground px-2 py-1"
            aria-label="Close picker"
          >
            {"Close"}
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-3 py-2">
          {candidatePlayers.length === 0 ? (
            <p className="text-[12px] text-fg-mid italic px-2 py-4 text-center">
              {"No available players to assign."}
            </p>
          ) : (
            <ul className="grid gap-1">
              {candidatePlayers.map((p) => {
                const codes = (p.position ?? '')
                  .split('/')
                  .map((c) => c.trim().toUpperCase())
                  .filter(Boolean);
                const compatible = codes.some((c) =>
                  playerCodeFillsSlot(ballType, c, slotCode),
                );
                const isCurrent = p.id === currentPlayerId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onPick(p.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded text-left transition-colors ${
                        isCurrent
                          ? 'bg-electric-violet/20 border border-electric-violet/40'
                          : 'bg-surface hover:bg-surface-hi border border-transparent'
                      }`}
                      data-testid={`picker-player-${p.id}`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span
                          className="text-[15px] font-black tracking-tight uppercase truncate"
                          translate="no"
                        >
                          {p.name}
                        </span>
                        {!compatible && (
                          <span className="text-[8px] font-black uppercase tracking-widest text-amber-300 bg-amber-300/15 border border-amber-300/30 rounded-full px-1.5 py-0.5 shrink-0">
                            {"OUT OF POSITION"}
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-widest text-fg-mid shrink-0 ml-2">
                        {codes.join('/') || '—'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {currentPlayerId && (
          <div className="border-t border-border-subtle px-3 py-2">
            <button
              type="button"
              onClick={onClear}
              className="w-full text-[11px] font-black uppercase tracking-widest text-fg-mid hover:text-foreground px-3 py-2 rounded border border-border-default hover:border-fg-mid transition-colors"
            >
              {"Clear slot"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── FormationPicker (horizontal scroll strip) ─────────────────────────────

function FormationPicker({
  formations,
  activeCode,
  onPick,
  teamColor,
}: {
  formations: ReadonlyArray<Formation>;
  activeCode: string;
  onPick: (code: string) => void;
  teamColor: string;
}) {
  return (
    <div
      className="flex gap-1 overflow-x-auto -mx-1 px-1 scrollbar-hide"
      data-testid="formation-picker"
      role="tablist"
      aria-label="Formation"
    >
      {formations.map((f) => {
        const active = f.code === activeCode;
        return (
          <button
            key={f.code}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onPick(f.code)}
            className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded transition-all whitespace-nowrap shrink-0 ${
              active ? 'text-foreground' : 'text-fg-low bg-surface'
            }`}
            style={active ? { backgroundColor: teamColor + '55' } : undefined}
            data-testid={`formation-pick-${f.code}`}
          >
            {f.displayName}
          </button>
        );
      })}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

interface FormationPitchProps {
  confirmedIds: string[];
  players: Player[];
  teamColor: string;
  ballType: 'SOCCER' | 'FUTSAL' | null | undefined;
  /** Per-league N-aside count. Drives which formation catalog to show. */
  playerFormat: number | null | undefined;
}

export default function FormationPitch({
  confirmedIds,
  players,
  teamColor,
  ballType,
  playerFormat,
}: FormationPitchProps) {
  const effectiveBallType: 'SOCCER' | 'FUTSAL' = ballType ?? 'SOCCER';
  const formations = useMemo(
    () => getFormationsFor(effectiveBallType, playerFormat),
    [effectiveBallType, playerFormat],
  );

  // Default formation = first in catalog (conventional pick).
  const defaultCode = formations[0]?.code ?? '';
  const [selectedCode, setSelectedCode] = useState<string>(defaultCode);

  // Hydrate from localStorage.
  useEffect(() => {
    if (!playerFormat) return;
    const stored = readStoredCode(effectiveBallType, playerFormat);
    if (stored && formations.some((f) => f.code === stored)) {
      setSelectedCode(stored);
    } else {
      setSelectedCode(defaultCode);
    }
  }, [effectiveBallType, playerFormat, defaultCode, formations]);

  const handlePick = (code: string) => {
    setSelectedCode(code);
    if (playerFormat) writeStoredCode(effectiveBallType, playerFormat, code);
  };

  const formation = useMemo(
    () => findFormation(effectiveBallType, playerFormat, selectedCode) ?? formations[0],
    [effectiveBallType, playerFormat, selectedCode, formations],
  );

  // Resolve confirmed players (filter out unknowns).
  const confirmedPlayers: Player[] = useMemo(
    () => confirmedIds.map((id) => players.find((p) => p.id === id)).filter((p): p is Player => !!p),
    [confirmedIds, players],
  );

  // Compute auto-assignment from formation + players.
  const autoResult = useMemo(() => {
    if (!formation) {
      return {
        slotAssignments: [] as Array<string | null>,
        unassignedPlayers: confirmedPlayers.map((p) => p.id),
        playersWithoutPositions: [] as string[],
      };
    }
    const inputs = confirmedPlayers.map(toAssignmentInput);
    return assignPlayersToFormation(effectiveBallType, formation, inputs);
  }, [confirmedPlayers, formation, effectiveBallType]);

  // Manual overrides — slotIndex → playerId | null. `undefined` means
  // "use auto-assignment". Reset whenever the formation changes (a new
  // formation has different slot indexes; preserving overrides would
  // misplace players).
  const [overrides, setOverrides] = useState<Record<number, string | null>>({});
  useEffect(() => {
    setOverrides({});
  }, [formation?.code, confirmedIds.join(',')]);

  // Compose the final assignment from auto + overrides.
  const finalAssignment: Array<string | null> = useMemo(() => {
    if (!formation) return [];
    const merged: Array<string | null> = [...autoResult.slotAssignments];
    for (const [k, v] of Object.entries(overrides)) {
      const idx = Number(k);
      // Manual override wins; if v is the same player auto already
      // placed, that's fine. If v is a player auto placed elsewhere,
      // wipe that other placement.
      if (v) {
        for (let i = 0; i < merged.length; i++) if (merged[i] === v) merged[i] = null;
      }
      merged[idx] = v;
    }
    return merged;
  }, [autoResult, overrides, formation]);

  const assignedSet = useMemo(
    () => new Set(finalAssignment.filter((id): id is string => id !== null)),
    [finalAssignment],
  );
  const benchPlayers: Player[] = useMemo(
    () => confirmedPlayers.filter((p) => !assignedSet.has(p.id) && playerPositions(p).length > 0),
    [confirmedPlayers, assignedSet],
  );
  // v1.91.0 — Add Guests: synthetic guest pseudo-players are positionless
  // by design (they're externals or cross-team fill-ins with no profile
  // here). Excluded from the "fill in your profile" hint so the user
  // doesn't get nagged about a guest. Real positionless rostered players
  // remain surfaced in the hint.
  const playersWithoutPositions: Player[] = useMemo(
    () => confirmedPlayers.filter(
      (p) => (!p.position || p.position.trim() === '') && !isGuestPseudoId(p.id),
    ),
    [confirmedPlayers],
  );

  // Alternate (depth-chart) listing: each bench player goes under exactly
  // one slot — primary-eligible first, fallback otherwise. Capped at
  // MAX_ALTERNATES_PER_SLOT to keep the pitch readable on mobile;
  // overflow lands in the "Other subs" row below the pitch.
  const alternateAssignment = useMemo(() => {
    if (!formation) return null;
    const inputs = benchPlayers.map(toAssignmentInput);
    return assignAlternatesToSlots(effectiveBallType, formation, inputs);
  }, [benchPlayers, formation, effectiveBallType]);

  const slotAlternatesShown: Player[][] = useMemo(() => {
    if (!formation) return [];
    if (!alternateAssignment) return formation.slots.map(() => []);
    return alternateAssignment.slotAlternates.map((ids) =>
      ids
        .slice(0, MAX_ALTERNATES_PER_SLOT)
        .map((id) => benchPlayers.find((p) => p.id === id))
        .filter((p): p is Player => !!p),
    );
  }, [alternateAssignment, benchPlayers, formation]);

  const otherSubs: Player[] = useMemo(() => {
    if (!formation || !alternateAssignment) return [];
    const shownIds = new Set<string>();
    alternateAssignment.slotAlternates.forEach((ids) => {
      ids.slice(0, MAX_ALTERNATES_PER_SLOT).forEach((id) => shownIds.add(id));
    });
    const overflow = alternateAssignment.noFitOverflow
      .map((id) => benchPlayers.find((p) => p.id === id))
      .filter((p): p is Player => !!p);
    const truncated = benchPlayers.filter((p) => !shownIds.has(p.id) && !overflow.includes(p));
    return [...overflow, ...truncated];
  }, [alternateAssignment, benchPlayers, formation]);

  // Slot picker state.
  const [pickerSlotIdx, setPickerSlotIdx] = useState<number | null>(null);
  const closePicker = () => setPickerSlotIdx(null);
  const pickPlayerForSlot = (slotIdx: number, playerId: string) => {
    setOverrides((prev) => ({ ...prev, [slotIdx]: playerId }));
    closePicker();
  };
  const clearSlot = (slotIdx: number) => {
    setOverrides((prev) => ({ ...prev, [slotIdx]: null }));
    closePicker();
  };

  if (confirmedIds.length === 0) {
    return (
      <span className="text-[11px] text-fg-mid italic py-2 px-1 block">
        {"No confirmations yet"}
      </span>
    );
  }

  if (!formation || formations.length === 0) {
    // No catalog for this (ballType, playerCount) — surface a hint and
    // fall back to a flat name list so the data is still visible.
    return (
      <div className="mt-2 space-y-2">
        <p className="text-[11px] text-amber-300 italic">
          {"No formations defined for this league format yet."}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {confirmedPlayers.map((p) => (
            <span
              key={p.id}
              className="text-[11px] font-bold px-2 py-1 rounded-full bg-surface-md text-fg-mid border border-border-subtle"
              translate="no"
            >
              {p.name}
            </span>
          ))}
        </div>
      </div>
    );
  }

  // Format mismatch warning: the formation expects N players, but we
  // have fewer available. Render the empty slots regardless; the dashed
  // ring tells the user they're empty. We also count how many ADDITIONAL
  // players we'd need (excluding subs), for a single-line callout.
  const slotsNeeded = formation.playerCount;
  const playersAvailableForSlots = confirmedPlayers.length - playersWithoutPositions.length;
  const slotsShort = Math.max(0, slotsNeeded - playersAvailableForSlots);

  return (
    <div className="mt-2">
      <div className="flex justify-between items-center mb-1 gap-2">
        <span className="text-[9px] font-black uppercase tracking-widest text-fg-low shrink-0">{"LINEUP"}</span>
        <FormationPicker
          formations={formations}
          activeCode={formation.code}
          onPick={handlePick}
          teamColor={teamColor}
        />
      </div>

      <div
        className="relative w-full rounded-xl overflow-hidden"
        style={{
          aspectRatio: '3 / 4',
          background: 'repeating-linear-gradient(180deg,#1d6b2b 0%,#1d6b2b 12.5%,#196126 12.5%,#196126 25%)',
        }}
      >
        <PitchBackground />

        {/* Slots are absolutely positioned by their normalised x/y. The
            `1 - slot.y` flip puts y=1 at the top of the SVG (GK at the
            bottom, ST at the top). Each slot column renders the starter
            plus a stack of depth-chart alternates beneath. */}
        {formation.slots.map((slot, idx) => {
          const playerId = finalAssignment[idx];
          const player = playerId ? confirmedPlayers.find((p) => p.id === playerId) ?? null : null;
          const top = `${(1 - slot.y) * 100}%`;
          const left = `${slot.x * 100}%`;
          return (
            <div
              key={idx}
              className="absolute"
              style={{ top, left, transform: 'translateX(-50%) translateY(-10px)' }}
            >
              <SlotColumn
                slotCode={slot.code}
                starter={player}
                alternates={slotAlternatesShown[idx] ?? []}
                teamColor={teamColor}
                onClick={() => setPickerSlotIdx(idx)}
              />
            </div>
          );
        })}
      </div>

      {/* Sub-pitch panels: overflow subs (no slot fit or capped beyond
          MAX_ALTERNATES_PER_SLOT) + warnings. The bulk of subs render
          as alternates above; this row catches the remainder. */}
      <div className="mt-2 space-y-1.5">
        {slotsShort > 0 && (
          <p className="text-[10px] text-fg-low italic px-1" data-testid="formation-shortage">
            {`${slotsShort} slot${slotsShort === 1 ? '' : 's'} have no candidate available.`}
          </p>
        )}

        {otherSubs.length > 0 && (
          <div data-testid="formation-bench">
            <p className="text-[9px] font-black uppercase tracking-widest text-fg-low px-1 mb-1">
              {`Other subs (${otherSubs.length})`}
            </p>
            <div className="flex flex-wrap gap-1">
              {otherSubs.map((p) => (
                <span
                  key={p.id}
                  className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-md text-fg-mid border border-border-subtle"
                  translate="no"
                >
                  <PositionPill code={primaryPositionCode(p)} />
                  <span>{p.name}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {playersWithoutPositions.length > 0 && (
          <p className="text-[10px] text-fg-low italic px-1" data-testid="formation-no-positions">
            {`${playersWithoutPositions.length} player${playersWithoutPositions.length === 1 ? '' : 's'} have no position on file.`}
          </p>
        )}
      </div>

      {pickerSlotIdx !== null && formation && (
        <SlotPickerSheet
          slotCode={formation.slots[pickerSlotIdx].code}
          ballType={effectiveBallType}
          candidatePlayers={confirmedPlayers}
          currentPlayerId={finalAssignment[pickerSlotIdx]}
          onPick={(pid) => pickPlayerForSlot(pickerSlotIdx, pid)}
          onClear={() => clearSlot(pickerSlotIdx)}
          onClose={closePicker}
        />
      )}
    </div>
  );
}
