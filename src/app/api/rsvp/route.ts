import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { waitUntil } from '@vercel/functions'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { setRsvpOrThrow } from '@/lib/rsvpStore'
import { getDefaultLeagueId } from '@/lib/leagueSlugServer'
import type { RsvpStatus } from '@prisma/client'

type IncomingStatus = 'GOING' | 'UNDECIDED' | ''
const VALID_STATUSES: IncomingStatus[] = ['GOING', 'UNDECIDED', '']

/**
 * Map the public-API RSVP status string to the DB enum + JOINED reset.
 *
 * Pure function — exported for unit testing.
 *
 * Note: clearing an RSVP (`status: ''`) sets `rsvp: null`. It does NOT touch
 * `participated` — `PLAYED` is admin-managed (recorded after a match by admin),
 * not by the public RSVP flow. Setting `rsvp: null` while `participated:
 * 'JOINED'` exists means: "I've removed my future-RSVP signal, but the
 * historical record of my having played stays."
 */
export function mapStatusToDb(status: IncomingStatus): { rsvp: RsvpStatus | null } {
  if (status === 'GOING') return { rsvp: 'GOING' }
  if (status === 'UNDECIDED') return { rsvp: 'UNDECIDED' }
  return { rsvp: null }
}

/**
 * Match the public-side matchday id (e.g. "md3") to the DB GameWeek.weekNumber.
 * Returns null if the format is invalid.
 *
 * Pure function — exported for unit testing.
 *
 * Allows MD1..MD99 (vs the previous hardcoded MD1..MD8) so the MD9 e2e test
 * + future season expansion work without code changes.
 */
export function parseMatchdayId(matchdayId: string): number | null {
  const m = matchdayId.toLowerCase().match(/^md(\d{1,2})$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 99 ? n : null
}

// v1.8.0 — durable backup write for /api/rsvp POST.
//
// Pre-v1.8.0 the Prisma `availability.upsert` blocked the response (~1–3s
// on cold Neon plus cold-lambda overhead). v1.8.0 inverts the write path:
// Redis (`setRsvpOrThrow`) is the canonical store written synchronously,
// and this function runs in `waitUntil` so the response returns as soon as
// the Redis write lands (and the gameWeek lookup it requires).
//
// v1.71.0 — Sheets dual-write retired with the rest of the Sheets surface.
// Postgres is the only durable secondary now.
//
// On Prisma failure we emit a `[v1.8.0 DRIFT]` log. Operator recovery via
// `scripts/auditRedisVsPrisma.ts --repair-prisma`.
async function persistRsvpToPrisma(args: {
  gameWeekId: string
  dbPlayerId: string
  rsvp: RsvpStatus | null
  playerSlug: string
}): Promise<void> {
  const { gameWeekId, dbPlayerId, rsvp, playerSlug } = args
  try {
    await prisma.availability.upsert({
      where: {
        playerId_gameWeekId: { playerId: dbPlayerId, gameWeekId },
      },
      create: {
        id: `av-${dbPlayerId}-${gameWeekId}`,
        playerId: dbPlayerId,
        gameWeekId,
        rsvp,
        // Don't touch participated on RSVP writes (admin-managed).
      },
      update: {
        rsvp,
      },
    })
  } catch (err) {
    console.error(
      '[v1.8.0 DRIFT] kind=rsvp gw=%s player=%s rsvp=%s err=%o',
      gameWeekId,
      playerSlug,
      rsvp,
      err,
    )
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)

  if (!session?.playerId || !session?.teamId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const { matchdayId, status } = (body ?? {}) as {
    matchdayId?: string
    status?: string
  }

  if (!matchdayId || typeof matchdayId !== 'string' || !VALID_STATUSES.includes(status as IncomingStatus)) {
    return NextResponse.json(
      { error: "matchdayId and status ('GOING'|'UNDECIDED'|'') required" },
      { status: 400 },
    )
  }

  const weekNumber = parseMatchdayId(matchdayId)
  if (weekNumber === null) {
    return NextResponse.json({ error: 'Invalid matchdayId' }, { status: 400 })
  }

  // v1.53.0 — subdomain teardown. RSVPs always write to the default
  // league. Multi-league RSVPs are out of scope for v1; the path-based
  // routing (PRs 1-3) lets users navigate between leagues, but RSVP
  // writes stay default-only until a future PR adds league context to
  // the API request body. (Today only one league has public matchdays
  // anyway, so this matches the observed behavior.)
  const leagueId = await getDefaultLeagueId()
  if (!leagueId) {
    return NextResponse.json(
      { error: 'No default league configured' },
      { status: 404 },
    )
  }

  const dbStatus = mapStatusToDb(status as IncomingStatus)
  // session.playerId is the public slug (e.g. "ian-noseda"); DB ids carry "p-" prefix.
  const dbPlayerId = `p-${session.playerId}`

  // Redis canonical sync, Prisma deferred via waitUntil.
  // The gameWeek lookup stays synchronous because the Redis key shape and
  // TTL math both need `gameWeek.id` and `gameWeek.startDate`. Single keyed
  // findUnique — typically <200ms even cold.
  let gameWeek: { id: string; startDate: Date | null }
  try {
    const gw = await prisma.gameWeek.findUnique({
      where: { leagueId_weekNumber: { leagueId, weekNumber } },
      select: { id: true, startDate: true },
    })
    if (!gw) {
      return NextResponse.json(
        { error: `GameWeek not found for ${matchdayId} in ${leagueId}` },
        { status: 404 },
      )
    }
    gameWeek = gw

    // Canonical write — throwing variant so a Redis failure surfaces 500
    // (rather than 200-OK with no durable write landing anywhere, given
    // the Prisma upsert below is deferred).
    await setRsvpOrThrow(gameWeek.id, gameWeek.startDate, session.playerId, dbStatus.rsvp)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'rsvp-redis-failed'
    console.error('[rsvp] sync write failed', { matchdayId, dbPlayerId, err: message })
    return NextResponse.json({ error: 'rsvp-redis-failed', detail: message }, { status: 500 })
  }

  // Defer the Prisma upsert to background. The user's perceived latency is
  // bounded by the gameWeek findUnique + setRsvpOrThrow above; the durable
  // upsert lands after the response returns.
  waitUntil(
    persistRsvpToPrisma({
      gameWeekId: gameWeek.id,
      dbPlayerId,
      rsvp: dbStatus.rsvp,
      playerSlug: session.playerId,
    }),
  )

  // v1.7.0 — RSVP no longer flows through the static `public-data` cache.
  // Reads are now Redis-direct via `lib/publicData.ts#getRsvpData`, which
  // is uncached. The `setRsvpOrThrow` write above is read-your-own-writes
  // consistent without any cache-bust round-trip.
  return NextResponse.json({ ok: true })
}
