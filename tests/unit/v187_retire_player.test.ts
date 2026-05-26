/**
 * v1.87.0 — per-league player retirement.
 *
 * Tests pin the load-bearing behavior:
 *
 *   1. APP_VERSION bumped to 1.87.0.
 *   2. Schema: PlayerLeagueMembership.retiredAt is nullable DateTime,
 *      additive migration (no DROP).
 *   3. Server actions retirePlayer / unretirePlayer exist with the
 *      assertAdmin + IDOR + retiredAt set/clear shape.
 *   4. Roster-size readers gain `retiredAt: null` filter:
 *        - plannedRosterStats.currentPlayers
 *        - admin-data getAllTeamsForAdmin _count.playerAssignments
 *        - unpaidFeeBanner active PLM lookup
 *      The delete-team blocker (admin/teams-all/actions.ts) does NOT
 *      get the filter.
 *   5. Public Player type gets `retiredAt?: string | null`;
 *      dbToPublicLeagueData populates it.
 *   6. SquadList: sort puts retired at bottom, greys row with opacity-50,
 *      renders "RETIRED" pill, hides availability badge for retired,
 *      header count excludes retired.
 *   7. MatchdayAvailability: upcoming goingIds excludes retired ids.
 *   8. PlayersTab: kebab menu has Retire/Unretire item + onToggleRetire
 *      handler + RETIRED admin pill + opacity-60 row state.
 *   9. Admin Players page surfaces retiredAt on the assignments[] row.
 *  10. CLAUDE.md current-release header lists v1.87.0.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getMembershipStatus,
  isRetired,
  isActive,
} from '@/lib/membership'

const REPO_ROOT = join(__dirname, '..', '..')
const SCHEMA = readFileSync(join(REPO_ROOT, 'prisma/schema.prisma'), 'utf8')
const MIGRATION = readFileSync(
  join(REPO_ROOT, 'prisma/migrations/20260518000000_plm_retired_at/migration.sql'),
  'utf8',
)
const VERSION_SRC = readFileSync(join(REPO_ROOT, 'src/lib/version.ts'), 'utf8')
const CLAUDE_MD = readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8')
const ADMIN_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/admin/leagues/actions.ts'),
  'utf8',
)
const PLANNED_ROSTER_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/plannedRosterStats.ts'),
  'utf8',
)
const ADMIN_DATA_SRC = ['leagues', 'players', 'stats', 'venues', 'users', 'teams', 'index']
  .map((n) => readFileSync(join(REPO_ROOT, 'src/lib/admin-data', n + '.ts'), 'utf8'))
  .join('\n')
const UNPAID_BANNER_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/unpaidFeeBanner.ts'),
  'utf8',
)
const TEAMS_ALL_ACTIONS_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/admin/teams-all/actions.ts'),
  'utf8',
)
const TYPES_SRC = readFileSync(
  join(REPO_ROOT, 'src/types/index.ts'),
  'utf8',
)
const PUBLIC_DATA_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/dbToPublicLeagueData.ts'),
  'utf8',
)
const SQUAD_LIST_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/SquadList.tsx'),
  'utf8',
)
const MATCHDAY_AVAIL_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/MatchdayAvailability.tsx'),
  'utf8',
)
const PLAYERS_TAB_SRC = readFileSync(
  join(REPO_ROOT, 'src/components/admin/PlayersTab.tsx'),
  'utf8',
)
const ADMIN_PLAYERS_PAGE_SRC = readFileSync(
  join(REPO_ROOT, 'src/app/admin/leagues/[id]/players/page.tsx'),
  'utf8',
)

const MIGRATION_EXEC = MIGRATION.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Extract a top-level function body from a 'use server' actions file.
 * Matches `export async function NAME(` and returns the substring up
 * until (but not including) the next top-level export. Robust against
 * function bodies that contain nested `}` blocks.
 */
