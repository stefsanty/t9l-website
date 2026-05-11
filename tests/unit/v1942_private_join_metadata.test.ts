/**
 * v1.94.2 — hotfix for the v1.94.0 / v1.94.1 private-join metadata
 * leak.
 *
 * The page handler at `src/app/id/[slug]/join/page.tsx` correctly
 * 404s when `League.privateJoinLinkEnabled === false` (rendered body
 * is the Next.js 404 boundary, no Dashboard data leaks). However,
 * `generateMetadata` ran BEFORE that gate, so for any *existing*
 * slug whose owner had not enabled the link the response `<title>`
 * disclosed `Join <League Name> | <League Name>`. That turned the
 * route into a slug-based league-existence enumerator: a guesser
 * could distinguish "league exists, link disabled" from "league
 * does not exist" by inspecting the document title.
 *
 * The fix gates the league-name disclosure on the same predicate
 * the page handler uses. When `privateJoinLinkEnabled !== true`
 * (or the league row is missing) the metadata function returns the
 * generic `Join | T9L` title — byte-for-byte identical to the
 * unknown-slug branch — so guessers can no longer distinguish the
 * two states.
 *
 * Tests are split into:
 *   1. Structural pins — the new `privateJoinLinkEnabled: true`
 *      select + the gate clause both live in `generateMetadata`.
 *   2. Runtime assertions — call `generateMetadata` with mocked
 *      Prisma + slug resolver and pin the returned title for both
 *      states.
 *   3. Regression target — a non-disclosure assertion that fails
 *      back on the v1.94.1 broken state (where the league name
 *      leaked through the title).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..', '..')
const PAGE_SRC = fs.readFileSync(
  path.join(ROOT, 'src/app/id/[slug]/join/page.tsx'),
  'utf8',
)

// ────────────────────────────────────────────────────────────────────────────
// 1) Structural pins — the gate is wired into generateMetadata
// ────────────────────────────────────────────────────────────────────────────

describe('[v1.94.2] generateMetadata gates league-name disclosure', () => {
  it('selects privateJoinLinkEnabled in the metadata function', () => {
    // Match the broader generateMetadata block (anchored on the
    // function's findUnique call) and require privateJoinLinkEnabled
    // to be selected alongside name + abbreviation. The page-handler
    // BELOW this also selects the column, so a bare `privateJoinLinkEnabled: true`
    // grep would match either site — we anchor on the metadata block
    // explicitly.
    const metaBlock = PAGE_SRC.split(/export default async function/)[0]
    expect(metaBlock).toMatch(
      /select:\s*\{\s*name:\s*true,\s*abbreviation:\s*true,\s*privateJoinLinkEnabled:\s*true\s*\}/,
    )
  })

  it('returns the generic title when the league row is missing OR the link is disabled', () => {
    const metaBlock = PAGE_SRC.split(/export default async function/)[0]
    expect(metaBlock).toMatch(
      /if\s*\(!league\s*\|\|\s*!league\.privateJoinLinkEnabled\)\s*\{[\s\S]*?return\s*\{\s*title:\s*['"]Join \| T9L['"]\s*\}/,
    )
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 2) Runtime — call generateMetadata against fixtures and pin the title
// ────────────────────────────────────────────────────────────────────────────

const { getLeagueIdBySlugMock, leagueFindUniqueMock } = vi.hoisted(() => ({
  getLeagueIdBySlugMock: vi.fn<(slug: string) => Promise<string | null>>(),
  leagueFindUniqueMock: vi.fn(),
}))

vi.mock('@/lib/leagueSlugServer', () => ({
  getLeagueIdBySlug: getLeagueIdBySlugMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUniqueMock },
  },
}))

const { generateMetadata } = await import('@/app/id/[slug]/join/page')

beforeEach(() => {
  vi.clearAllMocks()
})

function mkParams(slug: string) {
  return { params: Promise.resolve({ slug }) }
}

describe('[v1.94.2] generateMetadata runtime — disabled league does NOT disclose name', () => {
  it('league exists with privateJoinLinkEnabled=false → generic "Join | T9L"', async () => {
    getLeagueIdBySlugMock.mockResolvedValue('l-test')
    leagueFindUniqueMock.mockResolvedValue({
      name: 'Test League 2025',
      abbreviation: 'TL25',
      privateJoinLinkEnabled: false,
    })

    const meta = await generateMetadata(mkParams('test'))

    expect(meta.title).toBe('Join | T9L')
    // Regression target: the v1.94.1 build returned
    // `Join TL25 | Test League 2025` here. The non-disclosure
    // assertions below fail on that broken state.
    expect(String(meta.title ?? '')).not.toContain('Test League 2025')
    expect(String(meta.title ?? '')).not.toContain('TL25')
  })

  it('byte-equal to the unknown-slug branch (so guessers can\'t distinguish "exists+disabled" from "missing")', async () => {
    // Run 1 — known slug, disabled.
    getLeagueIdBySlugMock.mockResolvedValueOnce('l-test')
    leagueFindUniqueMock.mockResolvedValueOnce({
      name: 'Test League 2025',
      abbreviation: 'TL25',
      privateJoinLinkEnabled: false,
    })
    const disabled = await generateMetadata(mkParams('test'))

    // Run 2 — unknown slug. Note: getLeagueIdBySlug returns null, so
    // the function short-circuits and never touches Prisma.
    getLeagueIdBySlugMock.mockResolvedValueOnce(null)
    const unknown = await generateMetadata(mkParams('not-a-slug'))

    expect(disabled.title).toBe(unknown.title)
  })

  it('league row missing entirely (race / deleted between resolver + lookup) → generic title', async () => {
    getLeagueIdBySlugMock.mockResolvedValue('l-test')
    leagueFindUniqueMock.mockResolvedValue(null)

    const meta = await generateMetadata(mkParams('test'))

    expect(meta.title).toBe('Join | T9L')
  })
})

describe('[v1.94.2] generateMetadata runtime — enabled league DOES disclose name (admin opt-in)', () => {
  it('league exists with privateJoinLinkEnabled=true → "Join <abbr> | <name>"', async () => {
    getLeagueIdBySlugMock.mockResolvedValue('l-test')
    leagueFindUniqueMock.mockResolvedValue({
      name: 'Test League 2025',
      abbreviation: 'TL25',
      privateJoinLinkEnabled: true,
    })

    const meta = await generateMetadata(mkParams('test'))

    expect(meta.title).toBe('Join TL25 | Test League 2025')
    // Sanity — abbreviation is preferred for the short form per the
    // pre-v1.94.2 contract; this assertion fails if the format
    // accidentally regresses to `Join Test League 2025 | …`.
    expect(String(meta.title ?? '')).toContain('TL25')
  })

  it('falls back to full name as the short form when abbreviation is null', async () => {
    getLeagueIdBySlugMock.mockResolvedValue('l-test')
    leagueFindUniqueMock.mockResolvedValue({
      name: 'No Abbrev League',
      abbreviation: null,
      privateJoinLinkEnabled: true,
    })

    const meta = await generateMetadata(mkParams('na'))

    expect(meta.title).toBe('Join No Abbrev League | No Abbrev League')
  })
})
