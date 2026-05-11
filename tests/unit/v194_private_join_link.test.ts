import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * v1.94.0 — admin-toggleable "private join link" regression targets.
 *
 * The runtime behaviour (route 404s when the toggle is off; mounts the
 * recruiting banner when on, regardless of `League.visibility`) lives
 * across three files: prisma schema, admin LeagueDetailsEditor +
 * SettingsTab, and the new `/id/<slug>/join` route. The tests below
 * pin each load-bearing line via source-grep — mirrors the convention
 * used elsewhere in the suite for server-action shape pinning.
 */

const ROOT = path.resolve(__dirname, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('[v1.94.0] schema + migration', () => {
  it('prisma/schema.prisma declares `privateJoinLinkEnabled Boolean @default(false)`', () => {
    const src = read('prisma/schema.prisma')
    expect(src).toMatch(/privateJoinLinkEnabled\s+Boolean\s+@default\(false\)/)
  })

  it('migration directory exists with the additive DDL', () => {
    const dir = path.join(
      ROOT,
      'prisma',
      'migrations',
      '20260601000001_league_private_join_link_enabled',
    )
    expect(fs.existsSync(dir)).toBe(true)
    const sql = fs.readFileSync(path.join(dir, 'migration.sql'), 'utf8')
    expect(sql).toMatch(
      /ALTER TABLE "League" ADD COLUMN\s+"privateJoinLinkEnabled" BOOLEAN NOT NULL DEFAULT false/,
    )
  })
})

describe('[v1.94.0] updateLeagueDetails accepts privateJoinLinkEnabled', () => {
  const src = read('src/app/admin/leagues/actions.ts')

  it('declares privateJoinLinkEnabled?: boolean on the input', () => {
    expect(src).toMatch(/privateJoinLinkEnabled\?:\s*boolean/)
  })

  it('validates the type and persists the field', () => {
    expect(src).toContain('privateJoinLinkEnabled must be a boolean')
    expect(src).toContain('data.privateJoinLinkEnabled = input.privateJoinLinkEnabled')
  })
})

describe('[v1.94.0] SettingsTab + LeagueDetailsEditor wire the toggle', () => {
  it('SettingsTab declares privateJoinLinkEnabled on the league prop and threads it down', () => {
    const src = read('src/components/admin/SettingsTab.tsx')
    expect(src).toMatch(/privateJoinLinkEnabled:\s*boolean/)
    expect(src).toContain('initialPrivateJoinLinkEnabled={league.privateJoinLinkEnabled}')
    expect(src).toContain('leagueSubdomain={league.subdomain ?? null}')
  })

  it('LeagueDetailsEditor renders the toggle row + URL display + copy button', () => {
    const src = read('src/components/admin/LeagueDetailsEditor.tsx')
    expect(src).toContain('data-testid="league-details-private-join-link-section"')
    expect(src).toContain('data-testid="league-details-private-join-link-button"')
    expect(src).toContain('data-testid="league-details-private-join-link-url"')
    expect(src).toContain('data-testid="league-details-private-join-link-copy"')
    expect(src).toContain('Enable Private Join Link')
  })

  it('LeagueDetailsEditor persists privateJoinLinkEnabled via updateLeagueDetails', () => {
    const src = read('src/components/admin/LeagueDetailsEditor.tsx')
    // Save handler threads the live state into the action payload.
    expect(src).toMatch(/privateJoinLinkEnabled,/)
  })

  it('LeagueDetailsEditor exposes a no-subdomain fallback message', () => {
    // Sets a subdomain is a prereq for the URL to resolve, so we
    // surface a friendly error rather than rendering a broken URL.
    const src = read('src/components/admin/LeagueDetailsEditor.tsx')
    expect(src).toContain('data-testid="league-details-private-join-link-no-subdomain"')
    expect(src).toMatch(/Set a league subdomain first/)
  })
})

describe('[v1.94.0] /id/[slug]/join route', () => {
  const src = read('src/app/id/[slug]/join/page.tsx')

  it('exists as a server component (no `use client` marker)', () => {
    expect(src).not.toMatch(/^['"]use client['"]/m)
    expect(src).toMatch(/export default async function PrivateJoinPage/)
  })

  it('resolves league by slug then 404s on unknown slug', () => {
    expect(src).toContain('getLeagueIdBySlug(slug)')
    expect(src).toMatch(/if \(!leagueId\) notFound\(\)/)
  })

  it('selects privateJoinLinkEnabled + 404s when the toggle is off', () => {
    expect(src).toMatch(/privateJoinLinkEnabled:\s*true/)
    expect(src).toMatch(/if \(!league \|\| !league\.privateJoinLinkEnabled\) notFound\(\)/)
  })

  it('renders Dashboard with forceRecruitingBanner + showPrivateJoinIndicator', () => {
    expect(src).toContain('forceRecruitingBanner={true}')
    expect(src).toContain('showPrivateJoinIndicator={true}')
    expect(src).toContain('<Dashboard')
  })

  it('still threads the visibility-derived `recruiting` value (banner via force, but the legacy prop stays accurate)', () => {
    // Pre-v1.94.0 the standard /id/<slug> page used
    // `recruiting={flags.visibility === 'PUBLIC_OPEN'}`; the new join
    // route preserves that to keep the contract clean. The force flag
    // is the additive override.
    expect(src).toContain("recruiting={flags.visibility === 'PUBLIC_OPEN'}")
  })

  it('mirrors the touchUserDefaultLeague pattern from /id/[slug]/page.tsx', () => {
    expect(src).toContain('touchUserDefaultLeague')
  })
})

describe('[v1.94.0] Dashboard accepts forceRecruitingBanner + showPrivateJoinIndicator', () => {
  const src = read('src/components/Dashboard.tsx')

  it('declares forceRecruitingBanner?: boolean on the props interface', () => {
    expect(src).toMatch(/forceRecruitingBanner\?:\s*boolean/)
  })

  it('declares showPrivateJoinIndicator?: boolean on the props interface', () => {
    expect(src).toMatch(/showPrivateJoinIndicator\?:\s*boolean/)
  })

  it('mount predicate is `(recruiting || forceRecruitingBanner)` (broadened from the v1.63.0 `recruiting &&` gate)', () => {
    expect(src).toMatch(
      /\(recruiting\s*\|\|\s*forceRecruitingBanner\)\s*&&\s*league\s*&&\s*recruitingState/,
    )
  })

  it('renders the private-join indicator pill when the flag is on', () => {
    expect(src).toContain('data-testid="private-join-indicator"')
    expect(src).toContain('Private join link')
  })
})

describe('[v1.94.0] RecruitingBanner accepts the marker prop', () => {
  const src = read('src/components/RecruitingBanner.tsx')

  it('exposes forceRecruitingBanner?: boolean on the props', () => {
    expect(src).toMatch(/forceRecruitingBanner\?:\s*boolean/)
  })
})
