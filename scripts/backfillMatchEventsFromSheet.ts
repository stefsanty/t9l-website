/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * v1.42.1 (epic match events PR β) — backfill historical goals from
 * `GoalsRaw!A:F` into the new `MatchEvent` table.
 *
 * Why a new script
 * ----------------
 * `scripts/sheetsToDbBackfill.ts` already exists and writes to the legacy
 * `Goal`/`Assist` tables. PR α added the unified `MatchEvent` log; the
 * legacy tables are read but no longer the canonical event store. PR β
 * shadows the legacy backfill — same source rows, different target table —
 * so MatchEvent is populated for the read-flip in PR δ.
 *
 * GoalsRaw column shape (from `src/lib/data.ts#parseGoals`):
 *   A: matchday label ("MD3") or "#REF!"
 *   B: timestamp (ISO or empty)
 *   C: scoring team name
 *   D: conceding team name
 *   E: scorer name
 *   F: assister name (nullable)
 *
 * Per-row decisions:
 *   - resolve matchday → GameWeek via `League.id` + `weekNumber`
 *   - resolve match → Match via `(gameWeekId, scoringLT, concedingLT)` in
 *     either direction (home/away)
 *   - resolve scorer / assister → Player via league roster (case-insensitive
 *     trimmed match → fallback to slugify match)
 *   - decide goalType: GoalsRaw historically carries no type metadata, so
 *     all rows land as `OPEN_PLAY`. Future iterations of the sheet may
 *     introduce a goalType column; the parser is forward-compatible.
 *
 * After insert, compute the score from events and compare to the existing
 * `Match.homeScore`/`awayScore` cache. If mismatch, log + flag the match
 * for review and DO NOT mutate the cache. The script never overwrites the
 * existing cache during a backfill.
 *
 * Flags:
 *   --dry-run                  Default ON. Print proposed inserts + unresolved.
 *   --apply                    Actually write the events.
 *   --league-slug=<slug>       Default: env IMPORT_LEAGUE_SLUG or 'minato-2025'.
 *   --report=<path>            Where to write the markdown report. Default:
 *                              outputs/match-events-backfill-report.md
 *   --verbose                  Per-row log lines.
 *
 * Run via: npx ts-node --project tsconfig.scripts.json scripts/backfillMatchEventsFromSheet.ts [flags]
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { google } from 'googleapis'
import { PrismaClient, type GoalType } from '@prisma/client'
import { computeScoreFromEvents } from '../src/lib/matchScore'

dotenv.config({ path: path.resolve(process.cwd(), '.env.preview') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.production') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config()

// ── Flag parsing ───────────────────────────────────────────────────────────

interface Flags {
  dryRun: boolean
  apply: boolean
  leagueSlug: string
  reportPath: string
  verbose: boolean
}

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    dryRun: true,
    apply: false,
    leagueSlug: process.env.IMPORT_LEAGUE_SLUG ?? 'minato-2025',
    reportPath: 'outputs/match-events-backfill-report.md',
    verbose: false,
  }
  for (const arg of argv) {
    if (arg === '--apply') {
      flags.apply = true
      flags.dryRun = false
    } else if (arg === '--dry-run') {
      flags.dryRun = true
      flags.apply = false
    } else if (arg === '--verbose') flags.verbose = true
    else if (arg.startsWith('--league-slug=')) flags.leagueSlug = arg.split('=')[1]
    else if (arg.startsWith('--report=')) flags.reportPath = arg.split('=')[1]
  }
  return flags
}

// ── Pure helpers ───────────────────────────────────────────────────────────

