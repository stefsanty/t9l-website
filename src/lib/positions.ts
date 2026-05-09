/**
 * v1.82.0 — Per-format position vocabulary.
 *
 * ## positions[] array convention (v1.85.2)
 *
 * `PlayerLeagueMembership.positions` is an ordered array:
 *   positions[0]   = primary position (drives formation assignment pass 1a/2a)
 *   positions[1..] = secondary positions (drives pass 1b/2b)
 *
 * **Important:** `PositionMultiSelect` stores codes in canonical vocabulary
 * order (GK → LB → CB → … → RW), NOT click order. So `positions[0]` is
 * always the vocab-earliest code the player selected, which correlates with
 * the most defensive/structural role — a reasonable proxy for "primary" but
 * NOT an explicit user intent. If explicit user-expressed primacy is ever
 * needed, add `primaryPosition: String?` to the schema and surface a
 * separate "set as primary" UI rather than inferring from array order.
 *
 * Soccer leagues (`ballType = SOCCER`) use a 12-role vocabulary with
 * left/center/right specificity. Futsal leagues (`ballType = FUTSAL`)
 * use the four canonical futsal roles: GK (Goleiro), FIXO (Defender),
 * ALA (Winger/Midfield), PIVOT (Striker).
 *
 * The vocabulary keys off `League.ballType` (NOT `playerFormat` —
 * 9-aside soccer still uses the same 12-code soccer set).
 *
 * Codes are stored on `PlayerLeagueMembership.positions String[]` as
 * canonical UPPERCASE; display labels are render-time only and never
 * persisted. Pure module — no DB or framework imports — so it can be
 * imported from both server actions and client components without
 * dragging Prisma into the public bundle (per the v1.80.7 split rule).
 */

export type BallType = 'SOCCER' | 'FUTSAL'
export type PositionCode = string

interface PositionDef {
  code: PositionCode
  label: string
  /** Sort weight — used by SquadList / formation grouping. Lower = front of list. */
  sortWeight: number
  /**
   * Coarse role bucket. Used by SquadList colors, MatchdayAvailability
   * formation grouping, and the legacy `PlayerPosition` enum dual-write
   * helper. Keeps the renderers from having to enumerate all 12 soccer
   * codes individually.
   */
  bucket: 'GK' | 'DF' | 'MF' | 'FW'
}

const SOCCER_POSITIONS: ReadonlyArray<PositionDef> = [
  { code: 'GK',  label: 'GK — Goalkeeper',                  sortWeight: 1,  bucket: 'GK' },
  { code: 'LB',  label: 'LB — Left Back',                   sortWeight: 2,  bucket: 'DF' },
  { code: 'CB',  label: 'CB — Center Back',                 sortWeight: 3,  bucket: 'DF' },
  { code: 'RB',  label: 'RB — Right Back',                  sortWeight: 4,  bucket: 'DF' },
  { code: 'LM',  label: 'LM — Left Midfielder',             sortWeight: 5,  bucket: 'MF' },
  { code: 'DM',  label: 'DM — Defensive Midfielder',        sortWeight: 6,  bucket: 'MF' },
  { code: 'CM',  label: 'CM — Center Midfielder',           sortWeight: 7,  bucket: 'MF' },
  { code: 'CAM', label: 'CAM — Center Attacking Midfielder', sortWeight: 8,  bucket: 'MF' },
  { code: 'RM',  label: 'RM — Right Midfielder',            sortWeight: 9,  bucket: 'MF' },
  { code: 'LW',  label: 'LW — Left Winger',                 sortWeight: 10, bucket: 'FW' },
  { code: 'ST',  label: 'ST — Striker',                     sortWeight: 11, bucket: 'FW' },
  { code: 'RW',  label: 'RW — Right Winger',                sortWeight: 12, bucket: 'FW' },
]

