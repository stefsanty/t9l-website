import { describe, it, expect } from 'vitest'
import { decideLink } from '../../scripts/_archive/backfillRedisLineMap'

const baseMapping = { playerId: 'ian-noseda', playerName: 'Ian Noseda', teamId: 'mariners-fc' }

describe('decideLink', () => {
  it('returns missing-player when DB player not found', () => {
    const decision = decideLink('U1', baseMapping, null)
    expect(decision).toEqual({ kind: 'missing-player', redisPlayerId: 'ian-noseda' })
  })

  it('returns already-linked when DB lineId matches', () => {
    const decision = decideLink('U1', baseMapping, { id: 'p-ian-noseda', lineId: 'U1' })
    expect(decision).toEqual({ kind: 'already-linked', dbPlayerId: 'p-ian-noseda', lineId: 'U1' })
  })

  it('returns conflict when DB lineId differs', () => {
    const decision = decideLink('U-new', baseMapping, { id: 'p-ian-noseda', lineId: 'U-old' })
    expect(decision).toEqual({
      kind: 'conflict',
      dbPlayerId: 'p-ian-noseda',
      existingLineId: 'U-old',
      redisLineId: 'U-new',
    })
  })

  it('returns link when DB lineId is null', () => {
    const decision = decideLink('U1', baseMapping, { id: 'p-ian-noseda', lineId: null })
    expect(decision).toEqual({ kind: 'link', dbPlayerId: 'p-ian-noseda', lineId: 'U1' })
  })
})
