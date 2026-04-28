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
 * Regression tests for the assign-player perceived-latency target.
 *
 * Pre-v1.4.0 the click-to-feedback latency was bounded by the API write +
 * next-auth update + router.push + destination RSC render — 5–7s end-to-end
 * pre-PRs-10/11/12, ~2–3s post. v1.4.0 (PR 13) replaces the auto-navigate
 * with `useOptimistic` + an inline success view, collapsing the perceived
 * latency to a single React render after the click. The Definition of Done
 * tightens to <50ms — strictly the time from click to optimistic flip.
 *
 * The pre-v1.4.0 "button leaves Saving…" assertion is gone because the
 * confirm button is gone after the optimistic flip — the form is replaced
 * by the success view entirely. The new assertion targets that view.
 *
 * Requires dev server (NODE_ENV=development → dev-login provider exposed
 * per `lib/auth.ts`). Skipped against any non-localhost BASE_URL because
 * the dev-login provider is intentionally absent from Vercel preview/prod.
 *
 * Run locally:
 *   npm run dev               # in another terminal
 *   BASE_URL=http://localhost:3000 npm run test:e2e -- assign-player
 *
 * The unit tests at:
 *   - tests/unit/optimisticLink.test.ts        — the rollback gate
 *   - tests/unit/assignButtonLabel.test.ts     — the button state machine
 * pin the underlying contracts.
 */
test.describe('regression: optimistic linking is perceived-instant (PR 13 / v1.4.0)', () => {
  test.skip(!isLocal, 'requires local dev with dev-login provider (NODE_ENV=development)')

  // Helper: log in as a fresh guest with no linked player so the form
  // renders with a Confirm button on /assign-player.
  async function loginAsGuest(page: import('@playwright/test').Page) {
    await page.goto('/api/auth/csrf')
    const csrf = await page.evaluate(() =>
      (document.body.innerText.match(/"csrfToken":"([^"]+)"/) ?? [])[1],
    )
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
  }

  test('success view appears within 50ms of click (DoD)', async ({ page }) => {
    // Stall the API so the assertion can't be satisfied by the API itself
    // returning fast — the only way to pass under this stall is the optimistic
    // pre-API-resolution UI flip.
    await page.route('**/api/assign-player', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((r) => setTimeout(r, 4_000))
      }
      await route.continue()
    })

    await loginAsGuest(page)
    await page.goto('/assign-player')
    await page.getByRole('button', { name: /^[A-Z]/ }).first().click()

    const confirm = page.getByTestId('assign-confirm-button')
    const successView = page.getByTestId('assign-success-view')

    const clickAt = Date.now()
    await confirm.click()
    await expect(successView).toBeVisible({ timeout: 200 })
    const flipAt = Date.now()
    const elapsed = flipAt - clickAt
    // 50ms is the perceived-instant target. Allow some slack for Playwright's
    // own polling cadence and CI variance — fail loudly if the flip is more
    // than ~3x the target, which would indicate the optimistic path broke.
    expect(elapsed, `click→success-view took ${elapsed}ms (target <50ms)`).toBeLessThan(150)

    // The inline Go-home affordance must also be present immediately —
    // the user has to be able to navigate on their own schedule.
    await expect(page.getByTestId('assign-go-home-button')).toBeVisible()
  })

  test('Go-home awaits the in-flight API + session-update before navigating', async ({ page }) => {
    // Stall the assign-player POST by 2s so the user can race it: click
    // Confirm, then click Go-home before the API resolves. The destination
    // (/) MUST NOT render until the JWT reflects the new linkage — otherwise
    // the user lands on stale data.
    await page.route('**/api/assign-player', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((r) => setTimeout(r, 2_000))
      }
      await route.continue()
    })

    await loginAsGuest(page)
    await page.goto('/assign-player')
    await page.getByRole('button', { name: /^[A-Z]/ }).first().click()

    const confirm = page.getByTestId('assign-confirm-button')
    const goHome = page.getByTestId('assign-go-home-button')

    await confirm.click()
    // Optimistic flip: the success view + Go-home button are immediately
    // available, even though the API hasn't responded yet.
    await expect(goHome).toBeVisible({ timeout: 200 })

    // Click Go-home immediately. We expect:
    //  - the button enters "Finalizing…" state (still on /assign-player)
    //  - it does NOT navigate while the API is still pending
    //  - it navigates to / once the API resolves
    const clickAt = Date.now()
    await goHome.click()

    // Within a few hundred ms (well before the 2s API resolution) the button
    // should show Finalizing… AND the URL should still be /assign-player.
    await expect(goHome).toHaveText(/Finalizing/, { timeout: 300 })
    expect(page.url()).toContain('/assign-player')

    // After the API resolves the navigation completes.
    await page.waitForURL('**/', { timeout: 5_000 })
    const navAt = Date.now()
    const elapsed = navAt - clickAt
    // The await-the-pipeline path means Go-home navigates only once the API
    // has settled — i.e. roughly the API stall time. Accept anything above
    // ~1.5s (the stall is 2s, allow for fetch-mock jitter).
    expect(
      elapsed,
      `Go-home → navigation took ${elapsed}ms — should be ≥ stall of 2s, indicating it awaited the pipeline`,
    ).toBeGreaterThan(1_500)
  })
})