const FUTSAL_POSITIONS: ReadonlyArray<PositionDef> = [
  { code: 'GK',    label: 'GK — Goleiro (Goalkeeper)',     sortWeight: 1, bucket: 'GK' },
  { code: 'FIXO',  label: 'FIXO — Defender',               sortWeight: 2, bucket: 'DF' },
  { code: 'ALA',   label: 'ALA — Winger / Midfield',       sortWeight: 3, bucket: 'MF' },
  { code: 'PIVOT', label: 'PIVOT — Striker',               sortWeight: 4, bucket: 'FW' },
]

const ALL_DEFS: ReadonlyArray<PositionDef> = [...SOCCER_POSITIONS, ...FUTSAL_POSITIONS]

export function getPositionVocabulary(
  ballType: BallType | null | undefined,
): ReadonlyArray<PositionDef> {
  return ballType === 'FUTSAL' ? FUTSAL_POSITIONS : SOCCER_POSITIONS
}

/** Set of valid codes for the league's format. Case-sensitive. */
export function getValidPositionCodes(
  ballType: BallType | null | undefined,
): ReadonlySet<PositionCode> {
  return new Set(getPositionVocabulary(ballType).map((p) => p.code))
}

/** Display label for a single code. Falls back to the code itself when unknown. */
export function getPositionLabel(
  code: PositionCode,
  ballType: BallType | null | undefined,
): string {
  const def = getPositionVocabulary(ballType).find((p) => p.code === code)
  return def?.label ?? code
}

/**
 * Coarse role bucket for any known code (across BOTH formats). Used by
 * legacy renderers (SquadList colours, MatchdayAvailability formation
 * grouping) that pre-date the 12-code soccer split.
 *
 * Falls back to 'MF' for unknown codes — matches the existing
 * formation-grouping default for unrecognised values.
 */
export function getPositionBucket(code: PositionCode): 'GK' | 'DF' | 'MF' | 'FW' {
  const upper = code.toUpperCase()
  const def = ALL_DEFS.find((p) => p.code === upper)
  if (def) return def.bucket
  // v1.65.4-era legacy single-letter codes still sometimes leak through
  // joined strings — handle them so existing reads colour correctly.
  if (upper === 'DF' || upper === 'DEF' || upper === 'DFD') return 'DF'
  if (upper === 'MF' || upper === 'MID' || upper === 'MFD') return 'MF'
  if (upper === 'FW' || upper === 'FWD' || upper === 'FORWARD') return 'FW'
  return 'MF'
}

/**
 * Normalise & validate user-supplied positions for a given league format.
 * Behaviour:
 *   - Trims, uppercases each entry; drops empties.
 *   - Keeps order while deduping (first occurrence wins).
 *   - Throws when any entry is not in the format's vocabulary.
 *
 * Empty input is allowed (matches the legacy "position is optional"
 * UX). Callers that want to require ≥1 position must check the result.
 */
export function normalizePositions(
  raw: ReadonlyArray<string> | string | null | undefined,
  ballType: BallType | null | undefined,
): PositionCode[] {
  if (raw == null) return []
  const arr = Array.isArray(raw) ? raw : [raw]
  const valid = getValidPositionCodes(ballType)
  const seen = new Set<PositionCode>()
  const out: PositionCode[] = []
  for (const item of arr) {
    if (typeof item !== 'string') continue
    const code = item.trim().toUpperCase()
    if (!code) continue
    if (!valid.has(code)) {
      throw new Error(
        `Invalid position "${code}" for ${ballType ?? 'SOCCER'} league. ` +
          `Allowed: ${[...valid].join(', ')}`,
      )
    }
    if (seen.has(code)) continue
    seen.add(code)
    out.push(code)
  }
  return out
}

/**
 * Pick the legacy `PlayerPosition` enum value (GK/DF/MF/FW) to dual-
 * write alongside `positions[]`. v1.82.0 keeps
 * `PlayerLeagueMembership.position` populated for one release cycle
 * so any reader that hasn't been updated still sees a sensible value.
 *
 * Maps each new code through `getPositionBucket()`, returns the first
 * non-null bucket. For futsal-only codes (FIXO, ALA, PIVOT) the bucket
 * is the same DF/MF/FW shape so the legacy enum still gets a value.
 */
