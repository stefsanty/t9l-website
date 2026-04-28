import { unstable_cache } from 'next/cache'
import type { LeagueData } from '@/types'
import { fetchSheetData } from './sheets'
import { parseAllData } from './data'
import { dbToPublicLeagueData } from './dbToPublicLeagueData'
import { getDataSource } from './settings'
import { prisma } from './prisma'
import {
  getRsvpForGameWeeks,
  setRsvp,
  setParticipated,
  seedGameWeek,
  type GwRsvpMap,
  type RsvpReadResult,
} from './rsvpStore'
import { mergeRsvpData, buildGwToMdMap } from './rsvpMerge'

/**
 * Two separately-cached source readers + a dispatcher.
 *
 * Per the migration plan (§4 C5), `unstable_cache` keys must be statically
 * known at the call site — we can't read `dataSource` from the DB and feed it
 * as a key. So define one cache wrapper per source; the dispatcher decides
 * which to invoke.
 *
 * v1.7.0 — RSVP signals (availability / availabilityStatuses / played on the
 * DB path) are no longer part of the cached static read. They're sourced
 * from Redis at dispatch time via `getRsvpData()` and merged into the same
 * `LeagueData` shape consumers expect. RSVP writes are read-your-own-writes
 * consistent without a cache-bust round-trip.
 */

const PLAYER_ID_PREFIX = 'p-'

const getFromSheets = unstable_cache(
  async (): Promise<LeagueData> => parseAllData(await fetchSheetData()),
  ['public-data:sheets'],
  { revalidate: 300, tags: ['public-data', 'sheet-data'] },
)

const getFromDb = unstable_cache(
  async (): Promise<LeagueData> => dbToPublicLeagueData(),
  ['public-data:db'],
  { revalidate: 30, tags: ['public-data', 'leagues'] },
)

/**
 * Cached projection of the Default League's GameWeek list — just the fields
 * we need to bridge Redis (keys by gameWeekId) and the public matchday id
 * shape (`md<weekNumber>`). Cached separately from the full LeagueData so
 * the RSVP merge can run without re-deriving the entire blob.
 *
 * Same TTL as `getFromDb`. Both share the `leagues` tag so admin actions
 * that mutate the GameWeek list (createGameWeek / deleteGameWeek) bust both
 * caches together.
 */
const getDefaultLeagueGameWeeks = unstable_cache(
  async (): Promise<{ id: string; weekNumber: number; startDate: Date }[]> => {
    const league = await prisma.league.findFirst({
      where: { isDefault: true },
      select: {
        gameWeeks: {
          select: { id: true, weekNumber: true, startDate: true },
          orderBy: { weekNumber: 'asc' },
        },
      },
    })
    return league?.gameWeeks ?? []
  },
  ['public-data:db:gameweeks'],
  { revalidate: 30, tags: ['public-data', 'leagues'] },
)

function stripPrefix(id: string, prefix: string): string {
  return id.startsWith(prefix) ? id.slice(prefix.length) : id
}

/**
 * For each GameWeek where the Redis read missed, fall back to Prisma
 * `Availability` and pre-warm Redis with the result so the next request
 * hits the store directly. Mirrors the v1.5.0 pattern in `lib/auth.ts`
 * (`getPlayerMapping`'s error branch falls through to Prisma + writes back).
 *
 * `error` reads do NOT trigger a write-back — the Upstash channel is in a
 * suspect state and we'd rather serve stale-but-consistent than risk
 * corrupting the canonical store on a half-broken connection.
 */
