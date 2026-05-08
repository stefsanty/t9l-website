/**
 * v1.80.1 — Sign out preserves current page via callbackUrl.
 *
 * Each signOut() call site must pass `callbackUrl: getCurrentCallbackUrl()`
 * so the user lands back on the page they signed out from, not apex `/`.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('v1.80.1 — signOut callbackUrl (AdminNav)', () => {
  const src = read('src/components/admin/AdminNav.tsx')

  it('imports getCurrentCallbackUrl from signInCallbackUrl', () => {
    expect(src).toContain("getCurrentCallbackUrl")
    expect(src).toContain("@/lib/signInCallbackUrl")
  })

  it('no signOut call passes hardcoded callbackUrl "/"', () => {
    expect(src).not.toMatch(/signOut\(\s*\{\s*callbackUrl\s*:\s*'\/'\s*\}/)
  })

  it('every signOut call passes getCurrentCallbackUrl()', () => {
    const matches = [...src.matchAll(/signOut\(/g)]
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      const snippet = src.slice(m.index!, m.index! + 80)
      expect(snippet).toMatch(/getCurrentCallbackUrl\(\)/)
    }
  })
})

describe('v1.80.1 — signOut callbackUrl (LineLoginButton)', () => {
  const src = read('src/components/LineLoginButton.tsx')

  it('no signOut call passes hardcoded callbackUrl "/"', () => {
    expect(src).not.toMatch(/signOut\(\s*\{\s*callbackUrl\s*:\s*'\/'\s*\}/)
  })

  it('signOut call passes getCurrentCallbackUrl()', () => {
    const m = src.match(/signOut\(/)
    expect(m).not.toBeNull()
    const snippet = src.slice(m!.index!, m!.index! + 80)
    expect(snippet).toMatch(/getCurrentCallbackUrl\(\)/)
  })
})

describe('v1.80.1 stash-pop regression targets', () => {
  it('APP_VERSION is 1.80.1 or later', () => {
    const v = read('src/lib/version.ts')
    expect(v).toMatch(/APP_VERSION\s*=\s*'1\.80\.[1-9]'|'1\.[89]\d\.\d+'|'[2-9]\.\d+\.\d+'/)
  })
})
