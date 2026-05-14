import { describe, it, expect } from 'vitest'
import { mapAvailability, mergeRsvpData, buildGwToMdMap } from '@/lib/rsvpMerge'
import type { Player, Matchday } from '@/types'
import type { GwRsvpMap } from '@/lib/rsvpStore'

const PLAYERS: Player[] = [
  { id: 'ian-noseda', name: 'Ian Noseda', teamId: 'mariners-fc', position: 'MF', picture: null },
  { id: 'aleksandr-ivankov', name: 'Aleksandr Ivankov', teamId: 'mariners-fc', position: 'DF', picture: null },
  { id: 'tomo-suzuki', name: 'Tomo Suzuki', teamId: 'fenix-fc', position: 'FWD', picture: null },
]

const MATCHDAYS: Matchday[] = [
  { id: 'md1', label: 'MD1', date: '2026-04-05', matches: [], sittingOutTeamId: '' },
  { id: 'md2', label: 'MD2', date: '2026-04-12', matches: [], sittingOutTeamId: '' },
]

describe('mapAvailability — RsvpEntry → AvStatus', () => {
  // v2.2.6 — "Going = Played" simplification. GOING + past JST date → PLAYED.
  // `participated` field is vestigial for display.

  it('past matchday + GOING → PLAYED', () => {
    expect(mapAvailability({ rsvp: 'GOING' }, true)).toBe('PLAYED')
  })

  it('future matchday + GOING → GOING (unchanged)', () => {
    expect(mapAvailability({ rsvp: 'GOING' }, false)).toBe('GOING')
  })

  it('past matchday + NOT_GOING → null (unchanged)', () => {
    expect(mapAvailability({ rsvp: 'NOT_GOING' }, true)).toBeNull()
  })

  it('past matchday + UNDECIDED → UNDECIDED (unchanged)', () => {
    expect(mapAvailability({ rsvp: 'UNDECIDED' }, true)).toBe('UNDECIDED')
  })

  it('future matchday + UNDECIDED → UNDECIDED', () => {
    expect(mapAvailability({ rsvp: 'UNDECIDED' }, false)).toBe('UNDECIDED')
  })

  it('returns null when entry is empty (player has no opinion yet)', () => {
    expect(mapAvailability({}, false)).toBeNull()
    expect(mapAvailability({}, true)).toBeNull()
  })

  it('participated is vestigial — JOINED alone (no rsvp) → null', () => {
    // Pre-v2.2.6 this would have returned 'PLAYED'. The new rule ignores
    // `participated` for display; only `rsvp` + past-flag drive output.
    expect(mapAvailability({ participated: 'JOINED' }, true)).toBeNull()
    expect(mapAvailability({ participated: 'JOINED' }, false)).toBeNull()
  })

  it('participated is vestigial — GOING + JOINED on future matchday → GOING (not PLAYED)', () => {
    expect(mapAvailability({ rsvp: 'GOING', participated: 'JOINED' }, false)).toBe('GOING')
  })
})

describe('buildGwToMdMap — GameWeek id ↔ matchday id', () => {
  it('maps gameWeek.id to mdN by weekNumber', () => {
    const m = buildGwToMdMap(
      [
        { id: 'cuid-1', weekNumber: 1 },
        { id: 'cuid-2', weekNumber: 2 },
      ],
      MATCHDAYS,
    )
    expect(m.get('cuid-1')).toBe('md1')
    expect(m.get('cuid-2')).toBe('md2')
  })

  it('omits GameWeeks whose weekNumber has no matching matchday entry', () => {
    const m = buildGwToMdMap(
      [{ id: 'cuid-99', weekNumber: 99 }],
      MATCHDAYS,
    )
    expect(m.has('cuid-99')).toBe(false)
  })
})

