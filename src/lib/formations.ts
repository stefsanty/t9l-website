/**
 * v1.83.0 — Formation library + slot-position compatibility.
 *
 * Per-format catalogs of canonical formations rendered by
 * `MatchdayAvailability` / `FormationPitch`. Each formation lists its
 * starting-XI slots with normalised pitch coordinates and the position
 * code each slot expects. Pure module — no DB, no React, no framework
 * imports — so it lives alongside `src/lib/positions.ts` and can be
 * imported from both server actions and client components without
 * dragging Prisma into the public bundle (per the v1.80.7 split rule).
 *
 * Coordinate system:
 *   x ∈ [0, 1]  — left → right
 *   y ∈ [0, 1]  — own goal (bottom of the rendered pitch) → opposing goal (top)
 *
 * Vocabulary keys off `League.ballType` (NOT `playerFormat`):
 *   FUTSAL → { GK, FIXO, ALA, PIVOT }       (5-aside default)
 *   SOCCER → 12-code soccer set in `positions.ts`
 *
 * Slot count for every soccer formation = `playerCount` (1 GK + outfield).
 */

import type { BallType, PositionCode } from './positions'

export interface FormationSlot {
  /** Position code the slot expects (must be valid for the ballType). */
  code: PositionCode
  /** Normalised x ∈ [0, 1]. 0 = left, 1 = right. */
  x: number
  /** Normalised y ∈ [0, 1]. 0 = own goal (bottom), 1 = opp goal (top). */
  y: number
}

export interface Formation {
  /** Total players on the pitch (1 GK + outfield). */
  playerCount: number
  /** Conventional code, e.g. "4-3-3", "4-2-3-1", "4-0". */
  code: string
  /** Same as `code` for now — kept separate for future i18n / rebrand. */
  displayName: string
  /** Ordered slots; length === playerCount. */
  slots: ReadonlyArray<FormationSlot>
}

// ── Row-y conventions ─────────────────────────────────────────────────────
const Y_GK = 0.06
const Y_DEF = 0.27
const Y_DM = 0.42
const Y_MID = 0.55
const Y_AM = 0.66
const Y_FWD = 0.85

// ── Per-row x distribution ────────────────────────────────────────────────
function distributeX(n: number): number[] {
  switch (n) {
    case 1: return [0.5]
    case 2: return [0.32, 0.68]
    case 3: return [0.2, 0.5, 0.8]
    case 4: return [0.15, 0.38, 0.62, 0.85]
    case 5: return [0.1, 0.3, 0.5, 0.7, 0.9]
    default: {
      // Generic even distribution with a 0.1 margin on each side.
      if (n <= 0) return []
      const out: number[] = []
      const span = 0.8
      const step = span / (n - 1 || 1)
      const start = n === 1 ? 0.5 : 0.1
      for (let i = 0; i < n; i++) out.push(start + step * i)
      return out
    }
  }
}

/** Build a row of N slots with the SAME code across the row. */
function row(code: PositionCode, count: number, y: number): FormationSlot[] {
  return distributeX(count).map((x) => ({ code, x, y }))
}

/** Build a soccer DEF row: [LB, CB×(n-2), RB] for n≥3, [CB×n] otherwise. */
function defRow(n: number): FormationSlot[] {
  const xs = distributeX(n)
  if (n >= 3) {
    return xs.map((x, i) => {
      if (i === 0) return { code: 'LB', x, y: Y_DEF }
      if (i === n - 1) return { code: 'RB', x, y: Y_DEF }
      return { code: 'CB', x, y: Y_DEF }
    })
  }
  return xs.map((x) => ({ code: 'CB', x, y: Y_DEF }))
}

/** Build a soccer MID row: [LM, CM×(n-2), RM] for n≥3, [CM×n] otherwise. */
function midRow(n: number, y: number = Y_MID): FormationSlot[] {
  const xs = distributeX(n)
  if (n >= 3) {
    return xs.map((x, i) => {
      if (i === 0) return { code: 'LM', x, y }
      if (i === n - 1) return { code: 'RM', x, y }
      return { code: 'CM', x, y }
    })
  }
  return xs.map((x) => ({ code: 'CM', x, y }))
}

