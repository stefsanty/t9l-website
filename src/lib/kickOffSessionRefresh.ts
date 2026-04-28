/**
 * Trigger a next-auth session refresh in the background — explicitly
 * non-awaited so the user's critical path doesn't wait for what is, under
 * cold-lambda steady-state (this site's regime), another cold-startable
 * `/api/auth/session` round-trip after the assign-player API write.
 *
 * Why this exists (PR 11 / v1.3.0):
 *   Pre-fix the assign flow did `await update()` between API success and
 *   navigation. Even with PR 8/9's mapping cache pre-warm bringing the
 *   warm-cache p50 to 108ms, the underlying request itself can land on a
 *   cold lambda (this site has low traffic — most requests are first-of-
 *   session) and pay a 1–3s spin-up. Running the refresh in parallel with
 *   navigation costs the same lambda but moves it off the perceived path.
 *   The Promise is fire-and-forget — the catch keeps unhandled rejections
 *   out of the console (next-auth's update is generally fail-soft, but the
 *   reject branch exists). Regression target: if a future edit re-adds
 *   `await`, the unit test in tests/unit/kickOffSessionRefresh.test.ts
 *   catches it via async-ordering assertion.
 */

export function kickOffSessionRefresh(update: () => Promise<unknown>): void {
  void update().catch((err) => {
    console.warn('[assign] background session refresh failed:', err)
  })
}
