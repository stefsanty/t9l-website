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

/**
 * Filter-already-linked-players regression (PR 14 / v1.4.2 → PR 15 / v1.4.3).
 *
 * Before PR 14, `/assign-player` listed every roster row regardless of
 * whether another LINE user already held that `Player.lineId`. The user
 * could pick a claimed player, click Confirm, and the optimistic UI would
 * flash success before the API returned 409 — a small but real false-success
 * footgun. PR 14 (v1.4.2) reads `Player.lineId IS NOT NULL` from Prisma at
 * SSR time and rendered those rows greyed-out with an "Already linked" tag.
 *
 * PR 15 (v1.4.3) flipped the UX: linked players are HIDDEN entirely, not
 * greyed-out. The picker shows only what the viewer can actually pick. This
 * test was tightened to assert the linked row is absent from the DOM (count
 * = 0) rather than rendered-but-disabled.
 *
 * The test runs in two contexts: A links a real player via the API; B opens
 * `/assign-player` in a fresh browser context and asserts the row A linked
 * is not present. Cleanup unlinks A regardless of pass/fail so the dev DB
 * returns to its prior state.
 */
test.describe('regression: already-linked players are hidden (PR 15 / v1.4.3)', () => {
  test.skip(!isLocal, 'requires local dev with dev-login provider (NODE_ENV=development)')

  async function devLogin(
    page: import('@playwright/test').Page,
    playerIdSeed: string,
  ) {
    // The dev-login provider sets `token.lineId = "dev-" + credentials.playerId`,
    // so passing distinct seeds for A and B guarantees distinct `Player.lineId`
    // writes — required for the "viewer is excluded from the linked set" path.
    await page.goto('/api/auth/csrf')
    const csrf = await page.evaluate(() =>
      (document.body.innerText.match(/"csrfToken":"([^"]+)"/) ?? [])[1],
    )
    await page.request.post('/api/auth/callback/dev-login?json=true', {
      form: {
        playerId: playerIdSeed,
        playerName: `Dev ${playerIdSeed}`,
        teamId: '',
        csrfToken: csrf ?? '',
        callbackUrl: '/assign-player',
        json: 'true',
      },
    })
  }

  test('a player linked by another LINE user is absent from the picker DOM', async ({ browser }) => {
    const ctxA = await browser.newContext()
    const pageA = await ctxA.newPage()
    let linkedSlug: string | null = null

    try {
      await devLogin(pageA, `pr15-a-${Date.now()}`)
      await pageA.goto('/assign-player')

      // Pick the first roster row currently rendered for user A. Linked
      // players are filtered out of the picker entirely (PR 15), so any row
      // present on A's view is either A's own previously-linked player (rare
      // for a fresh dev seed) or a genuinely unlinked one. The test only
      // needs ONE such row to drive the scenario.
      const allRows = pageA.locator('[data-testid^="assign-player-row-"]')
      await expect(allRows.first()).toBeVisible({ timeout: 5_000 })
      const testid = await allRows.first().getAttribute('data-testid')
      expect(testid, 'expected at least one selectable row in the dev DB').toBeTruthy()
      linkedSlug = testid!.replace('assign-player-row-', '')

      // Link A → linkedSlug via the API directly (skip the React UX, this
      // test is about what B sees, not about the link flow itself).
      const linkRes = await pageA.request.post('/api/assign-player', {
        data: { playerId: linkedSlug },
        headers: { 'Content-Type': 'application/json' },
      })
      expect(linkRes.status(), 'A→link write must succeed for this scenario').toBe(200)

      // Now open a separate context (fresh cookie jar) as user B with a
      // distinct dev playerId seed → distinct lineId. B has not linked
      // anyone, so `linkedSlug` is NOT the viewer's own row.
      const ctxB = await browser.newContext()
      const pageB = await ctxB.newPage()
      try {
        await devLogin(pageB, `pr15-b-${Date.now()}`)
        await pageB.goto('/assign-player')

        // First sanity-check: the page rendered the picker (some other rows
        // exist), so a missing target row means filtered-out, not a load
        // failure or empty-DB false-positive.
        await expect(
          pageB.locator('[data-testid^="assign-player-row-"]').first(),
        ).toBeVisible({ timeout: 5_000 })

        // The linked player must NOT appear on B's view. count() === 0 is
        // the contract: filtered out at the page layer, never reaches the
        // client.
        const targetRow = pageB.getByTestId(`assign-player-row-${linkedSlug}`)
        await expect(targetRow).toHaveCount(0)
      } finally {
        await ctxB.close()
      }
    } finally {
      if (linkedSlug) {
        // Unlink A regardless of pass/fail — leaves the dev DB pristine for
        // subsequent runs. A 200 or 401 (session expired) are both fine; we
        // just don't want to leave a Player.lineId pointing at a dev seed.
        await pageA.request.delete('/api/assign-player').catch(() => {})
      }
      await ctxA.close()
    }
  })
})