export function legacyPositionFromArray(
  positions: ReadonlyArray<string>,
): 'GK' | 'DF' | 'MF' | 'FW' | null {
  for (const p of positions) {
    if (!p) continue
    return getPositionBucket(p)
  }
  return null
}

/**
 * Read fallback: prefer the new `positions[]` array; if empty, fall
 * through to the legacy single `position` column. Empty result means
 * "no position recorded".
 */
export function readPositions(input: {
  positions?: ReadonlyArray<string> | null
  position?: string | null
}): PositionCode[] {
  if (input.positions && input.positions.length > 0) {
    return [...input.positions]
  }
  if (input.position) return [input.position]
  return []
}

/** Join positions as `"GK/CB"` for compact single-cell display. */
export function joinPositions(positions: ReadonlyArray<string>): string {
  return positions.join('/')
}

/**
 * Tailwind color classes for a position pill, keyed by coarse bucket.
 *
 * GK → yellow  |  DF → blue  |  MF → green  |  FW → red
 * Futsal: GK → yellow, FIXO (DF) → blue, ALA (MF) → green, PIVOT (FW) → red
 */
export function positionPillColor(code: string): string {
  switch (getPositionBucket(code)) {
    case 'GK': return 'bg-yellow-500/20 text-yellow-300'
    case 'DF': return 'bg-blue-500/20 text-blue-300'
    case 'MF': return 'bg-green-500/20 text-green-300'
    case 'FW': return 'bg-red-500/20 text-red-300'
  }
}

// Futsal-specific codes that pass through groupedPositionLabel unchanged.
const FUTSAL_SPECIFIC_CODES = new Set(['FIXO', 'ALA', 'PIVOT'])

/**
 * Coarse grouped label for a positions array — suitable for list-view cells
 * (admin table, SquadList, player profile cards) where 12-code soccer
 * precision is noise rather than signal.
 *
 * Grouping (soccer): GK→"GK", LB/CB/RB→"DF", LM/DM/CM/CAM/RM→"MF",
 * LW/ST/RW→"FW". Dedupes within the same group so [CM,CAM]→"MF" not
 * "MF / MF". Mixed groups like [CB,LW]→"DF / FW".
 *
 * Futsal-specific codes (FIXO, ALA, PIVOT) pass through unchanged since
 * they already carry meaning at their code level. GK is the same in both.
 *
 * Empty array → "".
 */
export function groupedPositionLabel(positions: ReadonlyArray<string>): string {
  if (positions.length === 0) return ''
  const seen = new Set<string>()
  const labels: string[] = []
  for (const code of positions) {
    const upper = code.trim().toUpperCase()
    if (!upper) continue
    const label = FUTSAL_SPECIFIC_CODES.has(upper) ? upper : getPositionBucket(upper)
    if (!seen.has(label)) {
      seen.add(label)
      labels.push(label)
    }
  }
  return labels.join(' / ')
}

/**
 * v1.86.0 — Validate and normalise the preferred + secondary position
 * arrays submitted from the account page or join flow.
 *
 * Rules:
 *   - Each array is independently normalised via `normalizePositions`.
 *   - A code that appears in `preferred` is silently removed from
 *     `secondary` (no duplicates across the two sets).
 *   - Both may be empty (no position recorded).
 *
 * Returns `{ ok: true, preferred, secondary }` or
 *         `{ ok: false, error }` on invalid code.
 */
export function validatePreferredSecondary(
  rawPreferred: ReadonlyArray<string> | null | undefined,
  rawSecondary: ReadonlyArray<string> | null | undefined,
  ballType: BallType | null | undefined,
): { ok: true; preferred: PositionCode[]; secondary: PositionCode[] } | { ok: false; error: string } {
  try {
    const preferred = normalizePositions(rawPreferred ?? [], ballType)
    const prefSet = new Set(preferred)
    const secondaryRaw = normalizePositions(rawSecondary ?? [], ballType)
    const secondary = secondaryRaw.filter((c) => !prefSet.has(c))
    return { ok: true, preferred, secondary }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
