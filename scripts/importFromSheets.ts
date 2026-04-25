import { google } from 'googleapis'
import { prisma } from '../src/lib/prisma'

// ── Config from env ────────────────────────────────────────────────────────────
const LEAGUE_SLUG = process.env.IMPORT_LEAGUE_SLUG ?? 't9l'
const LEAGUE_NAME = process.env.IMPORT_LEAGUE_NAME ?? 'Tennozu 9-Aside League'
const SHEET_ID    = process.env.GOOGLE_SHEETS_ID ?? process.env.GOOGLE_SHEET_ID ?? ''

if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
  console.error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY')
  process.exit(1)
}
if (!SHEET_ID) {
  console.error('Missing GOOGLE_SHEETS_ID (or GOOGLE_SHEET_ID)')
  process.exit(1)
}

// ── Sheets auth ────────────────────────────────────────────────────────────────
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key:  (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
})
const sheets = google.sheets({ version: 'v4', auth })

// ── Deterministic IDs ──────────────────────────────────────────────────────────
// Using these keeps re-runs idempotent — same inputs always produce same IDs.
function mkLeagueId(slug: string)                            { return `lg-${slug}` }
function mkTeamId(leagueSlug: string, sheetId: string)      { return `t-${leagueSlug}-${slugify(sheetId)}` }
function mkPlayerId(sheetId: string)                         { return `p-${slugify(sheetId)}` }
function mkMatchId(ls: string, md: number, h: string, a: string) {
  return `m-${ls}-md${md}-${slugify(h)}-vs-${slugify(a)}`
}
function mkGoalId(matchId: string, scorerSheet: string, n: number) {
  return `g-${matchId}-${slugify(scorerSheet)}-${n}`
}

function slugify(s: string) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ── Date normalisation ─────────────────────────────────────────────────────────
function parseDate(raw: string | undefined): Date | null {
  if (!raw?.trim()) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const d = new Date(`${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}T12:00:00Z`)
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
}

