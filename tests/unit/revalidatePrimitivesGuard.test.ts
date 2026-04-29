import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * v1.16.0 — lint guard: direct revalidation primitives are forbidden
 * outside `src/lib/revalidate.ts`.
 *
 * Per CLAUDE.md (v1.16.0 autonomy block): cache invalidation goes through
 * `src/lib/revalidate.ts#revalidate({ domain })`. Direct
 * `revalidateTag(...)` / `revalidatePath(...)` / `updateTag(...)` calls
 * outside that file mean the consolidation has drifted — either someone
 * added a new write site without using the helper, or the helper grew a
 * leak.
 *
 * Source roots scanned: `src/`. Tests, scripts, node_modules, and the
 * canonical helper file itself are excluded.
 *
 * The match shape is `<symbol>(` — i.e. an actual function call. Doc-block
 * mentions in backticks (e.g. `` `revalidateTag('settings')` ``) don't
 * match because they don't have a paren immediately after the symbol in
 * a code-position context. We strip line-comments before matching to keep
 * inline-comment mentions inside docstrings from false-positiving.
 */

const FORBIDDEN_PRIMITIVES = ['revalidatePath', 'revalidateTag', 'updateTag'] as const
const ROOTS = ['src']
const SCAN_EXTENSIONS = new Set(['.ts', '.tsx'])
const EXEMPT_PATHS = new Set([
  // The canonical helper itself owns the primitives.
  'src/lib/revalidate.ts',
])

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

/**
 * Strip JS/TS comments and string/backtick literals from source so the
 * primitive match only sees code. Cheap version — handles `//`, `/* ... *​/`,
 * and `'…'` / `"…"` / `` `…` `` literals.
 *
 * Rough but effective for guard-test purposes; does not need to be a full
 * parser since false-positives surface as visible failures with file paths.
 */
function stripCommentsAndStrings(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    // Line comment
    if (c === '/' && next === '/') {
      const nl = text.indexOf('\n', i)
      if (nl === -1) break
      i = nl
      continue
    }
    // Block comment
    if (c === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2)
      if (close === -1) break
      i = close + 2
      continue
    }
    // String literal (', ", `)
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2
          continue
        }
        if (text[i] === quote) {
          i++
          break
        }
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

describe('v1.16.0 — revalidation primitives confined to src/lib/revalidate.ts', () => {
  const repoRoot = process.cwd()

  for (const symbol of FORBIDDEN_PRIMITIVES) {
    it(`no direct call to "${symbol}(" outside src/lib/revalidate.ts`, () => {
      const offenders: string[] = []
      const callPattern = new RegExp(`\\b${symbol}\\s*\\(`)
      for (const root of ROOTS) {
        const files = walk(join(repoRoot, root))
        for (const f of files) {
          const rel = f.slice(repoRoot.length + 1)
          if (EXEMPT_PATHS.has(rel)) continue
          const text = readFileSync(f, 'utf8')
          const stripped = stripCommentsAndStrings(text)
          if (callPattern.test(stripped)) {
            offenders.push(rel)
          }
        }
      }
      expect(offenders).toEqual([])
    })
  }
})
