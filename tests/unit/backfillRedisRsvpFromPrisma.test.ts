import { describe, it, expect } from 'vitest'
import {
  decideBackfillAction,
  buildTargetFields,
  computeExpireAt,
} from '../../scripts/backfillRedisRsvpFromPrisma'

describe('buildTargetFields — Prisma rows → desired hash content', () => {
  it('always includes __seeded=1 even with zero rows', () => {
    expect(buildTargetFields([])).toEqual({ __seeded: '1' })
  })

  it('strips the p- prefix from playerId to recover the public slug', () => {
    expect(
      buildTargetFields([
        { playerId: 'p-ian-noseda', rsvp: 'GOING', participated: null },
      ]),
    ).toEqual({ __seeded: '1', 'ian-noseda:rsvp': 'GOING' })
  })

  it('writes :rsvp and :p as separate fields when both are set', () => {
    expect(
      buildTargetFields([
        { playerId: 'p-ian-noseda', rsvp: 'GOING', participated: 'JOINED' },
      ]),
    ).toEqual({
      __seeded: '1',
      'ian-noseda:rsvp': 'GOING',
      'ian-noseda:p': 'JOINED',
    })
  })

  it('omits :rsvp when null (Prisma null = field absent in Redis)', () => {
    expect(
      buildTargetFields([
        { playerId: 'p-ian-noseda', rsvp: null, participated: 'JOINED' },
      ]),
    ).toEqual({ __seeded: '1', 'ian-noseda:p': 'JOINED' })
  })

  it('omits :p when null', () => {
    expect(
      buildTargetFields([
        { playerId: 'p-ian-noseda', rsvp: 'UNDECIDED', participated: null },
      ]),
    ).toEqual({ __seeded: '1', 'ian-noseda:rsvp': 'UNDECIDED' })
  })

  it('handles multiple players in one GameWeek', () => {
    expect(
      buildTargetFields([
        { playerId: 'p-ian-noseda', rsvp: 'GOING', participated: null },
        { playerId: 'p-tomo-suzuki', rsvp: 'UNDECIDED', participated: null },
      ]),
    ).toEqual({
      __seeded: '1',
      'ian-noseda:rsvp': 'GOING',
      'tomo-suzuki:rsvp': 'UNDECIDED',
    })
  })
})

describe('decideBackfillAction — CREATE / MATCH / DRIFT', () => {
  const target = {
    __seeded: '1',
    'ian-noseda:rsvp': 'GOING',
  }

  it('CREATE when Redis returns null (key missing)', () => {
    const decision = decideBackfillAction(target, null)
    expect(decision.kind).toBe('create')
  })

  it('CREATE when Redis returns an empty object (no fields)', () => {
    const decision = decideBackfillAction(target, {})
    expect(decision.kind).toBe('create')
  })

  it('MATCH when target == redisRaw exactly', () => {
    const decision = decideBackfillAction(target, { ...target })
    expect(decision.kind).toBe('match')
  })

  it('DRIFT when Redis has an extra field (onlyInRedis)', () => {
    const redisRaw = { ...target, 'ghost-player:rsvp': 'GOING' }
    const decision = decideBackfillAction(target, redisRaw)
    expect(decision.kind).toBe('drift-overwrite')
    if (decision.kind !== 'drift-overwrite') return
    expect(decision.diff.onlyInRedis).toEqual(['ghost-player:rsvp'])
  })

  it('DRIFT when Prisma has a field Redis lacks (onlyInPrisma)', () => {
    const decision = decideBackfillAction(
      { ...target, 'tomo-suzuki:rsvp': 'GOING' },
      target,
    )
    expect(decision.kind).toBe('drift-overwrite')
    if (decision.kind !== 'drift-overwrite') return
    expect(decision.diff.onlyInPrisma).toEqual(['tomo-suzuki:rsvp'])
  })

  it('DRIFT when a shared field has different values (differing)', () => {
    const decision = decideBackfillAction(
      { __seeded: '1', 'ian-noseda:rsvp': 'GOING' },
      { __seeded: '1', 'ian-noseda:rsvp': 'UNDECIDED' },
    )
    expect(decision.kind).toBe('drift-overwrite')
    if (decision.kind !== 'drift-overwrite') return
    expect(decision.diff.differing).toEqual(['ian-noseda:rsvp'])
  })

  it('DRIFT (in onlyInPrisma) when Redis lacks the __seeded sentinel (defensive)', () => {
    const redisRaw = { 'ian-noseda:rsvp': 'GOING' }
    const decision = decideBackfillAction(target, redisRaw)
    expect(decision.kind).toBe('drift-overwrite')
    if (decision.kind !== 'drift-overwrite') return
    expect(decision.diff.onlyInPrisma).toContain('__seeded')
  })

  it('MATCH on an empty-but-seeded GameWeek (no RSVPs yet)', () => {
    const empty = { __seeded: '1' }
    const decision = decideBackfillAction(empty, empty)
    expect(decision.kind).toBe('match')
  })

  it('MATCH when Upstash auto-parses __seeded string "1" into number 1 (regression: post-apply drift)', () => {
    // Upstash's REST HGETALL auto-parses numeric strings into numbers.
    // The decision helper must coerce via String() before comparing,
    // otherwise --apply followed by --dry-run reports drift on every GW
    // we just wrote (observed in v1.7.0 cutover dry-run #2).
    const target = { __seeded: '1', 'ian-noseda:rsvp': 'GOING' }
    const redisRaw = { __seeded: 1, 'ian-noseda:rsvp': 'GOING' }
    const decision = decideBackfillAction(target, redisRaw)
    expect(decision.kind).toBe('match')
  })
})

describe('computeExpireAt — same math as rsvpStore', () => {
  it('produces seconds, anchored at max(now, gwStart) + 90 days', () => {
    const gwStart = new Date('2026-08-01T00:00:00Z')
    const now = new Date('2026-04-28T00:00:00Z')
    const result = computeExpireAt(gwStart, now)
    const expected = Math.floor(gwStart.getTime() / 1000) + 90 * 24 * 60 * 60
    expect(result).toBe(expected)
  })
})
