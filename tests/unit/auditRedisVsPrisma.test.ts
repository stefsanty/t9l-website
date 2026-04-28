import { describe, it, expect } from 'vitest'

import {
  decidePlayerMappingAudit,
  decideRsvpAudit,
} from '@/../scripts/auditRedisVsPrisma'

/**
 * Unit tests for the v1.8.0 Redis → Prisma audit script's pure decision
 * helpers. The script itself talks to Upstash + Prisma; these tests pin
 * the comparison logic without mounting either.
 */

describe('decidePlayerMappingAudit', () => {
  const mapping = {
    playerId: 'ian-noseda',
    playerName: 'Ian Noseda',
    teamId: 'mariners-fc',
  }

  it('match — both Redis (object) and Prisma have the same lineId→player', () => {
    const decision = decidePlayerMappingAudit(mapping, 'p-ian-noseda')
    expect(decision.kind).toBe('match')
  })

  it('match — Redis has null sentinel and Prisma has no row for this lineId', () => {
    const decision = decidePlayerMappingAudit('__null__', null)
    expect(decision.kind).toBe('match')
  })

  it('redis-only — Redis has a mapping, Prisma has no row holding this lineId', () => {
    const decision = decidePlayerMappingAudit(mapping, null)
    expect(decision.kind).toBe('redis-only')
    if (decision.kind === 'redis-only') {
      expect(decision.targetDbPlayerId).toBe('p-ian-noseda')
      expect(decision.redisMapping.playerId).toBe('ian-noseda')
    }
  })

  it('redis-only — Redis maps lineId to player A, Prisma maps it to player B (Redis canonical wins)', () => {
    const decision = decidePlayerMappingAudit(mapping, 'p-different-player')
    expect(decision.kind).toBe('redis-only')
    if (decision.kind === 'redis-only') {
      // Redis says ian-noseda; we'll repair Prisma to point lineId at p-ian-noseda.
      expect(decision.targetDbPlayerId).toBe('p-ian-noseda')
    }
  })

  it('prisma-only — Redis has nothing, Prisma has a row (read-side drift; not v1.8.0)', () => {
    const decision = decidePlayerMappingAudit(null, 'p-ian-noseda')
    expect(decision.kind).toBe('prisma-only')
    if (decision.kind === 'prisma-only') {
      expect(decision.prismaPlayerId).toBe('p-ian-noseda')
    }
  })

  it('prisma-only — Redis null sentinel says "no mapping" but Prisma has one', () => {
    const decision = decidePlayerMappingAudit('__null__', 'p-ian-noseda')
    expect(decision.kind).toBe('prisma-only')
  })

  it('redis-malformed — Redis has a value we cannot parse', () => {
    const decision = decidePlayerMappingAudit('not-json{{{', null)
    expect(decision.kind).toBe('redis-malformed')
  })

  it('redis-malformed — object missing required fields', () => {
    const decision = decidePlayerMappingAudit({ wrong: 'shape' }, null)
    expect(decision.kind).toBe('redis-malformed')
  })

  it('handles JSON-stringified mappings as well as already-parsed objects', () => {
    const decision = decidePlayerMappingAudit(JSON.stringify(mapping), 'p-ian-noseda')
    expect(decision.kind).toBe('match')
  })
})

