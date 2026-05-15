/**
 * v2.2.11 — regression target. v2.2.10 closed the resolver branch but
 * left three team-picker-bypass surfaces open when
 * `League.allowPlayerTeamPick === true`:
 *
 *   1. `/join/[code]/id-upload` direct URL — bookmarked / shared link
 *      skips `/onboarding` where the picker mounts.
 *   2. `LeagueInvite.skipOnboarding=true` invites — `redeemInvite`
 *      short-circuits to COMPLETED, picker never rendered.
 *   3. `/recruit/[slug]` self-serve apply — no picker on the form;
 *      `registerToLeague` writes `leagueTeamId: null` and admin assigns
 *      on approval.
 *
 * v2.2.11 patches all three. Tests are structural source-pin style
 * (same pattern as `v2210_team_picker_resolver.test.ts`) — they pin the
 * resolver branches, query selects, action input shape, and form
 * mounts so a future churn-edit that drops one of the guards fails
 * loudly.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_ROOT = join(__dirname, '..', '..')

const ID_UPLOAD_PAGE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'join', '[code]', 'id-upload', 'page.tsx'),
  'utf-8',
)
const REDEEM_ACTIONS_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'join', '[code]', 'actions.ts'),
  'utf-8',
)
const RECRUIT_PAGE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'recruit', '[slug]', 'page.tsx'),
  'utf-8',
)
const RECRUIT_FORM_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'recruit', '[slug]', 'RegistrationForm.tsx'),
  'utf-8',
)
const RECRUITING_ACTIONS_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'api', 'recruiting', 'actions.ts'),
  'utf-8',
)

describe('v2.2.11 — surface (A): /join/[code]/id-upload page guard', () => {
  it('league select on the id-upload page includes allowPlayerTeamPick', () => {
    // Without selecting the flag, the page can't branch on it.
    const leagueSelectIdx = ID_UPLOAD_PAGE_SRC.indexOf('prisma.league.findUnique')
    expect(leagueSelectIdx).toBeGreaterThan(0)
    const block = ID_UPLOAD_PAGE_SRC.slice(leagueSelectIdx, leagueSelectIdx + 500)
    expect(block).toMatch(/allowPlayerTeamPick:\s*true/)
  })

  it('redirects to /onboarding when allowPlayerTeamPick is on', () => {
    // The toggle-on guard must reference league.allowPlayerTeamPick and
    // redirect to the canonical onboarding form.
    expect(ID_UPLOAD_PAGE_SRC).toMatch(/league\.allowPlayerTeamPick/)
    expect(ID_UPLOAD_PAGE_SRC).toMatch(/redirect\(`\/join\/\$\{code\}\/onboarding`\)/)
  })

  it('COMPLETED → /welcome guard precedes the allowPlayerTeamPick branch', () => {
    // Order matters: a COMPLETED onboarding must still terminate at /welcome
    // regardless of the toggle, otherwise we'd bounce completed users back
    // into the form on every re-visit.
    const completedIdx = ID_UPLOAD_PAGE_SRC.indexOf("assignment.onboardingStatus === 'COMPLETED'")
    const toggleIdx = ID_UPLOAD_PAGE_SRC.indexOf('league.allowPlayerTeamPick')
    expect(completedIdx).toBeGreaterThan(0)
    expect(toggleIdx).toBeGreaterThan(0)
    expect(completedIdx).toBeLessThan(toggleIdx)
  })

  it('toggle-OFF: pre-existing no-name → /onboarding behaviour preserved', () => {
    // Pre-v2.2.11 behavior: if the form hasn't captured a name yet, the
    // user is routed back through /onboarding. That branch must still
    // exist for the toggle-off case.
    expect(ID_UPLOAD_PAGE_SRC).toMatch(/assignment\.player\.name/)
  })
})

describe('v2.2.11 — surface (B): redeemInvite skipOnboarding override', () => {
  it('fetches the league.allowPlayerTeamPick after invite validation', () => {
    // Without selecting the flag, the action can't override skipOnboarding.
    const inviteLookupIdx = REDEEM_ACTIONS_SRC.indexOf('prisma.league.findUnique')
    expect(inviteLookupIdx).toBeGreaterThan(0)
    const block = REDEEM_ACTIONS_SRC.slice(inviteLookupIdx, inviteLookupIdx + 400)
    expect(block).toMatch(/allowPlayerTeamPick:\s*true/)
  })

  it('derives effectiveSkipOnboarding from invite.skipOnboarding && !teamPickWins', () => {
    expect(REDEEM_ACTIONS_SRC).toMatch(/teamPickWins/)
    expect(REDEEM_ACTIONS_SRC).toMatch(
      /effectiveSkipOnboarding\s*=\s*invite\.skipOnboarding\s*&&\s*!teamPickWins/,
    )
  })

  it('newOnboardingStatus is driven by effectiveSkipOnboarding (not raw invite.skipOnboarding)', () => {
    // The COMPLETED-vs-NOT_YET branch on the PLM write must respect the
    // override, otherwise admin's skip flag silently bypasses the picker.
    expect(REDEEM_ACTIONS_SRC).toMatch(
      /newOnboardingStatus\s*=\s*effectiveSkipOnboarding\s*\?\s*'COMPLETED'\s*:\s*'NOT_YET'/,
    )
  })

  it('redirectTo branch is driven by effectiveSkipOnboarding', () => {
    // Same logic for the destination — when the toggle wins, the user
    // must land on /onboarding (where the picker mounts), not /welcome.
    const redirectIdx = REDEEM_ACTIONS_SRC.indexOf('const redirectTo')
    expect(redirectIdx).toBeGreaterThan(0)
    const block = REDEEM_ACTIONS_SRC.slice(redirectIdx, redirectIdx + 300)
    expect(block).toMatch(/effectiveSkipOnboarding/)
    expect(block).toMatch(/\/welcome\?submitted=redeemInvite/)
    expect(block).toMatch(/\/onboarding/)
  })
})

describe('v2.2.11 — surface (C): /recruit/[slug] picker mount', () => {
  it('recruit page selects allowPlayerTeamPick on the league lookup', () => {
    expect(RECRUIT_PAGE_SRC).toMatch(/prisma\.league\.findUnique/)
    expect(RECRUIT_PAGE_SRC).toMatch(/allowPlayerTeamPick:\s*true/)
  })

  it('recruit page imports and calls getTeamPickerOptions', () => {
    expect(RECRUIT_PAGE_SRC).toMatch(/getTeamPickerOptions/)
    // Called with currentPlayerId = null because the recruit flow is
    // for not-yet-bound users (State C); no self-exclusion needed.
    expect(RECRUIT_PAGE_SRC).toMatch(/getTeamPickerOptions\([^)]*null[^)]*\)/)
  })

  it('recruit page threads allowPlayerTeamPick + teamPickerOptions into <RegistrationForm>', () => {
    expect(RECRUIT_PAGE_SRC).toMatch(/allowPlayerTeamPick=\{league\.allowPlayerTeamPick\}/)
    expect(RECRUIT_PAGE_SRC).toMatch(/teamPickerOptions=\{teamPickerOptions\}/)
  })

  it('RegistrationForm imports TeamPickerSection', () => {
    expect(RECRUIT_FORM_SRC).toMatch(
      /import\s+TeamPickerSection\s+from\s+['"]@\/components\/onboarding\/TeamPickerSection['"]/,
    )
  })

  it('RegistrationForm uses the NO_SELECTION sentinel + picker-error gate', () => {
    // Mirrors OnboardingForm's shape — distinguishes "balanced opt-out"
    // (null) from "nothing picked yet" (sentinel).
    expect(RECRUIT_FORM_SRC).toMatch(/NO_SELECTION\s*=\s*Symbol/)
    expect(RECRUIT_FORM_SRC).toMatch(/teamSelection === NO_SELECTION/)
    expect(RECRUIT_FORM_SRC).toMatch(/data-testid="recruit-team-picker-error"/)
  })

  it('RegistrationForm passes chosenTeamId into registerToLeague', () => {
    // The action invocation has shorthand `chosenTeamId,` near the
    // `await registerToLeague(...)` call. Pin both the call site and
    // the shorthand existing.
    expect(RECRUIT_FORM_SRC).toMatch(/await registerToLeague\(/)
    expect(RECRUIT_FORM_SRC).toMatch(/chosenTeamId,/)
  })
})

describe('v2.2.11 — surface (C): registerToLeague action accepts and validates chosenTeamId', () => {
  it('RegisterToLeagueInput type declares chosenTeamId?: string | null', () => {
    expect(RECRUITING_ACTIONS_SRC).toMatch(/export interface RegisterToLeagueInput/)
    expect(RECRUITING_ACTIONS_SRC).toMatch(/chosenTeamId\?:\s*string\s*\|\s*null/)
  })

  it('league select in registerToLeague includes allowPlayerTeamPick', () => {
    // Selected so the action can re-check the toggle (defense against
    // a stale client posting chosenTeamId on a league that disabled it).
    expect(RECRUITING_ACTIONS_SRC).toMatch(/export async function registerToLeague/)
    expect(RECRUITING_ACTIONS_SRC).toMatch(/allowPlayerTeamPick:\s*true/)
  })

  it('validates chosenTeamId against league teams with cross-league guard', () => {
    // Mirrors the v2.2.5-area cross-league scoping guard +
    // completeOnboardingWithId's v2.2.9 pattern.
    expect(RECRUITING_ACTIONS_SRC).toMatch(/prisma\.leagueTeam\.findUnique/)
    expect(RECRUITING_ACTIONS_SRC).toMatch(/chosen\.leagueId\s*!==\s*league\.id/)
    expect(RECRUITING_ACTIONS_SRC).toMatch(/Invalid team selection/)
  })

  it('writes the resolved chosenLeagueTeamId on the PLM create (not unconditional null)', () => {
    // Pre-v2.2.11 the PLM create was `leagueTeamId: null` unconditionally.
    // The v2.2.11 write must use the resolved variable so the toggle-on
    // path actually persists the user's choice.
    expect(RECRUITING_ACTIONS_SRC).toMatch(/tx\.playerLeagueMembership\.create/)
    expect(RECRUITING_ACTIONS_SRC).toMatch(/leagueTeamId:\s*chosenLeagueTeamId/)
  })

  it('toggle-OFF path leaves chosenLeagueTeamId null (existing default preserved)', () => {
    // Initialised to null; the only mutation path is the toggle-on branch.
    expect(RECRUITING_ACTIONS_SRC).toMatch(
      /let chosenLeagueTeamId:\s*string\s*\|\s*null\s*=\s*null/,
    )
    expect(RECRUITING_ACTIONS_SRC).toMatch(
      /if\s*\(allowTeamPick && input\.chosenTeamId !== undefined\)/,
    )
  })
})
