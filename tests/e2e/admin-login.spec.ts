import { test, expect } from '@playwright/test'

test.describe('admin login surface', () => {
  test('renders sign-in form (unauthenticated)', async ({ page }) => {
    const response = await page.goto('/admin/login')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: /T9L Admin/i })).toBeVisible()
    await expect(page.getByLabel(/username/i)).toBeVisible()
    await expect(page.getByLabel(/password/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('protected admin route redirects unauthenticated users to login', async ({ page }) => {
    const response = await page.goto('/admin')
    // next-auth middleware sends a 30x → /admin/login. Final landing page should be /admin/login.
    expect(response?.url()).toMatch(/\/admin\/login/)
  })
})
