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
 * Regression tests for the v1.6.0 auto-navigate + toast UX.
 *
 * v1.4.0 (PR 13) replaced the auto-navigate-on-success with `useOptimistic`
 * + an inline "✓ Linked to {Player}" success view + an explicit Go-home
 * button. v1.6.0 reverses that: the inline view is gone, the API write
 * triggers `router.push('/')` immediately, and a Sonner toast confirms the
 * outcome. The toast lives at the root layout level so it persists across
 * the route transition.
 *
 * Two specs:
 *   1. Confirm → URL changes to `/` within ~1s, success toast visible with
 *      the player name, toast auto-dismisses within ~5s.
 *   2. Stalled API → user stays on /assign-player while the request is in
 *      flight (no premature push, no double-fire), and lands on / once the
 *      API resolves.
 *
 * Requires dev server (NODE_ENV=development → dev-login provider). Skipped
 * against any non-localhost BASE_URL because dev-login is absent in prod.
 *
 * Run locally:
 *   npm run dev
 *   BASE_URL=http://localhost:3000 npm run test:e2e -- assign-player
 *
 * Unit tests pin the underlying contracts:
 *   - tests/unit/optimisticLink.test.ts — the rollback gate (200/4xx/network)
 *   - tests/unit/assignToast.test.ts    — toast dispatch shape
 *   - tests/unit/assignButtonLabel.test.ts — confirm/unassign button states
 */
test.describe('regression: auto-navigate + toast on link success (v1.6.0)', () => {
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
        playerId: `guest-dev-${Date.now()}`,
        playerName: 'Guest Dev',
        teamId: '',
        csrfToken: csrf ?? '',
        callbackUrl: '/assign-player',
        json: 'true',
      },
    })
  }

  test('Confirm → navigates to / and shows a success toast that auto-dismisses', async ({
    page,
  }) => {
    await loginAsGuest(page)
    await page.goto('/assign-player')

    // Pick the first selectable player and capture their name so we can
    // assert the toast contains it.
    const firstRow = page.locator('[data-testid^="assign-player-row-"]').first()
    await expect(firstRow).toBeVisible({ timeout: 5_000 })
    const playerName = (await firstRow.locator('p').first().textContent())?.trim() ?? ''
    expect(playerName, 'expected at least one selectable player row').toBeTruthy()
    await firstRow.click()

    const clickAt = Date.now()
    await page.getByTestId('assign-confirm-button').click()

    // URL changes to / within ~1s — i.e. the auto-navigate fires the moment
    // the API resolves, no Go-home click required.
    await page.waitForURL((url) => url.pathname === '/', { timeout: 5_000 })
    const navAt = Date.now()
    expect(
      navAt - clickAt,
      `click→navigation took ${navAt - clickAt}ms — should be ≤ ~3s under warm cache`,
    ).toBeLessThan(5_000)

    // Toast confirms the outcome on the destination. Sonner renders toasts
    // with role="status".
    const toast = page.getByRole('status').filter({ hasText: new RegExp(`Linked to ${playerName}`, 'i') })
    await expect(toast).toBeVisible({ timeout: 2_000 })

    // Sonner's default exit animation kicks in after the duration (4500ms).
    // Allow generous slack for the unmount transition; we just want to
    // confirm the toast is not sticky.
    await expect(toast).toBeHidden({ timeout: 8_000 })
  })

  test('Confirm with a stalled API stays on /assign-player until the write resolves', async ({
    page,
  }) => {
    // Stall the POST by 2s so we can observe pre-resolution state.
    await page.route('**/api/assign-player', async (route) => {
      if (route.request().method() === 'POST') {
        await new Promise((r) => setTimeout(r, 2_000))
      }
      await route.continue()
    })

    await loginAsGuest(page)
    await page.goto('/assign-player')

    const firstRow = page.locator('[data-testid^="assign-player-row-"]').first()
    await expect(firstRow).toBeVisible({ timeout: 5_000 })
    await firstRow.click()

    const confirm = page.getByTestId('assign-confirm-button')
    const clickAt = Date.now()
    await confirm.click()

    // Within ~500ms the URL must still be /assign-player — auto-nav must
    // wait for the API write rather than fire optimistically.
    await page.waitForTimeout(500)
    expect(page.url()).toContain('/assign-player')

    // The button shows "Saving…" (the in-flight label from assignButtonLabel).
    await expect(confirm).toHaveText(/Saving/i)

    // Once the API resolves we land on /.
    await page.waitForURL((url) => url.pathname === '/', { timeout: 6_000 })
    const navAt = Date.now()
    expect(
      navAt - clickAt,
      `nav took ${navAt - clickAt}ms — must be ≥ ~1.5s (the 2s API stall)`,
    ).toBeGreaterThan(1_500)

    // Toast still fires after navigation.
    await expect(
      page.getByRole('status').filter({ hasText: /Linked to/i }),
    ).toBeVisible({ timeout: 2_000 })
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
