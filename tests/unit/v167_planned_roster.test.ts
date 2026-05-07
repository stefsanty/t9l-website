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
    // Use `<Tag` without trailing space so the test tolerates both
    // inline and multi-line JSX forms. v1.67.2 made RecruitingBanner
    // multi-line by adding the leagueSlug prop.
    const banner = dashboard.indexOf('<RecruitingBanner')
    const panel = dashboard.indexOf('<PlannedRosterStats data')
    const compressed = dashboard.indexOf('<CompressedMatchdaySchedule')
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

describe('v1.67.2 State C user-initiated registration flow (replaces v1.67.0 synthetic invite)', () => {
  const actions = read('src/app/api/recruiting/actions.ts')
  const banner = read('src/components/RecruitingBanner.tsx')

  // Strip block comments so legitimate documentation that mentions the
  // dropped function name doesn't cause false negatives.
  const codeOnly = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('drops recruitToLeagueWithOnboarding from the recruiting actions module', () => {
    // Regression target: re-introducing the legacy export would re-introduce
    // the "This invite has been used" + orphan-Player bug.
    expect(codeOnly(actions)).not.toMatch(/export async function recruitToLeagueWithOnboarding/)
  })

  it('drops the synthetic-invite shape from recruiting actions', () => {
    const code = codeOnly(actions)
    // Pre-v1.67.2 these constants signed the synthetic-invite path.
    expect(code).not.toMatch(/computeInviteExpiry/)
    expect(code).not.toMatch(/generateInviteCode/)
  })

  it('RecruitingBanner State C navigates to /recruit/<slug>', () => {
    expect(banner).toMatch(/router\.push\(`\/recruit\/\$\{leagueSlug\}`\)/)
  })

  it('RecruitingBanner no longer imports recruitToLeagueWithOnboarding', () => {
    // Strip comments — the historical-context comment legitimately
    // mentions the dropped function name.
    const code = codeOnly(banner)
    expect(code).not.toMatch(/recruitToLeagueWithOnboarding/)
  })

  it('RecruitingBanner accepts an optional leagueSlug prop', () => {
    expect(banner).toMatch(/leagueSlug\?:\s*string/)
    expect(banner).toMatch(/leagueSlug\s*=\s*DEFAULT_LEAGUE_SLUG/)
  })

  it('RecruitingBanner only shows ApplyToLeagueModal for State D', () => {
    // Modal block remains gated on `kind === 'in_other_league'`.
    expect(banner).toMatch(/viewer\.kind === 'in_other_league'[\s\S]*<ApplyToLeagueModal/)
    expect(banner).not.toMatch(/viewer\.kind === 'no_player' \|\| viewer\.kind === 'in_other_league'/)
  })

  it('Dashboard threads leagueSlug into RecruitingBanner', () => {
    const dashboard = read('src/components/Dashboard.tsx')
    // RecruitingBanner mount point now passes leagueSlug.
    expect(dashboard).toMatch(/<RecruitingBanner[\s\S]*leagueSlug=\{leagueSlug\}/)
  })
})

describe('v1.67.2 /recruit/[slug] route + form', () => {
  it('page.tsx exists, gates on session + league + recruiting + no-existing-player', () => {
    const src = read('src/app/recruit/[slug]/page.tsx')
    expect(src).toMatch(/getLeagueIdBySlug/)
    expect(src).toMatch(/getServerSession\(authOptions\)/)
    // League not found → notFound()
    expect(src).toMatch(/notFound\(\)/)
    // Not recruiting surface
    expect(src).toMatch(/data-testid="recruit-not-recruiting"/)
    // Sign-in surface
    expect(src).toMatch(/data-testid="recruit-sign-in"/)
    // Admin session surface
    expect(src).toMatch(/data-testid="recruit-admin-session"/)
    // User has playerId → redirect to /id/<slug>
    expect(src).toMatch(/redirect\(`\/id\/\$\{slug\}`\)/)
    // Default render — registration form
    expect(src).toMatch(/data-testid="recruit-registration"/)
    expect(src).toMatch(/<RegistrationForm/)
  })

  it('RegistrationForm uses registerToLeague (v1.68.0 — atomic Player + PLM + ID upload; v1.71.1 — typed input not FormData)', () => {
    const src = read('src/app/recruit/[slug]/RegistrationForm.tsx')
    expect(src).toMatch(/'use client'/)
    expect(src).toMatch(/import\s*\{\s*registerToLeague\s*\}\s*from/)
    // v1.71.1 — call shape is a typed object with URLs, not FormData.
    // Regression target: re-introducing `registerToLeague(formData)` would
    // re-introduce the Vercel 4.5MB body-cap cliff.
    expect(src).toMatch(/registerToLeague\(\s*\{[\s\S]+idFrontUrl:\s*input\.idFrontUrl/)
    expect(src).not.toMatch(/registerToLeague\(formData\)/)
    // No reference to the dropped legacy action.
    expect(src).not.toMatch(/recruitToLeagueWithOnboarding/)
    // Lands on /id/<slug> on success so the banner shows State B.
    expect(src).toMatch(/router\.push\(`\/id\/\$\{leagueSlug\}`\)/)
    // Wrapper testid preserved.
    expect(src).toMatch(/data-testid="recruit-registration-form"/)
    // Field testids live in the shared component.
    expect(src).toMatch(/<RegistrationFields/)
  })

  it('RegistrationFields mirrors OnboardingForm position-enum shape (v1.68.0 — moved to shared component)', () => {
    const src = read('src/components/registration/RegistrationFields.tsx')
    // Same five options shared by /recruit and /join/[code]/onboarding.
    expect(src).toMatch(/Prefer not to say/)
    expect(src).toMatch(/GK\s*—\s*Goalkeeper/)
    expect(src).toMatch(/DF\s*—\s*Defender/)
    expect(src).toMatch(/MF\s*—\s*Midfielder/)
    expect(src).toMatch(/FW\s*—\s*Forward/)
  })
})

describe('v1.67.2 orphan-cleanup script', () => {
  const src = read('scripts/cleanupV167SyntheticInviteOrphans.ts')

  it('matches synthetic-invite signature: maxUses=1, usedCount=1, skipOnboarding=false, kind=PERSONAL', () => {
    expect(src).toMatch(/kind:\s*'PERSONAL'/)
    expect(src).toMatch(/maxUses:\s*1/)
    expect(src).toMatch(/usedCount:\s*1/)
    expect(src).toMatch(/skipOnboarding:\s*false/)
  })

  it('only deletes Players with name=null (regression target — preserves user-filled rows)', () => {
    expect(src).toMatch(/player\.name\s*!==\s*null/)
  })

  it('clears User.playerId before deleting Player (unique-constraint ordering)', () => {
    // Look for the deletion order inside the deleteOrphan function. The
    // user.update with playerId: null must come before player.delete.
    const fn = src.split('async function deleteOrphan')[1]
    expect(fn).toBeDefined()
    const userUpdateIdx = fn.indexOf('user.update')
    const playerDeleteIdx = fn.indexOf('player.delete')
    expect(userUpdateIdx).toBeGreaterThan(0)
    expect(playerDeleteIdx).toBeGreaterThan(userUpdateIdx)
  })

  it('defaults to dry-run mode (--apply gates the writes)', () => {
    expect(src).toMatch(/--apply/)
    expect(src).toMatch(/process\.argv\.includes\('--apply'\)/)
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
