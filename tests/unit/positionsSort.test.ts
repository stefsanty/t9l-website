/**
 * v2.2.9 — pure tests for the new position-sort helpers used by the
 * onboarding team-picker. The helpers live in `src/lib/positions.ts`
 * (canonical vocabulary file) so they can be imported from server and
 * client without dragging Prisma into the bundle.
 *
 * Two helpers:
 *   - getPositionSortWeight(code, ballType): vocab sortWeight, with
 *     Number.MAX_SAFE_INTEGER fallback for empty/unknown.
 *   - sortMembersByPrimaryPositionThenName(members, ballType): pure,
 *     stable sort returning a NEW array. Primary key: position weight;
 *     tiebreaker: name (case-insensitive, locale-aware).
 */
import { describe, it, expect } from 'vitest'
import {
  getPositionSortWeight,
  sortMembersByPrimaryPositionThenName,
} from '@/lib/positions'

describe('getPositionSortWeight — soccer vocabulary', () => {
  it('GK sorts first (weight 1)', () => {
    expect(getPositionSortWeight('GK', 'SOCCER')).toBe(1)
  })

  it('RW sorts last among soccer codes (weight 12)', () => {
    expect(getPositionSortWeight('RW', 'SOCCER')).toBe(12)
  })

  it('CB sits in the defensive band (weight 3)', () => {
    expect(getPositionSortWeight('CB', 'SOCCER')).toBe(3)
  })

  it('case-insensitive — lowercase code resolves to canonical weight', () => {
    expect(getPositionSortWeight('cb', 'SOCCER')).toBe(3)
  })
})

describe('getPositionSortWeight — futsal vocabulary', () => {
  it('GK first (1), FIXO (2), ALA (3), PIVOT last (4)', () => {
    expect(getPositionSortWeight('GK', 'FUTSAL')).toBe(1)
    expect(getPositionSortWeight('FIXO', 'FUTSAL')).toBe(2)
    expect(getPositionSortWeight('ALA', 'FUTSAL')).toBe(3)
    expect(getPositionSortWeight('PIVOT', 'FUTSAL')).toBe(4)
  })

  it('soccer code in a futsal league sorts to the end (unknown for vocab)', () => {
    // 'CB' is not in the futsal vocabulary → fallback weight.
    expect(getPositionSortWeight('CB', 'FUTSAL')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('getPositionSortWeight — empty / unknown', () => {
  it('null returns the fallback weight', () => {
    expect(getPositionSortWeight(null, 'SOCCER')).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('undefined returns the fallback weight', () => {
    expect(getPositionSortWeight(undefined, 'SOCCER')).toBe(
      Number.MAX_SAFE_INTEGER,
    )
  })

  it('empty string returns the fallback weight', () => {
    expect(getPositionSortWeight('', 'SOCCER')).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('unknown code returns the fallback weight', () => {
    expect(getPositionSortWeight('XYZ', 'SOCCER')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('sortMembersByPrimaryPositionThenName — soccer roster', () => {
  it('orders GK → DF → MF → FW, with alphabetical tie-break by name', () => {
    const input = [
      { name: 'Zane',  primaryPosition: 'ST' },
      { name: 'Alice', primaryPosition: 'GK' },
      { name: 'Bob',   primaryPosition: 'CB' },
      { name: 'Carol', primaryPosition: 'CB' },
      { name: 'Dave',  primaryPosition: 'CM' },
    ]
    const sorted = sortMembersByPrimaryPositionThenName(input, 'SOCCER')
    expect(sorted.map((m) => m.name)).toEqual([
      'Alice', // GK
      'Bob',   // CB (alphabetical before Carol)
      'Carol', // CB
      'Dave',  // CM
      'Zane',  // ST
    ])
  })

  it('members with no primary position fall to the end', () => {
    const input = [
      { name: 'Erin', primaryPosition: null },
      { name: 'Bob',  primaryPosition: 'CM' },
      { name: 'Alice', primaryPosition: 'GK' },
    ]
    const sorted = sortMembersByPrimaryPositionThenName(input, 'SOCCER')
    expect(sorted.map((m) => m.name)).toEqual(['Alice', 'Bob', 'Erin'])
  })

  it('tiebreak is case-insensitive', () => {
    const input = [
      { name: 'bob',  primaryPosition: 'CB' },
      { name: 'Alice', primaryPosition: 'CB' },
    ]
    const sorted = sortMembersByPrimaryPositionThenName(input, 'SOCCER')
    expect(sorted.map((m) => m.name)).toEqual(['Alice', 'bob'])
  })

  it('does not mutate the input array', () => {
    const input = [
      { name: 'Zane',  primaryPosition: 'ST' },
      { name: 'Alice', primaryPosition: 'GK' },
    ]
    const before = [...input]
    sortMembersByPrimaryPositionThenName(input, 'SOCCER')
    expect(input).toEqual(before)
  })
})

describe('sortMembersByPrimaryPositionThenName — futsal roster', () => {
  it('orders by futsal vocab (GK / FIXO / ALA / PIVOT)', () => {
    const input = [
      { name: 'Piv',  primaryPosition: 'PIVOT' },
      { name: 'Ala1', primaryPosition: 'ALA' },
      { name: 'Fix',  primaryPosition: 'FIXO' },
      { name: 'Keep', primaryPosition: 'GK' },
      { name: 'Ala2', primaryPosition: 'ALA' },
    ]
    const sorted = sortMembersByPrimaryPositionThenName(input, 'FUTSAL')
    expect(sorted.map((m) => m.name)).toEqual([
      'Keep', // GK
      'Fix',  // FIXO
      'Ala1', // ALA (alphabetical)
      'Ala2',
      'Piv',  // PIVOT
    ])
  })
})
