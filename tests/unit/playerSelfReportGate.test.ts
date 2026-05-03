/**
 * v1.46.0 (epic match events PR ζ) — pure gate for the player self-report
 * Submit-goal CTA. Every branch pinned.
 */
import { describe, expect, it } from 'vitest'
import {
  evaluateSelfReportGate,
  selfReportGateOpen,
} from '@/lib/playerSelfReportGate'

const NOW = new Date('2026-04-01T20:30:00+09:00')
const KICKOFF_EARLY = new Date('2026-04-01T19:05:00+09:00')
const KICKOFF_LATE = new Date('2026-04-01T20:15:00+09:00')
const KICKOFF_FUTURE = new Date('2026-04-01T22:00:00+09:00')

describe('evaluateSelfReportGate', () => {
  it('returns NO_SESSION when not signed in', () => {
    const r = evaluateSelfReportGate({
      hasSession: false,
      hasLinkedPlayer: false,
      matchKickoffs: [KICKOFF_EARLY],
      now: NOW,
    })
    expect(r).toBe('NO_SESSION')
  })

  it('returns NO_LINKED_PLAYER when signed in but unlinked', () => {
    const r = evaluateSelfReportGate({
      hasSession: true,
      hasLinkedPlayer: false,
      matchKickoffs: [KICKOFF_EARLY],
      now: NOW,
    })
    expect(r).toBe('NO_LINKED_PLAYER')
  })

  it('returns NO_KICKOFFS when matchday has no matches', () => {
    const r = evaluateSelfReportGate({
      hasSession: true,
      hasLinkedPlayer: true,
      matchKickoffs: [],
      now: NOW,
    })
    expect(r).toBe('NO_KICKOFFS')
  })

  it('returns BEFORE_KICKOFF when now is before the earliest match', () => {
    const r = evaluateSelfReportGate({
      hasSession: true,
      hasLinkedPlayer: true,
      matchKickoffs: [KICKOFF_FUTURE],
      now: NOW,
    })
    expect(r).toBe('BEFORE_KICKOFF')
  })

  it('returns OPEN at exactly the kickoff time', () => {
    const r = evaluateSelfReportGate({
      hasSession: true,
      hasLinkedPlayer: true,
      matchKickoffs: [NOW],
      now: NOW,
    })
    expect(r).toBe('OPEN')
  })

  it('returns OPEN when now is past the earliest of multiple kickoffs', () => {
    const r = evaluateSelfReportGate({
      hasSession: true,
      hasLinkedPlayer: true,
      matchKickoffs: [KICKOFF_FUTURE, KICKOFF_EARLY, KICKOFF_LATE],
      now: NOW,
    })
    expect(r).toBe('OPEN')
  })

  it('accepts ISO strings as kickoff times', () => {
    const r = evaluateSelfReportGate({
      hasSession: true,
      hasLinkedPlayer: true,
      matchKickoffs: ['2026-04-01T19:05:00+09:00'],
      now: NOW,
    })
    expect(r).toBe('OPEN')
  })

  it('skips invalid date strings (defensive — does not crash on bad input)', () => {
    const r = evaluateSelfReportGate({
      hasSession: true,
      hasLinkedPlayer: true,
      matchKickoffs: ['not-a-date'],
      now: NOW,
    })
    expect(r).toBe('NO_KICKOFFS')
  })
})

describe('selfReportGateOpen', () => {
  it('is the boolean shorthand for OPEN', () => {
    expect(
      selfReportGateOpen({
        hasSession: true,
        hasLinkedPlayer: true,
        matchKickoffs: [KICKOFF_EARLY],
        now: NOW,
      }),
    ).toBe(true)
    expect(
      selfReportGateOpen({
        hasSession: true,
        hasLinkedPlayer: true,
        matchKickoffs: [KICKOFF_FUTURE],
        now: NOW,
      }),
    ).toBe(false)
    expect(
      selfReportGateOpen({
        hasSession: false,
        hasLinkedPlayer: false,
        matchKickoffs: [KICKOFF_EARLY],
        now: NOW,
      }),
    ).toBe(false)
  })
})