/** Build a soccer FWD row: [LW, ST, RW] for 3, [ST×n] for ≤2. */
function fwdRow(n: number): FormationSlot[] {
  const xs = distributeX(n)
  if (n === 3) {
    return [
      { code: 'LW', x: xs[0], y: Y_FWD },
      { code: 'ST', x: xs[1], y: Y_FWD },
      { code: 'RW', x: xs[2], y: Y_FWD },
    ]
  }
  return xs.map((x) => ({ code: 'ST', x, y: Y_FWD }))
}

/** GK at the conventional center-bottom slot. */
const GK_SLOT: FormationSlot = { code: 'GK', x: 0.5, y: Y_GK }

// ── SOCCER formations ─────────────────────────────────────────────────────
//
// Each list is ordered by "common-ness" — the first entry is a sensible
// default for that player count.

const SOCCER_FORMATIONS: Record<number, ReadonlyArray<Formation>> = {
  5: [
    {
      // 1-2-1 — diamond. Most common 5-aside soccer default.
      playerCount: 5, code: '1-2-1', displayName: '1-2-1',
      slots: [
        GK_SLOT,
        { code: 'CB', x: 0.5, y: Y_DEF },
        { code: 'LM', x: 0.25, y: Y_MID },
        { code: 'RM', x: 0.75, y: Y_MID },
        { code: 'ST', x: 0.5, y: Y_FWD },
      ],
    },
    {
      playerCount: 5, code: '2-2', displayName: '2-2',
      slots: [
        GK_SLOT,
        { code: 'CB', x: 0.32, y: Y_DEF },
        { code: 'CB', x: 0.68, y: Y_DEF },
        { code: 'ST', x: 0.32, y: Y_FWD },
        { code: 'ST', x: 0.68, y: Y_FWD },
      ],
    },
    {
      playerCount: 5, code: '1-1-2', displayName: '1-1-2',
      slots: [
        GK_SLOT,
        { code: 'CB', x: 0.5, y: Y_DEF },
        { code: 'CM', x: 0.5, y: Y_MID },
        { code: 'ST', x: 0.32, y: Y_FWD },
        { code: 'ST', x: 0.68, y: Y_FWD },
      ],
    },
    {
      playerCount: 5, code: '2-1-1', displayName: '2-1-1',
      slots: [
        GK_SLOT,
        { code: 'CB', x: 0.32, y: Y_DEF },
        { code: 'CB', x: 0.68, y: Y_DEF },
        { code: 'CM', x: 0.5, y: Y_MID },
        { code: 'ST', x: 0.5, y: Y_FWD },
      ],
    },
    {
      playerCount: 5, code: '3-1', displayName: '3-1',
      slots: [
        GK_SLOT,
        ...defRow(3),
        { code: 'CM', x: 0.5, y: Y_MID },
      ],
    },
  ],
  6: [
    {
      playerCount: 6, code: '2-2-1', displayName: '2-2-1',
      slots: [GK_SLOT, ...defRow(2), ...midRow(2), ...fwdRow(1)],
    },
    {
      playerCount: 6, code: '1-2-2', displayName: '1-2-2',
      slots: [GK_SLOT, ...defRow(1), ...midRow(2), ...fwdRow(2)],
    },
    {
      playerCount: 6, code: '3-1-1', displayName: '3-1-1',
      slots: [GK_SLOT, ...defRow(3), ...midRow(1), ...fwdRow(1)],
    },
    {
      playerCount: 6, code: '2-1-2', displayName: '2-1-2',
      slots: [GK_SLOT, ...defRow(2), ...midRow(1), ...fwdRow(2)],
    },
    {
      playerCount: 6, code: '2-3', displayName: '2-3',
      slots: [GK_SLOT, ...defRow(2), ...midRow(3)],
    },
  ],
  7: [
    {
      playerCount: 7, code: '2-3-1', displayName: '2-3-1',
      slots: [GK_SLOT, ...defRow(2), ...midRow(3), ...fwdRow(1)],
    },
    {
      playerCount: 7, code: '3-2-1', displayName: '3-2-1',
      slots: [GK_SLOT, ...defRow(3), ...midRow(2), ...fwdRow(1)],
    },
    {
      playerCount: 7, code: '2-1-3', displayName: '2-1-3',
      slots: [
        GK_SLOT,
        ...defRow(2),
        { code: 'DM', x: 0.5, y: Y_DM },
        ...fwdRow(3),
      ],
    },
    {
      playerCount: 7, code: '3-1-2', displayName: '3-1-2',
      slots: [
        GK_SLOT,
        ...defRow(3),
        { code: 'DM', x: 0.5, y: Y_DM },
        ...fwdRow(2),
      ],
    },
    {
      playerCount: 7, code: '2-2-2', displayName: '2-2-2',
      slots: [GK_SLOT, ...defRow(2), ...midRow(2), ...fwdRow(2)],
    },
  ],
  8: [
    {
      playerCount: 8, code: '3-3-1', displayName: '3-3-1',
      slots: [GK_SLOT, ...defRow(3), ...midRow(3), ...fwdRow(1)],
    },
    {
      playerCount: 8, code: '3-2-2', displayName: '3-2-2',
      slots: [GK_SLOT, ...defRow(3), ...midRow(2), ...fwdRow(2)],
    },
    {
      playerCount: 8, code: '2-3-2', displayName: '2-3-2',
      slots: [GK_SLOT, ...defRow(2), ...midRow(3), ...fwdRow(2)],
    },
    {
      playerCount: 8, code: '2-4-1', displayName: '2-4-1',
      slots: [GK_SLOT, ...defRow(2), ...midRow(4), ...fwdRow(1)],
    },
    {
      playerCount: 8, code: '3-1-3', displayName: '3-1-3',
      slots: [
        GK_SLOT,
        ...defRow(3),
        { code: 'DM', x: 0.5, y: Y_DM },
        ...fwdRow(3),
      ],
    },
  ],
  9: [
    {
      playerCount: 9, code: '3-3-2', displayName: '3-3-2',
      slots: [GK_SLOT, ...defRow(3), ...midRow(3), ...fwdRow(2)],
    },
    {
      playerCount: 9, code: '3-4-1', displayName: '3-4-1',
      slots: [GK_SLOT, ...defRow(3), ...midRow(4), ...fwdRow(1)],
    },
    {
      playerCount: 9, code: '4-3-1', displayName: '4-3-1',
      slots: [
        GK_SLOT,
        ...defRow(4),
        { code: 'DM', x: 0.3, y: Y_MID },
        { code: 'CM', x: 0.5, y: Y_MID },
        { code: 'CAM', x: 0.7, y: Y_MID },
        ...fwdRow(1),
      ],
    },
    {
      playerCount: 9, code: '2-4-2', displayName: '2-4-2',
      slots: [GK_SLOT, ...defRow(2), ...midRow(4), ...fwdRow(2)],
    },
    {
      playerCount: 9, code: '3-2-3', displayName: '3-2-3',
      slots: [GK_SLOT, ...defRow(3), ...midRow(2), ...fwdRow(3)],
    },
  ],
  10: [
    {
      playerCount: 10, code: '4-3-2', displayName: '4-3-2',
      slots: [GK_SLOT, ...defRow(4), ...midRow(3), ...fwdRow(2)],
    },
    {
      playerCount: 10, code: '3-4-2', displayName: '3-4-2',
      slots: [GK_SLOT, ...defRow(3), ...midRow(4), ...fwdRow(2)],
    },
    {
      playerCount: 10, code: '4-4-1', displayName: '4-4-1',
      slots: [GK_SLOT, ...defRow(4), ...midRow(4), ...fwdRow(1)],
    },
    {
      playerCount: 10, code: '3-3-3', displayName: '3-3-3',
      slots: [GK_SLOT, ...defRow(3), ...midRow(3), ...fwdRow(3)],
    },
    {
      playerCount: 10, code: '4-2-3', displayName: '4-2-3',
      slots: [
        GK_SLOT,
        ...defRow(4),
        { code: 'DM', x: 0.32, y: Y_DM },
        { code: 'DM', x: 0.68, y: Y_DM },
        ...fwdRow(3),
      ],
    },
  ],
  11: [
    {
      // 4-3-3 with one DM holding + two CMs.
      playerCount: 11, code: '4-3-3', displayName: '4-3-3',
      slots: [
        GK_SLOT,
        ...defRow(4),
        { code: 'DM', x: 0.5, y: Y_DM },
        { code: 'CM', x: 0.32, y: Y_MID },
        { code: 'CM', x: 0.68, y: Y_MID },
        ...fwdRow(3),
      ],
    },
    {
      playerCount: 11, code: '4-4-2', displayName: '4-4-2',
      slots: [GK_SLOT, ...defRow(4), ...midRow(4), ...fwdRow(2)],
    },
    {
      // 4-2-3-1 — double pivot of DMs, three attacking mids (LW-CAM-RW), lone ST.
      playerCount: 11, code: '4-2-3-1', displayName: '4-2-3-1',
      slots: [
        GK_SLOT,
        ...defRow(4),
        { code: 'DM', x: 0.32, y: Y_DM },
        { code: 'DM', x: 0.68, y: Y_DM },
        { code: 'LW', x: 0.2, y: Y_AM },
        { code: 'CAM', x: 0.5, y: Y_AM },
        { code: 'RW', x: 0.8, y: Y_AM },
        ...fwdRow(1),
      ],
    },
    {
      // 3-5-2 — back-3, wing-backs/mids and a holding DM in the centre of the 5.
      playerCount: 11, code: '3-5-2', displayName: '3-5-2',
      slots: [
        GK_SLOT,
        ...defRow(3),
        { code: 'LM', x: 0.1, y: Y_MID },
        { code: 'CM', x: 0.3, y: Y_MID },
        { code: 'DM', x: 0.5, y: Y_MID },
        { code: 'CM', x: 0.7, y: Y_MID },
        { code: 'RM', x: 0.9, y: Y_MID },
        ...fwdRow(2),
      ],
    },
    {
      // 4-1-4-1 — single DM screen, flat 4 in midfield, lone ST.
      playerCount: 11, code: '4-1-4-1', displayName: '4-1-4-1',
      slots: [
        GK_SLOT,
        ...defRow(4),
        { code: 'DM', x: 0.5, y: Y_DM },
        ...midRow(4),
        ...fwdRow(1),
      ],
    },
  ],
} as const

