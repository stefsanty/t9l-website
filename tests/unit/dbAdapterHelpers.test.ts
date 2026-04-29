import { describe, it, expect } from 'vitest'
import { __test } from '@/lib/dbToPublicLeagueData'

const { stripPrefix } = __test
// JST formatting helpers moved to `lib/jst.ts` in v1.9.0 — their tests live
// in `tests/unit/jst.test.ts`.
// `mapAvailability` moved to `lib/rsvpMerge.ts` in PR 19 / v1.7.0 — its
// tests live in `tests/unit/rsvpMerge.test.ts` alongside the new
// merge-into-LeagueData logic.

describe('stripPrefix', () => {
  it('removes the prefix when present', () => {
    expect(stripPrefix('t-mariners-fc', 't-')).toBe('mariners-fc')
    expect(stripPrefix('p-ian-noseda', 'p-')).toBe('ian-noseda')
  })

  it('returns input unchanged when prefix is absent', () => {
    expect(stripPrefix('mariners-fc', 't-')).toBe('mariners-fc')
    expect(stripPrefix('', 't-')).toBe('')
  })

  it('handles double-prefix safely (only strips once)', () => {
    expect(stripPrefix('t-t-mariners-fc', 't-')).toBe('t-mariners-fc')
  })
})
