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
 * v2.2.9 — sort weight for a single position code under a league's
 * vocabulary. Unknown codes (or empty/null) sort to the end via a
 * deliberately-large weight, so members with no recorded position land
 * after the typed roster — matches the "list ordered by role" intuition
 * for the onboarding team picker.
 */
export function getPositionSortWeight(
  code: PositionCode | null | undefined,
  ballType: BallType | null | undefined,
): number {
  if (!code) return Number.MAX_SAFE_INTEGER
  const upper = code.trim().toUpperCase()
  if (!upper) return Number.MAX_SAFE_INTEGER
  const def = getPositionVocabulary(ballType).find((p) => p.code === upper)
  return def?.sortWeight ?? Number.MAX_SAFE_INTEGER
}

/**
 * v2.2.9 — pure sort helper used by the onboarding team-picker cards.
 * Orders a roster by primary position (GK first → forwards/pivot last,
 * per the league's vocabulary) and breaks ties alphabetically by name.
 *
 * `primaryPosition` is the player's first preferred code (or legacy
 * single code) — empty/unknown sorts to the end. Name comparison is
 * case-insensitive and locale-aware.
 *
 * Stable: returns a new array, does not mutate input.
 */
export function sortMembersByPrimaryPositionThenName<
  T extends { primaryPosition: string | null | undefined; name: string },
>(
  members: ReadonlyArray<T>,
  ballType: BallType | null | undefined,
): T[] {
  return [...members].sort((a, b) => {
    const wa = getPositionSortWeight(a.primaryPosition, ballType)
    const wb = getPositionSortWeight(b.primaryPosition, ballType)
    if (wa !== wb) return wa - wb
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
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
 * v1.93.0 — maximum count of preferred positions a player may record per
 * league. Enforced server-side via `validatePreferredSecondary` and at
 * the UI layer (RegistrationFields / AccountPlayerForm / admin edit /
 * ApplyToLeagueModal) by greying out additional chips once the cap is
 * hit. Secondary positions are NOT capped.
 */
export const MAX_PREFERRED_POSITIONS = 3

/**
 * v1.86.0 — Validate and normalise the preferred + secondary position
 * arrays submitted from the account page or join flow.
 *
 * Rules:
 *   - Each array is independently normalised via `normalizePositions`.
 *   - A code that appears in `preferred` is silently removed from
 *     `secondary` (no duplicates across the two sets).
 *   - Both may be empty (no position recorded).
 *   - v1.93.0 — `preferred.length <= MAX_PREFERRED_POSITIONS`. Oversize
 *     submissions return `{ ok: false, error }` so callers surface a
 *     friendly hint instead of silently truncating. UI clamps the
 *     selection, so this gate primarily defends against tampered
 *     client submissions.
 *
 * Returns `{ ok: true, preferred, secondary }` or
 *         `{ ok: false, error }` on invalid code or oversize preferred.
 */
export function validatePreferredSecondary(
  rawPreferred: ReadonlyArray<string> | null | undefined,
  rawSecondary: ReadonlyArray<string> | null | undefined,
  ballType: BallType | null | undefined,
): { ok: true; preferred: PositionCode[]; secondary: PositionCode[] } | { ok: false; error: string } {
  try {
    const preferred = normalizePositions(rawPreferred ?? [], ballType)
    if (preferred.length > MAX_PREFERRED_POSITIONS) {
      return {
        ok: false,
        error: `Preferred positions: pick at most ${MAX_PREFERRED_POSITIONS}.`,
      }
    }
    const prefSet = new Set(preferred)
    const secondaryRaw = normalizePositions(rawSecondary ?? [], ballType)
    const secondary = secondaryRaw.filter((c) => !prefSet.has(c))
    return { ok: true, preferred, secondary }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

// v1.92.0 — Forward-score map for score-based bucketing of preferred-
// positions arrays. Lower values are deeper roles, higher values are
// more attacking. Soccer (12 codes) and futsal (4 codes) share the
// same GK=0 anchor; futsal jumps to 1/3/5 because it has fewer codes.
const POSITION_FORWARD_SCORES: Record<string, number> = {
  // Soccer
  GK:  0,
  LB:  1, CB:  1, RB:  1,
  DM:  2,
  CM:  3, LM:  3, RM:  3,
  CAM: 4, LW:  4, RW:  4,
  ST:  5,
  // Futsal
  FIXO:  1,
  ALA:   3,
  PIVOT: 5,
}

/** v1.92.0 — bucket returned by `getPositionBucketByScore`. `null` means
 *  unbucketed (empty preferred-positions array — caller decides whether
 *  to render an "Other" section or hide). */
export type ScoreBucket = 'GK' | 'DF' | 'MF' | 'FW' | null

/**
 * v1.92.0 — Score-based bucketing for the PlayerAvailability list view.
 *
 * Replaces the pre-v1.92 `positions[0]` rule (which picked one code
 * arbitrarily off the array) with an averaged forward-score across the
 * full `preferredPositions[]` array, so a player who plays CB + CM + ST
 * lands in Midfield (avg 3.0) instead of Defense (positions[0]=CB).
 *
 * Rules:
 *   1. Any preferred code == GK → 'GK' (short-circuit; goalkeepers are
 *      uniquely keyed by role, never averaged with outfield codes).
 *   2. Otherwise average POSITION_FORWARD_SCORES across the array.
 *      - avg < 1.5         → 'DF'
 *      - 1.5 ≤ avg < 3.5   → 'MF'
 *      - avg ≥ 3.5         → 'FW'
 *   3. Empty array (or array of only-unknown-codes) → null (unbucketed).
 *
 * Worked examples (per the v1.92.0 product brief):
 *   [CB,CM,ST]   → (1+3+5)/3 = 3.0   → 'MF'
 *   [CAM,ST,LW]  → (4+5+4)/3 ≈ 4.33  → 'FW'
 *   [CB,DM]      → (1+2)/2  = 1.5    → 'MF' (boundary, inclusive lower)
 *   [GK,CB]      → contains GK       → 'GK'
 *   [ST]         → 5                  → 'FW'
 *
 * The old `getPositionBucket(code)` helper stays for non-list callers
 * (SquadList colours, group labels, formation grouping) that still
 * operate on a single code.
 */
export function getPositionBucketByScore(
  positions: ReadonlyArray<string> | null | undefined,
): ScoreBucket {
  if (!positions || positions.length === 0) return null

  // Normalise once; skip empties.
  const codes = positions
    .map((p) => (typeof p === 'string' ? p.trim().toUpperCase() : ''))
    .filter((p) => p.length > 0)
  if (codes.length === 0) return null

  // GK short-circuit.
  if (codes.some((c) => c === 'GK')) return 'GK'

  // Average score across known codes. Unknown codes are dropped from
  // the average rather than scoring 0 (which would falsely pull the
  // average toward DF for a player with one unknown code + one ST).
  let sum = 0
  let n = 0
  for (const c of codes) {
    const score = POSITION_FORWARD_SCORES[c]
    if (typeof score === 'number') {
      sum += score
      n += 1
    }
  }
  if (n === 0) return null

  const avg = sum / n
  if (avg < 1.5) return 'DF'
  if (avg < 3.5) return 'MF'
  return 'FW'
}
