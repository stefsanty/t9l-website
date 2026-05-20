/**
 * v2.2.16 — per-team "allow onboarding join" toggle.
 *
 * Premade teams that signed up separately can be opted out of the
 * v2.2.9 onboarding team-picker via a per-Team boolean. The picker
 * data source filters them out, both write paths
 * (`completeOnboardingWithId` and recruit `registerToLeague`)
 * re-validate server-side, and the admin TeamsTab exposes the
 * toggle.
 *
 * Structural source-pins, mirrors the v2.2.9 / v2.2.11 style.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_ROOT = join(__dirname, '..', '..')

const read = (...segs: string[]) =>
  readFileSync(join(PROJECT_ROOT, ...segs), 'utf-8')

const SCHEMA_SRC = read('prisma', 'schema.prisma')
const MIGRATION_SRC = read(
  'prisma',
  'migrations',
  '20260605000001_team_allow_onboarding_join',
  'migration.sql',
)
const ADMIN_ACTIONS_SRC = read('src', 'app', 'admin', 'leagues', 'actions.ts')
const TEAMS_TAB_SRC = read('src', 'components', 'admin', 'TeamsTab.tsx')
const ONBOARDING_OPTIONS_SRC = read('src', 'lib', 'onboarding-team-options.ts')
const JOIN_ACTIONS_SRC = read('src', 'app', 'join', '[code]', 'actions.ts')
const RECRUIT_ACTIONS_SRC = read('src', 'app', 'api', 'recruiting', 'actions.ts')
const ADMIN_DATA_SRC = read('src', 'lib', 'admin-data.ts')

describe('v2.2.16 — Team.allowOnboardingJoin', () => {
  describe('schema', () => {
    it('adds `allowOnboardingJoin Boolean @default(true)` to Team', () => {
      const teamBlock = SCHEMA_SRC.match(/model Team \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(teamBlock).toMatch(
        /allowOnboardingJoin\s+Boolean\s+@default\(true\)/,
      )
    })

    it('default `true` preserves backward compat for every existing team', () => {
      // Existing teams remain selectable in the picker — the toggle is
      // opt-OUT, not opt-in.
      const teamBlock = SCHEMA_SRC.match(/model Team \{[\s\S]*?\n\}/)?.[0] ?? ''
      expect(teamBlock).toMatch(/@default\(true\)/)
    })
  })

  describe('migration', () => {
    it('is purely additive — single ADD COLUMN, no destructive verbs', () => {
      expect(MIGRATION_SRC).toMatch(
        /ALTER TABLE "Team" ADD COLUMN "allowOnboardingJoin" BOOLEAN NOT NULL DEFAULT true/,
      )
      // Strip SQL comments before scanning for destructive verbs so the
      // rollback recipe doesn't false-positive (matches the v2.2.15 style).
      const code = MIGRATION_SRC.replace(/--.*$/gm, '')
      expect(code).not.toMatch(/DROP COLUMN/i)
      expect(code).not.toMatch(/ALTER COLUMN/i)
      expect(code).not.toMatch(/TRUNCATE/i)
      expect(code).not.toMatch(/DELETE FROM/i)
    })

    it('carries a rollback recipe in the leading comment', () => {
      expect(MIGRATION_SRC).toMatch(
        /Rollback recipe[\s\S]*ALTER TABLE "Team" DROP COLUMN "allowOnboardingJoin"/,
      )
    })
  })

  describe('admin server action', () => {
    it('exports `setTeamAllowOnboardingJoin`', () => {
      expect(ADMIN_ACTIONS_SRC).toMatch(
        /export async function setTeamAllowOnboardingJoin\(/,
      )
    })

    it('asserts admin, validates boolean, writes Team.allowOnboardingJoin', () => {
      const fn =
        ADMIN_ACTIONS_SRC.match(
          /export async function setTeamAllowOnboardingJoin[\s\S]*?\n\}/,
        )?.[0] ?? ''
      expect(fn).toMatch(/await assertAdmin\(\)/)
      expect(fn).toMatch(/typeof value !== 'boolean'/)
      expect(fn).toMatch(/prisma\.team\.update/)
      expect(fn).toMatch(/data:\s*\{\s*allowOnboardingJoin:\s*value\s*\}/)
    })

    it('revalidates the admin domain + teams page', () => {
      const fn =
        ADMIN_ACTIONS_SRC.match(
          /export async function setTeamAllowOnboardingJoin[\s\S]*?\n\}/,
        )?.[0] ?? ''
      expect(fn).toMatch(/revalidate\(\{[\s\S]*domain:\s*'admin'/)
      expect(fn).toMatch(/\/admin\/leagues\/\$\{leagueId\}\/teams/)
    })
  })

  describe('picker data source — getTeamPickerOptions filter', () => {
    it('only returns LeagueTeams whose Team has allowOnboardingJoin=true', () => {
      expect(ONBOARDING_OPTIONS_SRC).toMatch(
        /where:\s*\{\s*leagueId,\s*team:\s*\{\s*allowOnboardingJoin:\s*true\s*\}\s*\}/,
      )
    })
  })

  describe('join onboarding write path re-validates server-side', () => {
    it('selects Team.allowOnboardingJoin when resolving chosenTeamId', () => {
      // Defence against a stale client surfacing a since-disabled team.
      expect(JOIN_ACTIONS_SRC).toMatch(
        /team:\s*\{\s*select:\s*\{\s*allowOnboardingJoin:\s*true\s*\}\s*\}/,
      )
    })

    it('throws "not accepting new joiners" when the team is disabled', () => {
      expect(JOIN_ACTIONS_SRC).toMatch(
        /if \(!chosen\.team\.allowOnboardingJoin\)/,
      )
      expect(JOIN_ACTIONS_SRC).toMatch(
        /throw new Error\('That team is not accepting new joiners'\)/,
      )
    })
  })

  describe('recruit write path re-validates server-side', () => {
    it('selects Team.allowOnboardingJoin when resolving chosenTeamId', () => {
      expect(RECRUIT_ACTIONS_SRC).toMatch(
        /team:\s*\{\s*select:\s*\{\s*allowOnboardingJoin:\s*true\s*\}\s*\}/,
      )
    })

    it('returns { ok: false, error } when the team is disabled', () => {
      expect(RECRUIT_ACTIONS_SRC).toMatch(
        /if \(!chosen\.team\.allowOnboardingJoin\)/,
      )
      expect(RECRUIT_ACTIONS_SRC).toMatch(
        /return \{ ok: false, error: 'That team is not accepting new joiners' \}/,
      )
    })
  })

  describe('admin TeamsTab wiring', () => {
    it('imports the new server action', () => {
      expect(TEAMS_TAB_SRC).toMatch(
        /import\s*\{[\s\S]*setTeamAllowOnboardingJoin[\s\S]*\}\s*from\s*'@\/app\/admin\/leagues\/actions'/,
      )
    })

    it('exposes the toggle on the team detail panel', () => {
      expect(TEAMS_TAB_SRC).toMatch(/Allow onboarding join/)
      expect(TEAMS_TAB_SRC).toMatch(/aria-label="Allow onboarding join"/)
      expect(TEAMS_TAB_SRC).toMatch(/role="switch"/)
    })

    it('LeagueTeamFull.team carries the allowOnboardingJoin boolean', () => {
      expect(TEAMS_TAB_SRC).toMatch(/allowOnboardingJoin:\s*boolean/)
    })

    it('toggle handler calls setTeamAllowOnboardingJoin with team id + value + leagueId', () => {
      // The handler signature passes (teamId, value, leagueId) per
      // the admin action.
      expect(TEAMS_TAB_SRC).toMatch(
        /setTeamAllowOnboardingJoin\(teamId,\s*next,\s*leagueId\)/,
      )
    })

    // admin-data.ts surfaces the full Team row (no narrow select), so
    // `allowOnboardingJoin` flows through automatically — pin the
    // include shape so a future select-rewrite doesn't drop it.
    it('admin-data.ts uses `team: true` so allowOnboardingJoin is included', () => {
      expect(ADMIN_DATA_SRC).toMatch(
        /prisma\.leagueTeam\.findMany\([\s\S]*?include:\s*\{[\s\S]*?team:\s*true/,
      )
    })
  })
})
