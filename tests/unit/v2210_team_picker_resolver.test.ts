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

describe('v2.2.10 — RegistrationFields section h3 headers', () => {
  it('renders an h3 "About you" before the name + email pair', () => {
    expect(REG_FIELDS_SRC).toMatch(/<h3[^>]*>\s*About you\s*<\/h3>/)
    expect(REG_FIELDS_SRC).toMatch(/data-testid="registration-section-about"/)
  })

  it('renders an h3 "Positions" before the position pickers', () => {
    expect(REG_FIELDS_SRC).toMatch(/<h3[^>]*>\s*Positions\s*<\/h3>/)
    expect(REG_FIELDS_SRC).toMatch(/data-testid="registration-section-positions"/)
  })

  it('promotes the "Share Your ID" heading from <p> to <h3>', () => {
    expect(REG_FIELDS_SRC).toMatch(/<h3[^>]*>Share Your ID<\/h3>/)
    // The previous shape was <p className="font-bold mb-1.5 text-fg-high">Share Your ID</p>.
    expect(REG_FIELDS_SRC).not.toMatch(/<p[^>]*>Share Your ID<\/p>/)
  })

  it('uses the canonical join-flow small-section heading style', () => {
    // Matches the style used by RedeemCodePicker.tsx:76 — keeps the
    // section headings visually consistent across the join flow.
    const aboutIdx = REG_FIELDS_SRC.indexOf('About you')
    expect(aboutIdx).toBeGreaterThan(0)
    const block = REG_FIELDS_SRC.slice(Math.max(0, aboutIdx - 300), aboutIdx)
    expect(block).toMatch(/text-fg-mid\s+text-xs\s+uppercase\s+tracking-wider\s+font-bold/)
  })
})

describe('v2.2.10 — TeamPickerSection section/h3 swap', () => {
  it('wraps the picker in <section> instead of <fieldset>', () => {
    expect(TEAM_PICKER_SRC).toMatch(/<section[^>]*data-testid="onboarding-team-picker"/)
    expect(TEAM_PICKER_SRC).not.toMatch(/<fieldset/)
  })

  it('uses an <h3> for the "Choose your team" heading (was <legend>)', () => {
    expect(TEAM_PICKER_SRC).toMatch(/<h3[\s\S]*?Choose your team/)
    expect(TEAM_PICKER_SRC).not.toMatch(/<legend/)
  })

  it('preserves aria-labelledby wiring to the heading id', () => {
    // Accessible name still derives from the section heading via
    // aria-labelledby — the swap doesn't lose this semantics.
    expect(TEAM_PICKER_SRC).toMatch(/aria-labelledby=\{`\$\{groupId\}-label`\}/)
    expect(TEAM_PICKER_SRC).toMatch(/id=\{`\$\{groupId\}-label`\}/)
  })
})
