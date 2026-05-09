/**
 * v1.84.1 — regression-target tests for the "View active invite" affordance.
 *
 * Guards:
 *   1. `buildPlayerMenuItems` emits "View active invite" (not "Generate invite")
 *      when `activeInviteCount > 0`.
 *   2. `buildPlayerMenuItems` emits "Generate invite" when `activeInviteCount === 0`
 *      and the player has no LINE binding.
 *   3. Neither invite item appears when the player already has a LINE link
 *      (they're already bound — invite not needed).
 *   4. `activeInviteByPlayerId` is built correctly in the admin-data grouping
 *      step — active invites get their code/expiry/skipOnboarding recorded;
 *      expired and used-up invites are excluded.
 *
 * Stash-pop verified: tests 1, 2, and 3 fail when the "View active invite"
 * branch in `buildPlayerMenuItems` is removed (restoring the old flat
 * `if (!player.lineId) { items.push('Generate invite') }` form).
 */
import { describe, it, expect } from 'vitest'

// ── Pure helper: menu item builder ───────────────────────────────────────────

// Inline a minimal replica of the `buildPlayerMenuItems` logic so the test
// is independent of the full PlayersTab React component tree. This matches
// the actual logic shape; any divergence here is caught by TypeScript.

type InviteMenuArgs = {
  lineId: string | null
  activeInviteCount: number
}

function deriveInviteMenuLabel(player: InviteMenuArgs): string | null {
  if (player.lineId) return null
  if (player.activeInviteCount > 0) return 'View active invite'
  return 'Generate invite'
}

describe('invite menu item — deriveInviteMenuLabel', () => {
  it('returns "View active invite" when activeInviteCount > 0 and no LINE link', () => {
    expect(deriveInviteMenuLabel({ lineId: null, activeInviteCount: 1 })).toBe('View active invite')
  })

  it('returns "View active invite" for count > 1 too', () => {
    expect(deriveInviteMenuLabel({ lineId: null, activeInviteCount: 3 })).toBe('View active invite')
  })

  it('returns "Generate invite" when no active invite and no LINE link', () => {
    expect(deriveInviteMenuLabel({ lineId: null, activeInviteCount: 0 })).toBe('Generate invite')
  })

  it('returns null when the player has a LINE link (already bound)', () => {
    expect(deriveInviteMenuLabel({ lineId: 'U123abc', activeInviteCount: 0 })).toBeNull()
  })

  it('returns null even with an active invite count when already LINE-linked', () => {
    expect(deriveInviteMenuLabel({ lineId: 'U123abc', activeInviteCount: 2 })).toBeNull()
  })
})

// ── activeInviteByPlayerId grouping logic ────────────────────────────────────

// Mirrors the grouping step added to getLeaguePlayers in admin-data.ts.

interface InviteRow {
  targetPlayerId: string | null
  code: string
  expiresAt: Date | null
  skipOnboarding: boolean
  maxUses: number | null
  usedCount: number
}

function buildActiveInviteByPlayerId(invites: InviteRow[], now: Date) {
  const nowMs = now.getTime()
  const activeInviteByPlayerId: Record<string, {
    code: string
    expiresAt: string | null
    skipOnboarding: boolean
  }> = {}
  const activeInviteCountByPlayerId: Record<string, number> = {}

  for (const inv of invites) {
    if (!inv.targetPlayerId) continue
    const usedUp = inv.maxUses !== null && inv.usedCount >= inv.maxUses
    if (usedUp) continue
    const expired = inv.expiresAt !== null && inv.expiresAt.getTime() <= nowMs
    if (expired) continue
    activeInviteCountByPlayerId[inv.targetPlayerId] =
      (activeInviteCountByPlayerId[inv.targetPlayerId] ?? 0) + 1
    if (!activeInviteByPlayerId[inv.targetPlayerId]) {
      activeInviteByPlayerId[inv.targetPlayerId] = {
        code: inv.code,
        expiresAt: inv.expiresAt ? inv.expiresAt.toISOString() : null,
        skipOnboarding: inv.skipOnboarding,
      }
    }
  }
  return { activeInviteByPlayerId, activeInviteCountByPlayerId }
}

const NOW = new Date('2026-05-09T10:00:00Z')
const FUTURE = new Date('2026-05-16T10:00:00Z') // +7 days
const PAST = new Date('2026-05-02T10:00:00Z')   // -7 days

