import * as dotenv from 'dotenv'
import * as path from 'path'
import { google } from 'googleapis'
import { PrismaClient } from '@prisma/client'

// ── Helpers ────────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function normalizeTeamName(name: string): string {
  return name.replace(/^(?:Blue|Yellow|Red|Green|White|Black)\s+/i, '').trim()
}

function parseWeekNum(val: string): number | null {
  const m = val.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

function inferWeekFromTimestamp(
  timestamp: string,
  dateMap: Map<number, Date | null>,
): number | null {
  if (!timestamp) return null
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) return null
  for (const [wk, wkDate] of dateMap) {
    if (!wkDate) continue
    if (
      d.getFullYear() === wkDate.getFullYear() &&
      d.getMonth() === wkDate.getMonth() &&
      d.getDate() === wkDate.getDate()
    ) return wk
  }
  return null
}

// Placeholder date for game weeks not yet scheduled
const TBD_DATE = new Date('2099-01-01')

// Stable, deterministic IDs keep re-runs idempotent
function mkLeagueId(slug: string)                              { return `l-${slug}` }
function mkTeamId(name: string)                                { return `t-${slugify(name)}` }
function mkLeagueTeamId(leagueSlug: string, name: string)     { return `lt-${leagueSlug}-${slugify(name)}` }
function mkGameWeekId(leagueSlug: string, wk: number)         { return `gw-${leagueSlug}-${wk}` }
function mkPlayerId(name: string)                              { return `p-${slugify(name)}` }
function mkPlaId(pId: string, ltId: string)                   { return `pla-${pId}-${ltId}` }
function mkMatchId(ls: string, wk: number, h: string, a: string) {
  return `m-${ls}-wk${wk}-${slugify(h)}-vs-${slugify(a)}`
}
function mkGoalId(mId: string, i: number)  { return `g-${mId}-${i}` }
function mkAssistId(goalId: string)        { return `a-${goalId}` }

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  dotenv.config()

  const LEAGUE_SLUG    = process.env.IMPORT_LEAGUE_SLUG     ?? 't9l'
  const LEAGUE_NAME    = process.env.IMPORT_LEAGUE_NAME     ?? 'T9L 2026 Spring'
  const LEAGUE_LOC     = process.env.IMPORT_LEAGUE_LOCATION ?? 'Tokyo, Japan'
  const START_DATE_STR = process.env.IMPORT_START_DATE      ?? '2026-01-01'
  const SHEET_ID       = process.env.GOOGLE_SHEETS_ID       ?? process.env.GOOGLE_SHEET_ID ?? ''
  const SERVICE_EMAIL  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? ''
  const PRIVATE_KEY    = (process.env.GOOGLE_PRIVATE_KEY    ?? '').replace(/\\n/g, '\n')

  if (!SHEET_ID)      throw new Error('Missing GOOGLE_SHEETS_ID (or GOOGLE_SHEET_ID)')
  if (!SERVICE_EMAIL) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL')
  if (!PRIVATE_KEY)   throw new Error('Missing GOOGLE_PRIVATE_KEY')

  const prisma = new PrismaClient({ log: ['error'] })

  try {
    console.log(`\n🏟  Import: ${LEAGUE_NAME} (${LEAGUE_SLUG})`)
    console.log(`📊  Sheet : ${SHEET_ID}\n`)

    // ── Fetch all ranges in one round-trip ─────────────────────────────────────
    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
    const sheets = google.sheets({ version: 'v4', auth })

    console.log('Fetching all sheet ranges…')
    const { data } = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SHEET_ID,
      ranges: [
        'TeamRaw!A:B',        // [name, logoUrl]
        'RosterRaw!A:L',      // [picUrl, name, team, position, MD1-MD8]
        'ScheduleRaw!A:F',    // [matchday, matchNum, kickoff, fullTime, homeTeam, awayTeam]
        'GoalsRaw!A:F',       // [matchday, timestamp, scoringTeam, concedingTeam, scorer, assister]
        'MDScheduleRaw!A:B',  // [label, YYYY-MM-DD]
      ],
    })

    const rows = (data.valueRanges ?? []).map(vr => (vr.values as string[][]) ?? [])
    const [teamRaw, rosterRaw, scheduleRaw, goalsRaw, mdScheduleRaw] = rows

    const teamRows     = (teamRaw       ?? []).slice(1).filter(r => r[0]?.trim())
    const rosterRows   = (rosterRaw     ?? []).slice(1).filter(r => r[1]?.trim())
    const scheduleRows = (scheduleRaw   ?? []).slice(1).filter(r => r[0]?.trim())
    const goalRows     = (goalsRaw      ?? []).slice(1)
    const mdDateRows   = (mdScheduleRaw ?? []).slice(1)

    // ── 1. League ──────────────────────────────────────────────────────────────
    const LEAGUE_ID = mkLeagueId(LEAGUE_SLUG)
    const league = await prisma.league.upsert({
      where:  { id: LEAGUE_ID },
      create: {
        id: LEAGUE_ID,
        name: LEAGUE_NAME,
        location: LEAGUE_LOC,
        startDate: new Date(START_DATE_STR),
      },
      update: { name: LEAGUE_NAME, location: LEAGUE_LOC },
    })
    console.log(`✓ League: ${league.name} (${league.id})`)

    // ── Guest player — catch-all for non-rostered scorers ──────────────────────
    const GUEST_ID = 'p-guest'
    await prisma.player.upsert({
      where:  { id: GUEST_ID },
      create: { id: GUEST_ID, name: 'Guest' },
      update: { name: 'Guest' },
    })
    console.log(`✓ Guest player ensured (${GUEST_ID})`)

    // ── 2. Week/matchday date map (MDScheduleRaw) ──────────────────────────────
    const wkDateMap = new Map<number, Date | null>()
    for (const row of mdDateRows) {
      const wk = parseWeekNum(row[0] ?? '')
      if (wk === null) continue
      const d = row[1] ? new Date(row[1]) : null
      wkDateMap.set(wk, d && !isNaN(d.getTime()) ? d : null)
    }

    // ── 3. Teams + LeagueTeams ─────────────────────────────────────────────────
    // Team is now standalone (no leagueId). LeagueTeam is the league↔team junction.
    const leagueTeamIdMap = new Map<string, string>() // team name → LeagueTeam.id
    for (const row of teamRows) {
      const name    = row[0].trim()
      const logoUrl = row[1]?.trim() || null
      const tId     = mkTeamId(name)
      const ltId    = mkLeagueTeamId(LEAGUE_SLUG, name)

      await prisma.team.upsert({
        where:  { id: tId },
        create: { id: tId, name, logoUrl },
        update: { name, logoUrl },
      })

      await prisma.leagueTeam.upsert({
        where:  { leagueId_teamId: { leagueId: league.id, teamId: tId } },
        create: { id: ltId, leagueId: league.id, teamId: tId },
        update: {},
      })

      leagueTeamIdMap.set(name, ltId)
    }
    console.log(`✓ Teams + LeagueTeams: ${leagueTeamIdMap.size}`)

    // ── 4. Players (RosterRaw A:L) ─────────────────────────────────────────────
    const playerIdMap = new Map<string, string>() // player name → Player.id
    for (const row of rosterRows) {
      const pictureUrl = row[0]?.trim() || null
      const name       = row[1].trim()
      const id         = mkPlayerId(name)
      await prisma.player.upsert({
        where:  { id },
        create: { id, name, pictureUrl },
        update: { name, pictureUrl },
      })
      playerIdMap.set(name, id)
    }
    console.log(`✓ Players: ${playerIdMap.size}`)

    // ── 5. PlayerLeagueAssignments ─────────────────────────────────────────────
    // Replaces the old PlayerTeam model. fromGameWeek=1 (assigned from the start).
    let plaCount = 0
    for (const row of rosterRows) {
      const name     = row[1].trim()
      const teamName = row[2]?.trim() ?? ''
      const pId      = playerIdMap.get(name)
      const ltId     = leagueTeamIdMap.get(teamName)
      if (!pId || !ltId) continue
      const plaId = mkPlaId(pId, ltId)
      await prisma.playerLeagueAssignment.upsert({
        where:  { id: plaId },
        create: { id: plaId, playerId: pId, leagueTeamId: ltId, fromGameWeek: 1 },
        update: {},
      })
      plaCount++
    }
    console.log(`✓ PlayerLeagueAssignments: ${plaCount}`)

    // ── 6. GameWeeks ──────────────────────────────────────────────────────────
    const weekNumbers = new Set<number>()
    for (const row of scheduleRows) {
      const wk = parseWeekNum(row[0] ?? '')
      if (wk !== null) weekNumbers.add(wk)
    }

    const gameWeekIdMap = new Map<number, string>() // weekNumber → GameWeek.id
    for (const wk of weekNumbers) {
      const gwId = mkGameWeekId(LEAGUE_SLUG, wk)
      const d    = wkDateMap.get(wk) ?? TBD_DATE
      await prisma.gameWeek.upsert({
        where:  { leagueId_weekNumber: { leagueId: league.id, weekNumber: wk } },
        create: { id: gwId, leagueId: league.id, weekNumber: wk, startDate: d, endDate: d },
        update: { startDate: d, endDate: d },
      })
      gameWeekIdMap.set(wk, gwId)
    }
    console.log(`✓ GameWeeks: ${gameWeekIdMap.size}`)

    // ── 7. Matches (ScheduleRaw A:F) ───────────────────────────────────────────
    // homeTeamId/awayTeamId reference LeagueTeam.id (not Team.id)
    const matchIdMap    = new Map<string, string>() // `${wk}-${ltHomeId}-${ltAwayId}` → match id
    const matchTeamInfo = new Map<string, { homeLeagueTeamId: string; awayLeagueTeamId: string }>()
    const wkToMatchIds  = new Map<number, string[]>()

    for (const row of scheduleRows) {
      const wk       = parseWeekNum(row[0] ?? '')
      if (wk === null) continue
      const homeName = row[4]?.trim() ?? ''
      const awayName = row[5]?.trim() ?? ''
      const ltHomeId = leagueTeamIdMap.get(homeName)
      const ltAwayId = leagueTeamIdMap.get(awayName)
      const gwId     = gameWeekIdMap.get(wk)
      if (!ltHomeId || !ltAwayId || !gwId) {
        console.warn(`  ⚠ Match Wk${wk}: unknown team "${homeName}" or "${awayName}"`)
        continue
      }

      const mId    = mkMatchId(LEAGUE_SLUG, wk, homeName, awayName)
      const playAt = wkDateMap.get(wk) ?? TBD_DATE

      await prisma.match.upsert({
        where:  { id: mId },
        create: {
          id: mId,
          leagueId: league.id,
          gameWeekId: gwId,
          homeTeamId: ltHomeId,
          awayTeamId: ltAwayId,
          playedAt: playAt,
          status: 'SCHEDULED',
        },
        update: { playedAt: playAt },
      })

      matchIdMap.set(`${wk}-${ltHomeId}-${ltAwayId}`, mId)
      matchIdMap.set(`${wk}-${ltAwayId}-${ltHomeId}`, mId)
      matchTeamInfo.set(mId, { homeLeagueTeamId: ltHomeId, awayLeagueTeamId: ltAwayId })
      if (!wkToMatchIds.has(wk)) wkToMatchIds.set(wk, [])
      wkToMatchIds.get(wk)!.push(mId)
    }
    const totalMatches = [...wkToMatchIds.values()].flat().length
    console.log(`✓ Matches: ${totalMatches} across ${wkToMatchIds.size} week(s)`)

    // ── 8. Goals + Assists (GoalsRaw A:F) ─────────────────────────────────────
    // scoringTeamId references LeagueTeam.id; assists are a separate model
    const matchScores = new Map<string, { home: number; away: number }>()
    let goalCount = 0

    for (let i = 0; i < goalRows.length; i++) {
      const row          = goalRows[i]
      const mdRaw        = row[0]?.trim() ?? ''
      const timestamp    = row[1]?.trim() ?? ''
      const scorerName   = row[4]?.trim() ?? ''
      const assisterName = row[5]?.trim() ?? ''

      if (!scorerName) continue

      const wk: number | null = /MD?\d+/i.test(mdRaw)
        ? parseWeekNum(mdRaw)
        : inferWeekFromTimestamp(timestamp, wkDateMap)
      if (wk === null) continue

      const scoringTeam   = normalizeTeamName(row[2]?.trim() ?? '')
      const concedingTeam = normalizeTeamName(row[3]?.trim() ?? '')
      const ltScoringId   = leagueTeamIdMap.get(scoringTeam)
      const ltConcedingId = leagueTeamIdMap.get(concedingTeam)
      if (!ltScoringId || !ltConcedingId) {
        console.warn(`  ⚠ Goal row ${i + 2}: unknown team "${scoringTeam}" or "${concedingTeam}"`)
        continue
      }

      const mId =
        matchIdMap.get(`${wk}-${ltScoringId}-${ltConcedingId}`) ??
        matchIdMap.get(`${wk}-${ltConcedingId}-${ltScoringId}`)
      if (!mId) {
        console.warn(`  ⚠ Goal row ${i + 2}: no match for Wk${wk} ${scoringTeam} vs ${concedingTeam}`)
        continue
      }

      const scorerId = playerIdMap.get(scorerName) ?? GUEST_ID
      if (!playerIdMap.has(scorerName)) {
        console.log(`  ℹ Non-roster scorer mapped to Guest: ${scorerName}`)
      }
      const assisterId = assisterName ? (playerIdMap.get(assisterName) ?? GUEST_ID) : null

      const gId = mkGoalId(mId, i)
      await prisma.goal.upsert({
        where:  { id: gId },
        create: { id: gId, matchId: mId, playerId: scorerId, scoringTeamId: ltScoringId },
        update: {},
      })

      if (assisterId) {
        const aId = mkAssistId(gId)
        await prisma.assist.upsert({
          where:  { goalId: gId },
          create: { id: aId, matchId: mId, playerId: assisterId, goalId: gId },
          update: { playerId: assisterId },
        })
      }

      goalCount++

      if (!matchScores.has(mId)) matchScores.set(mId, { home: 0, away: 0 })
      const scores   = matchScores.get(mId)!
      const teamInfo = matchTeamInfo.get(mId)!
      if (teamInfo.homeLeagueTeamId === ltScoringId) scores.home++
      else scores.away++
    }
    console.log(`✓ Goals: ${goalCount}`)

    // ── 9. Match scores + COMPLETED status ────────────────────────────────────
    // Per CLAUDE.md: if a week has any goals, all 3 matches are treated as completed
    const completedWks = new Set<number>()
    for (const mId of matchScores.keys()) {
      const m = await prisma.match.findUnique({
        where: { id: mId },
        select: { gameWeek: { select: { weekNumber: true } } },
      })
      if (m) completedWks.add(m.gameWeek.weekNumber)
    }

    for (const [mId, s] of matchScores) {
      await prisma.match.update({
        where: { id: mId },
        data:  { homeScore: s.home, awayScore: s.away, status: 'COMPLETED' },
      })
    }
    for (const wk of completedWks) {
      for (const mId of wkToMatchIds.get(wk) ?? []) {
        if (!matchScores.has(mId)) {
          await prisma.match.update({
            where: { id: mId },
            data:  { homeScore: 0, awayScore: 0, status: 'COMPLETED' },
          })
        }
      }
    }
    console.log(`✓ Scores updated (${completedWks.size} completed week(s))`)

    console.log('\n✅  Import complete.\n')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('Import failed:', err)
  process.exit(1)
})
