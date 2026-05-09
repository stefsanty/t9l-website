import { describe, it, expect } from 'vitest'
import { positionPillColor } from '@/lib/positions'

// ── positionPillColor ─────────────────────────────────────────────────────

describe('[v1.85.3 regression] positionPillColor — soccer codes', () => {
  it('GK → yellow classes', () => {
    expect(positionPillColor('GK')).toBe('bg-yellow-500/20 text-yellow-300')
  })

  it('DF codes → blue classes', () => {
    expect(positionPillColor('LB')).toBe('bg-blue-500/20 text-blue-300')
    expect(positionPillColor('CB')).toBe('bg-blue-500/20 text-blue-300')
    expect(positionPillColor('RB')).toBe('bg-blue-500/20 text-blue-300')
  })

  it('MF codes → green classes', () => {
    expect(positionPillColor('LM')).toBe('bg-green-500/20 text-green-300')
    expect(positionPillColor('DM')).toBe('bg-green-500/20 text-green-300')
    expect(positionPillColor('CM')).toBe('bg-green-500/20 text-green-300')
    expect(positionPillColor('CAM')).toBe('bg-green-500/20 text-green-300')
    expect(positionPillColor('RM')).toBe('bg-green-500/20 text-green-300')
  })

  it('FW codes → red classes', () => {
    expect(positionPillColor('LW')).toBe('bg-red-500/20 text-red-300')
    expect(positionPillColor('ST')).toBe('bg-red-500/20 text-red-300')
    expect(positionPillColor('RW')).toBe('bg-red-500/20 text-red-300')
  })
})

describe('[v1.85.3 regression] positionPillColor — futsal codes', () => {
  it('GK → yellow', () => {
    expect(positionPillColor('GK')).toBe('bg-yellow-500/20 text-yellow-300')
  })

  it('FIXO (DF) → blue', () => {
    expect(positionPillColor('FIXO')).toBe('bg-blue-500/20 text-blue-300')
  })

  it('ALA (MF) → green', () => {
    expect(positionPillColor('ALA')).toBe('bg-green-500/20 text-green-300')
  })

  it('PIVOT (FW) → red', () => {
    expect(positionPillColor('PIVOT')).toBe('bg-red-500/20 text-red-300')
  })
})

describe('[v1.85.3 regression] positionPillColor — case insensitive via getPositionBucket', () => {
  it('lowercase gk still resolves', () => {
    expect(positionPillColor('gk')).toBe('bg-yellow-500/20 text-yellow-300')
  })

  it('unknown code falls back to MF → green', () => {
    expect(positionPillColor('UNKNOWN')).toBe('bg-green-500/20 text-green-300')
  })
})
