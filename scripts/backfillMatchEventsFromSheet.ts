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
 * Resolve a player name against a roster keyed by case-insensitive trimmed
 * exact match first, then by slug. Roster shape: `Map<lowercase-name, playerId>`
 * + `Map<slug, playerId>`. Returns null when neither yields a hit.
 */
export function resolvePlayer(
  rawName: string,
  byLcName: Map<string, string>,
  bySlug: Map<string, string>,
): string | null {
  const trimmed = rawName.trim()
  if (!trimmed) return null
  const lc = trimmed.toLowerCase()
  const direct = byLcName.get(lc)
  if (direct) return direct
  const slug = slugify(trimmed)
  return bySlug.get(slug) ?? null
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

  const scorerId = resolvePlayer(args.scorerName, args.playerByLcName, args.playerBySlug)
  if (!scorerId) {
    return { kind: 'SKIP', reason: `unresolved-scorer: "${args.scorerName}"`, row: args.rowNumber }
  }

  const assisterId = args.assisterName
    ? resolvePlayer(args.assisterName, args.playerByLcName, args.playerBySlug)
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

  // Roster — players assigned to one of this league's teams
  const plas = await prisma.playerLeagueAssignment.findMany({
    where: { leagueTeam: { leagueId } },
    include: { player: true },
  })
  const playerByLcName = new Map<string, string>()
  const playerBySlug = new Map<string, string>()
  for (const pla of plas) {
    if (!pla.player.name) continue
    playerByLcName.set(pla.player.name.trim().toLowerCase(), pla.player.id)
    playerBySlug.set(slugify(pla.player.name), pla.player.id)
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