// ── FUTSAL formations ─────────────────────────────────────────────────────

const FUTSAL_GK: FormationSlot = { code: 'GK', x: 0.5, y: Y_GK }

const FUTSAL_FORMATIONS: Record<number, ReadonlyArray<Formation>> = {
  5: [
    {
      // 1-2-1 — diamond. Most common futsal default.
      playerCount: 5, code: '1-2-1', displayName: '1-2-1 (Diamond)',
      slots: [
        FUTSAL_GK,
        { code: 'FIXO', x: 0.5, y: Y_DEF },
        { code: 'ALA', x: 0.25, y: Y_MID },
        { code: 'ALA', x: 0.75, y: Y_MID },
        { code: 'PIVOT', x: 0.5, y: Y_FWD },
      ],
    },
    {
      // 2-2 — square / box.
      playerCount: 5, code: '2-2', displayName: '2-2 (Square)',
      slots: [
        FUTSAL_GK,
        { code: 'FIXO', x: 0.32, y: Y_DEF },
        { code: 'FIXO', x: 0.68, y: Y_DEF },
        { code: 'PIVOT', x: 0.32, y: Y_FWD },
        { code: 'PIVOT', x: 0.68, y: Y_FWD },
      ],
    },
    {
      // 1-1-2 — Y. One FIXO, one ALA pivoting, two pivots high.
      playerCount: 5, code: '1-1-2', displayName: '1-1-2 (Y)',
      slots: [
        FUTSAL_GK,
        { code: 'FIXO', x: 0.5, y: Y_DEF },
        { code: 'ALA', x: 0.5, y: Y_MID },
        { code: 'PIVOT', x: 0.32, y: Y_FWD },
        { code: 'PIVOT', x: 0.68, y: Y_FWD },
      ],
    },
    {
      // 2-1-1 — defensive. Two FIXO at the back, ALA bridge, lone PIVOT.
      playerCount: 5, code: '2-1-1', displayName: '2-1-1',
      slots: [
        FUTSAL_GK,
        { code: 'FIXO', x: 0.32, y: Y_DEF },
        { code: 'FIXO', x: 0.68, y: Y_DEF },
        { code: 'ALA', x: 0.5, y: Y_MID },
        { code: 'PIVOT', x: 0.5, y: Y_FWD },
      ],
    },
    {
      // 4-0 — rotational, no fixed positions. All four outfield slots ALA
      // (the most permissive code), arranged as a flat line across the
      // middle so visualization reads as "anyone, anywhere".
      playerCount: 5, code: '4-0', displayName: '4-0 (Rotational)',
      slots: [
        FUTSAL_GK,
        { code: 'ALA', x: 0.15, y: Y_MID },
        { code: 'ALA', x: 0.38, y: Y_MID },
        { code: 'ALA', x: 0.62, y: Y_MID },
        { code: 'ALA', x: 0.85, y: Y_MID },
      ],
    },
  ],
} as const

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Look up the formation catalog for a given (ballType, playerCount).
 * Returns an empty array when no canonical set exists for the count
 * (e.g. ballType='SOCCER' with playerCount=4 — caller should hide the
 * picker / fall back to the list view).
 */