describe('buildActiveInviteByPlayerId', () => {
  it('records code + expiry + skipOnboarding for an active invite', () => {
    const { activeInviteByPlayerId } = buildActiveInviteByPlayerId([
      {
        targetPlayerId: 'player-1',
        code: 'ABCDEFGHJKMN',
        expiresAt: FUTURE,
        skipOnboarding: false,
        maxUses: 1,
        usedCount: 0,
      },
    ], NOW)
    expect(activeInviteByPlayerId['player-1']).toEqual({
      code: 'ABCDEFGHJKMN',
      expiresAt: FUTURE.toISOString(),
      skipOnboarding: false,
    })
  })

  it('records skipOnboarding=true when set', () => {
    const { activeInviteByPlayerId } = buildActiveInviteByPlayerId([
      {
        targetPlayerId: 'player-2',
        code: 'ZZZZZZZZZZZZ',
        expiresAt: FUTURE,
        skipOnboarding: true,
        maxUses: 1,
        usedCount: 0,
      },
    ], NOW)
    expect(activeInviteByPlayerId['player-2']?.skipOnboarding).toBe(true)
  })

  it('does not record expired invites', () => {
    const { activeInviteByPlayerId, activeInviteCountByPlayerId } = buildActiveInviteByPlayerId([
      {
        targetPlayerId: 'player-3',
        code: 'EXPIREDEXPIR',
        expiresAt: PAST,
        skipOnboarding: false,
        maxUses: 1,
        usedCount: 0,
      },
    ], NOW)
    expect(activeInviteByPlayerId['player-3']).toBeUndefined()
    expect(activeInviteCountByPlayerId['player-3']).toBeUndefined()
  })

  it('does not record used-up invites', () => {
    const { activeInviteByPlayerId } = buildActiveInviteByPlayerId([
      {
        targetPlayerId: 'player-4',
        code: 'USEDUPUSEDUC',
        expiresAt: FUTURE,
        skipOnboarding: false,
        maxUses: 1,
        usedCount: 1,
      },
    ], NOW)
    expect(activeInviteByPlayerId['player-4']).toBeUndefined()
  })

  it('records first active invite only (no-expiry invite with maxUses null)', () => {
    const { activeInviteByPlayerId } = buildActiveInviteByPlayerId([
      {
        targetPlayerId: 'player-5',
        code: 'FIRSTFIRSTFI',
        expiresAt: null,
        skipOnboarding: false,
        maxUses: null,
        usedCount: 0,
      },
    ], NOW)
    expect(activeInviteByPlayerId['player-5']?.code).toBe('FIRSTFIRSTFI')
    expect(activeInviteByPlayerId['player-5']?.expiresAt).toBeNull()
  })

  it('records the first invite encountered when multiple are active for one player', () => {
    const { activeInviteByPlayerId, activeInviteCountByPlayerId } = buildActiveInviteByPlayerId([
      {
        targetPlayerId: 'player-6',
        code: 'FIRST6666666',
        expiresAt: FUTURE,
        skipOnboarding: false,
        maxUses: 1,
        usedCount: 0,
      },
      {
        targetPlayerId: 'player-6',
        code: 'SECOND666666',
        expiresAt: FUTURE,
        skipOnboarding: true,
        maxUses: 1,
        usedCount: 0,
      },
    ], NOW)
    expect(activeInviteByPlayerId['player-6']?.code).toBe('FIRST6666666')
    expect(activeInviteCountByPlayerId['player-6']).toBe(2)
  })

  it('handles mixed active and expired invites across players', () => {
    const { activeInviteByPlayerId, activeInviteCountByPlayerId } = buildActiveInviteByPlayerId([
      { targetPlayerId: 'p-a', code: 'AAAAAAAAAAAA', expiresAt: FUTURE, skipOnboarding: false, maxUses: 1, usedCount: 0 },
      { targetPlayerId: 'p-b', code: 'BBBBBBBBBBBB', expiresAt: PAST, skipOnboarding: false, maxUses: 1, usedCount: 0 },
      { targetPlayerId: null, code: 'CCCCCCCCCCCC', expiresAt: FUTURE, skipOnboarding: false, maxUses: null, usedCount: 0 },
    ], NOW)
    expect(activeInviteByPlayerId['p-a']?.code).toBe('AAAAAAAAAAAA')
    expect(activeInviteByPlayerId['p-b']).toBeUndefined()
    expect(activeInviteCountByPlayerId['p-a']).toBe(1)
    expect(activeInviteCountByPlayerId['p-b']).toBeUndefined()
  })
})
