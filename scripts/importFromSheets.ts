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

// Strip color prefix added by the spreadsheet (RatingsRaw and sometimes GoalsRaw)
function normalizeTeamName(name: string): string {
  return name.replace(/^(?:Blue|Yellow|Red|Green|White|Black)\s+/i, '').trim()
}

function parseMatchdayNum(val: string): number | null {
  const m = val.match(/(\d+)/)
  return m ? parseInt(m[1], 10) : null
}

function parseAvailStatus(val: string): string | null {
  const v = val.trim().toUpperCase()
  if (v === 'Y' || v === 'GOING') return 'GOING'
  if (v === 'EXPECTED' || v === 'UNDECIDED') return 'UNDECIDED'
  if (v === 'PLAYED') return 'PLAYED'
  return null // blank / not going → skip
}

function inferMatchdayFromTimestamp(
  timestamp: string,
  mdDateMap: Map<number, Date | null>,
): number | null {
  if (!timestamp) return null
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) return null
  for (const [md, mdDate] of mdDateMap) {
    if (!mdDate) continue
    if (
      d.getFullYear() === mdDate.getFullYear() &&
      d.getMonth() === mdDate.getMonth() &&
      d.getDate() === mdDate.getDate()
    ) return md
  }
  return null
}

// Stable, deterministic IDs keep re-runs idempotent
function mkTeamId(leagueSlug: string, name: string) { return `t-${leagueSlug}-${slugify(name)}` }
function mkPlayerId(name: string)                   { return `p-${slugify(name)}` }
function mkMatchId(ls: string, md: number, h: string, a: string) {
  return `m-${ls}-md${md}-${slugify(h)}-vs-${slugify(a)}`
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  // Load .env.local before reading any env vars (Prisma URL, Google creds, etc.)
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
  dotenv.config()

  const LEAGUE_SLUG    = process.env.IMPORT_LEAGUE_SLUG    ?? 't9l'
  const LEAGUE_NAME    = process.env.IMPORT_LEAGUE_NAME    ?? 'T9L 2026 Spring'
  const SHEET_ID       = process.env.GOOGLE_SHEETS_ID      ?? process.env.GOOGLE_SHEET_ID ?? ''
  const SERVICE_EMAIL  = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? ''
  const PRIVATE_KEY    = (process.env.GOOGLE_PRIVATE_KEY   ?? '').replace(/\\n/g, '\n')

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
        'RatingsRaw!A:BH',    // wide: [matchday, timestamp, respondentTeam, …playerCols…, ref, gamesClose, teamwork, enjoyment]
        'MDScheduleRaw!A:B',  // [label, YYYY-MM-DD]
      ],
    })

    const rows = (data.valueRanges ?? []).map(vr => (vr.values as string[][]) ?? [])
    const [teamRaw, rosterRaw, scheduleRaw, goalsRaw, , mdScheduleRaw] = rows

    const teamRows     = (teamRaw     ?? []).slice(1).filter(r => r[0]?.trim())
    const rosterRows   = (rosterRaw   ?? []).slice(1).filter(r => r[1]?.trim())
    const scheduleRows = (scheduleRaw ?? []).slice(1).filter(r => r[0]?.trim())
    const goalRows     = (goalsRaw    ?? []).slice(1)
    const mdDateRows   = (mdScheduleRaw ?? []).slice(1)

    // ── 1. League ──────────────────────────────────────────────────────────────
    const league = await prisma.league.upsert({
      where:  { slug: LEAGUE_SLUG },
      create: { name: LEAGUE_NAME, slug: LEAGUE_SLUG },
      update: { name: LEAGUE_NAME },
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

    // ── 2. Matchday date map (MDScheduleRaw) ───────────────────────────────────
    const mdDateMap = new Map<number, Date | null>()
    for (const row of mdDateRows) {
      const md = parseMatchdayNum(row[0] ?? '')
      if (md === null) continue
      const d = row[1] ? new Date(row[1]) : null
      mdDateMap.set(md, d && !isNaN(d.getTime()) ? d : null)
    }

    // ── 3. Teams (TeamRaw A:B) ─────────────────────────────────────────────────
    // Cols: [name, logoUrl]
    const teamIdMap = new Map<string, string>() // normalized name → stable DB id
    for (const row of teamRows) {
      const name    = row[0].trim()
      const logoUrl = row[1]?.trim() || null
      const id      = mkTeamId(LEAGUE_SLUG, name)
      await prisma.team.upsert({
        where:  { id },
        create: { id, leagueId: league.id, name, logoUrl },
        update: { name, logoUrl },
      })
      teamIdMap.set(name, id)
    }
    console.log(`✓ Teams: ${teamIdMap.size}`)

    // ── 4. Players (RosterRaw A:L) ─────────────────────────────────────────────
    // Cols: [picUrl, name, team, position, MD1-MD8]
    const playerIdMap = new Map<string, string>() // player name → stable DB id
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

    // ── 5. PlayerTeams ─────────────────────────────────────────────────────────
    let ptCount = 0
    for (const row of rosterRows) {
      const name     = row[1].trim()
      const teamName = row[2]?.trim() ?? ''
      const position = row[3]?.trim() || null
      const pId      = playerIdMap.get(name)
      const tId      = teamIdMap.get(teamName)
      if (!pId || !tId) continue
      await prisma.playerTeam.upsert({
        where:  { playerId_teamId: { playerId: pId, teamId: tId } },
        create: { playerId: pId, teamId: tId, position, isActive: true },
        update: { position, isActive: true },
      })
      ptCount++
    }
    console.log(`✓ PlayerTeams: ${ptCount}`)

    // ── 6. Matches (ScheduleRaw A:F + MDScheduleRaw) ──────────────────────────
    // ScheduleRaw cols: [matchday, matchNum, kickoff, fullTime, homeTeam, awayTeam]
    const matchIdMap    = new Map<string, string>() // `${md}-${homeId}-${awayId}` → stable match id (both orderings)
    const matchTeamInfo = new Map<string, { homeTeamId: string; awayTeamId: string }>()
    const mdToMatchIds  = new Map<number, string[]>()

    for (const row of scheduleRows) {
      const md       = parseMatchdayNum(row[0] ?? '')
      if (md === null) continue
      const homeName = row[4]?.trim() ?? ''
      const awayName = row[5]?.trim() ?? ''
      const homeId   = teamIdMap.get(homeName)
      const awayId   = teamIdMap.get(awayName)
      if (!homeId || !awayId) {
        console.warn(`  ⚠ Match MD${md}: unknown team "${homeName}" or "${awayName}"`)
        continue
      }

      const mId  = mkMatchId(LEAGUE_SLUG, md, homeName, awayName)
      const date = mdDateMap.get(md) ?? null

      await prisma.match.upsert({
        where:  { id: mId },
        create: { id: mId, leagueId: league.id, homeTeamId: homeId, awayTeamId: awayId, matchday: md, date, status: 'scheduled' },
        update: { date },
      })

      matchIdMap.set(`${md}-${homeId}-${awayId}`, mId)
      matchIdMap.set(`${md}-${awayId}-${homeId}`, mId)
      matchTeamInfo.set(mId, { homeTeamId: homeId, awayTeamId: awayId })
      if (!mdToMatchIds.has(md)) mdToMatchIds.set(md, [])
      mdToMatchIds.get(md)!.push(mId)
    }
    const totalMatches = [...mdToMatchIds.values()].flat().length
    console.log(`✓ Matches: ${totalMatches} across ${mdToMatchIds.size} matchday(s)`)

    // ── 7. Goals (GoalsRaw A:F) ────────────────────────────────────────────────
    // Cols: [matchday, timestamp, scoringTeam, concedingTeam, scorer, assister]
    // Note: col 0 may be "#REF!" — fall back to inferring from timestamp vs MDScheduleRaw
    const matchScores = new Map<string, { home: number; away: number }>()
    let goalCount = 0

    for (let i = 0; i < goalRows.length; i++) {
      const row       = goalRows[i]
      const mdRaw     = row[0]?.trim() ?? ''
      const timestamp = row[1]?.trim() ?? ''
      const scorerName   = row[4]?.trim() ?? ''
      const assisterName = row[5]?.trim() ?? ''

      if (!scorerName) continue

      const md: number | null = /MD?\d+/i.test(mdRaw)
        ? parseMatchdayNum(mdRaw)
        : inferMatchdayFromTimestamp(timestamp, mdDateMap)
      if (md === null) continue

      const scoringTeam   = normalizeTeamName(row[2]?.trim() ?? '')
      const concedingTeam = normalizeTeamName(row[3]?.trim() ?? '')
      const scoringTId    = teamIdMap.get(scoringTeam)
      const concedingTId  = teamIdMap.get(concedingTeam)
      if (!scoringTId || !concedingTId) {
        console.warn(`  ⚠ Goal row ${i + 2}: unknown team "${scoringTeam}" or "${concedingTeam}"`)
        continue
      }

      const mId =
        matchIdMap.get(`${md}-${scoringTId}-${concedingTId}`) ??
        matchIdMap.get(`${md}-${concedingTId}-${scoringTId}`)
      if (!mId) {
        console.warn(`  ⚠ Goal row ${i + 2}: no match for MD${md} ${scoringTeam} vs ${concedingTeam}`)
        continue
      }

      const scorerId = playerIdMap.get(scorerName) ?? GUEST_ID
      if (!playerIdMap.has(scorerName)) {
        console.log(`  ℹ Non-roster scorer mapped to Guest: ${scorerName}`)
      }
      const assisterId = assisterName ? (playerIdMap.get(assisterName) ?? GUEST_ID) : null

      const gId = `g-${mId}-${i}`
      await prisma.goal.upsert({
        where:  { id: gId },
        create: { id: gId, matchId: mId, scorerId, assisterId },
        update: { assisterId },
      })
      goalCount++

      if (!matchScores.has(mId)) matchScores.set(mId, { home: 0, away: 0 })
      const scores    = matchScores.get(mId)!
      const teamInfo  = matchTeamInfo.get(mId)!
      if (teamInfo.homeTeamId === scoringTId) scores.home++
      else scores.away++
    }
    console.log(`✓ Goals: ${goalCount}`)

    // ── 8. Match scores + finished status ─────────────────────────────────────
    // Per CLAUDE.md: if a matchday has any goals, all 3 matches are treated as finished
    const finishedMds = new Set<number>()
    for (const mId of matchScores.keys()) {
      const m = await prisma.match.findUnique({ where: { id: mId }, select: { matchday: true } })
      if (m) finishedMds.add(m.matchday)
    }

    for (const [mId, s] of matchScores) {
      await prisma.match.update({
        where: { id: mId },
        data:  { homeScore: s.home, awayScore: s.away, status: 'finished' },
      })
    }
    for (const md of finishedMds) {
      for (const mId of mdToMatchIds.get(md) ?? []) {
        if (!matchScores.has(mId)) {
          await prisma.match.update({
            where: { id: mId },
            data:  { homeScore: 0, awayScore: 0, status: 'finished' },
          })
        }
      }
    }
    console.log(`✓ Scores updated (${finishedMds.size} finished matchday(s))`)

    // ── 9. Availability (RosterRaw cols E-L = MD1-MD8) ────────────────────────
    // RosterRaw: [picUrl, name, team, position, MD1(4), MD2(5), ..., MD8(11)]
    let availCount = 0
    for (const row of rosterRows) {
      const name     = row[1].trim()
      const teamName = row[2]?.trim() ?? ''
      const pId      = playerIdMap.get(name)
      const tId      = teamIdMap.get(teamName)
      if (!pId || !tId) continue

      for (let md = 1; md <= 8; md++) {
        const val    = row[3 + md]?.trim() ?? '' // index 4=MD1 … 11=MD8
        const status = parseAvailStatus(val)
        if (!status) continue

        for (const mId of mdToMatchIds.get(md) ?? []) {
          const info = matchTeamInfo.get(mId)
          if (!info || (info.homeTeamId !== tId && info.awayTeamId !== tId)) continue
          await prisma.availability.upsert({
            where:  { matchId_playerId: { matchId: mId, playerId: pId } },
            create: { matchId: mId, playerId: pId, status },
            update: { status },
          })
          availCount++
        }
      }
    }
    console.log(`✓ Availability: ${availCount}`)

    // Ratings model removed — no ratings import.

    console.log('\n✅  Import complete.\n')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(err => {
  console.error('Import failed:', err)
  process.exit(1)
})