export function getFormationsFor(
  ballType: BallType | null | undefined,
  playerCount: number | null | undefined,
): ReadonlyArray<Formation> {
  if (playerCount == null) return []
  if (ballType === 'FUTSAL') return FUTSAL_FORMATIONS[playerCount] ?? []
  return SOCCER_FORMATIONS[playerCount] ?? []
}

/** Find a formation by code within a (ballType, playerCount) catalog. */
export function findFormation(
  ballType: BallType | null | undefined,
  playerCount: number | null | undefined,
  code: string,
): Formation | null {
  const list = getFormationsFor(ballType, playerCount)
  return list.find((f) => f.code === code) ?? null
}

// ── Slot-position compatibility map ───────────────────────────────────────
//
// v1.84.0 flipped the data direction: source-of-truth is now
// SLOT_COMPAT[slotCode] = { primary: <player codes>, fallback: <...> }.
// The two-pass assignment reads this natively (Pass 1 = primary, Pass 2
// = fallback). Player-direction queries derive from the inverse.
//
// See M1 entry of phase-formations-followup.log for the full table +
// rationale. GK is sacred everywhere (primary {GK}, no fallback).

interface SlotCompat {
  primary: ReadonlyArray<string>
  fallback: ReadonlyArray<string>
}

const SOCCER_SLOT_COMPAT: Record<string, SlotCompat> = {
  GK:  { primary: ['GK'],  fallback: [] },
  LB:  { primary: ['LB'],  fallback: ['CB', 'LM', 'DM'] },
  CB:  { primary: ['CB'],  fallback: ['DM'] },
  RB:  { primary: ['RB'],  fallback: ['CB', 'RM', 'DM'] },
  DM:  { primary: ['DM'],  fallback: ['CM', 'CB'] },
  CM:  { primary: ['CM'],  fallback: ['DM', 'CAM'] },
  CAM: { primary: ['CAM'], fallback: ['CM', 'ST'] },
  LM:  { primary: ['LM'],  fallback: ['LW', 'CM'] },
  RM:  { primary: ['RM'],  fallback: ['RW', 'CM'] },
  LW:  { primary: ['LW'],  fallback: ['LM', 'ST'] },
  RW:  { primary: ['RW'],  fallback: ['RM', 'ST'] },
  ST:  { primary: ['ST'],  fallback: ['CAM', 'LW', 'RW'] },
}

