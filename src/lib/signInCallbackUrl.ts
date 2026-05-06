/**
 * v1.70.3 — Pure helper to compute the `callbackUrl` for in-page sign-in
 * triggers (header sign-in pill, GuestLoginBanner CTA, etc.).
 *
 * Pre-v1.70.3 the `<SignInLightbox>` callers in `GuestLoginBanner` and
 * `LineLoginButton` mounted the lightbox WITHOUT a `callbackUrl` prop,
 * defaulting to `/`. A user who initiated sign-in from `/id/<slug>` (or
 * any subpage) lost their league/page context and landed on apex after
 * the OAuth round-trip. Same root cause: every `signIn()` invocation
 * needs an explicit callbackUrl pointing at the current page.
 *
 * `getCurrentCallbackUrl()` returns `window.location.pathname +
 * window.location.search` so the user lands back on whatever page they
 * triggered sign-in from. Hash fragments are intentionally dropped —
 * they don't survive the OAuth round-trip and aren't load-bearing for
 * the current routes (no scroll-anchor flows on the auth surfaces).
 *
 * Excluded routes (return `/` instead — landing back on the auth page
 * after auth would be confusing UX):
 *   - `/auth/signin`, `/auth/verify-request`, `/auth-error`
 *   - `/admin/login`
 *
 * SSR / non-browser fallback: returns `/` when `window` is undefined.
 *
 * The helper is exported separately so unit tests can pin the contract
 * without instantiating a `<SignInLightbox>`.
 */

const EXCLUDED_PREFIXES = [
  '/auth/signin',
  '/auth/verify-request',
  '/auth-error',
  '/admin/login',
]

export function isExcludedAuthPath(pathname: string): boolean {
  for (const p of EXCLUDED_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + '/')) {
      return true
    }
  }
  return false
}

export function buildCallbackUrlFromLocation(
  pathname: string,
  search: string,
): string {
  if (isExcludedAuthPath(pathname)) return '/'
  return pathname + (search || '')
}

export function getCurrentCallbackUrl(): string {
  if (typeof window === 'undefined') return '/'
  try {
    return buildCallbackUrlFromLocation(
      window.location.pathname,
      window.location.search,
    )
  } catch {
    return '/'
  }
}
