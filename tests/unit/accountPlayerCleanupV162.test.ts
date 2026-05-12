/**
 * v1.62.0 — pin the cleanup + bug-fix surface introduced in this release:
 *
 *   1. /account/player + /join/[code]/onboarding forms no longer surface
 *      preferred-team / preferred-teammate fields. Server actions no
 *      longer accept those input fields. The Player.onboardingPreferences
 *      JSON column stays in the schema but the action no longer writes
 *      to it.
 *   2. The "Switch league" inline submenu in the LineLoginButton dropdown
 *      is removed (the file `AccountMenuLeagueSwitch.tsx` is deleted).
 *      Header chevron LeagueSwitcher remains.
 *   3. Name change on /account/player propagates to the account-menu
 *      dropdown — the server action busts the v1.5.0 Redis mapping cache
 *      (`deleteMapping(lineId)`) so the next JWT callback re-reads the
 *      new playerName from Prisma; the client form calls
 *      `useSession().update()` to force a JWT refresh.
 *   4. Profile picture default falls back to the OAuth-supplied picture
 *      when the user has neither uploaded a custom one nor linked via
 *      `/assign-player`. The page threads `sessionPictureUrl` from
 *      `session.linePictureUrl` (LINE) or `session.user.image` (Google)
 *      and the form prefers it as the third-tier fallback.
 *   5. Profile-picture upload no longer surfaces "An unexpected response
 *      was received from the server" for files between 1MB and 5MB.
 *      `next.config.ts` raises `serverActions.bodySizeLimit` to 6mb
 *      (default 1mb) so the framework body-limit error never fires
 *      before our 5MB validation runs.
 *
 * Structural assertions on file content rather than render — the
 * affected components pull in `next-auth/react` and `next/image` which
 * aren't trivial to mock; the regression value is in pinning the file
 * contracts that v1.62.0 establishes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf-8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('v1.62.0 — preferred-team / teammate fields removed from /account/player form', () => {
  const FORM = 'src/app/account/player/AccountPlayerForm.tsx'

  it('form does NOT render the preferred-team picker', () => {
    const src = stripComments(read(FORM))
    expect(src).not.toMatch(/data-testid="account-player-preferred-team"/)
    expect(src).not.toMatch(/Preferred team/)
  })

  it('form does NOT render the teammate-preference fieldset', () => {
    const src = stripComments(read(FORM))
    expect(src).not.toMatch(/data-testid="account-player-teammate-/)
    expect(src).not.toMatch(/Preferred teammates/)
    expect(src).not.toMatch(/data-testid="account-player-teammates-other"/)
  })

  it('form props no longer include preferred-fields initial values', () => {
    const src = stripComments(read(FORM))
    expect(src).not.toMatch(/initialPreferredLeagueTeamId/)
    expect(src).not.toMatch(/initialPreferredTeammateIds/)
    expect(src).not.toMatch(/initialPreferredTeammatesFreeText/)
    expect(src).not.toMatch(/leagueTeams:\s*Array</)
    expect(src).not.toMatch(/teammateOptions:\s*Array</)
  })

  it('form props gain `sessionPictureUrl` (the OAuth-fallback chain)', () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/sessionPictureUrl:\s*string\s*\|\s*null/)
  })

  it('displayedPicture chain falls back to sessionPictureUrl', () => {
    const src = stripComments(read(FORM))
    // profilePictureUrl ?? pictureUrl ?? sessionPictureUrl
    expect(src).toMatch(
      /props\.profilePictureUrl\s*\?\?\s*props\.pictureUrl\s*\?\?\s*props\.sessionPictureUrl/,
    )
  })
})

describe('v1.62.0 — /account/player page drops unused preferences fetches', () => {
  const PAGE = 'src/app/account/player/page.tsx'

  it('does NOT fetch leagueTeams for the team picker', () => {
    const src = stripComments(read(PAGE))
    expect(src).not.toMatch(/prisma\.leagueTeam\.findMany/)
  })

  it('does NOT fetch teammateOptions roster', () => {
    const src = stripComments(read(PAGE))
    expect(src).not.toMatch(/teammateOptions/)
  })

  it('does NOT call parsePreferences (helper removed)', () => {
    const src = stripComments(read(PAGE))
    expect(src).not.toMatch(/parsePreferences/)
    expect(src).not.toMatch(/onboardingPreferences/)
  })

  it('threads `sessionPictureUrl` to AccountPlayerForm', () => {
    const src = stripComments(read(PAGE))
    expect(src).toMatch(/sessionPictureUrl/)
  })

  it('reads the OAuth picture from `session.linePictureUrl` and `session.user.image`', () => {
    const src = stripComments(read(PAGE))
    expect(src).toMatch(/session\.linePictureUrl/)
    expect(src).toMatch(/session\.user/)
  })
})

describe('v1.62.0 — /account/player profile-update invalidates Redis mapping (renamed updatePlayerProfile in v1.83.0)', () => {
  const ACTIONS = 'src/app/account/player/actions.ts'

  it('imports deleteMapping from playerMappingStore', () => {
    const src = stripComments(read(ACTIONS))
    expect(src).toMatch(/from ['"]@\/lib\/playerMappingStore['"]/)
    expect(src).toMatch(/deleteMapping/)
  })

  it('calls deleteMapping(session.lineId) after the Prisma update', () => {
    const src = stripComments(read(ACTIONS))
    // The deleteMapping call uses the lineId from the session, gated on
    // its presence (Google/email users skip — they have no entry to bust).
    expect(src).toMatch(/deleteMapping\(\s*session\.lineId\s*\)/)
    expect(src).toMatch(/if\s*\(\s*session\.lineId\s*\)/)
  })

  it('UpdatePlayerProfileInput shape no longer carries preference fields', () => {
    const src = stripComments(read(ACTIONS))
    expect(src).not.toMatch(/preferredLeagueTeamId\?:/)
    expect(src).not.toMatch(/preferredTeammateIds\?:/)
    expect(src).not.toMatch(/preferredTeammatesFreeText\?:/)
  })

  it('action body no longer writes onboardingPreferences', () => {
    const src = stripComments(read(ACTIONS))
    // The Prisma update in updatePlayerProfile must not mention
    // onboardingPreferences. Block-comments are stripped above, so any
    // remaining mention would be a real code reference.
    expect(src).not.toMatch(/onboardingPreferences/)
  })
})

describe('v1.62.0 — /join/[code]/onboarding form drops preference fields', () => {
  const FORM = 'src/app/join/[code]/onboarding/OnboardingForm.tsx'
  const PAGE = 'src/app/join/[code]/onboarding/page.tsx'
  const ACTIONS = 'src/app/join/[code]/actions.ts'

  it('form does NOT render preferred-team picker', () => {
    const src = stripComments(read(FORM))
    expect(src).not.toMatch(/data-testid="onboarding-preferred-team"/)
    expect(src).not.toMatch(/Preferred team/)
  })

  it('form does NOT render preferred-teammates fieldset', () => {
    const src = stripComments(read(FORM))
    expect(src).not.toMatch(/data-testid="onboarding-teammate-/)
    expect(src).not.toMatch(/data-testid="onboarding-teammates-other"/)
  })

  it('OnboardingForm props no longer carry preference initial values', () => {
    const src = stripComments(read(FORM))
    expect(src).not.toMatch(/initialPreferredLeagueTeamId/)
    expect(src).not.toMatch(/initialPreferredTeammateIds/)
    expect(src).not.toMatch(/initialPreferredTeammatesFreeText/)
    expect(src).not.toMatch(/leagueTeams:/)
    expect(src).not.toMatch(/teammateOptions:/)
  })

  it('onboarding page no longer fetches leagueTeams', () => {
    const src = stripComments(read(PAGE))
    expect(src).not.toMatch(/prisma\.leagueTeam\.findMany/)
  })

  it('onboarding page no longer fetches the in-league roster (teammateOptions)', () => {
    const src = stripComments(read(PAGE))
    expect(src).not.toMatch(/existingPlayers/)
    expect(src).not.toMatch(/teammateOptions/)
  })

  it('onboarding page no longer reads onboardingPreferences', () => {
    const src = stripComments(read(PAGE))
    expect(src).not.toMatch(/onboardingPreferences/)
  })

  it('SubmitOnboardingInput no longer carries preference fields', () => {
    const src = stripComments(read(ACTIONS))
    expect(src).not.toMatch(/preferredLeagueTeamId\?:/)
    expect(src).not.toMatch(/preferredTeammateIds\?:/)
    expect(src).not.toMatch(/preferredTeammatesFreeText\?:/)
  })

  it('submitOnboarding no longer writes onboardingPreferences', () => {
    const src = stripComments(read(ACTIONS))
    // Block comments are stripped; any remaining mention would be a real
    // reference. The column stays in the schema but the action stops
    // writing it.
    expect(src).not.toMatch(/onboardingPreferences/)
  })

  it('submitOnboarding busts the Redis mapping for LINE users', () => {
    const src = stripComments(read(ACTIONS))
    expect(src).toMatch(/deleteMapping/)
  })
})

describe('v1.62.0 — Switch league entry removed from account menu', () => {
  it('AccountMenuLeagueSwitch.tsx file is deleted', () => {
    expect(
      existsSync(join(ROOT, 'src/components/AccountMenuLeagueSwitch.tsx')),
    ).toBe(false)
  })

  it('LineLoginButton no longer imports AccountMenuLeagueSwitch', () => {
    const src = stripComments(read('src/components/LineLoginButton.tsx'))
    expect(src).not.toMatch(/AccountMenuLeagueSwitch/)
  })

  it('LineLoginButton dropdown no longer renders <AccountMenuLeagueSwitch />', () => {
    const src = read('src/components/LineLoginButton.tsx')
    expect(src).not.toMatch(/<AccountMenuLeagueSwitch/)
  })

  it('Header still imports + renders LeagueSwitcher (header chevron survives)', () => {
    // v1.97.3 — LeagueSwitcher may now carry a `leagueTitle` prop on
    // the multi-league branch. Relax the closing-tag regex to accept
    // a prop-bearing form.
    const src = stripComments(read('src/components/Header.tsx'))
    expect(src).toMatch(/import\s+LeagueSwitcher\s+from/)
    expect(src).toMatch(/<LeagueSwitcher\b/)
  })
})

describe('v1.62.0 — name-propagation fix on AccountPlayerForm', () => {
  const FORM = 'src/app/account/player/AccountPlayerForm.tsx'

  it("form imports useSession from next-auth/react (so it can call update())", () => {
    const src = stripComments(read(FORM))
    expect(src).toMatch(/import\s*\{[^}]*useSession[^}]*\}\s*from\s*['"]next-auth\/react['"]/)
  })

  it('form calls update() (the JWT-refresh trigger) after a successful save', () => {
    const src = stripComments(read(FORM))
    // The destructure renames `update` to `updateSession` so the call
    // site is `updateSession?.()`. A regression that drops the call
    // would re-introduce the stale-name account-menu bug.
    expect(src).toMatch(/updateSession/)
    expect(src).toMatch(/updateSession\??\.\(\)/)
  })

  it('form awaits the profile update BEFORE calling update() (order matters)', () => {
    // v1.83.0 — `updatePlayerSelf` was renamed to `updatePlayerProfile`
    // in the per-league split. The order constraint is unchanged: JWT
    // refresh has to happen AFTER the Prisma write.
    const src = stripComments(read(FORM))
    const updateIdx = src.indexOf('await updatePlayerProfile')
    const sessionIdx = src.indexOf('updateSession?.()')
    expect(updateIdx).toBeGreaterThan(0)
    expect(sessionIdx).toBeGreaterThan(0)
    expect(sessionIdx).toBeGreaterThan(updateIdx)
  })
})

describe('v1.62.0 — server-action body limit configured (relaxed in v1.71.1)', () => {
  const NEXT_CONFIG = 'next.config.ts'

  // v1.71.1 — `bodySizeLimit` no longer drives ID-upload behavior. ID
  // and profile-picture files now upload client-direct to Vercel Blob
  // via `@vercel/blob/client#upload`; the server actions receive only
  // URLs (a few KB). The Next.js framework limit still gates JSON-
  // shaped server-action payloads, but those are tiny — any digit-mb
  // value is fine. See `v1711_blob_client_upload.test.ts` for the
  // contracts that govern the upload path now.

  it('next.config.ts sets experimental.serverActions.bodySizeLimit (any value)', () => {
    const src = stripComments(read(NEXT_CONFIG))
    expect(src).toMatch(/experimental:\s*\{/)
    expect(src).toMatch(/serverActions:\s*\{/)
    expect(src).toMatch(/bodySizeLimit:\s*['"]\d+mb['"]/)
  })
})

describe('v1.71.1 — RegistrationFields file-size guards retained (client-side affordance)', () => {
  // The client-side size caps still matter as user-experience guards:
  // they reject hilariously oversized files BEFORE the upload begins
  // and surface a friendly inline error. The Vercel Blob upload-token
  // route enforces the same limits server-side as the load-bearing
  // gate. The 21MB-total math is no longer relevant since files don't
  // travel through the server action.

  it('RegistrationFields ID_MAX_BYTES stays at 8MB (matches token route)', () => {
    const src = read('src/components/registration/RegistrationFields.tsx')
    expect(src).toMatch(/ID_MAX_BYTES\s*=\s*8\s*\*\s*1024\s*\*\s*1024/)
  })

  it('RegistrationFields PIC_MAX_BYTES stays at 5MB (matches token route)', () => {
    const src = read('src/components/registration/RegistrationFields.tsx')
    expect(src).toMatch(/PIC_MAX_BYTES\s*=\s*5\s*\*\s*1024\s*\*\s*1024/)
  })
})
