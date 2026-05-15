/**
 * v2.2.10 — regression target for the v2.2.9 team-picker bug + h3 section
 * headers on onboarding sections.
 *
 * Bug (A): Operator turned ON `League.allowPlayerTeamPick` for a league
 * and the team-picker section did NOT render. The existing
 * `/join/[code]/page.tsx` resolver routes invitees whose `Player.name`
 * is already populated (the common case — admin pre-fills the name when
 * creating the Player slot) directly to `/join/[code]/id-upload`,
 * bypassing `/onboarding` where the team-picker mounts. v2.2.10 fixes
 * the resolver to detour through `/onboarding` when the toggle is on.
 *
 * Bug (B): The new onboarding form sections lacked h3 section headers.
 * v2.2.10 adds canonical join-flow-style h3s ("About you", "Positions")
 * to `RegistrationFields`, promotes the "Share Your ID" callout heading
 * from <p> to <h3>, and swaps the TeamPickerSection <fieldset>/<legend>
 * for <section>/<h3>.
 *
 * Structural source-pin tests rather than render. Same pattern as
 * `leagueAllowPlayerTeamPick.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_ROOT = join(__dirname, '..', '..')

const JOIN_PAGE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'join', '[code]', 'page.tsx'),
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
const TEAM_PICKER_SRC = readFileSync(
  join(
    PROJECT_ROOT,
    'src',
    'components',
    'onboarding',
    'TeamPickerSection.tsx',
  ),
  'utf-8',
)

describe('v2.2.10 — /join/[code] resolver detours through /onboarding when toggle on', () => {
  it('league select on the resolver page includes allowPlayerTeamPick', () => {
    // Without selecting the flag, the resolver cannot branch on it.
    // The select block is the league lookup at the top of the page,
    // separate from the onboarding page's own lookup.
    const leagueSelectIdx = JOIN_PAGE_SRC.indexOf('prisma.league.findUnique')
    expect(leagueSelectIdx).toBeGreaterThan(0)
    const block = JOIN_PAGE_SRC.slice(leagueSelectIdx, leagueSelectIdx + 600)
    expect(block).toMatch(/allowPlayerTeamPick:\s*true/)
  })

  it('adds a resolver branch that routes to /onboarding when allowPlayerTeamPick is true', () => {
    // Locate the existingBinding branch block.
    const branchIdx = JOIN_PAGE_SRC.indexOf("existingBinding.onboardingStatus === 'COMPLETED'")
    expect(branchIdx).toBeGreaterThan(0)
    const block = JOIN_PAGE_SRC.slice(branchIdx, branchIdx + 1500)
    // The toggle-on guard must reference league.allowPlayerTeamPick and
    // redirect to /onboarding.
    expect(block).toMatch(/league\.allowPlayerTeamPick/)
    expect(block).toMatch(/redirect\(`\/join\/\$\{code\}\/onboarding`\)/)
  })

  it('COMPLETED branch precedes the allowPlayerTeamPick branch', () => {
    // Order matters: a COMPLETED onboarding should still go to /welcome
    // regardless of the toggle. If we put the toggle check first, we'd
    // bounce completed users back into the form.
    const branchIdx = JOIN_PAGE_SRC.indexOf("existingBinding.onboardingStatus === 'COMPLETED'")
    const block = JOIN_PAGE_SRC.slice(branchIdx, branchIdx + 1500)
    const completedRedirectIdx = block.indexOf('/welcome')
    const toggleRedirectIdx = block.indexOf('league.allowPlayerTeamPick')
    expect(completedRedirectIdx).toBeGreaterThan(-1)
    expect(toggleRedirectIdx).toBeGreaterThan(-1)
    expect(completedRedirectIdx).toBeLessThan(toggleRedirectIdx)
  })

  it('toggle-OFF branches retain the original name-set → /id-upload split', () => {
    // Pre-v2.2.10 behaviour for the (toggle === false) case must be
    // preserved: pre-named invitees still skip the form and go to
    // /id-upload, no-name invitees still go to /onboarding.
    const branchIdx = JOIN_PAGE_SRC.indexOf("existingBinding.onboardingStatus === 'COMPLETED'")
    const block = JOIN_PAGE_SRC.slice(branchIdx, branchIdx + 1500)
    expect(block).toMatch(/existingBinding\.player\.name/)
    expect(block).toMatch(/redirect\(`\/join\/\$\{code\}\/id-upload`\)/)
  })
})

describe('v2.2.12 — RegistrationFields section h2 headers', () => {
  // v2.2.12 promoted these section headers from <h3> to canonical <h2>
  // (display typography). The testid pins remain so downstream tests
  // can still locate each section.
  it('renders an h2 "About you" before the name + email pair', () => {
    expect(REG_FIELDS_SRC).toMatch(/<h2[^>]*>\s*About you\s*<\/h2>/)
    expect(REG_FIELDS_SRC).toMatch(/data-testid="registration-section-about"/)
  })

  it('renders an h2 "Positions" before the position pickers', () => {
    expect(REG_FIELDS_SRC).toMatch(/<h2[^>]*>\s*Positions\s*<\/h2>/)
    expect(REG_FIELDS_SRC).toMatch(/data-testid="registration-section-positions"/)
  })

  it('renders the "Share Your ID" heading as an h2 ABOVE the callout box', () => {
    expect(REG_FIELDS_SRC).toMatch(/<h2[^>]*>\s*Share Your ID\s*<\/h2>/)
    // Pre-v2.2.10: <p>. Pre-v2.2.12: <h3> INSIDE the callout. v2.2.12: <h2> ABOVE.
    expect(REG_FIELDS_SRC).not.toMatch(/<p[^>]*>Share Your ID<\/p>/)
    expect(REG_FIELDS_SRC).not.toMatch(/<h3[^>]*>Share Your ID<\/h3>/)
    // h2 must appear BEFORE the callout div in source order.
    const h2Idx = REG_FIELDS_SRC.search(/<h2[^>]*data-testid="registration-section-id"/)
    const calloutIdx = REG_FIELDS_SRC.indexOf('data-testid="registration-id-callout"')
    expect(h2Idx).toBeGreaterThan(0)
    expect(calloutIdx).toBeGreaterThan(h2Idx)
  })

  it('uses canonical display-h2 typography on every section header', () => {
    // font-display + text-2xl + font-black + uppercase + tracking-tight is
    // the canonical h2 vocabulary used by ApplyToLeagueModal, MatchdayCard,
    // SuccessConfirmationModal, etc. The team-picker h2 below matches.
    const aboutIdx = REG_FIELDS_SRC.indexOf('About you')
    expect(aboutIdx).toBeGreaterThan(0)
    const block = REG_FIELDS_SRC.slice(Math.max(0, aboutIdx - 400), aboutIdx)
    expect(block).toMatch(/font-display\s+text-2xl\s+font-black\s+uppercase\s+tracking-tight\s+text-fg-high/)
  })
})

describe('v2.2.12 — TeamPickerSection h2 + 2-col grid + Current players label', () => {
  it('wraps the picker in <section> instead of <fieldset>', () => {
    expect(TEAM_PICKER_SRC).toMatch(/<section[^>]*data-testid="onboarding-team-picker"/)
    expect(TEAM_PICKER_SRC).not.toMatch(/<fieldset/)
  })

  it('uses an <h2> for the "Choose your team" heading', () => {
    expect(TEAM_PICKER_SRC).toMatch(/<h2[\s\S]*?Choose your team/)
    expect(TEAM_PICKER_SRC).not.toMatch(/<legend/)
    // Sanity: no leftover h3 for this heading.
    expect(TEAM_PICKER_SRC).not.toMatch(/<h3[\s\S]*?Choose your team/)
  })

  it('preserves aria-labelledby wiring to the heading id', () => {
    expect(TEAM_PICKER_SRC).toMatch(/aria-labelledby=\{`\$\{groupId\}-label`\}/)
    expect(TEAM_PICKER_SRC).toMatch(/id=\{`\$\{groupId\}-label`\}/)
  })

  it('uses a 2-column grid for the team cards at every breakpoint (v2.2.13)', () => {
    // v2.2.13 — operator wanted 2-col on mobile too; v2.2.12 was
    // `grid-cols-1 md:grid-cols-2` and wasted vertical space.
    expect(TEAM_PICKER_SRC).toMatch(/grid grid-cols-2 gap-3/)
    expect(TEAM_PICKER_SRC).not.toMatch(/grid-cols-1\s+md:grid-cols-2/)
  })

  it('renders a "Current players:" mini-label above each populated roster', () => {
    expect(TEAM_PICKER_SRC).toContain('Current players:')
  })
})
