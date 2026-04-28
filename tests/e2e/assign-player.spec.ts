import { test, expect } from '@playwright/test'

test.describe('public assign-player surface', () => {
  test('page renders with the player-search form', async ({ page }) => {
    const response = await page.goto('/assign-player')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: /Who are you\?/i })).toBeVisible()
    await expect(page.getByPlaceholder(/Search your name/i)).toBeVisible()
    // Bottom action bar always visible (fixed-position) regardless of session.
    await expect(page.getByRole('button', { name: /Guest|Confirm|Select Player/i }).first()).toBeVisible()
  })

  /**
   * Manual reproduction of the v1.1.1 "Saving…" stuck-state bug (fixed in v1.1.2):
   *
   *   1. Run `npm run dev` locally (NODE_ENV=development → exposes dev-login provider).
   *   2. Open http://localhost:3000 in a fresh browser profile, click the avatar →
   *      "Login as Guest (No Player)". Lands on /assign-player as `guest-dev`.
   *   3. Search for any roster name, click a tile, click "Confirm".
   *   4. PRE-FIX: Button shows "Saving…" indefinitely; navigation to "/" never
   *      perceptibly completes even though the API route returns 200.
   *      POST-FIX: Button briefly flashes "Saving…", page navigates to "/" within
   *      ~1s with the assigned player reflected in the avatar dropdown.
   *
   * The dev-login provider is gated on NODE_ENV=development (see lib/auth.ts), so
   * an automated assertion of this flow cannot run against a Vercel preview or
   * prod deploy. Adding @testing-library/react + jsdom solely for this 1-line
   * navigation tweak is out of scope for a patch release; revisit if the public
   * `/assign-player` flow grows additional client-side state machines.
   */
})
