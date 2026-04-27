import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { revalidatePath, revalidateTag } from 'next/cache'
import { authOptions } from '@/lib/auth'
import { writeRosterAvailability } from '@/lib/sheets'
import { getWriteMode } from '@/lib/settings'
import { prisma } from '@/lib/prisma'
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

  // ── DB write (canonical post-cutover; runs first so failures fail fast) ──
  if (writeMode !== 'sheets-only') {
    try {
      const gameWeek = await prisma.gameWeek.findUnique({
        where: { leagueId_weekNumber: { leagueId: LEAGUE_ID, weekNumber } },
        select: { id: true },
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

  // ── Cache invalidation ──
  // revalidateTag busts the public-data dispatcher cache (both sheets + db
  // sources share the tag). Next 16 requires a second arg — `expire: 0` means
  // "treat as expired now". revalidatePath also kept for the existing /-page
  // legacy behavior; harmless if redundant.
  revalidateTag('public-data', { expire: 0 })
  revalidatePath('/')
  return NextResponse.json({ ok: true })
}
