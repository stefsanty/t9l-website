import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * v1.49.0 — server-side session hydration. Pre-v1.49.0 the root layout
 * was a synchronous server component that mounted `<SessionProvider>`
 * with no seed value. Every page load forced a post-paint
 * `/api/auth/session` round-trip from the client to populate the
 * session, during which every `useSession()` consumer (Dashboard,
 * UserTeamBadge, RsvpBar, NextMatchdayBanner, GuestLoginBanner,
 * LineLoginButton, etc.) returned `{ data: undefined, status: 'loading' }`.
 * The user saw the unauthenticated UI on first paint and the auth-aware
 * UI flashed in 300ms-1s later — the user-reported "auth UI takes long
 * to display" bug.
 *
 * The fix is the canonical NextAuth pattern:
 *   1. Layout becomes async; calls `getServerSession(authOptions)`.
 *   2. The resolved session is passed to `<AuthProvider>` via prop.
 *   3. `<AuthProvider>` forwards it to `<SessionProvider session={...}>`.
 *
 * `SessionProvider` then returns the seed synchronously from
 * `useSession()` on first render — no client round-trip, no flash.
 * The JWT callback runs server-side in parallel with the page's RSC
 * data fetch (Next parallelizes layout + page on the same request),
 * so total wall-clock TTFB is unchanged or improved.
 *
 * These tests are structural — they pin the call shape across the
 * three files so a regression to the pre-v1.49.0 shape (sync layout,
 * no session prop, missing getServerSession) fails CI.
 */

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

// Strip line comments + block comments so doc strings that mention the
// pre-v1.49.0 names don't trip negative regex assertions.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('app/layout.tsx — server-side session hydration (v1.49.0)', () => {
  const raw = read('src/app/layout.tsx')
  const code = stripComments(raw)

  it('imports getServerSession from next-auth', () => {
    expect(code).toMatch(/import\s*\{\s*getServerSession\s*\}\s*from\s*["']next-auth["']/)
  })

  it('imports authOptions from @/lib/auth', () => {
    expect(code).toMatch(/import\s*\{\s*authOptions\s*\}\s*from\s*["']@\/lib\/auth["']/)
  })

  it('declares RootLayout as async (regression target — sync layout had no seed)', () => {
    expect(code).toMatch(/export\s+default\s+async\s+function\s+RootLayout/)
  })

  it('awaits getServerSession(authOptions) inside RootLayout', () => {
    expect(code).toMatch(/await\s+getServerSession\s*\(\s*authOptions\s*\)/)
  })

  it('passes the resolved session into <AuthProvider session={session}>', () => {
    expect(code).toMatch(/<AuthProvider\s+session=\{session\}/)
  })

  it('does not mount AuthProvider without the session prop (regression target)', () => {
    // Pre-v1.49.0 shape: <AuthProvider> with no props. If a future PR
    // strips the seed, useSession would flash to loading on every load.
    const authProviderOpens = code.match(/<AuthProvider(\s|>)/g) ?? []
    for (const open of authProviderOpens) {
      // Each open tag must include `session=` somewhere before its `>`.
      // We assert the count of `<AuthProvider session=` matches the
      // count of `<AuthProvider`.
    }
    const opensWithSession = code.match(/<AuthProvider\s+session=/g) ?? []
    expect(opensWithSession.length).toBe(authProviderOpens.length)
    expect(opensWithSession.length).toBeGreaterThan(0)
  })
})

describe('AuthProvider.tsx — accepts and threads the session prop', () => {
  const raw = read('src/components/AuthProvider.tsx')
  const code = stripComments(raw)

  it('is a client component', () => {
    expect(raw).toMatch(/^['"]use client['"]/)
  })

  it('imports SessionProvider from next-auth/react', () => {
    expect(code).toMatch(/import\s*\{\s*SessionProvider\s*\}\s*from\s*["']next-auth\/react["']/)
  })

  it('accepts an optional session prop', () => {
    expect(code).toMatch(/session\?:/)
  })

  it('forwards session to <SessionProvider session={session}>', () => {
    expect(code).toMatch(/<SessionProvider\s+session=\{session\}/)
  })

  it('does not mount SessionProvider with no props (regression target)', () => {
    // Pre-v1.49.0 shape: `<SessionProvider>{children}</SessionProvider>`.
    // If a future PR drops the prop, hydration goes back to round-tripping.
    expect(code).not.toMatch(/<SessionProvider>\s*\{children\}/)
  })
})