/** Mirrors `slugify` in `src/lib/data.ts`. */
export function slugify(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

/**
 * Map a GoalsRaw row (col A "MDx" / col B timestamp) to a 1-indexed week
 * number. Returns null when neither shape resolves.
 */
export function resolveWeekNumber(
  rawMd: string,
  timestamp: string,
  weekDates: Map<number, string | null>,
): number | null {
  const m = rawMd.match(/^MD(\d+)$/i)
  if (m) {
    const wk = parseInt(m[1], 10)
    if (Number.isFinite(wk) && wk > 0) return wk
  }
  // #REF! fallback — match by timestamp date against known week startDates.
  if (timestamp) {
    const dateOnly = timestamp.split('T')[0]
    for (const [wk, d] of weekDates) {
      if (d === dateOnly) return wk
    }
  }
  return null
}

/**
 * Names in `GoalsRaw` that should be mapped to the per-team Guest player when
 * the row's scoring-team context is known. Lowercased + trimmed for the
 * comparison. v1.46.1 introduces this list to absorb:
 *   - "Guest" (existing convention from the legacy Sheets-side loader —
 *     non-rostered scorer).
 *   - "Sergei Borodin" — former player no longer on any roster; goals were
 *     real but the source identity is gone. The user explicitly mapped him
 *     to Guest in PR-feedback-on-the-dry-run.
 *
 * Add new entries here when the dry-run report surfaces other historical
 * names that should land on the per-team Guest. Do NOT use this list for
 * resolvable-but-typoed names — those should be fixed at the source sheet.
 */
export const EXPLICIT_GUEST_NAMES: ReadonlySet<string> = new Set([
  'guest',
  'sergei borodin',
])

/**
 * Lowercased first-name token of a name like "Kosma Knasiecki" → "kosma".
 * Returns null when input has no space (i.e. it's already a single token,
 * or empty after trim).
 */
export function firstNameToken(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const idx = trimmed.indexOf(' ')
  if (idx <= 0) return null
  return trimmed.slice(0, idx).toLowerCase()
}

/**
 * Given a list of players on a specific team, return the unique player whose
 * first-name token matches `firstNameLc` (case-insensitive). Returns null
 * when zero or 2+ players match — the resolver only collapses unambiguous
 * single-token references.
 */
export function findUniqueByFirstName(
  firstNameLc: string,
  teamPlayers: ReadonlyArray<{ id: string; name: string | null }>,
): string | null {
  const matches: string[] = []
  for (const p of teamPlayers) {
    if (!p.name) continue
    const ft = firstNameToken(p.name)
    if (ft === firstNameLc) matches.push(p.id)
  }
  return matches.length === 1 ? matches[0] : null
}

export interface ResolvePlayerContext {
  /** Players on the row's scoring team — used for fuzzy first-name match. */
  teamPlayers?: ReadonlyArray<{ id: string; name: string | null }>
  /** Guest player id on the row's scoring team — used for EXPLICIT_GUEST_NAMES + unresolved-name fallback. */
  guestPlayerId?: string
}

/**
 * Resolve a player name against a roster keyed by case-insensitive trimmed
 * exact match first, then by slug. v1.46.1 adds:
 *
 *   3. **First-name fuzzy match** (when context.teamPlayers supplied) —
 *      single-token names like "Kosma" resolve to the unique team player whose
 *      first name matches. Ambiguity (0 or 2+ matches) falls through.
 *   4. **Explicit Guest names** (when context.guestPlayerId supplied) —
 *      EXPLICIT_GUEST_NAMES (e.g. "Guest", "Sergei Borodin") map to the
 *      team's Guest player.
 *
 * Returns null when none of the four steps yield a hit.
 */
export function resolvePlayer(
  rawName: string,
  byLcName: Map<string, string>,
  bySlug: Map<string, string>,
  context?: ResolvePlayerContext,
): string | null {
  const trimmed = rawName.trim()
  if (!trimmed) return null
  const lc = trimmed.toLowerCase()
  const direct = byLcName.get(lc)
  if (direct) return direct
  const slug = slugify(trimmed)
  const slugHit = bySlug.get(slug)
  if (slugHit) return slugHit
  // 3. Fuzzy first-name match within team context. Only when input is a
  //    single token AND we know which team to look in.
  if (context?.teamPlayers && trimmed.indexOf(' ') === -1) {
    const fuzzy = findUniqueByFirstName(lc, context.teamPlayers)
    if (fuzzy) return fuzzy
  }
  // 4. Explicit Guest mapping. Single league-wide list of names that resolve
  //    to the team's Guest player. Requires team context.
  if (context?.guestPlayerId && EXPLICIT_GUEST_NAMES.has(lc)) {
    return context.guestPlayerId
  }
  return null
}

export type RowDecision =
  | { kind: 'INSERT'; matchId: string; scorerId: string; assisterId: string | null; goalType: GoalType }
  | { kind: 'SKIP'; reason: string; row: number }

/**
 * Pure: inspect a parsed GoalsRaw row + resolution context, return the
 * decision. INSERT carries the resolved IDs; SKIP carries the reason for
 * the report.
 */
export function decideRowAction(args: {
  rowNumber: number
  rawMd: string
  timestamp: string
  scoringTeamName: string
  concedingTeamName: string
  scorerName: string
  assisterName: string | null
  weekDates: Map<number, string | null>
  matchByKey: Map<string, string>
  teamByName: Map<string, string>
  playerByLcName: Map<string, string>
  playerBySlug: Map<string, string>
  /**
   * v1.46.1 — players on each LeagueTeam, keyed by leagueTeamId. Enables
   * the fuzzy first-name match in `resolvePlayer`. Optional for backwards
   * compat with the existing test fixtures that don't supply it.
   */
  playersByLeagueTeam?: Map<string, ReadonlyArray<{ id: string; name: string | null }>>
  /**
   * v1.46.1 — Guest player id per LeagueTeam. Enables the EXPLICIT_GUEST_NAMES
   * mapping in `resolvePlayer`. Populated by `ensureGuestPlayers` at script
   * startup; optional for tests that don't need the Guest behavior.
   */
  guestPlayerByLeagueTeam?: Map<string, string>
}): RowDecision {
  const wk = resolveWeekNumber(args.rawMd, args.timestamp, args.weekDates)
  if (wk === null) {
    return { kind: 'SKIP', reason: `unresolved-matchday: rawMd="${args.rawMd}" ts="${args.timestamp}"`, row: args.rowNumber }
  }

  const scoringLT = args.teamByName.get(args.scoringTeamName.trim().toLowerCase())
  const concedingLT = args.teamByName.get(args.concedingTeamName.trim().toLowerCase())
  if (!scoringLT) {
    return { kind: 'SKIP', reason: `unresolved-scoring-team: "${args.scoringTeamName}"`, row: args.rowNumber }
  }
  if (!concedingLT) {
    return { kind: 'SKIP', reason: `unresolved-conceding-team: "${args.concedingTeamName}"`, row: args.rowNumber }
  }

  // Try both team orderings — Match has a unique (gameWeekId, homeTeamId, awayTeamId).
  const keyA = `${wk}|${scoringLT}|${concedingLT}`
  const keyB = `${wk}|${concedingLT}|${scoringLT}`
  const matchId = args.matchByKey.get(keyA) ?? args.matchByKey.get(keyB)
  if (!matchId) {
    return {
      kind: 'SKIP',
      reason: `unresolved-match: wk${wk} ${args.scoringTeamName} vs ${args.concedingTeamName}`,
      row: args.rowNumber,
    }
  }

  // v1.46.1 — team context drives the fuzzy first-name match + Guest fallback.
  // Both scorer and assister belong to the SCORING team in the legacy GoalsRaw
  // shape (the source has no goalType column, so OWN_GOAL doesn't appear in
  // the historical data; everything imports as OPEN_PLAY where scorer.team
  // === scoring-team).
  const teamPlayers = args.playersByLeagueTeam?.get(scoringLT)
  const guestPlayerId = args.guestPlayerByLeagueTeam?.get(scoringLT)
  const resolveCtx = { teamPlayers, guestPlayerId }

  const scorerId = resolvePlayer(
    args.scorerName,
    args.playerByLcName,
    args.playerBySlug,
    resolveCtx,
  )
  if (!scorerId) {
    return { kind: 'SKIP', reason: `unresolved-scorer: "${args.scorerName}"`, row: args.rowNumber }
  }

  const assisterId = args.assisterName
    ? resolvePlayer(args.assisterName, args.playerByLcName, args.playerBySlug, resolveCtx)
    : null
  // Note: we do NOT skip when assister text is non-empty but unresolved — assister
  // is nullable. Surface in the report instead and insert with null.
  const assisterUnresolvedNote =
    args.assisterName && !assisterId
      ? ` (assister "${args.assisterName}" unresolved → null)`
      : ''

  return {
    kind: 'INSERT',
    matchId,
    scorerId,
    assisterId: assisterId ?? null,
    // GoalsRaw historically carries no type metadata. v1 lands everything
    // as OPEN_PLAY. Future iterations of the sheet schema can extend the
    // parser to read a 7th column and pass the right enum here; the report
    // surfaces the assumption so operators aren't surprised.
    goalType: 'OPEN_PLAY' as GoalType,
    ...(assisterUnresolvedNote ? { _assisterNote: assisterUnresolvedNote } : {}),
  } as RowDecision
}

// ── Sheets fetch ───────────────────────────────────────────────────────────

async function fetchGoalsRaw(): Promise<string[][]> {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? process.env.GOOGLE_SHEETS_ID ?? ''
  const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? ''
  const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY ?? '')
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n')
  if (!SHEET_ID || !SERVICE_EMAIL || !PRIVATE_KEY) {
    throw new Error('Missing GOOGLE_* env vars; cannot fetch GoalsRaw')
  }
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'GoalsRaw!A:F',
  })
  return (data.values as string[][]) ?? []
}

