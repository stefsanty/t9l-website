import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

/**
 * v1.55.0 (PR 2 of admin-UI-compat-audit chain) — pin the user-facing
 * admin-side label and URL-preview surfaces that reference the post-v1.54.0
 * canonical tenant URL form (`/id/<slug>`).
 *
 * The audit covers four surfaces visible to the admin user:
 *
 *   1. SettingsTab — League settings page. Pre-v1.55.0 it labeled the
 *      slug field "Subdomain" and showed `<slug>.t9l.me` as the preview.
 *      v1.55.0 flips the label to "URL slug" and the preview to
 *      `/id/<slug>` (matches v1.54.0).
 *
 *   2. admin/page.tsx — Admin dashboard tile. Pre-v1.55.0 it showed
 *      `<slug>.t9l.me ↗` per league. v1.55.0 flips to `/id/<slug> ↗`.
 *      Also fixes a pre-existing bug where the slug was derived from
 *      `toSlug(league.name)` instead of the configured `League.subdomain`
 *      column.
 *
 *   3. admin/leagues/[id]/layout.tsx — Per-league admin shell title row.
 *      Pre-v1.55.0 it showed `<slug>.t9l.me` as a clickable link to the
 *      public site. v1.55.0 flips to `/id/<slug>` and reads from
 *      `League.subdomain` instead of `toSlug(name)` heuristic.
 *
 *   4. join/[code]/welcome — Post-redemption home URL. Pre-v1.55.0 it
 *      built `https://<slug>.t9l.me/` as the redirect target. v1.55.0
 *      flips to `/id/<slug>` (apex relative).
 *
 * Internal references that don't surface to the user (DB column name
 * `League.subdomain`, type alias `SubdomainStatus`, API route name
 * `/api/subdomains/check`) are deliberately left in place — column
 * rename is deferred per the v1.50.0 path-routing scaffold note, and
 * renaming the API route would force a coordinated client-side update.
 */

const ROOT = process.cwd()

function read(p: string): string {
  return readFileSync(path.join(ROOT, p), 'utf-8')
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('v1.55.0 — SettingsTab user-facing label + URL preview', () => {
  const path = 'src/components/admin/SettingsTab.tsx'

  it('label flipped from "Subdomain" to "URL slug"', () => {
    const src = stripComments(read(path))
    expect(src).toMatch(/>URL slug</)
    // Regression target: the legacy label must not still be in user-facing copy.
    expect(src).not.toMatch(/>Subdomain</)
  })

  it('helper copy uses the v1.54.0 `/id/<slug>` URL form, NOT the legacy `<slug>.t9l.me`', () => {
    const src = stripComments(read(path))
    // Match `/id/{subdomain || 'my-league'}` in JSX expression form.
    expect(src).toMatch(/\/id\/\{\s*subdomain\s*\|\|\s*'my-league'\s*\}/)
    expect(src).not.toMatch(/\$\{[^}]*\}\.t9l\.me/)
  })

  it('error copy uses "slug", not "subdomain"', () => {
    const src = stripComments(read(path))
    expect(src).toMatch(/This slug is already taken/)
    expect(src).not.toMatch(/This subdomain is already taken/)
  })

  it('exposes data-testid hooks for input + helper text', () => {
    const src = read(path)
    expect(src).toMatch(/data-testid="settings-tab-slug-input"/)
    expect(src).toMatch(/data-testid="settings-tab-slug-helper"/)
  })

  // v1.71.0 — the "Public site source-of-truth" data-source/write-mode
  // section was removed when the Sheets surface was retired. Asserting on
  // its helper copy used to be a regression target; now the regression
  // target is its absence (covered in tests/unit/sheetsRemoved.test.ts).
})

describe('v1.55.0 — admin/page.tsx dashboard tile URL preview', () => {
  const path = 'src/app/admin/page.tsx'

  it('shows /id/<slug> ↗ as the per-league URL preview (v1.54.0 form)', () => {
    const src = read(path)
    expect(src).toMatch(/\/id\/\{slug\} ↗/)
  })

  it('does NOT show the legacy `<slug>.t9l.me ↗` form', () => {
    const src = stripComments(read(path))
    expect(src).not.toMatch(/\{[^}]*\}\.t9l\.me ↗/)
  })

  it('reads slug from League.subdomain (with toSlug fallback) — fixes pre-v1.55.0 toSlug-only bug', () => {
    const src = stripComments(read(path))
    expect(src).toMatch(/league\.subdomain\s*\?\?\s*toSlug\(league\.name\)/)
  })

  it('exposes data-testid hook for the slug preview', () => {
    const src = read(path)
    expect(src).toMatch(/data-testid="admin-dashboard-league-slug"/)
  })
})

describe('v1.55.0 — admin/leagues/[id]/layout.tsx per-league shell', () => {
  const path = 'src/app/admin/leagues/[id]/layout.tsx'

  it('public-site link href uses /id/<slug>, NOT https://<slug>.t9l.me', () => {
    const src = read(path)
    expect(src).toMatch(/href=\{\s*`\/id\/\$\{slug\}`/)
    expect(stripComments(src)).not.toMatch(/href=\{\s*`https:\/\/\$\{[^}]+\}\.t9l\.me/)
  })

  it('visible link text shows /id/<slug>, NOT <slug>.t9l.me', () => {
    const src = stripComments(read(path))
    expect(src).toMatch(/\/id\/\{slug\}/)
    expect(src).not.toMatch(/\{slug\}\.t9l\.me/)
    expect(src).not.toMatch(/\{subdomain\}\.t9l\.me/)
  })

  it('reads slug from League.subdomain (with toSlug fallback) — fixes pre-v1.55.0 toSlug-only bug', () => {
    const src = stripComments(read(path))
    expect(src).toMatch(/league\.subdomain\s*\?\?\s*toSlug\(league\.name\)/)
  })

  it('exposes data-testid hook for the public-site link', () => {
    const src = read(path)
    expect(src).toMatch(/data-testid="admin-league-shell-public-link"/)
  })
})

describe('v1.55.0 — join/[code]/welcome post-redemption home URL', () => {
  const path = 'src/app/join/[code]/welcome/page.tsx'

  it('builds /id/<slug> when the league has a configured slug, NOT https://<slug>.t9l.me/', () => {
    const src = stripComments(read(path))
    expect(src).toMatch(/`\/id\/\$\{league\.subdomain\}`/)
    expect(src).not.toMatch(/`https:\/\/\$\{league\.subdomain\}\.t9l\.me/)
  })

  it('falls back to apex `/` when the league has no configured slug', () => {
    const src = stripComments(read(path))
    expect(src).toMatch(/league\.subdomain\s*\?\s*`\/id\/\$\{league\.subdomain\}`\s*:\s*'\/'/)
  })
})
