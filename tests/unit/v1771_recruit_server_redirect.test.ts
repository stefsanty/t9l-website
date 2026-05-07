/**
 * v1.77.1 — registerToLeague server-side redirect.
 *
 * Pins the contracts introduced in PR A of handover-postsubmit.md:
 *   - `registerToLeague` calls `redirect()` from `next/navigation` on success
 *     instead of returning `{ ok: true }`. The NEXT_REDIRECT signal propagates
 *     through `useTransition` and survives iOS Safari background-suspend races.
 *   - The `/recruit/[slug]/page.tsx` route-level guard already redirects users
 *     who already have a Player, so resume after app-switch hits the guard.
 *   - `RegistrationForm.tsx` no longer branches on `result.ok` — the server
 *     action either throws NEXT_REDIRECT (success) or throws an error (caught
 *     by the parent `startTransition` catch in RegistrationFields).
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

function read(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

const ACTIONS = read('src/app/api/recruiting/actions.ts')
const FORM = read('src/app/recruit/[slug]/RegistrationForm.tsx')
const PAGE = read('src/app/recruit/[slug]/page.tsx')

// Extract just the registerToLeague function body
const REGISTER_FN = ACTIONS.split('export async function registerToLeague')[1]?.split(
  '\nfunction isOwnedBlobUrl',
)[0] ?? ''

describe('v1.77.1 — registerToLeague server-side redirect', () => {
  it('imports redirect from next/navigation', () => {
    expect(ACTIONS).toMatch(/import\s*\{[^}]*redirect[^}]*\}\s*from\s*'next\/navigation'/)
  })

  it('imports DEFAULT_LEAGUE_SLUG from @/lib/leagueSlug', () => {
    expect(ACTIONS).toMatch(
      /import\s*\{[^}]*DEFAULT_LEAGUE_SLUG[^}]*\}\s*from\s*'@\/lib\/leagueSlug'/,
    )
  })

  it('selects subdomain from prisma.league.findUnique inside registerToLeague', () => {
    expect(REGISTER_FN).toMatch(/select:\s*\{[^}]*subdomain:\s*true/)
  })

  it('calls redirect() on the success path', () => {
    expect(REGISTER_FN).toMatch(/redirect\(`\/id\//)
  })

  it('redirect target uses league.subdomain with DEFAULT_LEAGUE_SLUG fallback', () => {
    expect(REGISTER_FN).toMatch(/redirect\(`\/id\/\$\{league\.subdomain\s*\?\?\s*DEFAULT_LEAGUE_SLUG\}`\)/)
  })

  it('redirect call precedes the unreachable return (order matters)', () => {
    const redirectIdx = REGISTER_FN.indexOf('redirect(`/id/')
    const returnIdx = REGISTER_FN.lastIndexOf('return { ok: true')
    expect(redirectIdx).toBeGreaterThan(-1)
    expect(returnIdx).toBeGreaterThan(-1)
    expect(redirectIdx).toBeLessThan(returnIdx)
  })
})

describe('v1.77.1 — RegistrationForm no longer branches on result.ok', () => {
  it('result.ok is not present in RegistrationForm (regression target)', () => {
    expect(FORM).not.toMatch(/result\.ok/)
  })

  it('does not throw new Error(result.error) on the success path', () => {
    // The old pattern: `if (!result.ok) { throw new Error(result.error) }`
    expect(FORM).not.toMatch(/result\.error/)
  })

  it('calls registerToLeague with await (no result binding needed for navigation)', () => {
    expect(FORM).toMatch(/await registerToLeague\(\s*\{/)
  })

  it('keeps router.push as a defensive fallback after the await', () => {
    expect(FORM).toMatch(/router\.push\(`\/id\/\$\{leagueSlug\}`\)/)
  })
})

describe('v1.77.1 — page.tsx route-level guard (existing, pinned as regression target)', () => {
  it('redirects users who already have a playerId to /id/<slug>', () => {
    expect(PAGE).toMatch(/user\?\.playerId/)
    expect(PAGE).toMatch(/redirect\(`\/id\/\$\{slug\}`\)/)
  })

  it('guard fires before the form is rendered (defense for resume-from-background)', () => {
    const lines = PAGE.split('\n')
    const guardLine = lines.findIndex((l) => /if\s*\(user\?\.playerId\)/.test(l))
    // Find the JSX render of <RegistrationForm (not just the comment or import)
    const formLine = lines.findIndex((l) => /^\s*<RegistrationForm/.test(l))
    expect(guardLine).toBeGreaterThan(-1)
    expect(formLine).toBeGreaterThan(-1)
    expect(guardLine).toBeLessThan(formLine)
  })
})
