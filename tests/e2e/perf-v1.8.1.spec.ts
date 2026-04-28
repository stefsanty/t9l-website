import { test, expect } from '@playwright/test'

/**
 * v1.8.1 perf regression diagnostic — user reports 10s click-to-toast on prod.
 *
 * Runs against a dev-branch Vercel preview where NEXTAUTH_DEV_MODE=true so
 * we can authenticate via line-mock without a real LINE OAuth round-trip.
 *
 * Run:
 *   BASE_URL=https://<dev-preview>.vercel.app TEST_LINE_ID=perf-test-v181-$RANDOM \
 *     npx playwright test perf-v1.8.1
 */

const baseURL = process.env.BASE_URL ?? ''
const TEST_LINE_ID = process.env.TEST_LINE_ID ?? `perf-test-${Date.now()}`

test.describe.configure({ mode: 'serial' })

test.describe('v1.8.1 click-to-toast measurement', () => {
  test.skip(!baseURL.startsWith('https://t9l-website-'), 'requires dev preview BASE_URL')

  async function loginLineMock(page: import('@playwright/test').Page) {
    await page.goto('/api/auth/csrf')
    const csrf = await page.evaluate(() =>
      (document.body.innerText.match(/"csrfToken":"([^"]+)"/) ?? [])[1],
    )
    const res = await page.request.post('/api/auth/callback/line-mock?json=true', {
      form: {
        lineId: TEST_LINE_ID,
        csrfToken: csrf ?? '',
        callbackUrl: '/',
        json: 'true',
      },
    })
    expect(res.ok(), `line-mock login failed: ${res.status()}`).toBeTruthy()
  }

  test('warm POST /api/assign-player timing 5x — isolates API alone', async ({ page }) => {
    await loginLineMock(page)
    await page.goto('/assign-player')
    const firstRow = page.locator('[data-testid^="assign-player-row-"]').first()
    await expect(firstRow).toBeVisible({ timeout: 15_000 })

    // Warm-up
    const warmupId =
      (await firstRow.getAttribute('data-testid'))!.replace('assign-player-row-', '')
    await page.request.post('/api/assign-player', {
      data: { playerId: warmupId },
      headers: { 'Content-Type': 'application/json' },
    })
    await page.request.delete('/api/assign-player')

    const samples: number[] = []
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now()
      const res = await page.request.post('/api/assign-player', {
        data: { playerId: warmupId },
        headers: { 'Content-Type': 'application/json' },
      })
      const dt = Date.now() - t0
      samples.push(dt)
      console.log(`[POST] run=${i} status=${res.status()} elapsed=${dt}ms`)
      await page.request.delete('/api/assign-player')
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length / 2)]
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
    console.log(`[POST] samples=${samples.join(',')} p50=${p50}ms p95=${p95}ms`)
  })

  test('GET / timing — before vs after a link operation (cache-bust hypothesis)', async ({
    page,
  }) => {
    await loginLineMock(page)
    await page.goto('/assign-player')
    const firstRow = page.locator('[data-testid^="assign-player-row-"]').first()
    await expect(firstRow).toBeVisible({ timeout: 15_000 })
    const warmupId =
      (await firstRow.getAttribute('data-testid'))!.replace('assign-player-row-', '')

    // Warm GET / a few times so its cache is hot.
    for (let i = 0; i < 3; i++) {
      await page.request.get('/')
    }

    // Time GET / right BEFORE a link (should be hot — cached).
    const beforeSamples: number[] = []
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now()
      const res = await page.request.get('/')
      beforeSamples.push(Date.now() - t0)
      expect(res.status()).toBe(200)
    }
    console.log(`[GET / before link] samples=${beforeSamples.join(',')}ms`)

    // Do a link operation — this fires revalidatePath('/') + revalidateTag('public-data', { expire: 0 }).
    const linkRes = await page.request.post('/api/assign-player', {
      data: { playerId: warmupId },
      headers: { 'Content-Type': 'application/json' },
    })
    expect(linkRes.status()).toBe(200)

    // Time GET / right AFTER the link (cache busted — first hit re-derives).
    const afterSamples: number[] = []
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now()
      const res = await page.request.get('/')
      afterSamples.push(Date.now() - t0)
      expect(res.status()).toBe(200)
    }
    console.log(`[GET / after link] samples=${afterSamples.join(',')}ms`)

    await page.request.delete('/api/assign-player')
  })

  test('full click-to-toast E2E — 5 runs for p50/p95', async ({ page }) => {
    const samples: number[] = []
    for (let i = 0; i < 5; i++) {
      // Fresh user each iteration so the link is always a new operation.
      const lineId = `${TEST_LINE_ID}-r${i}`
      const ctx = await page.context()
      await ctx.clearCookies()
      await page.goto('/api/auth/csrf')
      const csrf = await page.evaluate(() =>
        (document.body.innerText.match(/"csrfToken":"([^"]+)"/) ?? [])[1],
      )
      await page.request.post('/api/auth/callback/line-mock?json=true', {
        form: {
          lineId,
          csrfToken: csrf ?? '',
          callbackUrl: '/',
          json: 'true',
        },
      })

      await page.goto('/assign-player')
      const firstRow = page.locator('[data-testid^="assign-player-row-"]').first()
      await expect(firstRow).toBeVisible({ timeout: 15_000 })
      const playerName = (await firstRow.locator('p').first().textContent())?.trim() ?? ''
      await firstRow.click()

      const t0 = Date.now()
      await page.getByTestId('assign-confirm-button').click()

      // Wait for the Sonner toast.
      const toast = page.locator('[data-sonner-toast]').first()
      await expect(toast).toBeVisible({ timeout: 20_000 })
      const dt = Date.now() - t0
      samples.push(dt)
      console.log(`[click→toast] run=${i} player="${playerName}" elapsed=${dt}ms`)

      // Cleanup so the next iteration's player is unlinked.
      await page.request.delete('/api/assign-player')
    }
    const sorted = [...samples].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length / 2)]
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
    console.log(`[click→toast] samples=${samples.join(',')} p50=${p50}ms p95=${p95}ms`)
  })
})
