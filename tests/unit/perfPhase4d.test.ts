import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * v1.80.9 — phase 4d perf: regression-target tests for the lazy-loaded
 * <Toaster />.
 *
 * v1.80.6 wired @next/bundle-analyzer; the post-v1.80.8 audit surfaced
 * `0p0p6yfobvglb.js` (~36 KB raw / ~10 KB gz) on every public route —
 * sonner's <Toaster /> mounted from app/layout.tsx but DOM-empty until
 * a toast() call. v1.80.9 moves it behind `next/dynamic` in a 'use client'
 * wrapper (`components/ToasterMount.tsx`), matching the v1.80.8 modal
 * lazy-load pattern.
 *
 * Stash-pop verification: re-injecting `import { Toaster } from "sonner"`
 * into app/layout.tsx makes the first assertion fail. Removing the
 * dynamic() call from ToasterMount.tsx makes the second fail.
 */
describe('v1.80.9 — perf phase 4d (lazy Toaster)', () => {
  it('app/layout.tsx does not statically import from "sonner"', () => {
    const path = resolve(process.cwd(), 'src/app/layout.tsx')
    const src = readFileSync(path, 'utf8')
    // Static `import ... from "sonner"` lines drag the whole sonner
    // bundle into the public root chunk. The lazy wrapper is the only
    // approved entry point.
    expect(src).not.toMatch(/from\s+["']sonner["']/)
  })

  it('app/layout.tsx mounts ToasterMount, not <Toaster> directly', () => {
    const path = resolve(process.cwd(), 'src/app/layout.tsx')
    const src = readFileSync(path, 'utf8')
    expect(src).toMatch(/<ToasterMount\s*\/>/)
    expect(src).not.toMatch(/<Toaster\s/)
  })

  it('ToasterMount lazy-loads sonner via next/dynamic with ssr:false', () => {
    const path = resolve(process.cwd(), 'src/components/ToasterMount.tsx')
    const src = readFileSync(path, 'utf8')
    expect(src.startsWith("'use client'")).toBe(true)
    expect(src).toMatch(/import\s+dynamic\s+from\s+['"]next\/dynamic['"]/)
    expect(src).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\(['"]sonner['"]\)/)
    expect(src).toMatch(/ssr:\s*false/)
  })
})
