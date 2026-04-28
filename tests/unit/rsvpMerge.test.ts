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
  // Same precedence rules as the v1.6.x dbToPublicLeagueData adapter.
  // PLAYED (admin-recorded fact) wins over RSVP (player intent).

  it('PLAYED takes precedence over GOING', () => {
    expect(mapAvailability({ rsvp: 'GOING', participated: 'JOINED' })).toBe('PLAYED')
  })

  it('maps GOING when only rsvp set', () => {
    expect(mapAvailability({ rsvp: 'GOING' })).toBe('GOING')
  })

  it('maps UNDECIDED when only rsvp UNDECIDED', () => {
    expect(mapAvailability({ rsvp: 'UNDECIDED' })).toBe('UNDECIDED')
  })

  it('returns null when entry is empty (player has no opinion yet)', () => {
    expect(mapAvailability({})).toBeNull()
  })

  it('returns null for NOT_GOING (so they do NOT show up in availability)', () => {
    expect(mapAvailability({ rsvp: 'NOT_GOING' })).toBeNull()
  })

  it('JOINED participated alone maps to PLAYED (admin recorded show-up sans RSVP)', () => {
    expect(mapAvailability({ participated: 'JOINED' })).toBe('PLAYED')
  })

  it('NO_SHOWED participated alone maps to null (no displayable signal)', () => {
    expect(mapAvailability({ participated: 'NO_SHOWED' })).toBeNull()
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

  it('builds team-keyed availability with PLAYED separated into played[]', () => {
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
    })

    expect(result.availability.md1).toEqual({
      'mariners-fc': ['ian-noseda', 'aleksandr-ivankov'],
      'fenix-fc': ['tomo-suzuki'],
    })
    expect(result.availabilityStatuses.md1).toEqual({
      'mariners-fc': {
        'ian-noseda': 'GOING',
        'aleksandr-ivankov': 'PLAYED',
      },
      'fenix-fc': {
        'tomo-suzuki': 'UNDECIDED',
      },
    })
    expect(result.played.md1).toEqual({
      'mariners-fc': ['aleksandr-ivankov'],
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
