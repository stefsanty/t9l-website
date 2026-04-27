/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sheets → DB backfill (PR 2 of the migration).
 *
 * Reads the live Google Sheet via `fetchSheetData()`, runs through the existing
 * `parseAllData()` pipeline, then upserts everything into Postgres with stable
 * deterministic IDs (so re-runs are idempotent).
 *
 * Default mode is conservative — destructive flags must be passed explicitly.
 * The plan's reviewer (C3, S7) flagged that the original "clear-and-recreate
 * goals" default was a foot-gun that would silently wipe admin goal edits.
 *
 * Flags:
 *   --dry-run                 Wrap everything in a transaction that rolls back at end.
 *   --no-overwrite-goals      Default ON. Skip writing Goals if any already exist for the league.
 *   --allow-overwrite-goals   Opposite of above; required to recreate goals.
 *   --availability-merge      Skip availability rows whose DB updatedAt is newer than now-mtime.
 *   --no-availability         Skip availability writes entirely.
 *   --verbose-diff            Print per-row would-update diffs.
 *   --league-slug=<slug>      Override LEAGUE_SLUG (default: env IMPORT_LEAGUE_SLUG or 'minato-2025').
 *
 * Run via: npx ts-node --project tsconfig.scripts.json scripts/sheetsToDbBackfill.ts [flags]
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { google } from 'googleapis'
import { PrismaClient, type Prisma } from '@prisma/client'
import type { LeagueData } from '../src/types'

// Load env BEFORE importing modules that read env at top-level.
// .env.preview wins (per-PR Neon branch testing); falls back to .env.production
// (live prod backfill); .env.local last (developer override).
// dotenv defaults to first-write-wins, so order matters.
dotenv.config({ path: path.resolve(process.cwd(), '.env.preview') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.production') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
dotenv.config()

// ── Flag parsing ───────────────────────────────────────────────────────────

interface Flags {
  dryRun: boolean
  noOverwriteGoals: boolean
  allowOverwriteGoals: boolean
  availabilityMerge: boolean
  noAvailability: boolean
  verboseDiff: boolean
  leagueSlug: string
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    dryRun: false,
    noOverwriteGoals: true, // default ON per C3
    allowOverwriteGoals: false,
    availabilityMerge: false,
    noAvailability: false,
    verboseDiff: false,
    leagueSlug: process.env.IMPORT_LEAGUE_SLUG ?? 'minato-2025',
  }
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true
    else if (arg === '--no-overwrite-goals') flags.noOverwriteGoals = true
    else if (arg === '--allow-overwrite-goals') {
      flags.allowOverwriteGoals = true
      flags.noOverwriteGoals = false
    } else if (arg === '--availability-merge') flags.availabilityMerge = true
    else if (arg === '--no-availability') flags.noAvailability = true
    else if (arg === '--verbose-diff') flags.verboseDiff = true
    else if (arg.startsWith('--league-slug=')) flags.leagueSlug = arg.split('=')[1]
  }
  return flags
}

// ── Stable ID conventions (mirroring importFromSheets.ts) ──────────────────