describe('decideRsvpAudit', () => {
  it('match — Redis fields and Prisma rows align exactly', () => {
    const redisHash = {
      __seeded: '1',
      'ian-noseda:rsvp': 'GOING',
    }
    const prismaRows = [
      { playerId: 'p-ian-noseda', rsvp: 'GOING' as const, participated: null },
    ]
    const decision = decideRsvpAudit(redisHash, prismaRows)
    expect(decision.redisOnly).toEqual([])
    expect(decision.prismaOnly).toEqual([])
    expect(decision.differing).toEqual([])
  })

  it('match — empty Redis hash with only sentinel + no Prisma rows', () => {
    const redisHash = { __seeded: '1' }
    const decision = decideRsvpAudit(redisHash, [])
    expect(decision.redisOnly).toEqual([])
    expect(decision.prismaOnly).toEqual([])
    expect(decision.differing).toEqual([])
  })

  it('redis-only — Redis has a player Prisma is missing (v1.8.0 drift)', () => {
    const redisHash = {
      __seeded: '1',
      'ian-noseda:rsvp': 'GOING',
      'aleksandr-ivankov:rsvp': 'UNDECIDED',
    }
    const prismaRows = [
      { playerId: 'p-ian-noseda', rsvp: 'GOING' as const, participated: null },
    ]
    const decision = decideRsvpAudit(redisHash, prismaRows)
    expect(decision.redisOnly).toEqual([
      { playerSlug: 'aleksandr-ivankov', rsvp: 'UNDECIDED' },
    ])
    expect(decision.prismaOnly).toEqual([])
    expect(decision.differing).toEqual([])
  })

  it('prisma-only — Prisma has rows Redis is missing (read-side drift; reported but not v1.8.0)', () => {
    const redisHash = { __seeded: '1' }
    const prismaRows = [
      { playerId: 'p-ian-noseda', rsvp: 'GOING' as const, participated: null },
    ]
    const decision = decideRsvpAudit(redisHash, prismaRows)
    expect(decision.redisOnly).toEqual([])
    expect(decision.prismaOnly).toEqual([{ playerSlug: 'ian-noseda' }])
    expect(decision.differing).toEqual([])
  })

  it('skips Prisma rows where both rsvp and participated are null (effectively absent)', () => {
    const redisHash = { __seeded: '1' }
    const prismaRows = [
      { playerId: 'p-ghost', rsvp: null, participated: null },
    ]
    const decision = decideRsvpAudit(redisHash, prismaRows)
    expect(decision.prismaOnly).toEqual([])
  })

  it('differing — same player, different rsvp values (Redis canonical → repair updates Prisma)', () => {
    const redisHash = {
      __seeded: '1',
      'ian-noseda:rsvp': 'UNDECIDED',
    }
    const prismaRows = [
      { playerId: 'p-ian-noseda', rsvp: 'GOING' as const, participated: null },
    ]
    const decision = decideRsvpAudit(redisHash, prismaRows)
    expect(decision.differing).toHaveLength(1)
    expect(decision.differing[0].playerSlug).toBe('ian-noseda')
    expect(decision.differing[0].redis.rsvp).toBe('UNDECIDED')
    expect(decision.differing[0].prisma.rsvp).toBe('GOING')
  })

  it('handles participated fields independently from rsvp', () => {
    const redisHash = {
      __seeded: '1',
      'ian-noseda:rsvp': 'GOING',
      'ian-noseda:p': 'JOINED',
    }
    const prismaRows = [
      { playerId: 'p-ian-noseda', rsvp: 'GOING' as const, participated: null },
    ]
    const decision = decideRsvpAudit(redisHash, prismaRows)
    expect(decision.differing).toHaveLength(1)
    expect(decision.differing[0].redis.participated).toBe('JOINED')
    expect(decision.differing[0].prisma.participated).toBeNull()
  })

  it('null Redis hash — every Prisma row is prisma-only', () => {
    const prismaRows = [
      { playerId: 'p-ian-noseda', rsvp: 'GOING' as const, participated: null },
      { playerId: 'p-aleksandr-ivankov', rsvp: 'UNDECIDED' as const, participated: null },
    ]
    const decision = decideRsvpAudit(null, prismaRows)
    expect(decision.prismaOnly).toHaveLength(2)
    expect(decision.redisOnly).toEqual([])
  })

  it('ignores fields that don\'t end in :rsvp or :p suffixes', () => {
    const redisHash = {
      __seeded: '1',
      'some:weird:field': 'whatever',
      'ian-noseda:rsvp': 'GOING',
    }
    const prismaRows = [
      { playerId: 'p-ian-noseda', rsvp: 'GOING' as const, participated: null },
    ]
    const decision = decideRsvpAudit(redisHash, prismaRows)
    expect(decision.redisOnly).toEqual([])
    expect(decision.differing).toEqual([])
  })
})
