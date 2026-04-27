import { describe, it, expect } from 'vitest'
import { mapStatusToDb, parseMatchdayId } from '@/app/api/rsvp/route'

describe('mapStatusToDb', () => {
  it('maps GOING to rsvp:GOING (PR 4 cutover sees this row)', () => {
    expect(mapStatusToDb('GOING')).toEqual({ rsvp: 'GOING' })
  })

  it('maps UNDECIDED to rsvp:UNDECIDED', () => {
    expect(mapStatusToDb('UNDECIDED')).toEqual({ rsvp: 'UNDECIDED' })
  })

  it('maps "" (clear-RSVP) to rsvp:null — does NOT touch participated', () => {
    // Critical: clearing your RSVP must not erase admin-recorded "PLAYED" status.
    // The route never sets `participated`; it stays whatever it was.
    expect(mapStatusToDb('')).toEqual({ rsvp: null })
  })
})

describe('parseMatchdayId', () => {
  it('accepts md1..md8 (existing Sheets-side range)', () => {
    expect(parseMatchdayId('md1')).toBe(1)
    expect(parseMatchdayId('md8')).toBe(8)
  })

  it('accepts md9 (the e2e test target — previously hardcoded out)', () => {
    expect(parseMatchdayId('md9')).toBe(9)
  })

  it('accepts md10..md99 (future season expansion)', () => {
    expect(parseMatchdayId('md10')).toBe(10)
    expect(parseMatchdayId('md99')).toBe(99)
  })

  it('case-insensitive', () => {
    expect(parseMatchdayId('MD3')).toBe(3)
    expect(parseMatchdayId('Md12')).toBe(12)
  })

  it('rejects malformed input', () => {
    expect(parseMatchdayId('')).toBeNull()
    expect(parseMatchdayId('md0')).toBeNull()
    expect(parseMatchdayId('md100')).toBeNull()
    expect(parseMatchdayId('week3')).toBeNull()
    expect(parseMatchdayId('md3a')).toBeNull()
    expect(parseMatchdayId('md ')).toBeNull()
  })

  it('rejects SQL-injection-ish payloads (defense in depth)', () => {
    expect(parseMatchdayId("md1'; DROP TABLE")).toBeNull()
    expect(parseMatchdayId('md1 OR 1=1')).toBeNull()
  })
})
