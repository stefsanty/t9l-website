/**
 * v1.98.0 — viewer-collapse perf refactor regression targets.
 *
 * Pre-v1.98.0 every league-scoped page render fanned out into three
 * independent `getServerSession + prisma.user.findUnique + prisma.player.findUnique`
 * sequences (one in `<HomepageRouter>` via `homepageRouting`, one in
 * `getRecruitingViewerState`, one in `getUnpaidFeeBannerData`). The
 * v1.98.0 refactor centralises that work in the new `src/lib/viewer.ts`
 * helper wrapped in React `cache()` so the per-request dedup is
 * automatic — the three readers above each call `getViewer()` and
 * share one resolved Promise. Separately, the standalone
 * `prisma.league.findUnique` for league.{id,name,abbreviation,ballType}
 * inside `getLeaguePageBundle` is folded onto `getLeagueFlags` (which
 * already cached the same row under the `leagues` tag), removing one
 * Prisma round-trip per render.
 *
 * Each assertion in this file is a regression target — if a future PR
 * reverts the dedup (re-introducing a per-reader getServerSession
 * call, an explicit user.findUnique, or the standalone league fetch
 * in the bundle), one of these tests fails. Stash-pop sanity verified.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const VIEWER_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/viewer.ts'),
  'utf8',
)
const RECRUITING_VIEWER_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/recruitingViewerState.ts'),
  'utf8',
)
const UNPAID_FEE_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/unpaidFeeBanner.ts'),
  'utf8',
)
const HOMEPAGE_ROUTING_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/homepageRouting.ts'),
  'utf8',
)
const HOMEPAGE_ROUTER_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/homepage/HomepageRouter.tsx'),
  'utf8',
)
const LEAGUE_FLAGS_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/leagueFlags.ts'),
  'utf8',
)
const LEAGUE_PAGE_DATA_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/leaguePageData.ts'),
  'utf8',
)
const VERSION_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/version.ts'),
  'utf8',
)
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

// ────────────────────────────────────────────────────────────────────────────
// 1) Version + CLAUDE.md pin
// ────────────────────────────────────────────────────────────────────────────

describe('v1.98.0 — version pin', () => {
  it('APP_VERSION at 1.98.0 or higher (relaxed at v1.99.0 ship)', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"]1\.(9[89]\.\d+|\d{3,}\.\d+)['"]/,
    )
  })

  it('CLAUDE.md header reflects v1.98.0 or a later release', () => {
    expect(CLAUDE_MD).toMatch(
      /\*\*Current release:\*\*\s*v1\.(9[89]\.\d+|\d{3,}\.\d+)/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) viewer.ts shape + cache wrapper
// ────────────────────────────────────────────────────────────────────────────

describe('v1.98.0 — getViewer is the canonical session+user+player helper', () => {
  it('imports cache from react (request-scoped memoization)', () => {
    expect(VIEWER_SRC).toMatch(
      /import\s*\{\s*cache\s*\}\s*from\s*['"]react['"]/,
    )
  })

  it('wraps the helper in cache() so multiple callers per render dedup', () => {
    expect(VIEWER_SRC).toMatch(
      /export\s+const\s+getViewer\s*=\s*cache\(/,
    )
  })

  it('uses next-auth getServerSession + authOptions to read the session', () => {
    expect(VIEWER_SRC).toMatch(
      /import\s*\{\s*getServerSession\s*\}\s*from\s*['"]next-auth['"]/,
    )
    expect(VIEWER_SRC).toMatch(/getServerSession\(\s*authOptions\s*\)/)
  })

  it('Viewer interface declares hasSession + userId + lineId + user + player', () => {
    expect(VIEWER_SRC).toMatch(/hasSession:\s*boolean/)
    expect(VIEWER_SRC).toMatch(/userId:\s*string\s*\|\s*null/)
    expect(VIEWER_SRC).toMatch(/lineId:\s*string\s*\|\s*null/)
    expect(VIEWER_SRC).toMatch(/playerId:\s*string\s*\|\s*null/)
    expect(VIEWER_SRC).toMatch(/defaultLeagueId:\s*string\s*\|\s*null/)
    expect(VIEWER_SRC).toMatch(/player:\s*\{\s*id:\s*string\s*\}\s*\|\s*null/)
  })

  it('looks up User by userId first, falls back to lineId (legacy LINE sessions)', () => {
    const stripped = stripComments(VIEWER_SRC)
    expect(stripped).toMatch(/where:\s*\{\s*id:\s*userId\s*\}/)
    expect(stripped).toMatch(/where:\s*\{\s*lineId\s*\}/)
  })

  it('selects defaultLeagueId on the user lookup so homepageRouting can read it from the cached viewer', () => {
    expect(VIEWER_SRC).toMatch(/defaultLeagueId:\s*true/)
  })

  it('looks up Player via Player.userId back-FK then Player.lineId fallback', () => {
    const stripped = stripComments(VIEWER_SRC)
    expect(stripped).toMatch(/prisma\.player\.findUnique[\s\S]+?where:\s*\{\s*userId:\s*user\.id\s*\}/)
    expect(stripped).toMatch(/prisma\.player\.findFirst[\s\S]+?where:\s*\{\s*lineId\s*\}/)
  })

  it('distinguishes no-session (hasSession=false) from admin-credentials session (hasSession=true, no userId/lineId)', () => {
    const stripped = stripComments(VIEWER_SRC)
    // No-session branch sets hasSession: false
    expect(stripped).toMatch(/hasSession:\s*false/)
    // Admin-credentials branch sets hasSession: true with userId/lineId null
    expect(stripped).toMatch(/hasSession:\s*true,\s*userId:\s*null,\s*lineId:\s*null/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 3) getRecruitingViewerState — pre-v1.98.0 anti-patterns are gone
// ────────────────────────────────────────────────────────────────────────────

describe('v1.98.0 — getRecruitingViewerState delegates to getViewer', () => {
  it('imports getViewer from @/lib/viewer', () => {
    expect(RECRUITING_VIEWER_SRC).toMatch(
      /import\s*\{\s*getViewer\s*\}\s*from\s*['"]@\/lib\/viewer['"]/,
    )
  })

  it('calls getViewer() before any per-league Prisma query', () => {
    expect(RECRUITING_VIEWER_SRC).toMatch(/getViewer\(\s*\)/)
  })

  it('no longer calls getServerSession itself (regression target — pre-v1.98.0 anti-pattern)', () => {
    const stripped = stripComments(RECRUITING_VIEWER_SRC)
    expect(stripped).not.toMatch(/getServerSession\s*\(/)
  })

  it('no longer imports getServerSession (regression target — pre-v1.98.0 import was at top of file)', () => {
    const stripped = stripComments(RECRUITING_VIEWER_SRC)
    expect(stripped).not.toMatch(/from\s*['"]next-auth['"]/)
  })

  it('no longer carries the explicit !player && lineId Player fallback (regression target — folded into getViewer)', () => {
    const stripped = stripComments(RECRUITING_VIEWER_SRC)
    expect(stripped).not.toMatch(/!player\s*&&\s*lineId/)
  })

  it('uses viewer.hasSession to gate the unauthenticated branch', () => {
    expect(RECRUITING_VIEWER_SRC).toMatch(/!viewer\.hasSession/)
  })

  it('uses viewer.player to gate the no_player branch', () => {
    expect(RECRUITING_VIEWER_SRC).toMatch(/!viewer\.player/)
  })

  it('reads viewer.player.id when running the per-league leagueAssignments query', () => {
    expect(RECRUITING_VIEWER_SRC).toMatch(/where:\s*\{\s*id:\s*viewer\.player\.id\s*\}/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 4) getUnpaidFeeBannerData — pre-v1.98.0 anti-patterns are gone
// ────────────────────────────────────────────────────────────────────────────

describe('v1.98.0 — getUnpaidFeeBannerData delegates to getViewer', () => {
  it('imports getViewer from @/lib/viewer', () => {
    expect(UNPAID_FEE_SRC).toMatch(
      /import\s*\{\s*getViewer\s*\}\s*from\s*['"]@\/lib\/viewer['"]/,
    )
  })

  it('calls getViewer() before any per-league Prisma query', () => {
    expect(UNPAID_FEE_SRC).toMatch(/getViewer\(\s*\)/)
  })

  it('no longer calls getServerSession itself (regression target — pre-v1.98.0 anti-pattern)', () => {
    const stripped = stripComments(UNPAID_FEE_SRC)
    expect(stripped).not.toMatch(/getServerSession\s*\(/)
  })

  it('no longer imports getServerSession (regression target — pre-v1.98.0 import was at top of file)', () => {
    const stripped = stripComments(UNPAID_FEE_SRC)
    expect(stripped).not.toMatch(/from\s*['"]next-auth['"]/)
  })

  it('no longer runs prisma.user.findUnique (regression target — viewer carries the user row)', () => {
    const stripped = stripComments(UNPAID_FEE_SRC)
    expect(stripped).not.toMatch(/prisma\.user\.findUnique/)
  })

  it('reads viewer.user.playerId on the per-league PLM lookup', () => {
    expect(UNPAID_FEE_SRC).toMatch(/playerId:\s*viewer\.user\.playerId/)
  })

  it('still runs the per-league plm.findFirst (genuinely scoped to leagueId)', () => {
    expect(UNPAID_FEE_SRC).toMatch(/prisma\.playerLeagueMembership\.findFirst/)
  })

  it('still runs the per-league league.findUnique for fee + paymentBannerEnabled', () => {
    expect(UNPAID_FEE_SRC).toMatch(/prisma\.league\.findUnique/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 5) homepageRouting.getApprovedMembershipsAndDefault — same delegation
// ────────────────────────────────────────────────────────────────────────────

describe('v1.98.0 — homepageRouting delegates to getViewer', () => {
  it('imports getViewer', () => {
    expect(HOMEPAGE_ROUTING_SRC).toMatch(
      /import\s*\{\s*getViewer\s*\}\s*from\s*['"]@\/lib\/viewer['"]/,
    )
  })

  it('calls getViewer() inside getApprovedMembershipsAndDefault', () => {
    // Match from the function header to the `const memberships = Array.from`
    // line — that bounds the body before the dedupe+sort tail without
    // tripping on the Promise<{ ... }> return-type generic braces. If
    // getViewer is moved out of the function body, the slice no longer
    // contains it.
    const fnStart = HOMEPAGE_ROUTING_SRC.indexOf(
      'export async function getApprovedMembershipsAndDefault',
    )
    const fnEnd = HOMEPAGE_ROUTING_SRC.indexOf(
      'const memberships = Array.from',
      fnStart,
    )
    expect(fnStart).toBeGreaterThan(-1)
    expect(fnEnd).toBeGreaterThan(fnStart)
    const body = HOMEPAGE_ROUTING_SRC.slice(fnStart, fnEnd)
    expect(body).toMatch(/getViewer\(\s*\)/)
  })

  it('no longer runs its own prisma.user.findUnique (regression target — viewer carries the user row)', () => {
    const stripped = stripComments(HOMEPAGE_ROUTING_SRC)
    expect(stripped).not.toMatch(/prisma\.user\.findUnique/)
  })

  it('reads viewer.user for defaultLeagueId + playerId access', () => {
    expect(HOMEPAGE_ROUTING_SRC).toMatch(/viewer\.user/)
  })

  it('still runs the per-player leagueAssignments query (genuinely user-scoped)', () => {
    // The leagueAssignments + leagueTeam.league select pattern is the
    // load-bearing per-render work that cannot be folded into viewer
    // because the filter (APPROVED, toGameWeek null, leagueTeamId not
    // null) differs from what other consumers need.
    expect(HOMEPAGE_ROUTING_SRC).toMatch(/leagueAssignments/)
    expect(HOMEPAGE_ROUTING_SRC).toMatch(/applicationStatus:\s*['"]APPROVED['"]/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 6) HomepageRouter — uses getViewer
// ────────────────────────────────────────────────────────────────────────────

describe('v1.98.0 — HomepageRouter uses getViewer', () => {
  it('imports getViewer', () => {
    expect(HOMEPAGE_ROUTER_SRC).toMatch(
      /import\s*\{\s*getViewer\s*\}\s*from\s*['"]@\/lib\/viewer['"]/,
    )
  })

  it('calls getViewer() instead of getServerSession directly', () => {
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/getViewer\(\s*\)/)
    const stripped = stripComments(HOMEPAGE_ROUTER_SRC)
    expect(stripped).not.toMatch(/getServerSession\s*\(/)
  })

  it('no longer imports authOptions or next-auth (regression target)', () => {
    const stripped = stripComments(HOMEPAGE_ROUTER_SRC)
    expect(stripped).not.toMatch(/from\s*['"]next-auth['"]/)
    expect(stripped).not.toMatch(/from\s*['"]@\/lib\/auth['"]/)
  })

  it('preserves the v1.93.0 viewer={{ userId, lineId }} prop shape on <MultiLeagueHub>', () => {
    expect(HOMEPAGE_ROUTER_SRC).toMatch(/viewer=\{\{\s*userId,\s*lineId\s*\}\}/)
  })

  it('preserves the v1.97.5 cookie read + resolveHomepagePersona call shape', () => {
    expect(HOMEPAGE_ROUTER_SRC).toMatch(
      /import\s*\{\s*cookies\s*\}\s*from\s*['"]next\/headers['"]/,
    )
    expect(HOMEPAGE_ROUTER_SRC).toMatch(
      /resolveHomepagePersona\(\s*\{\s*userId,\s*lineId,/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 7) getLeagueFlags — identity columns folded onto the cached read
// ────────────────────────────────────────────────────────────────────────────

describe('v1.98.0 — getLeagueFlags carries league identity columns', () => {
  it('selects id, name, abbreviation, ballType alongside the legacy flags', () => {
    expect(LEAGUE_FLAGS_SRC).toMatch(/\bid:\s*true/)
    expect(LEAGUE_FLAGS_SRC).toMatch(/\bname:\s*true/)
    expect(LEAGUE_FLAGS_SRC).toMatch(/abbreviation:\s*true/)
    expect(LEAGUE_FLAGS_SRC).toMatch(/ballType:\s*true/)
  })

  it('returns league: { id, name, abbreviation, ballType } | null', () => {
    expect(LEAGUE_FLAGS_SRC).toMatch(
      /league:\s*\{\s*\n[\s\S]+?id:\s*string\s*\n[\s\S]+?name:\s*string\s*\n[\s\S]+?abbreviation:\s*string\s*\|\s*null\s*\n[\s\S]+?ballType:\s*['"]SOCCER['"]\s*\|\s*['"]FUTSAL['"]/,
    )
  })

  it('DEFAULT_FLAGS sets league: null (missing row + Prisma rejection both fall through)', () => {
    expect(LEAGUE_FLAGS_SRC).toMatch(
      /DEFAULT_FLAGS:\s*LeagueFlags\s*=\s*\{[\s\S]+?league:\s*null[\s\S]+?\}/,
    )
  })

  it('runtime: returns { flags + league: { ... } } when the row exists', async () => {
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        league: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'l-xyz',
            name: 'XYZ League',
            abbreviation: 'XYZ',
            ballType: 'FUTSAL',
            preseasonMode: false,
            recruiting: true,
            visibility: 'PUBLIC_OPEN',
          }),
        },
      },
    }))
    const { __readLeagueFlags_for_testing } = await import('@/lib/leagueFlags')
    const result = await __readLeagueFlags_for_testing('l-xyz')
    expect(result).toEqual({
      preseasonMode: false,
      recruiting: true,
      visibility: 'PUBLIC_OPEN',
      league: {
        id: 'l-xyz',
        name: 'XYZ League',
        abbreviation: 'XYZ',
        ballType: 'FUTSAL',
      },
    })
  })

  it('runtime: returns league: null on missing row', async () => {
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        league: { findUnique: vi.fn().mockResolvedValue(null) },
      },
    }))
    const { __readLeagueFlags_for_testing } = await import('@/lib/leagueFlags')
    const result = await __readLeagueFlags_for_testing('nope')
    expect(result.league).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 8) getLeaguePageBundle — standalone league.findUnique is GONE
// ────────────────────────────────────────────────────────────────────────────

describe('v1.98.0 — getLeaguePageBundle drops the standalone league.findUnique', () => {
  it('no longer imports prisma (regression target — the only consumer of prisma here was the standalone league read)', () => {
    const stripped = stripComments(LEAGUE_PAGE_DATA_SRC)
    expect(stripped).not.toMatch(/from\s*['"]@\/lib\/prisma['"]/)
  })

  it('no longer calls prisma.league.findUnique directly (regression target)', () => {
    const stripped = stripComments(LEAGUE_PAGE_DATA_SRC)
    expect(stripped).not.toMatch(/prisma\.league\.findUnique/)
  })

  it('populates bundle.league from flags.league (the v1.98.0 fold target)', () => {
    expect(LEAGUE_PAGE_DATA_SRC).toMatch(/league:\s*flags\.league/)
  })

  it('Promise.all returns one fewer slot than pre-v1.98.0 (6 instead of 7)', () => {
    // Bundle destructures the awaited Promise.all array. Pre-v1.98.0 the
    // tuple had 7 slots (the 7th was `league` for the dropped findUnique).
    // Post-v1.98.0 it has 6. We count the destructured names — if a
    // future PR re-adds the standalone read, the count goes back up.
    const match = LEAGUE_PAGE_DATA_SRC.match(
      /const\s*\[\s*([\s\S]+?)\s*\]\s*=\s*await\s+Promise\.all\(/,
    )
    expect(match).not.toBeNull()
    const names = match![1].split(',').map((n) => n.trim()).filter(Boolean)
    expect(names).toEqual([
      'data',
      'flags',
      'recruitingState',
      'unpaidFee',
      'plannedRosterStats',
      'leagueDetails',
    ])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 9) Runtime: getViewer dedupes session+user+player within a render
// ────────────────────────────────────────────────────────────────────────────

describe('v1.98.0 — runtime: getViewer call shape against mocks', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('resolves session + user + player by userId path', async () => {
    vi.doMock('next-auth', () => ({
      getServerSession: vi.fn().mockResolvedValue({ userId: 'u-1', lineId: null }),
    }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    const userFind = vi.fn().mockResolvedValue({
      id: 'u-1',
      playerId: 'p-1',
      defaultLeagueId: 'l-a',
    })
    const playerFind = vi.fn().mockResolvedValue({ id: 'p-1' })
    const playerFindFirst = vi.fn()
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        user: { findUnique: userFind },
        player: { findUnique: playerFind, findFirst: playerFindFirst },
      },
    }))
    const { getViewer } = await import('@/lib/viewer')
    const v = await getViewer()
    expect(v.hasSession).toBe(true)
    expect(v.userId).toBe('u-1')
    expect(v.user).toEqual({
      id: 'u-1',
      playerId: 'p-1',
      defaultLeagueId: 'l-a',
    })
    expect(v.player).toEqual({ id: 'p-1' })
    // Player back-FK lookup fired; the lineId-fallback findFirst did not.
    expect(playerFind).toHaveBeenCalledWith({
      where: { userId: 'u-1' },
      select: { id: true },
    })
    expect(playerFindFirst).not.toHaveBeenCalled()
  })

  it('falls back to lineId when User.userId path returns null', async () => {
    vi.doMock('next-auth', () => ({
      getServerSession: vi.fn().mockResolvedValue({ userId: null, lineId: 'L-XYZ' }),
    }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    const userFind = vi.fn().mockResolvedValueOnce({
      id: 'u-line',
      playerId: null,
      defaultLeagueId: null,
    })
    const playerFind = vi.fn().mockResolvedValueOnce(null)
    const playerFindFirst = vi.fn().mockResolvedValueOnce({ id: 'p-line' })
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        user: { findUnique: userFind },
        player: { findUnique: playerFind, findFirst: playerFindFirst },
      },
    }))
    const { getViewer } = await import('@/lib/viewer')
    const v = await getViewer()
    expect(v.hasSession).toBe(true)
    expect(v.lineId).toBe('L-XYZ')
    expect(v.user?.id).toBe('u-line')
    // findUnique was called with lineId since userId was null.
    expect(userFind).toHaveBeenCalledWith({
      where: { lineId: 'L-XYZ' },
      select: { id: true, playerId: true, defaultLeagueId: true },
    })
    expect(v.player).toEqual({ id: 'p-line' })
    expect(playerFindFirst).toHaveBeenCalledWith({
      where: { lineId: 'L-XYZ' },
      select: { id: true },
    })
  })

  it('returns hasSession=false when getServerSession returns null', async () => {
    vi.doMock('next-auth', () => ({
      getServerSession: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        user: { findUnique: vi.fn() },
        player: { findUnique: vi.fn(), findFirst: vi.fn() },
      },
    }))
    const { getViewer } = await import('@/lib/viewer')
    const v = await getViewer()
    expect(v).toEqual({
      hasSession: false,
      userId: null,
      lineId: null,
      user: null,
      player: null,
    })
  })

  it('returns hasSession=true with userId=null for admin-credentials session (no userId/lineId)', async () => {
    vi.doMock('next-auth', () => ({
      getServerSession: vi.fn().mockResolvedValue({ isAdmin: true }),
    }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        user: { findUnique: vi.fn() },
        player: { findUnique: vi.fn(), findFirst: vi.fn() },
      },
    }))
    const { getViewer } = await import('@/lib/viewer')
    const v = await getViewer()
    expect(v.hasSession).toBe(true)
    expect(v.userId).toBeNull()
    expect(v.lineId).toBeNull()
    expect(v.user).toBeNull()
    expect(v.player).toBeNull()
  })

  it('survives user.findUnique rejection (returns user: null with hasSession=true)', async () => {
    vi.doMock('next-auth', () => ({
      getServerSession: vi.fn().mockResolvedValue({ userId: 'u-1' }),
    }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        user: { findUnique: vi.fn().mockRejectedValue(new Error('boom')) },
        player: { findUnique: vi.fn(), findFirst: vi.fn() },
      },
    }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getViewer } = await import('@/lib/viewer')
    const v = await getViewer()
    expect(v.hasSession).toBe(true)
    expect(v.userId).toBe('u-1')
    expect(v.user).toBeNull()
    expect(v.player).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
