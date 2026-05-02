import { unstable_cache } from 'next/cache'
import type { LeagueData } from '@/types'
import { fetchSheetData } from './sheets'
import { parseAllData } from './data'
import { dbToPublicLeagueData, type GameWeekMeta } from './dbToPublicLeagueData'
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
import { playerIdToSlug } from './ids'

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
 *
 * v1.14.0 — `getFromDb` now returns `{ data, gameWeeks }`. The DB-side
 * GameWeek metadata (id + weekNumber + startDate) the RSVP merge needs is
 * co-cached with the LeagueData blob, sharing the same Prisma round-trip
 * instead of running a separate `getDefaultLeagueGameWeeks` query.
 */

const getFromSheets = unstable_cache(
  async (): Promise<LeagueData> => parseAllData(await fetchSheetData()),
  ['public-data:sheets'],
  { revalidate: 300, tags: ['public-data', 'sheet-data'] },
)

const getFromDb = unstable_cache(
  // v1.23.0 — accepts optional leagueId so per-league caches are isolated.
  // When the param is undefined, the underlying adapter falls back to the
  // `isDefault: true` league. Next.js's unstable_cache automatically encodes
  // the parameters into the cache key, so calling `getFromDb()` and
  // `getFromDb('l-foo')` produce distinct cache entries.
  async (leagueId?: string) => dbToPublicLeagueData(leagueId),
  ['public-data:db'],
  { revalidate: 30, tags: ['public-data', 'leagues'] },
)

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
  gws: { id: string; startDate: Date | null }[],
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
    const slug = playerIdToSlug(row.playerId)
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
  gws: GameWeekMeta[],
): Promise<Pick<LeagueData, 'availability' | 'availabilityStatuses' | 'played'>> {
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
 * Returns the public `LeagueData` from the configured source.
 *
 * v1.23.0 — accepts optional `leagueId`. When supplied, scopes the read to
 * that league (per-league cache entry). When omitted, falls back to the
 * league flagged `isDefault: true` — preserves pre-v1.23.0 behavior. Apex
 * dashboard renders pass no argument; subdomain-aware consumers
 * (`/schedule`, `/stats`, `/assign-player`) resolve the leagueId via
 * `lib/getLeagueFromHost.ts#getLeagueIdFromRequest()` and pass it through.
 *
 * The Sheets path is single-league only (legacy). When `dataSource='sheets'`
 * the leagueId argument is ignored and the legacy default-league Sheets
 * data is returned regardless.
 *
 * v1.7.0 — On the DB path, the cached static blob and the live Redis RSVP
 * read run in parallel; merge produces the consumer-facing shape.
 */
export async function getPublicLeagueData(leagueId?: string): Promise<LeagueData> {
  const source = await getDataSource()
  if (source !== 'db') {
    return getFromSheets()
  }
  const { data: staticData, gameWeeks } = await getFromDb(leagueId)
  const rsvp = await getRsvpData(staticData, gameWeeks)
  return {
    ...staticData,
    availability: rsvp.availability,
    availabilityStatuses: rsvp.availabilityStatuses,
    played: rsvp.played,
  }
}

/**
 * Lighter validation read: returns just the player record without the RSVP
 * merge. Used by `/api/assign-player` POST to verify the targeted slug
 * exists in the active roster.
 *
 * v1.23.0 — accepts optional `leagueId` so subdomain-scoped link flows
 * validate against the per-subdomain league's roster, not the default
 * league. When omitted, falls back to default-league behavior.
 *
 * `getPublicLeagueData` always runs `getRsvpData()` (uncached, ~12 parallel
 * Upstash HGETALLs on the default league's GameWeeks) — that's load-bearing
 * for dashboard renders but pure overhead for write-path validation. v1.8.2
 * routes the route's player-existence check through this helper instead so
 * link / unlink avoid the RSVP fanout on every call.
 */
export async function getPlayerByPublicId(
  publicPlayerId: string,
  leagueId?: string,
): Promise<{ id: string; name: string; teamId: string } | null> {
  const source = await getDataSource()
  const players =
    source === 'db'
      ? (await getFromDb(leagueId)).data.players
      : (await getFromSheets()).players
  const player = players.find((p) => p.id === publicPlayerId)
  return player ? { id: player.id, name: player.name, teamId: player.teamId } : null
}
