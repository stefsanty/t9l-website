'use server'

/**
 * v1.97.5 — server actions for the `t9l_default_league` cookie.
 *
 * The cookie is a UX preference (which league to render on the
 * persona-aware apex when no `?league=` searchParam is supplied). All
 * value validation against the caller's memberships happens at the
 * READ site (`classifyPersona`), so these actions stay deliberately
 * lightweight:
 *
 *   - `setDefaultLeagueCookie(leagueId)` — invoked from the Header
 *     `<LeagueSwitcher>` pill-click handler, fire-and-forget. Sets the
 *     cookie if `leagueId` passes shape validation; silently no-ops
 *     otherwise.
 *
 *   - `clearDefaultLeagueCookie()` — invoked from the sign-out button
 *     before NextAuth's `signOut()` fires. Removes the cookie so the
 *     next user on the same device doesn't inherit a stale preference.
 *     (The read-side validation would catch cross-user leakage anyway,
 *     but eager clearing keeps the contract clean.)
 *
 * Neither action is auth-gated. The cookie value is non-sensitive
 * (just a league id) and the read site validates against the caller's
 * own memberships, so the worst a malicious caller can do is set a
 * cookie value that the next read silently ignores.
 *
 * Per the `'use server'` no-value-export rule (CLAUDE.md), this file
 * only exports `async function`s.
 */

import { cookies } from 'next/headers'
import {
  DEFAULT_LEAGUE_COOKIE_NAME,
  defaultLeagueCookieOptions,
  normaliseDefaultLeagueCookieValue,
} from '@/lib/defaultLeagueCookie'

export async function setDefaultLeagueCookie(rawLeagueId: string): Promise<void> {
  const value = normaliseDefaultLeagueCookieValue(rawLeagueId)
  if (!value) return
  const jar = await cookies()
  jar.set(DEFAULT_LEAGUE_COOKIE_NAME, value, defaultLeagueCookieOptions())
}

export async function clearDefaultLeagueCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(DEFAULT_LEAGUE_COOKIE_NAME)
}