// ── Guest seeder ───────────────────────────────────────────────────────────

/**
 * v1.46.1 — derive the deterministic Player.id for the per-team Guest player.
 * Mirrors the existing single-Guest convention (`p-guest`, `lib/ids.ts`) but
 * scopes it per LeagueTeam so the score-derivation lookup
 * (`playerToLt: Map<playerId, leagueTeamId>` in `dbToPublicLeagueData`) maps
 * each Guest to exactly one team.
 *
 * The single legacy `p-guest` Player record (with no PlayerLeagueAssignment)
 * predates this and is left untouched. It's harmless — the public read path
 * iterates PLA rows so an unassigned Player never surfaces.
 */
export function guestPlayerIdFor(leagueTeamId: string): string {
  return `p-guest-${leagueTeamId}`
}

interface GuestSeedSummary {
  /** Map from leagueTeamId → guest player id, for every team in the league. */
  guestByLeagueTeam: Map<string, string>
  /** Number of NEW Player rows created (already-existing rows are no-ops). */
  playersCreated: number
  /** Number of NEW PlayerLeagueAssignment rows created. */
  assignmentsCreated: number
}

/**
 * Idempotently ensure a Guest Player exists on every LeagueTeam in the league,
 * with a current `PlayerLeagueAssignment`. Re-running is safe — already-present
 * rows are detected and skipped.
 *
 * Why per-team and not one global Guest with multiple assignments: the public
 * read path's `playerToLt` map (`dbToPublicLeagueData.ts` line 215) is a
 * `Map<playerId, leagueTeamId>` that overwrites on duplicate keys. A single
 * global Guest with N team assignments would collapse to one entry, breaking
 * the scorer→team lookup that drives the scoreline derivation. Per-team
 * Guests are 4 distinct Player rows; the lookup stays correct.
 *
 * Visibility on the public site: Guests appear in the public roster like any
 * other Player (the existing `GUEST_ID === 'p-guest'` filter in
 * `dbToPublicLeagueData` is an exact-equals check that does NOT match the
 * new `p-guest-<lt-id>` ids). The user explicitly accepted this in the
 * dry-run feedback — "(or hidden if you decide Guest should be invisible
 * from public roster — flag if you make that call)" — so this is flagged
 * here in the report's seeder section. Future PR can hide them by changing
 * the filter to a prefix check; that's a `src/` change deferred out of this
 * scripts-only PR.
 */