export const ids = {
  league: (slug: string) => `l-${slug}`,
  team: (nameSlug: string) => `t-${nameSlug}`,
  leagueTeam: (leagueSlug: string, nameSlug: string) => `lt-${leagueSlug}-${nameSlug}`,
  gameWeek: (leagueSlug: string, wk: number) => `gw-${leagueSlug}-${wk}`,
  player: (nameSlug: string) => `p-${nameSlug}`,
  pla: (playerId: string, ltId: string) => `pla-${playerId}-${ltId}`,
  match: (leagueSlug: string, wk: number, homeSlug: string, awaySlug: string) =>
    `m-${leagueSlug}-wk${wk}-${homeSlug}-vs-${awaySlug}`,
  // Deterministic Goal id: (matchId, scoringTeam slug, scorer slug, slot)
  // Slot = 0-indexed occurrence of (match, scorer, scoringTeam) — handles
  // the same player scoring multiple times in one match.
  goal: (matchId: string, scoringSlug: string, scorerSlug: string, slot: number) =>
    `g-${matchId}-${scoringSlug}-${scorerSlug}-${slot}`,
  assist: (goalId: string) => `a-${goalId}`,
  availability: (playerId: string, gwId: string) => `av-${playerId}-${gwId}`,
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Mirrors `slugify` in `src/lib/data.ts` exactly. The DB→public adapter strips
 * the "p-"/"t-" prefix off DB ids and expects the remaining slug to match what
 * the public Sheets path produces; if these two diverge (e.g. on apostrophes:
 * lib/data → "obrien", legacy backfill → "o-brien"), consumer code keyed by
 * `player.id` mismatches between source modes.
 */
export function slugify(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
}

const TEAM_BRAND: Record<string, { shortName: string; color: string; logoUrl: string }> = {
  'mariners-fc': { shortName: 'MRN', color: '#0055A4', logoUrl: '/team_logos/Mariners FC.png' },
  'fenix-fc':    { shortName: 'FEN', color: '#FFD700', logoUrl: '/team_logos/Fenix FC.png' },
  'hygge-sc':    { shortName: 'HSC', color: '#DC143C', logoUrl: '/team_logos/Hygge SC.png' },
  'fc-torpedo':  { shortName: 'TOR', color: '#cccccc', logoUrl: '/team_logos/FC Torpedo.png' },
}

/** Combine a YYYY-MM-DD JST date with HH:MM time → JST Date. */
export function combineJstDateTime(date: string | null, time: string | null): Date | null {
  if (!date) return null
  const t = time && /^\d{1,2}:\d{2}$/.test(time) ? time : '00:00'
  const padded = t.length === 4 ? `0${t}` : t
  // Construct an explicit JST timestamp and let Date parse it.
  const iso = `${date}T${padded}:00+09:00`
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

const TBD_DATE = new Date('2099-01-01T00:00:00+09:00')

// ── Sheets fetch (inlined from importFromSheets — keeps script self-contained) ──

interface RawSheetData {
  teams: string[][]
  roster: string[][]
  schedule: string[][]
  goals: string[][]
  ratings: string[][]
  scheduleFormula: string[][]
  mdSchedule: string[][]
}

async function fetchSheetData(): Promise<RawSheetData> {
  const SHEET_ID = process.env.GOOGLE_SHEET_ID ?? process.env.GOOGLE_SHEETS_ID ?? ''
  const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? ''
  // `vercel env pull` wraps PEM values in extra "..." which dotenv leaves as
  // a leading/trailing literal " character — strip those before normalizing
  // \n escapes to actual newlines.
  const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY ?? '')
    .replace(/^["']|["']$/g, '')
    .replace(/\\n/g, '\n')
  if (!SHEET_ID) throw new Error('Missing GOOGLE_SHEET_ID')
  if (!SERVICE_EMAIL) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL')
  if (!PRIVATE_KEY) throw new Error('Missing GOOGLE_PRIVATE_KEY')

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  const sheets = google.sheets({ version: 'v4', auth })
  const { data } = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges: [
      'TeamRaw!A:B',
      'RosterRaw!A:L',
      'ScheduleRaw!A:F',
      'GoalsRaw!A:F',
      'RatingsRaw!A:BH',
      'Schedule Formula!A:E',
      'MDScheduleRaw!A:E',
    ],
  })
  const rows = (data.valueRanges ?? []).map((vr) => (vr.values as string[][]) ?? [])
  return {
    teams: rows[0] ?? [],
    roster: rows[1] ?? [],
    schedule: rows[2] ?? [],
    goals: rows[3] ?? [],
    ratings: rows[4] ?? [],
    scheduleFormula: rows[5] ?? [],
    mdSchedule: rows[6] ?? [],
  }
}

// ── Backfill core ──────────────────────────────────────────────────────────

interface Counts {
  teams: number
  leagueTeams: number
  players: number
  plas: number
  gameWeeks: number
  matches: number
  goals: number
  goalsSkipped: number
  assists: number
  availability: number
  availabilitySkipped: number
}

async function runBackfill(prisma: PrismaClient, parsed: LeagueData, flags: Flags): Promise<Counts> {
  const counts: Counts = {
    teams: 0,
    leagueTeams: 0,
    players: 0,
    plas: 0,
    gameWeeks: 0,
    matches: 0,
    goals: 0,
    goalsSkipped: 0,
    assists: 0,
    availability: 0,
    availabilitySkipped: 0,
  }

  const LEAGUE_SLUG = flags.leagueSlug
  const LEAGUE_ID = ids.league(LEAGUE_SLUG)

  // 1. League — upsert with isDefault=true so the public adapter selects it
  await prisma.league.upsert({
    where: { id: LEAGUE_ID },
    create: {
      id: LEAGUE_ID,
      name: 'T9L 2026 Spring',
      location: 'Tokyo, Japan',
      startDate: new Date('2026-01-01T00:00:00+09:00'),
      isDefault: true,
    },
    update: {}, // don't disturb name/location/dates if admin edited
  })

  // Guest player — catch-all
  await prisma.player.upsert({
    where: { id: 'p-guest' },
    create: { id: 'p-guest', name: 'Guest' },
    update: {},
  })

  // 2. Teams + LeagueTeams
  // Slug-keyed team map (Sheets-side ids are slugs like 'mariners-fc')
  const ltIdBySlug = new Map<string, string>()
  for (const t of parsed.teams) {
    const tId = ids.team(t.id)
    const ltId = ids.leagueTeam(LEAGUE_SLUG, t.id)
    const brand = TEAM_BRAND[t.id]
    await prisma.team.upsert({
      where: { id: tId },
      create: {
        id: tId,
        name: t.name,
        shortName: t.shortName ?? brand?.shortName ?? null,
        color: t.color ?? brand?.color ?? null,
        logoUrl: t.logo ?? brand?.logoUrl ?? null,
      },
      update: {
        name: t.name,
        shortName: t.shortName ?? brand?.shortName ?? null,
        color: t.color ?? brand?.color ?? null,
        logoUrl: t.logo ?? brand?.logoUrl ?? null,
      },
    })
    counts.teams++
    await prisma.leagueTeam.upsert({
      where: { leagueId_teamId: { leagueId: LEAGUE_ID, teamId: tId } },
      create: { id: ltId, leagueId: LEAGUE_ID, teamId: tId },
      update: {},
    })
    ltIdBySlug.set(t.id, ltId)
    counts.leagueTeams++
  }

  // 3. Players + PlayerLeagueAssignments
  const playerIdBySlug = new Map<string, string>()
  for (const p of parsed.players) {
    const pId = ids.player(p.id)
    await prisma.player.upsert({
      where: { id: pId },
      create: {
        id: pId,
        name: p.name,
        position: p.position ?? null,
        pictureUrl: p.picture ?? null,
      },
      update: {
        name: p.name,
        position: p.position ?? null,
        pictureUrl: p.picture ?? null,
      },
    })
    counts.players++
    playerIdBySlug.set(p.id, pId)

    const ltId = ltIdBySlug.get(p.teamId)
    if (!ltId) continue
    const plaId = ids.pla(pId, ltId)
    await prisma.playerLeagueAssignment.upsert({
      where: { id: plaId },
      create: { id: plaId, playerId: pId, leagueTeamId: ltId, fromGameWeek: 1 },
      update: {}, // don't disturb admin transfers
    })
    counts.plas++
  }

  // 4. GameWeeks (with venue meta from MDScheduleRaw, captured in parsed.matchdays)
  const gwIdByMdId = new Map<string, string>()
  for (const md of parsed.matchdays) {
    const wk = parseInt(md.id.replace('md', ''), 10)
    if (!Number.isFinite(wk)) continue
    const gwId = ids.gameWeek(LEAGUE_SLUG, wk)
    const startDate =
      combineJstDateTime(md.date, md.matches[0]?.kickoff ?? null) ?? TBD_DATE
    const endDate =
      combineJstDateTime(md.date, md.matches[md.matches.length - 1]?.fullTime ?? null) ?? startDate

    // Venue: upsert by name if present
    let venueId: string | null = null
    if (md.venueName) {
      const venue = await prisma.venue.upsert({
        where: { name: md.venueName },
        create: {
          name: md.venueName,
          url: md.venueUrl ?? null,
          courtSize: md.venueCourtSize ?? null,
        },
        update: {
          url: md.venueUrl ?? null,
          courtSize: md.venueCourtSize ?? null,
        },
      })
      venueId = venue.id
    }

    await prisma.gameWeek.upsert({
      where: { leagueId_weekNumber: { leagueId: LEAGUE_ID, weekNumber: wk } },
      create: {
        id: gwId,
        leagueId: LEAGUE_ID,
        weekNumber: wk,
        startDate,
        endDate,
        venueId,
      },
      update: { startDate, endDate, venueId },
    })
    gwIdByMdId.set(md.id, gwId)
    counts.gameWeeks++
  }

  // 5. Matches (natural-key upsert on @@unique([gameWeekId, homeTeamId, awayTeamId]))
  // Per PR 1's schema: Match has @@unique([gameWeekId, homeTeamId, awayTeamId])
  const matchIdByPublicId = new Map<string, string>() // mdN-mK → DB Match.id
  for (const md of parsed.matchdays) {
    const wk = parseInt(md.id.replace('md', ''), 10)
    const gwId = gwIdByMdId.get(md.id)
    if (!gwId) continue
    for (const m of md.matches) {
      const homeLtId = ltIdBySlug.get(m.homeTeamId)
      const awayLtId = ltIdBySlug.get(m.awayTeamId)
      if (!homeLtId || !awayLtId) continue
      const stableId = ids.match(LEAGUE_SLUG, wk, m.homeTeamId, m.awayTeamId)
      const playedAt = combineJstDateTime(md.date, m.kickoff) ?? TBD_DATE
      const endedAt = combineJstDateTime(md.date, m.fullTime)
      const isCompleted = m.homeGoals !== null && m.awayGoals !== null
      const upserted = await prisma.match.upsert({
        where: {
          gameWeekId_homeTeamId_awayTeamId: {
            gameWeekId: gwId,
            homeTeamId: homeLtId,
            awayTeamId: awayLtId,
          },
        },
        create: {
          id: stableId,
          leagueId: LEAGUE_ID,
          gameWeekId: gwId,
          homeTeamId: homeLtId,
          awayTeamId: awayLtId,
          playedAt,
          endedAt,
          homeScore: m.homeGoals ?? 0,
          awayScore: m.awayGoals ?? 0,
          status: isCompleted ? 'COMPLETED' : 'SCHEDULED',
        },
        update: {
          // playedAt/endedAt may be more accurate from Sheets than from the
          // initial seed (which lacked kickoff times); update them here.
          playedAt,
          endedAt,
          homeScore: m.homeGoals ?? 0,
          awayScore: m.awayGoals ?? 0,
          status: isCompleted ? 'COMPLETED' : 'SCHEDULED',
        },
      })
      matchIdByPublicId.set(m.id, upserted.id)
      counts.matches++
    }
  }

  // 6. Goals + Assists
  // Default --no-overwrite-goals: skip if any goal exists for any match in this league.
  // --allow-overwrite-goals: clear existing goals/assists per match, then recreate.
  if (flags.allowOverwriteGoals) {
    if (flags.verboseDiff) console.log('  (--allow-overwrite-goals: clearing existing goals)')
    await prisma.assist.deleteMany({ where: { match: { leagueId: LEAGUE_ID } } })
    await prisma.goal.deleteMany({ where: { match: { leagueId: LEAGUE_ID } } })
  }

  const skipGoals =
    flags.noOverwriteGoals &&
    (await prisma.goal.count({ where: { match: { leagueId: LEAGUE_ID } } })) > 0

  if (skipGoals) {
    counts.goalsSkipped = parsed.goals.length
    if (flags.verboseDiff) {
      console.log(
        `  Skipping ${parsed.goals.length} goals (--no-overwrite-goals default; existing goals present)`,
      )
    }
  } else {
    // Slot tracker: (matchId, scoringSlug, scorerSlug) → next slot index
    const slotMap = new Map<string, number>()
    for (const g of parsed.goals) {
      const dbMatchId = matchIdByPublicId.get(g.matchId)
      if (!dbMatchId) {
        counts.goalsSkipped++
        continue
      }
      const ltScoringId = ltIdBySlug.get(g.scoringTeamId)
      if (!ltScoringId) {
        counts.goalsSkipped++
        continue
      }
      const scorerSlug = slugify(g.scorer)
      const scorerPid = playerIdBySlug.get(scorerSlug) ?? 'p-guest'
      const slotKey = `${dbMatchId}|${g.scoringTeamId}|${scorerSlug}`
      const slot = slotMap.get(slotKey) ?? 0
      slotMap.set(slotKey, slot + 1)
      const goalId = ids.goal(dbMatchId, g.scoringTeamId, scorerSlug, slot)

      await prisma.goal.upsert({
        where: { id: goalId },
        create: {
          id: goalId,
          matchId: dbMatchId,
          playerId: scorerPid,
          scoringTeamId: ltScoringId,
        },
        update: {},
      })
      counts.goals++

      if (g.assister) {
        const assisterSlug = slugify(g.assister)
        const assisterPid = playerIdBySlug.get(assisterSlug) ?? 'p-guest'
        const assistId = ids.assist(goalId)
        await prisma.assist.upsert({
          where: { goalId },
          create: { id: assistId, matchId: dbMatchId, playerId: assisterPid, goalId },
          update: { playerId: assisterPid },
        })
        counts.assists++
      }
    }
  }

  // 7. Availability — populate from parsed.availabilityStatuses
  if (!flags.noAvailability) {
    const sheetSnapshotTime = new Date()
    for (const md of parsed.matchdays) {
      const gwId = gwIdByMdId.get(md.id)
      if (!gwId) continue
      const statuses = parsed.availabilityStatuses[md.id] ?? {}
      for (const teamId of Object.keys(statuses)) {
        const teamStatuses = statuses[teamId]
        for (const playerSlug of Object.keys(teamStatuses)) {
          const sheetStatus = teamStatuses[playerSlug]
          const playerId = playerIdBySlug.get(playerSlug)
          if (!playerId) continue
          const data: Prisma.AvailabilityCreateInput = {
            player: { connect: { id: playerId } },
            gameWeek: { connect: { id: gwId } },
            rsvp:
              sheetStatus === 'PLAYED'
                ? null
                : sheetStatus === 'GOING' || sheetStatus === 'Y'
                  ? 'GOING'
                  : sheetStatus === 'UNDECIDED' || sheetStatus === 'EXPECTED'
                    ? 'UNDECIDED'
                    : null,
            participated: sheetStatus === 'PLAYED' ? 'JOINED' : null,
          }

          if (flags.availabilityMerge) {
            const existing = await prisma.availability.findUnique({
              where: { playerId_gameWeekId: { playerId, gameWeekId: gwId } },
              select: { updatedAt: true },
            })
            if (existing && existing.updatedAt > sheetSnapshotTime) {
              counts.availabilitySkipped++
              continue
            }
          }

          await prisma.availability.upsert({
            where: { playerId_gameWeekId: { playerId, gameWeekId: gwId } },
            create: {
              id: ids.availability(playerId, gwId),
              ...(data as any),
            },
            update: {
              rsvp: data.rsvp,
              participated: data.participated,
            },
          })
          counts.availability++
        }
      }
    }
  }

  return counts
}

// ── Entry ──────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  console.log('Backfill flags:', flags)

  const prisma = new PrismaClient({ log: ['error'] })

  try {
    console.log('Fetching Sheets…')
    const raw = await fetchSheetData()
    console.log('  rows:', {
      teams: raw.teams.length,
      roster: raw.roster.length,
      schedule: raw.schedule.length,
      goals: raw.goals.length,
      mdSchedule: raw.mdSchedule.length,
    })

    // Parse via the existing public-side parser to keep one source of truth.
    // Note: importing parseAllData from src/lib/data because it's the same
    // shape we want to upsert from.
    const { parseAllData } = await import('../src/lib/data')
    const parsed = parseAllData(raw as any)
    console.log('Parsed:', {
      teams: parsed.teams.length,
      players: parsed.players.length,
      matchdays: parsed.matchdays.length,
      goals: parsed.goals.length,
      avStatuses: Object.keys(parsed.availabilityStatuses).length,
    })

    if (flags.dryRun) {
      console.log('\nDry-run mode — wrapping in $transaction(rollback)…')
      const counts = await prisma
        .$transaction(
          async (tx) => {
            const c = await runBackfill(tx as unknown as PrismaClient, parsed, flags)
            // Throw to roll back the transaction
            throw { __dryRunCounts: c }
          },
          // 5min timeout: full backfill across ~50 players × 8 matchdays takes
          // multiple seconds of round-trips even on a per-PR Neon branch.
          { timeout: 300_000, maxWait: 10_000 },
        )
        .catch((e: any) => {
          if (e && typeof e === 'object' && '__dryRunCounts' in e) {
            return e.__dryRunCounts as Counts
          }
          throw e
        })
      console.log('\n=== DRY RUN COUNTS (no changes committed) ===')
      console.log(counts)
    } else {
      console.log('\nLive mode — writing changes…')
      const counts = await runBackfill(prisma, parsed, flags)
      console.log('\n=== COUNTS ===')
      console.log(counts)
    }
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err)
    process.exit(1)
  })
}
