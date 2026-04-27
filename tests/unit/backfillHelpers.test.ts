import { describe, it, expect } from 'vitest'
import { ids, combineJstDateTime, slugify } from '../../scripts/sheetsToDbBackfill'

describe('backfill ID conventions', () => {
  it('league IDs follow l-<slug> shape (matches importFromSheets)', () => {
    expect(ids.league('minato-2025')).toBe('l-minato-2025')
  })

  it('team IDs follow t-<slug> shape', () => {
    expect(ids.team('mariners-fc')).toBe('t-mariners-fc')
  })

  it('league-team IDs are scoped to (league, team)', () => {
    expect(ids.leagueTeam('minato-2025', 'mariners-fc')).toBe('lt-minato-2025-mariners-fc')
  })

  it('player IDs follow p-<slug>', () => {
    expect(ids.player('ian-noseda')).toBe('p-ian-noseda')
  })

  it('match IDs encode (league, week, home-vs-away)', () => {
    expect(ids.match('minato-2025', 3, 'mariners-fc', 'fenix-fc')).toBe(
      'm-minato-2025-wk3-mariners-fc-vs-fenix-fc',
    )
  })

  it('goal IDs include slot for same-player-multi-goals-same-match', () => {
    const matchId = 'm-x-wk1-a-vs-b'
    expect(ids.goal(matchId, 'a', 'p-1', 0)).toBe('g-m-x-wk1-a-vs-b-a-p-1-0')
    expect(ids.goal(matchId, 'a', 'p-1', 1)).toBe('g-m-x-wk1-a-vs-b-a-p-1-1')
    expect(ids.goal(matchId, 'a', 'p-1', 0)).not.toBe(ids.goal(matchId, 'a', 'p-1', 1))
  })

  it('assist IDs are 1:1 with goal IDs', () => {
    expect(ids.assist('g-foo')).toBe('a-g-foo')
  })
})

describe('combineJstDateTime', () => {
  it('combines date + time into a JST-anchored Date', () => {
    const d = combineJstDateTime('2026-04-03', '19:00')
    expect(d).not.toBeNull()
    // 19:00 JST = 10:00 UTC
    expect(d!.toISOString()).toBe('2026-04-03T10:00:00.000Z')
  })

  it('treats missing time as 00:00 (matchday-level dates)', () => {
    const d = combineJstDateTime('2026-04-03', null)
    expect(d).not.toBeNull()
    expect(d!.toISOString()).toBe('2026-04-02T15:00:00.000Z') // 00:00 JST = 15:00 UTC prior day
  })

  it('returns null when date is null (no schedule recorded)', () => {
    expect(combineJstDateTime(null, '19:00')).toBeNull()
  })

  it('rejects garbage time strings rather than crashing', () => {
    const d = combineJstDateTime('2026-04-03', 'TBD')
    // Falls back to 00:00 on invalid time
    expect(d).not.toBeNull()
    expect(d!.toISOString()).toBe('2026-04-02T15:00:00.000Z')
  })

  it('pads single-digit hour correctly', () => {
    const d = combineJstDateTime('2026-04-03', '7:30')
    expect(d).not.toBeNull()
    expect(d!.toISOString()).toBe('2026-04-02T22:30:00.000Z') // 07:30 JST = 22:30 UTC prior day
  })
})

describe('slugify (backfill copy)', () => {
  it('matches the public-side slugify shape exactly', () => {
    expect(slugify('Mariners FC')).toBe('mariners-fc')
    expect(slugify('Ian Noseda')).toBe('ian-noseda')
    // Apostrophes are stripped — must NOT become a dash, otherwise DB-side
    // slugs ("o-brien") wouldn't match Sheets-side ids ("obrien") and the
    // consumer-keyed `player.id` would mismatch between source modes.
    expect(slugify("O'Brien")).toBe('obrien')
  })

  it('strips diacritics like the public side', () => {
    expect(slugify('Pelé')).toBe('pele')
  })
})