export async function ensureGuestPlayers(
  prisma: PrismaClient,
  leagueTeams: ReadonlyArray<{ id: string; team: { name: string } }>,
): Promise<GuestSeedSummary> {
  const out: GuestSeedSummary = {
    guestByLeagueTeam: new Map(),
    playersCreated: 0,
    assignmentsCreated: 0,
  }
  for (const lt of leagueTeams) {
    const guestId = guestPlayerIdFor(lt.id)
    out.guestByLeagueTeam.set(lt.id, guestId)
    const existingPlayer = await prisma.player.findUnique({ where: { id: guestId } })
    if (!existingPlayer) {
      await prisma.player.create({
        data: { id: guestId, name: 'Guest' },
      })
      out.playersCreated++
    }
    const existingPla = await prisma.playerLeagueAssignment.findFirst({
      where: { playerId: guestId, leagueTeamId: lt.id },
    })
    if (!existingPla) {
      await prisma.playerLeagueAssignment.create({
        data: {
          playerId: guestId,
          leagueTeamId: lt.id,
          fromGameWeek: 1,
          // Onboarding doesn't apply to Guests (no user, no flow). Mark
          // COMPLETED so the v1.34.0 redemption gate never blocks anything.
          onboardingStatus: 'COMPLETED',
          // joinSource left null — there is no human "join event" to attribute.
        },
      })
      out.assignmentsCreated++
    }
  }
  return out
}

// ── Apply ──────────────────────────────────────────────────────────────────