describe('mergeRsvpData — Redis → LeagueData availability shape', () => {
  function rsvp(...entries: [string, { rsvp?: string; participated?: string }][]): GwRsvpMap {
    return new Map(entries.map(([slug, e]) => [slug, e as Parameters<typeof mapAvailability>[0]]))
  }

  it('future matchday — GOING stays GOING, played[] is empty', () => {
    const result = mergeRsvpData({
      rsvpByGameWeekId: new Map([
        [
          'gw-1',
          rsvp(
            ['ian-noseda', { rsvp: 'GOING' }],
            ['aleksandr-ivankov', { rsvp: 'GOING', participated: 'JOINED' }],
            ['tomo-suzuki', { rsvp: 'UNDECIDED' }],
          ),
        ],
      ]),
      gameWeekIdToMatchdayId: new Map([['gw-1', 'md1']]),
      players: PLAYERS,
      // pastMatchdayIds omitted → defaults to empty set (all future)
    })

    expect(result.availability.md1).toEqual({
      'mariners-fc': ['ian-noseda', 'aleksandr-ivankov'],
      'fenix-fc': ['tomo-suzuki'],
    })
    expect(result.availabilityStatuses.md1).toEqual({
      'mariners-fc': {
        'ian-noseda': 'GOING',
        'aleksandr-ivankov': 'GOING',
      },
      'fenix-fc': {
        'tomo-suzuki': 'UNDECIDED',
      },
    })
    expect(result.played.md1 ?? {}).toEqual({})
  })

  it('past matchday — GOING flips to PLAYED and lands in played[]', () => {
    const result = mergeRsvpData({
      rsvpByGameWeekId: new Map([
        [
          'gw-1',
          rsvp(
            ['ian-noseda', { rsvp: 'GOING' }],
            ['tomo-suzuki', { rsvp: 'UNDECIDED' }],
          ),
        ],
      ]),
      gameWeekIdToMatchdayId: new Map([['gw-1', 'md1']]),
      players: PLAYERS,
      pastMatchdayIds: new Set(['md1']),
    })

    expect(result.availabilityStatuses.md1).toEqual({
      'mariners-fc': { 'ian-noseda': 'PLAYED' },
      'fenix-fc': { 'tomo-suzuki': 'UNDECIDED' },
    })
    expect(result.played.md1).toEqual({
      'mariners-fc': ['ian-noseda'],
    })
  })

  it('drops NOT_GOING entries entirely (no team key created from them)', () => {
    const result = mergeRsvpData({
      rsvpByGameWeekId: new Map([
        ['gw-1', rsvp(['ian-noseda', { rsvp: 'NOT_GOING' }])],
      ]),
      gameWeekIdToMatchdayId: new Map([['gw-1', 'md1']]),
      players: PLAYERS,
    })

    expect(result.availability).toEqual({})
    expect(result.availabilityStatuses).toEqual({})
    expect(result.played).toEqual({})
  })

  it('drops entries for unknown players (player not in the static list)', () => {
    // Player has been removed from the league but Redis still has the
    // entry — defensively skip rather than crash.
    const result = mergeRsvpData({
      rsvpByGameWeekId: new Map([
        ['gw-1', rsvp(['ghost-player', { rsvp: 'GOING' }])],
      ]),
      gameWeekIdToMatchdayId: new Map([['gw-1', 'md1']]),
      players: PLAYERS,
    })

    expect(result.availability).toEqual({})
  })

  it('drops gameWeekIds not in the matchday map (orphan Redis entries)', () => {
    const result = mergeRsvpData({
      rsvpByGameWeekId: new Map([
        ['gw-deleted', rsvp(['ian-noseda', { rsvp: 'GOING' }])],
      ]),
      gameWeekIdToMatchdayId: new Map(), // empty: gw-deleted has no md mapping
      players: PLAYERS,
    })

    expect(result.availability).toEqual({})
  })

  it('returns empty objects for an empty rsvpByGameWeekId map', () => {
    const result = mergeRsvpData({
      rsvpByGameWeekId: new Map(),
      gameWeekIdToMatchdayId: new Map(),
      players: PLAYERS,
    })
    expect(result.availability).toEqual({})
    expect(result.availabilityStatuses).toEqual({})
    expect(result.played).toEqual({})
  })

  it('handles multiple matchdays independently', () => {
    const result = mergeRsvpData({
      rsvpByGameWeekId: new Map([
        ['gw-1', rsvp(['ian-noseda', { rsvp: 'GOING' }])],
        ['gw-2', rsvp(['ian-noseda', { rsvp: 'UNDECIDED' }])],
      ]),
      gameWeekIdToMatchdayId: new Map([
        ['gw-1', 'md1'],
        ['gw-2', 'md2'],
      ]),
      players: PLAYERS,
    })

    expect(result.availabilityStatuses.md1?.['mariners-fc']?.['ian-noseda']).toBe('GOING')
    expect(result.availabilityStatuses.md2?.['mariners-fc']?.['ian-noseda']).toBe('UNDECIDED')
  })
})
