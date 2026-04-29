import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * v1.14.0 — regression-prevention test for the ratings deletion.
 *
 * Ratings were removed entirely in v1.14.0 (peer-rating feature is no longer
 * surfaced; the RatingsRaw Sheets fetch was the heaviest of the seven
 * legacy ranges). This test asserts that no symbol associated with the
 * ratings feature reappears in src/ or scripts/ — a regression would mean
 * someone added the feature back without realizing it had been deleted.
 *
 * Greps the source tree for the symbol set that was scrubbed:
 *   PlayerRating, MatchdayVibes, computeMatchdayVibes, computeTopRated,
 *   matchdayVibes, avgRating, matchdaysRated, parseRatings, RatingsRaw
 *
 * Source roots scanned: src/, scripts/. Tests are excluded — this file
 * itself contains the strings as test fixtures.
 */

const FORBIDDEN = [
  'PlayerRating',
  'MatchdayVibes',
  'computeMatchdayVibes',
  'computeTopRated',
  'matchdayVibes',
  'avgRating',
  'matchdaysRated',
  'parseRatings',
  'RatingsRaw',
] as const

const ROOTS = ['src', 'scripts']
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '_archive') continue
    const full = join(dir, name)
    const s = statSync(full)
    if (s.isDirectory()) walk(full, out)
    else {
      const dot = name.lastIndexOf('.')
      const ext = dot >= 0 ? name.slice(dot) : ''
      if (SCAN_EXTENSIONS.has(ext)) out.push(full)
    }
  }
  return out
}

describe('v1.14.0 — ratings symbols removed from src/ and scripts/', () => {
  // One repo-relative root for forming readable failure messages.
  const repoRoot = process.cwd()

  for (const symbol of FORBIDDEN) {
    it(`no occurrence of "${symbol}" in src/ or scripts/`, () => {
      const offenders: string[] = []
      for (const root of ROOTS) {
        const files = walk(join(repoRoot, root))
        for (const f of files) {
          const text = readFileSync(f, 'utf8')
          if (text.includes(symbol)) {
            offenders.push(f.slice(repoRoot.length + 1))
          }
        }
      }
      // Failure surfaces the offending file paths so a regression is
      // immediately actionable.
      expect(offenders).toEqual([])
    })
  }
})