interface RunReport {
  scanned: number
  insertsPlanned: number
  inserted: number
  skips: { reason: string; row: number }[]
  matchesAffected: Set<string>
  scoreMismatches: Array<{
    matchId: string
    cacheHome: number
    cacheAway: number
    eventsHome: number
    eventsAway: number
  }>
  assumptions: string[]
  noteOnAssister: string[]
  /** v1.46.1 — Guest seeding outcomes for the report. */
  guestSeed?: GuestSeedSummary
}

async function runBackfill(prisma: PrismaClient, flags: Flags): Promise<RunReport> {
  const report: RunReport = {
    scanned: 0,
    insertsPlanned: 0,
    inserted: 0,
    skips: [],
    matchesAffected: new Set(),
    scoreMismatches: [],
    assumptions: [
      'GoalsRaw historically carries no goalType metadata; all imported events land as OPEN_PLAY. Admins can edit individual events post-import via the new admin events CRUD (PR γ).',
      'Match.minute is left null on every imported row — the source sheet does not encode the event clock minute.',
      'createdById is null on imported rows (no User authored the historical event).',
    ],
    noteOnAssister: [],
  }

  const leagueId = `l-${flags.leagueSlug}`
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) {
    throw new Error(`League ${leagueId} not found — run sheetsToDbBackfill first`)
  }

  // Build resolution caches
  const gameWeeks = await prisma.gameWeek.findMany({
    where: { leagueId },
    select: { id: true, weekNumber: true, startDate: true },
  })
  const gwIdByWeek = new Map<number, string>()
  const weekDates = new Map<number, string | null>()
  for (const gw of gameWeeks) {
    gwIdByWeek.set(gw.weekNumber, gw.id)
    if (gw.startDate) {
      const iso = gw.startDate.toISOString().slice(0, 10)
      weekDates.set(gw.weekNumber, iso)
    } else {
      weekDates.set(gw.weekNumber, null)
    }
  }

  const leagueTeams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    include: { team: true },
  })
  const teamByName = new Map<string, string>()
  for (const lt of leagueTeams) {
    teamByName.set(lt.team.name.trim().toLowerCase(), lt.id)
    // Also map the legacy color-prefixed team names that occasionally
    // appear in GoalsRaw (e.g. "Blue Mariners FC"). The active sheet uses
    // normalised names but historical rows may not.
    if (lt.team.name === 'Mariners FC') teamByName.set('blue mariners fc', lt.id)
    if (lt.team.name === 'Fenix FC') teamByName.set('yellow fenix fc', lt.id)
  }

  const matches = await prisma.match.findMany({
    where: { leagueId },
    include: { gameWeek: { select: { weekNumber: true } } },
  })
  const matchByKey = new Map<string, string>()
  const matchById = new Map<string, typeof matches[number]>()
  for (const m of matches) {
    matchByKey.set(`${m.gameWeek.weekNumber}|${m.homeTeamId}|${m.awayTeamId}`, m.id)
    matchById.set(m.id, m)
  }

  // v1.46.1 — Guest seeder runs BEFORE the roster fetch so the per-team
  // Guest players appear in the same `playerByLcName` / `playersByLeagueTeam`
  // maps as regular roster members. Idempotent; no-op when already seeded.
  // Runs in both dry-run and apply modes — dry-run is the simulation source
  // of truth, so the seeded guests must be queryable for the resolver to
  // exercise the Guest-fallback branch in the planning pass too. The guest
  // creates are tiny writes (≤4 Player + ≤4 PLA per league) and idempotent
  // on re-run, so writing during dry-run is acceptable.
  const guestSeed = await ensureGuestPlayers(prisma, leagueTeams)
  report.guestSeed = guestSeed

  // Roster — players assigned to one of this league's teams
  const plas = await prisma.playerLeagueAssignment.findMany({
    where: { leagueTeam: { leagueId } },
    include: { player: true },
  })
  const playerByLcName = new Map<string, string>()
  const playerBySlug = new Map<string, string>()
  // v1.46.1 — per-team rosters drive the fuzzy first-name match in
  // `resolvePlayer`. Built from the same PLA fetch, no extra round-trip.
  const playersByLeagueTeam = new Map<string, Array<{ id: string; name: string | null }>>()
  // v1.46.1 — Guest player ids (one per team) all share `name = "Guest"`,
  // so they would collapse in `playerByLcName` / `playerBySlug` to a single
  // last-write-wins entry. Worse: that entry would shadow the contextual
  // Guest fallback in `resolvePlayer` because the by-name match returns
  // BEFORE the EXPLICIT_GUEST_NAMES branch — the resolver would credit
  // every "Guest" goal to whichever team's guest happened to be processed
  // last. Skip guests here; they're reachable only via the contextual
  // `guestPlayerByLeagueTeam` fallback, which routes by scoring team.
  const guestPlayerIds = new Set(guestSeed.guestByLeagueTeam.values())
  for (const pla of plas) {
    if (!pla.player.name) continue
    if (!guestPlayerIds.has(pla.player.id)) {
      playerByLcName.set(pla.player.name.trim().toLowerCase(), pla.player.id)
      playerBySlug.set(slugify(pla.player.name), pla.player.id)
    }
    const list = playersByLeagueTeam.get(pla.leagueTeamId) ?? []
    list.push({ id: pla.player.id, name: pla.player.name })
    playersByLeagueTeam.set(pla.leagueTeamId, list)
  }

  // Read GoalsRaw — skip header row.
  const rows = await fetchGoalsRaw()
  const decisions: RowDecision[] = []
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const rawMd = (row[0] ?? '').trim()
    const timestamp = (row[1] ?? '').trim()
    const scoringTeam = (row[2] ?? '').trim()
    const concedingTeam = (row[3] ?? '').trim()
    const scorer = (row[4] ?? '').trim()
    const assister = (row[5] ?? '').trim() || null
    if (!scorer && !scoringTeam) continue // blank row
    report.scanned++

    const decision = decideRowAction({
      rowNumber: i + 1, // 1-indexed for human reading
      rawMd,
      timestamp,
      scoringTeamName: scoringTeam,
      concedingTeamName: concedingTeam,
      scorerName: scorer,
      assisterName: assister,
      weekDates,
      matchByKey,
      teamByName,
      playerByLcName,
      playerBySlug,
      playersByLeagueTeam,
      guestPlayerByLeagueTeam: guestSeed.guestByLeagueTeam,
    })
    decisions.push(decision)
    if (decision.kind === 'INSERT') {
      report.insertsPlanned++
      report.matchesAffected.add(decision.matchId)
      const note = (decision as RowDecision & { _assisterNote?: string })._assisterNote
      if (note) report.noteOnAssister.push(`row ${i + 1}: ${note}`)
    } else {
      report.skips.push({ reason: decision.reason, row: decision.row })
    }
  }

  // Apply
  if (flags.apply) {
    for (const d of decisions) {
      if (d.kind !== 'INSERT') continue
      await prisma.matchEvent.create({
        data: {
          matchId: d.matchId,
          kind: 'GOAL',
          goalType: d.goalType,
          scorerId: d.scorerId,
          assisterId: d.assisterId,
          minute: null,
          createdById: null,
        },
      })
      report.inserted++
    }
  }

  // Score-vs-cache check (always run — both in dry-run and apply).
  // For dry-run we predict the post-apply state by simulating against
  // existing events + new decisions. For apply we read the actual state.
  for (const matchId of report.matchesAffected) {
    const match = matchById.get(matchId)
    if (!match) continue
    let homeFromEvents: number
    let awayFromEvents: number
    if (flags.apply) {
      const events = await prisma.matchEvent.findMany({
        where: { matchId, kind: 'GOAL' },
        select: { scorerId: true, goalType: true },
      })
      const lookup = new Map<string, string>()
      for (const pla of plas) lookup.set(pla.player.id, pla.leagueTeamId)
      const cache = computeScoreFromEvents(match.homeTeamId, match.awayTeamId, events, lookup)
      homeFromEvents = cache.home
      awayFromEvents = cache.away
    } else {
      // Dry-run prediction: simulate inserts.
      const simulated = decisions
        .filter((d): d is Extract<RowDecision, { kind: 'INSERT' }> =>
          d.kind === 'INSERT' && d.matchId === matchId,
        )
        .map((d) => ({ scorerId: d.scorerId, goalType: d.goalType }))
      const lookup = new Map<string, string>()
      for (const pla of plas) lookup.set(pla.player.id, pla.leagueTeamId)
      const cache = computeScoreFromEvents(match.homeTeamId, match.awayTeamId, simulated, lookup)
      homeFromEvents = cache.home
      awayFromEvents = cache.away
    }
    if (homeFromEvents !== match.homeScore || awayFromEvents !== match.awayScore) {
      report.scoreMismatches.push({
        matchId,
        cacheHome: match.homeScore,
        cacheAway: match.awayScore,
        eventsHome: homeFromEvents,
        eventsAway: awayFromEvents,
      })
    }
  }

  return report
}

