import { describe, it, expect } from 'vitest'
import { positionPillColor } from '@/lib/positions'
import { bucketConfirmedPlayers, BUCKET_LABEL, BUCKET_DOT } from '@/components/MatchdayAvailability'
import type { Player } from '@/types'

// ── positionPillColor ─────────────────────────────────────────────────────

// v2.2.14 — `positionPillColor` returns opaque solid pills
// (`bg-{c}-200 text-{c}-900`) — same chip in both light and dark mode.
// Original v1.85.3 regression intent (bucket → colour family) is
// preserved; the class strings track the v2.2.14 shape.
describe('[v1.85.3 regression] positionPillColor — soccer codes', () => {
  it('GK → yellow classes', () => {
    expect(positionPillColor('GK')).toBe('bg-yellow-200 text-yellow-900')
  })

  it('DF codes → blue classes', () => {
    expect(positionPillColor('LB')).toBe('bg-blue-200 text-blue-900')
    expect(positionPillColor('CB')).toBe('bg-blue-200 text-blue-900')
    expect(positionPillColor('RB')).toBe('bg-blue-200 text-blue-900')
  })

  it('MF codes → green classes', () => {
    expect(positionPillColor('LM')).toBe('bg-green-200 text-green-900')
    expect(positionPillColor('DM')).toBe('bg-green-200 text-green-900')
    expect(positionPillColor('CM')).toBe('bg-green-200 text-green-900')
    expect(positionPillColor('CAM')).toBe('bg-green-200 text-green-900')
    expect(positionPillColor('RM')).toBe('bg-green-200 text-green-900')
  })

  it('FW codes → red classes', () => {
    expect(positionPillColor('LW')).toBe('bg-red-200 text-red-900')
    expect(positionPillColor('ST')).toBe('bg-red-200 text-red-900')
    expect(positionPillColor('RW')).toBe('bg-red-200 text-red-900')
  })
})

describe('[v1.85.3 regression] positionPillColor — futsal codes', () => {
  it('GK → yellow', () => {
    expect(positionPillColor('GK')).toBe('bg-yellow-200 text-yellow-900')
  })

  it('FIXO (DF) → blue', () => {
    expect(positionPillColor('FIXO')).toBe('bg-blue-200 text-blue-900')
  })

  it('ALA (MF) → green', () => {
    expect(positionPillColor('ALA')).toBe('bg-green-200 text-green-900')
  })

  it('PIVOT (FW) → red', () => {
    expect(positionPillColor('PIVOT')).toBe('bg-red-200 text-red-900')
  })
})

describe('[v1.85.3 regression] positionPillColor — case insensitive via getPositionBucket', () => {
  it('lowercase gk still resolves', () => {
    expect(positionPillColor('gk')).toBe('bg-yellow-200 text-yellow-900')
  })

  it('unknown code falls back to MF → green', () => {
    expect(positionPillColor('UNKNOWN')).toBe('bg-green-200 text-green-900')
  })
})

// ── bucketConfirmedPlayers ────────────────────────────────────────────────

function makePlayer(id: string, position: string): Player {
  return { id, name: id, position, teamId: 't1' } as unknown as Player
}

describe('[v1.85.3 regression] bucketConfirmedPlayers — basic grouping', () => {
  const players: Player[] = [
    makePlayer('gk1', 'GK'),
    makePlayer('cb1', 'CB'),
    makePlayer('cm1', 'CM'),
    makePlayer('st1', 'ST'),
    makePlayer('lb1', 'LB'),
  ]
  const ids = ['gk1', 'cb1', 'cm1', 'st1', 'lb1']

  it('returns 4 groups (GK, DF, MF, FW)', () => {
    const groups = bucketConfirmedPlayers(ids, players)
    expect(groups.map((g) => g.bucket)).toEqual(['GK', 'DF', 'MF', 'FW'])
  })

  it('GK group has exactly the GK player', () => {
    const groups = bucketConfirmedPlayers(ids, players)
    expect(groups[0].players.map((p) => p.id)).toEqual(['gk1'])
  })

  it('DF group has CB and LB (alphabetical: CB before LB)', () => {
    const groups = bucketConfirmedPlayers(ids, players)
    expect(groups[1].players.map((p) => p.id)).toEqual(['cb1', 'lb1'])
  })

  it('players within a bucket are sorted alphabetically by name', () => {
    const p = [makePlayer('zeb', 'CB'), makePlayer('amir', 'CB')]
    const groups = bucketConfirmedPlayers(['zeb', 'amir'], p)
    expect(groups[0].players.map((p) => p.id)).toEqual(['amir', 'zeb'])
  })
})

describe('[v1.85.3 regression] bucketConfirmedPlayers — empty bucket omission', () => {
  it('empty bucket is excluded from result', () => {
    const players: Player[] = [makePlayer('gk1', 'GK'), makePlayer('st1', 'ST')]
    const groups = bucketConfirmedPlayers(['gk1', 'st1'], players)
    expect(groups.map((g) => g.bucket)).toEqual(['GK', 'FW'])
    expect(groups).toHaveLength(2)
  })

  it('no confirmations → empty array', () => {
    expect(bucketConfirmedPlayers([], [])).toEqual([])
  })
})

describe('[v1.85.3 regression] bucketConfirmedPlayers — futsal codes', () => {
  const players: Player[] = [
    makePlayer('gk1', 'GK'),
    makePlayer('fixo1', 'FIXO'),
    makePlayer('ala1', 'ALA'),
    makePlayer('pivot1', 'PIVOT'),
  ]
  const ids = ['gk1', 'fixo1', 'ala1', 'pivot1']

  it('futsal codes bucket correctly: GK→GK, FIXO→DF, ALA→MF, PIVOT→FW', () => {
    const groups = bucketConfirmedPlayers(ids, players)
    expect(groups.map((g) => g.bucket)).toEqual(['GK', 'DF', 'MF', 'FW'])
  })
})

describe('[v1.85.3 → v1.92.0 update] bucketConfirmedPlayers — multi-position (joined string)', () => {
  // v1.92.0 flipped the rule from "first code wins" to "averaged
  // forward-score across the array". "CB/CM" now averages (1+3)/2 = 2.0
  // → MF, not DF. The previous v1.85.3 pin asserted the now-superseded
  // first-code-wins behavior.
  it('averages codes in "CB/CM" → (1+3)/2 = 2.0 → MF bucket (v1.92.0)', () => {
    const p = [makePlayer('alex', 'CB/CM')]
    const groups = bucketConfirmedPlayers(['alex'], p)
    expect(groups[0].bucket).toBe('MF')
  })
})

describe('[v1.85.3 regression] BUCKET_LABEL and BUCKET_DOT constants', () => {
  it('BUCKET_LABEL has English labels for all 4 buckets', () => {
    expect(BUCKET_LABEL.GK).toBe('Goalkeepers')
    expect(BUCKET_LABEL.DF).toBe('Defense')
    expect(BUCKET_LABEL.MF).toBe('Midfield')
    expect(BUCKET_LABEL.FW).toBe('Forwards')
  })

  it('BUCKET_DOT has bg-* class for all 4 buckets', () => {
    expect(BUCKET_DOT.GK).toContain('bg-yellow')
    expect(BUCKET_DOT.DF).toContain('bg-blue')
    expect(BUCKET_DOT.MF).toContain('bg-green')
    expect(BUCKET_DOT.FW).toContain('bg-red')
  })
})
