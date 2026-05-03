/**
 * v1.46.0 (epic match events PR ζ) — pure gate for the player self-report
 * Submit-goals CTA.
 *
 * The CTA on `/matchday/[id]` is hidden when:
 *   - the user is not logged in (no session)
 *   - the user has no linked playerId
 *   - the matchday has no kickoff time we can evaluate against
 *   - the current time (JST) is BEFORE the matchday's earliest kickoff
 *
 * The matchday's earliest kickoff is the minimum of all its matches'
 * `playedAt`. The kickoff strings on the public Match shape are JST
 * `"HH:MM"` formatted; we need the underlying instant for the comparison
 * (the page passes it explicitly from the DB read).
 *
 * Pure function, single signature. Server uses `now = new Date()`; tests
 * pass an explicit Date for determinism.
 */

export interface SelfReportGateInput {
  /** Set when the user is logged in. */
  hasSession: boolean
  /** Set when the user has a linked Player record. */
  hasLinkedPlayer: boolean
  /** ISO timestamps (or Date objects) for every match in the matchday. */
  matchKickoffs: Array<Date | string>
  /** "Now" — pass `new Date()` in production. */
  now: Date
}

export type GateOutcome =
  | 'NO_SESSION'
  | 'NO_LINKED_PLAYER'
  | 'NO_KICKOFFS'
  | 'BEFORE_KICKOFF'
  | 'OPEN'

export function evaluateSelfReportGate(input: SelfReportGateInput): GateOutcome {
  if (!input.hasSession) return 'NO_SESSION'
  if (!input.hasLinkedPlayer) return 'NO_LINKED_PLAYER'
  const kickoffMs: number[] = []
  for (const k of input.matchKickoffs) {
    const t = k instanceof Date ? k.getTime() : new Date(k).getTime()
    if (Number.isFinite(t)) kickoffMs.push(t)
  }
  if (kickoffMs.length === 0) return 'NO_KICKOFFS'
  const earliest = Math.min(...kickoffMs)
  if (input.now.getTime() < earliest) return 'BEFORE_KICKOFF'
  return 'OPEN'
}

/** Boolean shorthand for UI: render the CTA only when OPEN. */
export function selfReportGateOpen(input: SelfReportGateInput): boolean {
  return evaluateSelfReportGate(input) === 'OPEN'
}
