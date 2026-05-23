/**
 * v2.2.9 — per-league "Allow players to pick their own teams" toggle.
 *
 * Pins three load-bearing surfaces:
 *
 *   1. **Schema** — `League.allowPlayerTeamPick Boolean @default(false)`
 *      added with an additive-only migration. Default `false` preserves
 *      backward compat: every existing league sees the unchanged
 *      onboarding flow.
 *
 *   2. **Admin action + SettingsTab** — new `setLeagueAllowPlayerTeamPick`
 *      server action mirrors the v1.60.0 `setLeagueAllowSelfLink` shape
 *      (assertAdmin, boolean validation, prisma.league.update,
 *      canonical revalidate). SettingsTab wires the toggle into the same
 *      optimistic-flip-with-rollback pattern as the other booleans.
 *
 *   3. **Onboarding write path** — `completeOnboardingWithId` accepts an
 *      optional `chosenTeamId` (string | null | undefined). The server
 *      action re-checks `league.allowPlayerTeamPick` before honouring
 *      the value, and validates that a string id resolves to a
 *      `LeagueTeam` in the SAME league as the invite (cross-league
 *      scoping guard).
 *
 * Structural tests (file content) rather than render — same pattern as
 * `leagueSelfLinkToggle.test.ts`. The schema test is structural because
 * the schema file + migration file are the source of truth and a
 * byte-level pin enforces the additive-only contract.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_ROOT = join(__dirname, '..', '..')

const SCHEMA_SRC = readFileSync(
  join(PROJECT_ROOT, 'prisma', 'schema.prisma'),
  'utf-8',
)
const MIGRATION_SRC = readFileSync(
  join(
    PROJECT_ROOT,
    'prisma',
    'migrations',
    '20260604000000_league_allow_player_team_pick',
    'migration.sql',
  ),
  'utf-8',
)
const ACTIONS_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'admin', 'leagues', 'actions.ts'),
  'utf-8',
)
const SETTINGS_TAB_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'components', 'admin', 'SettingsTab.tsx'),
  'utf-8',
)
const JOIN_ACTIONS_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'join', '[code]', 'actions.ts'),
  'utf-8',
)
const ONBOARDING_PAGE_SRC = readFileSync(
  join(
    PROJECT_ROOT,
    'src',
    'app',
    'join',
    '[code]',
    'onboarding',
    'page.tsx',
  ),
  'utf-8',
)
const ONBOARDING_FORM_SRC = readFileSync(
  join(
    PROJECT_ROOT,
    'src',
    'app',
    'join',
    '[code]',
    'onboarding',
    'OnboardingForm.tsx',
  ),
  'utf-8',
)
const PICKER_COMPONENT_SRC = readFileSync(
  join(
    PROJECT_ROOT,
    'src',
    'components',
    'onboarding',
    'TeamPickerSection.tsx',
  ),
  'utf-8',
)
const TEAM_OPTIONS_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'lib', 'onboarding-team-options.ts'),
  'utf-8',
)
const REG_FIELDS_SRC = readFileSync(
  join(
    PROJECT_ROOT,
    'src',
    'components',
    'registration',
    'RegistrationFields.tsx',
  ),
  'utf-8',
)

describe('schema — League.allowPlayerTeamPick (v2.2.9)', () => {
  it('declares allowPlayerTeamPick Boolean @default(false) on League', () => {
    const leagueIdx = SCHEMA_SRC.indexOf('model League {')
    expect(leagueIdx).toBeGreaterThan(0)
    const block = SCHEMA_SRC.slice(leagueIdx, leagueIdx + 4000)
    expect(block).toMatch(/allowPlayerTeamPick\s+Boolean\s+@default\(false\)/)
  })

  it('default is false — backward-compat invariant', () => {
    // A default of `true` would silently surface the team-picker step
    // on every existing league. Default `false` means the v2.2.9 deploy
    // is a no-op for any league the admin hasn't explicitly opted in.
    const leagueIdx = SCHEMA_SRC.indexOf('model League {')
    const block = SCHEMA_SRC.slice(leagueIdx, leagueIdx + 4000)
    expect(block).not.toMatch(/allowPlayerTeamPick\s+Boolean\s+@default\(true\)/)
    expect(block).toMatch(/allowPlayerTeamPick\s+Boolean\s+@default\(false\)/)
  })
})

describe('migration — 20260604000000_league_allow_player_team_pick is additive', () => {
  const EXECUTABLE_SQL = MIGRATION_SRC
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

  it('adds the column with NOT NULL DEFAULT false', () => {
    expect(EXECUTABLE_SQL).toMatch(
      /ALTER TABLE "League" ADD COLUMN "allowPlayerTeamPick" BOOLEAN NOT NULL DEFAULT false/,
    )
  })

  it('does not DROP any column, table, index, or type', () => {
    expect(EXECUTABLE_SQL).not.toMatch(/\bDROP\s+(COLUMN|TABLE|INDEX|TYPE)\b/i)
  })

  it('does not ALTER any existing column', () => {
    expect(EXECUTABLE_SQL).not.toMatch(/ALTER\s+COLUMN/i)
    expect(EXECUTABLE_SQL).not.toMatch(/DROP\s+DEFAULT/i)
    expect(EXECUTABLE_SQL).not.toMatch(/SET\s+NOT\s+NULL/i)
  })

  it('does not TRUNCATE or DELETE FROM any table', () => {
    expect(EXECUTABLE_SQL).not.toMatch(/\bTRUNCATE\b/i)
    expect(EXECUTABLE_SQL).not.toMatch(/DELETE\s+FROM/i)
  })

  it('documents the rollback recipe in a comment', () => {
    expect(MIGRATION_SRC).toMatch(
      /ALTER TABLE "League" DROP COLUMN "allowPlayerTeamPick"/,
    )
  })
})

describe('admin server action — setLeagueAllowPlayerTeamPick (v2.2.9)', () => {
  it('exports an async server action with the (leagueId, boolean) signature', () => {
    expect(ACTIONS_SRC).toMatch(
      /export\s+async\s+function\s+setLeagueAllowPlayerTeamPick\(\s*leagueId:\s*string,\s*value:\s*boolean\s*\)/,
    )
  })

  it('gates on assertAdmin', () => {
    const fnIdx = ACTIONS_SRC.indexOf('export async function setLeagueAllowPlayerTeamPick')
    expect(fnIdx).toBeGreaterThan(0)
    const block = ACTIONS_SRC.slice(fnIdx, fnIdx + 1500)
    expect(block).toMatch(/await\s+assertAdmin\(\)/)
  })

  it('validates the value is a boolean (defensive)', () => {
    const fnIdx = ACTIONS_SRC.indexOf('export async function setLeagueAllowPlayerTeamPick')
    const block = ACTIONS_SRC.slice(fnIdx, fnIdx + 1500)
    expect(block).toMatch(/typeof\s+value\s*!==\s*['"]boolean['"]/)
  })

  it('writes via prisma.league.update with allowPlayerTeamPick in data', () => {
    const fnIdx = ACTIONS_SRC.indexOf('export async function setLeagueAllowPlayerTeamPick')
    const block = ACTIONS_SRC.slice(fnIdx, fnIdx + 1500)
    expect(block).toMatch(/prisma\.league\.update/)
    expect(block).toMatch(/data:\s*\{\s*allowPlayerTeamPick:\s*value\s*\}/)
  })

  it('busts the admin cache via the canonical revalidate helper', () => {
    const fnIdx = ACTIONS_SRC.indexOf('export async function setLeagueAllowPlayerTeamPick')
    const block = ACTIONS_SRC.slice(fnIdx, fnIdx + 1500)
    expect(block).toMatch(/revalidate\(\s*\{\s*domain:\s*['"]admin['"]/)
    expect(block).toMatch(/\/admin\/leagues\/\$\{leagueId\}\/settings/)
  })
})

describe('SettingsTab — admin team-picker toggle wiring (v2.2.9)', () => {
  it('imports the new server action', () => {
    const flat = SETTINGS_TAB_SRC.replace(/\s+/g, ' ')
    expect(flat).toMatch(
      /import\s*\{[^}]*setLeagueAllowPlayerTeamPick[^}]*\}\s*from\s+['"]@\/app\/admin\/leagues\/actions['"]/,
    )
  })

  it('League prop interface includes allowPlayerTeamPick: boolean', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/allowPlayerTeamPick:\s*boolean/)
  })

  it('renders a section with the load-bearing testid', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-team-pick-section"/)
  })

  it('renders both On and Off toggle buttons with testids', () => {
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-team-pick-on"/)
    expect(SETTINGS_TAB_SRC).toMatch(/data-testid="settings-tab-team-pick-off"/)
  })

  it('uses optimistic flip with rollback on rejection', () => {
    const fnIdx = SETTINGS_TAB_SRC.indexOf('handleAllowPlayerTeamPickChange')
    expect(fnIdx).toBeGreaterThan(0)
    const block = SETTINGS_TAB_SRC.slice(fnIdx, fnIdx + 800)
    expect(block).toMatch(/setAllowPlayerTeamPickState\(value\)/)
    expect(block).toMatch(/setAllowPlayerTeamPickState\(prev\)/)
    expect(block).toMatch(/await\s+setLeagueAllowPlayerTeamPick\(/)
  })
})

describe('completeOnboardingWithId — chosenTeamId write path (v2.2.9)', () => {
  it('CompleteOnboardingWithIdInput exposes chosenTeamId?: string | null', () => {
    expect(JOIN_ACTIONS_SRC).toMatch(/chosenTeamId\?:\s*string\s*\|\s*null/)
  })

  it('selects allowPlayerTeamPick on the invite→league join', () => {
    // The select clause must include the new flag so the server-side
    // re-check has access to it without a second round-trip.
    expect(JOIN_ACTIONS_SRC).toMatch(/allowPlayerTeamPick:\s*true/)
  })

  it('only honours chosenTeamId when allowPlayerTeamPick is true', () => {
    // Read the action body and look for the gate.
    const fnIdx = JOIN_ACTIONS_SRC.indexOf('completeOnboardingWithId')
    expect(fnIdx).toBeGreaterThan(0)
    expect(JOIN_ACTIONS_SRC).toMatch(/invite\.league\?\.allowPlayerTeamPick/)
  })

  it('validates string chosenTeamId belongs to the invite’s league (cross-league guard)', () => {
    expect(JOIN_ACTIONS_SRC).toMatch(/prisma\.leagueTeam\.findUnique/)
    expect(JOIN_ACTIONS_SRC).toMatch(/Invalid team selection/)
    expect(JOIN_ACTIONS_SRC).toMatch(/chosen\.leagueId\s*!==\s*invite\.leagueId/)
  })

  it('applies the leagueTeamId (or null) inside the PLM updateMany data', () => {
    // Spread of chosenLeagueTeamWrite into the updateMany data block.
    expect(JOIN_ACTIONS_SRC).toMatch(/chosenLeagueTeamWrite/)
  })
})

describe('onboarding page — threads team-picker through (v2.2.9)', () => {
  it('selects allowPlayerTeamPick when fetching the league', () => {
    expect(ONBOARDING_PAGE_SRC).toMatch(/allowPlayerTeamPick:\s*true/)
  })

  it('imports getTeamPickerOptions', () => {
    expect(ONBOARDING_PAGE_SRC).toMatch(
      /import\s*\{\s*getTeamPickerOptions\s*\}\s*from\s+['"]@\/lib\/onboarding-team-options['"]/,
    )
  })

  it('fetches team options only when the toggle is on', () => {
    expect(ONBOARDING_PAGE_SRC).toMatch(
      /league\.allowPlayerTeamPick[\s\S]*getTeamPickerOptions\(/,
    )
  })

  it('threads the picker props into <OnboardingForm>', () => {
    expect(ONBOARDING_PAGE_SRC).toMatch(/allowPlayerTeamPick=\{league\.allowPlayerTeamPick\}/)
    expect(ONBOARDING_PAGE_SRC).toMatch(/teamPickerOptions=\{teamPickerOptions\}/)
  })
})

describe('OnboardingForm — renders picker above ID section (v2.2.9)', () => {
  it('imports TeamPickerSection', () => {
    expect(ONBOARDING_FORM_SRC).toMatch(
      /import\s+TeamPickerSection\s+from\s+['"]@\/components\/onboarding\/TeamPickerSection['"]/,
    )
  })

  it('threads chosenTeamId into completeOnboardingWithId', () => {
    expect(ONBOARDING_FORM_SRC).toMatch(/chosenTeamId/)
  })

  it('gates submit when picker is on and nothing is selected', () => {
    // The form-level affordance: throws on empty selection so the
    // server action is never called for an invalid state.
    expect(ONBOARDING_FORM_SRC).toMatch(
      /Pick a team \(or "balanced team"\) to continue\./,
    )
  })
})

describe('TeamPickerSection — UI contract (v2.2.9)', () => {
  it('renders one card per team plus a "balanced" card with testids', () => {
    expect(PICKER_COMPONENT_SRC).toMatch(/data-testid=\{`onboarding-team-card-\$\{opt\.leagueTeamId\}`\}/)
    expect(PICKER_COMPONENT_SRC).toMatch(/data-testid="onboarding-team-card-balanced"/)
  })

  it('"balanced" card calls onChange(null) to signal opt-out', () => {
    expect(PICKER_COMPONENT_SRC).toMatch(/onClick=\{\(\)\s*=>\s*onChange\(null\)\}/)
  })

  it('caps the visible member list at MAX_VISIBLE_MEMBERS', () => {
    expect(PICKER_COMPONENT_SRC).toMatch(/MAX_VISIBLE_MEMBERS\s*=\s*12/)
    expect(PICKER_COMPONENT_SRC).toMatch(/overflowCount/)
  })
})

describe('onboarding-team-options — qualifying-member filter (v2.2.9)', () => {
  it('filters memberships to ACTIVE status and APPROVED/PENDING application', () => {
    expect(TEAM_OPTIONS_SRC).toMatch(/status:\s*'ACTIVE'/)
    expect(TEAM_OPTIONS_SRC).toMatch(/applicationStatus:\s*\{\s*in:\s*\['APPROVED',\s*'PENDING'\]\s*\}/)
  })

  it('filters by toGameWeek=null (current period only)', () => {
    expect(TEAM_OPTIONS_SRC).toMatch(/toGameWeek:\s*null/)
  })

  it('excludes the current player from their own card', () => {
    expect(TEAM_OPTIONS_SRC).toMatch(/plm\.player\.id\s*!==\s*currentPlayerId/)
  })

  it('sorts members via the canonical helper', () => {
    expect(TEAM_OPTIONS_SRC).toMatch(/sortMembersByPrimaryPositionThenName/)
  })
})

describe('RegistrationFields — "Share Your ID" callout (v2.2.9)', () => {
  it('uses the new subheader', () => {
    // v2.2.12 — heading lifted out of the callout box and promoted to <h2>
    // sitting ABOVE the callout. Match the text regardless of intervening
    // whitespace from JSX formatting.
    expect(REG_FIELDS_SRC).toMatch(/>\s*Share Your ID\s*</)
  })

  it('contains all three paragraphs of the v2.2.19 callout copy (ward-registration framing)', () => {
    expect(REG_FIELDS_SRC).toMatch(/legally required to register every player with the local ward office/)
    expect(REG_FIELDS_SRC).toMatch(/your ID is what makes that registration possible/)
    expect(REG_FIELDS_SRC).toMatch(/Having your ID on file also helps us secure more court bookings/)
    expect(REG_FIELDS_SRC).toMatch(/no one but the organizers may access it/)
    // Legacy v2.2.12 wording must be gone.
    expect(REG_FIELDS_SRC).not.toMatch(/We require your ID to enable more regular league games!/)
  })

  it('drops the old "Why we need your ID" subheader', () => {
    // Regression target: if a future edit reverts the subheader, this
    // pin surfaces it. The new heading is "Share Your ID".
    expect(REG_FIELDS_SRC).not.toMatch(/>Why we need your ID</)
  })
})
