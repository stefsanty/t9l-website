/**
 * Merge live RSVP signals (Redis canonical via `rsvpStore.ts`) into the
 * static `LeagueData` shape produced by `dbToPublicLeagueData.ts`. Pure —
 * no I/O, no Prisma, no Redis. Tested in isolation.
 *
 * Architectural framing (PR 19 / v1.7.0):
 *   The static `LeagueData` no longer carries availability/availabilityStatuses/played
 *   on the DB read path; those fields are computed here from the RSVP map
 *   keyed by gameWeekId. Consumers see the same shape they always did —
 *   the construction is split between cached static reads and uncached
 *   live RSVP reads.
 */

import type {
  Availability,
  AvailabilityStatuses,
  PlayedStatus,
  Player,
  Matchday,
} from '@/types'
import type { GwRsvpMap, RsvpEntry } from './rsvpStore'

export type AvStatus = 'Y' | 'EXPECTED' | 'PLAYED' | 'GOING' | 'UNDECIDED'

/**
 * Map a single RsvpEntry to the public-side AvStatus the dashboard expects,
 * or `null` if the player has no displayable signal for this matchday.
 *
 * v2.2.6 — "Going = Played" simplification. A `GOING` RSVP on a matchday
 * whose JST date has fully elapsed renders as `'PLAYED'`. The pre-v2.2.6
 * source of `'PLAYED'` (admin-recorded `participated === 'JOINED'`) is no
 * longer the determining factor; `participated` writes still happen on
 * admin paths but are vestigial for display purposes. NOT_GOING and
 * missing/empty signals collapse to null — they don't appear in the
 * availability list.
 *
 * Pure — exported for unit testing.
 */
export function mapAvailability(entry: RsvpEntry, isPast: boolean): AvStatus | null {
  if (entry.rsvp === 'GOING') return isPast ? 'PLAYED' : 'GOING'
  if (entry.rsvp === 'UNDECIDED') return 'UNDECIDED'
  return null
}

/**
 * Build the (availability, availabilityStatuses, played) triplet from per-
 * GameWeek RSVP maps. The `gameWeekIdToMatchdayId` argument lets callers
 * key the output by the public matchday id (`md1`, `md2`...) regardless of
 * how Redis keys things internally.
 *
 * `players` is the canonical static player list from `LeagueData.players`;
 * its `id` (slug) and `teamId` are looked up to project each Redis entry
 * onto the team-keyed shape that consumer components expect.
 *
 * Pure — exported for unit testing.
 */
export function mergeRsvpData(args: {
  rsvpByGameWeekId: Map<string, GwRsvpMap>
  gameWeekIdToMatchdayId: Map<string, string>
  players: Player[]
  // v2.2.6 — matchday ids whose JST date has fully elapsed. Going RSVPs in
  // these matchdays render as 'PLAYED'. Built in `publicData.ts` from the
  // static `matchdays[].date` comparison against `formatJstDate(now)`.
  pastMatchdayIds?: Set<string>
}): {
  availability: Availability
  availabilityStatuses: AvailabilityStatuses
  played: PlayedStatus
} {
  const { rsvpByGameWeekId, gameWeekIdToMatchdayId, players, pastMatchdayIds } = args

  // playerSlug → teamSlug index for O(1) team lookup during projection.
  const teamByPlayer = new Map<string, string>()
  for (const p of players) {
    teamByPlayer.set(p.id, p.teamId)
  }

  const availability: Availability = {}
  const availabilityStatuses: AvailabilityStatuses = {}
  const played: PlayedStatus = {}

  for (const [gwId, rsvpMap] of rsvpByGameWeekId) {
    const mdId = gameWeekIdToMatchdayId.get(gwId)
    if (!mdId) continue

    const isPast = pastMatchdayIds?.has(mdId) ?? false
    for (const [playerSlug, entry] of rsvpMap) {
      const status = mapAvailability(entry, isPast)
      if (!status) continue
      const teamSlug = teamByPlayer.get(playerSlug)
      if (!teamSlug) continue

      if (!availability[mdId]) availability[mdId] = {}
      if (!availability[mdId][teamSlug]) availability[mdId][teamSlug] = []
      availability[mdId][teamSlug].push(playerSlug)

      if (!availabilityStatuses[mdId]) availabilityStatuses[mdId] = {}
      if (!availabilityStatuses[mdId][teamSlug])
        availabilityStatuses[mdId][teamSlug] = {}
      availabilityStatuses[mdId][teamSlug][playerSlug] = status

      if (status === 'PLAYED') {
        if (!played[mdId]) played[mdId] = {}
        if (!played[mdId][teamSlug]) played[mdId][teamSlug] = []
        played[mdId][teamSlug].push(playerSlug)
      }
    }
  }

  return { availability, availabilityStatuses, played }
}

/**
 * Build the (gameWeekId → matchdayId) lookup from the static matchdays the
 * dispatcher is rendering. Convenience helper — the dispatcher knows the
 * mapping at the point where it has both the GameWeek list and the
 * matchdays array.
 *
 * Note: `Matchday.id` is `md<weekNumber>`; we recover the weekNumber from
 * the suffix and find the matching GameWeek by weekNumber.
 */
export function buildGwToMdMap(
  gws: { id: string; weekNumber: number }[],
  matchdays: Matchday[],
): Map<string, string> {
  const map = new Map<string, string>()
  const mdByWeek = new Map<number, string>()
  for (const md of matchdays) {
    const m = md.id.match(/^md(\d+)$/)
    if (m) mdByWeek.set(parseInt(m[1], 10), md.id)
  }
  for (const gw of gws) {
    const mdId = mdByWeek.get(gw.weekNumber)
    if (mdId) map.set(gw.id, mdId)
  }
  return map
}

/**
 * v2.2.7 — derive the set of matchday ids whose kickoff has already occurred.
 *
 * Cutoff is `gw.startDate < now` (precise instant), not JST midnight: the
 * moment the match kicks off, the result is locked and GOING flips to PLAYED.
 * Example: matchday with `startDate = 2026-04-05T19:00:00+09:00` is still
 * upcoming at 13:00 JST that day, and becomes past at 19:01.
 *
 * `gws[].startDate` is `Date | null`; nulls (TBD matchdays) are never past.
 *
 * Pure — exported for unit testing.
 */
export function computePastMatchdayIds(
  gws: { id: string; weekNumber: number; startDate: Date | null }[],
  matchdays: Matchday[],
  now: Date,
): Set<string> {
  const mdByWeek = new Map<number, string>()
  for (const md of matchdays) {
    const m = md.id.match(/^md(\d+)$/)
    if (m) mdByWeek.set(parseInt(m[1], 10), md.id)
  }
  const past = new Set<string>()
  for (const gw of gws) {
    if (gw.startDate === null) continue
    if (gw.startDate >= now) continue
    const mdId = mdByWeek.get(gw.weekNumber)
    if (mdId) past.add(mdId)
  }
  return past
}
