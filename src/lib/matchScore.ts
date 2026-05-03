import type { PrismaClient, Prisma, GoalType } from '@prisma/client'

/**
 * v1.42.0 (epic match events PR α). Pure helpers + a Prisma-side recompute
 * that derives `Match.homeScore` / `Match.awayScore` from `MatchEvent` rows.
 *
 * Architectural framing
 * ---------------------
 * Pre-v1.42.0, `Match.homeScore` / `Match.awayScore` were ground truth —
 * admin typed them in via `updateMatchScore` and they sat there independent
 * of the `Goal` table. v1.42.0 makes those columns a **derived cache** off
 * the `MatchEvent` rows. Every admin / player write to MatchEvent triggers
 * `recomputeMatchScore(prisma, matchId)`; the cache columns are then read
 * by the existing public surface (StatsTab, MatchdayCard, etc.) without
 * the read sites changing shape. PR δ flips read sites to compute from
 * events directly when richer per-event detail is needed (minute, goal
 * type), but the integer scoreline cache remains.
 *
 * `Match.scoreOverride` (new in PR α) is a free-text string that, when
 * non-null, takes precedence over the cache for display. Forfeits, abandoned
 * matches, manually-corrected scores. The override does NOT mutate the
 * cache — `recomputeMatchScore` keeps populating the cache from events even
 * when an override is in place, so flipping the override on/off doesn't
 * lose the event-implied scoreline. Computational paths (top scorers, table
 * standings) keep using events; only the displayed scoreline differs.
 *
 * Own-goal handling
 * -----------------
 * For a MatchEvent with `goalType: 'OWN_GOAL'`, the scorer is a Player on
 * the team that conceded. The goal counts toward the OPPOSING team's tally.
 * The scorer FK still points at the OG-er — we keep the audit trail; only
 * the team affiliation flips for the cache compute.
 *
 * Player→team resolution
 * ----------------------
 * Each event's scorer is mapped to a "scoring team" via the
 * PlayerLeagueAssignment for the match's GameWeek. The pure helper takes
 * the lookup as input; `recomputeMatchScore` builds the lookup from a fresh
 * Prisma query (the eventual roster size is bounded — ~30/team — so cost is
 * negligible). If a scorer cannot be resolved to either match team's roster
 * the event is skipped and a structured warning logged; this is a data bug
 * (admin-entered event for a player not on either side) and should not
 * silently inflate one team's tally.
 */

export type EventForScore = {
  scorerId: string
  goalType: GoalType | null
}

export type ScoreCache = {
  home: number
  away: number
}

export type ResolvedDisplayScore = {
  /** Numeric values used for sorting / table math. */
  home: number
  away: number
  /** `'override'` when `Match.scoreOverride` is non-null; otherwise `'cache'`. */
  kind: 'cache' | 'override'
  /** Raw override string when present. May or may not parse to home-away digits. */
  overrideText?: string
  /**
   * `true` when an override is set AND it parsed cleanly as `"H-A"` so the
   * `home`/`away` values reflect the override's numeric content. `false`
   * when override is set but unparseable — the numbers are the cache values
   * and the override is shown as decoration.
   */
  overrideParsedCleanly?: boolean
}

/**
 * Pure: recompute the integer score cache from a match's events.
 *
 * Inputs:
 *  - `homeTeamId` / `awayTeamId` — the LeagueTeam ids on the match record.
 *  - `events` — every MatchEvent row for the match. Only `kind=GOAL` events
 *    contribute (others are filtered out implicitly — currently only GOAL
 *    exists, but the filter shape is robust to future EventKinds).
 *  - `scorerTeamLookup` — `playerId → leagueTeamId`. Built by the caller
 *    from `PlayerLeagueAssignment` covering the match's GameWeek.
 *
 * Behavior:
 *  - For each goal event, resolve the scorer's team. If unresolvable (player
 *    not on either match team's roster) or not in this match, the event is
 *    silently skipped — the caller logs structured warnings if it cares.
 *  - For OPEN_PLAY / SET_PIECE / PENALTY: tally goes to the scorer's team.
 *  - For OWN_GOAL: tally flips to the OPPOSING team.
 *  - Empty events → 0-0.
 */
export function computeScoreFromEvents(
  homeTeamId: string,
  awayTeamId: string,
  events: EventForScore[],
  scorerTeamLookup: Map<string, string>,
): ScoreCache {
  let home = 0
  let away = 0
  for (const ev of events) {
    const scorerTeam = scorerTeamLookup.get(ev.scorerId)
    if (!scorerTeam) continue
    if (scorerTeam !== homeTeamId && scorerTeam !== awayTeamId) continue
    const isOwnGoal = ev.goalType === 'OWN_GOAL'
    const beneficiaryTeam = isOwnGoal
      ? scorerTeam === homeTeamId
        ? awayTeamId
        : homeTeamId
      : scorerTeam
    if (beneficiaryTeam === homeTeamId) home++
    else if (beneficiaryTeam === awayTeamId) away++
  }
  return { home, away }
}

