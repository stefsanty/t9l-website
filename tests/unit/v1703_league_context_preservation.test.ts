/**
 * v1.70.3 — Preserve original page context across auth + registration
 * flows.
 *
 * User report: visiting `/id/test` and clicking the header "Sign in" pill
 * (or the GuestLoginBanner CTA) initiated NextAuth, but after the OAuth
 * round-trip the user landed on `/` (the apex / default-league view)
 * instead of `/id/test`. Same shape: the v1.32.1 `<SignInLightbox>` was
 * mounted by both `GuestLoginBanner.tsx` and `LineLoginButton.tsx`
 * WITHOUT a `callbackUrl` prop — the lightbox's interface defaulted it
 * to `'/'` and silently dropped the league/page context.
 *
 * Fix: a small pure helper `getCurrentCallbackUrl()` reads
 * `window.location.pathname + window.location.search` (with an excluded
 * list of auth-only paths to avoid landing back on `/auth/signin` after
 * sign-in). Both callers capture the path at click time and thread it
 * into the lightbox.
 *
 * The other in-flow surfaces audited in v1.70.3 are already correct and
 * pinned defensively here as regression targets so a future PR can't
 * undo them silently:
 *   - `/recruit/[slug]` post-submit redirect goes to `/id/<slug>`
 *   - `/join/[code]/welcome` redirects to `/id/<league.subdomain>`
 *   - `JoinInlineAuth` passes `callbackUrl: /join/<code>` to every
 *     provider's signIn() invocation
 *   - The `/recruit/[slug]` SignInSurface routes the auth picker through
 *     `?callbackUrl=/recruit/<slug>` so post-auth the user lands back on
 *     the registration form, not on apex.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  buildCallbackUrlFromLocation,
  isExcludedAuthPath,
  getCurrentCallbackUrl,
} from '../../src/lib/signInCallbackUrl'

const REPO_ROOT = resolve(__dirname, '..', '..')

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8')
}

// Strip line + block comments so docstring narrative that contains
// regression-target literals doesn't accidentally satisfy the negative
// assertions or trip the positive ones.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('v1.70.3 — getCurrentCallbackUrl pure helper contract', () => {
  it('isExcludedAuthPath — excludes /auth/signin and nested', () => {
    expect(isExcludedAuthPath('/auth/signin')).toBe(true)
    expect(isExcludedAuthPath('/auth/signin/foo')).toBe(true)
  })

  it('isExcludedAuthPath — excludes /auth/verify-request and /auth-error and /admin/login', () => {
    expect(isExcludedAuthPath('/auth/verify-request')).toBe(true)
    expect(isExcludedAuthPath('/auth-error')).toBe(true)
    expect(isExcludedAuthPath('/admin/login')).toBe(true)
  })

  it('isExcludedAuthPath — does NOT exclude /id/<slug> or /', () => {
    expect(isExcludedAuthPath('/id/test')).toBe(false)
    expect(isExcludedAuthPath('/id/t9l')).toBe(false)
    expect(isExcludedAuthPath('/id/foo/md/md1')).toBe(false)
    expect(isExcludedAuthPath('/')).toBe(false)
    expect(isExcludedAuthPath('/schedule')).toBe(false)
    expect(isExcludedAuthPath('/recruit/test')).toBe(false)
  })

  it('isExcludedAuthPath — does NOT exclude /authorize or other near-prefixes', () => {
    // suffix-vs-substring discipline (mirrors v1.24.0 cookie helper)
    expect(isExcludedAuthPath('/authorize')).toBe(false)
    expect(isExcludedAuthPath('/auth-error-page')).toBe(false)
  })

  it('buildCallbackUrlFromLocation — concatenates pathname + search for normal pages', () => {
    expect(buildCallbackUrlFromLocation('/id/test', '')).toBe('/id/test')
    expect(buildCallbackUrlFromLocation('/id/test', '?tab=stats')).toBe(
      '/id/test?tab=stats',
    )
    expect(buildCallbackUrlFromLocation('/', '')).toBe('/')
    expect(
      buildCallbackUrlFromLocation('/id/foo/md/md1', '?utm=x'),
    ).toBe('/id/foo/md/md1?utm=x')
  })

  it('buildCallbackUrlFromLocation — collapses excluded paths to /', () => {
    expect(buildCallbackUrlFromLocation('/auth/signin', '?error=x')).toBe('/')
    expect(buildCallbackUrlFromLocation('/auth/verify-request', '')).toBe('/')
    expect(buildCallbackUrlFromLocation('/admin/login', '')).toBe('/')
    expect(buildCallbackUrlFromLocation('/auth-error', '')).toBe('/')
  })

  it('getCurrentCallbackUrl — returns / when window is undefined (SSR safety)', () => {
    // Node test env doesn't have window unless jsdom is set up.
    // The helper guards via typeof window === 'undefined' and returns '/'.
    const originalWindow = (globalThis as { window?: unknown }).window
    try {
      delete (globalThis as { window?: unknown }).window
      expect(getCurrentCallbackUrl()).toBe('/')
    } finally {
      if (originalWindow !== undefined) {
        ;(globalThis as { window?: unknown }).window = originalWindow
      }
    }
  })
})

describe('v1.70.3 — GuestLoginBanner threads callbackUrl into lightbox', () => {
  const src = read('src/components/GuestLoginBanner.tsx')
  const noComments = stripComments(src)

  it('imports getCurrentCallbackUrl helper', () => {
    expect(noComments).toMatch(/from ['"]@\/lib\/signInCallbackUrl['"]/)
    expect(noComments).toMatch(/getCurrentCallbackUrl/)
  })

  it('passes callbackUrl prop to <SignInLightbox>', () => {
    // regression target — pre-v1.70.3 the prop was missing entirely
    // (use [\s\S] not [^>] because the tag's onClose handler contains
    // an arrow `=>` which breaks the simple non-greedy negation)
    expect(noComments).toMatch(
      /<SignInLightbox[\s\S]*?callbackUrl=\{callbackUrl\}[\s\S]*?\/>/,
    )
  })

  it('captures callback URL when the user clicks Sign in (not at render time)', () => {
    // pin that we read window.location AT CLICK rather than at render —
    // a regression that hoisted getCurrentCallbackUrl() to the component
    // body would compute it once at SSR (always '/') and never update.
    expect(noComments).toMatch(/setCallbackUrl\(getCurrentCallbackUrl\(\)\)/)
  })
})

describe('v1.70.3 — LineLoginButton threads callbackUrl into lightbox', () => {
  const src = read('src/components/LineLoginButton.tsx')
  const noComments = stripComments(src)

  it('imports getCurrentCallbackUrl helper', () => {
    expect(noComments).toMatch(/from ['"]@\/lib\/signInCallbackUrl['"]/)
    expect(noComments).toMatch(/getCurrentCallbackUrl/)
  })

  it('passes callbackUrl prop to <SignInLightbox>', () => {
    // regression target — pre-v1.70.3 the prop was missing entirely
    expect(noComments).toMatch(
      /<SignInLightbox[\s\S]*?callbackUrl=\{signInCallbackUrl\}[\s\S]*?\/>/,
    )
  })

  it('captures callback URL when opening the lightbox via openSignInLightbox', () => {
    expect(noComments).toMatch(
      /setSignInCallbackUrl\(getCurrentCallbackUrl\(\)\)/,
    )
    // header sign-in button calls openSignInLightbox (not directly setShowSignInLightbox(true))
    // so the callbackUrl is captured at click time
    expect(noComments).toMatch(/openSignInLightbox\(\)/)
  })
})

describe('v1.70.3 — SignInLightbox preserves the threaded callbackUrl across providers', () => {
  const src = read('src/components/SignInLightbox.tsx')

  it('LINE button passes callbackUrl to signIn', () => {
    expect(src).toMatch(/signIn\('line', \{ callbackUrl \}\)/)
  })

  it('Google button passes callbackUrl to signIn', () => {
    expect(src).toMatch(/signIn\('google', \{ callbackUrl \}\)/)
  })

  it('Email magic-link includes callbackUrl in payload', () => {
    expect(src).toMatch(
      /signIn\('email', \{ email, callbackUrl, redirect: false \}\)/,
    )
  })
})

describe('v1.70.3 — Recruit + join flows preserve league context (regression targets)', () => {
  it('/recruit/[slug] form post-submit redirects to /id/<slug>', () => {
    const src = read('src/app/recruit/[slug]/RegistrationForm.tsx')
    expect(src).toMatch(/router\.push\(`\/id\/\$\{leagueSlug\}`\)/)
  })

  it('/recruit/[slug] sign-in surface routes auth picker back to /recruit/<slug>', () => {
    const src = read('src/app/recruit/[slug]/page.tsx')
    expect(src).toMatch(/callbackUrl=\$\{encodeURIComponent\(callback\)\}/)
    expect(src).toMatch(/const callback = `\/recruit\/\$\{slug\}`/)
  })

  it('/join/[code]/welcome links home to /id/<league.subdomain>', () => {
    const src = read('src/app/join/[code]/welcome/page.tsx')
    expect(src).toMatch(
      /league\.subdomain \? `\/id\/\$\{league\.subdomain\}` : '\/'/,
    )
  })

  it('JoinInlineAuth passes /join/<code> as callbackUrl to every provider', () => {
    const src = read('src/app/join/[code]/JoinInlineAuth.tsx')
    expect(src).toMatch(/const callbackUrl = `\/join\/\$\{code\}`/)
    expect(src).toMatch(/signIn\('line', \{ callbackUrl \}\)/)
    expect(src).toMatch(/signIn\('google', \{ callbackUrl \}\)/)
    expect(src).toMatch(
      /signIn\('email', \{ email, callbackUrl, redirect: false \}\)/,
    )
  })
})

describe('v1.70.3 — version bump', () => {
  it('APP_VERSION === 1.70.3', () => {
    const src = read('src/lib/version.ts')
    expect(src).toMatch(/APP_VERSION = '1\.70\.3'/)
  })
})
