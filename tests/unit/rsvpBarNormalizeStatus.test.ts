import { describe, it, expect } from 'vitest'
import { normalizeStatus } from '@/components/RsvpBar'

/**
 * v2.2.18 — regression pin. Pre-v2.2.18 `normalizeStatus('PLAYED')`
 * returned '' (not handled), which caused the RsvpBar footer to render
 * "Are you coming?" for a player who had RSVP'd GOING the moment a
 * matchday's kickoff passed but before the admin entered scores. The
 * going-list in MatchdayAvailability already accepted 'PLAYED' as a
 * "going" signal — the footer diverging from the going list was the
 * user-visible bug.
 *
 * The data-layer projection (rsvpMerge.ts) maps GOING + isPast → 'PLAYED'
 * per v2.2.6 / v2.2.7. Anywhere downstream that consumes the projected
 * status to mean "is the player going" must treat 'PLAYED' as 'GOING'.
 */
describe('RsvpBar.normalizeStatus', () => {
  it("maps 'PLAYED' to 'GOING' (post-kickoff, pre-score window)", () => {
    expect(normalizeStatus('PLAYED')).toBe('GOING')
  })

  it("maps 'GOING' and the legacy 'Y' to 'GOING'", () => {
    expect(normalizeStatus('GOING')).toBe('GOING')
    expect(normalizeStatus('Y')).toBe('GOING')
  })

  it("maps 'UNDECIDED' and the legacy 'EXPECTED' to 'UNDECIDED'", () => {
    expect(normalizeStatus('UNDECIDED')).toBe('UNDECIDED')
    expect(normalizeStatus('EXPECTED')).toBe('UNDECIDED')
  })

  it("collapses unknown and empty to ''", () => {
    expect(normalizeStatus('')).toBe('')
    expect(normalizeStatus('NOT_GOING')).toBe('')
    expect(normalizeStatus('whatever')).toBe('')
  })
})