/**
 * Pure: parse the optional `Match.scoreOverride` string into a numeric
 * scoreline if it has the shape `"H-A"` (or `"H – A"` / `"H — A"` / `"H:A"`).
 * Falls back to `null` when unparseable so the caller knows to treat the
 * override as decoration.
 */
export function parseScoreOverride(
  raw: string,
): { home: number; away: number } | null {
  // Look for the FIRST H-A pair so prefixes like "score: 3-0" and suffixes
  // like "3-0 (forfeit)" parse cleanly. Hyphen-minus, en-dash, em-dash, or
  // colon between the numbers.
  const m = raw.match(/(\d+)\s*[-–—:]\s*(\d+)/)
  if (!m) return null
  const home = parseInt(m[1], 10)
  const away = parseInt(m[2], 10)
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null
  return { home, away }
}

/**
 * Pure: resolve the displayed score for a Match. When `scoreOverride` is
 * non-null and parses cleanly, the override drives the numbers; when set
 * but unparseable, the cache integers stand and the override string is
 * exposed for decoration.
 */
export function resolveDisplayScore(match: {
  homeScore: number
  awayScore: number
  scoreOverride: string | null
}): ResolvedDisplayScore {
  if (match.scoreOverride === null || match.scoreOverride === undefined) {
    return { home: match.homeScore, away: match.awayScore, kind: 'cache' }
  }
  const parsed = parseScoreOverride(match.scoreOverride)
  if (parsed !== null) {
    return {
      home: parsed.home,
      away: parsed.away,
      kind: 'override',
      overrideText: match.scoreOverride,
      overrideParsedCleanly: true,
    }
  }
  return {
    home: match.homeScore,
    away: match.awayScore,
    kind: 'override',
    overrideText: match.scoreOverride,
    overrideParsedCleanly: false,
  }
}

/**
 * Side-effecting: read the match + its events + the scorer→team lookup
 * from Prisma, compute the cache, write the integer columns. Idempotent.
 *
 * Called from every MatchEvent write site (admin CRUD in PR γ, player
 * self-report in PR ζ). Wraps a transaction-friendly `tx` parameter so
 * callers can chain it inside a Prisma `$transaction(async tx => ...)` —
 * pass `tx` as the `prisma` argument.
 *
 * Logs (console.warn with structured `[v1.42.0 SCORE-COMPUTE]` prefix) when
 * an event scorer cannot be resolved to either team, so operators can audit.
 */
export async function recomputeMatchScore(
  prisma: PrismaClient | Prisma.TransactionClient,
  matchId: string,
): Promise<ScoreCache> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      gameWeekId: true,
    },
  })
  if (!match) {
    return { home: 0, away: 0 }
  }
  const [events, assignments] = await Promise.all([
    prisma.matchEvent.findMany({
      where: { matchId, kind: 'GOAL' },
      select: { scorerId: true, goalType: true },
    }),
    prisma.playerLeagueAssignment.findMany({
      where: {
        leagueTeamId: { in: [match.homeTeamId, match.awayTeamId] },
      },
      select: { playerId: true, leagueTeamId: true },
    }),
  ])
  const lookup = new Map<string, string>()
  for (const a of assignments) {
    // If a player has multiple assignments (rare — joining mid-season,
    // moving teams), keep the first. Future PRs can refine via
    // fromGameWeek/toGameWeek when the score-time matchday is known.
    if (!lookup.has(a.playerId)) lookup.set(a.playerId, a.leagueTeamId)
  }
  const cache = computeScoreFromEvents(
    match.homeTeamId,
    match.awayTeamId,
    events,
    lookup,
  )
  // Audit log for unresolved scorers — surfaces data bugs without
  // silently dropping events from the cache.
  const unresolved = events.filter((e) => {
    const t = lookup.get(e.scorerId)
    return !t || (t !== match.homeTeamId && t !== match.awayTeamId)
  })
  if (unresolved.length > 0) {
    console.warn(
      `[v1.42.0 SCORE-COMPUTE] match=${matchId} unresolved-scorers=${unresolved.length} (event scorers not on either team's roster — admin should review)`,
    )
  }
  await prisma.match.update({
    where: { id: matchId },
    data: { homeScore: cache.home, awayScore: cache.away },
  })
  return cache
}
