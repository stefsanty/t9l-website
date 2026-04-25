/**
 * importFromSheets.ts
 * One-time (idempotent) migration: Google Sheets → Neon Postgres
 *
 * Run with:
 *   npx ts-node --project tsconfig.scripts.json scripts/importFromSheets.ts
 *
 * Requires env vars: GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL,
 * GOOGLE_PRIVATE_KEY, DATABASE_URL
 */

import { PrismaClient } from '@prisma/client'
import { google } from 'googleapis'

const prisma = new PrismaClient()

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID!
const LEAGUE_SLUG = process.env.IMPORT_LEAGUE_SLUG || 'minato-2025'
const LEAGUE_NAME = process.env.IMPORT_LEAGUE_NAME || 'T9L Minato 2025'

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  })
  return google.sheets({ version: 'v4', auth })
}

async function fetchRange(sheets: any, range: string): Promise<string[][]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  })
  return res.data.values || []
}

function normalizeDate(raw: string | undefined): Date | null {
  if (!raw) return null
  const iso = new Date(raw)
  if (!isNaN(iso.getTime())) return iso
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slash) return new Date(`${slash[3]}-${slash[1].padStart(2,'0')}-${slash[2].padStart(2,'0')}T12:00:00+09:00`)
  return null
}

async function main() {
  console.log('Starting import...')
  const sheets = await getSheetsClient()

  // ── 1. Upsert League ──────────────────────────────────────────────────────
  console.log('Upserting league...')
  const league = await prisma.league.upsert({
    where: { slug: LEAGUE_SLUG },
    create: { name: LEAGUE_NAME, slug: LEAGUE_SLUG, status: 'active' },
    update: { name: LEAGUE_NAME },
  })
  console.log(`  League: ${league.name} (${league.id})`)

  // ── 2. Teams ──────────────────────────────────────────────────────────────
  console.log('Importing teams...')
  const teamsRows = await fetchRange(sheets, 'Teams')
  const teamMap = new Map<string, string>() // sheetId → DB id

  for (const row of teamsRows.slice(1)) {
    const [sheetId, name, shortName, color, logoUrl] = row
    if (!sheetId || !name) continue
    const team = await prisma.team.upsert({
      where: { id: `t-${LEAGUE_SLUG}-${sheetId}` },
      create: { id: `t-${LEAGUE_SLUG}-${sheetId}`, leagueId: league.id, name, shortName: shortName || null, color: color || null, logoUrl: logoUrl || null },
      update: { name, shortName: shortName || null, color: color || null },
    })
    teamMap.set(sheetId, team.id)
    console.log(`  Team: ${name}`)
  }

  // ── 3. Players ────────────────────────────────────────────────────────────
  console.log('Importing players...')
  const rosterRows = await fetchRange(sheets, 'Roster')
  const playerMap = new Map<string, string>() // sheetPlayerId → DB id

  for (const row of rosterRows.slice(1)) {
    const [playerId, playerName, teamId, position] = row
    if (!playerId || !playerName) continue

    const player = await prisma.player.upsert({
      where: { id: `p-${playerId}` },
      create: { id: `p-${playerId}`, name: playerName },
      update: { name: playerName },
    })
    playerMap.set(playerId, player.id)

    const dbTeamId = teamMap.get(teamId)
    if (dbTeamId) {
      await prisma.playerTeam.upsert({
        where: { playerId_teamId: { playerId: player.id, teamId: dbTeamId } },
        create: { playerId: player.id, teamId: dbTeamId, position: position || null },
        update: { position: position || null },
      })
    }
    console.log(`  Player: ${playerName}`)
  }

  // ── 4. Matches ────────────────────────────────────────────────────────────
  console.log('Importing matches...')
  const scheduleRows = await fetchRange(sheets, 'Schedule')
  const matchMap = new Map<string, string>() // matchday+home+away → DB id

  for (const row of scheduleRows.slice(1)) {
    const [matchdayRaw, dateRaw, venue, homeId, awayId, homeScoreRaw, awayScoreRaw] = row
    if (!matchdayRaw || !homeId || !awayId) continue

    const matchday = parseInt(matchdayRaw.replace(/\D/g, ''), 10)
    const homeTeamId = teamMap.get(homeId)
    const awayTeamId = teamMap.get(awayId)
    if (!homeTeamId || !awayTeamId) continue

    const matchKey = `m-${LEAGUE_SLUG}-md${matchday}-${homeId}-${awayId}`
    const homeScore = homeScoreRaw ? parseInt(homeScoreRaw, 10) : null
    const awayScore = awayScoreRaw ? parseInt(awayScoreRaw, 10) : null
    const status = homeScore !== null && awayScore !== null ? 'played' : 'scheduled'

    const match = await prisma.match.upsert({
      where: { id: matchKey },
      create: {
        id: matchKey,
        leagueId: league.id,
        homeTeamId,
        awayTeamId,
        matchday,
        date: normalizeDate(dateRaw),
        venue: venue || null,
        homeScore,
        awayScore,
        status,
      },
      update: { date: normalizeDate(dateRaw), homeScore, awayScore, status },
    })
    matchMap.set(matchKey, match.id)
    console.log(`  Match MD${matchday}: ${homeId} vs ${awayId}`)
  }

  // ── 5. Goals ──────────────────────────────────────────────────────────────
  console.log('Importing goals...')
  const goalsRows = await fetchRange(sheets, 'Goals')

  for (const row of goalsRows.slice(1)) {
    const [matchdayRaw, , scorerId, assisterId] = row
    if (!scorerId) continue

    const scorerDbId = playerMap.get(scorerId)
    if (!scorerDbId) continue

    const matchday = parseInt(matchdayRaw?.replace(/\D/g, '') || '0', 10)
    const matchesForMd = await prisma.match.findMany({
      where: { leagueId: league.id, matchday },
    })

    if (matchesForMd.length === 0) continue
    const matchId = matchesForMd[0].id

    await prisma.goal.create({
      data: {
        matchId,
        scorerId: scorerDbId,
        assisterId: assisterId ? playerMap.get(assisterId) || null : null,
      },
    })
    console.log(`  Goal: ${scorerId} (MD${matchday})`)
  }

  // ── 6. Ratings ────────────────────────────────────────────────────────────
  console.log('Importing ratings...')
  const ratingsRows = await fetchRange(sheets, 'Ratings')

  for (const row of ratingsRows.slice(1)) {
    const [matchdayRaw, playerId, refScore, teamwork, enjoyment, gameCloseness] = row
    if (!playerId) continue

    const playerDbId = playerMap.get(playerId)
    if (!playerDbId) continue

    const matchday = parseInt(matchdayRaw?.replace(/\D/g, '') || '0', 10)
    const matchesForMd = await prisma.match.findMany({
      where: { leagueId: league.id, matchday },
    })
    if (matchesForMd.length === 0) continue
    const matchId = matchesForMd[0].id

    await prisma.rating.upsert({
      where: { matchId_playerId: { matchId, playerId: playerDbId } },
      create: {
        matchId,
        playerId: playerDbId,
        refScore: refScore ? parseInt(refScore, 10) : null,
        teamwork: teamwork ? parseInt(teamwork, 10) : null,
        enjoyment: enjoyment ? parseInt(enjoyment, 10) : null,
        gameCloseness: gameCloseness ? parseInt(gameCloseness, 10) : null,
      },
      update: {
        refScore: refScore ? parseInt(refScore, 10) : null,
        teamwork: teamwork ? parseInt(teamwork, 10) : null,
        enjoyment: enjoyment ? parseInt(enjoyment, 10) : null,
        gameCloseness: gameCloseness ? parseInt(gameCloseness, 10) : null,
      },
    })
  }

  console.log('\n✅ Import complete!')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