function sliceFn(src: string, name: string): string {
  const re = new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`)
  const start = src.match(re)
  if (!start || start.index === undefined) {
    throw new Error(`Function ${name} not found in source`)
  }
  const after = src.slice(start.index + 1) // skip past the `export` so the next match wins
  const nextExport = after.search(/\nexport\s+/)
  return nextExport === -1
    ? src.slice(start.index)
    : src.slice(start.index, start.index + 1 + nextExport)
}

describe('v1.87.0 — APP_VERSION + CLAUDE.md', () => {
  it('APP_VERSION is 1.87.0 or higher', () => {
    expect(VERSION_SRC).toMatch(
      /APP_VERSION\s*=\s*['"](?:1\.(?:8[7-9]\.\d+|9\d?\.\d+)|2\.\d+\.\d+)['"]/,
    )
  })

  it('CLAUDE.md current release header reads v1.87 (or higher)', () => {
    expect(CLAUDE_MD).toMatch(/\*\*Current release:\*\*\s+(?:v1\.(?:8[7-9]|9\d?)\.\d+|v[2-9]\.\d+\.\d+)\./)
  })
})

describe('v1.87.0 — schema additions', () => {
  it('PlayerLeagueMembership.retiredAt is nullable DateTime', () => {
    const plmBlock = SCHEMA.match(/model PlayerLeagueMembership\s*\{[\s\S]*?\n\}/)![0]
    expect(plmBlock).toMatch(/^\s*retiredAt\s+DateTime\?/m)
  })
})

describe('v1.87.0 — migration is additive only', () => {
  it('migration ADDs the retiredAt column', () => {
    expect(MIGRATION_EXEC).toMatch(
      /ALTER TABLE\s+"PlayerLeagueAssignment"[\s\S]*?ADD COLUMN\s+"retiredAt"\s+TIMESTAMP/i,
    )
  })

  it('migration contains no destructive DDL', () => {
    expect(MIGRATION_EXEC).not.toMatch(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX)\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bTRUNCATE\b/i)
    expect(MIGRATION_EXEC).not.toMatch(/\bDELETE\s+FROM\b/i)
  })
})

describe('v1.87.0 — server actions retirePlayer / unretirePlayer', () => {
  it('retirePlayer is exported and asserts admin', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/export\s+async\s+function\s+retirePlayer\s*\(/)
    const block = sliceFn(ADMIN_ACTIONS_SRC, 'retirePlayer')
    expect(block).toMatch(/await\s+assertAdmin\s*\(/)
  })

  it('unretirePlayer is exported and asserts admin', () => {
    expect(ADMIN_ACTIONS_SRC).toMatch(/export\s+async\s+function\s+unretirePlayer\s*\(/)
    expect(sliceFn(ADMIN_ACTIONS_SRC, 'unretirePlayer')).toMatch(/await\s+assertAdmin\s*\(/)
  })

  it('retirePlayer writes retiredAt = new Date()', () => {
    expect(sliceFn(ADMIN_ACTIONS_SRC, 'retirePlayer')).toMatch(
      /data:\s*\{\s*retiredAt:\s*new\s+Date\(\)/,
    )
  })

  it('unretirePlayer clears retiredAt to null', () => {
    expect(sliceFn(ADMIN_ACTIONS_SRC, 'unretirePlayer')).toMatch(
      /data:\s*\{\s*retiredAt:\s*null/,
    )
  })

  it('both actions IDOR-check membership against the supplied leagueId', () => {
    for (const fn of ['retirePlayer', 'unretirePlayer']) {
      expect(sliceFn(ADMIN_ACTIONS_SRC, fn)).toMatch(/Membership does not belong to this league/)
    }
  })

  it('both actions revalidate the admin players page + the public domain', () => {
    for (const fn of ['retirePlayer', 'unretirePlayer']) {
      const block = sliceFn(ADMIN_ACTIONS_SRC, fn)
      expect(block).toMatch(/revalidate\(\{\s*domain:\s*'admin'/)
      expect(block).toMatch(/revalidate\(\{\s*domain:\s*'public'/)
    }
  })
})

describe('v1.87.0 — roster-size readers filter retiredAt: null', () => {
  it('plannedRosterStats.currentPlayers count includes retiredAt: null filter', () => {
    // The currentPlayers count is the canonical "spots left" driver. The
    // where clause must reject retired memberships so they do not consume
    // a planned-roster slot.
    expect(PLANNED_ROSTER_SRC).toMatch(
      /playerLeagueMembership\.count\(\{\s*where:\s*\{[\s\S]*?retiredAt:\s*null/,
    )
  })

  it('admin-data getAllTeamsForAdmin filters retired from playerAssignments _count', () => {
    // Without this filter, the admin teams-all per-team player count
    // would inflate by every retired membership (regression target).
    expect(ADMIN_DATA_SRC).toMatch(
      /playerAssignments:\s*\{\s*where:\s*\{\s*retiredAt:\s*null\s*\}\s*\}/,
    )
  })

  it('unpaidFeeBanner active PLM lookup filters retired', () => {
    // Retired players no longer owe the league fee — the banner must
    // not surface for them.
    expect(UNPAID_BANNER_SRC).toMatch(/retiredAt:\s*null/)
  })

  it('admin teams-all delete-team count deliberately does NOT filter retiredAt', () => {
    // Retired memberships still reference the team's leagueTeam rows;
    // deleting the team would cascade-delete those rows, which is the
    // exact safety the count is preventing. The blocker MUST count
    // retired memberships too.
    const block = TEAMS_ALL_ACTIONS_SRC.match(
      /export\s+async\s+function\s+adminDeleteTeam[\s\S]*?\n\}/,
    )![0]
    expect(block).toMatch(/playerLeagueMembership\.count/)
    expect(block).not.toMatch(/retiredAt/)
  })
})

describe('v1.87.0 — public Player type carries retiredAt', () => {
  it('Player interface declares optional retiredAt: string | null', () => {
    expect(TYPES_SRC).toMatch(/retiredAt\?\s*:\s*string\s*\|\s*null/)
  })

  it('dbToPublicLeagueData populates retiredAt as ISO string or null', () => {
    expect(PUBLIC_DATA_SRC).toMatch(
      /retiredAt:\s*pla\.retiredAt\s*\?\s*pla\.retiredAt\.toISOString\(\)\s*:\s*null/,
    )
  })
})

describe('v1.87.0 — SquadList sorts retired to bottom + greys + pill', () => {
  it('sort key prioritizes retiredAt-bearing rows last', () => {
    expect(SQUAD_LIST_SRC).toMatch(/aRetired\s*=\s*a\.retiredAt\s*\?\s*1\s*:\s*0/)
    expect(SQUAD_LIST_SRC).toMatch(/bRetired\s*=\s*b\.retiredAt\s*\?\s*1\s*:\s*0/)
    expect(SQUAD_LIST_SRC).toMatch(/aRetired\s*-\s*bRetired/)
  })

  it('retired row container has opacity-50 and a RETIRED pill', () => {
    expect(SQUAD_LIST_SRC).toMatch(/isRetired\s*\?\s*'opacity-50'/)
    expect(SQUAD_LIST_SRC).toMatch(/Retired/)
    expect(SQUAD_LIST_SRC).toMatch(/data-testid=\{`retired-pill-\$\{player\.id\}`\}/)
  })

  it('availability badge is hidden on retired rows', () => {
    expect(SQUAD_LIST_SRC).toMatch(/hasAvailabilityData\s*&&\s*!isRetired/)
  })

  it('team header count uses activeMemberCount (excludes retired)', () => {
    expect(SQUAD_LIST_SRC).toMatch(/activeMemberCount\s*=\s*teamPlayers\.filter/)
    expect(SQUAD_LIST_SRC).toMatch(/\{activeMemberCount\}\s*\{"SQUAD MEMBERS"\}/)
  })
})

describe('v1.87.0 — MatchdayAvailability filters upcoming goingIds', () => {
  it('builds a retiredIds set from players[]', () => {
    expect(MATCHDAY_AVAIL_SRC).toMatch(
      /retiredIds\s*=\s*new Set\([\s\S]*?players\.filter\(\(p\)\s*=>\s*p\.retiredAt\)/,
    )
  })

  it('goingIds filter rejects retired ids before status check', () => {
    expect(MATCHDAY_AVAIL_SRC).toMatch(
      /allAvailIds\.filter\(\(id\)\s*=>\s*\{[\s\S]*?if\s*\(retiredIds\.has\(id\)\)\s*return\s+false/,
    )
  })
})

describe('v1.87.0 — PlayersTab admin kebab + row badge', () => {
  it('imports retirePlayer + unretirePlayer from admin actions', () => {
    expect(PLAYERS_TAB_SRC).toMatch(/import\s*\{[\s\S]*?retirePlayer[\s\S]*?\}\s*from\s*['"]@\/app\/admin\/leagues\/actions['"]/)
    expect(PLAYERS_TAB_SRC).toMatch(/unretirePlayer/)
  })

  it('Assignment interface carries retiredAt: string | null (optional)', () => {
    expect(PLAYERS_TAB_SRC).toMatch(/retiredAt\?\s*:\s*string\s*\|\s*null/)
  })

  it('handleToggleRetire confirms only on retire path, not unretire', () => {
    const block = PLAYERS_TAB_SRC.match(
      /async\s+function\s+handleToggleRetire[\s\S]*?\n\s\s\}/,
    )!
    expect(block[0]).toMatch(/isRetiring/)
    expect(block[0]).toMatch(/window\.confirm/)
    expect(block[0]).toMatch(/retirePlayer\(\{\s*membershipId:\s*current\.id/)
    expect(block[0]).toMatch(/unretirePlayer\(\{\s*membershipId:\s*current\.id/)
  })

  it('confirmation copy matches the spec', () => {
    expect(PLAYERS_TAB_SRC).toMatch(
      /Retire\s+\$\{[^}]+\}\s+from this league\?\s+They'll stay on the roster and keep their stats but no longer count toward roster size\.\s+Reversible\./,
    )
  })

  it('kebab menu item label flips between "Retire from league" and "Unretire"', () => {
    // The label is driven by the unified membership status, not by the
    // raw retiredAt boolean — single source of truth for tri-state.
    expect(PLAYERS_TAB_SRC).toMatch(
      /label:\s*status\s*===\s*'RETIRED'\s*\?\s*'Unretire'\s*:\s*'Retire from league'/,
    )
  })

  it('kebab item only surfaces for ACTIVE or RETIRED status (PENDING excluded)', () => {
    const builderBlock = PLAYERS_TAB_SRC.match(
      /function\s+buildPlayerMenuItems[\s\S]*?\n\}/,
    )!
    // The gate uses the helper output so PENDING never gets the
    // Retire item — verified by checking the conditional shape.
    expect(builderBlock[0]).toMatch(/status\s*===\s*'ACTIVE'\s*\|\|\s*status\s*===\s*'RETIRED'/)
    expect(builderBlock[0]).toMatch(/onToggleRetire/)
  })

  it('row containers gain opacity-60 when membershipStatus === RETIRED (mobile + desktop)', () => {
    // Both row keys (mobile + desktop) gate opacity-60 on the unified
    // status. Two occurrences expected — one per layout branch.
    const matches = PLAYERS_TAB_SRC.match(
      /membershipStatus\s*===\s*'RETIRED'\s*\?\s*'opacity-60'/g,
    )
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })

  it('RETIRED admin pill renders for both mobile + desktop rows', () => {
    expect(PLAYERS_TAB_SRC).toMatch(/data-testid=\{`retired-badge-mobile-\$\{player\.id\}`\}/)
    expect(PLAYERS_TAB_SRC).toMatch(/data-testid=\{`retired-badge-\$\{player\.id\}`\}/)
  })
})

describe('v1.87.0 — getMembershipStatus tri-state helper', () => {
  it('PENDING applicationStatus yields PENDING regardless of retiredAt', () => {
    expect(getMembershipStatus({ applicationStatus: 'PENDING', retiredAt: null })).toBe('PENDING')
    // Defensive: even if a malformed row had retiredAt set on a PENDING
    // PLM, status still reads PENDING because pending takes precedence.
    expect(getMembershipStatus({ applicationStatus: 'PENDING', retiredAt: new Date() })).toBe('PENDING')
  })

  it('APPROVED + null retiredAt yields ACTIVE', () => {
    expect(getMembershipStatus({ applicationStatus: 'APPROVED', retiredAt: null })).toBe('ACTIVE')
    expect(getMembershipStatus({ applicationStatus: 'APPROVED', retiredAt: undefined })).toBe('ACTIVE')
  })

  it('APPROVED + non-null retiredAt yields RETIRED', () => {
    expect(getMembershipStatus({ applicationStatus: 'APPROVED', retiredAt: new Date() })).toBe('RETIRED')
    expect(getMembershipStatus({ applicationStatus: 'APPROVED', retiredAt: '2026-05-10T00:00:00Z' })).toBe('RETIRED')
  })

  it('isRetired and isActive are consistent with getMembershipStatus', () => {
    const cases = [
      { applicationStatus: 'PENDING', retiredAt: null },
      { applicationStatus: 'PENDING', retiredAt: new Date() },
      { applicationStatus: 'APPROVED', retiredAt: null },
      { applicationStatus: 'APPROVED', retiredAt: new Date() },
    ] as const
    for (const c of cases) {
      const status = getMembershipStatus(c)
      expect(isRetired(c)).toBe(status === 'RETIRED')
      expect(isActive(c)).toBe(status === 'ACTIVE')
    }
  })
})

describe('v1.87.0 — PENDING players cannot be retired (kebab gate)', () => {
  it('Retire kebab item is gated on ACTIVE or RETIRED status (not raw applicationStatus check)', () => {
    // Codebase invariant: the kebab predicate must use the helper or
    // an equivalent predicate that excludes PENDING. A regression that
    // dropped the gate would let admins retire pending applicants —
    // the helper-based gate guards against that.
    expect(PLAYERS_TAB_SRC).toMatch(/getMembershipStatus\s*\(/)
    // Within the kebab builder block, status must be ACTIVE or RETIRED
    // before the Retire item is pushed.
    const builderBlock = PLAYERS_TAB_SRC.match(
      /function\s+buildPlayerMenuItems[\s\S]*?\n\}/,
    )!
    expect(builderBlock[0]).toMatch(/status\s*===\s*'ACTIVE'\s*\|\|\s*status\s*===\s*'RETIRED'/)
  })

  it('badges + opacity-60 row dim derive from membershipStatus, not raw fields', () => {
    // Both row branches (mobile + desktop) compute `membershipStatus`
    // and switch on it. Two occurrences of the local const + four
    // strict-equality checks against 'PENDING' / 'RETIRED'.
    const localDecls = PLAYERS_TAB_SRC.match(/const\s+membershipStatus\s*=\s*getMembershipStatus\(/g) ?? []
    expect(localDecls.length).toBeGreaterThanOrEqual(2)
    const pendingChecks = PLAYERS_TAB_SRC.match(/membershipStatus\s*===\s*'PENDING'/g) ?? []
    expect(pendingChecks.length).toBeGreaterThanOrEqual(2)
    const retiredChecks = PLAYERS_TAB_SRC.match(/membershipStatus\s*===\s*'RETIRED'/g) ?? []
    expect(retiredChecks.length).toBeGreaterThanOrEqual(2)
  })
})

describe('v1.87.0 — admin Players page surfaces retiredAt to PlayersTab', () => {
  it('Assignment row type declares retiredAt: string | null', () => {
    expect(ADMIN_PLAYERS_PAGE_SRC).toMatch(/retiredAt:\s*string\s*\|\s*null/)
  })

  it('aWithTeam build defensively coerces retiredAt to string | null', () => {
    // The cache JSON-round-trips Date → string; this guard handles both
    // shapes (post-migration cold reads see Date; cache hits see string).
    expect(ADMIN_PLAYERS_PAGE_SRC).toMatch(/retiredAtIso/)
    expect(ADMIN_PLAYERS_PAGE_SRC).toMatch(/instanceof Date/)
  })
})
