/**
 * v1.32.1 / PR δ.1 — Multi-provider login lightbox structural pin.
 *
 * Pre-v1.32.1 the homepage's banner + header surfaces fired
 * `signIn('line')` directly; v1.32.0 added a small "Other ways to sign in"
 * link routing to `/auth/signin`. v1.32.1 replaces both with a single
 * neutral "Sign in" CTA that opens a multi-provider lightbox in-place.
 *
 * These tests pin the file shape so a regression that re-introduces the
 * separate "Other ways" link, the LINE icon on the primary CTA, or the
 * direct `signIn('line')` call in either banner/header fails CI.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(__dirname, '..', '..')
const banner = readFileSync(join(repoRoot, 'src/components/GuestLoginBanner.tsx'), 'utf8')
const header = readFileSync(join(repoRoot, 'src/components/LineLoginButton.tsx'), 'utf8')
const lightbox = readFileSync(join(repoRoot, 'src/components/SignInLightbox.tsx'), 'utf8')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const bannerSrc = stripComments(banner)
const headerSrc = stripComments(header)
const lightboxSrc = stripComments(lightbox)

describe('GuestLoginBanner — δ.1 single neutral button', () => {
  it('renders a single "Sign in" button (no LINE branding on the primary CTA)', () => {
    expect(bannerSrc).toMatch(/data-testid=["']guest-banner-signin["']/)
    expect(bannerSrc).toMatch(/Sign in/)
  })

  it('does NOT inline a LineIcon on the primary CTA (regression target)', () => {
    expect(bannerSrc).not.toMatch(/<LineIcon/)
    expect(bannerSrc).not.toMatch(/function LineIcon/)
  })

  it('does NOT render a separate "Other ways to sign in" link (v1.32.0 pattern removed)', () => {
    expect(bannerSrc).not.toMatch(/Other ways to sign in/)
    expect(bannerSrc).not.toMatch(/data-testid=["']guest-banner-other-ways["']/)
    expect(bannerSrc).not.toMatch(/data-testid=["']guest-banner-line-button["']/)
  })

  it('does NOT call signIn directly — the lightbox owns provider dispatch', () => {
    expect(bannerSrc).not.toMatch(/signIn\(\s*['"]line['"]/)
    expect(bannerSrc).not.toMatch(/signIn\(\s*['"]google['"]/)
    expect(bannerSrc).not.toMatch(/signIn\(\s*['"]email['"]/)
  })

  it('imports + renders SignInLightbox', () => {
    expect(bannerSrc).toMatch(/import\s+SignInLightbox\s+from\s+['"]\.\/SignInLightbox['"]/)
    expect(bannerSrc).toMatch(/<SignInLightbox\b/)
  })

  it('keeps the LINE green color on the button (per user spec)', () => {
    expect(bannerSrc).toMatch(/#06C755/)
  })
})

describe('LineLoginButton — δ.1 single neutral button (logged-out branch)', () => {
  it('renders a "Sign in" button with no LINE icon on the primary CTA', () => {
    expect(headerSrc).toMatch(/data-testid=["']header-signin["']/)
    expect(headerSrc).toMatch(/"Sign in"/)
  })

  it('does NOT render the v1.32.0 "Other" text link as a sibling pill', () => {
    expect(headerSrc).not.toMatch(/data-testid=["']header-other-ways["']/)
    expect(headerSrc).not.toMatch(/data-testid=["']header-line-button["']/)
  })

  it('imports + renders SignInLightbox', () => {
    expect(headerSrc).toMatch(/import\s+SignInLightbox\s+from\s+['"]\.\/SignInLightbox['"]/)
    expect(headerSrc).toMatch(/<SignInLightbox\b/)
    expect(headerSrc).toMatch(/showSignInLightbox/)
  })

  it('keeps the LINE green color on the button (per user spec)', () => {
    expect(headerSrc).toMatch(/#06C755/)
  })

  it('preserves the dev-only impersonation dropdown (separate from the lightbox)', () => {
    expect(headerSrc).toMatch(/isLocalDev/)
    expect(headerSrc).toMatch(/Impersonate/)
    expect(headerSrc).toMatch(/dev-login/)
  })

  it('preserves the staging "Dev" link for NEXT_PUBLIC_DEV_MODE', () => {
    expect(headerSrc).toMatch(/NEXT_PUBLIC_DEV_MODE/)
  })
})

describe('SignInLightbox — modal contract', () => {
  it('is a client component', () => {
    expect(lightboxSrc).toMatch(/^['"]use client['"]/)
  })

  it('renders all three provider options (LINE / Google / email)', () => {
    expect(lightboxSrc).toMatch(/data-testid=["']lightbox-line["']/)
    expect(lightboxSrc).toMatch(/data-testid=["']lightbox-google["']/)
    expect(lightboxSrc).toMatch(/data-testid=["']lightbox-email["']/)
  })

  it('hides Google and email when their providers are not enabled (server env-var gate)', () => {
    expect(lightboxSrc).toMatch(/getProviders/)
    expect(lightboxSrc).toMatch(/providers\.google/)
    expect(lightboxSrc).toMatch(/providers\.email/)
  })

  it('LINE button always renders (load-bearing — production has LINE wired since v1.0)', () => {
    // LINE is unconditional; the {providers.google && ...} and
    // {providers.email && ...} conditionals only gate non-LINE providers.
    expect(lightboxSrc).toMatch(/data-testid=["']lightbox-line["']/)
    // Crude proof that the LINE button isn't behind a {providers.line && ...} gate:
    // there's no `providers.line` reference in the file.
    expect(lightboxSrc).not.toMatch(/providers\.line/)
  })

  it('email magic-link transitions to a "check your email" inline state (no full-page navigation)', () => {
    expect(lightboxSrc).toMatch(/data-testid=["']lightbox-email-form["']/)
    expect(lightboxSrc).toMatch(/data-testid=["']lightbox-email-sent["']/)
    expect(lightboxSrc).toMatch(/setStep\(\s*['"]email-sent['"]\s*\)/)
    expect(lightboxSrc).toMatch(/redirect:\s*false/)
  })

  it('LINE / Google buttons fire signIn() directly to kick off OAuth redirect', () => {
    expect(lightboxSrc).toMatch(/signIn\(\s*['"]line['"]/)
    expect(lightboxSrc).toMatch(/signIn\(\s*['"]google['"]/)
  })

  it('closes on ESC keypress', () => {
    expect(lightboxSrc).toMatch(/key === ['"]Escape['"]/)
    expect(lightboxSrc).toMatch(/onClose\(\)/)
  })

  it('closes on backdrop click', () => {
    expect(lightboxSrc).toMatch(/className=["'][^"']*absolute inset-0[^"']*["'][\s\S]*?onClick=\{onClose\}/)
  })

  it('uses createPortal to render outside the parent stacking context', () => {
    expect(lightboxSrc).toMatch(/createPortal/)
  })

  it('traps focus within the card while open (Tab cycles internally)', () => {
    expect(lightboxSrc).toMatch(/FOCUSABLE/)
    expect(lightboxSrc).toMatch(/key !== ['"]Tab['"]/)
  })

  it('has a close button with aria-label for keyboard / screen-reader users', () => {
    expect(lightboxSrc).toMatch(/aria-label=["']Close sign-in["']/)
    expect(lightboxSrc).toMatch(/data-testid=["']signin-lightbox-close["']/)
  })

  it('uses dialog role + aria-modal for assistive tech', () => {
    expect(lightboxSrc).toMatch(/role=["']dialog["']/)
    expect(lightboxSrc).toMatch(/aria-modal=["']true["']/)
  })
})
