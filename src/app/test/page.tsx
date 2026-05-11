import type { Metadata } from 'next'
import HomepageRouter from '@/components/homepage/HomepageRouter'

/**
 * v1.85.0 — homepage redesign phase 1b/1c. Preview mount point for the
 * new persona-aware apex.
 *
 * The production apex (`/`) still renders the legacy default-league
 * Dashboard; this `/test` route lets the operator preview the new
 * surface holistically before promoting it. The promote step is a
 * one-line PR — replace `/page.tsx`'s body with `<HomepageRouter />`
 * and delete this file (or leave it as a permanent test hook). See
 * the PR description for v1.85.0 for the exact diff.
 *
 * v1.93.0 — forwards `searchParams.league` to `<HomepageRouter>` so the
 * `<LeagueSwitcherTabs>` can navigate via `<Link prefetch>` instead of
 * awaiting a server action. The router validates the id against the
 * viewer's memberships, so an absent / unknown / stale value falls
 * through to `User.defaultLeagueId` and then to the alphabetical-first
 * membership.
 *
 * Architectural rule baked in: ALL homepage logic lives in
 * `<HomepageRouter />` and its children under `src/components/homepage/`.
 * This page file deliberately stays minimal so the swap is mechanical.
 */
export const metadata: Metadata = {
  title: 'T9L | Preview',
}

type SearchParams = Promise<{ league?: string | string[] }>

export default async function TestHomepagePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const raw = params?.league
  // Only forward a single string; arrays (?league=a&league=b) and empty
  // strings collapse to null. The classifier is tolerant either way,
  // but normalising at the page boundary keeps downstream typing tight.
  const preferredLeagueId =
    typeof raw === 'string' && raw.length > 0 ? raw : null
  return <HomepageRouter preferredLeagueId={preferredLeagueId} />
}
