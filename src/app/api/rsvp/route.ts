import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { writeRosterAvailability } from '@/lib/sheets'
import { getWriteMode } from '@/lib/settings'
import { prisma } from '@/lib/prisma'
import { setRsvp } from '@/lib/rsvpStore'
import type { RsvpStatus } from '@prisma/client'

type IncomingStatus = 'GOING' | 'UNDECIDED' | ''
const VALID_STATUSES: IncomingStatus[] = ['GOING', 'UNDECIDED', '']

const LEAGUE_ID = 'l-minato-2025' // default league; per-league RSVP routing is post-PR-5

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

  const writeMode = await getWriteMode()
  const dbStatus = mapStatusToDb(status as IncomingStatus)
  // session.playerId is the public slug (e.g. "ian-noseda"); DB ids carry "p-" prefix.
  const dbPlayerId = `p-${session.playerId}`

  // ── DB write (durable backup) + Redis pre-warm (canonical read store) ──
  // v1.7.0: Redis is the canonical read source for RSVP signals; Prisma is
  // the durable secondary that the recovery script rebuilds from. Both
  // writes run inside the same try block so a failure on either propagates
  // to the user — partial-write states must not survive.
  if (writeMode !== 'sheets-only') {
    try {
      const gameWeek = await prisma.gameWeek.findUnique({
        where: { leagueId_weekNumber: { leagueId: LEAGUE_ID, weekNumber } },
        select: { id: true, startDate: true },
      })
      if (!gameWeek) {
        return NextResponse.json(
          { error: `GameWeek not found for ${matchdayId} in ${LEAGUE_ID}` },
          { status: 404 },
        )
      }

      await prisma.availability.upsert({
        where: {
          playerId_gameWeekId: { playerId: dbPlayerId, gameWeekId: gameWeek.id },
        },
        create: {
          id: `av-${dbPlayerId}-${gameWeek.id}`,
          playerId: dbPlayerId,
          gameWeekId: gameWeek.id,
          rsvp: dbStatus.rsvp,
          // Don't touch participated on RSVP writes (admin-managed).
        },
        update: {
          rsvp: dbStatus.rsvp,
        },
      })

      // Redis write-through. Failure here does NOT roll back the Prisma
      // write — the rsvpStore swallows write errors internally (see
      // `setRsvp`) and logs. Worst case: the next dashboard render misses,
      // falls through to Prisma, and repopulates Redis with the canonical
      // value. Errors-not-rolled-back is the same pattern playerMappingStore
      // uses post-Prisma-write in v1.5.0.
      // session.playerId is the public slug — Redis keys by slug, not the
      // prefixed DB id (matches dbToPublicLeagueData's `players[].id` shape).
      await setRsvp(gameWeek.id, gameWeek.startDate, session.playerId, dbStatus.rsvp)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'rsvp-db-failed'
      console.error('[rsvp] DB write failed', { matchdayId, dbPlayerId, err: message })
      return NextResponse.json({ error: 'rsvp-db-failed', detail: message }, { status: 500 })
    }
  }

  // ── Sheets write (canonical pre-cutover; failure tolerated in dual mode) ──
  if (writeMode !== 'db-only') {
    try {
      await writeRosterAvailability(
        session.playerId,
        matchdayId.toLowerCase(),
        status as 'GOING' | 'UNDECIDED' | '',
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'sheets write failed'
      if (writeMode === 'sheets-only') {
        // No DB fallback in sheets-only mode → propagate failure to user.
        return NextResponse.json(
          { error: 'rsvp-sheets-failed', detail: message },
          { status: 500 },
        )
      }
      // dual mode: DB succeeded, Sheets failed. Log and continue. The next
      // backfill (or operator action) will reconcile.
      console.warn('[rsvp] Sheets write failed in dual mode; continuing', {
        matchdayId,
        playerId: session.playerId,
        err: message,
      })
    }
  }

  // v1.7.0 — RSVP no longer flows through the static `public-data` cache.
  // Reads are now Redis-direct via `lib/publicData.ts#getRsvpData`, which
  // is uncached. The `setRsvp` write above is read-your-own-writes
  // consistent without any cache-bust round-trip, so the prior
  // `revalidateTag('public-data', { expire: 0 })` + `revalidatePath('/')`
  // calls are removed.
  return NextResponse.json({ ok: true })
}
