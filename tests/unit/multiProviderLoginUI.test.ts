/**
 * v1.32.0 / PR δ — Multi-provider login UI
 *
 * Pre-v1.32.0 the homepage's two unauthenticated sign-in surfaces — the
 * `<GuestLoginBanner>` callout and the header `<LineLoginButton>` pill —
 * fired `signIn('line')` directly with no other path surfaced. The α.5
 * provider picker at `/auth/signin` (Google + email magic-link) was
 * present but unreachable from the public site without typing the URL.
 *
 * δ keeps LINE as the primary big button in both surfaces (preserves the
 * one-click LINE login the existing 32 LINE users expect) and adds a
 * smaller "Other ways to sign in" link routing to `/auth/signin`. Since
 * `/auth/signin` self-hides Google and Email when their env vars are
 * unset, the link is safe to show before the operator wires those
 * providers in prod — the picker just shows LINE-only until they do.
 *
 * These tests pin the file shape so a regression that drops the link
 * (or routes it somewhere other than `/auth/signin`) fails CI rather
 * than waiting for a user report.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(__dirname, '..', '..')
const guestBannerSrc = readFileSync(
  join(repoRoot, 'src/components/GuestLoginBanner.tsx'),
  'utf8',
)
const headerSrc = readFileSync(
  join(repoRoot, 'src/components/LineLoginButton.tsx'),
  'utf8',
)

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const guestBanner = stripComments(guestBannerSrc)
const header = stripComments(headerSrc)

describe('GuestLoginBanner — δ multi-provider link', () => {
  it("preserves the LINE button as the primary big call-to-action", () => {
    expect(guestBanner).toMatch(/signIn\(\s*['"]line['"]\s*\)/)
    expect(guestBanner).toMatch(/data-testid=["']guest-banner-line-button["']/)
  })

  it('renders an "Other ways to sign in" link routing to /auth/signin', () => {
    expect(guestBanner).toMatch(/import\s+Link\s+from\s+["']next\/link["']/)
    expect(guestBanner).toMatch(/data-testid=["']guest-banner-other-ways["']/)
    expect(guestBanner).toMatch(/href=["']\/auth\/signin["']/)
    expect(guestBanner).toMatch(/Other ways to sign in/)
  })

  it('keeps the Login text on the primary button (regression target)', () => {
    expect(guestBanner).toMatch(/Login with LINE to confirm attendance/)
  })

  it('does not bypass /auth/signin by hardcoding google/email signIn calls in the banner', () => {
    expect(guestBanner).not.toMatch(/signIn\(\s*['"]google['"]/)
    expect(guestBanner).not.toMatch(/signIn\(\s*['"]email['"]/)
  })
})

describe('LineLoginButton (header) — δ multi-provider link', () => {
  it("preserves the LINE button as the primary call-to-action in the logged-out branch", () => {
    expect(header).toMatch(/signIn\(\s*['"]line['"]\s*\)/)
    expect(header).toMatch(/data-testid=["']header-line-button["']/)
  })

  it('renders an "Other" link routing to /auth/signin in the logged-out branch', () => {
    expect(header).toMatch(/data-testid=["']header-other-ways["']/)
    expect(header).toMatch(/href=["']\/auth\/signin["']/)
  })

  it('keeps the dev-only impersonation dropdown intact (only opens in isLocalDev)', () => {
    expect(header).toMatch(/isLocalDev/)
    expect(header).toMatch(/dev-login/)
  })

  it('does not redirect the primary button click to /auth/signin (regression target)', () => {
    // The user spec is "keep LINE as the primary big button" — the button
    // itself must still fire signIn('line') one-click, NOT navigate to
    // the picker. The "Other" link is the picker path.
    const buttonOnClick = header.match(
      /onClick=\{\(\) => \{\s*if \(isLocalDev\) \{\s*setOpen[^}]+\} else \{\s*signIn\(\s*['"]line['"]\s*\);\s*\}\s*\}\}/,
    )
    expect(buttonOnClick).not.toBeNull()
  })
})
