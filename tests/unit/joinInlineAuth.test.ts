/**
 * v1.40.0 — Invite-page inline auth.
 *
 * Pre-v1.40.0 the signed-out `/join/[code]` flow bounced to `/auth/signin`:
 *   - PERSONAL preview: "Yes, that's me — sign in to confirm" routed to
 *     `/auth/signin?callbackUrl=/join/<code>`.
 *   - CODE preview: a single "Sign in to continue" link routed there too.
 * Both bounced back to `/join/<code>` after auth, losing branding context
 * for two round-trips.
 *
 * v1.40.0 collapses the YES step. Picking a provider IS the confirmation:
 * three buttons render inline below the invite preview, each fires
 * `signIn(provider, { callbackUrl: '/join/<code>' })`. After the OAuth
 * round-trip the user lands back signed-in and the redemption flow kicks
 * off automatically.
 *
 * Tests in this file pin the load-bearing surface: the new `JoinInlineAuth`
 * client component exists with the right provider buttons + callbackUrl
 * shape; the page wires it into both signed-out branches; the legacy
 * `/auth/signin` redirect is gone from those branches; and
 * `RedeemPersonalForm` no longer carries the signed-out branch.
 *
 * Structural tests (file content) — the components pull in `next-auth/react`
 * and React state which aren't trivial to mock for a tiny presence check.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_ROOT = join(__dirname, '..', '..')

// Strip JS / JSX comments before asserting "string is not in source" — we
// describe the pre-v1.40.0 behavior in docstrings, and we don't want a
// regression test to flag those legitimate descriptions.
function stripComments(src: string): string {
  // JSX block comments {/* ... */}, JS block comments /* ... */, and line
  // comments //... — order matters so the JSX-block strip runs first.
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const INLINE_AUTH_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'join', '[code]', 'JoinInlineAuth.tsx'),
  'utf-8',
)
const PAGE_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'join', '[code]', 'page.tsx'),
  'utf-8',
)
const REDEEM_FORM_SRC = readFileSync(
  join(PROJECT_ROOT, 'src', 'app', 'join', '[code]', 'RedeemPersonalForm.tsx'),
  'utf-8',
)
const INLINE_AUTH_CODE = stripComments(INLINE_AUTH_SRC)
const PAGE_CODE = stripComments(PAGE_SRC)
const REDEEM_FORM_CODE = stripComments(REDEEM_FORM_SRC)

