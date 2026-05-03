import { describe, expect, it } from 'vitest'
import {
  computeScoreFromEvents,
  parseScoreOverride,
  resolveDisplayScore,
  type EventForScore,
} from '@/lib/matchScore'

const HOME = 'lt-home'
const AWAY = 'lt-away'
const STRANGER = 'lt-stranger'

function lookup(...rows: Array<[string, string]>) {
  return new Map<string, string>(rows)
}

describe('computeScoreFromEvents', () => {
  it('returns 0-0 for no events', () => {
    expect(
      computeScoreFromEvents(HOME, AWAY, [], lookup()),
    ).toEqual({ home: 0, away: 0 })
  })

  it('counts an OPEN_PLAY goal toward the scorer’s team', () => {
    const events: EventForScore[] = [
      { scorerId: 'p-stefan', goalType: 'OPEN_PLAY' },
    ]
    expect(
      computeScoreFromEvents(HOME, AWAY, events, lookup(['p-stefan', HOME])),
    ).toEqual({ home: 1, away: 0 })
  })

  it('counts SET_PIECE / PENALTY identically to OPEN_PLAY for the scorer’s team', () => {
    const events: EventForScore[] = [
      { scorerId: 'p-a', goalType: 'OPEN_PLAY' },
      { scorerId: 'p-b', goalType: 'SET_PIECE' },
      { scorerId: 'p-c', goalType: 'PENALTY' },
    ]
    expect(
      computeScoreFromEvents(
        HOME,
        AWAY,
        events,
        lookup(['p-a', HOME], ['p-b', AWAY], ['p-c', AWAY]),
      ),
    ).toEqual({ home: 1, away: 2 })
  })

  it('OWN_GOAL flips to the OPPOSITE team', () => {
    const events: EventForScore[] = [
      { scorerId: 'p-og-home', goalType: 'OWN_GOAL' },
    ]
    // scorer is on HOME; OG benefits AWAY
    expect(
      computeScoreFromEvents(HOME, AWAY, events, lookup(['p-og-home', HOME])),
    ).toEqual({ home: 0, away: 1 })
    // and the symmetric case
    expect(
      computeScoreFromEvents(HOME, AWAY, events, lookup(['p-og-home', AWAY])),
    ).toEqual({ home: 1, away: 0 })
  })

  it('mixes regular and own goals into the right tallies', () => {
    const events: EventForScore[] = [
      { scorerId: 'p-home-1', goalType: 'OPEN_PLAY' }, // home + 1
      { scorerId: 'p-home-2', goalType: 'PENALTY' }, // home + 1
      { scorerId: 'p-home-1', goalType: 'OWN_GOAL' }, // away + 1 (home player conceding)
      { scorerId: 'p-away-1', goalType: 'OPEN_PLAY' }, // away + 1
    ]
    expect(
      computeScoreFromEvents(
        HOME,
        AWAY,
        events,
        lookup(
          ['p-home-1', HOME],
          ['p-home-2', HOME],
          ['p-away-1', AWAY],
        ),
      ),
    ).toEqual({ home: 2, away: 2 })
  })

  it('skips events whose scorer cannot be resolved to a team', () => {
    const events: EventForScore[] = [
      { scorerId: 'p-orphan', goalType: 'OPEN_PLAY' },
      { scorerId: 'p-real', goalType: 'OPEN_PLAY' },
    ]
    expect(
      computeScoreFromEvents(HOME, AWAY, events, lookup(['p-real', HOME])),
    ).toEqual({ home: 1, away: 0 })
  })

  it('skips events whose scorer is on a third team (defensive against admin error)', () => {
    const events: EventForScore[] = [
      { scorerId: 'p-stranger', goalType: 'OPEN_PLAY' },
      { scorerId: 'p-stranger', goalType: 'OWN_GOAL' },
    ]
    expect(
      computeScoreFromEvents(
        HOME,
        AWAY,
        events,
        lookup(['p-stranger', STRANGER]),
      ),
    ).toEqual({ home: 0, away: 0 })
  })

  it('treats a null goalType as a non-own-goal (counts toward scorer team)', () => {
    // Defensive — schema lets goalType be null for forward-compat with
    // future EventKinds. For kind=GOAL the admin actions will require a
    // non-null goalType, but the helper itself shouldn’t crash on null.
    const events: EventForScore[] = [
      { scorerId: 'p-a', goalType: null },
    ]
    expect(
      computeScoreFromEvents(HOME, AWAY, events, lookup(['p-a', HOME])),
    ).toEqual({ home: 1, away: 0 })
  })
})

describe('parseScoreOverride', () => {
  it('parses simple "H-A"', () => {
    expect(parseScoreOverride('3-1')).toEqual({ home: 3, away: 1 })
  })

  it('parses "H — A" with em-dash', () => {
    expect(parseScoreOverride('3 — 1')).toEqual({ home: 3, away: 1 })
  })

  it('parses "H–A" with en-dash', () => {
    expect(parseScoreOverride('5–2')).toEqual({ home: 5, away: 2 })
  })

  it('parses with leading/trailing decoration', () => {
    expect(parseScoreOverride('3-0 (forfeit)')).toEqual({ home: 3, away: 0 })
    expect(parseScoreOverride('Score: 2-2 abandoned')).toEqual({
      home: 2,
      away: 2,
    })
  })

  it('returns null for unparseable text', () => {
    expect(parseScoreOverride('abandoned')).toBeNull()
    expect(parseScoreOverride('forfeit')).toBeNull()
    expect(parseScoreOverride('')).toBeNull()
  })

  it('parses "H:A" form', () => {
    expect(parseScoreOverride('1:0')).toEqual({ home: 1, away: 0 })
  })
})

describe('resolveDisplayScore', () => {
  it('returns the cache when scoreOverride is null', () => {
    expect(
      resolveDisplayScore({ homeScore: 2, awayScore: 1, scoreOverride: null }),
    ).toEqual({ home: 2, away: 1, kind: 'cache' })
  })

  it('returns parsed override when scoreOverride parses cleanly', () => {
    expect(
      resolveDisplayScore({
        homeScore: 0,
        awayScore: 0,
        scoreOverride: '3-0 (forfeit)',
      }),
    ).toEqual({
      home: 3,
      away: 0,
      kind: 'override',
      overrideText: '3-0 (forfeit)',
      overrideParsedCleanly: true,
    })
  })

  it('returns cache integers when scoreOverride is unparseable', () => {
    expect(
      resolveDisplayScore({
        homeScore: 1,
        awayScore: 1,
        scoreOverride: 'abandoned',
      }),
    ).toEqual({
      home: 1,
      away: 1,
      kind: 'override',
      overrideText: 'abandoned',
      overrideParsedCleanly: false,
    })
  })
})