async function backfillMissesFromPrisma(
  gws: { id: string; startDate: Date }[],
  reads: Map<string, RsvpReadResult>,
): Promise<Map<string, GwRsvpMap>> {
  const result = new Map<string, GwRsvpMap>()
  const missGwIds: string[] = []
  const errorGwIds: string[] = []

  for (const gw of gws) {
    const r = reads.get(gw.id)
    if (!r) continue
    if (r.status === 'hit') {
      result.set(gw.id, r.data)
    } else if (r.status === 'miss') {
      missGwIds.push(gw.id)
    } else {
      errorGwIds.push(gw.id)
    }
  }

  if (missGwIds.length === 0 && errorGwIds.length === 0) {
    return result
  }

  // Single Prisma query for both miss and error sets — same shape, different
  // post-processing (miss → write-back to Redis, error → no write-back).
  const fallbackGwIds = [...missGwIds, ...errorGwIds]
  if (fallbackGwIds.length === 0) return result

  const rows = await prisma.availability.findMany({
    where: { gameWeekId: { in: fallbackGwIds } },
    select: {
      gameWeekId: true,
      playerId: true,
      rsvp: true,
      participated: true,
    },
  })

  const byGw = new Map<string, GwRsvpMap>()
  for (const gwId of fallbackGwIds) byGw.set(gwId, new Map())
  for (const row of rows) {
    const m = byGw.get(row.gameWeekId)
    if (!m) continue
    const slug = stripPrefix(row.playerId, PLAYER_ID_PREFIX)
    m.set(slug, {
      rsvp: row.rsvp ?? undefined,
      participated: row.participated ?? undefined,
    })
  }

  for (const [gwId, map] of byGw) {
    result.set(gwId, map)
  }

  // Pre-warm Redis for the miss set only. Each entry is a separate
  // setRsvp/setParticipated call; with ~30 players × N missing GameWeeks
  // this is one-time-per-cold-cache cost. Skipped on error reads to avoid
  // amplifying an Upstash blip into a write storm against the same
  // unhealthy endpoint.
  if (missGwIds.length > 0) {
    const missGwById = new Map(gws.map((gw) => [gw.id, gw]))
    await Promise.all(
      missGwIds.flatMap((gwId) => {
        const gw = missGwById.get(gwId)
        const map = byGw.get(gwId)
        if (!gw || !map) return []
        // Empty Prisma result for this GW → mark Redis seeded so the next
        // read returns hit-with-empty instead of looping back through this
        // miss path. Per-player writes for non-empty maps already assert
        // the sentinel internally.
        if (map.size === 0) {
          return [seedGameWeek(gw.id, gw.startDate)]
        }
        const writes: Promise<void>[] = []
        for (const [slug, entry] of map) {
          if (entry.rsvp !== undefined) {
            writes.push(setRsvp(gw.id, gw.startDate, slug, entry.rsvp))
          }
          if (entry.participated !== undefined) {
            writes.push(setParticipated(gw.id, gw.startDate, slug, entry.participated))
          }
        }
        return writes
      }),
    )
  }

  return result
}

/**
 * Read the live RSVP signals for the Default League and merge them into the
 * static `LeagueData` shape. Uncached on purpose — the Redis call is cheap
 * (one HGETALL per GameWeek, parallel), and RSVP writes need
 * read-your-own-writes consistency without a cache-bust round-trip.
 */
async function getRsvpData(
  staticData: LeagueData,
): Promise<Pick<LeagueData, 'availability' | 'availabilityStatuses' | 'played'>> {
  const gws = await getDefaultLeagueGameWeeks()
  if (gws.length === 0) {
    return { availability: {}, availabilityStatuses: {}, played: {} }
  }

  const reads = await getRsvpForGameWeeks(
    gws.map((gw) => ({ id: gw.id, startDate: gw.startDate })),
  )
  const rsvpByGameWeekId = await backfillMissesFromPrisma(
    gws.map((gw) => ({ id: gw.id, startDate: gw.startDate })),
    reads,
  )

  const gameWeekIdToMatchdayId = buildGwToMdMap(gws, staticData.matchdays)
  return mergeRsvpData({
    rsvpByGameWeekId,
    gameWeekIdToMatchdayId,
    players: staticData.players,
  })
}

/**
 * Returns the public `LeagueData` from the configured source. Default
 * (`Setting.public.dataSource`) is `'sheets'` — preserves existing behavior
 * until the operator flips the toggle in admin Settings (PR 3 lands the UI;
 * PR 4 is the operational flip).
 *
 * v1.7.0 — On the DB path, the cached static blob and the live Redis RSVP
 * read run in parallel; merge produces the consumer-facing shape. The
 * Sheets path is unchanged — RSVP for that path comes from RosterRaw
 * cells, parsed inline.
 */
export async function getPublicLeagueData(): Promise<LeagueData> {
  const source = await getDataSource()
  if (source !== 'db') {
    return getFromSheets()
  }
  const staticData = await getFromDb()
  const rsvp = await getRsvpData(staticData)
  return {
    ...staticData,
    availability: rsvp.availability,
    availabilityStatuses: rsvp.availabilityStatuses,
    played: rsvp.played,
  }
}