const FUTSAL_SLOT_COMPAT: Record<string, SlotCompat> = {
  GK:    { primary: ['GK'],    fallback: [] },
  FIXO:  { primary: ['FIXO'],  fallback: [] },
  ALA:   { primary: ['ALA'],   fallback: ['PIVOT'] },
  PIVOT: { primary: ['PIVOT'], fallback: ['ALA'] },
}

function compatFor(
  ballType: BallType | null | undefined,
  slotCode: string,
): SlotCompat | undefined {
  const map = ballType === 'FUTSAL' ? FUTSAL_SLOT_COMPAT : SOCCER_SLOT_COMPAT
  return map[slotCode.toUpperCase()]
}

/**
 * True iff the player's position code can fill the given slot via
 * the slot's PRIMARY list (Pass 1 candidate).
 */
export function playerCodeFillsSlotPrimary(
  ballType: BallType | null | undefined,
  playerCode: string,
  slotCode: string,
): boolean {
  const compat = compatFor(ballType, slotCode)
  if (!compat) return false
  return compat.primary.includes(playerCode.toUpperCase())
}

/**
 * True iff the player's position code is allowed in the given slot
 * (primary OR fallback). Used by the picker's "OUT OF POSITION" badge.
 */
export function playerCodeFillsSlot(
  ballType: BallType | null | undefined,
  playerCode: string,
  slotCode: string,
): boolean {
  const compat = compatFor(ballType, slotCode)
  if (!compat) return false
  const upper = playerCode.toUpperCase()
  return compat.primary.includes(upper) || compat.fallback.includes(upper)
}

