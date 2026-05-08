import { describe, it, expect } from 'vitest'
import {
  getPositionVocabulary,
  getValidPositionCodes,
  getPositionLabel,
  getPositionBucket,
  normalizePositions,
  legacyPositionFromArray,
  readPositions,
  joinPositions,
} from '@/lib/positions'

/**
 * v1.82.0 — vocabulary module pinning. Regression-target:
 *   - Soccer vocabulary is the 12-code set (GK + LB/CB/RB +
 *     LM/DM/CM/CAM/RM + LW/ST/RW).
 *   - Futsal vocabulary is GK/FIXO/ALA/PIVOT (exactly four codes).
 *   - normalizePositions REJECTS soccer codes in a futsal league
 *     (CB is invalid for FUTSAL even though it's valid for SOCCER).
 *   - Dual-write helper buckets new codes back to legacy GK/DF/MF/FW.
 *   - Read fallback prefers positions[] over legacy position scalar.
 */
describe('getPositionVocabulary', () => {
  it('returns the 12 soccer codes for SOCCER and undefined/null', () => {
    const expected = [
      'GK',
      'LB', 'CB', 'RB',
      'LM', 'DM', 'CM', 'CAM', 'RM',
      'LW', 'ST', 'RW',
    ]
    expect(getPositionVocabulary('SOCCER').map((p) => p.code)).toEqual(expected)
    expect(getPositionVocabulary(null).map((p) => p.code)).toEqual(expected)
    expect(getPositionVocabulary(undefined).map((p) => p.code)).toEqual(expected)
  })

  it('returns exactly four futsal codes for FUTSAL', () => {
    const codes = getPositionVocabulary('FUTSAL').map((p) => p.code)
    expect(codes).toEqual(['GK', 'FIXO', 'ALA', 'PIVOT'])
    expect(codes).toHaveLength(4)
  })
})

describe('getValidPositionCodes', () => {
  it('soccer set covers exactly the 12 codes', () => {
    const set = getValidPositionCodes('SOCCER')
    expect(set.size).toBe(12)
    for (const code of [
      'GK',
      'LB', 'CB', 'RB',
      'LM', 'DM', 'CM', 'CAM', 'RM',
      'LW', 'ST', 'RW',
    ]) {
      expect(set.has(code)).toBe(true)
    }
  })
  it('futsal set covers exactly GK/FIXO/ALA/PIVOT', () => {
    const set = getValidPositionCodes('FUTSAL')
    expect([...set].sort()).toEqual(['ALA', 'FIXO', 'GK', 'PIVOT'])
  })
})

describe('getPositionLabel', () => {
  it('returns the descriptive soccer labels', () => {
    expect(getPositionLabel('GK', 'SOCCER')).toBe('GK — Goalkeeper')
    expect(getPositionLabel('LB', 'SOCCER')).toBe('LB — Left Back')
    expect(getPositionLabel('CAM', 'SOCCER')).toBe(
      'CAM — Center Attacking Midfielder',
    )
    expect(getPositionLabel('RW', 'SOCCER')).toBe('RW — Right Winger')
  })
  it('returns futsal Goleiro label for GK in FUTSAL', () => {
    expect(getPositionLabel('GK', 'FUTSAL')).toBe('GK — Goleiro (Goalkeeper)')
  })
  it('falls back to the bare code on unknown codes', () => {
    expect(getPositionLabel('SWEEPER', 'SOCCER')).toBe('SWEEPER')
  })
})

describe('getPositionBucket', () => {
  it('buckets soccer codes into GK/DF/MF/FW', () => {
    expect(getPositionBucket('GK')).toBe('GK')
    expect(getPositionBucket('LB')).toBe('DF')
    expect(getPositionBucket('CB')).toBe('DF')
    expect(getPositionBucket('RB')).toBe('DF')
    expect(getPositionBucket('LM')).toBe('MF')
    expect(getPositionBucket('DM')).toBe('MF')
    expect(getPositionBucket('CM')).toBe('MF')
    expect(getPositionBucket('CAM')).toBe('MF')
    expect(getPositionBucket('RM')).toBe('MF')
    expect(getPositionBucket('LW')).toBe('FW')
    expect(getPositionBucket('ST')).toBe('FW')
    expect(getPositionBucket('RW')).toBe('FW')
  })
  it('buckets futsal codes into the matching role band', () => {
    expect(getPositionBucket('GK')).toBe('GK')
    expect(getPositionBucket('FIXO')).toBe('DF')
    expect(getPositionBucket('ALA')).toBe('MF')
    expect(getPositionBucket('PIVOT')).toBe('FW')
  })
  it('handles legacy single-letter codes for backward compat', () => {
    expect(getPositionBucket('DF')).toBe('DF')
    expect(getPositionBucket('MF')).toBe('MF')
    expect(getPositionBucket('FW')).toBe('FW')
    expect(getPositionBucket('FWD')).toBe('FW')
    expect(getPositionBucket('MID')).toBe('MF')
  })
  it('falls back to MF for completely unknown codes', () => {
    expect(getPositionBucket('SWEEPER')).toBe('MF')
  })
})