// ── Fetch all ranges in one batchGet ──────────────────────────────────────────
async function batchFetch(ranges: string[]): Promise<Map<string, string[][]>> {
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges })
  const map = new Map<string, string[][]>()
  ranges.forEach((r, i) => {
    map.set(r, (res.data.valueRanges?.[i]?.values ?? []) as string[][])
  })
  return map
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🏟  Import: ${LEAGUE_NAME} (${LEAGUE_SLUG})`)
  console.log(`📊  Sheet: ${SHEET_ID}\n`)

  console.log('Fetching all ranges via batchGet…')
  const data = await batchFetch(['Teams', 'Roster', 'Schedule', 'Goals', 'Ratings'])

  const teamRows     = data.get('Teams')?.slice(1)    ?? []
  const rosterRows   = data.get('Roster')?.slice(1)   ?? []
  const scheduleRows = data.get('Schedule')?.slice(1) ?? []
  const goalRows     = data.get('Goals')?.slice(1)    ?? []
  const ratingData   = data.get('Ratings')            ?? []

  // ── 1. Upsert League ───────────────────────────────────────────────────────
  const lgId = mkLeagueId(LEAGUE_SLUG)
  console.log('Upserting league…')
  await prisma.league.upsert({
    where:  { slug: LEAGUE_SLUG },
    create: { id: lgId, name: LEAGUE_NAME, slug: LEAGUE_SLUG },
    update: { name: LEAGUE_NAME },
  })
  console.log(`  ✓ ${LEAGUE_NAME} (id: ${lgId})`)

  // ── 2. Upsert Teams ────────────────────────────────────────────────────────
  // Teams cols: [0] sheetId, [1] name, [2] shortName, [3] color, [4] logoUrl
  console.log(`\nUpserting ${teamRows.length} team(s)…`)
  const teamMap = new Map<string, string>() // sheetId → DB id

  for (const row of teamRows) {
    const [sheetId, name, shortName, color, logoUrl] = row
    if (!sheetId || !name) continue
    const tId = mkTeamId(LEAGUE_SLUG, sheetId)
    teamMap.set(sheetId, tId)
    await prisma.team.upsert({
      where:  { id: tId },
      create: { id: tId, leagueId: lgId, name, shortName: shortName || null, color: color || null, logoUrl: logoUrl || null },
      update: { name, shortName: shortName || null, color: color || null, logoUrl: logoUrl || null },
    })
    console.log(`  ✓ Team: ${name} (${sheetId})`)
  }

  // ── 3. Upsert Players + PlayerTeam links ───────────────────────────────────
  // Roster cols: [0] sheetPlayerId, [1] name, [2] sheetTeamId, [3] position
  console.log(`\nUpserting ${rosterRows.length} player(s)…`)
  const playerMap = new Map<string, string>() // sheetPlayerId → DB id

  for (const row of rosterRows) {
    const [sheetPlayerId, playerName, sheetTeamId, position] = row
    if (!sheetPlayerId || !playerName) continue

    const pId = mkPlayerId(sheetPlayerId)
    playerMap.set(sheetPlayerId, pId)

    await prisma.player.upsert({
      where:  { id: pId },
      create: { id: pId, name: playerName },
      update: { name: playerName },
    })

    const tId = teamMap.get(sheetTeamId)
    if (tId) {
      const ptId = `pt-${pId}-${tId}`
      await prisma.playerTeam.upsert({
        where:  { id: ptId },
        create: { id: ptId, playerId: pId, teamId: tId, position: position || null, isActive: true },
        update: { position: position || null },
      })
    }
    console.log(`  ✓ Player: ${playerName}`)
  }

  // ── 4. Upsert Matches ──────────────────────────────────────────────────────
  // Schedule cols: [0] matchday, [1] date, [2] venue, [3] homeSheetId, [4] awaySheetId,
  //                [5] homeScore, [6] awayScore
  console.log(`\nUpserting ${scheduleRows.length} match(es)…`)
  const matchMap = new Map<string, string>() // sheetKey → DB id

  for (const row of scheduleRows) {
    const [mdRaw, dateRaw, venue, homeSheetId, awaySheetId, homeScoreRaw, awayScoreRaw] = row
    if (!mdRaw || !homeSheetId || !awaySheetId) continue

    const md       = parseInt(mdRaw.replace(/\D/g, ''), 10)
    const homeTId  = teamMap.get(homeSheetId)
    const awayTId  = teamMap.get(awaySheetId)
    if (!homeTId || !awayTId) {
      console.warn(`  ⚠ Match MD${md}: unknown team(s) ${homeSheetId} / ${awaySheetId}`)
      continue
    }

    const homeScore = homeScoreRaw !== undefined && homeScoreRaw !== '' ? parseInt(homeScoreRaw, 10) : null
    const awayScore = awayScoreRaw !== undefined && awayScoreRaw !== '' ? parseInt(awayScoreRaw, 10) : null
    const status    = homeScore !== null && awayScore !== null ? 'played' : 'scheduled'

    const mId  = mkMatchId(LEAGUE_SLUG, md, homeSheetId, awaySheetId)
    const mKey = `${md}-${homeSheetId}-${awaySheetId}`
    matchMap.set(mKey, mId)

    await prisma.match.upsert({
      where:  { id: mId },
      create: {
        id: mId, leagueId: lgId, matchday: md,
        homeTeamId: homeTId, awayTeamId: awayTId,
        date: parseDate(dateRaw), venue: venue || null,
        homeScore, awayScore, status,
      },
      update: { date: parseDate(dateRaw), homeScore, awayScore, status },
    })
    console.log(`  ✓ Match MD${md}: ${homeSheetId} vs ${awaySheetId}`)
  }

  // ── 5. Upsert Goals ────────────────────────────────────────────────────────
  // Goals cols: [0] matchday, [1] timestamp, [2] homeSheetId, [3] awaySheetId,
  //             [4] scorerSheetId, [5] assisterSheetId
  console.log(`\nUpserting ${goalRows.length} goal(s)…`)
  let goalsOk = 0
  const goalCounters = new Map<string, number>()

  for (const row of goalRows) {
    const [mdRaw, , homeSheetId, awaySheetId, scorerSheetId, assisterSheetId] = row
    if (!scorerSheetId) continue

    const md = parseInt((mdRaw ?? '').replace(/\D/g, ''), 10)
    if (!md) continue

    // Try both orderings to find the match
    const mKey    = `${md}-${homeSheetId}-${awaySheetId}`
    const mKeyAlt = `${md}-${awaySheetId}-${homeSheetId}`
    const mId     = matchMap.get(mKey) ?? matchMap.get(mKeyAlt)

    if (!mId) {
      console.warn(`  ⚠ Goal MD${md}: match not found (${homeSheetId} vs ${awaySheetId})`)
      continue
    }

    const sId = playerMap.get(scorerSheetId)
    if (!sId) {
      console.warn(`  ⚠ Goal MD${md}: scorer not found (${scorerSheetId})`)
      continue
    }
    const aId = assisterSheetId ? playerMap.get(assisterSheetId) : undefined

    const n   = (goalCounters.get(mId) ?? 0) + 1
    goalCounters.set(mId, n)
    const gId = mkGoalId(mId, scorerSheetId, n)

    await prisma.goal.upsert({
      where:  { id: gId },
      create: { id: gId, matchId: mId, scorerId: sId, assisterId: aId ?? null },
      update: { assisterId: aId ?? null },
    })
    goalsOk++
  }
  console.log(`  ✓ ${goalsOk} goal(s) upserted`)

  // ── 6. Upsert Ratings ─────────────────────────────────────────────────────
  // Ratings cols: [0] matchday, [1] sheetPlayerId, [2] refScore, [3] teamwork,
  //               [4] enjoyment, [5] gameCloseness
  const ratingRows = ratingData.slice(1)
  console.log(`\nUpserting ${ratingRows.length} rating row(s)…`)
  let ratingsOk = 0

  for (const row of ratingRows) {
    const [mdRaw, sheetPlayerId, refScoreRaw, teamworkRaw, enjoymentRaw, gameClosenessRaw] = row
    if (!sheetPlayerId) continue

    const md      = parseInt((mdRaw ?? '').replace(/\D/g, ''), 10)
    const pId     = playerMap.get(sheetPlayerId)
    if (!md || !pId) continue

    // Find any match in this matchday for this league
    const mId = [...matchMap.entries()]
      .find(([k]) => k.startsWith(`${md}-`))?.[1]
    if (!mId) continue

    const toInt = (v: string | undefined) => (v ? parseInt(v, 10) || null : null)

    await prisma.rating.upsert({
      where:  { matchId_playerId: { matchId: mId, playerId: pId } },
      create: {
        matchId: mId, playerId: pId,
        refScore: toInt(refScoreRaw), teamwork: toInt(teamworkRaw),
        enjoyment: toInt(enjoymentRaw), gameCloseness: toInt(gameClosenessRaw),
      },
      update: {
        refScore: toInt(refScoreRaw), teamwork: toInt(teamworkRaw),
        enjoyment: toInt(enjoymentRaw), gameCloseness: toInt(gameClosenessRaw),
      },
    })
    ratingsOk++
  }
  console.log(`  ✓ ${ratingsOk} rating record(s) upserted`)

  console.log('\n✅  Import complete.\n')
  await prisma.$disconnect()
}

main().catch(async err => {
  console.error('Import failed:', err)
  await prisma.$disconnect()
  process.exit(1)
})