// ── Report writer ──────────────────────────────────────────────────────────

function renderReport(flags: Flags, report: RunReport): string {
  const out: string[] = []
  out.push(`# Match events backfill report`)
  out.push('')
  out.push(`Mode: \`${flags.apply ? '--apply' : '--dry-run'}\``)
  out.push(`League: \`${flags.leagueSlug}\``)
  out.push(`Generated: ${new Date().toISOString()}`)
  out.push('')
  out.push('## Counts')
  out.push('')
  out.push(`- Scanned rows: ${report.scanned}`)
  out.push(`- Inserts planned: ${report.insertsPlanned}`)
  if (flags.apply) out.push(`- Inserts applied: ${report.inserted}`)
  out.push(`- Skipped: ${report.skips.length}`)
  out.push(`- Matches affected: ${report.matchesAffected.size}`)
  out.push(`- Score mismatches (cache vs events-derived): ${report.scoreMismatches.length}`)
  out.push('')
  if (report.assumptions.length) {
    out.push('## Assumptions encoded')
    out.push('')
    for (const a of report.assumptions) out.push(`- ${a}`)
    out.push('')
  }
  if (report.guestSeed) {
    out.push('## Guest player seeding (v1.46.1)')
    out.push('')
    out.push(`- Players created: ${report.guestSeed.playersCreated} (idempotent — re-runs are no-ops)`)
    out.push(`- Assignments created: ${report.guestSeed.assignmentsCreated}`)
    out.push(`- Per-team Guest map: ${report.guestSeed.guestByLeagueTeam.size} teams`)
    out.push('')
    out.push('Each Guest is a regular Player record on a single LeagueTeam, named "Guest". They appear in the public roster (the legacy `GUEST_ID === \'p-guest\'` exact-equals filter does NOT match the new `p-guest-<lt-id>` ids). Hide them via a prefix-check filter in `dbToPublicLeagueData` if desired (deferred — out of this scripts-only PR).')
    out.push('')
  }
  if (report.skips.length) {
    out.push('## Unresolved rows (skipped — fix in source sheet or manual cleanup)')
    out.push('')
    for (const s of report.skips) out.push(`- row ${s.row}: ${s.reason}`)
    out.push('')
  }
  if (report.noteOnAssister.length) {
    out.push('## Assister notes (inserted with null assister)')
    out.push('')
    for (const n of report.noteOnAssister) out.push(`- ${n}`)
    out.push('')
  }
  if (report.scoreMismatches.length) {
    out.push('## Score mismatches')
    out.push('')
    out.push('Per-match comparison of the existing `Match.homeScore`/`awayScore` cache against the score implied by inserted MatchEvent rows. **Cache was NOT mutated** — surfaced for review.')
    out.push('')
    for (const m of report.scoreMismatches) {
      out.push(
        `- match \`${m.matchId}\`: cache \`${m.cacheHome}-${m.cacheAway}\` vs events \`${m.eventsHome}-${m.eventsAway}\``,
      )
    }
    out.push('')
  }
  return out.join('\n')
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  const prisma = new PrismaClient()
  try {
    if (flags.apply) {
      console.log('[v1.42.1] Applying MatchEvent inserts to', flags.leagueSlug)
    } else {
      console.log('[v1.42.1] DRY-RUN against', flags.leagueSlug, '(use --apply to write)')
    }
    const report = await runBackfill(prisma, flags)
    const md = renderReport(flags, report)
    fs.mkdirSync(path.dirname(flags.reportPath), { recursive: true })
    fs.writeFileSync(flags.reportPath, md)
    console.log(`Report written to ${flags.reportPath}`)
    console.log(`Scanned: ${report.scanned}, Insert${flags.apply ? 'ed' : 's planned'}: ${flags.apply ? report.inserted : report.insertsPlanned}, Skipped: ${report.skips.length}, Mismatches: ${report.scoreMismatches.length}`)
    if (report.skips.length && flags.verbose) {
      for (const s of report.skips) console.log(`  SKIP row ${s.row}: ${s.reason}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
