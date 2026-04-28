import { describe, it, expect } from 'vitest'
import {
  decideBackfillAction,
  type PlayerMapping,
} from '../../scripts/backfillRedisFromPrisma'

/**
 * Pins the pure decision helper that drives the v1.5.0 Prisma → Redis
 * backfill (`scripts/backfillRedisFromPrisma.ts`). Given Prisma truth and
 * what Redis currently holds, the helper decides one of three outcomes:
 *
 *   - `create`            — Redis has nothing for this lineId; write it
 *   - `match`             — Redis already matches Prisma; no-op
 *   - `drift-overwrite`   — Redis disagrees with Prisma; overwrite with truth
 *
 * The drift case is the one the dry-run output will surface for operator
 * review before merging the no-Prisma-fallback code (PR 16). A non-zero
 * drift count means the in-flight steady-state had inconsistencies between
 * the two stores; the operator decides whether to investigate or just let
 * the backfill rewrite.
 */

const SAMPLE: PlayerMapping = {
  playerId: 'ian-noseda',
  playerName: 'Ian Noseda',
  teamId: 'mariners-fc',
}

const OTHER: PlayerMapping = {
  playerId: 'stefan-santos',
  playerName: 'Stefan Santos',
  teamId: 'fenix-fc',
}

describe('decideBackfillAction', () => {
  it('returns create when Redis has no value for the lineId', () => {
    expect(decideBackfillAction(SAMPLE, null)).toEqual({
      kind: 'create',
      mapping: SAMPLE,
    })
  })

  it('returns match when Redis holds the same JSON-encoded mapping', () => {
    expect(decideBackfillAction(SAMPLE, JSON.stringify(SAMPLE))).toEqual({
      kind: 'match',
      mapping: SAMPLE,
    })
  })

  it('returns match when Upstash auto-parses an identical object', () => {
    // Upstash REST sometimes returns parsed objects; the helper must accept
    // both string-encoded JSON and pre-parsed objects.
    expect(
      decideBackfillAction(SAMPLE, { ...SAMPLE } as unknown as object),
    ).toEqual({ kind: 'match', mapping: SAMPLE })
  })

  it('returns drift-overwrite when Redis holds a different mapping (string-encoded)', () => {
    const decision = decideBackfillAction(SAMPLE, JSON.stringify(OTHER))
    expect(decision.kind).toBe('drift-overwrite')
    if (decision.kind !== 'drift-overwrite') return
    expect(decision.redisHad).toEqual(OTHER)
    expect(decision.mapping).toEqual(SAMPLE)
  })

  it('returns drift-overwrite when Redis holds a different mapping (auto-parsed object)', () => {
    const decision = decideBackfillAction(SAMPLE, { ...OTHER } as unknown as object)
    expect(decision.kind).toBe('drift-overwrite')
    if (decision.kind !== 'drift-overwrite') return
    expect(decision.redisHad).toEqual(OTHER)
  })

  it('returns drift-overwrite (redisHad: null) when Redis has the null sentinel for a Prisma-mapped lineId', () => {
    // Prisma says the lineId IS mapped; Redis explicitly says "no mapping"
    // via the sentinel. Treat as drift — Prisma is the recovery truth.
    const decision = decideBackfillAction(SAMPLE, '__null__')
    expect(decision.kind).toBe('drift-overwrite')
    if (decision.kind !== 'drift-overwrite') return
    expect(decision.redisHad).toBeNull()
    expect(decision.mapping).toEqual(SAMPLE)
  })

  it('returns drift-overwrite (redisHad: malformed) when Redis holds an unparseable string', () => {
    const decision = decideBackfillAction(SAMPLE, 'not-json{{{')
    expect(decision.kind).toBe('drift-overwrite')
    if (decision.kind !== 'drift-overwrite') return
    expect(decision.redisHad).toBe('malformed')
  })

  it('returns drift-overwrite (redisHad: malformed) when Redis holds an object missing required fields', () => {
    // Auto-parsed but lacking playerId/teamId — counts as malformed because
    // the JWT callback's runtime check would treat it as a miss.
    const decision = decideBackfillAction(SAMPLE, {
      somethingElse: 'x',
    } as unknown as object)
    expect(decision.kind).toBe('drift-overwrite')
    if (decision.kind !== 'drift-overwrite') return
    expect(decision.redisHad).toBe('malformed')
  })

  it('detects drift on a single field difference (e.g. team change post-rename)', () => {
    const renamed: PlayerMapping = { ...SAMPLE, teamId: 'fenix-fc' }
    const decision = decideBackfillAction(renamed, JSON.stringify(SAMPLE))
    expect(decision.kind).toBe('drift-overwrite')
  })
})
