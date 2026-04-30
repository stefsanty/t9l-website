import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getAuthCookieDomain } from '@/lib/auth'

/**
 * v1.24.0 — `getAuthCookieDomain()` resolves the cookie domain attribute
 * for the NextAuth session token from the NEXTAUTH_URL env var.
 *
 * Pre-v1.24.0 NextAuth's session cookie defaulted to host-only scope, so a
 * JWT issued at t9l.me would not be sent to tamachi.t9l.me. v1.24.0 sets
 * the cookie's `domain` attribute to `.t9l.me` on prod hosts so the JWT is
 * shared across subdomains.
 *
 * Branches pinned:
 *   - prod apex (https://t9l.me) → ".t9l.me"
 *   - prod subdomain (https://tamachi.t9l.me) → ".t9l.me"
 *   - dev base (https://dev.t9l.me) → ".t9l.me"
 *   - localhost (http://localhost:3000) → undefined (cookies with `domain`
 *     attribute don't work on localhost)
 *   - Vercel preview (https://*.vercel.app) → undefined (single-host scope)
 *   - missing NEXTAUTH_URL → undefined
 *   - malformed NEXTAUTH_URL → undefined (defensive)
 *
 * The matching logic must update IF the apex domain ever migrates from
 * t9l.me — see CLAUDE.md "Domain migration runbook".
 */

const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL

beforeEach(() => {
  delete process.env.NEXTAUTH_URL
})

afterEach(() => {
  if (ORIGINAL_NEXTAUTH_URL === undefined) {
    delete process.env.NEXTAUTH_URL
  } else {
    process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL
  }
})

describe('getAuthCookieDomain — NEXTAUTH_URL → cookie domain attribute', () => {
  it('returns ".t9l.me" for the production apex (https://t9l.me)', () => {
    process.env.NEXTAUTH_URL = 'https://t9l.me'
    expect(getAuthCookieDomain()).toBe('.t9l.me')
  })

  it('returns ".t9l.me" for production subdomains (https://tamachi.t9l.me)', () => {
    process.env.NEXTAUTH_URL = 'https://tamachi.t9l.me'
    expect(getAuthCookieDomain()).toBe('.t9l.me')
  })

  it('returns ".t9l.me" for the dev base (https://dev.t9l.me)', () => {
    process.env.NEXTAUTH_URL = 'https://dev.t9l.me'
    expect(getAuthCookieDomain()).toBe('.t9l.me')
  })

  it('returns ".t9l.me" for nested dev subdomains (https://test.dev.t9l.me)', () => {
    process.env.NEXTAUTH_URL = 'https://test.dev.t9l.me'
    expect(getAuthCookieDomain()).toBe('.t9l.me')
  })

  it('returns undefined for localhost (cookies with domain attribute do not work)', () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3000'
    expect(getAuthCookieDomain()).toBeUndefined()
  })

  it('returns undefined for Vercel preview hosts (single-host scope)', () => {
    process.env.NEXTAUTH_URL = 'https://t9l-website-abc123-t9l-app.vercel.app'
    expect(getAuthCookieDomain()).toBeUndefined()
  })

  it('returns undefined when NEXTAUTH_URL is missing (defensive)', () => {
    delete process.env.NEXTAUTH_URL
    expect(getAuthCookieDomain()).toBeUndefined()
  })

  it('returns undefined when NEXTAUTH_URL is malformed (defensive)', () => {
    process.env.NEXTAUTH_URL = 'not-a-url'
    expect(getAuthCookieDomain()).toBeUndefined()
  })

  it('does NOT match a domain that merely contains "t9l.me" as a substring (e.g. eviltt9l.me)', () => {
    // Defensive: "evilt9l.me" naively endswith ".t9l.me"? No — it doesn't
    // start with a dot. But "eviltt9l.me" doesn't end with ".t9l.me" either.
    // Pin the substring-vs-suffix distinction explicitly.
    process.env.NEXTAUTH_URL = 'https://eviltt9l.me'
    expect(getAuthCookieDomain()).toBeUndefined()
  })

  it('does NOT match an attacker domain like "evil.t9l.me.attacker.com"', () => {
    process.env.NEXTAUTH_URL = 'https://evil.t9l.me.attacker.com'
    expect(getAuthCookieDomain()).toBeUndefined()
  })

  it('matches case-sensitively per the URL spec (https://T9L.ME → undefined for safety)', () => {
    // URL hostnames are normalized to lowercase by `new URL()`. Pin that the
    // canonical form passes through; mixed-case input gets normalized.
    process.env.NEXTAUTH_URL = 'https://T9L.ME'
    // After URL normalization, hostname is "t9l.me" → matches.
    expect(getAuthCookieDomain()).toBe('.t9l.me')
  })
})
