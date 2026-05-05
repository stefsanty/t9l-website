import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import path from 'path'

/**
 * v1.59.0 — perf pass. Pre-v1.59.0 only `/admin/...` routes had `loading.tsx`,
 * so navigation to public routes (`/`, `/stats`, `/assign-player`, `/schedule`,
 * `/id/[slug]`, `/id/[slug]/md/[id]`) blocked until the full RSC payload
 * resolved server-side — measured 1-2s warm. Adding loading.tsx tells Next.js
 * to render the skeleton instantly during navigation while the RSC payload
 * streams in.
 *
 * This test pins the existence of loading.tsx for every public route. A
 * regression that drops one of these files would re-introduce the blocking
 * navigation behavior.
 */

const PUBLIC_ROUTES_WITH_LOADING = [
  'src/app/loading.tsx', // apex /
  'src/app/stats/loading.tsx',
  'src/app/schedule/loading.tsx',
  'src/app/assign-player/loading.tsx',
  'src/app/id/[slug]/loading.tsx',
  'src/app/id/[slug]/md/[id]/loading.tsx',
]

describe('v1.59.0 — public-route loading.tsx skeletons', () => {
  for (const route of PUBLIC_ROUTES_WITH_LOADING) {
    it(`${route} exists`, () => {
      expect(existsSync(path.join(process.cwd(), route))).toBe(true)
    })
  }
})
