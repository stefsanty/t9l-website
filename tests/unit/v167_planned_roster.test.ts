/**
 * v1.67.0 — planned roster fields + preseason stats panel + State C
 * full-onboarding upgrade + allowSelfLink UI hide + admin-orthogonal UX rule.
 *
 * Structural tests over file content — these surface the load-bearing
 * contracts that would silently regress if a future PR re-introduced the
 * pre-v1.67.0 shape.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.67.0 schema additions on League', () => {
  const schema = read('prisma/schema.prisma')

  it('declares plannedPlayersPerTeam as Int @default(0)', () => {
    expect(schema).toMatch(/plannedPlayersPerTeam\s+Int\s+@default\(0\)/)
  })

  it('declares plannedNumberOfTeams as Int @default(0)', () => {
    expect(schema).toMatch(/plannedNumberOfTeams\s+Int\s+@default\(0\)/)
  })

  it('declares registrationDeadline as nullable DateTime', () => {
    expect(schema).toMatch(/registrationDeadline\s+DateTime\?/)
  })
})

describe('v1.67.0 migration is purely additive', () => {
  const sql = read('prisma/migrations/20260508000000_league_planned_roster/migration.sql')

  it('adds the three columns via ALTER TABLE ADD COLUMN', () => {
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "plannedPlayersPerTeam"/)
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "plannedNumberOfTeams"/)
    expect(sql).toMatch(/ALTER TABLE "League" ADD COLUMN "registrationDeadline"/)
  })

  it('contains no DROP / ALTER COLUMN / TRUNCATE statements', () => {
    // Strip comments first so commentary about rollback recipes doesn't
    // trigger false positives.
    const code = sql.replace(/--.*$/gm, '')
    expect(code).not.toMatch(/DROP\s/i)
    expect(code).not.toMatch(/ALTER\s+COLUMN/i)
    expect(code).not.toMatch(/TRUNCATE/i)
  })
})

describe('v1.67.0 updateLeaguePlannedRoster server action', () => {
  const actions = read('src/app/admin/leagues/actions.ts')

  it('exports the server action', () => {
    expect(actions).toMatch(/export async function updateLeaguePlannedRoster/)
  })

  it('gates on assertAdmin', () => {
    const fn = actions.split('export async function updateLeaguePlannedRoster')[1]
    expect(fn).toBeDefined()
    expect(fn.split('export async function')[0]).toMatch(/await assertAdmin/)
  })

  it('validates non-negative integers for both numerics', () => {
    const fn = actions.split('export async function updateLeaguePlannedRoster')[1].split('export async function')[0]
    expect(fn).toMatch(/plannedPlayersPerTeam.*non-negative integer/)
    expect(fn).toMatch(/plannedNumberOfTeams.*non-negative integer/)
  })

  it('writes to League via prisma.league.update', () => {
    const fn = actions.split('export async function updateLeaguePlannedRoster')[1].split('export async function')[0]
    expect(fn).toMatch(/prisma\.league\.update/)
  })

  it('busts the admin cache via the canonical revalidate helper', () => {
    const fn = actions.split('export async function updateLeaguePlannedRoster')[1].split('export async function')[0]
    expect(fn).toMatch(/revalidate\(\{[\s\S]*domain:\s*'admin'/)
  })
})

describe('v1.67.0 PlannedRosterStats helper + component', () => {
  it('lib/plannedRosterStats exports getPlannedRosterStats', () => {
    const src = read('src/lib/plannedRosterStats.ts')
    expect(src).toMatch(/export async function getPlannedRosterStats/)
    expect(src).toMatch(/PlannedRosterStats/)
  })

  it('counts current players via PLM with toGameWeek null + leagueId OR leagueTeam.leagueId', () => {
    const src = read('src/lib/plannedRosterStats.ts')
    expect(src).toMatch(/playerLeagueMembership\.count/)
    expect(src).toMatch(/toGameWeek:\s*null/)
    expect(src).toMatch(/{\s*leagueTeam:\s*\{\s*leagueId\s*\}\s*\}/)
  })

  it('floors spotsLeft at zero', () => {
    const src = read('src/lib/plannedRosterStats.ts')
    expect(src).toMatch(/Math\.max\(0,\s*plannedTotal\s*-\s*currentPlayers\)/)
  })

  it('component file exists and is a client component', () => {
    const src = read('src/components/PlannedRosterStats.tsx')
    expect(src).toMatch(/'use client'/)
    expect(src).toMatch(/data-testid="planned-roster-stats"/)
  })

  it('component hides individual rows when value is 0/null', () => {
    const src = read('src/components/PlannedRosterStats.tsx')
    expect(src).toMatch(/showPlannedTeams/)
    expect(src).toMatch(/showPlannedPerTeam/)
    expect(src).toMatch(/showDeadline/)
  })
})

describe('v1.67.0 Dashboard threading', () => {
  const dashboard = read('src/components/Dashboard.tsx')

  it('imports PlannedRosterStats + its data type', () => {
    expect(dashboard).toMatch(/import\s+type\s*\{\s*PlannedRosterStats[\s\S]*from\s+'@\/lib\/plannedRosterStats'/)
    expect(dashboard).toMatch(/import\s+PlannedRosterStats\s+from\s+'\.\/PlannedRosterStats'/)
  })

  it('accepts plannedRosterStats prop', () => {
    expect(dashboard).toMatch(/plannedRosterStats\?:.*PlannedRosterStatsData/)
  })

  it('renders the panel between RecruitingBanner and the schedule', () => {
    const banner = dashboard.indexOf('<RecruitingBanner ')
    const panel = dashboard.indexOf('<PlannedRosterStats ')
    const compressed = dashboard.indexOf('<CompressedMatchdaySchedule ')
    expect(banner).toBeGreaterThan(0)
    expect(panel).toBeGreaterThan(banner)
    expect(compressed).toBeGreaterThan(panel)
  })
})

describe('v1.67.0 page-level auth + flag gate', () => {
  // v1.67.0 — apex (page.tsx), /id/[slug], and /id/[slug]/md/[id]
  // each thread a userId-aware getServerSession alongside the
  // planned-roster fetch so the panel only renders when authenticated
  // AND both flags are on.
  for (const path of [
    'src/app/page.tsx',
    'src/app/id/[slug]/page.tsx',
    'src/app/id/[slug]/md/[id]/page.tsx',
  ]) {
    it(`${path} fetches plannedRosterStats + session and gates on userId + flags`, () => {
      const src = read(path)
      expect(src).toMatch(/getPlannedRosterStats\(leagueId\)/)
      expect(src).toMatch(/getServerSession\(authOptions\)/)
      // Auth-gate AND flag-gate. The guard pattern threads userId &&
      // preseasonMode && recruiting before passing the data through.
      expect(src).toMatch(/userId\s*&&\s*flags\.preseasonMode\s*&&\s*flags\.recruiting/)
      expect(src).toMatch(/plannedRosterStats=\{plannedRosterStats\s*\?\?\s*null\}/)
    })
  }
})

describe('v1.67.0 CompressedMatchdaySchedule label rename', () => {
  const src = read('src/components/CompressedMatchdaySchedule.tsx')

  it('uses "Planned season schedule" label', () => {
    expect(src).toMatch(/Planned season schedule/)
  })

  it('does NOT use the legacy "Pre-season schedule" label', () => {
    expect(src).not.toMatch(/Pre-season schedule/)
  })
})

describe('v1.67.0 admin SettingsTab integration', () => {
  const tab = read('src/components/admin/SettingsTab.tsx')

  it('imports LeaguePlannedRosterEditor', () => {
    expect(tab).toMatch(/import\s+LeaguePlannedRosterEditor/)
  })

  it('renders LeaguePlannedRosterEditor with the three init fields', () => {
    expect(tab).toMatch(/<LeaguePlannedRosterEditor[\s\S]*initialPlannedPlayersPerTeam[\s\S]*initialPlannedNumberOfTeams[\s\S]*initialRegistrationDeadline/)
  })

  it('declares the three new fields on the League type', () => {
    expect(tab).toMatch(/plannedPlayersPerTeam:\s*number/)
    expect(tab).toMatch(/plannedNumberOfTeams:\s*number/)
    expect(tab).toMatch(/registrationDeadline:\s*Date\s*\|\s*null/)
  })
})

describe('v1.67.0 LeaguePlannedRosterEditor component', () => {
  const editor = read('src/components/admin/LeaguePlannedRosterEditor.tsx')

  it('is a client component with the right testid', () => {
    expect(editor).toMatch(/'use client'/)
    expect(editor).toMatch(/data-testid="league-planned-roster-editor"/)
  })

  it('has inputs for all three fields with testids', () => {
    expect(editor).toMatch(/data-testid="planned-number-of-teams-input"/)
    expect(editor).toMatch(/data-testid="planned-players-per-team-input"/)
    expect(editor).toMatch(/data-testid="registration-deadline-input"/)
  })

  it('calls updateLeaguePlannedRoster on save', () => {
    expect(editor).toMatch(/updateLeaguePlannedRoster/)
  })
})

describe('v1.67.0 State C full-onboarding flow', () => {
  const actions = read('src/app/api/recruiting/actions.ts')
  const banner = read('src/components/RecruitingBanner.tsx')

  it('exports recruitToLeagueWithOnboarding', () => {
    expect(actions).toMatch(/export async function recruitToLeagueWithOnboarding/)
  })

  it('creates a synthetic PERSONAL invite + Player + PLM atomically', () => {
    const fn = actions.split('export async function recruitToLeagueWithOnboarding')[1]
    expect(fn).toMatch(/prisma\.\$transaction/)
    expect(fn).toMatch(/leagueInvite\.create/)
    expect(fn).toMatch(/kind:\s*'PERSONAL'/)
    expect(fn).toMatch(/playerLeagueMembership\.create/)
    expect(fn).toMatch(/applicationStatus:\s*'PENDING'/)
    expect(fn).toMatch(/onboardingStatus:\s*'NOT_YET'/)
    // Pre-redeemed so it can't be reused.
    expect(fn).toMatch(/usedCount:\s*1/)
  })

  it('rejects when user already has a Player (State D path)', () => {
    const fn = actions.split('export async function recruitToLeagueWithOnboarding')[1]
    expect(fn).toMatch(/already have a player profile/)
  })

  it('RecruitingBanner routes State C through the new action', () => {
    expect(banner).toMatch(/recruitToLeagueWithOnboarding/)
    // State C calls the new action and router.push to /join/<code>.
    expect(banner).toMatch(/router\.push\(`\/join\/\$\{result\.code\}`\)/)
  })

  it('RecruitingBanner only shows ApplyToLeagueModal for State D now', () => {
    // Modal block should be gated on `kind === 'in_other_league'` only.
    expect(banner).toMatch(/viewer\.kind === 'in_other_league'[\s\S]*<ApplyToLeagueModal/)
    // Pre-v1.67.0 also gated on 'no_player' — that branch is gone.
    expect(banner).not.toMatch(/viewer\.kind === 'no_player' \|\| viewer\.kind === 'in_other_league'/)
  })
})

describe('v1.67.0 LineLoginButton gates Change/Unassign on allowSelfLink', () => {
  const btn = read('src/components/LineLoginButton.tsx')

  it('wraps the linked-user Change/Unassign link in {allowSelfLink && ...}', () => {
    // The link must be inside an allowSelfLink conditional.
    const idx = btn.indexOf('account-menu-change-player')
    expect(idx).toBeGreaterThan(0)
    // Walk backwards from the testid to the nearest open brace; the
    // wrapper must contain `allowSelfLink &&`.
    const prefix = btn.slice(Math.max(0, idx - 600), idx)
    expect(prefix).toMatch(/allowSelfLink && \(/)
  })
})

describe('v1.67.0 admin-orthogonal recruiting state resolver', () => {
  const src = read('src/lib/recruitingViewerState.ts')

  it('does NOT branch on isAdmin', () => {
    // Strip comments since the file legitimately discusses the rule.
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/isAdmin/)
  })

  it('falls back to lineId when userId is missing or User has no playerId', () => {
    expect(src).toMatch(/lineId/)
    expect(src).toMatch(/!player\s*&&\s*lineId/)
    // The fallback Player.findUnique by lineId must be present.
    expect(src).toMatch(/where:\s*\{\s*lineId\s*\}/)
  })

  it('returns no_player when neither userId nor lineId resolve', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).toMatch(/!userId\s*&&\s*!lineId/)
  })
})

describe('v1.67.0 admin-orthogonal-UX rule documented in CLAUDE.md', () => {
  const claude = read('CLAUDE.md')

  it('contains the standing rule section', () => {
    expect(claude).toMatch(/Admin-orthogonal-UX rule/)
  })

  it('only allows Admin link + auto-auth as admin-specific differences', () => {
    expect(claude).toMatch(/ORTHOGONAL/)
    expect(claude).toMatch(/Admin/)
  })
})

describe('v1.67.0 isAdmin usage is bounded', () => {
  // The only allowed `session.isAdmin` references in non-admin code are:
  //   - LineLoginButton.tsx (the dropdown "Admin" link entry)
  //   - auth.ts (the source of truth for token.isAdmin / session.isAdmin)
  //   - next-auth.d.ts (type declaration)
  //
  // If any other source file in src/ adds a session.isAdmin gate, this
  // test fails — surfacing the anti-pattern for review.
  it('no new session.isAdmin gates outside the allowlist', () => {
    const allowlist = new Set([
      'src/components/LineLoginButton.tsx',
      'src/lib/auth.ts',
      'src/types/next-auth.d.ts',
    ])
    // Walk src/ recursively for `session.isAdmin` or `token.isAdmin`.
    const violations: string[] = []
    function walk(dir: string) {
      const fs = require('node:fs')
      const path = require('node:path')
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        const rel = path.relative(ROOT, full).replace(/\\/g, '/')
        if (entry.isDirectory()) {
          // Skip /admin paths — admin-internal code is allowed.
          if (rel.includes('/admin/') || rel.endsWith('/admin')) continue
          walk(full)
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          if (allowlist.has(rel)) continue
          if (rel.includes('/admin/')) continue
          const content = fs.readFileSync(full, 'utf8')
          // Strip comments so legitimate documentation doesn't false-positive.
          const stripped = content
            .replace(/\/\/.*$/gm, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
          if (
            /session\.isAdmin/.test(stripped) ||
            /token\.isAdmin/.test(stripped)
          ) {
            violations.push(rel)
          }
        }
      }
    }
    walk(join(ROOT, 'src'))
    expect(violations).toEqual([])
  })
})
