import { test, expect } from '@playwright/test'

const baseURL = process.env.BASE_URL ?? 'https://t9l.me'
const isLocal = baseURL.includes('localhost') || baseURL.includes('127.0.0.1')

test.describe('public assign-player surface', () => {
  test('page renders with the player-search form', async ({ page }) => {
    const response = await page.goto('/assign-player')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: /Who are you\?/i })).toBeVisible()
    await expect(page.getByPlaceholder(/Search your name/i)).toBeVisible()
    // Bottom action bar always visible (fixed-position) regardless of session.
    await expect(page.getByRole('button', { name: /Guest|Confirm|Select Player/i }).first()).toBeVisible()
  })
})

/**
 * Regression test for the v1.1.1 → v1.2.2 stuck-on-Saving bug, with the
 * timing target tightened to the Definition of Done in v1.3.0.
 *
 * Pre-fix the button stayed on "Saving…" for the entire post-click chain
 * (API write + next-auth update + router.push + destination RSC render).
 * Under the post-cutover Prisma-on-every-JWT auth path that's 5–7 seconds
 * end-to-end. v1.2.2 (PR 7) split that into submitting → redirecting at
 * the API boundary so the button leaves "Saving…" within ~1s of the API
 * responding. v1.3.0 (PR 11) drops the awaited next-auth `update()`,
 * removing a separate cold-startable /api/auth/session round-trip from
 * the user-visible critical path — so the label flip is now strictly
 * a React re-render after API response (~50ms in local dev). Timeout
 * tightened to 200ms to match the project Definition of Done target.
 *
 * Requires dev server (NODE_ENV=development → dev-login provider exposed
 * per `lib/auth.ts`). Skipped against any non-localhost BASE_URL because
 * the dev-login provider is intentionally absent from Vercel preview/prod.
 *
 * Run locally:
 *   npm run dev               # in another terminal
 *   BASE_URL=http://localhost:3000 npm run test:e2e -- assign-player
 *
 * The unit tests in tests/unit/assignButtonLabel.test.ts pin the state-
 * machine precedence (redirecting wins over submitting; redirecting wins
 * over isAlreadyAssigned). tests/unit/kickOffSessionRefresh.test.ts pins
 * the fire-and-forget call shape so re-introducing `await` is caught.
 */
test.describe('regression: button leaves Saving fast (PR α v1.2.2 + PR 11 v1.3.0)', () => {
  test.skip(!isLocal, 'requires local dev with dev-login provider (NODE_ENV=development)')

  test('button leaves "Saving…" within 200ms of API success (DoD)', async ({ page }) => {
    // Stall the destination page so navigation can't complete fast — this is
    // what masks the bug pre-fix (the component eventually unmounts when the
    // RSC payload arrives, but the user perceives 5+s of "Saving…").
    await page.route('**/', async (route) => {
      if (route.request().resourceType() === 'document') {
        await new Promise((r) => setTimeout(r, 4_000))
      }
      await route.continue()
    })

    // Sign in via the dev-only credentials provider as a guest with no player.
    // (Mirrors the "Login as Guest (No Player)" affordance in the dev menu.)
    await page.goto('/api/auth/csrf')
    const csrf = await page.evaluate(() => (document.body.innerText.match(/"csrfToken":"([^"]+)"/) ?? [])[1])
    await page.request.post('/api/auth/callback/dev-login?json=true', {
      form: {
        playerId: 'guest-dev',
        playerName: 'Guest Dev',
        teamId: '',
        csrfToken: csrf ?? '',
        callbackUrl: '/assign-player',
        json: 'true',
      },
    })

    await page.goto('/assign-player')
    // Pick any roster name to enable the Confirm button.
    await page.getByRole('button', { name: /^[A-Z]/ }).first().click()

    const confirm = page.getByTestId('assign-confirm-button')
    const apiResponse = page.waitForResponse((r) => r.url().includes('/api/assign-player') && r.request().method() === 'POST')
    await confirm.click()
    const res = await apiResponse
    expect(res.status()).toBe(200)

    // The regression assertion: within 200ms of the API responding 200, the
    // button MUST NOT still say "Saving…". Pre-PR-7 it sat on "Saving…" for
    // the entire post-click chain (5–7s end-to-end). PR 7 dropped it to ~1s
    // by splitting submitting → redirecting at the API boundary. PR 11 drops
    // it again by removing the awaited `update()` round-trip — so the label
    // flip is now strictly the React re-render after API response and easily
    // fits the 200ms Definition of Done in local dev.
    await expect(confirm).not.toHaveText(/Saving/, { timeout: 200 })
    await expect(confirm).toHaveText(/Done — redirecting|Linked/, { timeout: 200 })
  })
})