describe('JoinInlineAuth — client component (v1.40.0)', () => {
  it("is marked 'use client'", () => {
    expect(INLINE_AUTH_SRC).toMatch(/^'use client'/)
  })

  it('renders the LINE button with signIn(line, { callbackUrl: /join/<code> })', () => {
    expect(INLINE_AUTH_SRC).toMatch(/data-testid="join-inline-auth-line"/)
    // The callbackUrl is built from the `code` prop. We pin the construction.
    expect(INLINE_AUTH_SRC).toMatch(/const callbackUrl = `\/join\/\$\{code\}`/)
    expect(INLINE_AUTH_SRC).toMatch(/signIn\('line',\s*\{\s*callbackUrl\s*\}\)/)
  })

  it('renders the Google button gated by providers.google', () => {
    expect(INLINE_AUTH_SRC).toMatch(/data-testid="join-inline-auth-google"/)
    expect(INLINE_AUTH_SRC).toMatch(/signIn\('google',\s*\{\s*callbackUrl\s*\}\)/)
    // Gated on providers.google so the button hides when GOOGLE_CLIENT_ID
    // isn't set on Vercel.
    expect(INLINE_AUTH_SRC).toMatch(/\{providers\.google && \(/)
  })

  it('renders the Email button gated by providers.email + transitions to email-form', () => {
    expect(INLINE_AUTH_SRC).toMatch(/data-testid="join-inline-auth-email"/)
    expect(INLINE_AUTH_SRC).toMatch(/\{providers\.email && \(/)
    // Email button moves to the email-form step rather than firing signIn
    // directly — same shape as SignInLightbox.
    expect(INLINE_AUTH_SRC).toMatch(/setStep\('email-form'\)/)
  })

  it('email submit fires signIn(email, ...) with the same callbackUrl + redirect:false', () => {
    expect(INLINE_AUTH_SRC).toMatch(/data-testid="join-inline-auth-email-form"/)
    expect(INLINE_AUTH_SRC).toMatch(
      /signIn\('email',\s*\{\s*email,\s*callbackUrl,\s*redirect:\s*false\s*\}\)/,
    )
    expect(INLINE_AUTH_SRC).toMatch(/setStep\('email-sent'\)/)
  })

  it('uses getProviders() to detect which non-LINE providers are wired', () => {
    expect(INLINE_AUTH_SRC).toMatch(/import.*getProviders.*from 'next-auth\/react'/)
    expect(INLINE_AUTH_SRC).toMatch(/getProviders\(\)/)
  })

  it("doesn't import next/navigation router or Link — buttons fire signIn directly", () => {
    // Regression target: the signed-out path must NOT route to /auth/signin
    // anymore. If a future edit re-introduces a `router.push('/auth/signin'...)`
    // or `<Link href="/auth/signin"...>` here, this test fails.
    expect(INLINE_AUTH_CODE).not.toMatch(/\/auth\/signin/)
  })

  it('does NOT use createPortal or focus-trap (inline, not modal)', () => {
    // SignInLightbox uses createPortal + focus-trap because it's a modal.
    // JoinInlineAuth renders inline inside the invite card. Pinning this
    // guards against an accidental modalization regression.
    expect(INLINE_AUTH_SRC).not.toMatch(/createPortal/)
    expect(INLINE_AUTH_SRC).not.toMatch(/aria-modal="true"/)
  })
})

describe('/join/[code] page — wires JoinInlineAuth into signed-out branches (v1.40.0)', () => {
  it('imports JoinInlineAuth', () => {
    expect(PAGE_SRC).toMatch(/import\s+JoinInlineAuth\s+from\s+'\.\/JoinInlineAuth'/)
  })

  it('PersonalPreview signed-out branch renders JoinInlineAuth (not RedeemPersonalForm)', () => {
    // The branching shape is `isSignedIn ? <RedeemPersonalForm/> : <JoinInlineAuth/>`.
    expect(PAGE_SRC).toMatch(/isSignedIn \? \([\s\S]*?<RedeemPersonalForm[\s\S]*?\) : \([\s\S]*?<JoinInlineAuth/)
  })

  it('CodePreviewSignedOut renders JoinInlineAuth (not the legacy /auth/signin link)', () => {
    // Find the CodePreviewSignedOut function body and assert JoinInlineAuth
    // is mounted there.
    const fnIdx = PAGE_SRC.indexOf('function CodePreviewSignedOut')
    expect(fnIdx).toBeGreaterThan(0)
    const fnBody = PAGE_SRC.slice(fnIdx, fnIdx + 2000)
    expect(fnBody).toMatch(/<JoinInlineAuth code=\{code\}/)
    // Strip comments before the negative assertions so a docstring
    // describing the pre-v1.40.0 behavior doesn't fail this test.
    const fnBodyCode = stripComments(fnBody)
    // The legacy "/auth/signin?callbackUrl=..." link must be gone from this
    // branch. Pin the load-bearing regression: previous shape was a `<Link
    // href={`/auth/signin?callbackUrl=...`}>` and we don't want it back.
    expect(fnBodyCode).not.toMatch(/\/auth\/signin/)
    expect(fnBodyCode).not.toMatch(/Sign in to continue/)
  })

  it('the legacy `data-testid="join-signin-cta"` is gone from the page', () => {
    // The pre-v1.40.0 sign-in link carried this testid. If a regression
    // re-introduces it, this test fails.
    expect(PAGE_SRC).not.toMatch(/data-testid="join-signin-cta"/)
  })
})

describe('RedeemPersonalForm — signed-out branch removed (v1.40.0)', () => {
  it('Props no longer include isSignedIn', () => {
    // The interface now has just code / inviteCode / skipOnboarding.
    // Pin removal of `isSignedIn` to catch accidental re-introduction.
    const propsBlock = REDEEM_FORM_SRC.match(/interface Props \{[\s\S]+?\}/)
    expect(propsBlock).toBeTruthy()
    expect(propsBlock![0]).not.toMatch(/isSignedIn/)
  })

  it('component does not branch on isSignedIn', () => {
    // The function signature destructures the props; isSignedIn must not
    // appear at all in this file.
    expect(REDEEM_FORM_SRC).not.toMatch(/isSignedIn/)
  })

  it('handleYes fires redeemInvite directly (no /auth/signin redirect)', () => {
    // Pre-v1.40.0 the function was:
    //   if (!isSignedIn) { router.push(`/auth/signin?...`); return }
    //   startTransition(async () => { await redeemInvite({ code }) ... })
    // Post-v1.40.0 the guard is gone — the parent only mounts this when
    // signed-in. Strip comments before asserting absence so a docstring
    // describing the legacy shape doesn't fail this test.
    expect(REDEEM_FORM_CODE).not.toMatch(/\/auth\/signin/)
    expect(REDEEM_FORM_CODE).toMatch(/redeemInvite\(\{ code \}\)/)
  })

  it("the button label drops the 'sign in to confirm' variant", () => {
    // Pre-v1.40.0 the label was:
    //   isSignedIn ? (skipOnboarding ? '...link my account' : '...continue')
    //              : "Yes, that's me — sign in to confirm"
    // Post-v1.40.0 the signed-out branch is gone.
    expect(REDEEM_FORM_CODE).not.toMatch(/sign in to confirm/i)
  })
})
