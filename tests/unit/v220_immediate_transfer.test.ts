/**
 * v2.2.0 — immediate transfer + approve.
 *
 * Pins:
 *   1. `computeNextGameWeek` helper exists in admin actions module and
 *      uses the COMPLETED-first / maxGameWeek+1 fallback semantic.
 *      A GW is "played" iff any of its matches has status === 'COMPLETED'.
 *   2. `transferPlayer` signature dropped `fromGameWeek` + `fromLeagueTeamId`
 *      and now takes (playerId, toLeagueTeamId, leagueId). It resolves
 *      nextGameWeek server-side via computeNextGameWeek and handles the
 *      same-GW overwrite case (delete intermediate PLM rather than close).
 *   3. `assignPlayer` signature dropped `fromGameWeek` and now resolves it
 *      server-side.
 *   4. `adminApproveApplication` no longer accepts `fromGameWeek`; uses
 *      computeNextGameWeek result.
 *   5. TransferPanel UI no longer renders the "Effective from" GW dropdown.
 *   6. ApproveApplicationDialog no longer renders the "Active from GW" input
 *      (the `approve-from-gw` testid is gone).
 *   7. PlayersTab no longer takes/threads `maxGameWeek` prop.
 *   8. Runtime: transferPlayer flow correctness — normal transfer,
 *      same-GW overwrite, no-active-team rejection, already-on-destination
 *      rejection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')

const ADMIN_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/admin/leagues/actions.ts'),
  'utf8',
)
const PLAYERS_TAB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/admin/PlayersTab.tsx'),
  'utf8',
)
const PLAYERS_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/admin/leagues/[id]/players/page.tsx'),
  'utf8',
)

function fnBlock(src: string, fnSig: string, size = 4000): string {
  const idx = src.indexOf(fnSig)
  expect(idx).toBeGreaterThan(-1)
  return src.slice(idx, idx + size)
}

// ────────────────────────────────────────────────────────────────────────────
// 1) computeNextGameWeek helper
// ────────────────────────────────────────────────────────────────────────────

describe('v2.2.0 — computeNextGameWeek helper', () => {
  it('is defined as a private async helper in actions.ts', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(
      /async function computeNextGameWeek\(leagueId:\s*string\):\s*Promise<number>/,
    )
  })

  it('queries gameWeek.findMany with matches.status select, ordered weekNumber asc', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'async function computeNextGameWeek', 1100)
    expect(block).toMatch(/prisma\.gameWeek\.findMany/)
    expect(block).toMatch(/where:\s*\{\s*leagueId\s*\}/)
    expect(block).toMatch(/matches:\s*\{\s*select:\s*\{\s*status:\s*true\s*\}\s*\}/)
    expect(block).toMatch(/orderBy:\s*\{\s*weekNumber:\s*['"]asc['"]\s*\}/)
  })

  it('returns the first GW with no COMPLETED matches (COMPLETED-first semantic)', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'async function computeNextGameWeek', 1100)
    expect(block).toMatch(/hasAnyPlayed\s*=\s*gw\.matches\.some\(\(m\)\s*=>\s*m\.status\s*===\s*['"]COMPLETED['"]\)/)
    expect(block).toMatch(/if\s*\(!hasAnyPlayed\)\s*return\s*gw\.weekNumber/)
  })

  it('falls back to maxGameWeek + 1 when every GW has at least one played match', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'async function computeNextGameWeek', 900)
    expect(block).toMatch(/gameWeeks\[gameWeeks\.length\s*-\s*1\]\.weekNumber\s*\+\s*1/)
  })

  it('returns 1 when no GameWeeks exist', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'async function computeNextGameWeek', 900)
    expect(block).toMatch(/if\s*\(gameWeeks\.length\s*===\s*0\)\s*return\s*1/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) transferPlayer signature + body
// ────────────────────────────────────────────────────────────────────────────

describe('v2.2.0 — transferPlayer signature change', () => {
  it('signature drops fromLeagueTeamId + fromGameWeek (now: playerId, toLeagueTeamId, leagueId)', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(
      /export async function transferPlayer\(\s*playerId:\s*string,\s*toLeagueTeamId:\s*string,\s*leagueId:\s*string,?\s*\)/,
    )
  })

  it('does NOT accept the old fromLeagueTeamId / fromGameWeek params', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'export async function transferPlayer', 250)
    expect(block).not.toMatch(/fromLeagueTeamId:\s*string/)
    expect(block).not.toMatch(/fromGameWeek:\s*number/)
  })

  it('calls computeNextGameWeek(leagueId) to resolve the effective GW', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'export async function transferPlayer', 2000)
    expect(block).toMatch(/computeNextGameWeek\(leagueId\)/)
  })

  it('looks up current active PLM by toGameWeek:null + leagueTeam.leagueId', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'export async function transferPlayer', 2000)
    expect(block).toMatch(/tx\.playerLeagueMembership\.findFirst/)
    expect(block).toMatch(/toGameWeek:\s*null/)
    expect(block).toMatch(/leagueTeam:\s*\{\s*leagueId\s*\}/)
  })

  it('rejects when player has no active team in this league', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'export async function transferPlayer', 2000)
    expect(block).toMatch(/Player has no active team in this league/)
  })

  it('rejects when destination team equals current team', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'export async function transferPlayer', 2000)
    expect(block).toMatch(/Player is already on that team/)
  })

  it('overwrite case: DELETE current PLM when currentActive.fromGameWeek === nextGW', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'export async function transferPlayer', 2000)
    expect(block).toMatch(/currentActive\.fromGameWeek\s*===\s*nextGW/)
    expect(block).toMatch(/tx\.playerLeagueMembership\.delete/)
  })

  it('normal case: UPDATE old PLM toGameWeek to nextGW - 1', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'export async function transferPlayer', 2000)
    expect(block).toMatch(/tx\.playerLeagueMembership\.update/)
    expect(block).toMatch(/toGameWeek:\s*nextGW\s*-\s*1/)
  })

  it('creates new PLM with joinSource ADMIN at fromGameWeek = nextGW', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'export async function transferPlayer', 2000)
    expect(block).toMatch(/tx\.playerLeagueMembership\.create/)
    expect(block).toMatch(/fromGameWeek:\s*nextGW/)
    expect(block).toMatch(/joinSource:\s*['"]ADMIN['"]/)
  })

  it('revalidates the admin players page after the transaction', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'export async function transferPlayer', 2000)
    expect(block).toMatch(/revalidate\(\{\s*domain:\s*['"]admin['"],\s*paths:\s*\[`\/admin\/leagues\/\$\{leagueId\}\/players`\]/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) assignPlayer signature
// ────────────────────────────────────────────────────────────────────────────

describe('v2.2.0 — assignPlayer signature change', () => {
  it('drops the fromGameWeek param (now: playerId, leagueTeamId)', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(
      /export async function assignPlayer\(playerId:\s*string,\s*leagueTeamId:\s*string\)/,
    )
  })

  it('resolves fromGameWeek via computeNextGameWeek using the leagueTeam.leagueId lookup', () => {
    const block = fnBlock(ADMIN_ACTIONS_SRC, 'export async function assignPlayer', 800)
    expect(block).toMatch(/leagueTeam\.findUnique/)
    expect(block).toMatch(/computeNextGameWeek\(lt\.leagueId\)/)
    expect(block).toMatch(/joinSource:\s*['"]ADMIN['"]/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) adminApproveApplication uses computeNextGameWeek
// ────────────────────────────────────────────────────────────────────────────

describe('v2.2.0 — adminApproveApplication uses computeNextGameWeek', () => {
  it('signature no longer accepts fromGameWeek', () => {
    const sigBlock = fnBlock(
      ADMIN_ACTIONS_SRC,
      'export async function adminApproveApplication',
      300,
    )
    expect(sigBlock).not.toMatch(/fromGameWeek\?:\s*number/)
    expect(sigBlock).not.toMatch(/fromGameWeek:\s*number/)
  })

  it('body calls computeNextGameWeek(input.leagueId) to resolve fromGameWeek', () => {
    const block = fnBlock(
      ADMIN_ACTIONS_SRC,
      'export async function adminApproveApplication',
      4500,
    )
    expect(block).toMatch(/computeNextGameWeek\(input\.leagueId\)/)
    // Regression: old "fromGameWeek > 0 ? input.fromGameWeek : 1" fallback is gone.
    expect(block).not.toMatch(/input\.fromGameWeek\s*&&\s*input\.fromGameWeek\s*>\s*0/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) PlayersTab UI — GW selectors removed
// ────────────────────────────────────────────────────────────────────────────

describe('v2.2.0 — admin UI no longer surfaces a GW selector', () => {
  it('TransferPanel has no GW dropdown / "Effective from" copy', () => {
    const idx = PLAYERS_TAB_SRC.indexOf('function TransferPanel')
    expect(idx).toBeGreaterThan(-1)
    // Slice the whole function body to the next top-level function.
    const after = PLAYERS_TAB_SRC.slice(idx)
    const end = after.indexOf('\nfunction ', 50)
    const block = end > 0 ? after.slice(0, end) : after
    expect(block).not.toMatch(/Effective from/)
    expect(block).not.toMatch(/futureGWs/)
    expect(block).not.toMatch(/setFromGW\b/)
  })

  it('TransferPanel props no longer include maxGameWeek', () => {
    expect(PLAYERS_TAB_SRC).toMatch(/interface TransferPanelProps\s*\{[^}]*\}/)
    const idx = PLAYERS_TAB_SRC.indexOf('interface TransferPanelProps')
    const propsBlock = PLAYERS_TAB_SRC.slice(idx, idx + 400)
    expect(propsBlock).not.toMatch(/maxGameWeek/)
  })

  it('TransferPanel calls transferPlayer with (playerId, toTeamId, leagueId) — 3 args', () => {
    const idx = PLAYERS_TAB_SRC.indexOf('function TransferPanel')
    const block = PLAYERS_TAB_SRC.slice(idx, idx + 3500)
    expect(block).toMatch(
      /transferPlayer\(\s*player\.id,\s*toTeamId,\s*leagueId\s*\)/,
    )
  })

  it('ApproveApplicationDialog has no "Active from GW" input', () => {
    expect(PLAYERS_TAB_SRC).not.toMatch(/data-testid="approve-from-gw"/)
    expect(PLAYERS_TAB_SRC).not.toMatch(/Active from GW/)
  })

  it('ApproveApplicationDialog props no longer include maxGameWeek', () => {
    const idx = PLAYERS_TAB_SRC.indexOf('interface ApproveApplicationDialogProps')
    const propsBlock = PLAYERS_TAB_SRC.slice(idx, idx + 400)
    expect(propsBlock).not.toMatch(/maxGameWeek/)
  })

  it('adminApproveApplication call site passes only playerId/leagueId/leagueTeamId', () => {
    const idx = PLAYERS_TAB_SRC.indexOf('function ApproveApplicationDialog')
    const block = PLAYERS_TAB_SRC.slice(idx, idx + 3000)
    expect(block).toMatch(
      /adminApproveApplication\(\{[^}]*playerId:\s*player\.id[\s\S]*?\}\)/,
    )
    // The call must NOT pass fromGameWeek as a field anymore.
    const callMatch = block.match(/adminApproveApplication\(\{[\s\S]*?\}\)/)
    expect(callMatch).not.toBeNull()
    expect(callMatch![0]).not.toMatch(/fromGameWeek/)
  })

  it('PlayersTab props no longer include maxGameWeek', () => {
    const idx = PLAYERS_TAB_SRC.indexOf('interface PlayersTabProps')
    const propsBlock = PLAYERS_TAB_SRC.slice(idx, idx + 800)
    expect(propsBlock).not.toMatch(/maxGameWeek/)
  })

  it('admin players page no longer computes / passes maxGameWeek', () => {
    expect(PLAYERS_PAGE_SRC).not.toMatch(/maxGameWeek/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) Runtime — transferPlayer mocked Prisma flow
// ────────────────────────────────────────────────────────────────────────────

const {
  gameWeekFindManyMock,
  plmFindFirstMock,
  plmUpdateMock,
  plmDeleteMock,
  plmCreateMock,
  revalidateMock,
  txMock,
} = vi.hoisted(() => {
  const plmFindFirstMock = vi.fn()
  const plmUpdateMock = vi.fn()
  const plmDeleteMock = vi.fn()
  const plmCreateMock = vi.fn()
  const txMock = {
    playerLeagueMembership: {
      findFirst: plmFindFirstMock,
      update: plmUpdateMock,
      delete: plmDeleteMock,
      create: plmCreateMock,
    },
  }
  return {
    gameWeekFindManyMock: vi.fn(),
    plmFindFirstMock,
    plmUpdateMock,
    plmDeleteMock,
    plmCreateMock,
    revalidateMock: vi.fn(),
    txMock,
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    gameWeek: { findMany: gameWeekFindManyMock },
    playerLeagueMembership: {
      findFirst: plmFindFirstMock,
      update: plmUpdateMock,
      delete: plmDeleteMock,
      create: plmCreateMock,
    },
    leagueTeam: { findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(txMock),
    ),
  },
}))

vi.mock('@/lib/revalidate', () => ({ revalidate: revalidateMock }))
vi.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))
vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ isAdmin: true, userId: 'u-admin' }),
}))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getPlayerMappingFromDb: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/playerMappingStore', () => ({
  setMapping: vi.fn().mockResolvedValue(undefined),
  deleteMapping: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/rsvpStore', () => ({
  seedGameWeek: vi.fn(),
  deleteGameWeek: vi.fn(),
}))
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))
vi.mock('next/headers', () => ({
  headers: () => new Headers(),
  cookies: () => ({ get: () => undefined }),
}))
vi.mock('@/lib/identityLink', () => ({
  linkPlayerToUser: vi.fn(),
  unlinkPlayerFromUser: vi.fn(),
}))
vi.mock('@/lib/email', () => ({ sendMail: vi.fn() }))
vi.mock('@/lib/emailTemplates', () => ({
  applicationApprovedEmail: vi.fn(),
}))

beforeEach(() => {
  gameWeekFindManyMock.mockReset()
  plmFindFirstMock.mockReset()
  plmUpdateMock.mockReset()
  plmDeleteMock.mockReset()
  plmCreateMock.mockReset()
  revalidateMock.mockReset()
})

describe('v2.2.0 — transferPlayer runtime flow', () => {
  it('normal transfer: closes old PLM at nextGW-1, creates new at nextGW with joinSource ADMIN', async () => {
    // GW1 (played), GW2 (played), GW3 (scheduled) → nextGW = 3.
    gameWeekFindManyMock.mockResolvedValue([
      { weekNumber: 1, matches: [{ status: 'COMPLETED' }] },
      { weekNumber: 2, matches: [{ status: 'COMPLETED' }] },
      { weekNumber: 3, matches: [{ status: 'SCHEDULED' }] },
    ])
    plmFindFirstMock.mockResolvedValue({
      id: 'plm-1',
      leagueTeamId: 'lt-A',
      fromGameWeek: 1,
    })
    plmUpdateMock.mockResolvedValue({})
    plmCreateMock.mockResolvedValue({})

    const { transferPlayer } = await import('@/app/admin/leagues/actions')
    await transferPlayer('p-1', 'lt-B', 'league-1')

    expect(plmUpdateMock).toHaveBeenCalledWith({
      where: { id: 'plm-1' },
      data: { toGameWeek: 2 },
    })
    expect(plmDeleteMock).not.toHaveBeenCalled()
    expect(plmCreateMock).toHaveBeenCalledWith({
      data: {
        playerId: 'p-1',
        leagueTeamId: 'lt-B',
        fromGameWeek: 3,
        joinSource: 'ADMIN',
      },
    })
    expect(revalidateMock).toHaveBeenCalledWith({
      domain: 'admin',
      paths: ['/admin/leagues/league-1/players'],
    })
  })

  it('overwrite case: deletes current PLM when it started at the SAME GW we are transferring at', async () => {
    // GW1 played, GW2 scheduled → nextGW = 2.
    // Player was just assigned to Team A at GW2 (previous transfer).
    gameWeekFindManyMock.mockResolvedValue([
      { weekNumber: 1, matches: [{ status: 'COMPLETED' }] },
      { weekNumber: 2, matches: [{ status: 'SCHEDULED' }] },
    ])
    plmFindFirstMock.mockResolvedValue({
      id: 'plm-A-at-gw2',
      leagueTeamId: 'lt-A',
      fromGameWeek: 2,
    })

    const { transferPlayer } = await import('@/app/admin/leagues/actions')
    await transferPlayer('p-1', 'lt-B', 'league-1')

    // Old intermediate PLM is deleted, not closed.
    expect(plmDeleteMock).toHaveBeenCalledWith({ where: { id: 'plm-A-at-gw2' } })
    expect(plmUpdateMock).not.toHaveBeenCalled()
    // New PLM for Team B opens at GW2.
    expect(plmCreateMock).toHaveBeenCalledWith({
      data: {
        playerId: 'p-1',
        leagueTeamId: 'lt-B',
        fromGameWeek: 2,
        joinSource: 'ADMIN',
      },
    })
  })

  it('all-played fallback: nextGW = maxWeekNumber + 1', async () => {
    // All three GWs have at least one COMPLETED match.
    gameWeekFindManyMock.mockResolvedValue([
      { weekNumber: 1, matches: [{ status: 'COMPLETED' }] },
      { weekNumber: 2, matches: [{ status: 'COMPLETED' }] },
      { weekNumber: 5, matches: [{ status: 'COMPLETED' }] },
    ])
    plmFindFirstMock.mockResolvedValue({
      id: 'plm-1',
      leagueTeamId: 'lt-A',
      fromGameWeek: 1,
    })

    const { transferPlayer } = await import('@/app/admin/leagues/actions')
    await transferPlayer('p-1', 'lt-B', 'league-1')

    // nextGW should be 5 + 1 = 6. So old PLM closes at GW5, new opens at GW6.
    expect(plmUpdateMock).toHaveBeenCalledWith({
      where: { id: 'plm-1' },
      data: { toGameWeek: 5 },
    })
    expect(plmCreateMock).toHaveBeenCalledWith({
      data: {
        playerId: 'p-1',
        leagueTeamId: 'lt-B',
        fromGameWeek: 6,
        joinSource: 'ADMIN',
      },
    })
  })

  it('empty-league fallback: nextGW = 1', async () => {
    gameWeekFindManyMock.mockResolvedValue([])
    plmFindFirstMock.mockResolvedValue({
      id: 'plm-1',
      leagueTeamId: 'lt-A',
      fromGameWeek: 1,
    })

    const { transferPlayer } = await import('@/app/admin/leagues/actions')
    await transferPlayer('p-1', 'lt-B', 'league-1')

    // nextGW = 1, currentActive.fromGameWeek === nextGW → DELETE branch.
    expect(plmDeleteMock).toHaveBeenCalledWith({ where: { id: 'plm-1' } })
    expect(plmCreateMock).toHaveBeenCalledWith({
      data: {
        playerId: 'p-1',
        leagueTeamId: 'lt-B',
        fromGameWeek: 1,
        joinSource: 'ADMIN',
      },
    })
  })

  it('empty GW (future placeholder with no matches) is treated as unplayed', async () => {
    // GW1 played, GW2 has zero matches scheduled yet. Next match = GW2.
    gameWeekFindManyMock.mockResolvedValue([
      { weekNumber: 1, matches: [{ status: 'COMPLETED' }] },
      { weekNumber: 2, matches: [] },
    ])
    plmFindFirstMock.mockResolvedValue({
      id: 'plm-1',
      leagueTeamId: 'lt-A',
      fromGameWeek: 1,
    })

    const { transferPlayer } = await import('@/app/admin/leagues/actions')
    await transferPlayer('p-1', 'lt-B', 'league-1')

    expect(plmCreateMock).toHaveBeenCalledWith({
      data: {
        playerId: 'p-1',
        leagueTeamId: 'lt-B',
        fromGameWeek: 2,
        joinSource: 'ADMIN',
      },
    })
  })

  it('throws when player has no active team in this league', async () => {
    gameWeekFindManyMock.mockResolvedValue([
      { weekNumber: 1, matches: [{ status: 'SCHEDULED' }] },
    ])
    plmFindFirstMock.mockResolvedValue(null)

    const { transferPlayer } = await import('@/app/admin/leagues/actions')
    await expect(
      transferPlayer('p-1', 'lt-B', 'league-1'),
    ).rejects.toThrow('Player has no active team in this league')

    expect(plmUpdateMock).not.toHaveBeenCalled()
    expect(plmDeleteMock).not.toHaveBeenCalled()
    expect(plmCreateMock).not.toHaveBeenCalled()
  })

  it('throws when destination team equals current team', async () => {
    gameWeekFindManyMock.mockResolvedValue([
      { weekNumber: 1, matches: [{ status: 'SCHEDULED' }] },
    ])
    plmFindFirstMock.mockResolvedValue({
      id: 'plm-1',
      leagueTeamId: 'lt-A',
      fromGameWeek: 1,
    })

    const { transferPlayer } = await import('@/app/admin/leagues/actions')
    await expect(
      transferPlayer('p-1', 'lt-A', 'league-1'),
    ).rejects.toThrow('Player is already on that team')

    expect(plmUpdateMock).not.toHaveBeenCalled()
    expect(plmDeleteMock).not.toHaveBeenCalled()
    expect(plmCreateMock).not.toHaveBeenCalled()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 7) Version pin
// ────────────────────────────────────────────────────────────────────────────

describe('v2.2.0 — version pin', () => {
  it('APP_VERSION is 2.2.0 or later', async () => {
    const { APP_VERSION } = await import('@/lib/version')
    // Matches 2.2.x or any future 2.[3+].x or 3+.x.x.
    expect(APP_VERSION).toMatch(
      /^2\.2\.\d+$|^2\.[3-9]\d*\.\d+$|^[3-9]\.\d+\.\d+$/,
    )
  })
})
