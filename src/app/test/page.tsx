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
 * Architectural rule baked in: ALL homepage logic lives in
 * `<HomepageRouter />` and its children under `src/components/homepage/`.
 * This page file deliberately stays minimal so the swap is mechanical.
 */
export const metadata: Metadata = {
  title: 'T9L | Preview',
}

export default function TestHomepagePage() {
  return <HomepageRouter />
}