describe('normalizePositions', () => {
  it('accepts a soccer multi-set', () => {
    expect(normalizePositions(['CB', 'CM'], 'SOCCER')).toEqual(['CB', 'CM'])
  })

  it('accepts the full 12-code soccer set', () => {
    const all = ['GK', 'LB', 'CB', 'RB', 'LM', 'DM', 'CM', 'CAM', 'RM', 'LW', 'ST', 'RW']
    expect(normalizePositions(all, 'SOCCER')).toEqual(all)
  })

  it('accepts a futsal multi-set', () => {
    expect(normalizePositions(['FIXO', 'ALA', 'PIVOT'], 'FUTSAL')).toEqual([
      'FIXO',
      'ALA',
      'PIVOT',
    ])
  })

  it('REJECTS soccer codes in a FUTSAL league', () => {
    expect(() => normalizePositions(['CB'], 'FUTSAL')).toThrow(
      /Invalid position "CB" for FUTSAL/,
    )
    expect(() => normalizePositions(['ST'], 'FUTSAL')).toThrow(
      /Invalid position "ST" for FUTSAL/,
    )
  })

  it('REJECTS futsal codes in a SOCCER league', () => {
    expect(() => normalizePositions(['FIXO'], 'SOCCER')).toThrow(
      /Invalid position "FIXO" for SOCCER/,
    )
    expect(() => normalizePositions(['PIVOT'], 'SOCCER')).toThrow(
      /Invalid position "PIVOT" for SOCCER/,
    )
  })

  it('REJECTS legacy DF/MF/FW codes (now invalid in the new soccer vocab)', () => {
    expect(() => normalizePositions(['DF'], 'SOCCER')).toThrow(
      /Invalid position "DF" for SOCCER/,
    )
    expect(() => normalizePositions(['FW'], 'SOCCER')).toThrow(
      /Invalid position "FW" for SOCCER/,
    )
  })

  it('uppercases and trims input before validating', () => {
    expect(normalizePositions(['  fixo ', 'aLa'], 'FUTSAL')).toEqual([
      'FIXO',
      'ALA',
    ])
    expect(normalizePositions(['  cb ', 'cm'], 'SOCCER')).toEqual(['CB', 'CM'])
  })

  it('dedupes while preserving first-occurrence order', () => {
    expect(normalizePositions(['CB', 'CM', 'CB'], 'SOCCER')).toEqual([
      'CB',
      'CM',
    ])
  })

  it('treats null/undefined/empty-string entries as no-ops', () => {
    expect(normalizePositions(null, 'SOCCER')).toEqual([])
    expect(normalizePositions(undefined, 'SOCCER')).toEqual([])
    expect(normalizePositions(['', '   '], 'SOCCER')).toEqual([])
  })

  it('accepts a single string (legacy single-select shape)', () => {
    expect(normalizePositions('ST', 'SOCCER')).toEqual(['ST'])
  })
})

describe('legacyPositionFromArray', () => {
  it('buckets the first soccer code into the legacy enum', () => {
    expect(legacyPositionFromArray(['CB', 'CM'])).toBe('DF')
    expect(legacyPositionFromArray(['ST'])).toBe('FW')
    expect(legacyPositionFromArray(['CAM'])).toBe('MF')
    expect(legacyPositionFromArray(['GK'])).toBe('GK')
  })

  it('buckets futsal codes through the same path', () => {
    expect(legacyPositionFromArray(['FIXO'])).toBe('DF')
    expect(legacyPositionFromArray(['ALA'])).toBe('MF')
    expect(legacyPositionFromArray(['PIVOT'])).toBe('FW')
  })

  it('returns null on empty array', () => {
    expect(legacyPositionFromArray([])).toBeNull()
  })
})

describe('readPositions', () => {
  it('prefers positions[] when populated', () => {
    expect(
      readPositions({ positions: ['GK', 'CB'], position: 'FW' }),
    ).toEqual(['GK', 'CB'])
  })

  it('falls back to legacy single position when positions[] is empty', () => {
    expect(readPositions({ positions: [], position: 'FW' })).toEqual(['FW'])
  })

  it('returns empty array when both are absent', () => {
    expect(readPositions({})).toEqual([])
    expect(readPositions({ positions: null, position: null })).toEqual([])
  })
})

describe('joinPositions', () => {
  it('joins on / for compact display', () => {
    expect(joinPositions(['CB', 'CM'])).toBe('CB/CM')
  })
  it('returns empty string on empty array', () => {
    expect(joinPositions([])).toBe('')
  })
})