/** True iff ANY of the player's positions can fill the slot via primary. */
export function playerFillsSlotPrimary(
  ballType: BallType | null | undefined,
  playerPositions: ReadonlyArray<string>,
  slotCode: string,
): boolean {
  for (const code of playerPositions) {
    if (playerCodeFillsSlotPrimary(ballType, code, slotCode)) return true
  }
  return false
}

/**
 * True iff ANY of the player's positions can fill the slot (primary or fallback).
 * Empty positions array → false (player has no position on file).
 */
export function playerFillsSlot(
  ballType: BallType | null | undefined,
  playerPositions: ReadonlyArray<string>,
  slotCode: string,
): boolean {
  for (const code of playerPositions) {
    if (playerCodeFillsSlot(ballType, code, slotCode)) return true
  }
  return false
}

// ── Multi-role assignment ────────────────────────────────────────────────

export interface AssignmentInput {
  /** Stable id (Player.id from the public payload). */
  id: string
  /**
   * Normalised position codes (per `normalizePositions`).
   * @deprecated Use `preferredPositions` + `secondaryPositions` (v1.86.0).
   * Kept for backward compat: when preferred/secondary are absent, positions[0]
   * is treated as primary and positions[1..] as secondary.
   */
  positions: ReadonlyArray<string>
  /** v1.86.0 — explicit preferred positions (fills pass 1a/2a). */
  preferredPositions?: ReadonlyArray<string>
  /** v1.86.0 — explicit secondary positions (fills pass 1b/2b). */
  secondaryPositions?: ReadonlyArray<string>
}

export interface AssignmentResult {
  /** slotIndex → playerId (or null when slot is empty). */
  slotAssignments: Array<string | null>
  /** Player ids that didn't get a starting slot (subs / overflow). */
  unassignedPlayers: string[]
  /**
   * Player ids whose `positions` is empty. Surfaced separately so the UI
   * can hint "fill in your profile".
   */
  playersWithoutPositions: string[]
}

