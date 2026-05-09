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
// Direction: PLAYER_FILLS_SLOTS[playerCode] = set of slot codes that
// player can fill. Permissive enough that:
//   - LB plays only LB slots (strict per spec).
//   - CM can fill {DM, CM, CAM} (per spec).
//   - LM can fill {LM, LW} (per spec).
//   - Plus football-common extensions (CB↔DM swap, LW↔ST, etc.).
//
// The inverse (slot → eligible players) is computed lazily by
// `playerEligibleForSlot()` — we keep the source-of-truth in player→slots
// because that's the direction the user spec is written in and the
// direction the assignment algorithm reads.
//
// See M3 entry of phase-formations.log for the full per-format rationale.

const SOCCER_PLAYER_FILLS_SLOTS: Record<string, ReadonlyArray<string>> = {
  GK: ['GK'],
  LB: ['LB'],
  CB: ['CB', 'DM'],
  RB: ['RB'],
  LM: ['LM', 'LW'],
  DM: ['DM', 'CM', 'CB'],
  CM: ['DM', 'CM', 'CAM'],
  CAM: ['CAM', 'CM', 'ST'],
  RM: ['RM', 'RW'],
  LW: ['LW', 'LM', 'ST'],
  ST: ['ST', 'CAM'],
  RW: ['RW', 'RM', 'ST'],
}

const FUTSAL_PLAYER_FILLS_SLOTS: Record<string, ReadonlyArray<string>> = {
  GK: ['GK'],
  FIXO: ['FIXO', 'ALA'],
  ALA: ['ALA', 'FIXO', 'PIVOT'],
  PIVOT: ['PIVOT', 'ALA'],
}

/**
 * True iff the player's position code is allowed in the given slot.
 * Unknown player codes match nothing (caller should treat as "no
 * positions on file" and route to the unassigned bucket). Slot codes
 * are matched case-insensitively for safety; player codes are assumed
 * upstream-normalised by `normalizePositions()`.
 */
export function playerCodeFillsSlot(
  ballType: BallType | null | undefined,
  playerCode: string,
  slotCode: string,
): boolean {
  const map = ballType === 'FUTSAL' ? FUTSAL_PLAYER_FILLS_SLOTS : SOCCER_PLAYER_FILLS_SLOTS
  const fills = map[playerCode.toUpperCase()]
  if (!fills) return false
  return fills.includes(slotCode.toUpperCase())
}

/**
 * True iff ANY of the player's positions can fill the slot.
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
  /** Normalised position codes (per `normalizePositions`). */
  positions: ReadonlyArray<string>
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
 * Greedy scarcity-first assignment of available players to formation slots.
 *
 * Algorithm:
 *   1. Filter out players with no positions on file (they go to
 *      `playersWithoutPositions`).
 *   2. For each remaining slot, compute its candidate set
 *      (players whose positions ∩ slot.compatible-positions ≠ ∅).
 *   3. Repeatedly pick the slot with the FEWEST candidates remaining
 *      (scarcity-first — pin down the constrained slots before the
 *      flexible ones). Tie-break by slot index for determinism.
 *   4. Within that slot, pick the candidate with the FEWEST other
 *      compatible slots (least flexible — save the polyvalent players
 *      for slots that desperately need them). Tie-break by player id.
 *   5. Mark slot+player as assigned, remove the player from all other
 *      slots' candidate sets, and recurse.
 *   6. When no slot has any candidate left, stop. Remaining players go
 *      to `unassignedPlayers` (subs).
 *
 * Complexity: O(slots² × players). For ≤11×~25 this runs in microseconds.
 *
 * Tested separately in `tests/unit/formationsAssignment.test.ts`.
 */
export function assignPlayersToFormation(
  ballType: BallType | null | undefined,
  formation: Formation,
  players: ReadonlyArray<AssignmentInput>,
): AssignmentResult {
  const playersWithoutPositions: string[] = []
  const eligible: AssignmentInput[] = []
  for (const p of players) {
    if (p.positions.length === 0) {
      playersWithoutPositions.push(p.id)
    } else {
      eligible.push(p)
    }
  }

  const slotCount = formation.slots.length
  const slotAssignments: Array<string | null> = Array(slotCount).fill(null)

  // Precompute compatibility matrix: slotIndex → Set<playerId>
  const slotCandidates: Array<Set<string>> = formation.slots.map((slot) => {
    const set = new Set<string>()
    for (const p of eligible) {
      if (playerFillsSlot(ballType, p.positions, slot.code)) set.add(p.id)
    }
    return set
  })

  // Inverse: playerId → Set<slotIndex>
  const playerSlots = new Map<string, Set<number>>()
  for (const p of eligible) playerSlots.set(p.id, new Set())
  slotCandidates.forEach((cands, slotIdx) => {
    for (const pid of cands) playerSlots.get(pid)!.add(slotIdx)
  })

  while (true) {
    // Pick the unfilled slot with the fewest candidates (>0). Skip slots
    // with empty candidate sets — they'll show as empty in the UI.
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

    // Within that slot, pick the player with the fewest other slot options.
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
    // Remove the picked player from every slot's candidate set.
    for (const cands of slotCandidates) cands.delete(bestPlayer)
    playerSlots.delete(bestPlayer)
  }

  const assignedSet = new Set(slotAssignments.filter((id): id is string => id !== null))
  const unassignedPlayers: string[] = []
  for (const p of eligible) {
    if (!assignedSet.has(p.id)) unassignedPlayers.push(p.id)
  }

  return { slotAssignments, unassignedPlayers, playersWithoutPositions }
}
