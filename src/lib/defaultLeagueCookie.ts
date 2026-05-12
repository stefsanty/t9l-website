/**
 * v1.97.5 — client-side preference cookie for "user's last-viewed league."
 *
 * Background. The persona-aware apex (`/test`, swap-target `/`) picks
 * which league's dashboard to render via
 * `homepageRouting.classifyPersona`. Pre-v1.97.5 the priority was:
 *
 *   URL `?league=<id>` > `User.defaultLeagueId` (DB) > alphabetical-first
 *
 * The DB read happens via `prisma.user.findUnique` inside
 * `getApprovedMembershipsAndDefault`. On first paint of a returning
 * visitor (no `?league=` searchParam, cold function instance), that's
 * one extra round-trip the user waits on.
 *
 * v1.97.5 adds a cookie-backed fast-path between the URL and the DB:
 *
 *   URL `?league=<id>` > COOKIE > `User.defaultLeagueId` > alphabetical-first
 *
 * The cookie is set every time the user clicks a pill in the Header
 * `<LeagueSwitcher>` (via the `setDefaultLeagueCookie` server action,
 * fire-and-forget). The read path is server-only (`cookies()` from
 * `next/headers` inside `<HomepageRouter>`), so the cookie can be
 * `HttpOnly`. That keeps the value off `document.cookie` and out of
 * any client-side analytics or XSS exfiltration vectors.
 *
 * Validation. The cookie value is just a league id; tampering can't
 * pin a viewer to a league they aren't in — `classifyPersona` checks
 * every candidate against the memberships list (same gate URL inputs
 * already pass through). A stale cookie (user lost access) falls
 * through to the DB and then to the deterministic alphabetical-first.
 *
 * Pure module — no I/O. Exports a name + options builder so the
 * server action + the sign-out path can stay in sync.
 */

/**
 * Cookie name. Prefixed with `t9l_` so it doesn't collide with the
 * NextAuth cookies (`next-auth.*`, `__Secure-next-auth.*`). Lowercase
 * snake_case so curl + browser DevTools display is grep-friendly.
 */
export const DEFAULT_LEAGUE_COOKIE_NAME = 't9l_default_league'

/**
 * One-year expiry in seconds. Long-lived because:
 *   - The value is a UX preference (no security stake).
 *   - Validation is on read, so an outdated value falls through
 *     gracefully when the user loses access to that league.
 *   - The cookie naturally refreshes on every pill click, so an
 *     active user resets the clock continuously.
 */
export const DEFAULT_LEAGUE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * Build the options bag for `cookies().set(...)` / equivalent.
 *
 * `secure` derives from `NEXTAUTH_URL` (same heuristic the existing
 * NextAuth cookie config uses) so localhost (HTTP) gets the cookie
 * without the secure flag, and prod (HTTPS) gets it secure.
 */
export function defaultLeagueCookieOptions(): {
  httpOnly: boolean
  sameSite: 'lax'
  path: string
  secure: boolean
  maxAge: number
} {
  const secure = process.env.NEXTAUTH_URL?.startsWith('https://') ?? false
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: DEFAULT_LEAGUE_COOKIE_MAX_AGE,
  }
}

/**
 * Validate a candidate value before sending to the browser. The
 * server action runs without knowing the caller's memberships (that's
 * an extra round-trip we want to avoid on the hot click path), so
 * here we just guard against shape abuse:
 *
 *   - Must be a string.
 *   - Must be non-empty after trim.
 *   - Must look like a CUID-shaped id (alphanumeric + dash, 1-128
 *     chars). League ids in this project are Prisma cuids, but admin-
 *     era ids like `l-minato-2025` are also valid. The regex
 *     accommodates both shapes without naming the exact format.
 *
 * Returns the normalised value when valid, `null` otherwise. Pure.
 */
export function normaliseDefaultLeagueCookieValue(
  raw: unknown,
): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > 128) return null
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null
  return trimmed
}