/**
 * Two-pass scarcity-first assignment of available players to formation slots.
 *
 * v1.84.0 — flipped from "any-eligible" matching to a primary-first model
 * driven by the slot→{primary, fallback} compat table. Re-balance happens
 * automatically on roster change because the function is pure: re-running
 * with the new player set produces the new placement (no internal state).
 *
 * v1.85.2 — 5-pass algorithm respects positions[] order (positions[0] =
 * primary, positions[1..] = secondary). See positions.ts for the convention.
 *
 * Algorithm:
 *   0. Players with empty `positions[]` → `playersWithoutPositions` bucket.
 *   1a. **Pass 1a (primary→slot-primary).** Candidate = unplaced players
 *       whose positions[0] ∈ slot.PRIMARY. Scarcity-first within pass.
 *   1b. **Pass 1b (secondary→slot-primary).** Candidate = unplaced players
 *       whose positions[1..] ∩ slot.PRIMARY ≠ ∅.
 *   2a. **Pass 2a (primary→slot-fallback).** Candidate = unplaced players
 *       whose positions[0] ∈ slot.FALLBACK.
 *   2b. **Pass 2b (secondary→slot-fallback).** Candidate = unplaced players
 *       whose positions[1..] ∩ slot.FALLBACK ≠ ∅.
 *   3.  **Pass 3 (overflow).** Anyone unplaced → `unassignedPlayers` (subs).
 *
 * Worked example: A=[CM,ST], B=[GK], slots=[GK,CM,ST]
 *   Pass 1a: B→GK (B.positions[0]=GK ∈ GK.primary), A→CM (A.positions[0]=CM ∈ CM.primary)
 *   Pass 1b: ST slot — no unplaced players with ST as secondary (A is placed)
 *   Passes 2a/2b: ST fallback=[CAM,LW,RW] — no remaining players match
 *   Pass 3: ST stays empty → subs.
 *
 * Re-balance scenario: 3 CMs roster → CM gets primary (pass 1a), LM/RM
 * via fallback (pass 2a). Add a real ST → re-running picks ST at ST (1a),
 * CMs still at CM/LM/RM. New ST never displaces a primary match.
 *
 * Complexity: O(slots² × players) per pass. Runs in microseconds for
 * typical sizes (≤11 slots, ≤20 players).
 */
export function assignPlayersToFormation(
  ballType: BallType | null | undefined,
  formation: Formation,
  players: ReadonlyArray<AssignmentInput>,
): AssignmentResult {
  // Normalise each player onto canonical preferred/secondary arrays.
  // When the new split fields are present, use them directly.
  // When absent, fall back to positions[0]=primary, positions[1..]=secondary.
  interface NormalisedPlayer {
    id: string
    preferred: ReadonlyArray<string>
    secondary: ReadonlyArray<string>
  }
  const playersWithoutPositions: string[] = []
  const eligible: NormalisedPlayer[] = []
  for (const p of players) {
    const hasNewFields =
      p.preferredPositions !== undefined || p.secondaryPositions !== undefined
    const preferred: ReadonlyArray<string> = hasNewFields
      ? (p.preferredPositions ?? [])
      : p.positions.slice(0, 1)
    const secondary: ReadonlyArray<string> = hasNewFields
      ? (p.secondaryPositions ?? [])
      : p.positions.slice(1)
    if (preferred.length === 0 && secondary.length === 0) {
      playersWithoutPositions.push(p.id)
    } else {
      eligible.push({ id: p.id, preferred, secondary })
    }
  }

  const slotCount = formation.slots.length
  const slotAssignments: Array<string | null> = Array(slotCount).fill(null)
  const placedPlayers = new Set<string>()

  // ── Pass executor ──────────────────────────────────────────────────────
  // Runs one greedy scarcity-first sweep using a per-slot candidate function.
  // `eligible` predicate returns true iff the player can fill the slot
  // *under the current pass's rules* (preferred-only, or fallback-only).
  function runPass(
    passEligible: (p: NormalisedPlayer, slotCode: string) => boolean,
  ) {
    // slotIndex → Set<playerId>, only for unfilled slots and unplaced players.
    const slotCandidates: Array<Set<string>> = formation.slots.map((slot, idx) => {
      const set = new Set<string>()
      if (slotAssignments[idx] !== null) return set
      for (const p of eligible) {
        if (placedPlayers.has(p.id)) continue
        if (passEligible(p, slot.code)) set.add(p.id)
      }
      return set
    })

    // playerId → Set<slotIndex> (their candidate slots within this pass).
    const playerSlots = new Map<string, Set<number>>()
    slotCandidates.forEach((cands, slotIdx) => {
      for (const pid of cands) {
        let set = playerSlots.get(pid)
        if (!set) {
          set = new Set()
          playerSlots.set(pid, set)
        }
        set.add(slotIdx)
      }
    })

    while (true) {
      let bestSlot = -1
      let bestSize = Infinity
      for (let i = 0; i < slotCount; i++) {
        if (slotAssignments[i] !== null) continue
        const size = slotCandidates[i].size
        if (size === 0) continue
        if (size < bestSize) {
          bestSize = size
          bestSlot = i
        }
      }
      if (bestSlot === -1) break

      let bestPlayer = ''
      let bestPlayerSize = Infinity
      for (const pid of slotCandidates[bestSlot]) {
        const size = playerSlots.get(pid)!.size
        if (size < bestPlayerSize || (size === bestPlayerSize && pid < bestPlayer)) {
          bestPlayerSize = size
          bestPlayer = pid
        }
      }

      slotAssignments[bestSlot] = bestPlayer
      placedPlayers.add(bestPlayer)
      for (const cands of slotCandidates) cands.delete(bestPlayer)
      playerSlots.delete(bestPlayer)
    }
  }

  // Pass 1a: player's preferred position matches slot.primary
  runPass((p, slotCode) =>
    p.preferred.length > 0 && playerCodeFillsSlotPrimary(ballType, p.preferred[0]!, slotCode),
  )

  // Pass 1b: any secondary position matches slot.primary
  runPass((p, slotCode) => {
    for (const code of p.secondary) {
      if (playerCodeFillsSlotPrimary(ballType, code, slotCode)) return true
    }
    return false
  })

  // Pass 2a: player's preferred position matches slot.fallback
  runPass((p, slotCode) => {
    const compat = compatFor(ballType, slotCode)
    if (!compat || p.preferred.length === 0) return false
    return compat.fallback.includes(p.preferred[0]!.toUpperCase())
  })

  // Pass 2b: any secondary position matches slot.fallback
  runPass((p, slotCode) => {
    const compat = compatFor(ballType, slotCode)
    if (!compat) return false
    for (const code of p.secondary) {
      if (compat.fallback.includes(code.toUpperCase())) return true
    }
    return false
  })

  const unassignedPlayers: string[] = []
  for (const p of eligible) {
    if (!placedPlayers.has(p.id)) unassignedPlayers.push(p.id)
  }

  return { slotAssignments, unassignedPlayers, playersWithoutPositions }
}

