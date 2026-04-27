import { describe, it, expect } from 'vitest'
import { __test } from '@/lib/dbToPublicLeagueData'

const { stripPrefix, fmtDateJST, fmtTimeJST, mapAvailability } = __test

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

describe('fmtDateJST', () => {
  it('formats UTC midnight as the same JST date when JST offset keeps it on that date', () => {
    // 2026-04-03T15:00:00Z → 2026-04-04 JST (00:00 next day)
    expect(fmtDateJST(new Date('2026-04-03T15:00:00Z'))).toBe('2026-04-04')
  })

  it('formats a JST midnight as that JST date (regression: a54daf3-style timezone bug)', () => {
    // 2026-04-03T00:00:00+09:00 = 2026-04-02T15:00:00Z; in JST it's still 2026-04-03
    expect(fmtDateJST(new Date('2026-04-03T00:00:00+09:00'))).toBe('2026-04-03')
  })

  it('formats UTC midnight as the same calendar JST date when JST puts it past midnight', () => {
    // 2026-04-03T00:00:00Z = 2026-04-03T09:00:00 JST → still 2026-04-03
    expect(fmtDateJST(new Date('2026-04-03T00:00:00Z'))).toBe('2026-04-03')
  })
})

describe('fmtTimeJST', () => {
  it('formats a JST kickoff as HH:MM not ISO (regression check)', () => {
    expect(fmtTimeJST(new Date('2026-04-03T19:00:00+09:00'))).toBe('19:00')
    expect(fmtTimeJST(new Date('2026-04-03T07:30:00+09:00'))).toBe('07:30')
  })

  it('rolls over correctly when source is UTC', () => {
    // 10:00 UTC = 19:00 JST
    expect(fmtTimeJST(new Date('2026-04-03T10:00:00Z'))).toBe('19:00')
  })

  it('uses 24-hour format (no AM/PM, no 12:00 confusion)', () => {
    expect(fmtTimeJST(new Date('2026-04-03T14:30:00+09:00'))).toBe('14:30')
    expect(fmtTimeJST(new Date('2026-04-03T00:00:00+09:00'))).toBe('00:00')
  })
})

describe('mapAvailability', () => {
  it('PLAYED takes precedence over GOING', () => {
    expect(mapAvailability({ rsvp: 'GOING', participated: 'JOINED' })).toBe('PLAYED')
  })

  it('maps GOING when only rsvp set', () => {
    expect(mapAvailability({ rsvp: 'GOING', participated: null })).toBe('GOING')
  })

  it('maps UNDECIDED when only rsvp UNDECIDED', () => {
    expect(mapAvailability({ rsvp: 'UNDECIDED', participated: null })).toBe('UNDECIDED')
  })

  it('returns null when both fields null (player has no opinion yet)', () => {
    expect(mapAvailability({ rsvp: null, participated: null })).toBe(null)
  })

  it('returns null for NOT_GOING (so they do NOT show up in availability)', () => {
    expect(mapAvailability({ rsvp: 'NOT_GOING', participated: null })).toBe(null)
  })

  it('JOINED participated alone maps to PLAYED (no rsvp recorded but they showed up)', () => {
    expect(mapAvailability({ rsvp: null, participated: 'JOINED' })).toBe('PLAYED')
  })
})