// ── Sub-as-alternate (depth chart) assignment ───────────────────────────

/**
 * For each overflow player (sub), pick exactly ONE slot to display them
 * under as a depth-chart alternate. Decision rule (single-listing per M3):
 *   1. First slot in slot-array order where the sub is a PRIMARY candidate.
 *   2. Otherwise, first slot in slot-array order where they're FALLBACK.
 *   3. Otherwise, the sub goes into the `noFitOverflow` bucket.
 *
 * This is independent of the starter assignment — alternates are display-only.
 *
 * Returns:
 *   - `slotAlternates[i]` — ordered list of sub player ids displayed under slot i
 *   - `noFitOverflow` — subs that don't compat with any slot in the formation
 */
export interface AlternateAssignment {
  slotAlternates: Array<string[]>
  noFitOverflow: string[]
}

export function assignAlternatesToSlots(
  ballType: BallType | null | undefined,
  formation: Formation,
  subs: ReadonlyArray<AssignmentInput>,
): AlternateAssignment {
  const slotAlternates: Array<string[]> = formation.slots.map(() => [])
  const noFitOverflow: string[] = []

  for (const sub of subs) {
    let placed = false
    // Pass 1 — primary.
    for (let i = 0; i < formation.slots.length; i++) {
      if (playerFillsSlotPrimary(ballType, sub.positions, formation.slots[i].code)) {
        slotAlternates[i].push(sub.id)
        placed = true
        break
      }
    }
    if (placed) continue
    // Pass 2 — fallback.
    for (let i = 0; i < formation.slots.length; i++) {
      const compat = compatFor(ballType, formation.slots[i].code)
      if (!compat) continue
      let ok = false
      for (const code of sub.positions) {
        if (compat.fallback.includes(code.toUpperCase())) {
          ok = true
          break
        }
      }
      if (ok) {
        slotAlternates[i].push(sub.id)
        placed = true
        break
      }
    }
    if (!placed) noFitOverflow.push(sub.id)
  }

  return { slotAlternates, noFitOverflow }
}
